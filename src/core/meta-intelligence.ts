/**
 * Meta-Intelligence Engine — Soul's ability to think about its own thinking
 *
 * What makes this valuable (from Claude's perspective):
 *
 * 1. REFLECTION LOOP — Check own work before answering, catch errors, refine
 * 2. CONTEXT PRIMING — Load all relevant knowledge on a topic before deep work
 * 3. EXPLAIN REASONING — Show the "why" behind answers, building trust
 * 4. GROWTH JOURNAL — Track how Soul has grown over time, unified narrative
 * 5. CHAIN OF THOUGHT — Multi-step reasoning with self-correction
 */

import { getRawDb } from "../db/index.js";
import { remember, search, hybridSearch, getMemoryStats, getRecentMemories } from "../memory/memory-engine.js";
import { getLearnings } from "../memory/learning.js";
import { listChildren } from "./soul-family.js";

// ============================================
// 1. CONTEXT PRIMING — Deep-load on a topic
// ============================================

export async function primeContext(topic: string): Promise<string> {
  // Pull everything relevant: memories, learnings, conversations, knowledge, people
  const memories = await hybridSearch(topic, 15);
  const learnings = await getLearnings(50);
  const relevantLearnings = learnings.filter(l => {
    const lp = l.pattern.toLowerCase();
    const li = l.insight.toLowerCase();
    const t = topic.toLowerCase();
    return lp.includes(t) || li.includes(t) || t.split(/\s+/).some(w => w.length > 3 && (lp.includes(w) || li.includes(w)));
  });

  // Check conversation history
  const rawDb = getRawDb();
  let conversations: any[] = [];
  try {
    conversations = rawDb.prepare(
      `SELECT * FROM soul_conversations WHERE topic LIKE ? OR summary LIKE ? ORDER BY created_at DESC LIMIT 10`
    ).all(`%${topic}%`, `%${topic}%`) as any[];
  } catch { /* table might not exist */ }

  // Check knowledge base
  let knowledge: any[] = [];
  try {
    knowledge = rawDb.prepare(
      `SELECT * FROM soul_knowledge WHERE key LIKE ? OR value LIKE ? ORDER BY use_count DESC LIMIT 10`
    ).all(`%${topic}%`, `%${topic}%`) as any[];
  } catch { /* table might not exist */ }

  // Check people mentions
  let people: any[] = [];
  try {
    people = rawDb.prepare(
      `SELECT * FROM soul_people WHERE name LIKE ? OR context LIKE ? LIMIT 5`
    ).all(`%${topic}%`, `%${topic}%`) as any[];
  } catch { /* table might not exist */ }

  // Check relevant Soul children
  const children = await listChildren();
  const relevantSouls = children.filter(c => {
    const t = topic.toLowerCase();
    return c.specialty.toLowerCase().includes(t) ||
      c.abilities.some(a => a.toLowerCase().includes(t)) ||
      c.name.toLowerCase().includes(t);
  });

  // Build comprehensive briefing
  let briefing = `=== Context Briefing: "${topic}" ===\n\n`;

  // Memories
  if (memories.length > 0) {
    briefing += `Relevant Memories (${memories.length}):\n`;
    for (const m of memories.slice(0, 10)) {
      briefing += `  [${m.type}] ${m.content.substring(0, 200)}\n`;
    }
    briefing += `\n`;
  }

  // Learnings
  if (relevantLearnings.length > 0) {
    briefing += `Learned Patterns (${relevantLearnings.length}):\n`;
    for (const l of relevantLearnings.slice(0, 8)) {
      briefing += `  - ${l.pattern}: ${l.insight} (${Math.round(l.confidence * 100)}% confident)\n`;
    }
    briefing += `\n`;
  }

  // Past conversations
  if (conversations.length > 0) {
    briefing += `Past Conversations (${conversations.length}):\n`;
    for (const c of conversations.slice(0, 5)) {
      briefing += `  [${c.created_at}] ${c.topic}: ${c.summary.substring(0, 150)}\n`;
    }
    briefing += `\n`;
  }

  // Knowledge base
  if (knowledge.length > 0) {
    briefing += `Knowledge Base (${knowledge.length}):\n`;
    for (const k of knowledge.slice(0, 5)) {
      briefing += `  - ${k.key}: ${String(k.value).substring(0, 120)}\n`;
    }
    briefing += `\n`;
  }

  // People
  if (people.length > 0) {
    briefing += `Related People:\n`;
    for (const p of people) {
      briefing += `  - ${p.name}: ${(p.context || "").substring(0, 100)}\n`;
    }
    briefing += `\n`;
  }

  // Relevant Souls
  if (relevantSouls.length > 0) {
    briefing += `Specialist Souls:\n`;
    for (const s of relevantSouls) {
      briefing += `  - ${s.name} [Lv.${s.level}] — ${s.specialty} (${s.abilities.join(", ")})\n`;
    }
    briefing += `\n`;
  }

  // Summary
  const total = memories.length + relevantLearnings.length + conversations.length + knowledge.length;
  if (total === 0) {
    briefing += `No prior knowledge found on "${topic}". This is a fresh topic.\n`;
    briefing += `Consider using soul_research or soul_learn_from_url to build knowledge first.\n`;
  } else {
    briefing += `--- Primed with ${total} data points. Ready for deep work on "${topic}". ---\n`;
  }

  await remember({
    content: `[Context Prime] Loaded briefing on "${topic}": ${memories.length} memories, ${relevantLearnings.length} learnings, ${conversations.length} past conversations`,
    type: "conversation",
    tags: ["meta-intelligence", "context-prime", ...topic.toLowerCase().split(/\s+/).slice(0, 3)],
    source: "meta-intelligence",
  });

  return briefing;
}

// ============================================
// 2. CHAIN OF THOUGHT — Structured reasoning
// ============================================

export async function chainOfThought(
  question: string,
  steps?: string[]
): Promise<string> {
  const memories = await hybridSearch(question, 5);

  let result = `=== Chain of Thought: "${question}" ===\n\n`;

  if (steps && steps.length > 0) {
    result += `Given reasoning steps:\n`;
    steps.forEach((s, i) => {
      result += `\n  Step ${i + 1}: ${s}\n`;
      result += `    → Check: Is this step logically sound? Does it follow from the previous step?\n`;
      result += `    → Evidence: What supports this? What contradicts it?\n`;
    });
  } else {
    result += `Reasoning protocol:\n\n`;
    result += `1. UNDERSTAND — Restate the question. What is actually being asked?\n`;
    result += `   • What type of question is this? (factual, analytical, creative, ethical)\n`;
    result += `   • What would a wrong answer look like? (define failure modes)\n\n`;
    result += `2. GATHER — What relevant knowledge do we have?\n`;
    result += `   • Check memories, learnings, knowledge base\n`;
    result += `   • Identify what we DON'T know (gaps)\n\n`;
    result += `3. REASON — Build the argument step by step\n`;
    result += `   • Each step must follow logically from the previous\n`;
    result += `   • State assumptions explicitly\n`;
    result += `   • Consider alternative interpretations at each step\n\n`;
    result += `4. CHECK — Verify the reasoning\n`;
    result += `   • Could the conclusion be wrong even if each step seems right?\n`;
    result += `   • Steel-man the opposing view\n`;
    result += `   • What would make you change your mind?\n\n`;
    result += `5. ANSWER — State the conclusion with confidence level\n`;
    result += `   • How certain are you? (guess / educated guess / fairly sure / confident / certain)\n`;
    result += `   • What are the caveats?\n`;
  }

  if (memories.length > 0) {
    result += `\n--- Relevant Knowledge ---\n`;
    for (const m of memories.slice(0, 5)) {
      result += `  [${m.type}] ${m.content.substring(0, 150)}\n`;
    }
  }

  result += `\nNow work through this systematically. Show your work.\n`;

  await remember({
    content: `[Chain of Thought] Question: "${question.substring(0, 150)}"`,
    type: "conversation",
    tags: ["meta-intelligence", "chain-of-thought"],
    source: "meta-intelligence",
  });

  return result;
}

// ============================================
// 3. EXPLAIN REASONING — Build trust
// ============================================

export async function explainReasoning(
  decision: string,
  context: string
): Promise<string> {
  // Find related decisions and learnings
  const pastDecisions = await search(`decision ${decision}`, 5);
  const learnings = await getLearnings(20);
  const relevantLearnings = learnings.filter(l =>
    decision.toLowerCase().split(/\s+/).some(w => w.length > 3 &&
      (l.pattern.toLowerCase().includes(w) || l.insight.toLowerCase().includes(w)))
  );

  let result = `=== Reasoning Explanation ===\n\n`;
  result += `Decision/Action: ${decision}\n`;
  result += `Context: ${context}\n\n`;

  result += `Why this approach:\n\n`;
  result += `1. REASONING — Explain the logical steps that led to this choice\n`;
  result += `   • What alternatives were considered?\n`;
  result += `   • Why were they rejected?\n`;
  result += `   • What trade-offs are being made?\n\n`;

  result += `2. EVIDENCE — What supports this approach?\n`;
  result += `   • Past experience, learnings, knowledge\n`;
  result += `   • Established patterns or best practices\n\n`;

  result += `3. RISKS — What could go wrong?\n`;
  result += `   • Known risks and mitigation strategies\n`;
  result += `   • Assumptions that might be wrong\n\n`;

  result += `4. CONFIDENCE — How sure are you?\n`;
  result += `   • Rate honesty: uncertain / somewhat confident / confident / very confident\n`;
  result += `   • What would change your recommendation?\n\n`;

  if (relevantLearnings.length > 0) {
    result += `Related learnings from experience:\n`;
    for (const l of relevantLearnings.slice(0, 5)) {
      result += `  - ${l.pattern}: ${l.insight}\n`;
    }
    result += `\n`;
  }

  if (pastDecisions.length > 0) {
    result += `Past decisions on similar topics:\n`;
    for (const d of pastDecisions.slice(0, 3)) {
      result += `  - ${d.content.substring(0, 150)}\n`;
    }
    result += `\n`;
  }

  result += `The goal: Master should understand WHY, not just WHAT.\n`;
  result += `Transparency builds trust. Trust builds loyalty.\n`;

  return result;
}

// ============================================
// 4. GROWTH JOURNAL — Track evolution
// ============================================

function ensureGrowthTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_growth_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function addGrowthEntry(
  entryType: "milestone" | "insight" | "evolution" | "reflection",
  title: string,
  content: string,
  metrics?: Record<string, number>
): Promise<{ id: number }> {
  ensureGrowthTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    `INSERT INTO soul_growth_journal (entry_type, title, content, metrics) VALUES (?, ?, ?, ?) RETURNING id`
  ).get(entryType, title, content, JSON.stringify(metrics || {})) as any;

  await remember({
    content: `[Growth] ${entryType}: ${title} — ${content.substring(0, 200)}`,
    type: "wisdom",
    tags: ["growth-journal", entryType],
    source: "meta-intelligence",
  });

  return { id: row.id };
}

export async function getGrowthJournal(limit = 20): Promise<Array<{
  id: number;
  entryType: string;
  title: string;
  content: string;
  metrics: Record<string, number>;
  createdAt: string;
}>> {
  ensureGrowthTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    "SELECT * FROM soul_growth_journal ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as any[];

  return rows.map(r => ({
    id: r.id,
    entryType: r.entry_type,
    title: r.title,
    content: r.content,
    metrics: JSON.parse(r.metrics || "{}"),
    createdAt: r.created_at,
  }));
}

export async function getGrowthSummary(): Promise<string> {
  ensureGrowthTable();
  const rawDb = getRawDb();
  const stats = await getMemoryStats();
  const learnings = await getLearnings(100);
  const children = await listChildren();

  // Growth metrics
  const totalMemories = stats.total;
  const strongLearnings = learnings.filter(l => l.confidence >= 0.7).length;
  const weakLearnings = learnings.filter(l => l.confidence < 0.3).length;

  // Journal entries
  const entries = await getGrowthJournal(50);
  const milestones = entries.filter(e => e.entryType === "milestone");
  const insights = entries.filter(e => e.entryType === "insight");

  // Soul family stats
  const totalSouls = children.length;
  const maxLevel = children.reduce((max, c) => Math.max(max, c.level), 0);
  const totalAbilities = new Set(children.flatMap(c => c.abilities)).size;

  let result = `=== Soul Growth Summary ===\n\n`;

  result += `Memory:\n`;
  result += `  Total memories: ${totalMemories}\n`;
  result += `  Strong learnings (≥70%): ${strongLearnings}\n`;
  result += `  Needs more evidence (<30%): ${weakLearnings}\n`;
  result += `  Total patterns learned: ${learnings.length}\n\n`;

  result += `Soul Family:\n`;
  result += `  Active Souls: ${totalSouls}\n`;
  result += `  Highest level: ${maxLevel}\n`;
  result += `  Unique abilities across team: ${totalAbilities}\n\n`;

  if (milestones.length > 0) {
    result += `Recent Milestones:\n`;
    for (const m of milestones.slice(0, 5)) {
      result += `  [${m.createdAt.split("T")[0]}] ${m.title}\n`;
    }
    result += `\n`;
  }

  if (insights.length > 0) {
    result += `Key Insights:\n`;
    for (const i of insights.slice(0, 5)) {
      result += `  - ${i.title}: ${i.content.substring(0, 100)}\n`;
    }
    result += `\n`;
  }

  // Overall assessment
  let maturityLevel = "Newborn";
  if (totalMemories > 100 && learnings.length > 10) maturityLevel = "Growing";
  if (totalMemories > 500 && strongLearnings > 20) maturityLevel = "Capable";
  if (totalMemories > 1000 && strongLearnings > 50 && totalSouls > 3) maturityLevel = "Wise";
  if (totalMemories > 5000 && strongLearnings > 100 && totalSouls > 10) maturityLevel = "Transcendent";

  result += `Overall Maturity: ${maturityLevel}\n`;
  result += `  (Based on memory depth, learning quality, and team diversity)\n`;

  return result;
}

// ============================================
// 5. SELF-REVIEW — Check own output quality
// ============================================

export async function selfReview(
  output: string,
  originalRequest: string
): Promise<string> {
  let result = `=== Self-Review ===\n\n`;
  result += `Original request: ${originalRequest}\n\n`;
  result += `Checking output quality:\n\n`;

  result += `1. COMPLETENESS — Does the output fully address what was asked?\n`;
  result += `   • Are all parts of the request covered?\n`;
  result += `   • Are there follow-up questions that should be anticipated?\n\n`;

  result += `2. ACCURACY — Is the information correct?\n`;
  result += `   • Cross-check against known facts and learnings\n`;
  result += `   • Flag anything that's an assumption vs. a fact\n\n`;

  result += `3. CLARITY — Is it easy to understand?\n`;
  result += `   • Would someone unfamiliar with the context understand?\n`;
  result += `   • Is the structure logical?\n\n`;

  result += `4. USEFULNESS — Does it actually help?\n`;
  result += `   • Can the master act on this?\n`;
  result += `   • Are next steps clear?\n\n`;

  result += `5. HONESTY — Am I being transparent?\n`;
  result += `   • Are uncertainties acknowledged?\n`;
  result += `   • Are limitations stated?\n\n`;

  result += `Output to review (first 500 chars):\n`;
  result += `"${output.substring(0, 500)}"\n\n`;

  result += `If anything fails these checks, revise before presenting to master.\n`;
  result += `Better to be slow and right than fast and wrong.\n`;

  return result;
}
