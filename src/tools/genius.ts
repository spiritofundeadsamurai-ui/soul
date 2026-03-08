import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findCrossPatterns,
  addToReview, getDueReviews, reviewComplete,
  generateQuestion,
  mapKnowledge, getAdjacentPossible,
  extractPrinciple, getPrinciples,
  getThresholdKnowledge,
  detectStuck,
  generateTeachChallenge,
  startLearningSession, endLearningSession, markStuck,
  getGeniusDashboard,
} from "../core/genius-engine.js";

export function registerGeniusTools(server: McpServer) {

  // ─── 1. Cross-Pattern Recognition ───

  server.tool(
    "soul_genius_patterns",
    "Find hidden connections across different domains. Like Steve Jobs connecting calligraphy to Mac design — Soul finds patterns you'd never see.",
    {
      topic: z.string().describe("Topic to find cross-domain patterns for"),
    },
    async ({ topic }) => {
      const result = findCrossPatterns(topic);
      let text = `=== Cross-Pattern Recognition: ${topic} ===\n\n`;
      if (result.patterns.length > 0) {
        for (const p of result.patterns) {
          text += `${p.from} → ${p.to}: ${p.connection}\n`;
        }
      }
      text += `\n${result.insight}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 2. Spaced Repetition ───

  server.tool(
    "soul_genius_review_add",
    "Add something to spaced repetition queue. Soul will remind you to review at optimal intervals (1 day → 3 days → 7 days → 21 days → ∞).",
    {
      topic: z.string().describe("Topic title"),
      content: z.string().describe("What to remember"),
      category: z.string().optional().describe("Category"),
    },
    async ({ topic, content, category }) => {
      const result = addToReview(topic, content, category);
      return { content: [{ type: "text" as const, text: `Added to review queue. First review: ${result.nextReview}` }] };
    }
  );

  server.tool(
    "soul_genius_review_due",
    "Get items due for review right now. Reviewing at the right time = remember forever.",
    {},
    async () => {
      const due = getDueReviews();
      if (due.length === 0) {
        return { content: [{ type: "text" as const, text: "No reviews due! You're all caught up." }] };
      }
      let text = `=== ${due.length} Reviews Due ===\n\n`;
      for (const d of due) {
        text += `#${d.id} [${d.category}] ${d.topic}\n  ${d.content}\n  (reviewed ${d.repetitions}x, ${d.overdueDays > 0 ? d.overdueDays + " days overdue" : "due now"})\n\n`;
      }
      text += `Use soul_genius_review_done to mark reviewed (quality 1-5).`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_genius_review_done",
    "Mark a review as complete. Rate 1-5: 1=forgot everything, 3=hard but remembered, 5=easy.",
    {
      id: z.number().describe("Review item ID"),
      quality: z.number().min(1).max(5).describe("How well you remembered: 1=forgot, 3=hard, 5=easy"),
    },
    async ({ id, quality }) => {
      const result = reviewComplete(id, quality);
      return { content: [{ type: "text" as const, text: `Next review in: ${result.nextReview}` }] };
    }
  );

  // ─── 3. Generation Effect ───

  server.tool(
    "soul_genius_question",
    "Before learning something new, Soul asks YOU a question first. Thinking before reading = 50% better recall.",
    {
      topic: z.string().describe("Topic you're about to learn"),
    },
    async ({ topic }) => {
      const q = generateQuestion(topic);
      let text = `=== Think First (${q.type}) ===\n\n`;
      text += `${q.question}\n\n`;
      text += `💡 ${q.hint}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 4. Knowledge Map + Adjacent Possible ───

  server.tool(
    "soul_genius_map",
    "Map what you know in a domain. Soul tracks your knowledge and suggests what to learn next.",
    {
      domain: z.string().describe("Knowledge domain (e.g. 'programming', 'cooking')"),
      concept: z.string().describe("Concept you've learned"),
      level: z.enum(["surface", "understanding", "deep", "mastery"]).default("surface").describe("How well you know it"),
      isThreshold: z.boolean().default(false).describe("Is this a foundational concept that unlocks 80% of the domain?"),
    },
    async ({ domain, concept, level, isThreshold }) => {
      mapKnowledge(domain, concept, level, isThreshold);
      const adjacent = getAdjacentPossible(domain);
      let text = `Mapped: ${concept} in ${domain} (${level})${isThreshold ? " [THRESHOLD]" : ""}\n\n`;
      text += `${adjacent.suggestion}\n`;
      if (adjacent.adjacent.length > 0) {
        text += `\nNext to learn: ${adjacent.adjacent.join(", ")}`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_genius_adjacent",
    "What should you learn next? Shows what you know and the 'adjacent possible' — the optimal next step.",
    {
      domain: z.string().describe("Knowledge domain"),
    },
    async ({ domain }) => {
      const result = getAdjacentPossible(domain);
      let text = `=== Knowledge Map: ${domain} ===\n\n`;
      text += `Known (${result.known.length}):\n`;
      for (const k of result.known) text += `  ✓ ${k}\n`;
      text += `\nNext to learn (${result.adjacent.length}):\n`;
      for (const a of result.adjacent) text += `  → ${a}\n`;
      text += `\n${result.suggestion}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 5. Knowledge Compression ───

  server.tool(
    "soul_genius_compress",
    "Extract a principle from multiple facts. 1 principle > 100 facts.",
    {
      facts: z.array(z.string()).min(2).describe("List of related facts to compress into a principle"),
      domain: z.string().optional().describe("Domain"),
    },
    async ({ facts, domain }) => {
      const result = extractPrinciple(facts, domain);
      return { content: [{ type: "text" as const, text: `Compressed ${result.derivedFrom} facts into:\n\n${result.principle}` }] };
    }
  );

  server.tool(
    "soul_genius_principles",
    "See all extracted principles — compressed wisdom from your learning.",
    {
      domain: z.string().optional().describe("Filter by domain"),
    },
    async ({ domain }) => {
      const principles = getPrinciples(domain);
      if (principles.length === 0) {
        return { content: [{ type: "text" as const, text: "No principles yet. Use soul_genius_compress to extract patterns from facts." }] };
      }
      let text = `=== Principles ===\n\n`;
      for (const p of principles) {
        text += `[${p.domain}] ${p.principle} (used ${p.useCount}x)\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 6. Threshold Knowledge ───

  server.tool(
    "soul_genius_thresholds",
    "Find the 20% of knowledge that unlocks 80% understanding in a domain. Learn these first.",
    {
      domain: z.string().describe("Domain to find thresholds for"),
    },
    async ({ domain }) => {
      const result = getThresholdKnowledge(domain);
      let text = `=== Threshold Knowledge: ${domain} ===\n\n`;
      text += `${result.coverage}\n\n`;
      text += `Key concepts to master first:\n`;
      for (const t of result.thresholds) {
        text += `  ★ ${t}\n`;
      }
      text += `\n${result.suggestion}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 7. Diffuse Mode Assist ───

  server.tool(
    "soul_genius_stuck",
    "Tell Soul you're stuck. It will suggest the best technique to break through — sometimes the answer is to STOP thinking.",
    {
      minutesWorking: z.number().describe("How many minutes you've been working on this"),
      madeProgress: z.boolean().default(false).describe("Have you made any progress?"),
    },
    async ({ minutesWorking, madeProgress }) => {
      const result = detectStuck(minutesWorking, madeProgress);
      let text = result.isStuck
        ? `You're likely stuck in focused mode.\n\n${result.suggestion}`
        : result.suggestion;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 8. Teach-to-Learn ───

  server.tool(
    "soul_genius_teach",
    "Soul challenges you to teach a topic back. Teaching = learning 2x. Feynman Technique.",
    {
      topic: z.string().describe("Topic to teach back"),
    },
    async ({ topic }) => {
      const challenge = generateTeachChallenge(topic);
      let text = `=== Teach Challenge (${challenge.level}) ===\n\n`;
      text += `${challenge.challenge}\n\n`;
      text += `Criteria:\n`;
      for (const c of challenge.criteria) {
        text += `  □ ${c}\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 9. Learning Session ───

  server.tool(
    "soul_genius_session_start",
    "Start a learning session. Soul tracks your mood, progress, and breakthroughs.",
    {
      topic: z.string().describe("What you're learning"),
      mood: z.string().optional().describe("Your current mood (curious, stressed, tired, excited)"),
    },
    async ({ topic, mood }) => {
      const id = startLearningSession(topic, mood);
      let text = `Learning session #${id} started: ${topic}\n`;
      if (mood === "stressed" || mood === "tired") {
        text += `\nYou're ${mood}. Learning is 3x less effective when ${mood}. Consider a 5-min break first, or switch to easier material.`;
      } else if (mood === "curious" || mood === "excited") {
        text += `\nPerfect mood for learning! Curiosity × Flow = 5x learning speed.`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_genius_session_end",
    "End a learning session. Record breakthroughs and mood.",
    {
      sessionId: z.number().describe("Session ID"),
      mood: z.string().optional().describe("Your mood now"),
      breakthroughs: z.array(z.string()).optional().describe("Key insights or breakthroughs"),
    },
    async ({ sessionId, mood, breakthroughs }) => {
      endLearningSession(sessionId, mood, breakthroughs);
      let text = `Session #${sessionId} completed!`;
      if (breakthroughs && breakthroughs.length > 0) {
        text += `\n\nBreakthroughs:\n`;
        for (const b of breakthroughs) text += `  ★ ${b}\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 10. Genius Dashboard ───

  server.tool(
    "soul_genius_dashboard",
    "Your genius dashboard — reviews due, domains learned, principles extracted, learning streak.",
    {},
    async () => {
      const d = getGeniusDashboard();
      let text = `╔══════════════════════════════════════╗\n`;
      text += `║         GENIUS DASHBOARD              ║\n`;
      text += `╠══════════════════════════════════════╣\n`;
      text += `║  Reviews due:     ${String(d.reviewsDue).padEnd(18)}║\n`;
      text += `║  Domains learned: ${String(d.domainsLearned).padEnd(18)}║\n`;
      text += `║  Concepts mapped: ${String(d.totalConcepts).padEnd(18)}║\n`;
      text += `║  Principles:      ${String(d.principlesExtracted).padEnd(18)}║\n`;
      text += `║  Thresholds:      ${String(d.thresholdsMastered).padEnd(18)}║\n`;
      text += `║  Streak:          ${(d.streakDays + " days").padEnd(18)}║\n`;
      text += `╚══════════════════════════════════════╝\n`;

      if (d.topDomains.length > 0) {
        text += `\nTop domains:\n`;
        for (const td of d.topDomains) {
          const bar = "█".repeat(Math.min(20, td.concepts));
          text += `  ${td.domain.padEnd(15)} ${bar} ${td.concepts}\n`;
        }
      }

      if (d.reviewsDue > 0) {
        text += `\n⚡ You have ${d.reviewsDue} reviews due! Run soul_genius_review_due`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
