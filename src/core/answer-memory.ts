/**
 * Answer Memory — Remember good answers for reuse
 *
 * UPGRADE #24: Soul remembers its best answers:
 * 1. When master gives positive feedback, store the Q&A pair
 * 2. When a similar question comes up, reference the good answer
 * 3. Build a personal FAQ from repeated questions
 * 4. Track which answer patterns work best for this master
 */

import { getRawDb } from "../db/index.js";

export interface AnswerEntry {
  id: number;
  questionPattern: string;
  answer: string;
  quality: number;
  useCount: number;
  lastUsed: string;
  createdAt: string;
}

function ensureAnswerMemoryTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_answer_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_pattern TEXT NOT NULL,
      question_hash TEXT NOT NULL,
      answer TEXT NOT NULL,
      quality REAL NOT NULL DEFAULT 0.7,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_sam_hash ON soul_answer_memory(question_hash)`);
}

/**
 * Store a good answer for future reference
 */
export function storeGoodAnswer(question: string, answer: string, quality?: number): AnswerEntry | null {
  ensureAnswerMemoryTable();
  const rawDb = getRawDb();

  // Don't store very short or very long answers
  if (answer.length < 20 || answer.length > 5000) return null;

  const hash = hashQuestion(question);

  // Check for existing similar answer
  const existing = rawDb.prepare(
    "SELECT id FROM soul_answer_memory WHERE question_hash = ?"
  ).get(hash) as any;

  if (existing) {
    // Update quality if better
    rawDb.prepare(`
      UPDATE soul_answer_memory
      SET quality = MAX(quality, ?), use_count = use_count + 1, last_used = datetime('now')
      WHERE id = ?
    `).run(quality || 0.7, existing.id);
    return null;
  }

  // Store new answer
  try {
    const row = rawDb.prepare(`
      INSERT INTO soul_answer_memory (question_pattern, question_hash, answer, quality)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(
      question.substring(0, 200),
      hash,
      answer.substring(0, 5000),
      quality || 0.7
    ) as any;

    return row ? mapAnswer(row) : null;
  } catch {
    return null;
  }
}

/**
 * Find a good previous answer for a similar question
 */
export function findSimilarAnswer(question: string): AnswerEntry | null {
  ensureAnswerMemoryTable();
  const rawDb = getRawDb();

  // First try exact hash match
  const hash = hashQuestion(question);
  const exact = rawDb.prepare(
    "SELECT * FROM soul_answer_memory WHERE question_hash = ? AND quality >= 0.6 ORDER BY quality DESC LIMIT 1"
  ).get(hash) as any;

  if (exact) {
    // Boost use count
    rawDb.prepare("UPDATE soul_answer_memory SET use_count = use_count + 1, last_used = datetime('now') WHERE id = ?").run(exact.id);
    return mapAnswer(exact);
  }

  // Then try keyword matching
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
  if (words.length === 0) return null;

  const conditions = words.map(() => "question_pattern LIKE ?").join(" AND ");
  const params = words.map(w => `%${w}%`);

  try {
    const match = rawDb.prepare(`
      SELECT * FROM soul_answer_memory
      WHERE ${conditions} AND quality >= 0.6
      ORDER BY quality DESC, use_count DESC
      LIMIT 1
    `).get(...params) as any;

    if (match) {
      rawDb.prepare("UPDATE soul_answer_memory SET use_count = use_count + 1, last_used = datetime('now') WHERE id = ?").run(match.id);
      return mapAnswer(match);
    }
  } catch { /* ok */ }

  return null;
}

/**
 * Get FAQ — most asked questions with their best answers
 */
export function getFAQ(limit = 10): AnswerEntry[] {
  ensureAnswerMemoryTable();
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT * FROM soul_answer_memory
      WHERE quality >= 0.6
      ORDER BY use_count DESC, quality DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(mapAnswer);
  } catch {
    return [];
  }
}

/**
 * Rate an answer (from master feedback)
 */
export function rateAnswer(questionPattern: string, rating: number) {
  ensureAnswerMemoryTable();
  const rawDb = getRawDb();

  try {
    // Find the most recent answer matching this question
    const words = questionPattern.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    if (words.length === 0) return;

    const conditions = words.map(() => "question_pattern LIKE ?").join(" AND ");
    const params = words.map(w => `%${w}%`);

    rawDb.prepare(`
      UPDATE soul_answer_memory
      SET quality = ?, last_used = datetime('now')
      WHERE id IN (
        SELECT id FROM soul_answer_memory
        WHERE ${conditions}
        ORDER BY created_at DESC LIMIT 1
      )
    `).run(Math.min(1, Math.max(0, rating)), ...params);
  } catch { /* ok */ }
}

/**
 * Generate answer memory context for system prompt
 */
export function getAnswerContext(question: string): string | null {
  const similar = findSimilarAnswer(question);
  if (!similar) return null;

  return `Previous good answer for similar question (quality: ${Math.round(similar.quality * 100)}%):\nQ: ${similar.questionPattern}\nA: ${similar.answer.substring(0, 300)}\n\nUse this as reference but adapt to current question.`;
}

// ─── Helpers ───

function hashQuestion(question: string): string {
  // Normalize: lowercase, remove common words, sort remaining
  const words = question.toLowerCase()
    .replace(/[^\w\s\u0E00-\u0E7F]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2)
    .sort();
  const normalized = words.join(" ");

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function mapAnswer(row: any): AnswerEntry {
  return {
    id: row.id,
    questionPattern: row.question_pattern,
    answer: row.answer,
    quality: row.quality,
    useCount: row.use_count,
    lastUsed: row.last_used,
    createdAt: row.created_at,
  };
}
