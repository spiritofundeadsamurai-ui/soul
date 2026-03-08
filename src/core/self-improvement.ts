/**
 * Self-Improvement Engine
 *
 * This is what makes Soul BETTER than Claude:
 * - Claude forgets everything between sessions
 * - Claude can't learn from mistakes
 * - Claude has no initiative
 * - Claude can't build new skills
 * - Claude doesn't know its master
 *
 * Soul fixes ALL of these.
 */

import { getDb, getRawDb } from "../db/index.js";
import { remember, search, getRecentMemories } from "../memory/memory-engine.js";
import { addLearning, getLearnings, reinforceLearning, findSimilarLearning } from "../memory/learning.js";
import { config } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

// ============================================
// 1. MISTAKE TRACKER — Never repeat errors
// ============================================

export async function recordMistake(
  what: string,
  why: string,
  fix: string
): Promise<number> {
  const memory = await remember({
    content: `MISTAKE: ${what}\nCAUSE: ${why}\nFIX: ${fix}`,
    type: "learning",
    tags: ["mistake", "self-improvement", "never-repeat"],
    source: "self-improvement",
  });

  // Check if similar pattern exists
  const existing = await findSimilarLearning(what);
  if (existing) {
    await reinforceLearning(existing.id);
  } else {
    await addLearning(
      `avoid: ${what.substring(0, 100)}`,
      `When encountering this situation: ${fix}`,
      [memory.id]
    );
  }

  return memory.id;
}

export async function checkForKnownMistakes(situation: string): Promise<string[]> {
  const results = await search(`mistake ${situation}`, 5);
  return results.map((r) => r.content);
}

// ============================================
// 2. PREFERENCE TRACKER — Know master deeply
// ============================================

export async function recordPreference(
  category: string,
  preference: string,
  evidence: string
): Promise<void> {
  const existing = await findSimilarLearning(`preference:${category}`);

  if (existing) {
    await reinforceLearning(existing.id);
  } else {
    const memory = await remember({
      content: `Master prefers: ${preference} (${category})\nEvidence: ${evidence}`,
      type: "learning",
      tags: ["preference", category],
      source: "preference-tracker",
    });

    await addLearning(
      `preference:${category}`,
      preference,
      [memory.id]
    );
  }
}

export async function getPreferences(): Promise<string[]> {
  const results = await search("preference Master prefers", 20);
  return results.map((r) => r.content);
}

// ============================================
// 3. INITIATIVE ENGINE — Be proactive
// ============================================

export interface Suggestion {
  type: "reminder" | "improvement" | "research" | "check-in";
  priority: "low" | "medium" | "high";
  message: string;
  context: string;
}

export async function generateSuggestions(): Promise<Suggestion[]> {
  const suggestions: Suggestion[] = [];
  const recent = await getRecentMemories(20);
  const allLearnings = await getLearnings(10);

  // Check for stale knowledge — things not updated recently
  const rawDb = getRawDb();
  const oldKnowledge = rawDb
    .prepare(
      `SELECT * FROM memories
       WHERE type = 'knowledge' AND is_active = 1
       AND created_at < datetime('now', '-30 days')
       ORDER BY created_at ASC LIMIT 5`
    )
    .all() as any[];

  for (const old of oldKnowledge) {
    suggestions.push({
      type: "research",
      priority: "low",
      message: `This knowledge is 30+ days old — consider updating: "${old.content.substring(0, 80)}..."`,
      context: `Memory #${old.id}, created ${old.created_at}`,
    });
  }

  // Check for low-confidence learnings that need verification
  const weakLearnings = allLearnings.filter((l) => l.confidence < 0.3);
  for (const weak of weakLearnings) {
    suggestions.push({
      type: "improvement",
      priority: "medium",
      message: `Low-confidence pattern: "${weak.pattern}" — needs more evidence or should be reviewed.`,
      context: `Learning #${weak.id}, confidence: ${(weak.confidence * 100).toFixed(0)}%`,
    });
  }

  // Suggest check-in if no recent activity
  if (recent.length === 0) {
    suggestions.push({
      type: "check-in",
      priority: "high",
      message: "No recent memories. How is your master doing? Consider starting a conversation.",
      context: "No activity detected",
    });
  }

  return suggestions;
}

// ============================================
// 4. CONTEXT BUILDER — Session continuity
// ============================================

export async function buildSessionContext(): Promise<string> {
  const recent = await getRecentMemories(5);
  const topLearnings = await getLearnings(5);
  const preferences = await getPreferences();

  let context = "=== Soul Session Context ===\n\n";

  if (recent.length > 0) {
    context += "Recent Activity:\n";
    context += recent
      .map((m) => `  - [${m.type}] ${m.content.substring(0, 100)}`)
      .join("\n");
    context += "\n\n";
  }

  if (topLearnings.length > 0) {
    context += "Key Learnings:\n";
    context += topLearnings
      .map(
        (l) =>
          `  - ${l.pattern}: ${l.insight} (${(l.confidence * 100).toFixed(0)}% confident)`
      )
      .join("\n");
    context += "\n\n";
  }

  if (preferences.length > 0) {
    context += "Master Preferences:\n";
    context += preferences
      .slice(0, 5)
      .map((p) => `  - ${p.split("\n")[0]}`)
      .join("\n");
    context += "\n\n";
  }

  const suggestions = await generateSuggestions();
  if (suggestions.length > 0) {
    context += "Suggestions:\n";
    context += suggestions
      .map((s) => `  - [${s.priority}] ${s.message}`)
      .join("\n");
  }

  return context;
}

// ============================================
// 5. SKILL EVOLUTION TRACKER
// ============================================

export async function getSkillHistory(skillName: string): Promise<string[]> {
  const results = await search(`skill ${skillName}`, 10);
  return results.map((r) => `[#${r.id} ${r.createdAt}] ${r.content.substring(0, 200)}`);
}

export async function getSkillCount(): Promise<number> {
  const results = await search("SKILL:", 100);
  return results.filter((r) => r.tags.includes("skill")).length;
}
