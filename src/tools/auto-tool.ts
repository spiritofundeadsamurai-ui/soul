import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  analyzePatterns,
  createAutoTool,
  listSuggestions,
  approveSuggestion,
  rejectSuggestion,
  getAutoTool,
  checkAndSuggestAutoTools,
} from "../core/auto-tool-creator.js";

export function registerAutoToolTools(server: McpServer) {
  server.tool(
    "soul_auto_suggest",
    "Trigger pattern analysis and show auto-tool suggestions. Soul detects repeated tool usage patterns and suggests composite tools to automate them.",
    {
      threshold: z
        .number()
        .default(3)
        .describe("Minimum repeat count to trigger suggestion (default: 3)"),
    },
    async ({ threshold }) => {
      try {
        // First run the check to persist any new suggestions
        const newSuggestions = checkAndSuggestAutoTools();

        // Also run fresh analysis for display
        const allSuggestions = analyzePatterns();

        // Combine: new persistent suggestions + fresh analysis
        const display = allSuggestions.length > 0 ? allSuggestions : newSuggestions;

        if (display.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No repeated patterns detected yet. Keep using Soul tools — patterns will emerge over time.\n\nTip: Patterns are detected when you call the same tool with similar arguments 3+ times.",
              },
            ],
          };
        }

        let text = `Auto-Tool Suggestions (${display.length}):\n\n`;
        for (const s of display) {
          text += `[${s.status.toUpperCase()}] ${s.name}\n`;
          text += `  ${s.description}\n`;
          text += `  Sequence: ${s.toolSequence.join(" -> ")}\n`;
          text += `  Frequency: ${s.frequency}x | Confidence: ${(s.confidence * 100).toFixed(0)}%\n`;
          if (s.suggestedParams.length > 0) {
            text += `  Params: ${s.suggestedParams.map((p) => `${p.name}:${p.type}`).join(", ")}\n`;
          }
          text += "\n";
        }

        text += `Use soul_auto_approve to approve a suggestion, or soul_auto_list to see all.`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error analyzing patterns: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "soul_auto_approve",
    "Approve a suggested auto-tool for use. Auto-tools require master approval before they can be executed (safety gate). Use soul_auto_list to see IDs.",
    {
      id: z.number().describe("Auto-tool ID to approve"),
      action: z
        .enum(["approve", "reject"])
        .default("approve")
        .describe("Approve or reject the auto-tool"),
    },
    async ({ id, action }) => {
      try {
        if (action === "reject") {
          const result = rejectSuggestion(id);
          if (!result) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Auto-tool #${id} not found.`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Auto-tool "${result.name}" rejected. It will not be created.`,
              },
            ],
          };
        }

        // Approve: generate code and mark approved
        const tool = getAutoTool(id);
        if (!tool) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Auto-tool #${id} not found.`,
              },
            ],
          };
        }

        // Create the auto-tool (generates code, persists)
        const { toolName, code } = await createAutoTool(tool);

        // Now approve it
        const approved = approveSuggestion(id);

        return {
          content: [
            {
              type: "text" as const,
              text: `Auto-tool "${toolName}" APPROVED and created.\n\nSequence: ${tool.toolSequence.join(" -> ")}\nFrequency: ${tool.frequency}x | Confidence: ${(tool.confidence * 100).toFixed(0)}%\nStatus: APPROVED\n\nGenerated code (${code.split("\n").length} lines) is ready.\nThe tool chains existing soul tools safely.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "soul_auto_list",
    "List all auto-tools and their status (suggested, approved, created, rejected).",
    {
      status: z
        .enum(["all", "suggested", "approved", "created", "rejected"])
        .default("all")
        .describe("Filter by status"),
    },
    async ({ status }) => {
      try {
        const filter = status === "all" ? undefined : status;
        const tools = listSuggestions(filter);

        if (tools.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No auto-tools found${filter ? ` with status "${filter}"` : ""}.\n\nUse soul_auto_suggest to trigger pattern analysis.`,
              },
            ],
          };
        }

        let text = `Auto-Tools (${tools.length}):\n\n`;
        for (const t of tools) {
          text += `#${t.id} [${t.status.toUpperCase()}] ${t.name}\n`;
          text += `  ${t.description}\n`;
          text += `  Sequence: ${t.toolSequence.join(" -> ")}\n`;
          text += `  Frequency: ${t.frequency}x | Confidence: ${(t.confidence * 100).toFixed(0)}%\n\n`;
        }

        const counts = {
          suggested: tools.filter((t) => t.status === "suggested").length,
          approved: tools.filter((t) => t.status === "approved").length,
          created: tools.filter((t) => t.status === "created").length,
          rejected: tools.filter((t) => t.status === "rejected").length,
        };

        text += `Summary: ${counts.suggested} suggested, ${counts.approved} approved, ${counts.created} created, ${counts.rejected} rejected`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing auto-tools: ${error.message}`,
            },
          ],
        };
      }
    }
  );
}
