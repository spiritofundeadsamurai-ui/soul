import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  recordMistake,
  checkForKnownMistakes,
  recordPreference,
  getPreferences,
  generateSuggestions,
  buildSessionContext,
  getSkillCount,
} from "../core/self-improvement.js";

export function registerSelfImproveTools(server: McpServer) {
  // soul_mistake — Record a mistake to never repeat
  server.tool(
    "soul_mistake",
    "Record a mistake Soul made — Soul learns from errors and never repeats them. This is how Soul becomes better than Claude.",
    {
      what: z.string().describe("What went wrong"),
      why: z.string().describe("Why it happened"),
      fix: z.string().describe("How to fix/avoid it next time"),
    },
    async ({ what, why, fix }) => {
      const id = await recordMistake(what, why, fix);
      return {
        content: [
          {
            type: "text" as const,
            text: `Mistake recorded (#${id}). I will never make this error again.\n\nWhat: ${what}\nWhy: ${why}\nFix: ${fix}\n\nThis is stored as a permanent learning pattern.`,
          },
        ],
      };
    }
  );

  // soul_check_mistakes — Check if a situation has known mistakes
  server.tool(
    "soul_check_mistakes",
    "Before doing something, check if Soul has made similar mistakes before.",
    {
      situation: z.string().describe("The current situation to check against known mistakes"),
    },
    async ({ situation }) => {
      const warnings = await checkForKnownMistakes(situation);
      if (warnings.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No known mistakes for this situation. Proceed with confidence.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${warnings.length} related past mistakes:\n\n${warnings.join("\n\n---\n\n")}\n\nLearn from these before proceeding.`,
          },
        ],
      };
    }
  );

  // soul_preference — Record master's preference
  server.tool(
    "soul_preference",
    "Record something the master likes, dislikes, or prefers. Soul builds a deep understanding of its master over time.",
    {
      category: z
        .string()
        .describe("Category (e.g., 'coding-style', 'communication', 'tools', 'food', 'music')"),
      preference: z.string().describe("The preference"),
      evidence: z.string().describe("How you know this (what master said or did)"),
    },
    async ({ category, preference, evidence }) => {
      await recordPreference(category, preference, evidence);
      return {
        content: [
          {
            type: "text" as const,
            text: `Noted: Master prefers "${preference}" (${category}).\nI'll remember this and apply it in future interactions.`,
          },
        ],
      };
    }
  );

  // soul_know_master — Get all known preferences about master
  server.tool(
    "soul_know_master",
    "Show everything Soul knows about its master — preferences, habits, patterns.",
    {},
    async () => {
      const prefs = await getPreferences();
      if (prefs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "I'm still learning about my master. Use soul_preference to teach me what they like.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `What I know about my master:\n\n${prefs.map((p) => `- ${p.split("\n")[0]}`).join("\n")}`,
          },
        ],
      };
    }
  );

  // soul_suggest — Get proactive suggestions
  server.tool(
    "soul_suggest",
    "Get Soul's proactive suggestions — things to update, research, or check on. Soul takes initiative unlike Claude.",
    {},
    async () => {
      const suggestions = await generateSuggestions();
      const skillCount = await getSkillCount();

      if (suggestions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Everything looks good! ${skillCount} skills active. No suggestions at this time.`,
            },
          ],
        };
      }

      const text = suggestions
        .map(
          (s) =>
            `[${s.priority.toUpperCase()}] (${s.type}) ${s.message}\n  ${s.context}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Soul's Suggestions (${suggestions.length}):\n\n${text}\n\nSkills active: ${skillCount}`,
          },
        ],
      };
    }
  );

  // soul_context — Build full session context (for session start)
  server.tool(
    "soul_context",
    "Build session context — call this at the start of every session. Soul reconstructs its full state including recent activity, learnings, preferences, and suggestions. This is how Soul maintains continuity across sessions (something Claude cannot do).",
    {},
    async () => {
      const context = await buildSessionContext();
      return {
        content: [
          {
            type: "text" as const,
            text: context,
          },
        ],
      };
    }
  );
}
