import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addKnowledge,
  getKnowledge,
  useKnowledge,
  updateKnowledge,
  getKnowledgeStats,
} from "../core/knowledge.js";

export function registerKnowledgeTools(server: McpServer) {
  server.tool(
    "soul_know",
    "Add knowledge to Soul's knowledge base — patterns, lessons, techniques, facts, principles, tips. Organized and searchable.",
    {
      title: z.string().describe("Knowledge title"),
      category: z
        .enum(["pattern", "lesson", "technique", "fact", "principle", "tip"])
        .describe("Category"),
      content: z.string().describe("The knowledge content"),
      source: z
        .string()
        .optional()
        .describe("Where this was learned (observation, master, research, experience, network)"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence level (0-1)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for searchability"),
    },
    async ({ title, category, content, source, confidence, tags }) => {
      const entry = await addKnowledge({ title, category, content, source, confidence, tags });
      return {
        content: [
          {
            type: "text" as const,
            text: `Knowledge added: "${title}" [${category}]\nConfidence: ${Math.round((confidence || 0.5) * 100)}%\nSource: ${source || "observation"}\n\nStored in Soul's knowledge base. Use soul_knowledge to browse.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_knowledge",
    "Browse Soul's knowledge base — search by category, keyword, or browse all. Knowledge gets stronger with use.",
    {
      category: z
        .string()
        .optional()
        .describe("Filter by category (pattern, lesson, technique, fact, principle, tip)"),
      search: z
        .string()
        .optional()
        .describe("Search keyword"),
      limit: z.number().default(20).describe("Max results"),
    },
    async ({ category, search, limit }) => {
      const entries = await getKnowledge(category, search, limit);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No knowledge found. Use soul_know to add patterns, lessons, and techniques.",
            },
          ],
        };
      }

      const text = entries
        .map(
          (e) =>
            `#${e.id} [${e.category}] "${e.title}" (${Math.round(e.confidence * 100)}%, used ${e.useCount}x)\n  ${e.content.substring(0, 120)}\n  Source: ${e.source}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Knowledge Base (${entries.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_knowledge_use",
    "Mark a knowledge entry as used — increases its confidence over time. Knowledge that gets used becomes stronger.",
    {
      id: z.number().describe("Knowledge entry ID"),
    },
    async ({ id }) => {
      const entry = await useKnowledge(id);
      if (!entry) {
        return {
          content: [
            { type: "text" as const, text: `Knowledge #${id} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `"${entry.title}" used (${entry.useCount}x, confidence: ${Math.round(entry.confidence * 100)}%)`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_knowledge_stats",
    "Knowledge base statistics — how much Soul knows, by category, confidence distribution.",
    {},
    async () => {
      const stats = await getKnowledgeStats();

      let text = `=== Knowledge Base Stats ===\n\n`;
      text += `Total entries: ${stats.total}\n`;
      text += `Average confidence: ${Math.round(stats.avgConfidence * 100)}%\n\n`;

      text += `By Category:\n`;
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        text += `  ${cat}: ${count}\n`;
      }

      if (stats.topUsed.length > 0) {
        text += `\nMost Used:\n`;
        stats.topUsed.forEach((e) => {
          text += `  "${e.title}" — ${e.useCount}x (${e.category})\n`;
        });
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
