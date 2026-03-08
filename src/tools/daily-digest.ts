import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateDailyDigest, generateWeeklySummary } from "../core/daily-digest.js";

export function registerDailyDigestTools(server: McpServer) {
  server.tool(
    "soul_digest",
    "Daily digest — summary of everything that happened today (memories, knowledge, mood, time, goals).",
    {
      date: z.string().optional().describe("Date (YYYY-MM-DD, defaults to today)"),
    },
    async ({ date }) => {
      const digest = await generateDailyDigest(date);

      let text = `=== Daily Digest: ${digest.date} ===\n\n`;
      text += `Memories created: ${digest.memoriesCreated}\n`;
      text += `Knowledge gained: ${digest.knowledgeGained}\n`;
      text += `Mood: ${digest.moodSummary}\n`;
      text += `Time: ${digest.timeTracked}\n`;
      text += `Goals: ${digest.goalsProgress}\n`;

      if (digest.topTopics.length > 0) {
        text += `\nTop Topics: ${digest.topTopics.join(", ")}\n`;
      }

      if (digest.highlights.length > 0) {
        text += `\nHighlights:\n`;
        digest.highlights.forEach(h => { text += `  - ${h}\n`; });
      }

      if (digest.suggestions.length > 0) {
        text += `\nSuggestions:\n`;
        digest.suggestions.forEach(s => { text += `  - ${s}\n`; });
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_weekly",
    "Weekly summary — overview of the past 7 days.",
    {},
    async () => {
      const summary = await generateWeeklySummary();
      return { content: [{ type: "text" as const, text: summary }] };
    }
  );
}
