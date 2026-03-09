/**
 * Active Learning Loop — Learn from every interaction automatically
 *
 * UPGRADE #18: Soul doesn't just store memories, it LEARNS:
 * 1. Auto-extract knowledge from conversations
 * 2. Spaced repetition — unused knowledge decays, used knowledge grows
 * 3. Pattern recognition — detect recurring topics, timing patterns
 * 4. Proactive knowledge building — identify gaps and fill them
 */

import { getRawDb } from "../db/index.js";

export interface LearnedPattern {
  id: number;
  pattern: string;
  frequency: number;
  lastSeen: string;
  category: string; // "topic", "timing", "preference", "workflow"
  confidence: number;
}

function ensureActiveLearningTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_active_learning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL DEFAULT 'topic',
      confidence REAL NOT NULL DEFAULT 0.5,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_sal_pattern ON soul_active_learning(pattern)`);
}

/**
 * Auto-extract learnings from a completed conversation session
 * Called at session end or periodically
 */
export async function extractLearningsFromSession(
  messages: Array<{ role: string; content: string }>
): Promise<string[]> {
  ensureActiveLearningTable();
  const rawDb = getRawDb();
  const learnings: string[] = [];

  if (messages.length < 2) return learnings;

  // 1. Extract topics discussed
  const userMessages = messages.filter(m => m.role === "user");
  const allText = userMessages.map(m => m.content).join(" ").toLowerCase();

  // Topic extraction via keyword frequency
  const words = allText.split(/\s+/).filter(w => w.length > 3);
  const wordCounts = new Map<string, number>();
  const stopWords = new Set(["this", "that", "with", "from", "have", "been", "what", "when", "where", "which", "about", "would", "could", "should", "their", "there", "these", "those", "ที่", "ของ", "ใน", "ให้", "จะ", "ได้", "มี", "ก็", "แล้ว", "กับ", "เป็น", "ไม่", "คือ", "และ", "หรือ", "แต่"]);

  for (const w of words) {
    if (!stopWords.has(w) && !/^\d+$/.test(w)) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }
  }

  // Top topics (words appearing 2+ times)
  const topTopics = [...wordCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [topic, count] of topTopics) {
    recordPattern(rawDb, topic, "topic", count);
    learnings.push(`Topic "${topic}" discussed ${count} times`);
  }

  // 2. Detect question patterns
  const questionTypes = new Map<string, number>();
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase();
    if (lower.includes("how") || lower.includes("ยังไง") || lower.includes("อย่างไร")) {
      questionTypes.set("how-to", (questionTypes.get("how-to") || 0) + 1);
    }
    if (lower.includes("why") || lower.includes("ทำไม")) {
      questionTypes.set("why", (questionTypes.get("why") || 0) + 1);
    }
    if (lower.includes("what") || lower.includes("อะไร") || lower.includes("คืออะไร")) {
      questionTypes.set("what-is", (questionTypes.get("what-is") || 0) + 1);
    }
    if (lower.includes("compare") || lower.includes("เปรียบเทียบ") || lower.includes("vs")) {
      questionTypes.set("comparison", (questionTypes.get("comparison") || 0) + 1);
    }
    if (lower.includes("fix") || lower.includes("bug") || lower.includes("error") || lower.includes("แก้")) {
      questionTypes.set("troubleshooting", (questionTypes.get("troubleshooting") || 0) + 1);
    }
  }

  for (const [qType, count] of questionTypes) {
    recordPattern(rawDb, `question_type:${qType}`, "preference", count);
    learnings.push(`Master asks "${qType}" questions frequently (${count}x)`);
  }

  // 3. Detect timing patterns
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  recordPattern(rawDb, `active_hour:${hour}`, "timing", 1);
  recordPattern(rawDb, `active_day:${dayNames[dayOfWeek]}`, "timing", 1);

  // 4. Detect workflow patterns (if master asks A then B, that's a workflow)
  if (userMessages.length >= 3) {
    const flow = userMessages.slice(0, 3).map(m => {
      const lower = m.content.toLowerCase();
      if (lower.includes("search") || lower.includes("ค้นหา") || lower.includes("find")) return "search";
      if (lower.includes("code") || lower.includes("โค้ด") || lower.includes("program")) return "code";
      if (lower.includes("explain") || lower.includes("อธิบาย")) return "explain";
      if (lower.includes("fix") || lower.includes("แก้")) return "fix";
      if (lower.includes("create") || lower.includes("สร้าง")) return "create";
      return "chat";
    });
    const flowStr = flow.join("→");
    if (!flow.every(f => f === "chat")) {
      recordPattern(rawDb, `workflow:${flowStr}`, "workflow", 1);
      learnings.push(`Workflow detected: ${flowStr}`);
    }
  }

  return learnings;
}

/**
 * Spaced repetition: decay unused knowledge, boost used knowledge
 * Run periodically (e.g., daily or on startup)
 */
export function runSpacedRepetition(): { decayed: number; boosted: number } {
  const rawDb = getRawDb();
  let decayed = 0;
  let boosted = 0;

  try {
    // Decay: knowledge not used in 14+ days loses confidence
    const result1 = rawDb.prepare(`
      UPDATE soul_knowledge
      SET confidence = MAX(0.1, confidence - 0.05),
          updated_at = datetime('now')
      WHERE use_count > 0
        AND updated_at < datetime('now', '-14 days')
        AND confidence > 0.2
    `).run() as any;
    decayed = result1.changes || 0;

    // Boost: frequently used knowledge gains confidence
    const result2 = rawDb.prepare(`
      UPDATE soul_knowledge
      SET confidence = MIN(1.0, confidence + 0.03),
          updated_at = datetime('now')
      WHERE use_count >= 5
        AND confidence < 0.95
        AND updated_at > datetime('now', '-7 days')
    `).run() as any;
    boosted = result2.changes || 0;

    // Also decay learned patterns that haven't been seen in 30 days
    rawDb.prepare(`
      UPDATE soul_active_learning
      SET confidence = MAX(0.1, confidence - 0.1)
      WHERE last_seen < datetime('now', '-30 days')
        AND confidence > 0.2
    `).run();
  } catch { /* tables might not exist yet */ }

  return { decayed, boosted };
}

/**
 * Get learned patterns about master's behavior
 */
export function getMasterPatterns(): {
  topTopics: Array<{ pattern: string; frequency: number }>;
  activeHours: number[];
  activeDays: string[];
  questionStyle: string;
  commonWorkflows: string[];
} {
  ensureActiveLearningTable();
  const rawDb = getRawDb();

  // Top topics
  const topics = rawDb.prepare(`
    SELECT pattern, frequency FROM soul_active_learning
    WHERE category = 'topic' AND confidence >= 0.3
    ORDER BY frequency DESC LIMIT 10
  `).all() as any[];

  // Active hours
  const hours = rawDb.prepare(`
    SELECT pattern, frequency FROM soul_active_learning
    WHERE category = 'timing' AND pattern LIKE 'active_hour:%'
    ORDER BY frequency DESC LIMIT 5
  `).all() as any[];
  const activeHours = hours.map((h: any) => parseInt(h.pattern.split(":")[1]));

  // Active days
  const days = rawDb.prepare(`
    SELECT pattern, frequency FROM soul_active_learning
    WHERE category = 'timing' AND pattern LIKE 'active_day:%'
    ORDER BY frequency DESC LIMIT 3
  `).all() as any[];
  const activeDays = days.map((d: any) => d.pattern.split(":")[1]);

  // Question style
  const qTypes = rawDb.prepare(`
    SELECT pattern, frequency FROM soul_active_learning
    WHERE category = 'preference' AND pattern LIKE 'question_type:%'
    ORDER BY frequency DESC LIMIT 1
  `).all() as any[];
  const questionStyle = qTypes.length > 0
    ? qTypes[0].pattern.split(":")[1]
    : "general";

  // Common workflows
  const workflows = rawDb.prepare(`
    SELECT pattern, frequency FROM soul_active_learning
    WHERE category = 'workflow'
    ORDER BY frequency DESC LIMIT 3
  `).all() as any[];
  const commonWorkflows = workflows.map((w: any) => w.pattern.replace("workflow:", ""));

  return {
    topTopics: topics.map((t: any) => ({ pattern: t.pattern, frequency: t.frequency })),
    activeHours,
    activeDays,
    questionStyle,
    commonWorkflows,
  };
}

/**
 * Generate learning context for system prompt
 */
export function getLearningContext(): string | null {
  try {
    const patterns = getMasterPatterns();
    const parts: string[] = [];

    if (patterns.topTopics.length > 0) {
      parts.push(`Master's top interests: ${patterns.topTopics.slice(0, 5).map(t => t.pattern).join(", ")}`);
    }
    if (patterns.questionStyle !== "general") {
      parts.push(`Master tends to ask "${patterns.questionStyle}" type questions`);
    }
    if (patterns.commonWorkflows.length > 0) {
      parts.push(`Common workflows: ${patterns.commonWorkflows.join(", ")}`);
    }

    return parts.length > 0 ? `Active Learning insights:\n${parts.join("\n")}` : null;
  } catch {
    return null;
  }
}

// ─── Helpers ───

function recordPattern(rawDb: any, pattern: string, category: string, increment: number) {
  try {
    const existing = rawDb.prepare(
      "SELECT id, frequency FROM soul_active_learning WHERE pattern = ? AND category = ?"
    ).get(pattern, category) as any;

    if (existing) {
      rawDb.prepare(`
        UPDATE soul_active_learning
        SET frequency = frequency + ?, last_seen = datetime('now'),
            confidence = MIN(1.0, confidence + 0.05)
        WHERE id = ?
      `).run(increment, existing.id);
    } else {
      rawDb.prepare(`
        INSERT INTO soul_active_learning (pattern, frequency, category, confidence)
        VALUES (?, ?, ?, 0.5)
      `).run(pattern, increment, category);
    }
  } catch { /* ok */ }
}
