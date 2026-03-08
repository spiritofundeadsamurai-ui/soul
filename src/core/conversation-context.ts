/**
 * Conversation Context — Track topics and provide continuity
 *
 * 1. Log conversation topics
 * 2. Track what was discussed when
 * 3. Provide conversation summaries
 * 4. Detect topic switches
 * 5. Recall previous conversations on same topic
 */

import { getRawDb } from "../db/index.js";
import { search } from "../memory/memory-engine.js";

export interface ConversationLog {
  id: number;
  sessionId: string;
  topic: string;
  summary: string;
  keyPoints: string;
  decisions: string;
  actionItems: string;
  duration: number;
  createdAt: string;
}

function ensureConversationTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      action_items TEXT NOT NULL DEFAULT '[]',
      duration INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function logConversation(input: {
  sessionId: string;
  topic: string;
  summary: string;
  keyPoints?: string[];
  decisions?: string[];
  actionItems?: string[];
  duration?: number;
}): ConversationLog {
  ensureConversationTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    `INSERT INTO soul_conversations (session_id, topic, summary, key_points, decisions, action_items, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.sessionId,
    input.topic,
    input.summary,
    JSON.stringify(input.keyPoints || []),
    JSON.stringify(input.decisions || []),
    JSON.stringify(input.actionItems || []),
    input.duration || 0
  ) as any;

  return mapConversation(row);
}

export function getConversationHistory(topic?: string, limit = 20): ConversationLog[] {
  ensureConversationTable();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_conversations WHERE 1=1";
  const params: any[] = [];

  if (topic) {
    sql += " AND (topic LIKE ? OR summary LIKE ?)";
    params.push(`%${topic}%`, `%${topic}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapConversation);
}

export async function recallContext(topic: string): Promise<{
  conversations: ConversationLog[];
  relatedMemories: any[];
}> {
  ensureConversationTable();

  const conversations = getConversationHistory(topic, 5);
  const relatedMemories = await search(topic, 5);

  return { conversations, relatedMemories };
}

export function getConversationStats(): {
  total: number;
  uniqueTopics: number;
  topTopics: Array<{ topic: string; count: number }>;
  recentSessions: number;
} {
  ensureConversationTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_conversations").get() as any)?.c || 0;
  const uniqueTopics = (rawDb.prepare("SELECT COUNT(DISTINCT topic) as c FROM soul_conversations").get() as any)?.c || 0;

  const topTopics = rawDb.prepare(
    "SELECT topic, COUNT(*) as count FROM soul_conversations GROUP BY topic ORDER BY count DESC LIMIT 10"
  ).all() as any[];

  const recentSessions = (rawDb.prepare(
    "SELECT COUNT(DISTINCT session_id) as c FROM soul_conversations WHERE created_at >= datetime('now', '-7 days')"
  ).get() as any)?.c || 0;

  return { total, uniqueTopics, topTopics, recentSessions };
}

function mapConversation(row: any): ConversationLog {
  return {
    id: row.id, sessionId: row.session_id, topic: row.topic,
    summary: row.summary, keyPoints: row.key_points,
    decisions: row.decisions, actionItems: row.action_items,
    duration: row.duration, createdAt: row.created_at,
  };
}
