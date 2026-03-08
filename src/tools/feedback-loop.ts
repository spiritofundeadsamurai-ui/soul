import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  recordFeedback,
  getFeedbackPatterns,
  getFeedbackStats,
  getFeedbackLearnings,
} from "../core/feedback-loop.js";

export function registerFeedbackLoopTools(server: McpServer) {

  server.tool(
    "soul_feedback",
    "Give feedback on Soul's response — rate quality, note what was good/bad. Soul learns from this like RLHF. The more feedback, the better Soul gets.",
    {
      context: z.string().describe("What was Soul doing? (e.g. 'answered question about X')"),
      rating: z.number().min(1).max(5).describe("Rating 1-5 (1=terrible, 5=perfect)"),
      category: z.enum(["accuracy", "helpfulness", "tone", "speed", "creativity", "clarity", "depth", "general"]).default("general").describe("What aspect to rate"),
      comment: z.string().optional().describe("Specific feedback — what was good/bad?"),
    },
    async ({ context, rating, category, comment }) => {
      const { feedback, insight } = await recordFeedback({ context, rating, category, comment });
      const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
      return {
        content: [{
          type: "text" as const,
          text: `Feedback recorded ${stars}\n\nCategory: ${category}\n${comment ? `Comment: ${comment}\n` : ""}Action: ${feedback.actionTaken}\nInsight: ${insight}`,
        }],
      };
    }
  );

  server.tool(
    "soul_feedback_patterns",
    "See what Soul has learned from all feedback — patterns by category, trends, what master likes/dislikes.",
    {},
    async () => {
      const learnings = getFeedbackLearnings();
      return { content: [{ type: "text" as const, text: learnings }] };
    }
  );

  server.tool(
    "soul_feedback_stats",
    "Feedback dashboard — overall rating, positive/negative rate, improving/declining areas.",
    {},
    async () => {
      const stats = getFeedbackStats();

      let text = `=== Feedback Dashboard ===\n\n`;
      text += `Total feedback: ${stats.totalFeedback}\n`;
      text += `Average rating: ${stats.avgRating}/5\n`;
      text += `Positive (4-5): ${stats.positiveRate}%\n`;
      text += `Negative (1-2): ${stats.negativeRate}%\n\n`;

      if (stats.improvingAreas.length > 0) {
        text += `Improving: ${stats.improvingAreas.join(", ")} ↑\n`;
      }
      if (stats.decliningAreas.length > 0) {
        text += `Needs work: ${stats.decliningAreas.join(", ")} ↓\n`;
      }

      if (stats.recentFeedback.length > 0) {
        text += `\nRecent:\n`;
        for (const f of stats.recentFeedback) {
          text += `  ${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)} [${f.category}] ${f.comment || f.context.substring(0, 60)}\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
