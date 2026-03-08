/**
 * Feedback Loop — Learn from master's explicit feedback
 *
 * Inspired by: RLHF (Reinforcement Learning from Human Feedback)
 *
 * What this does:
 * 1. Master can rate Soul's responses (good/bad/specific feedback)
 * 2. Soul learns what master likes and dislikes
 * 3. Patterns emerge: "master prefers short answers", "master likes examples"
 * 4. Auto-adjusts behavior based on accumulated feedback
 * 5. Honest tracking — shows where Soul is improving and where it's not
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";
import { addLearning, findSimilarLearning, reinforceLearning } from "../memory/learning.js";

export interface Feedback {
  id: number;
  context: string;       // What was Soul doing?
  rating: number;        // 1-5
  category: string;      // accuracy, helpfulness, tone, speed, creativity
  comment: string;       // Master's specific feedback
  actionTaken: string;   // What Soul will do differently
  createdAt: string;
}

export interface FeedbackPattern {
  category: string;
  avgRating: number;
  totalFeedback: number;
  trend: "improving" | "declining" | "stable";
  topIssues: string[];
  topPraises: string[];
}

function ensureFeedbackTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context TEXT NOT NULL,
      rating INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      comment TEXT NOT NULL DEFAULT '',
      action_taken TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Record feedback from master
 */
export async function recordFeedback(input: {
  context: string;
  rating: number;
  category?: string;
  comment?: string;
}): Promise<{ feedback: Feedback; insight: string }> {
  ensureFeedbackTable();
  const rawDb = getRawDb();

  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const category = input.category || "general";

  // Determine action based on feedback
  let actionTaken = "";
  if (rating <= 2) {
    actionTaken = `Will improve ${category}: "${input.comment || "needs improvement"}"`;
  } else if (rating >= 4) {
    actionTaken = `Continue this approach for ${category}`;
  } else {
    actionTaken = `Noted for ${category} — room for improvement`;
  }

  const row = rawDb.prepare(
    `INSERT INTO soul_feedback (context, rating, category, comment, action_taken)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.context,
    rating,
    category,
    input.comment || "",
    actionTaken
  ) as any;

  // Learn from feedback
  const learningKey = `feedback:${category}:${rating <= 2 ? "avoid" : "prefer"}`;
  const insight = rating <= 2
    ? `Master dislikes: ${input.comment || input.context}. Category: ${category}. Avoid this pattern.`
    : `Master likes: ${input.comment || input.context}. Category: ${category}. Continue this approach.`;

  const existing = await findSimilarLearning(learningKey);
  if (existing) {
    await reinforceLearning(existing.id);
  } else {
    await addLearning(learningKey, insight, []);
  }

  await remember({
    content: `[Feedback] Rating: ${rating}/5 | Category: ${category} | ${input.comment || "no comment"} | Action: ${actionTaken}`,
    type: "learning",
    tags: ["feedback", category, rating <= 2 ? "negative" : rating >= 4 ? "positive" : "neutral"],
    source: "feedback-loop",
  });

  return { feedback: mapFeedback(row), insight };
}

/**
 * Get feedback patterns — what's working, what's not
 */
export function getFeedbackPatterns(): FeedbackPattern[] {
  ensureFeedbackTable();
  const rawDb = getRawDb();

  const categories = rawDb.prepare(
    `SELECT category, COUNT(*) as count, ROUND(AVG(rating), 2) as avg_rating
     FROM soul_feedback GROUP BY category ORDER BY count DESC`
  ).all() as any[];

  return categories.map(cat => {
    // Get recent trend (last 10 vs previous 10)
    const recent = rawDb.prepare(
      `SELECT AVG(rating) as avg FROM (SELECT rating FROM soul_feedback WHERE category = ? ORDER BY created_at DESC LIMIT 10)`
    ).get(cat.category) as any;
    const older = rawDb.prepare(
      `SELECT AVG(rating) as avg FROM (SELECT rating FROM soul_feedback WHERE category = ? ORDER BY created_at DESC LIMIT 10 OFFSET 10)`
    ).get(cat.category) as any;

    let trend: "improving" | "declining" | "stable" = "stable";
    if (recent?.avg && older?.avg) {
      if (recent.avg > older.avg + 0.3) trend = "improving";
      else if (recent.avg < older.avg - 0.3) trend = "declining";
    }

    // Get top issues (low ratings)
    const issues = rawDb.prepare(
      `SELECT comment FROM soul_feedback WHERE category = ? AND rating <= 2 AND comment != '' ORDER BY created_at DESC LIMIT 5`
    ).all(cat.category) as any[];

    // Get top praises (high ratings)
    const praises = rawDb.prepare(
      `SELECT comment FROM soul_feedback WHERE category = ? AND rating >= 4 AND comment != '' ORDER BY created_at DESC LIMIT 5`
    ).all(cat.category) as any[];

    return {
      category: cat.category,
      avgRating: cat.avg_rating,
      totalFeedback: cat.count,
      trend,
      topIssues: issues.map((i: any) => i.comment),
      topPraises: praises.map((p: any) => p.comment),
    };
  });
}

/**
 * Get feedback stats summary
 */
export function getFeedbackStats(): {
  totalFeedback: number;
  avgRating: number;
  positiveRate: number;
  negativeRate: number;
  improvingAreas: string[];
  decliningAreas: string[];
  recentFeedback: Feedback[];
} {
  ensureFeedbackTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_feedback").get() as any)?.c || 0;
  const avg = (rawDb.prepare("SELECT AVG(rating) as a FROM soul_feedback").get() as any)?.a || 0;
  const positive = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_feedback WHERE rating >= 4").get() as any)?.c || 0;
  const negative = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_feedback WHERE rating <= 2").get() as any)?.c || 0;

  const patterns = getFeedbackPatterns();
  const improving = patterns.filter(p => p.trend === "improving").map(p => p.category);
  const declining = patterns.filter(p => p.trend === "declining").map(p => p.category);

  const recent = (rawDb.prepare(
    "SELECT * FROM soul_feedback ORDER BY created_at DESC LIMIT 5"
  ).all() as any[]).map(mapFeedback);

  return {
    totalFeedback: total,
    avgRating: Math.round(avg * 100) / 100,
    positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
    negativeRate: total > 0 ? Math.round((negative / total) * 100) : 0,
    improvingAreas: improving,
    decliningAreas: declining,
    recentFeedback: recent,
  };
}

/**
 * Get learning from feedback — what master prefers in each category
 */
export function getFeedbackLearnings(): string {
  const patterns = getFeedbackPatterns();
  if (patterns.length === 0) return "No feedback yet. Ask master to use soul_feedback to rate responses.";

  let result = "=== What I've Learned from Feedback ===\n\n";

  for (const p of patterns) {
    const stars = "★".repeat(Math.round(p.avgRating)) + "☆".repeat(5 - Math.round(p.avgRating));
    const trendIcon = p.trend === "improving" ? "↑" : p.trend === "declining" ? "↓" : "→";

    result += `${p.category} ${stars} (${p.avgRating.toFixed(1)}/5) ${trendIcon} ${p.trend}\n`;

    if (p.topPraises.length > 0) {
      result += `  Master likes: ${p.topPraises.slice(0, 2).join("; ")}\n`;
    }
    if (p.topIssues.length > 0) {
      result += `  Must improve: ${p.topIssues.slice(0, 2).join("; ")}\n`;
    }
    result += `\n`;
  }

  return result;
}

function mapFeedback(row: any): Feedback {
  return {
    id: row.id,
    context: row.context,
    rating: row.rating,
    category: row.category,
    comment: row.comment,
    actionTaken: row.action_taken,
    createdAt: row.created_at,
  };
}
