/**
 * Response Quality Scoring — Soul rates its own answers
 *
 * UPGRADE #21: After responding, Soul evaluates quality:
 * 1. Did the answer actually address the question?
 * 2. Was the length appropriate?
 * 3. Was it accurate (based on tool results)?
 * 4. Track quality over time to improve
 */

import { getRawDb } from "../db/index.js";

export interface QualityScore {
  relevance: number;     // 0-1: did it answer the question?
  completeness: number;  // 0-1: was the answer complete?
  conciseness: number;   // 0-1: was it appropriately brief?
  overall: number;       // 0-1: weighted average
}

function ensureQualityTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_response_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_hash TEXT NOT NULL,
      relevance REAL NOT NULL,
      completeness REAL NOT NULL,
      conciseness REAL NOT NULL,
      overall REAL NOT NULL,
      question_length INTEGER,
      answer_length INTEGER,
      tools_used INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Score response quality (fast, no LLM calls)
 */
export function scoreResponseQuality(
  question: string,
  answer: string,
  toolsUsed: string[],
): QualityScore {
  // Relevance: check keyword overlap between question and answer
  const qWords = new Set(question.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const aWords = new Set(answer.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let overlap = 0;
  for (const w of qWords) {
    if (aWords.has(w)) overlap++;
  }
  const relevance = qWords.size > 0 ? Math.min(1, overlap / Math.min(qWords.size, 5)) : 0.5;

  // Completeness: longer questions should get longer answers
  const expectedMinLength = Math.min(question.length * 2, 500);
  const completeness = answer.length >= expectedMinLength
    ? Math.min(1, 0.7 + (answer.length / (expectedMinLength * 3)) * 0.3)
    : Math.max(0.3, answer.length / expectedMinLength);

  // Conciseness: penalize overly long answers for short questions
  let conciseness = 0.7;
  const ratio = answer.length / Math.max(question.length, 10);
  if (ratio < 5) conciseness = 0.9;       // nicely concise
  else if (ratio < 15) conciseness = 0.7;  // moderate
  else if (ratio < 30) conciseness = 0.5;  // a bit long
  else conciseness = 0.3;                  // way too long

  // Tool usage bonus: using tools means more effort = likely better
  const toolBonus = toolsUsed.length > 0 ? 0.1 : 0;

  const overall = Math.min(1, (relevance * 0.4 + completeness * 0.3 + conciseness * 0.3) + toolBonus);

  const score: QualityScore = {
    relevance: Math.round(relevance * 100) / 100,
    completeness: Math.round(completeness * 100) / 100,
    conciseness: Math.round(conciseness * 100) / 100,
    overall: Math.round(overall * 100) / 100,
  };

  // Store score
  ensureQualityTable();
  const rawDb = getRawDb();
  try {
    const hash = simpleHash(question);
    rawDb.prepare(`
      INSERT INTO soul_response_quality (question_hash, relevance, completeness, conciseness, overall, question_length, answer_length, tools_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hash, score.relevance, score.completeness, score.conciseness, score.overall, question.length, answer.length, toolsUsed.length);
  } catch { /* ok */ }

  return score;
}

/**
 * Get quality trends over time
 */
export function getQualityTrends(): {
  avgOverall: number;
  avgRelevance: number;
  avgCompleteness: number;
  avgConciseness: number;
  totalScored: number;
  trend: "improving" | "declining" | "stable";
} {
  ensureQualityTable();
  const rawDb = getRawDb();

  try {
    const overall = rawDb.prepare(`
      SELECT AVG(overall) as avg_overall, AVG(relevance) as avg_rel,
             AVG(completeness) as avg_comp, AVG(conciseness) as avg_conc,
             COUNT(*) as total
      FROM soul_response_quality
    `).get() as any;

    // Compare recent (last 20) vs older
    const recent = rawDb.prepare(`
      SELECT AVG(overall) as avg FROM soul_response_quality
      ORDER BY created_at DESC LIMIT 20
    `).get() as any;

    const older = rawDb.prepare(`
      SELECT AVG(overall) as avg FROM soul_response_quality
      ORDER BY created_at ASC LIMIT 20
    `).get() as any;

    let trend: "improving" | "declining" | "stable" = "stable";
    if (recent?.avg && older?.avg) {
      const diff = recent.avg - older.avg;
      if (diff > 0.05) trend = "improving";
      else if (diff < -0.05) trend = "declining";
    }

    return {
      avgOverall: Math.round((overall?.avg_overall || 0) * 100) / 100,
      avgRelevance: Math.round((overall?.avg_rel || 0) * 100) / 100,
      avgCompleteness: Math.round((overall?.avg_comp || 0) * 100) / 100,
      avgConciseness: Math.round((overall?.avg_conc || 0) * 100) / 100,
      totalScored: overall?.total || 0,
      trend,
    };
  } catch {
    return { avgOverall: 0, avgRelevance: 0, avgCompleteness: 0, avgConciseness: 0, totalScored: 0, trend: "stable" };
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
