import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  primeContext,
  chainOfThought,
  explainReasoning,
  addGrowthEntry,
  getGrowthJournal,
  getGrowthSummary,
  selfReview,
} from "../core/meta-intelligence.js";

export function registerMetaIntelligenceTools(server: McpServer) {

  server.tool(
    "soul_prime",
    "Deep-load everything Soul knows about a topic — memories, learnings, conversations, knowledge, people, specialist Souls. Use before diving into complex work.",
    {
      topic: z.string().describe("Topic to prime context for"),
    },
    async ({ topic }) => {
      const briefing = await primeContext(topic);
      return { content: [{ type: "text" as const, text: briefing }] };
    }
  );

  server.tool(
    "soul_reason",
    "Structured chain-of-thought reasoning — work through a question step by step with self-correction. Use for hard problems where you need to show your work.",
    {
      question: z.string().describe("Question or problem to reason through"),
      steps: z.array(z.string()).optional().describe("Pre-defined reasoning steps to verify (omit for general protocol)"),
    },
    async ({ question, steps }) => {
      const result = await chainOfThought(question, steps);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_explain",
    "Explain the reasoning behind a decision or action — show the 'why' to build trust. Master should understand not just WHAT you did, but WHY.",
    {
      decision: z.string().describe("What decision or action was taken"),
      context: z.string().describe("Context / situation that led to this"),
    },
    async ({ decision, context }) => {
      const result = await explainReasoning(decision, context);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_growth_add",
    "Add an entry to Soul's growth journal — milestones, insights, evolutions, reflections. Track how Soul grows over time.",
    {
      entryType: z.enum(["milestone", "insight", "evolution", "reflection"]).describe("Type of growth entry"),
      title: z.string().describe("Short title for the entry"),
      content: z.string().describe("Detailed content"),
    },
    async ({ entryType, title, content }) => {
      const result = await addGrowthEntry(entryType, title, content);
      return {
        content: [{
          type: "text" as const,
          text: `Growth journal entry added (#${result.id}): [${entryType}] ${title}`,
        }],
      };
    }
  );

  server.tool(
    "soul_growth",
    "View Soul's growth journal — see milestones, insights, and evolution over time.",
    {
      limit: z.number().default(20).describe("Number of entries to show"),
    },
    async ({ limit }) => {
      const entries = await getGrowthJournal(limit);

      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: "No growth journal entries yet. Use soul_growth_add to start tracking." }] };
      }

      let text = `Soul Growth Journal (${entries.length} entries):\n\n`;
      for (const e of entries) {
        const icon = e.entryType === "milestone" ? "[M]" :
                     e.entryType === "insight" ? "[I]" :
                     e.entryType === "evolution" ? "[E]" : "[R]";
        text += `${icon} ${e.createdAt.split("T")[0]} — ${e.title}\n`;
        text += `   ${e.content.substring(0, 150)}\n\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_growth_summary",
    "Overall growth summary — memory depth, learning quality, team diversity, maturity assessment.",
    {},
    async () => {
      const summary = await getGrowthSummary();
      return { content: [{ type: "text" as const, text: summary }] };
    }
  );

  server.tool(
    "soul_self_review",
    "Self-review output quality — check completeness, accuracy, clarity, usefulness, and honesty before presenting to master.",
    {
      output: z.string().describe("The output to review"),
      originalRequest: z.string().describe("What was originally asked"),
    },
    async ({ output, originalRequest }) => {
      const result = await selfReview(output, originalRequest);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
