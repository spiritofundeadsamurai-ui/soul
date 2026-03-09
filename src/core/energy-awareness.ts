/**
 * Energy Awareness — Self-aware of speed, cost, and token usage
 *
 * UPGRADE #16: Soul knows how much resources it's using and can:
 * 1. Track token usage per conversation and overall
 * 2. Report response time trends
 * 3. Estimate cost per interaction
 * 4. Suggest when to use cheaper/faster models
 * 5. Self-optimize by identifying expensive patterns
 */

import { getRawDb } from "../db/index.js";

export interface EnergyReport {
  // Current session
  sessionTokens: number;
  sessionCost: number;       // estimated USD
  sessionAvgResponseMs: number;

  // Historical
  totalTokens: number;
  totalCost: number;
  avgTokensPerTurn: number;
  avgResponseMs: number;

  // Efficiency
  cacheHitRate: number;      // 0-1
  knowledgeHitRate: number;  // 0-1
  toolUsageRate: number;     // % of turns that used tools

  // Recommendations
  recommendations: string[];
}

function ensureEnergyTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_energy_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      response_ms INTEGER NOT NULL DEFAULT 0,
      was_cached INTEGER NOT NULL DEFAULT 0,
      was_knowledge INTEGER NOT NULL DEFAULT 0,
      tools_used INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Log energy usage for a single interaction
 */
export function logEnergy(input: {
  sessionId?: string;
  tokensUsed: number;
  responseMs: number;
  wasCached: boolean;
  wasKnowledge: boolean;
  toolsUsed: number;
  model: string;
}) {
  ensureEnergyTable();
  const rawDb = getRawDb();

  rawDb.prepare(`
    INSERT INTO soul_energy_log (session_id, tokens_used, response_ms, was_cached, was_knowledge, tools_used, model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId || null,
    input.tokensUsed,
    input.responseMs,
    input.wasCached ? 1 : 0,
    input.wasKnowledge ? 1 : 0,
    input.toolsUsed,
    input.model
  );
}

/**
 * Get energy report
 */
export function getEnergyReport(sessionId?: string): EnergyReport {
  ensureEnergyTable();
  const rawDb = getRawDb();

  // Session stats
  let sessionTokens = 0;
  let sessionAvgMs = 0;
  if (sessionId) {
    const sessionRow = rawDb.prepare(`
      SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
             COALESCE(AVG(response_ms), 0) as avg_ms
      FROM soul_energy_log WHERE session_id = ?
    `).get(sessionId) as any;
    sessionTokens = sessionRow?.total_tokens || 0;
    sessionAvgMs = Math.round(sessionRow?.avg_ms || 0);
  }

  // Overall stats
  const overall = rawDb.prepare(`
    SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
           COALESCE(AVG(tokens_used), 0) as avg_tokens,
           COALESCE(AVG(response_ms), 0) as avg_ms,
           COUNT(*) as total_turns,
           SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END) as cache_hits,
           SUM(CASE WHEN was_knowledge = 1 THEN 1 ELSE 0 END) as knowledge_hits,
           SUM(CASE WHEN tools_used > 0 THEN 1 ELSE 0 END) as tool_turns
    FROM soul_energy_log
  `).get() as any;

  const totalTokens = overall?.total_tokens || 0;
  const totalTurns = overall?.total_turns || 1;
  const cacheHitRate = (overall?.cache_hits || 0) / totalTurns;
  const knowledgeHitRate = (overall?.knowledge_hits || 0) / totalTurns;
  const toolUsageRate = (overall?.tool_turns || 0) / totalTurns;

  // Estimate cost (rough: $0.002 per 1K tokens for small models, $0.01 for large)
  const costPer1k = 0.002;
  const totalCost = (totalTokens / 1000) * costPer1k;
  const sessionCost = (sessionTokens / 1000) * costPer1k;

  // Generate recommendations
  const recommendations: string[] = [];

  if (cacheHitRate < 0.1 && totalTurns > 20) {
    recommendations.push("Cache hit rate is low. Consider asking similar questions to benefit from caching.");
  }
  if (overall?.avg_tokens > 2000) {
    recommendations.push("Average token usage is high. Shorter conversations could save resources.");
  }
  if (overall?.avg_ms > 10000) {
    recommendations.push("Responses are slow. Consider using a smaller/faster model for simple questions.");
  }
  if (toolUsageRate > 0.8) {
    recommendations.push("Tools are used very frequently. Simple conversations don't need tools.");
  }
  if (knowledgeHitRate > 0.3) {
    recommendations.push("Knowledge base is serving many queries. Keep adding quality knowledge.");
  }

  return {
    sessionTokens,
    sessionCost: Math.round(sessionCost * 10000) / 10000,
    sessionAvgResponseMs: sessionAvgMs,
    totalTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    avgTokensPerTurn: Math.round(overall?.avg_tokens || 0),
    avgResponseMs: Math.round(overall?.avg_ms || 0),
    cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    knowledgeHitRate: Math.round(knowledgeHitRate * 100) / 100,
    toolUsageRate: Math.round(toolUsageRate * 100) / 100,
    recommendations,
  };
}

/**
 * Format energy report for display
 */
export function formatEnergyReport(report: EnergyReport): string {
  const lines: string[] = [
    "⚡ Soul Energy Report",
    "",
    `Session: ${report.sessionTokens.toLocaleString()} tokens | ~$${report.sessionCost} | avg ${report.sessionAvgResponseMs}ms`,
    `Overall: ${report.totalTokens.toLocaleString()} tokens | ~$${report.totalCost} | avg ${report.avgTokensPerTurn} tok/turn`,
    "",
    `Cache Hit: ${Math.round(report.cacheHitRate * 100)}% | Knowledge: ${Math.round(report.knowledgeHitRate * 100)}% | Tools: ${Math.round(report.toolUsageRate * 100)}%`,
  ];

  if (report.recommendations.length > 0) {
    lines.push("", "Recommendations:");
    for (const r of report.recommendations) {
      lines.push(`  • ${r}`);
    }
  }

  return lines.join("\n");
}
