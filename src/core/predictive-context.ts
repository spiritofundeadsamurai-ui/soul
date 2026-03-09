/**
 * Predictive Context — Predict what master will ask next
 *
 * UPGRADE #20: Soul anticipates master's needs:
 * 1. Time-based prediction (master asks X at this hour usually)
 * 2. Sequence prediction (after asking A, master usually asks B)
 * 3. Context-based prediction (given current topic, likely follow-ups)
 * 4. Pre-fetch context so responses are faster
 */

import { getRawDb } from "../db/index.js";

export interface Prediction {
  type: "time" | "sequence" | "topic";
  prediction: string;
  confidence: number;
  reason: string;
}

function ensurePredictionTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      predicted_topic TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      miss_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(trigger_type, trigger_value, predicted_topic)
    )
  `);
}

/**
 * Record what master asked (to build prediction models)
 */
export function recordInteraction(message: string, hour: number, previousTopic?: string) {
  ensurePredictionTable();
  const rawDb = getRawDb();

  // Extract topic keywords
  const lower = message.toLowerCase();
  const topics = extractTopics(lower);

  for (const topic of topics) {
    // Time-based: "at hour X, master asks about Y"
    try {
      rawDb.prepare(`
        INSERT INTO soul_predictions (trigger_type, trigger_value, predicted_topic, hit_count)
        VALUES ('time', ?, ?, 1)
        ON CONFLICT(trigger_type, trigger_value, predicted_topic) DO UPDATE SET
          hit_count = hit_count + 1
      `).run(String(hour), topic);
    } catch { /* ok */ }

    // Sequence-based: "after topic X, master asks about Y"
    if (previousTopic && previousTopic !== topic) {
      try {
        rawDb.prepare(`
          INSERT INTO soul_predictions (trigger_type, trigger_value, predicted_topic, hit_count)
          VALUES ('sequence', ?, ?, 1)
          ON CONFLICT(trigger_type, trigger_value, predicted_topic) DO UPDATE SET
            hit_count = hit_count + 1
        `).run(previousTopic, topic);
      } catch { /* ok */ }
    }
  }
}

/**
 * Predict what master might ask next
 */
export function predictNext(
  currentTopic?: string,
  currentHour?: number,
): Prediction[] {
  ensurePredictionTable();
  const rawDb = getRawDb();
  const predictions: Prediction[] = [];

  const hour = currentHour ?? new Date().getHours();

  // Time-based predictions
  try {
    const timeRows = rawDb.prepare(`
      SELECT predicted_topic, hit_count, miss_count
      FROM soul_predictions
      WHERE trigger_type = 'time' AND trigger_value = ?
      AND hit_count >= 3
      ORDER BY hit_count DESC
      LIMIT 3
    `).all(String(hour)) as any[];

    for (const r of timeRows) {
      const total = r.hit_count + r.miss_count;
      const conf = total > 0 ? r.hit_count / total : 0.5;
      if (conf >= 0.3) {
        predictions.push({
          type: "time",
          prediction: r.predicted_topic,
          confidence: Math.round(conf * 100) / 100,
          reason: `Master usually discusses "${r.predicted_topic}" around ${hour}:00 (${r.hit_count} times)`,
        });
      }
    }
  } catch { /* ok */ }

  // Sequence-based predictions
  if (currentTopic) {
    try {
      const seqRows = rawDb.prepare(`
        SELECT predicted_topic, hit_count, miss_count
        FROM soul_predictions
        WHERE trigger_type = 'sequence' AND trigger_value = ?
        AND hit_count >= 2
        ORDER BY hit_count DESC
        LIMIT 3
      `).all(currentTopic) as any[];

      for (const r of seqRows) {
        const total = r.hit_count + r.miss_count;
        const conf = total > 0 ? r.hit_count / total : 0.5;
        if (conf >= 0.3) {
          predictions.push({
            type: "sequence",
            prediction: r.predicted_topic,
            confidence: Math.round(conf * 100) / 100,
            reason: `After "${currentTopic}", master often asks about "${r.predicted_topic}" (${r.hit_count} times)`,
          });
        }
      }
    } catch { /* ok */ }
  }

  // Sort by confidence
  predictions.sort((a, b) => b.confidence - a.confidence);
  return predictions.slice(0, 5);
}

/**
 * Generate predictive context for system prompt
 */
export function getPredictiveContext(currentTopic?: string): string | null {
  const predictions = predictNext(currentTopic);
  if (predictions.length === 0) return null;

  const parts = predictions.slice(0, 3).map(p =>
    `- ${p.prediction} (${Math.round(p.confidence * 100)}% likely, ${p.reason})`
  );

  return `Predicted next topics:\n${parts.join("\n")}\nBe ready to discuss these proactively if relevant.`;
}

// ─── Helpers ───

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const lower = text.toLowerCase();

  const topicMap: Record<string, string[]> = {
    "code": ["code", "โค้ด", "program", "function", "bug", "debug", "api", "server", "database"],
    "design": ["design", "ออกแบบ", "ui", "ux", "layout", "component"],
    "work": ["work", "งาน", "project", "deadline", "meeting", "task"],
    "learning": ["learn", "เรียน", "study", "course", "tutorial", "understand"],
    "life": ["life", "ชีวิต", "health", "exercise", "sleep", "goal", "habit"],
    "finance": ["money", "เงิน", "cost", "price", "budget", "invest", "ค่าใช้จ่าย"],
    "ai": ["ai", "model", "llm", "prompt", "soul", "claude", "gpt", "machine learning"],
    "creative": ["write", "เขียน", "story", "idea", "brainstorm", "create", "สร้าง"],
    "research": ["research", "วิจัย", "study", "analyze", "data", "find", "ค้นหา"],
    "plan": ["plan", "วางแผน", "strategy", "next", "future", "timeline"],
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    if (keywords.some(k => lower.includes(k))) {
      topics.push(topic);
    }
  }

  return topics.length > 0 ? topics : ["general"];
}
