/**
 * Dual-Brain Architecture — Soul's Thinking System
 *
 * Inspired by Macrohard/Digital Optimus (Elon Musk, March 2026)
 * and Daniel Kahneman's "Thinking, Fast and Slow"
 *
 * System 1 (Reflex Engine): Fast, no LLM, < 100ms
 *   - Pattern reflexes (learned from past System 2 responses)
 *   - Emotional reflexes (instant mood detection)
 *   - Habit reflexes (daily patterns)
 *   - Tool reflexes (auto-tools)
 *   - Safety reflexes (immune system)
 *
 * System 2 (Conductor): Deep thinking, LLM-powered, 2-30s
 *   - Full agent loop with tools
 *   - Thinking chain (decompose, debate, verify)
 *   - Agent planner with backtracking
 *   - Self-healing on failures
 *
 * The Orchestrator routes to System 1 first. If confident enough,
 * responds immediately. Otherwise escalates to System 2.
 * After System 2 responds, it trains System 1 for similar future queries.
 *
 * Over time, more queries are handled by System 1 → faster, cheaper, smarter.
 */

import { getRawDb } from "../db/index.js";
import { tryReflex, promoteToReflex, reportReflexMiss, seedDefaultReflexes } from "./reflex-engine.js";
import type { AgentResult } from "./agent-loop.js";
import { isActionMessage } from "./agent-loop.js";

// ─── One-time reflex seeding ───
let _reflexesSeeded = false;

// ─── Lazy table creation ───
let tableReady = false;
function ensureBrainMetricsTable() {
  if (tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_brain_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brain TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      reflex_type TEXT,
      latency_ms INTEGER NOT NULL,
      confidence REAL,
      quality_score REAL,
      was_escalated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_brain_metrics_brain ON soul_brain_metrics(brain);
    CREATE INDEX IF NOT EXISTS idx_brain_metrics_created ON soul_brain_metrics(created_at);
  `);
  tableReady = true;
}

// ─── Interfaces ───

export interface DualBrainOptions {
  confidenceThreshold?: number;  // default 0.85
  skipSystem1?: boolean;         // force System 2
  skipSystem2?: boolean;         // force System 1 only (offline mode)
  isLeanMode?: boolean;          // lower threshold for local models
  providerId?: string;
  modelId?: string;
  maxIterations?: number;
  temperature?: number;
  systemPrompt?: string;
  history?: any[];
  skipCache?: boolean;
  onProgress?: (event: any) => void;
  childName?: string;
  sessionId?: string;
}

export interface DualBrainResult extends AgentResult {
  brain: "system1" | "system2" | "auto-action" | "cache" | "knowledge";
  reflexType?: string;
  escalated: boolean;
  system1LatencyMs?: number;
  emotionalPrefix?: string;
}

// ─── Hash utility ───
function hashInput(input: string): string {
  const normalized = input.toLowerCase().trim().replace(/\s+/g, " ");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `b_${Math.abs(hash).toString(36)}`;
}

// ─── Orchestrator ───

/**
 * Main entry point — routes between System 1 and System 2
 */
export async function processDualBrain(
  userMessage: string,
  options?: DualBrainOptions,
): Promise<DualBrainResult> {
  const startTimeMs = Date.now();
  const threshold = options?.confidenceThreshold ?? (options?.isLeanMode ? 0.75 : 0.85);
  let emotionalPrefix: string | undefined;
  let system1LatencyMs: number | undefined;

  // Seed default reflexes on first use (once per process)
  if (!_reflexesSeeded) {
    try {
      seedDefaultReflexes();
    } catch { /* seeding failure is non-critical */ }
    _reflexesSeeded = true;
  }

  // ── Phase 1: System 1 Attempt (< 100ms) ──
  // CRITICAL: Skip System 1 pattern matching for ACTION messages
  // Action messages (commands with verbs like สร้าง, วิเคราะห์, ค้น, etc.)
  // MUST go to System 2 where tryAutoAction and tools can execute them.
  // System 1 can only cache TEXT responses, which is wrong for action messages.
  const isAction = isActionMessage(userMessage);

  if (!options?.skipSystem1) {
    const reflexResult = tryReflex(userMessage, {
      hour: new Date().getHours(),
      isLeanMode: options?.isLeanMode,
    });

    // Safety block — immediate return (always allow safety, even for action messages)
    if (reflexResult.blocked) {
      trackMetrics("system1", userMessage, reflexResult.reflexType, reflexResult.latencyMs, reflexResult.confidence, undefined, false);
      return {
        reply: reflexResult.response || "⚠️ Blocked.",
        toolsUsed: [],
        iterations: 0,
        totalTokens: 0,
        model: "system1-safety",
        provider: "soul-reflex",
        confidence: { overall: 99, label: "system1", emoji: "🛡️" },
        responseMs: Date.now() - startTimeMs,
        brain: "system1",
        reflexType: "safety",
        escalated: false,
        system1LatencyMs: reflexResult.latencyMs,
      };
    }

    // Pattern/Tool reflex — confident enough to respond
    // BUT: NEVER use cached pattern for action messages — they need real tool execution
    if (!isAction && reflexResult.handled && reflexResult.confidence && reflexResult.confidence >= threshold * 100) {
      trackMetrics("system1", userMessage, reflexResult.reflexType, reflexResult.latencyMs, reflexResult.confidence, undefined, false);
      return {
        reply: reflexResult.response || "",
        toolsUsed: [],
        iterations: 0,
        totalTokens: 0,
        model: "system1-reflex",
        provider: "soul-reflex",
        confidence: { overall: Math.round(reflexResult.confidence), label: "system1", emoji: "⚡" },
        responseMs: Date.now() - startTimeMs,
        brain: "system1",
        reflexType: reflexResult.reflexType,
        escalated: false,
        system1LatencyMs: reflexResult.latencyMs,
      };
    }

    // Emotional prefix — don't fully handle, pass to System 2
    emotionalPrefix = reflexResult.reflexType === "emotional" ? reflexResult.response : undefined;
    system1LatencyMs = reflexResult.latencyMs;
  }

  // ── Phase 2: Escalate to System 2 (existing agent loop) ──
  if (options?.skipSystem2) {
    return {
      reply: "System 2 is disabled. No System 1 match found.",
      toolsUsed: [],
      iterations: 0,
      totalTokens: 0,
      model: "none",
      provider: "none",
      confidence: { overall: 0, label: "none", emoji: "❌" },
      responseMs: Date.now() - startTimeMs,
      brain: "system1",
      escalated: false,
    };
  }

  try {
    // Import the existing agent loop (lazy import for circular dependency safety)
    const { runSystem2Loop } = await import("./agent-loop.js");
    const system2Result = await runSystem2Loop(userMessage, options);

    // Determine which brain actually handled it
    let brain: DualBrainResult["brain"] = "system2";
    if (system2Result.model === "auto-action") brain = "auto-action";
    else if (system2Result.model === "cache" || system2Result.cached) brain = "cache";
    else if (system2Result.model === "knowledge" || system2Result.knowledgeHit) brain = "knowledge";

    // Prepend emotional prefix if detected
    let reply = system2Result.reply;
    if (emotionalPrefix && reply && !reply.startsWith(emotionalPrefix)) {
      reply = `${emotionalPrefix}\n\n${reply}`;
    }

    const result: DualBrainResult = {
      ...system2Result,
      reply,
      brain,
      escalated: true,
      system1LatencyMs,
      emotionalPrefix,
    };

    // Track metrics
    trackMetrics(
      brain,
      userMessage,
      undefined,
      Date.now() - startTimeMs,
      system2Result.confidence?.overall,
      undefined,
      true,
    );

    // ── Phase 3: Learning Loop (System 2 → System 1) ──
    // Non-blocking: learn from this response for future System 1 matches
    learnFromSystem2(userMessage, system2Result).catch(() => {});

    return result;
  } catch (error: any) {
    // System 2 failed — return error
    return {
      reply: `Error: ${error.message}`,
      toolsUsed: [],
      iterations: 0,
      totalTokens: 0,
      model: "error",
      provider: "none",
      confidence: { overall: 0, label: "error", emoji: "❌" },
      responseMs: Date.now() - startTimeMs,
      brain: "system2",
      escalated: true,
    };
  }
}

// ─── Learning Loop (System 2 trains System 1) ───

/**
 * After System 2 produces a response, check if it should be promoted to System 1.
 * Rules:
 * - Quality >= 0.7
 * - Similar pattern seen 3+ times (or 2 in lean mode)
 * - Response is short enough to cache as a reflex (< 500 chars)
 */
async function learnFromSystem2(message: string, result: AgentResult): Promise<void> {
  try {
    // Skip if poor quality or too long
    const quality = (result.confidence?.overall || 0) / 100;
    if (quality < 0.7) return;
    if (!result.reply || result.reply.length > 500) return;
    if (result.toolsUsed.length > 0) return; // Tool-dependent responses don't cache well

    ensureBrainMetricsTable();
    const db = getRawDb();
    const inputHash = hashInput(message);

    // Count how many times we've seen similar input escalate to System 2
    const count = (db.prepare(`
      SELECT COUNT(*) as c FROM soul_brain_metrics
      WHERE input_hash = ? AND was_escalated = 1
      AND created_at > datetime('now', '-7 days')
    `).get(inputHash) as any)?.c || 0;

    // Promote after 3+ occurrences (pattern is stable)
    if (count >= 3) {
      const keywords = message.toLowerCase()
        .replace(/[?!.,;:'"()]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2);

      promoteToReflex({
        type: "pattern",
        triggerPattern: message.substring(0, 200),
        triggerKeywords: [...new Set(keywords)].slice(0, 10),
        responseTemplate: result.reply,
        qualityScore: quality,
        promotedFrom: "system2",
      });
    }
  } catch { /* learning failure is non-critical */ }
}

// ─── Metrics ───

function trackMetrics(
  brain: string,
  message: string,
  reflexType: string | undefined,
  latencyMs: number,
  confidence: number | undefined,
  qualityScore: number | undefined,
  wasEscalated: boolean,
): void {
  try {
    ensureBrainMetricsTable();
    const db = getRawDb();
    db.prepare(`
      INSERT INTO soul_brain_metrics (brain, input_hash, reflex_type, latency_ms, confidence, quality_score, was_escalated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(brain, hashInput(message), reflexType || null, latencyMs, confidence ?? null, qualityScore ?? null, wasEscalated ? 1 : 0);
  } catch { /* metrics failure is non-critical */ }
}

/**
 * Get dual-brain performance stats
 */
export function getDualBrainStats(): {
  totalRequests: number;
  system1Handled: number;
  system2Handled: number;
  system1Percentage: number;
  avgSystem1LatencyMs: number;
  avgSystem2LatencyMs: number;
  byBrain: Record<string, number>;
  last7Days: { date: string; system1: number; system2: number }[];
} {
  ensureBrainMetricsTable();
  const db = getRawDb();

  const total = (db.prepare(`SELECT COUNT(*) as c FROM soul_brain_metrics`).get() as any).c;
  const s1 = (db.prepare(`SELECT COUNT(*) as c FROM soul_brain_metrics WHERE brain = 'system1'`).get() as any).c;
  const s2 = total - s1;

  const avgS1 = (db.prepare(`SELECT AVG(latency_ms) as a FROM soul_brain_metrics WHERE brain = 'system1'`).get() as any).a || 0;
  const avgS2 = (db.prepare(`SELECT AVG(latency_ms) as a FROM soul_brain_metrics WHERE brain != 'system1'`).get() as any).a || 0;

  const brainRows = db.prepare(`SELECT brain, COUNT(*) as c FROM soul_brain_metrics GROUP BY brain`).all() as any[];
  const byBrain: Record<string, number> = {};
  for (const r of brainRows) byBrain[r.brain] = r.c;

  const dailyRows = db.prepare(`
    SELECT DATE(created_at) as date,
      SUM(CASE WHEN brain = 'system1' THEN 1 ELSE 0 END) as system1,
      SUM(CASE WHEN brain != 'system1' THEN 1 ELSE 0 END) as system2
    FROM soul_brain_metrics
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date
  `).all() as any[];

  return {
    totalRequests: total,
    system1Handled: s1,
    system2Handled: s2,
    system1Percentage: total > 0 ? Math.round((s1 / total) * 100) : 0,
    avgSystem1LatencyMs: Math.round(avgS1),
    avgSystem2LatencyMs: Math.round(avgS2),
    byBrain,
    last7Days: dailyRows.map(r => ({ date: r.date, system1: r.system1, system2: r.system2 })),
  };
}
