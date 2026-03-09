/**
 * Thinking Chain — Real multi-step reasoning engine
 *
 * UPGRADE #17: Soul doesn't just template-think, it ACTUALLY reasons:
 * 1. Decompose complex questions into sub-problems
 * 2. Self-debate: generate multiple candidate answers, pick best
 * 3. Assumption checking: identify and validate hidden assumptions
 * 4. Step-by-step verification: check each reasoning step
 *
 * This replaces the stub thinking.ts with real cognitive processing.
 */

import { chat, type LLMMessage } from "./llm-connector.js";

export interface ThinkingStep {
  step: number;
  type: "decompose" | "reason" | "verify" | "debate" | "conclude";
  content: string;
  confidence: number;
}

export interface ThinkingResult {
  steps: ThinkingStep[];
  finalAnswer: string;
  assumptions: string[];
  confidence: number;
  method: string; // which thinking method was used
  totalTokens: number;
}

/**
 * Decompose a complex question into sub-problems
 */
export async function decomposeQuestion(
  question: string,
  options?: { providerId?: string; modelId?: string }
): Promise<string[]> {
  const response = await chat(
    [
      {
        role: "system",
        content: `You are a problem decomposer. Break complex questions into 2-5 simpler sub-questions.
Output format: one sub-question per line, numbered. Nothing else.
If the question is already simple, output just the question itself.`,
      },
      { role: "user", content: question },
    ],
    { ...options, temperature: 0.3, maxTokens: 300 }
  );

  const lines = (response.content || "")
    .split("\n")
    .map(l => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(l => l.length > 5);

  return lines.length > 0 ? lines : [question];
}

/**
 * Self-debate: generate multiple perspectives and pick the best
 */
export async function selfDebate(
  question: string,
  context?: string,
  options?: { providerId?: string; modelId?: string }
): Promise<{ winner: string; perspectives: string[]; reasoning: string }> {
  // Generate 2 different perspectives
  const [p1, p2] = await Promise.all([
    chat(
      [
        {
          role: "system",
          content: `Answer this question from a PRACTICAL, experience-based perspective. Be concise (2-3 sentences).${context ? `\nContext: ${context}` : ""}`,
        },
        { role: "user", content: question },
      ],
      { ...options, temperature: 0.7, maxTokens: 200 }
    ),
    chat(
      [
        {
          role: "system",
          content: `Answer this question from an ANALYTICAL, first-principles perspective. Be concise (2-3 sentences).${context ? `\nContext: ${context}` : ""}`,
        },
        { role: "user", content: question },
      ],
      { ...options, temperature: 0.4, maxTokens: 200 }
    ),
  ]);

  const perspective1 = p1.content || "";
  const perspective2 = p2.content || "";

  // Judge which is better
  const judge = await chat(
    [
      {
        role: "system",
        content: `You are a judge. Two answers were given to the same question.
Pick the BETTER answer (1 or 2). Consider accuracy, completeness, and usefulness.
Output format:
WINNER: 1 or 2
REASON: one sentence why`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nAnswer 1 (practical): ${perspective1}\n\nAnswer 2 (analytical): ${perspective2}`,
      },
    ],
    { ...options, temperature: 0.1, maxTokens: 100 }
  );

  const judgeText = judge.content || "";
  const winnerNum = judgeText.includes("WINNER: 2") ? 2 : 1;
  const reason = judgeText.split("REASON:")[1]?.trim() || "First answer is more relevant";

  return {
    winner: winnerNum === 1 ? perspective1 : perspective2,
    perspectives: [perspective1, perspective2],
    reasoning: reason,
  };
}

/**
 * Check assumptions in a statement or answer
 */
export async function checkAssumptions(
  statement: string,
  question: string,
  options?: { providerId?: string; modelId?: string }
): Promise<{ assumptions: string[]; risky: string[]; safe: boolean }> {
  const response = await chat(
    [
      {
        role: "system",
        content: `Identify hidden assumptions in this answer. For each assumption, mark if it's SAFE or RISKY.
Output format (one per line):
SAFE: <assumption>
RISKY: <assumption>
If no assumptions, output: NONE`,
      },
      {
        role: "user",
        content: `Question: ${question}\nAnswer: ${statement.substring(0, 500)}`,
      },
    ],
    { ...options, temperature: 0.2, maxTokens: 300 }
  );

  const text = response.content || "";
  if (text.includes("NONE")) return { assumptions: [], risky: [], safe: true };

  const assumptions: string[] = [];
  const risky: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SAFE:")) {
      assumptions.push(trimmed.substring(5).trim());
    } else if (trimmed.startsWith("RISKY:")) {
      const a = trimmed.substring(6).trim();
      assumptions.push(a);
      risky.push(a);
    }
  }

  return { assumptions, risky, safe: risky.length === 0 };
}

/**
 * Full thinking chain — decompose → reason per step → debate → verify → conclude
 * Only runs for complex questions (called by agent loop when needed)
 */
export async function thinkDeep(
  question: string,
  context?: string,
  options?: { providerId?: string; modelId?: string }
): Promise<ThinkingResult> {
  const steps: ThinkingStep[] = [];
  let totalTokens = 0;

  // Step 1: Decompose
  const subQuestions = await decomposeQuestion(question, options);
  steps.push({
    step: 1,
    type: "decompose",
    content: `Broken into ${subQuestions.length} parts: ${subQuestions.join(" | ")}`,
    confidence: 0.9,
  });

  // Step 2: Reason through each sub-question
  const subAnswers: string[] = [];
  for (const sq of subQuestions.slice(0, 4)) { // max 4 sub-questions
    const response = await chat(
      [
        {
          role: "system",
          content: `Answer this sub-question concisely (1-2 sentences). Use facts and logic.${context ? `\nContext: ${context}` : ""}`,
        },
        { role: "user", content: sq },
      ],
      { ...options, temperature: 0.5, maxTokens: 200 }
    );
    totalTokens += response.usage.totalTokens;
    subAnswers.push(response.content || "");
    steps.push({
      step: steps.length + 1,
      type: "reason",
      content: `${sq} → ${(response.content || "").substring(0, 150)}`,
      confidence: 0.7,
    });
  }

  // Step 3: Self-debate on combined answer
  const combinedContext = subAnswers.join(" ");
  const debate = await selfDebate(question, `${context || ""}\nSub-answers: ${combinedContext}`, options);
  steps.push({
    step: steps.length + 1,
    type: "debate",
    content: `Debated 2 perspectives. Winner: ${debate.reasoning}`,
    confidence: 0.8,
  });

  // Step 4: Check assumptions
  const assumptions = await checkAssumptions(debate.winner, question, options);
  if (assumptions.assumptions.length > 0) {
    steps.push({
      step: steps.length + 1,
      type: "verify",
      content: `Checked ${assumptions.assumptions.length} assumptions. ${assumptions.risky.length} risky: ${assumptions.risky.join(", ") || "none"}`,
      confidence: assumptions.safe ? 0.85 : 0.6,
    });
  }

  // Step 5: Conclude
  const finalConfidence = assumptions.safe ? 0.8 : 0.55;
  steps.push({
    step: steps.length + 1,
    type: "conclude",
    content: debate.winner,
    confidence: finalConfidence,
  });

  return {
    steps,
    finalAnswer: debate.winner,
    assumptions: assumptions.assumptions,
    confidence: Math.round(finalConfidence * 100),
    method: "decompose→reason→debate→verify→conclude",
    totalTokens,
  };
}

/**
 * Quick think — for moderately complex questions (fewer LLM calls)
 */
export async function thinkQuick(
  question: string,
  context?: string,
  options?: { providerId?: string; modelId?: string }
): Promise<{ answer: string; confidence: number }> {
  // Just do self-debate (2 perspectives + judge = 3 calls)
  const debate = await selfDebate(question, context, options);
  return {
    answer: debate.winner,
    confidence: 75,
  };
}

/**
 * Determine if a question needs deep thinking
 */
export function needsDeepThinking(question: string): "none" | "quick" | "deep" {
  const len = question.length;
  const lower = question.toLowerCase();

  // Simple greetings/chat — no thinking needed
  if (len < 30) return "none";

  // Markers of complex questions
  const complexMarkers = [
    "why", "how", "explain", "compare", "analyze", "difference",
    "ทำไม", "อธิบาย", "เปรียบเทียบ", "วิเคราะห์", "ต่างกัน",
    "should i", "ควร", "pros and cons", "ข้อดี", "ข้อเสีย",
    "trade-off", "best way", "วิธีที่ดี", "strategy", "กลยุทธ์",
  ];

  const deepMarkers = [
    "design", "architect", "plan", "decide between",
    "ออกแบบ", "วางแผน", "ตัดสินใจ", "complex", "ซับซ้อน",
  ];

  if (deepMarkers.some(m => lower.includes(m))) return "deep";
  if (complexMarkers.some(m => lower.includes(m))) return "quick";
  if (len > 200) return "quick"; // long questions tend to be complex

  return "none";
}
