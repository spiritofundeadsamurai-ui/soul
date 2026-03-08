import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  collectTrainingPair,
  rateTrainingPair,
  exportTrainingData,
  getDistillStats,
  getRecentPairs,
  pruneLowQuality,
} from "../core/distillation.js";

export function registerDistillationTools(server: McpServer) {

  server.tool(
    "soul_distill_collect",
    "Collect a Q&A pair for training Soul's own model. Soul learns from every high-quality interaction.",
    {
      userMessage: z.string().describe("The question/input"),
      assistantResponse: z.string().describe("The high-quality answer"),
      teacherModel: z.string().optional().describe("Which model generated this (e.g. 'claude-opus-4-6')"),
      category: z.string().optional().describe("Category: coding, reasoning, math, creative, knowledge, planning, conversation"),
      qualityScore: z.number().min(1).max(10).optional().describe("Manual quality score 1-10"),
    },
    async ({ userMessage, assistantResponse, teacherModel, category, qualityScore }) => {
      const result = collectTrainingPair({
        userMessage,
        assistantResponse,
        teacherModel,
        category,
        qualityScore,
      });
      return {
        content: [{ type: "text" as const, text: `Training pair #${result.id} collected (total: ${result.totalPairs})` }],
      };
    }
  );

  server.tool(
    "soul_distill_rate",
    "Rate a training pair's quality. Higher quality pairs produce better fine-tuned models.",
    {
      id: z.number().describe("Training pair ID"),
      score: z.number().min(1).max(10).describe("Quality score 1-10"),
      verified: z.boolean().default(false).describe("Mark as human-verified"),
    },
    async ({ id, score, verified }) => {
      const ok = rateTrainingPair(id, score, verified);
      return {
        content: [{ type: "text" as const, text: ok ? `Pair #${id} rated ${score}/10${verified ? " (verified)" : ""}` : `Pair #${id} not found.` }],
      };
    }
  );

  server.tool(
    "soul_distill_export",
    "Export training data as JSONL for fine-tuning. Supports ChatML, Alpaca, ShareGPT formats. Use this data with Unsloth/Axolotl/LLaMA-Factory to train Soul's own model.",
    {
      minQuality: z.number().min(1).max(10).default(6).describe("Minimum quality score to include"),
      verifiedOnly: z.boolean().default(false).describe("Only export human-verified pairs"),
      category: z.string().optional().describe("Filter by category"),
      format: z.enum(["chatml", "alpaca", "sharegpt"]).default("chatml").describe("Output format"),
      savePath: z.string().optional().describe("Save to file path (optional, otherwise returns data)"),
    },
    async ({ minQuality, verifiedOnly, category, format, savePath }) => {
      const result = exportTrainingData({ minQuality, verifiedOnly, category, format });

      if (result.count === 0) {
        return {
          content: [{ type: "text" as const, text: `No training data matches filters (minQuality=${minQuality}, verified=${verifiedOnly}).` }],
        };
      }

      if (savePath) {
        const { writeFileSync } = await import("fs");
        const { safePath } = await import("../core/security.js");
        const { join } = await import("path");
        const { homedir } = await import("os");
        // SECURITY: restrict writes to ~/.soul/ directory
        const safeOutputPath = safePath(savePath, join(homedir(), ".soul"));
        writeFileSync(safeOutputPath, result.data, "utf-8");
        return {
          content: [{ type: "text" as const, text: `Exported ${result.count} pairs to ${safeOutputPath} (${format} format)\n\nTo fine-tune:\n  pip install unsloth\n  # See: https://github.com/unslothai/unsloth` }],
        };
      }

      // Return first few lines + summary
      const preview = result.data.split("\n").slice(0, 3).join("\n");
      return {
        content: [{ type: "text" as const, text: `=== Export: ${result.count} pairs (${format}) ===\n\nPreview:\n${preview}\n\n... (${result.count} total)\n\nUse savePath to write to file.` }],
      };
    }
  );

  server.tool(
    "soul_distill_stats",
    "See distillation progress — how many training pairs collected, quality breakdown, readiness for fine-tuning.",
    {},
    async () => {
      const stats = getDistillStats();

      let text = `=== Distillation Stats ===\n\n`;
      text += `Total pairs: ${stats.totalPairs}\n`;
      text += `Verified: ${stats.verifiedPairs}\n`;
      text += `Avg quality: ${stats.avgQuality}/10\n`;
      text += `Ready for export (quality >= 6): ${stats.readyForExport}\n`;
      text += `Est. fine-tune time: ${stats.estimatedTrainTime}\n\n`;

      if (Object.keys(stats.byCategory).length > 0) {
        text += `By category:\n`;
        for (const [cat, count] of Object.entries(stats.byCategory)) {
          text += `  ${cat}: ${count}\n`;
        }
      }

      if (Object.keys(stats.byTeacher).length > 0) {
        text += `\nBy teacher model:\n`;
        for (const [model, count] of Object.entries(stats.byTeacher)) {
          text += `  ${model}: ${count}\n`;
        }
      }

      // Milestones
      text += `\n── Milestones ──\n`;
      const pairs = stats.totalPairs;
      const milestones = [100, 500, 1000, 5000, 10000, 50000];
      for (const m of milestones) {
        const done = pairs >= m;
        const bar = done ? "████████████████████" : "█".repeat(Math.min(20, Math.round((pairs / m) * 20)));
        const pad = " ".repeat(20 - bar.length);
        text += `  ${done ? "✓" : "○"} ${String(m).padEnd(6)} ${bar}${pad} ${done ? "DONE" : `${pairs}/${m}`}\n`;
      }

      text += `\n100 pairs = basic personality\n`;
      text += `1,000 pairs = good at your domain\n`;
      text += `10,000 pairs = expert-level responses\n`;
      text += `50,000 pairs = approaching teacher quality\n`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_distill_review",
    "Review recent training pairs — see what Soul has collected for learning.",
    {
      limit: z.number().default(10).describe("Number of pairs to show"),
    },
    async ({ limit }) => {
      const pairs = getRecentPairs(limit);
      if (pairs.length === 0) {
        return { content: [{ type: "text" as const, text: "No training pairs yet. Start collecting with soul_distill_collect." }] };
      }

      let text = `=== Recent Training Pairs ===\n\n`;
      for (const p of pairs) {
        text += `#${p.id} [${p.category}] Q=${p.qualityScore}/10 ${p.isVerified ? "✓" : ""} (${p.teacherModel})\n`;
        text += `  Q: ${p.userMessage.substring(0, 80)}...\n`;
        text += `  A: ${p.assistantResponse.substring(0, 80)}...\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_distill_prune",
    "Delete low-quality training pairs that would hurt fine-tuning.",
    {
      maxScore: z.number().min(1).max(5).default(3).describe("Delete pairs with score <= this"),
    },
    async ({ maxScore }) => {
      const removed = pruneLowQuality(maxScore);
      return {
        content: [{ type: "text" as const, text: `Pruned ${removed} low-quality pairs (score <= ${maxScore}).` }],
      };
    }
  );
}
