import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createExecutableSkill,
  approveSkill,
  evolveSkill,
  getExecutableSkills,
  getExecutionHistory,
} from "../core/skill-executor.js";

export function registerSkillExecutorTools(server: McpServer) {
  server.tool(
    "soul_skill_create",
    "Create an executable skill — Soul can build tools for itself. Requires master approval before use. Soul CANNOT modify its own core (philosophy, master binding).",
    {
      name: z.string().describe("Skill name (unique)"),
      description: z
        .string()
        .describe("What this skill does"),
      skillType: z
        .enum(["script", "workflow", "template", "automation"])
        .default("script")
        .describe("Type of skill"),
      code: z.string().describe("The skill code"),
      language: z
        .enum(["typescript", "javascript", "shell", "workflow"])
        .default("typescript")
        .describe("Programming language"),
    },
    async ({ name, description, skillType, code, language }) => {
      try {
        const skill = await createExecutableSkill({
          name,
          description,
          skillType,
          code,
          language,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill "${name}" created (v${skill.version})\nType: ${skillType} | Language: ${language}\nStatus: AWAITING APPROVAL\n\nMaster must use soul_skill_approve to activate this skill.\nSafety: Soul verified this skill doesn't modify core files.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `SAFETY BLOCK: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "soul_skill_approve",
    "Approve an executable skill for use — only master can approve. This is the safety gate.",
    {
      skillId: z.number().describe("Skill ID to approve"),
    },
    async ({ skillId }) => {
      const skill = await approveSkill(skillId);
      if (!skill) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill #${skillId} not found.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${skill.name}" APPROVED by master.\nIt can now be executed. Use with confidence.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_skill_evolve",
    "Improve an existing skill — Soul can upgrade its own tools. Evolved skills require re-approval (safety). Cannot touch core files.",
    {
      skillId: z.number().describe("Skill ID to evolve"),
      newCode: z.string().describe("Improved code"),
      reason: z
        .string()
        .describe("Why this improvement is needed"),
    },
    async ({ skillId, newCode, reason }) => {
      try {
        const skill = await evolveSkill(skillId, newCode, reason);
        if (!skill) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Skill #${skillId} not found.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill "${skill.name}" evolved to v${skill.version}\nReason: ${reason}\nStatus: AWAITING RE-APPROVAL\n\nSelf-improvement preserved Soul's core integrity.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `SAFETY BLOCK: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "soul_skill_list",
    "List all executable skills — see what Soul can do.",
    {
      approvedOnly: z
        .boolean()
        .default(false)
        .describe("Show only approved skills"),
    },
    async ({ approvedOnly }) => {
      const skills = await getExecutableSkills(approvedOnly);

      if (skills.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No executable skills yet. Use soul_skill_create to build Soul's capabilities.",
            },
          ],
        };
      }

      const text = skills
        .map(
          (s) =>
            `#${s.id} "${s.name}" v${s.version} (${s.skillType}/${s.language})\n  ${s.description}\n  Status: ${s.isApproved ? "APPROVED" : "PENDING"} | Runs: ${s.runCount}${s.lastRunAt ? ` | Last: ${s.lastRunAt}` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Executable Skills (${skills.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_skill_history",
    "View execution history of skills — see what ran, when, and whether it succeeded.",
    {
      skillId: z
        .number()
        .optional()
        .describe("Filter by skill ID"),
      limit: z
        .number()
        .default(20)
        .describe("Number of entries"),
    },
    async ({ skillId, limit }) => {
      const logs = await getExecutionHistory(skillId, limit);

      if (logs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No execution history yet.",
            },
          ],
        };
      }

      const text = logs
        .map(
          (l) =>
            `#${l.id} [Skill ${l.skillId}] ${l.success ? "OK" : "FAIL"} (${l.duration}ms)\n  ${l.executedAt}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Execution History (${logs.length}):\n\n${text}`,
          },
        ],
      };
    }
  );
}
