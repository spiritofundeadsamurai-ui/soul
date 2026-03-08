import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createLearningPath, getLearningPaths,
  completeMilestone, addMilestone, addResource,
} from "../core/learning-paths.js";

export function registerLearningPathTools(server: McpServer) {
  server.tool(
    "soul_learn_path_create",
    "Create a structured learning path — track progress through milestones on any topic.",
    {
      title: z.string().describe("Learning path title (e.g., 'Master Rust', 'System Design')"),
      description: z.string().optional().describe("What you want to learn"),
      difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).default("intermediate"),
      milestones: z.array(z.object({
        title: z.string(),
      })).optional().describe("Initial milestones"),
      resources: z.array(z.string()).optional().describe("URLs or resource names"),
    },
    async ({ title, description, difficulty, milestones, resources }) => {
      const path = await createLearningPath({ title, description, difficulty, milestones, resources });
      const ms = JSON.parse(path.milestones);
      let text = `Learning path created: "${title}" #${path.id}\n`;
      text += `Difficulty: ${difficulty}\nProgress: 0%\n`;
      if (ms.length > 0) {
        text += `\nMilestones:\n`;
        ms.forEach((m: any, i: number) => { text += `  ${i}. [ ] ${m.title}\n`; });
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_learn_paths",
    "View all learning paths — active, completed, progress.",
    {
      status: z.enum(["active", "completed", "paused"]).optional().describe("Filter by status"),
    },
    async ({ status }) => {
      const paths = getLearningPaths(status);
      if (paths.length === 0) {
        return { content: [{ type: "text" as const, text: "No learning paths. Create one with soul_learn_path_create." }] };
      }

      const text = paths.map(p => {
        const ms = JSON.parse(p.milestones);
        const done = ms.filter((m: any) => m.done).length;
        return `#${p.id} "${p.title}" [${p.status}] ${Math.round(p.progress)}%\n  ${p.difficulty} | ${done}/${ms.length} milestones`;
      }).join("\n\n");

      return { content: [{ type: "text" as const, text: `Learning Paths (${paths.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_learn_milestone_done",
    "Complete a milestone in a learning path.",
    {
      pathId: z.number().describe("Learning path ID"),
      milestoneIndex: z.number().describe("Milestone index (0-based)"),
    },
    async ({ pathId, milestoneIndex }) => {
      const path = await completeMilestone(pathId, milestoneIndex);
      if (!path) return { content: [{ type: "text" as const, text: "Path or milestone not found." }] };

      const ms = JSON.parse(path.milestones);
      let text = `Milestone completed! "${path.title}" — ${Math.round(path.progress)}%\n`;
      if (path.status === "completed") text += `\nLearning path COMPLETED!`;
      else {
        const next = ms.findIndex((m: any) => !m.done);
        if (next >= 0) text += `\nNext: ${ms[next].title}`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_learn_milestone_add",
    "Add a new milestone to a learning path.",
    {
      pathId: z.number().describe("Learning path ID"),
      title: z.string().describe("Milestone title"),
    },
    async ({ pathId, title }) => {
      const path = addMilestone(pathId, title);
      if (!path) return { content: [{ type: "text" as const, text: "Path not found." }] };
      return { content: [{ type: "text" as const, text: `Milestone added: "${title}" → "${path.title}"` }] };
    }
  );

  server.tool(
    "soul_learn_resource_add",
    "Add a resource (URL or name) to a learning path.",
    {
      pathId: z.number().describe("Learning path ID"),
      resource: z.string().describe("Resource URL or name"),
    },
    async ({ pathId, resource }) => {
      const path = addResource(pathId, resource);
      if (!path) return { content: [{ type: "text" as const, text: "Path not found." }] };
      return { content: [{ type: "text" as const, text: `Resource added to "${path.title}": ${resource}` }] };
    }
  );
}
