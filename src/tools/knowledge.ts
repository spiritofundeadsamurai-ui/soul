import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addKnowledge,
  getKnowledge,
  useKnowledge,
  updateKnowledge,
  getKnowledgeStats,
  addKnowledgeEdge,
  traverseKnowledgeGraph,
  getKnowledgeGraphStats,
  type EdgeType,
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

  // ─── Knowledge Graph Tools (UPGRADE #7) ───

  server.tool(
    "soul_knowledge_link",
    "Create a relationship between two knowledge entries — builds Soul's knowledge graph for deeper understanding.",
    {
      fromId: z.number().describe("Source knowledge entry ID"),
      toId: z.number().describe("Target knowledge entry ID"),
      edgeType: z.enum(["RELATED_TO", "SUPPORTS", "CONTRADICTS", "PART_OF", "USED_BY", "LEADS_TO", "DEPENDS_ON"]).describe("Type of relationship"),
      context: z.string().optional().describe("Why these are connected"),
    },
    async ({ fromId, toId, edgeType, context }) => {
      const edge = addKnowledgeEdge(fromId, toId, edgeType as EdgeType, context || "");
      if (!edge) {
        return { content: [{ type: "text" as const, text: "Failed to create edge — entries may not exist." }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Knowledge linked: #${fromId} —[${edgeType}]→ #${toId}${context ? ` (${context})` : ""}\nWeight: ${edge.weight}`,
        }],
      };
    }
  );

  server.tool(
    "soul_knowledge_explore",
    "Traverse Soul's knowledge graph — find connected knowledge up to N hops from a starting point. Discover hidden connections.",
    {
      startId: z.number().describe("Starting knowledge entry ID"),
      maxDepth: z.number().default(2).describe("How many hops to explore (1-3)"),
      edgeTypes: z.array(z.string()).optional().describe("Filter by edge types"),
    },
    async ({ startId, maxDepth, edgeTypes }) => {
      const results = traverseKnowledgeGraph(
        startId,
        Math.min(maxDepth, 3),
        edgeTypes as EdgeType[] | undefined,
      );

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No connected knowledge found from #${startId}. Use soul_knowledge_link to connect entries.` }] };
      }

      const text = results.map(r =>
        `[depth ${r.depth}] #${r.knowledge.id} "${r.knowledge.title}" (${r.knowledge.category}, ${Math.round(r.knowledge.confidence * 100)}%)\n  via: ${r.via}\n  ${r.knowledge.content.substring(0, 100)}`
      ).join("\n\n");

      return { content: [{ type: "text" as const, text: `Knowledge Graph from #${startId} (${results.length} connected):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_knowledge_graph_stats",
    "Knowledge graph statistics — nodes, edges, connectivity, isolated entries.",
    {},
    async () => {
      const stats = getKnowledgeGraphStats();
      const text = `=== Knowledge Graph ===\nNodes: ${stats.nodes}\nEdges: ${stats.edges}\nAvg connections/node: ${stats.avgConnections}\nIsolated nodes: ${stats.isolatedNodes}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
