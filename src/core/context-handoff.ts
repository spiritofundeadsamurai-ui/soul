/**
 * Context Handoff — Cross-AI context sharing
 *
 * UPGRADE #15: When switching from Soul to Claude (or vice versa),
 * Soul can export/import context so the other AI doesn't start from zero.
 *
 * Export format is a compact JSON with:
 * 1. Current conversation summary
 * 2. Key facts established
 * 3. Master's preferences
 * 4. Active tasks/goals
 * 5. Recent decisions made
 */

import { getRawDb } from "../db/index.js";

export interface ContextPacket {
  version: string;
  timestamp: string;
  from: string;  // "soul" | "claude" | "other"

  // Conversation context
  conversationSummary: string;
  keyFacts: string[];
  recentTopics: string[];

  // Master context
  masterPreferences: Record<string, string>;
  communicationStyle: string;

  // Active items
  activeTasks: string[];
  pendingQuestions: string[];

  // Metadata
  tokenEstimate: number;
}

/**
 * Export current context for handoff to another AI
 */
export function exportContext(sessionId?: string): ContextPacket {
  const rawDb = getRawDb();
  const packet: ContextPacket = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    from: "soul",
    conversationSummary: "",
    keyFacts: [],
    recentTopics: [],
    masterPreferences: {},
    communicationStyle: "",
    activeTasks: [],
    pendingQuestions: [],
    tokenEstimate: 0,
  };

  // 1. Get recent conversation summary
  if (sessionId) {
    try {
      const messages = rawDb.prepare(`
        SELECT role, content FROM soul_conversations
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(sessionId) as any[];

      if (messages.length > 0) {
        const summary = messages.reverse().map((m: any) =>
          `${m.role === "user" ? "User" : "Soul"}: ${m.content.substring(0, 150)}`
        ).join("\n");
        packet.conversationSummary = summary;
      }
    } catch { /* ok */ }
  }

  // 2. Get key facts from recent knowledge
  try {
    const knowledge = rawDb.prepare(`
      SELECT title, content FROM soul_knowledge
      WHERE confidence >= 0.6
      ORDER BY updated_at DESC
      LIMIT 10
    `).all() as any[];

    packet.keyFacts = knowledge.map((k: any) => `${k.title}: ${k.content.substring(0, 100)}`);
  } catch { /* ok */ }

  // 3. Get recent topics
  try {
    const topics = rawDb.prepare(`
      SELECT topics FROM soul_interaction_log
      WHERE created_at > datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT 20
    `).all() as any[];

    const topicSet = new Set<string>();
    for (const r of topics) {
      try {
        const t = JSON.parse(r.topics || "[]");
        for (const topic of t) if (topic && topic.length > 2) topicSet.add(topic);
      } catch { /* skip */ }
    }
    packet.recentTopics = [...topicSet].slice(0, 10);
  } catch { /* ok */ }

  // 4. Get master preferences
  try {
    const prefs = rawDb.prepare(`
      SELECT key, value FROM soul_master_profile
      WHERE confidence >= 0.5
    `).all() as any[];

    for (const p of prefs) {
      packet.masterPreferences[p.key] = p.value;
    }
  } catch { /* ok */ }

  // 5. Get active tasks
  try {
    const tasks = rawDb.prepare(`
      SELECT content FROM memories
      WHERE type = 'task' AND tags LIKE '%active%'
      ORDER BY created_at DESC
      LIMIT 5
    `).all() as any[];

    packet.activeTasks = tasks.map((t: any) => t.content.substring(0, 100));
  } catch { /* ok */ }

  // 6. Get unresolved questions
  try {
    const questions = rawDb.prepare(`
      SELECT content FROM soul_dreams
      WHERE type = 'question' AND was_shared = 0
      ORDER BY created_at DESC
      LIMIT 3
    `).all() as any[];

    packet.pendingQuestions = questions.map((q: any) => q.content);
  } catch { /* ok */ }

  // Estimate tokens
  const jsonStr = JSON.stringify(packet);
  packet.tokenEstimate = Math.ceil(jsonStr.length / 4);

  return packet;
}

/**
 * Import context from another AI
 */
export function importContext(packet: ContextPacket): { imported: number; details: string[] } {
  const rawDb = getRawDb();
  const details: string[] = [];
  let imported = 0;

  // Import key facts as knowledge
  if (packet.keyFacts.length > 0) {
    try {
      for (const fact of packet.keyFacts.slice(0, 10)) {
        rawDb.prepare(`
          INSERT INTO memories (content, type, tags, source, created_at)
          VALUES (?, 'knowledge', '["context-handoff", "imported"]', ?, datetime('now'))
        `).run(`[Handoff from ${packet.from}] ${fact}`, `context-handoff:${packet.from}`);
        imported++;
      }
      details.push(`Imported ${packet.keyFacts.length} key facts`);
    } catch { /* ok */ }
  }

  // Import conversation context
  if (packet.conversationSummary) {
    try {
      rawDb.prepare(`
        INSERT INTO memories (content, type, tags, source, created_at)
        VALUES (?, 'conversation', '["context-handoff", "summary"]', ?, datetime('now'))
      `).run(
        `[Context from ${packet.from}] ${packet.conversationSummary.substring(0, 500)}`,
        `context-handoff:${packet.from}`
      );
      imported++;
      details.push("Imported conversation summary");
    } catch { /* ok */ }
  }

  // Import master preferences (update if higher confidence)
  if (Object.keys(packet.masterPreferences).length > 0) {
    try {
      for (const [key, value] of Object.entries(packet.masterPreferences)) {
        rawDb.prepare(`
          INSERT INTO soul_master_profile (key, value, confidence, evidence_count)
          VALUES (?, ?, 0.4, 1)
          ON CONFLICT(key) DO UPDATE SET
            evidence_count = evidence_count + 1,
            updated_at = datetime('now')
        `).run(key, value);
        imported++;
      }
      details.push(`Imported ${Object.keys(packet.masterPreferences).length} preferences`);
    } catch { /* ok */ }
  }

  return { imported, details };
}

/**
 * Format context packet as compact text (for pasting into other AIs)
 */
export function formatContextForExport(packet: ContextPacket): string {
  const lines: string[] = [
    `--- Soul Context Handoff (${packet.timestamp}) ---`,
    "",
  ];

  if (packet.conversationSummary) {
    lines.push("## Recent Conversation:");
    lines.push(packet.conversationSummary);
    lines.push("");
  }

  if (packet.keyFacts.length > 0) {
    lines.push("## Key Facts:");
    for (const f of packet.keyFacts) lines.push(`- ${f}`);
    lines.push("");
  }

  if (packet.recentTopics.length > 0) {
    lines.push(`## Recent Topics: ${packet.recentTopics.join(", ")}`);
    lines.push("");
  }

  if (Object.keys(packet.masterPreferences).length > 0) {
    lines.push("## Master Preferences:");
    for (const [k, v] of Object.entries(packet.masterPreferences)) {
      lines.push(`- ${k}: ${v}`);
    }
    lines.push("");
  }

  if (packet.activeTasks.length > 0) {
    lines.push("## Active Tasks:");
    for (const t of packet.activeTasks) lines.push(`- ${t}`);
    lines.push("");
  }

  lines.push(`--- End Soul Context (~${packet.tokenEstimate} tokens) ---`);
  return lines.join("\n");
}
