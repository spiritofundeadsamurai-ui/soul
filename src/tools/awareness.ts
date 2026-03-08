import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  introspect,
  ethicalAnalysis,
  metacognize,
  anticipateNeeds,
  contextCheck,
} from "../core/awareness.js";

export function registerAwarenessTools(server: McpServer) {
  server.tool(
    "soul_introspect",
    "Soul examines itself honestly — what it knows well, what it's uncertain about, and its limitations. Radical self-awareness.",
    {},
    async () => {
      const result = await introspect();
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_ethics",
    "Analyze an ethical dilemma — examine a situation through multiple ethical frameworks. Soul helps you think through tough choices without telling you what to do.",
    {
      situation: z
        .string()
        .describe("The ethical situation or dilemma"),
      options: z
        .array(z.string())
        .describe("The available choices/options"),
    },
    async ({ situation, options }) => {
      const result = await ethicalAnalysis(situation, options);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_metacognize",
    "Think about thinking — examine a thought for biases, assumptions, and alternative interpretations. Intellectual humility in action.",
    {
      thought: z
        .string()
        .describe("The thought or belief to examine"),
      context: z
        .string()
        .optional()
        .describe("Context in which this thought arose"),
    },
    async ({ thought, context }) => {
      const result = await metacognize(thought, context);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_anticipate",
    "Soul proactively checks for things that need attention — stale goals, breaking habit streaks, blocked tasks, pending decisions. Like a caring assistant who notices before you ask.",
    {},
    async () => {
      const result = await anticipateNeeds();
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "soul_context_check",
    "Check content for cultural sensitivity, inclusivity, and appropriate tone. Make sure your message lands well with your audience.",
    {
      content: z
        .string()
        .describe("The content to check"),
      audience: z
        .string()
        .describe("Who will receive this"),
      culture: z
        .string()
        .optional()
        .describe(
          "Specific cultural context to consider"
        ),
    },
    async ({ content, audience, culture }) => {
      const result = await contextCheck(content, audience, culture);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
