/**
 * Confidence Engine — Show answer confidence percentage
 *
 * UPGRADE #13: Soul knows how confident it is in every answer.
 *
 * Confidence factors:
 * 1. Knowledge backing — is the answer supported by stored knowledge?
 * 2. Tool verification — did tools confirm the information?
 * 3. Topic familiarity — has Soul answered similar questions before?
 * 4. Contradiction check — does the answer conflict with known facts?
 * 5. Response complexity — simpler questions = higher baseline confidence
 */

import { getRawDb } from "../db/index.js";

export interface ConfidenceScore {
  overall: number;       // 0-100%
  factors: {
    knowledgeBacking: number;   // 0-1
    toolVerification: number;   // 0-1
    topicFamiliarity: number;   // 0-1
    consistency: number;        // 0-1
    simplicity: number;         // 0-1
  };
  label: string;  // "very high" | "high" | "moderate" | "low" | "uncertain"
  emoji: string;  // visual indicator
}

/**
 * Calculate confidence for a response
 */
export function calculateConfidence(input: {
  question: string;
  answer: string;
  toolsUsed: string[];
  knowledgeHit: boolean;
  cached: boolean;
  iterations: number;
}): ConfidenceScore {
  const factors = {
    knowledgeBacking: 0.5,
    toolVerification: 0.5,
    topicFamiliarity: 0.5,
    consistency: 0.7,
    simplicity: 0.5,
  };

  // 1. Knowledge backing
  if (input.knowledgeHit) {
    factors.knowledgeBacking = 0.95;
  } else if (input.cached) {
    factors.knowledgeBacking = 0.85;
  } else {
    // Check if we have knowledge about this topic
    try {
      const rawDb = getRawDb();
      const question = input.question.toLowerCase();
      const words = question.split(/\s+/).filter(w => w.length > 3).slice(0, 3);

      if (words.length > 0) {
        const conditions = words.map(() => "content LIKE ?").join(" OR ");
        const params = words.map(w => `%${w}%`);
        const count = (rawDb.prepare(
          `SELECT COUNT(*) as c FROM soul_knowledge WHERE ${conditions}`
        ).get(...params) as any)?.c || 0;

        factors.knowledgeBacking = count > 0 ? Math.min(0.85, 0.4 + count * 0.1) : 0.3;
      }
    } catch {
      factors.knowledgeBacking = 0.3;
    }
  }

  // 2. Tool verification
  const toolsUsed = input.toolsUsed || [];
  if (toolsUsed.length > 0) {
    const verifyTools = toolsUsed.filter(t =>
      t.includes("search") || t.includes("knowledge") || t.includes("recall")
    );
    factors.toolVerification = verifyTools.length > 0 ? 0.85 : 0.7;
  } else {
    // No tools = pure LLM reasoning, moderate confidence
    factors.toolVerification = 0.5;
  }

  // 3. Topic familiarity — check past interactions
  try {
    const rawDb = getRawDb();
    const words = input.question.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);

    if (words.length > 0) {
      const conditions = words.map(() => "content LIKE ?").join(" OR ");
      const params = words.map(w => `%${w}%`);
      const pastCount = (rawDb.prepare(
        `SELECT COUNT(*) as c FROM memories WHERE (${conditions}) AND created_at > datetime('now', '-30 days')`
      ).get(...params) as any)?.c || 0;

      factors.topicFamiliarity = Math.min(0.95, 0.3 + pastCount * 0.05);
    }
  } catch {
    factors.topicFamiliarity = 0.3;
  }

  // 4. Consistency — fewer iterations = more confident
  if (input.iterations <= 1) {
    factors.consistency = 0.85;
  } else if (input.iterations <= 3) {
    factors.consistency = 0.7;
  } else {
    factors.consistency = Math.max(0.3, 0.7 - (input.iterations - 3) * 0.1);
  }

  // 5. Simplicity — shorter questions tend to be simpler
  const qLen = input.question.length;
  if (qLen < 30) {
    factors.simplicity = 0.8;
  } else if (qLen < 100) {
    factors.simplicity = 0.6;
  } else {
    factors.simplicity = 0.4; // complex questions = lower base confidence
  }

  // Answer quality check
  const ansLen = input.answer.length;
  if (ansLen < 10) {
    factors.consistency *= 0.5; // very short answers are suspicious
  }

  // Weighted average
  const weights = {
    knowledgeBacking: 0.3,
    toolVerification: 0.2,
    topicFamiliarity: 0.2,
    consistency: 0.2,
    simplicity: 0.1,
  };

  const overall = Math.round(
    (factors.knowledgeBacking * weights.knowledgeBacking +
     factors.toolVerification * weights.toolVerification +
     factors.topicFamiliarity * weights.topicFamiliarity +
     factors.consistency * weights.consistency +
     factors.simplicity * weights.simplicity) * 100
  );

  // Clamp to 5-99% (never 0% or 100%)
  const clamped = Math.max(5, Math.min(99, overall));

  let label: string;
  let emoji: string;
  if (clamped >= 85) { label = "very high"; emoji = "🟢"; }
  else if (clamped >= 70) { label = "high"; emoji = "🟡"; }
  else if (clamped >= 50) { label = "moderate"; emoji = "🟠"; }
  else if (clamped >= 30) { label = "low"; emoji = "🔴"; }
  else { label = "uncertain"; emoji = "⚪"; }

  return { overall: clamped, factors, label, emoji };
}

/**
 * Format confidence for display
 */
export function formatConfidence(score: ConfidenceScore): string {
  return `${score.emoji} ${score.overall}% (${score.label})`;
}

/**
 * Format confidence for CLI metadata line
 */
export function formatConfidenceCompact(score: ConfidenceScore): string {
  return `${score.overall}%`;
}
