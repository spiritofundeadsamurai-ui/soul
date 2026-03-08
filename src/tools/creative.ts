import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createWriting,
  updateWriting,
  getWritings,
  createLesson,
  empathize,
  helpCommunicate,
} from "../core/creative.js";

export function registerCreativeTools(server: McpServer) {
  // === Writing ===

  server.tool(
    "soul_write",
    "Start a writing project — story, poem, essay, speech, blog post, script, song, letter, anything creative. Soul stores your work persistently.",
    {
      title: z.string().describe("Title of the piece"),
      genre: z
        .string()
        .describe(
          "Genre/type (story, poem, essay, speech, blog, script, song, letter, report, etc.)"
        ),
      content: z
        .string()
        .optional()
        .describe("Initial content/draft"),
      notes: z
        .string()
        .optional()
        .describe("Notes, ideas, outline"),
    },
    async ({ title, genre, content, notes }) => {
      const writing = await createWriting({ title, genre, content, notes });
      return {
        content: [
          {
            type: "text" as const,
            text: `Writing project #${writing.id} created: "${title}" (${genre})\n${content ? `Draft saved (${content.length} chars)` : "No content yet"}\n${notes ? `Notes: ${notes}` : ""}\n\nUse soul_write_update to continue working on it.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_write_update",
    "Continue writing — update content of a writing project.",
    {
      id: z.number().describe("Writing project ID"),
      content: z.string().describe("Updated content"),
      notes: z.string().optional().describe("Updated notes"),
    },
    async ({ id, content, notes }) => {
      const writing = await updateWriting(id, content, notes);
      if (!writing) {
        return {
          content: [
            { type: "text" as const, text: `Writing #${id} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `"${writing.title}" updated (${writing.content.length} chars).\nLast modified: ${writing.updatedAt}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_writings",
    "List all writing projects.",
    {
      genre: z.string().optional().describe("Filter by genre"),
    },
    async ({ genre }) => {
      const writings = await getWritings(genre);

      if (writings.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No writing projects yet. Use soul_write to start creating.",
            },
          ],
        };
      }

      const text = writings
        .map(
          (w) =>
            `#${w.id} "${w.title}" (${w.genre}) — ${w.content.length} chars\n  Status: ${w.status} | Updated: ${w.updatedAt}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Writing Projects (${writings.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Teaching ===

  server.tool(
    "soul_teach_me",
    "Ask Soul to teach you anything — any topic, any level. Soul adapts to beginner/intermediate/advanced/child level. Not just code — history, science, cooking, philosophy, anything.",
    {
      topic: z
        .string()
        .describe("What you want to learn about"),
      level: z
        .enum(["child", "beginner", "intermediate", "advanced"])
        .default("beginner")
        .describe("Your current level"),
      style: z
        .string()
        .optional()
        .describe(
          "Preferred teaching style (visual, examples-first, theory-first, socratic, storytelling)"
        ),
    },
    async ({ topic, level, style }) => {
      const lesson = await createLesson(topic, level, style);
      return { content: [{ type: "text" as const, text: lesson }] };
    }
  );

  // === Emotional Intelligence ===

  server.tool(
    "soul_feel",
    "Talk to Soul about how you feel — Soul listens with empathy and provides genuine emotional support. Not therapy, but a caring companion.",
    {
      situation: z
        .string()
        .describe("What's happening / what's on your mind"),
      emotion: z
        .string()
        .optional()
        .describe(
          "How you feel (sad, angry, anxious, overwhelmed, lonely, frustrated, confused, happy, grateful, hopeful)"
        ),
    },
    async ({ situation, emotion }) => {
      const response = await empathize(situation, emotion);
      return { content: [{ type: "text" as const, text: response }] };
    }
  );

  // === Communication ===

  server.tool(
    "soul_communicate",
    "Help craft the perfect message — email, speech, presentation, social post, difficult conversation. Soul helps you say what you mean.",
    {
      message: z
        .string()
        .describe("What you want to say / the main point"),
      audience: z
        .string()
        .describe(
          "Who is this for? (boss, friend, client, partner, public, team, etc.)"
        ),
      tone: z
        .string()
        .describe(
          "Desired tone (professional, casual, formal, persuasive, empathetic, direct, inspiring)"
        ),
      medium: z
        .string()
        .describe(
          "Communication medium (email, message, presentation, speech, social media, letter)"
        ),
    },
    async ({ message, audience, tone, medium }) => {
      const result = await helpCommunicate(message, audience, tone, medium);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
