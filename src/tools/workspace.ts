import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  syncWorkspaceFiles,
  generateSoulMd,
  generateMemoryMd,
  generateDailyLog,
  getWorkspacePaths,
} from "../core/workspace-files.js";

export function registerWorkspaceTools(server: McpServer) {
  server.tool(
    "soul_workspace_sync",
    "Sync all workspace files — regenerate SOUL.md, MEMORY.md, goals.md, learnings.md, and today's daily log from SQLite to human-readable Markdown in ~/.soul/",
    {},
    async () => {
      const result = syncWorkspaceFiles();
      return text(`${result.message}\n\nFiles:\n${result.files.map(f => `  📄 ${f}`).join("\n")}`);
    }
  );

  server.tool(
    "soul_workspace_read",
    "Read a workspace file (SOUL.md, MEMORY.md, goals.md, learnings.md, or a daily log).",
    {
      file: z.enum(["soul", "memory", "goals", "learnings", "today"]).describe("Which file to read"),
    },
    async ({ file }) => {
      switch (file) {
        case "soul": return text(generateSoulMd());
        case "memory": return text(generateMemoryMd());
        case "goals": {
          const { generateGoalsMd } = await import("../core/workspace-files.js");
          return text(generateGoalsMd());
        }
        case "learnings": {
          const { generateLearningsMd } = await import("../core/workspace-files.js");
          return text(generateLearningsMd());
        }
        case "today": return text(generateDailyLog());
      }
    }
  );

  server.tool(
    "soul_workspace_log",
    "View the daily log for a specific date.",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format (default: today)"),
    },
    async ({ date }) => {
      return text(generateDailyLog(date));
    }
  );

  server.tool(
    "soul_workspace_paths",
    "Show all workspace file paths.",
    {},
    async () => {
      const paths = getWorkspacePaths();
      const lines = Object.entries(paths).map(([key, path]) => `  ${key}: ${path}`);
      return text(`Workspace Files:\n${lines.join("\n")}`);
    }
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
