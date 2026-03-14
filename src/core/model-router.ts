/**
 * Multi-Model Intelligence — Smart model routing
 *
 * UPGRADE #19: Use the RIGHT model for the RIGHT task:
 * 1. Simple chat → small/fast model (save tokens + faster)
 * 2. Complex reasoning → big model (accuracy matters)
 * 3. Fact-checking → low-temperature model
 * 4. Creative writing → high-temperature model
 * 5. Cost-aware: track spending and suggest cheaper alternatives
 */

import { getRawDb } from "../db/index.js";
import { listConfiguredProviders, getDefaultConfig } from "./llm-connector.js";

export interface ModelRoute {
  providerId: string;
  modelId: string;
  temperature: number;
  reason: string;
}

export interface ModelPerformance {
  providerId: string;
  modelId: string;
  avgResponseMs: number;
  avgTokens: number;
  successRate: number;
  totalCalls: number;
}

function ensureModelStatsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_model_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'general',
      response_ms INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      was_successful INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Track model performance for a request
 */
export function trackModelPerformance(input: {
  providerId: string;
  modelId: string;
  taskType: string;
  responseMs: number;
  tokensUsed: number;
  wasSuccessful: boolean;
}) {
  ensureModelStatsTable();
  const rawDb = getRawDb();
  try {
    rawDb.prepare(`
      INSERT INTO soul_model_stats (provider_id, model_id, task_type, response_ms, tokens_used, was_successful)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.providerId, input.modelId, input.taskType, input.responseMs, input.tokensUsed, input.wasSuccessful ? 1 : 0);
  } catch { /* ok */ }
}

/**
 * Get performance stats for all models
 */
export function getModelPerformance(): ModelPerformance[] {
  ensureModelStatsTable();
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT provider_id, model_id,
             AVG(response_ms) as avg_ms,
             AVG(tokens_used) as avg_tokens,
             SUM(CASE WHEN was_successful = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
             COUNT(*) as total_calls
      FROM soul_model_stats
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY provider_id, model_id
      ORDER BY total_calls DESC
    `).all() as any[];

    return rows.map((r: any) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      avgResponseMs: Math.round(r.avg_ms),
      avgTokens: Math.round(r.avg_tokens),
      successRate: Math.round(r.success_rate * 100) / 100,
      totalCalls: r.total_calls,
    }));
  } catch {
    return [];
  }
}

// ─── Cascade Config ───
// Defines which model to use per complexity tier
// Soul auto-detects configured providers and builds the best cascade

interface CascadeTier {
  providerId: string;
  modelId: string;
  label: string;
}

/**
 * Build optimal cascade from configured providers
 * Priority: cheapest fast model for simple, default for medium, best for complex
 */
export function buildCascade(): { simple: CascadeTier; medium: CascadeTier; complex: CascadeTier } | null {
  const providers = listConfiguredProviders();
  const defaultConfig = getDefaultConfig();
  if (!defaultConfig) return null;

  const defaultTier: CascadeTier = {
    providerId: defaultConfig.providerId,
    modelId: defaultConfig.modelId,
    label: `${defaultConfig.providerId}/${defaultConfig.modelId}`,
  };

  // Cost ranking (lowest first) for configured providers
  const costRank: Record<string, number> = {
    "groq:llama-3.1-8b-instant": 0.05,
    "groq:meta-llama/llama-4-scout-17b-16e-instruct": 0.11,
    "gemini:gemini-2.5-flash": 0.15,
    "openai:gpt-4o-mini": 0.15,
    "together:Qwen/Qwen3-Coder-32B-Instruct": 0.20,
    "groq:moonshotai/kimi-k2-instruct": 0.20,
    "deepseek:deepseek-chat": 0.28,
    "groq:qwen/qwen3-32b": 0.29,
    "groq:llama-3.3-70b-versatile": 0.59,
    "openai:gpt-4o": 2.50,
    "anthropic:claude-sonnet-4-6": 3.00,
    "gemini:gemini-2.5-pro": 1.25,
    "openai:gpt-5": 1.25,
  };

  // Quality ranking (best first) for complex tasks
  // Updated based on real tool-calling benchmarks (2026-03-13)
  const qualityRank: Record<string, number> = {
    "anthropic:claude-sonnet-4-6": 95,
    "openai:gpt-5": 93,
    "gemini:gemini-2.5-pro": 92,
    "openai:gpt-4o": 88,
    "deepseek:deepseek-reasoner": 87,
    "gemini:gemini-2.5-flash": 86,           // Good tool calling + 1M tok/day free (best value)
    "groq:moonshotai/kimi-k2-instruct": 84, // Good tool calling but 10K tok/min limit
    "deepseek:deepseek-chat": 82,
    "openai:gpt-4o-mini": 80,               // 4/4 tool calling, reliable paid
    "groq:qwen/qwen3-32b": 76,              // 3/4 tool calling, has errors
    "groq:llama-3.3-70b-versatile": 74,     // 2/4 tool calling, format bugs
  };

  // Find cheapest configured provider for simple tasks
  let simpleTier = defaultTier;
  let cheapestCost = Infinity;
  for (const p of providers) {
    const key = `${p.providerId}:${p.modelId}`;
    const cost = costRank[key];
    if (cost !== undefined && cost < cheapestCost) {
      cheapestCost = cost;
      simpleTier = { providerId: p.providerId, modelId: p.modelId, label: key };
    }
  }

  // Find best quality configured provider for complex tasks
  let complexTier = defaultTier;
  let bestQuality = 0;
  for (const p of providers) {
    const key = `${p.providerId}:${p.modelId}`;
    const quality = qualityRank[key];
    if (quality !== undefined && quality > bestQuality) {
      bestQuality = quality;
      complexTier = { providerId: p.providerId, modelId: p.modelId, label: key };
    }
  }

  return { simple: simpleTier, medium: defaultTier, complex: complexTier };
}

/**
 * Route a message to the best model based on complexity + cascade
 */
export function routeToModel(
  message: string,
  taskType?: string,
  options?: { isAction?: boolean },
): ModelRoute | null {
  const defaultConfig = getDefaultConfig();
  if (!defaultConfig) return null;

  const lower = message.toLowerCase();
  const len = message.length;

  // Classify the task
  let detectedTaskType = taskType || "general";
  if (!taskType) {
    const isSimple = len < 50 && !lower.includes("why") && !lower.includes("how") && !lower.includes("explain")
      && !lower.includes("ทำไม") && !lower.includes("ยังไง") && !lower.includes("อธิบาย");
    const isCreative = lower.includes("write") || lower.includes("story") || lower.includes("poem") ||
                       lower.includes("เขียน") || lower.includes("แต่ง");
    const isAnalytical = lower.includes("analyze") || lower.includes("compare") || lower.includes("design") ||
                        lower.includes("วิเคราะห์") || lower.includes("ออกแบบ") || lower.includes("เปรียบเทียบ");
    const isCoding = lower.includes("code") || lower.includes("function") || lower.includes("bug") ||
                     lower.includes("โค้ด") || lower.includes("debug") || lower.includes("implement");
    const isReasoning = lower.includes("why") || lower.includes("reason") || lower.includes("prove") ||
                        lower.includes("ทำไม") || lower.includes("เพราะ") || lower.includes("พิสูจน์");

    // Specific categories take priority over the "simple" length heuristic
    if (isCoding) detectedTaskType = "coding";
    else if (isAnalytical || isReasoning) detectedTaskType = "analytical";
    else if (isCreative) detectedTaskType = "creative";
    else if (isSimple) detectedTaskType = "simple";
    else if (len > 200) detectedTaskType = "complex";
    else detectedTaskType = "medium";
  }

  // Temperature routing
  let temperature = 0.7;
  switch (detectedTaskType) {
    case "simple": temperature = 0.5; break;
    case "creative": temperature = 0.9; break;
    case "analytical": temperature = 0.3; break;
    case "coding": temperature = 0.2; break;
    case "complex": temperature = 0.5; break;
    case "medium": temperature = 0.7; break;
  }

  // Build cascade from configured providers
  const cascade = buildCascade();
  if (cascade) {
    // CRITICAL: Action messages (commands that need tool calling) ALWAYS use the best model
    // Small/cheap models often can't do tool calling properly → Soul "talks instead of doing"
    const isAction = options?.isAction ?? false;
    const isComplex = isAction || ["analytical", "complex", "coding"].includes(detectedTaskType);
    const isSimple = !isAction && detectedTaskType === "simple";

    const tier = isComplex ? cascade.complex : isSimple ? cascade.simple : cascade.medium;

    return {
      providerId: tier.providerId,
      modelId: tier.modelId,
      temperature,
      reason: `Cascade: ${tier.label} for ${detectedTaskType} (temp=${temperature})`,
    };
  }

  // Fallback: check performance stats
  const stats = getModelPerformance();
  if (stats.length > 1) {
    if (detectedTaskType === "simple") {
      const fastest = [...stats].sort((a, b) => a.avgResponseMs - b.avgResponseMs)[0];
      if (fastest.avgResponseMs < 5000) {
        return { providerId: fastest.providerId, modelId: fastest.modelId, temperature,
          reason: `Fast model for simple task (avg ${fastest.avgResponseMs}ms)` };
      }
    }
    if (["analytical", "complex", "coding"].includes(detectedTaskType)) {
      const best = [...stats].sort((a, b) => b.successRate - a.successRate)[0];
      if (best.successRate > 0.8) {
        return { providerId: best.providerId, modelId: best.modelId, temperature,
          reason: `Best model for ${detectedTaskType} (${Math.round(best.successRate * 100)}% success)` };
      }
    }
  }

  // Default with appropriate temperature
  return {
    providerId: defaultConfig.providerId,
    modelId: defaultConfig.modelId,
    temperature,
    reason: `Default model (temp=${temperature}) for ${detectedTaskType}`,
  };
}

/**
 * Format model performance report
 */
export function formatModelReport(): string {
  const stats = getModelPerformance();
  if (stats.length === 0) return "No model performance data yet.";

  const lines: string[] = ["Model Performance Report:", ""];
  for (const s of stats) {
    lines.push(
      `${s.providerId}/${s.modelId}: ${s.avgResponseMs}ms avg | ${s.avgTokens} tok/call | ${Math.round(s.successRate * 100)}% success | ${s.totalCalls} calls`
    );
  }
  return lines.join("\n");
}
