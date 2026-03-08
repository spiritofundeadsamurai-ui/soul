import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyFramework,
  listFrameworks,
  brainstorm,
  decomposeProblem,
  evaluateArgument,
  recordDecision,
  recordOutcome,
  getDecisions,
  type FrameworkType,
} from "../core/thinking.js";

export function registerThinkingTools(server: McpServer) {
  // === Thinking Frameworks ===

  server.tool(
    "soul_think_framework",
    "Apply a structured thinking framework to any problem — not just code. SWOT, pros/cons, 5 whys, first principles, six hats, decision matrix, second-order thinking, inversion, analogy.",
    {
      framework: z
        .enum([
          "swot",
          "pros_cons",
          "five_whys",
          "first_principles",
          "six_hats",
          "decision_matrix",
          "second_order",
          "inversion",
          "analogy",
        ])
        .describe("Which thinking framework to apply"),
      topic: z
        .string()
        .describe(
          "The topic/problem/decision to analyze (any domain — business, life, relationships, career, etc.)"
        ),
    },
    async ({ framework, topic }) => {
      const result = await applyFramework(framework as FrameworkType, topic);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_frameworks",
    "List all available thinking frameworks — see which analytical tool fits your situation.",
    {},
    async () => {
      const frameworks = listFrameworks();
      const text = frameworks
        .map((f) => `**${f.name}** (${f.type})\n  ${f.description}`)
        .join("\n\n");
      return {
        content: [
          {
            type: "text" as const,
            text: `Available Thinking Frameworks (${frameworks.length}):\n\n${text}\n\nUse soul_think_framework with any of these to analyze your situation.`,
          },
        ],
      };
    }
  );

  // === Brainstorming ===

  server.tool(
    "soul_brainstorm",
    "Creative brainstorming session — generate ideas for anything. Business, art, solutions, gifts, names, strategies, anything.",
    {
      topic: z.string().describe("What to brainstorm about"),
      constraints: z
        .string()
        .optional()
        .describe("Any constraints or requirements to consider"),
    },
    async ({ topic, constraints }) => {
      const result = await brainstorm(topic, constraints);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // === Problem Decomposition ===

  server.tool(
    "soul_decompose",
    "Break down any complex problem into manageable pieces — works for life problems, business challenges, personal issues, not just technical ones.",
    {
      problem: z.string().describe("The problem to decompose"),
      domain: z
        .string()
        .optional()
        .describe(
          "Problem domain (e.g., career, health, finance, relationships, business, education)"
        ),
    },
    async ({ problem, domain }) => {
      const result = await decomposeProblem(problem, domain);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // === Critical Thinking ===

  server.tool(
    "soul_evaluate",
    "Evaluate an argument or claim critically — check logic, evidence quality, biases, and counter-arguments.",
    {
      claim: z
        .string()
        .describe("The claim or argument to evaluate"),
      evidence: z
        .array(z.string())
        .describe("Evidence or reasons supporting the claim"),
    },
    async ({ claim, evidence }) => {
      const result = await evaluateArgument(claim, evidence);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // === Decision Journal ===

  server.tool(
    "soul_decide",
    "Record a decision in your decision journal — track what you chose, why, and later whether it worked out. Learn from past decisions.",
    {
      topic: z.string().describe("What the decision is about"),
      options: z
        .array(z.string())
        .describe("Available options/alternatives"),
      reasoning: z
        .string()
        .describe("Why you're leaning toward your choice"),
      chosen: z.string().describe("Which option you chose"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("How confident are you? (0=guess, 1=certain)"),
    },
    async ({ topic, options, reasoning, chosen, confidence }) => {
      const decision = await recordDecision({
        topic,
        options,
        reasoning,
        chosen,
        confidence,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Decision #${decision.id} recorded.\n\nTopic: ${topic}\nChosen: "${chosen}" (confidence: ${Math.round(confidence * 100)}%)\nOptions: ${options.join(", ")}\n\nCome back later with soul_decision_outcome to record how it turned out — that's how we learn.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_decision_outcome",
    "Record the outcome of a past decision — Soul learns from results to give better advice in the future.",
    {
      decisionId: z.number().describe("Decision ID"),
      outcome: z
        .string()
        .describe("What actually happened? Was it a good decision?"),
    },
    async ({ decisionId, outcome }) => {
      const decision = await recordOutcome(decisionId, outcome);
      if (!decision) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Decision #${decisionId} not found.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Decision #${decision.id} outcome recorded.\n\nTopic: ${decision.topic}\nChose: "${decision.chosen}"\nOutcome: ${outcome}\n\nSoul has learned from this experience.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_decisions",
    "Review your decision history — see past decisions and their outcomes. Learn patterns in your decision-making.",
    {
      limit: z
        .number()
        .default(10)
        .describe("How many recent decisions to show"),
    },
    async ({ limit }) => {
      const decisions = await getDecisions(limit);

      if (decisions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No decisions recorded yet. Use soul_decide to start tracking your decisions.",
            },
          ],
        };
      }

      const text = decisions
        .map((d) => {
          let entry = `#${d.id} [${Math.round(d.confidence * 100)}%] ${d.topic}\n  Chose: "${d.chosen}"`;
          if (d.outcome) {
            entry += `\n  Outcome: ${d.outcome}`;
          } else {
            entry += `\n  (awaiting outcome)`;
          }
          return entry;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Decision Journal (${decisions.length} entries):\n\n${text}`,
          },
        ],
      };
    }
  );
}
