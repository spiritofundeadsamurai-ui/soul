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

/**
 * Route a message to the best model based on complexity
 */
export function routeToModel(
  message: string,
  taskType?: string,
): ModelRoute | null {
  const providers = listConfiguredProviders();
  const defaultConfig = getDefaultConfig();

  if (providers.length <= 1 || !defaultConfig) {
    return null; // only one model, no routing needed
  }

  const lower = message.toLowerCase();
  const len = message.length;

  // Classify the task
  let detectedTaskType = taskType || "general";
  if (!taskType) {
    // Simple chat detection
    const isSimple = len < 50 && !lower.includes("why") && !lower.includes("how") && !lower.includes("explain");
    const isCreative = lower.includes("write") || lower.includes("story") || lower.includes("poem") ||
                       lower.includes("เขียน") || lower.includes("แต่ง");
    const isAnalytical = lower.includes("analyze") || lower.includes("compare") || lower.includes("design") ||
                        lower.includes("วิเคราะห์") || lower.includes("ออกแบบ") || lower.includes("เปรียบเทียบ");
    const isCoding = lower.includes("code") || lower.includes("function") || lower.includes("bug") ||
                     lower.includes("โค้ด") || lower.includes("debug");

    if (isSimple) detectedTaskType = "simple";
    else if (isCreative) detectedTaskType = "creative";
    else if (isAnalytical) detectedTaskType = "analytical";
    else if (isCoding) detectedTaskType = "coding";
    else if (len > 200) detectedTaskType = "complex";
  }

  // Find best model based on task type and past performance
  const stats = getModelPerformance();

  // Temperature routing
  let temperature = 0.7; // default
  switch (detectedTaskType) {
    case "simple": temperature = 0.5; break;
    case "creative": temperature = 0.9; break;
    case "analytical": temperature = 0.3; break;
    case "coding": temperature = 0.2; break;
    case "complex": temperature = 0.5; break;
  }

  // For simple tasks, prefer faster models
  if (detectedTaskType === "simple" && stats.length > 1) {
    const fastest = stats.sort((a, b) => a.avgResponseMs - b.avgResponseMs)[0];
    if (fastest.avgResponseMs < 5000) { // only if significantly faster
      return {
        providerId: fastest.providerId,
        modelId: fastest.modelId,
        temperature,
        reason: `Fast model for simple task (avg ${fastest.avgResponseMs}ms)`,
      };
    }
  }

  // For complex/analytical tasks, prefer most accurate model
  if (["analytical", "complex", "coding"].includes(detectedTaskType) && stats.length > 1) {
    const mostAccurate = stats.sort((a, b) => b.successRate - a.successRate)[0];
    if (mostAccurate.successRate > 0.8) {
      return {
        providerId: mostAccurate.providerId,
        modelId: mostAccurate.modelId,
        temperature,
        reason: `Best model for ${detectedTaskType} (${Math.round(mostAccurate.successRate * 100)}% success)`,
      };
    }
  }

  // Default: use default config with task-appropriate temperature
  return {
    providerId: defaultConfig.providerId,
    modelId: defaultConfig.modelName,
    temperature,
    reason: `Default model with temperature ${temperature} for ${detectedTaskType}`,
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
