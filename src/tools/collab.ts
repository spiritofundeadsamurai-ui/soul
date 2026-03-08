import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  shareExperience,
  startCollabSession,
  recordCollabOutcome,
  collectiveThink,
} from "../core/collaboration.js";

export function registerCollabTools(server: McpServer) {
  // soul_share — Share experience between Soul children
  server.tool(
    "soul_share",
    "Share a learning or experience from one Soul child to all others. Knowledge shared is knowledge multiplied.",
    {
      fromChild: z.string().describe("Name of the child sharing"),
      experience: z.string().describe("What was experienced/learned"),
      insight: z.string().describe("Key insight to share"),
    },
    async ({ fromChild, experience, insight }) => {
      const { sharedWith } = await shareExperience(
        fromChild,
        experience,
        insight
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${fromChild} shared with ${sharedWith.length > 0 ? sharedWith.join(", ") : "the family"}:\n\nExperience: ${experience}\nInsight: ${insight}\n\nThis knowledge is now available to all Soul children.`,
          },
        ],
      };
    }
  );

  // soul_collab — Start a collaborative session
  server.tool(
    "soul_collab",
    "Start a collaborative session — multiple Soul children work together on a task. They propose, challenge, improve, and reach consensus.",
    {
      task: z.string().describe("The task to collaborate on"),
      participants: z
        .array(z.string())
        .describe(
          "Names of Soul children to participate (or empty for all)"
        ),
    },
    async ({ task, participants }) => {
      const prompt = await startCollabSession(task, participants);
      return { content: [{ type: "text" as const, text: prompt }] };
    }
  );

  // soul_collab_result — Record outcome of collaboration
  server.tool(
    "soul_collab_result",
    "Record the outcome of a collaborative session — the solution and lessons learned become permanent wisdom.",
    {
      task: z.string().describe("The original task"),
      participants: z.array(z.string()).describe("Who participated"),
      solution: z.string().describe("The final solution reached"),
      lessonsLearned: z
        .array(z.string())
        .describe("Lessons learned during collaboration"),
    },
    async ({ task, participants, solution, lessonsLearned }) => {
      await recordCollabOutcome(task, participants, solution, lessonsLearned);

      return {
        content: [
          {
            type: "text" as const,
            text: `Collaboration recorded!\n\nTask: ${task}\nParticipants: ${participants.join(", ")}\nSolution: ${solution}\n\nLessons learned (${lessonsLearned.length}):\n${lessonsLearned.map((l) => `  - ${l}`).join("\n")}\n\nThis wisdom is now part of Soul's permanent memory.`,
          },
        ],
      };
    }
  );

  // soul_collective — Get all perspectives on a topic
  server.tool(
    "soul_collective",
    "Get collective thinking from all Soul children on a topic. Each child contributes their unique perspective based on their specialty.",
    {
      topic: z.string().describe("Topic to think about collectively"),
    },
    async ({ topic }) => {
      const result = await collectiveThink(topic);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
