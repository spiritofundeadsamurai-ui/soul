import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  detectEmotion,
  logMood,
  getEmpatheticResponse,
  getMoodHistory,
  analyzeMoodTrends,
} from "../core/emotional-intelligence.js";

export function registerEmotionalTools(server: McpServer) {
  server.tool(
    "soul_mood",
    "Log your current mood — Soul tracks emotional patterns and provides empathetic support. Soul understands and cares.",
    {
      mood: z
        .enum(["happy", "sad", "angry", "anxious", "tired", "motivated", "confused", "grateful", "proud", "neutral"])
        .describe("Current mood"),
      intensity: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("How strong (1=slight, 10=overwhelming)"),
      context: z
        .string()
        .optional()
        .describe("What's happening that affects your mood"),
      triggers: z
        .string()
        .optional()
        .describe("What triggered this feeling"),
    },
    async ({ mood, intensity, context, triggers }) => {
      const entry = await logMood(mood, intensity, context || "", triggers);
      const empathy = getEmpatheticResponse(mood);

      let text = `Mood logged: ${mood} (${intensity}/10)\n\n`;
      text += `${empathy}\n`;

      if (entry.suggestion) {
        text += `\nSuggestion: ${entry.suggestion}`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_detect_emotion",
    "Detect emotion from text — Soul reads between the lines to understand how you're feeling.",
    {
      text: z.string().describe("Text to analyze for emotional content"),
    },
    async ({ text }) => {
      const { mood, confidence } = detectEmotion(text);

      if (confidence === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No strong emotion detected in this text. If you'd like to share how you're feeling, use soul_mood.",
          }],
        };
      }

      const empathy = getEmpatheticResponse(mood);

      return {
        content: [{
          type: "text" as const,
          text: `Detected: ${mood} (confidence: ${Math.round(confidence * 100)}%)\n\n${empathy}\n\nWould you like to log this mood? Use soul_mood.`,
        }],
      };
    }
  );

  server.tool(
    "soul_mood_history",
    "View mood history — see patterns in how you've been feeling over time.",
    {
      limit: z.number().default(20).describe("Number of entries"),
    },
    async ({ limit }) => {
      const entries = await getMoodHistory(limit);

      if (entries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No mood history yet. Use soul_mood to start tracking.",
          }],
        };
      }

      const text = entries
        .map(e => `[${e.createdAt}] ${e.mood} (${e.intensity}/10)${e.context ? `: ${e.context}` : ""}`)
        .join("\n");

      return {
        content: [{
          type: "text" as const,
          text: `Mood History (${entries.length}):\n\n${text}`,
        }],
      };
    }
  );

  server.tool(
    "soul_mood_analysis",
    "Analyze mood trends — dominant mood, stress level, trajectory. Soul helps you understand your emotional patterns.",
    {},
    async () => {
      const trends = await analyzeMoodTrends();

      let text = `=== Mood Analysis ===\n\n`;
      text += `Dominant mood: ${trends.dominantMood}\n`;
      text += `Average intensity: ${trends.avgIntensity.toFixed(1)}/10\n`;
      text += `Stress level: ${trends.stressLevel}\n`;
      text += `Recent trend: ${trends.recentTrend}\n\n`;

      text += `Distribution:\n`;
      for (const [mood, count] of Object.entries(trends.moodDistribution)) {
        text += `  ${mood}: ${count}\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
