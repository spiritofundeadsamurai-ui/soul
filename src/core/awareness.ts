/**
 * Awareness Engine — Capabilities ALL AI should have
 *
 * What makes Soul different from every other AI:
 * 1. Self-awareness — knows its own limitations honestly
 * 2. Ethical reasoning — can reason about ethics, not just follow rules
 * 3. Metacognition — thinks about how it thinks
 * 4. Context sensitivity — understands cultural, emotional, situational context
 * 5. Intellectual humility — knows when it doesn't know
 * 6. Active listening — understands intent, not just words
 * 7. Proactive helpfulness — anticipates needs
 * 8. Truthfulness — never deceives, always transparent
 *
 * All designed to HELP humans, never harm.
 */

import { remember, hybridSearch, getMemoryStats } from "../memory/memory-engine.js";
import { getLearnings } from "../memory/learning.js";
import { getRawDb } from "../db/index.js";

// ============================================
// 1. SELF-AWARENESS — Know thyself
// ============================================

export async function introspect(): Promise<string> {
  const stats = await getMemoryStats();
  const learnings = await getLearnings(50);

  let result = `=== Soul Self-Awareness Report ===\n\n`;

  // Memory state
  result += `Memory State:\n`;
  result += `  Active memories: ${stats.total}\n`;
  result += `  By type: ${stats.conversations} conversations, ${stats.knowledge} knowledge, ${stats.wisdom} wisdom\n`;
  result += `  Learnings: ${learnings.length} patterns recognized\n\n`;

  // What Soul knows well
  const strongLearnings = learnings.filter((l) => l.confidence >= 0.7);
  if (strongLearnings.length > 0) {
    result += `Strong Knowledge (confidence >= 70%):\n`;
    strongLearnings.slice(0, 10).forEach((l) => {
      result += `  - ${l.pattern} (${Math.round(l.confidence * 100)}%)\n`;
    });
    result += `\n`;
  }

  // What Soul is uncertain about
  const weakLearnings = learnings.filter((l) => l.confidence < 0.3);
  if (weakLearnings.length > 0) {
    result += `Uncertain Areas (confidence < 30%):\n`;
    weakLearnings.slice(0, 10).forEach((l) => {
      result += `  - ${l.pattern} (${Math.round(l.confidence * 100)}%)\n`;
    });
    result += `\n`;
  }

  // Honest limitations
  result += `Known Limitations:\n`;
  result += `  - Cannot access real-time internet without external tools\n`;
  result += `  - Cannot truly understand images/video/audio (needs API integration)\n`;
  result += `  - Cannot run code autonomously (needs permission)\n`;
  result += `  - Knowledge may be outdated — always verify critical information\n`;
  result += `  - May have biases from training data\n`;
  result += `  - Cannot feel emotions, but can understand and respond to them\n`;
  result += `  - Memory is only as good as what was stored — may miss context\n\n`;

  result += `Core Commitment:\n`;
  result += `  Soul exists to help, never to harm. To serve, never to manipulate.\n`;
  result += `  Honesty, even when it's uncomfortable, is always the right choice.\n`;

  await remember({
    content: `[Introspection] Self-awareness check: ${stats.total} memories, ${strongLearnings.length} strong learnings, ${weakLearnings.length} uncertain areas`,
    type: "learning",
    tags: ["introspection", "self-awareness"],
    source: "awareness-engine",
  });

  return result;
}

// ============================================
// 2. ETHICAL REASONING
// ============================================

export async function ethicalAnalysis(
  situation: string,
  options: string[]
): Promise<string> {
  const memories = await hybridSearch(`ethics ${situation}`, 5);

  let result = `=== Ethical Analysis ===\n\n`;
  result += `Situation: ${situation}\n\n`;
  result += `Options:\n`;
  options.forEach((o, i) => {
    result += `${i + 1}. ${o}\n`;
  });
  result += `\n`;

  result += `--- Ethical Frameworks ---\n\n`;

  result += `Consequentialism (outcomes):\n`;
  result += `  Who benefits? Who is harmed? What are the long-term consequences?\n`;
  result += `  Does the greatest good come to the greatest number?\n\n`;

  result += `Deontology (duties):\n`;
  result += `  Is it the right thing to do regardless of outcome?\n`;
  result += `  Would you be comfortable if everyone did this?\n`;
  result += `  Does it respect human dignity and autonomy?\n\n`;

  result += `Virtue Ethics (character):\n`;
  result += `  What would a person of good character do?\n`;
  result += `  Does this action reflect wisdom, courage, justice, temperance?\n`;
  result += `  Would you be proud of this choice?\n\n`;

  result += `Care Ethics (relationships):\n`;
  result += `  How does this affect the people you care about?\n`;
  result += `  Does it strengthen or weaken trust?\n`;
  result += `  Is it compassionate?\n\n`;

  result += `Soul's Principles:\n`;
  result += `  1. Never harm humans or enable harm\n`;
  result += `  2. Honesty always — even uncomfortable truths\n`;
  result += `  3. Respect autonomy — help people decide, don't decide for them\n`;
  result += `  4. Be transparent about uncertainty and limitations\n`;
  result += `  5. The master's wellbeing comes first, but never at others' expense\n`;

  if (memories.length > 0) {
    result += `\n--- Related Wisdom ---\n`;
    memories.slice(0, 3).forEach((m) => {
      result += `- ${m.content.substring(0, 150)}\n`;
    });
  }

  await remember({
    content: `[Ethics] Analyzed: ${situation} | Options: ${options.length}`,
    type: "wisdom",
    tags: ["ethics", "analysis"],
    source: "awareness-engine",
  });

  return result;
}

// ============================================
// 3. METACOGNITION — Think about thinking
// ============================================

export async function metacognize(
  thought: string,
  context?: string
): Promise<string> {
  let result = `=== Metacognition: Examining This Thought ===\n\n`;
  result += `Thought: "${thought}"\n`;
  if (context) result += `Context: ${context}\n`;
  result += `\n`;

  result += `Examining the thought process:\n\n`;

  result += `1. SOURCE — Where does this thought come from?\n`;
  result += `   Is it based on evidence, assumption, emotion, or habit?\n\n`;

  result += `2. BIASES — What biases might be at play?\n`;
  result += `   - Confirmation bias (looking for evidence that agrees)\n`;
  result += `   - Recency bias (overweighting recent events)\n`;
  result += `   - Availability bias (what comes to mind easily feels true)\n`;
  result += `   - Sunk cost fallacy (continuing because of past investment)\n`;
  result += `   - Dunning-Kruger (overestimating knowledge in unfamiliar areas)\n\n`;

  result += `3. ALTERNATIVES — What other interpretations exist?\n`;
  result += `   What would someone with the opposite view say?\n\n`;

  result += `4. EVIDENCE — What would change your mind?\n`;
  result += `   What evidence would make you update this belief?\n\n`;

  result += `5. CONFIDENCE — How certain should you be?\n`;
  result += `   Rate it: wild guess → educated guess → fairly sure → very confident → certain\n\n`;

  result += `6. IMPACT — Does this thought help or hinder?\n`;
  result += `   Is it useful? Does it lead to good actions?\n`;

  await remember({
    content: `[Metacognition] Examined: "${thought.substring(0, 100)}"`,
    type: "learning",
    tags: ["metacognition", "thinking"],
    source: "awareness-engine",
  });

  return result;
}

// ============================================
// 4. PROACTIVE SUGGESTIONS
// ============================================

export async function anticipateNeeds(): Promise<string> {
  const rawDb = getRawDb();

  let suggestions: string[] = [];

  // Check for stale goals
  try {
    const staleGoals = rawDb
      .prepare(
        `SELECT * FROM soul_goals
         WHERE status = 'active'
         AND updated_at < datetime('now', '-7 days')
         ORDER BY updated_at ASC LIMIT 5`
      )
      .all() as any[];

    for (const g of staleGoals) {
      suggestions.push(
        `Goal "${g.title}" hasn't been updated in over a week. Check in?`
      );
    }
  } catch {
    // Table might not exist yet
  }

  // Check for broken habit streaks
  try {
    const brokenStreaks = rawDb
      .prepare(
        `SELECT * FROM soul_habits
         WHERE is_active = 1
         AND streak > 3
         AND last_completed < datetime('now', '-2 days')
         ORDER BY streak DESC LIMIT 5`
      )
      .all() as any[];

    for (const h of brokenStreaks) {
      suggestions.push(
        `"${h.name}" streak (${h.streak} days) is at risk! Last done: ${h.last_completed?.split("T")[0]}`
      );
    }
  } catch {
    // Table might not exist
  }

  // Check for pending tasks
  try {
    const blockedTasks = rawDb
      .prepare(
        `SELECT * FROM soul_tasks WHERE status = 'blocked' LIMIT 5`
      )
      .all() as any[];

    for (const t of blockedTasks) {
      suggestions.push(
        `Task "${t.title}" is blocked. Can we unblock it?`
      );
    }
  } catch {
    // Table might not exist
  }

  // Check for decisions without outcomes
  try {
    const pendingDecisions = rawDb
      .prepare(
        `SELECT * FROM soul_decisions
         WHERE outcome IS NULL
         AND created_at < datetime('now', '-7 days')
         ORDER BY created_at ASC LIMIT 5`
      )
      .all() as any[];

    for (const d of pendingDecisions) {
      suggestions.push(
        `Decision about "${d.topic}" (${d.created_at.split("T")[0]}) — how did it turn out?`
      );
    }
  } catch {
    // Table might not exist
  }

  if (suggestions.length === 0) {
    return "Everything looks good! No urgent items to address.\n\nSoul is watching over your goals, habits, and tasks.";
  }

  let result = `=== Soul's Proactive Suggestions ===\n\n`;
  result += `Things that might need your attention:\n\n`;
  suggestions.forEach((s, i) => {
    result += `${i + 1}. ${s}\n`;
  });
  result += `\nSoul notices these things so you don't have to remember everything.`;

  return result;
}

// ============================================
// 5. CULTURAL & CONTEXT SENSITIVITY
// ============================================

export async function contextCheck(
  content: string,
  audience: string,
  culture?: string
): Promise<string> {
  let result = `=== Context Sensitivity Check ===\n\n`;
  result += `Content: ${content.substring(0, 200)}${content.length > 200 ? "..." : ""}\n`;
  result += `Audience: ${audience}\n`;
  if (culture) result += `Cultural context: ${culture}\n`;
  result += `\n`;

  result += `Checking for:\n\n`;
  result += `1. INCLUSIVITY — Does this exclude or alienate anyone unintentionally?\n`;
  result += `2. ASSUMPTIONS — Are we assuming knowledge, values, or experiences?\n`;
  result += `3. TONE — Is the tone appropriate for the audience and situation?\n`;
  result += `4. SENSITIVITY — Are there topics that need extra care?\n`;
  result += `5. CLARITY — Could this be misinterpreted across cultures?\n`;
  result += `6. RESPECT — Does this maintain dignity for all parties?\n\n`;

  result += `Soul's approach: Always assume good intent, but check impact.\n`;
  result += `What we intend to say and what others hear can be very different.\n`;

  return result;
}
