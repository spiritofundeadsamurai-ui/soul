/**
 * Smart Tool Learning — Learn which tools actually help
 *
 * UPGRADE #22: Track tool effectiveness and auto-optimize routing:
 * 1. Per-topic tool success tracking (not just global)
 * 2. Tool combination detection (which tools work well together)
 * 3. Auto-disable tools that consistently fail
 * 4. Suggest new tool combinations based on patterns
 */

import { getRawDb } from "../db/index.js";

export interface ToolEffectiveness {
  toolName: string;
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  topTopics: string[];
  wasUseful: boolean;
}

function ensureToolLearningTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_tool_learning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'general',
      was_useful INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      paired_with TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Record tool usage outcome
 */
export function recordToolOutcome(input: {
  toolName: string;
  topic: string;
  wasUseful: boolean;
  durationMs: number;
  pairedWith?: string[];
}) {
  ensureToolLearningTable();
  const rawDb = getRawDb();

  try {
    rawDb.prepare(`
      INSERT INTO soul_tool_learning (tool_name, topic, was_useful, duration_ms, paired_with)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.toolName,
      input.topic,
      input.wasUseful ? 1 : 0,
      input.durationMs,
      input.pairedWith ? input.pairedWith.join(",") : null
    );
  } catch { /* ok */ }
}

/**
 * Get tool effectiveness rankings
 */
export function getToolEffectiveness(topic?: string): ToolEffectiveness[] {
  ensureToolLearningTable();
  const rawDb = getRawDb();

  try {
    let query = `
      SELECT tool_name,
             COUNT(*) as total_calls,
             SUM(CASE WHEN was_useful = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
             AVG(duration_ms) as avg_duration
      FROM soul_tool_learning
      WHERE created_at > datetime('now', '-30 days')
    `;
    const params: any[] = [];

    if (topic) {
      query += " AND topic = ?";
      params.push(topic);
    }

    query += " GROUP BY tool_name ORDER BY success_rate DESC";

    const rows = rawDb.prepare(query).all(...params) as any[];

    return rows.map((r: any) => {
      // Get top topics for this tool
      const topicRows = rawDb.prepare(`
        SELECT topic, COUNT(*) as c FROM soul_tool_learning
        WHERE tool_name = ? AND was_useful = 1
        GROUP BY topic ORDER BY c DESC LIMIT 3
      `).all(r.tool_name) as any[];

      return {
        toolName: r.tool_name,
        totalCalls: r.total_calls,
        successRate: Math.round(r.success_rate * 100) / 100,
        avgDurationMs: Math.round(r.avg_duration),
        topTopics: topicRows.map((t: any) => t.topic),
        wasUseful: r.success_rate > 0.5,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get best tools for a specific topic
 */
export function getBestToolsForTopic(topic: string, limit = 5): string[] {
  ensureToolLearningTable();
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT tool_name,
             SUM(CASE WHEN was_useful = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
             COUNT(*) as total
      FROM soul_tool_learning
      WHERE topic = ? AND created_at > datetime('now', '-30 days')
      GROUP BY tool_name
      HAVING total >= 2
      ORDER BY success_rate DESC
      LIMIT ?
    `).all(topic, limit) as any[];

    return rows.map((r: any) => r.tool_name);
  } catch {
    return [];
  }
}

/**
 * Get effective tool combinations
 */
export function getToolCombinations(): Array<{ tools: string[]; frequency: number; successRate: number }> {
  ensureToolLearningTable();
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT paired_with, COUNT(*) as freq,
             SUM(CASE WHEN was_useful = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate
      FROM soul_tool_learning
      WHERE paired_with IS NOT NULL AND paired_with != ''
      GROUP BY paired_with
      HAVING freq >= 3
      ORDER BY success_rate DESC
      LIMIT 10
    `).all() as any[];

    return rows.map((r: any) => ({
      tools: r.paired_with.split(","),
      frequency: r.freq,
      successRate: Math.round(r.success_rate * 100) / 100,
    }));
  } catch {
    return [];
  }
}

/**
 * Get tools that should be avoided (consistently fail)
 */
export function getFailingTools(): string[] {
  ensureToolLearningTable();
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT tool_name,
             SUM(CASE WHEN was_useful = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
             COUNT(*) as total
      FROM soul_tool_learning
      WHERE created_at > datetime('now', '-14 days')
      GROUP BY tool_name
      HAVING total >= 5 AND success_rate < 0.2
    `).all() as any[];

    return rows.map((r: any) => r.tool_name);
  } catch {
    return [];
  }
}

/**
 * Generate tool routing guidance for system prompt
 */
export function getToolRoutingGuidance(topic: string): string | null {
  const bestTools = getBestToolsForTopic(topic);
  const failingTools = getFailingTools();

  if (bestTools.length === 0 && failingTools.length === 0) return null;

  const parts: string[] = [];
  if (bestTools.length > 0) {
    parts.push(`Best tools for "${topic}": ${bestTools.join(", ")}`);
  }
  if (failingTools.length > 0) {
    parts.push(`Avoid these tools (low success rate): ${failingTools.join(", ")}`);
  }

  return parts.join("\n");
}
