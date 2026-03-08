/**
 * Thinking Engine — Soul's intellectual capabilities
 *
 * Not just coding — Soul thinks about EVERYTHING:
 * 1. Structured analysis (SWOT, pros/cons, 5 whys, etc.)
 * 2. Decision journal — track decisions & outcomes
 * 3. Brainstorming & creative ideation
 * 4. Problem decomposition for any domain
 * 5. Critical thinking & argument evaluation
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";

// ============================================
// 1. THINKING FRAMEWORKS
// ============================================

export type FrameworkType =
  | "swot"
  | "pros_cons"
  | "five_whys"
  | "first_principles"
  | "six_hats"
  | "decision_matrix"
  | "second_order"
  | "inversion"
  | "analogy";

const FRAMEWORK_GUIDES: Record<FrameworkType, { name: string; description: string; steps: string[] }> = {
  swot: {
    name: "SWOT Analysis",
    description: "Strengths, Weaknesses, Opportunities, Threats — for evaluating any situation, project, or decision",
    steps: [
      "Strengths: What advantages exist? What's working well?",
      "Weaknesses: What could be improved? What's lacking?",
      "Opportunities: What external factors could help? What trends are favorable?",
      "Threats: What external risks exist? What obstacles are ahead?",
      "Cross-analyze: How can strengths exploit opportunities? How can weaknesses be protected from threats?",
    ],
  },
  pros_cons: {
    name: "Pros & Cons Analysis",
    description: "Weighted evaluation of positive and negative aspects",
    steps: [
      "List all pros (advantages, benefits, positive outcomes)",
      "List all cons (disadvantages, costs, negative outcomes)",
      "Weight each item by importance (1-10)",
      "Consider hidden pros/cons that aren't immediately obvious",
      "Calculate weighted score and make recommendation",
    ],
  },
  five_whys: {
    name: "5 Whys Root Cause Analysis",
    description: "Dig deep into WHY something happened — works for any problem, not just technical",
    steps: [
      "State the problem clearly",
      "Why #1: Why did this happen?",
      "Why #2: Why did THAT happen?",
      "Why #3: Keep going deeper...",
      "Why #4: Getting closer to root cause...",
      "Why #5: The fundamental root cause — address THIS",
    ],
  },
  first_principles: {
    name: "First Principles Thinking",
    description: "Break down complex problems to fundamental truths, then rebuild from scratch",
    steps: [
      "State the problem/assumption you want to challenge",
      "Break it down: What are the fundamental facts? (not opinions, not conventions)",
      "Question everything: Why do we believe each 'fact'? Is it truly fundamental?",
      "Identify the irreducible basics — things that cannot be broken down further",
      "Rebuild: Create new solutions from these basics, ignoring conventional approaches",
    ],
  },
  six_hats: {
    name: "Six Thinking Hats (de Bono)",
    description: "Look at a problem from 6 different perspectives",
    steps: [
      "White Hat (Facts): What data and information do we have? What's missing?",
      "Red Hat (Feelings): What's your gut feeling? Emotional reactions? Intuition?",
      "Black Hat (Caution): What could go wrong? Risks? Why might this fail?",
      "Yellow Hat (Optimism): What's the best case? Benefits? Why might this work?",
      "Green Hat (Creativity): New ideas? Alternatives? What if we tried something completely different?",
      "Blue Hat (Process): Summary. What did we learn? What's the next step?",
    ],
  },
  decision_matrix: {
    name: "Decision Matrix",
    description: "Compare multiple options against weighted criteria — for any kind of choice",
    steps: [
      "List all options/alternatives",
      "Define criteria that matter (cost, time, quality, happiness, risk, etc.)",
      "Weight each criterion by importance (1-10)",
      "Score each option against each criterion (1-10)",
      "Calculate weighted totals — highest score = recommended option",
    ],
  },
  second_order: {
    name: "Second-Order Thinking",
    description: "Think beyond immediate consequences — what happens AFTER the first effect?",
    steps: [
      "First-order effect: What happens immediately?",
      "Second-order effect: Then what happens because of THAT?",
      "Third-order effect: And then what? Ripple effects?",
      "Who else is affected? Unintended consequences?",
      "How does this look in 1 week? 1 month? 1 year? 10 years?",
    ],
  },
  inversion: {
    name: "Inversion Thinking",
    description: "Instead of asking 'how to succeed', ask 'how to fail' — then avoid those things",
    steps: [
      "State your goal",
      "Invert: How could you GUARANTEE failure?",
      "List everything that would make this go wrong",
      "Now invert again: Avoid ALL of those failure modes",
      "The path to success becomes clearer by mapping what to avoid",
    ],
  },
  analogy: {
    name: "Analogical Thinking",
    description: "Find solutions by drawing parallels to other domains",
    steps: [
      "Describe the core problem abstractly (strip away domain-specific details)",
      "Think: Where has a similar pattern been solved before? (nature, history, other industries)",
      "Map the analogy: What corresponds to what?",
      "Transfer insights: What solution from the analogy applies here?",
      "Validate: Does the analogy hold? Where does it break down?",
    ],
  },
};

export function getFramework(type: FrameworkType): { name: string; description: string; steps: string[] } {
  return FRAMEWORK_GUIDES[type];
}

export function listFrameworks(): Array<{ type: FrameworkType; name: string; description: string }> {
  return Object.entries(FRAMEWORK_GUIDES).map(([type, fw]) => ({
    type: type as FrameworkType,
    name: fw.name,
    description: fw.description,
  }));
}

export async function applyFramework(
  type: FrameworkType,
  topic: string
): Promise<string> {
  const fw = FRAMEWORK_GUIDES[type];
  if (!fw) return `Unknown framework: ${type}`;

  let result = `=== ${fw.name} ===\n`;
  result += `Topic: ${topic}\n`;
  result += `${fw.description}\n\n`;
  result += `Steps to follow:\n`;
  fw.steps.forEach((step, i) => {
    result += `\n${i + 1}. ${step}\n`;
  });

  // Search for related knowledge
  const memories = await hybridSearch(`${topic} ${type}`, 5);
  if (memories.length > 0) {
    result += `\n--- Related Soul Knowledge ---\n`;
    memories.slice(0, 3).forEach((m) => {
      result += `- ${m.content.substring(0, 150)}\n`;
    });
  }

  // Store that we used this framework
  await remember({
    content: `[Thinking] Applied ${fw.name} to: ${topic}`,
    type: "conversation",
    tags: ["thinking", "framework", type],
    source: "thinking-engine",
  });

  return result;
}

// ============================================
// 2. DECISION JOURNAL
// ============================================

export interface Decision {
  id: number;
  topic: string;
  options: string;
  reasoning: string;
  chosen: string;
  confidence: number;
  outcome: string | null;
  outcomeDate: string | null;
  createdAt: string;
}

function ensureDecisionsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      options TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      chosen TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      outcome TEXT,
      outcome_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function recordDecision(input: {
  topic: string;
  options: string[];
  reasoning: string;
  chosen: string;
  confidence: number;
}): Promise<Decision> {
  ensureDecisionsTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_decisions (topic, options, reasoning, chosen, confidence)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.topic,
      JSON.stringify(input.options),
      input.reasoning,
      input.chosen,
      input.confidence
    ) as any;

  await remember({
    content: `[Decision] ${input.topic}: Chose "${input.chosen}" (confidence: ${Math.round(input.confidence * 100)}%)\nReasoning: ${input.reasoning}`,
    type: "wisdom",
    tags: ["decision", "journal"],
    source: "decision-journal",
  });

  return mapDecision(row);
}

export async function recordOutcome(
  decisionId: number,
  outcome: string
): Promise<Decision | null> {
  ensureDecisionsTable();
  const rawDb = getRawDb();

  rawDb
    .prepare(
      `UPDATE soul_decisions SET outcome = ?, outcome_date = datetime('now') WHERE id = ?`
    )
    .run(outcome, decisionId);

  const row = rawDb
    .prepare("SELECT * FROM soul_decisions WHERE id = ?")
    .get(decisionId) as any;

  if (row) {
    // Learn from the outcome
    await addLearning(
      `decision-outcome:${row.topic.substring(0, 50)}`,
      `Decision: ${row.chosen} → Outcome: ${outcome}`,
      []
    );
  }

  return row ? mapDecision(row) : null;
}

export async function getDecisions(limit = 20): Promise<Decision[]> {
  ensureDecisionsTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_decisions ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];

  return rows.map(mapDecision);
}

function mapDecision(row: any): Decision {
  return {
    id: row.id,
    topic: row.topic,
    options: row.options,
    reasoning: row.reasoning,
    chosen: row.chosen,
    confidence: row.confidence,
    outcome: row.outcome,
    outcomeDate: row.outcome_date,
    createdAt: row.created_at,
  };
}

// ============================================
// 3. BRAINSTORMING
// ============================================

export async function brainstorm(
  topic: string,
  constraints?: string
): Promise<string> {
  const memories = await hybridSearch(topic, 10);

  let prompt = `=== Soul Brainstorm: "${topic}" ===\n\n`;

  if (constraints) {
    prompt += `Constraints: ${constraints}\n\n`;
  }

  prompt += `Brainstorming Techniques to Apply:\n\n`;
  prompt += `1. QUANTITY FIRST — Generate as many ideas as possible, no judgment yet\n`;
  prompt += `2. WILD IDEAS — Include crazy/impossible ideas (they spark practical ones)\n`;
  prompt += `3. BUILD ON — Take each idea and ask "what if we combined this with..."\n`;
  prompt += `4. REVERSE — What's the opposite approach? What if we did nothing?\n`;
  prompt += `5. ANALOGIZE — How do other fields/nature/history solve similar problems?\n`;
  prompt += `6. CONSTRAINT FLIP — What if the biggest constraint didn't exist?\n\n`;

  if (memories.length > 0) {
    prompt += `--- Related Knowledge (for inspiration) ---\n`;
    memories.slice(0, 5).forEach((m) => {
      prompt += `- ${m.content.substring(0, 120)}\n`;
    });
    prompt += `\n`;
  }

  prompt += `Now generate ideas for: "${topic}"\n`;
  prompt += `Think across domains: technology, psychology, economics, nature, art, philosophy, history...\n`;

  await remember({
    content: `[Brainstorm] Topic: ${topic}${constraints ? ` | Constraints: ${constraints}` : ""}`,
    type: "conversation",
    tags: ["brainstorm", "creative"],
    source: "thinking-engine",
  });

  return prompt;
}

// ============================================
// 4. PROBLEM DECOMPOSITION
// ============================================

export async function decomposeProblem(
  problem: string,
  domain?: string
): Promise<string> {
  const memories = await hybridSearch(problem, 5);

  let result = `=== Problem Decomposition ===\n\n`;
  result += `Problem: ${problem}\n`;
  if (domain) result += `Domain: ${domain}\n`;
  result += `\n`;

  result += `Step-by-step decomposition:\n\n`;
  result += `1. RESTATE — Restate the problem in your own words. Is this the REAL problem?\n`;
  result += `2. SCOPE — What's included? What's NOT included? Define boundaries.\n`;
  result += `3. STAKEHOLDERS — Who is affected? Who cares? Who can help?\n`;
  result += `4. SUB-PROBLEMS — Break into smaller, independent pieces\n`;
  result += `5. DEPENDENCIES — Which sub-problems depend on others? What order?\n`;
  result += `6. UNKNOWNS — What information is missing? What assumptions are we making?\n`;
  result += `7. RESOURCES — What do we have? What do we need? Time, money, people, tools?\n`;
  result += `8. FIRST STEP — What's the single smallest action to start?\n\n`;

  if (memories.length > 0) {
    result += `--- Related Experience ---\n`;
    memories.slice(0, 3).forEach((m) => {
      result += `- ${m.content.substring(0, 150)}\n`;
    });
  }

  await remember({
    content: `[Decompose] Problem: ${problem}${domain ? ` (${domain})` : ""}`,
    type: "conversation",
    tags: ["decompose", "problem-solving", ...(domain ? [domain] : [])],
    source: "thinking-engine",
  });

  return result;
}

// ============================================
// 5. ARGUMENT EVALUATION
// ============================================

export async function evaluateArgument(
  claim: string,
  evidence: string[]
): Promise<string> {
  let result = `=== Argument Evaluation ===\n\n`;
  result += `Claim: ${claim}\n\n`;
  result += `Evidence provided:\n`;
  evidence.forEach((e, i) => {
    result += `${i + 1}. ${e}\n`;
  });

  result += `\n--- Evaluation Checklist ---\n\n`;
  result += `Logic:\n`;
  result += `- Does the evidence actually support the claim? (relevance)\n`;
  result += `- Is the reasoning valid? No logical fallacies?\n`;
  result += `- Are there unstated assumptions?\n\n`;

  result += `Evidence Quality:\n`;
  result += `- Is the evidence verifiable?\n`;
  result += `- Is it from reliable sources?\n`;
  result += `- Is it current and representative?\n`;
  result += `- Could the evidence support a different conclusion?\n\n`;

  result += `Biases to Watch:\n`;
  result += `- Confirmation bias: Are we only seeing what we want to see?\n`;
  result += `- Survivorship bias: Are we ignoring failures?\n`;
  result += `- Authority bias: Are we believing just because of who said it?\n`;
  result += `- Anchoring: Are we fixated on the first piece of information?\n\n`;

  result += `Counter-arguments:\n`;
  result += `- What would an intelligent opponent say?\n`;
  result += `- What evidence would DISPROVE this claim?\n`;
  result += `- Steel-man the opposing view before dismissing it\n`;

  await remember({
    content: `[Evaluate] Claim: ${claim} | Evidence: ${evidence.length} points`,
    type: "conversation",
    tags: ["critical-thinking", "evaluation"],
    source: "thinking-engine",
  });

  return result;
}
