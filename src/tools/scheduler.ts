import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createJob,
  listJobs,
  toggleJob,
  logJobRun,
  generateBriefing,
  healthCheck,
  logQuality,
  getQualityTrend,
  consolidateMemories,
} from "../core/scheduler.js";

export function registerSchedulerTools(server: McpServer) {
  // === Scheduled Jobs ===

  server.tool(
    "soul_job_create",
    "Create a scheduled job — Soul runs periodic tasks automatically. Heartbeats, health checks, briefings, memory consolidation, or custom tasks.",
    {
      name: z.string().describe("Job name (unique)"),
      description: z.string().describe("What this job does"),
      schedule: z
        .string()
        .describe("Cron expression (e.g., '0 7 * * *' for daily 7am, '*/30 * * * *' for every 30min)"),
      jobType: z
        .enum(["heartbeat", "briefing", "health", "memory", "custom"])
        .default("custom")
        .describe("Job category"),
      payload: z
        .string()
        .optional()
        .describe("What to do when triggered"),
    },
    async ({ name, description, schedule, jobType, payload }) => {
      const job = await createJob({ name, description, schedule, jobType, payload });
      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${name}" created (${schedule})\nType: ${jobType}\n${description}\n\nSoul will run this on schedule. Use soul_jobs to see all scheduled jobs.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_jobs",
    "List all scheduled jobs — see what Soul does automatically.",
    {
      enabledOnly: z
        .boolean()
        .default(false)
        .describe("Show only enabled jobs"),
    },
    async ({ enabledOnly }) => {
      const jobs = await listJobs(enabledOnly);

      if (jobs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No scheduled jobs. Use soul_job_create to set up automated tasks.",
            },
          ],
        };
      }

      const text = jobs
        .map(
          (j) =>
            `${j.enabled ? "+" : "-"} #${j.id} "${j.name}" (${j.jobType})\n  Schedule: ${j.schedule}\n  ${j.description}\n  Last: ${j.lastStatus || "never"} | Runs: ${j.runCount}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Scheduled Jobs (${jobs.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_job_toggle",
    "Enable or disable a scheduled job.",
    {
      jobId: z.number().describe("Job ID"),
      enabled: z.boolean().describe("Enable or disable"),
    },
    async ({ jobId, enabled }) => {
      const job = await toggleJob(jobId, enabled);
      if (!job) {
        return {
          content: [
            { type: "text" as const, text: `Job #${jobId} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${job.name}" ${enabled ? "enabled" : "disabled"}.`,
          },
        ],
      };
    }
  );

  // === Morning Briefing ===

  server.tool(
    "soul_briefing",
    "Generate a daily briefing — memory status, recent activity, pending items, active jobs. Like a personal assistant's morning report.",
    {},
    async () => {
      const briefing = await generateBriefing();
      return { content: [{ type: "text" as const, text: briefing }] };
    }
  );

  // === Health Check ===

  server.tool(
    "soul_health",
    "Run a comprehensive health check — database, memory growth, learning quality, job status. Self-healing diagnostics.",
    {},
    async () => {
      const result = await healthCheck();

      let text = `=== Soul Health: ${result.status.toUpperCase()} ===\n\n`;
      result.checks.forEach((c) => {
        const icon = c.status === "ok" ? "[OK]" : c.status === "warning" ? "[!!]" : "[XX]";
        text += `${icon} ${c.name}: ${c.detail}\n`;
      });

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // === Quality Self-Evaluation ===

  server.tool(
    "soul_quality",
    "Daily self-evaluation — Soul rates its own helpfulness. Tracks quality trends over time to continuously improve.",
    {
      score: z
        .number()
        .min(1)
        .max(5)
        .describe("Quality score (1=poor, 5=excellent)"),
      helpfulness: z
        .string()
        .describe("How helpful was Soul today?"),
      mistakes: z
        .string()
        .optional()
        .describe("Any mistakes made?"),
      improvements: z
        .string()
        .optional()
        .describe("What to improve?"),
    },
    async ({ score, helpfulness, mistakes, improvements }) => {
      const entry = await logQuality({ score, helpfulness, mistakes, improvements });
      return {
        content: [
          {
            type: "text" as const,
            text: `Quality logged for ${entry.date}: ${score}/5\n${helpfulness}${mistakes ? `\nMistakes: ${mistakes}` : ""}${improvements ? `\nImprove: ${improvements}` : ""}\n\nSoul uses this to get better every day.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_quality_trend",
    "View quality trend — see how Soul's helpfulness changes over time.",
    {
      days: z.number().default(30).describe("Number of days to look back"),
    },
    async ({ days }) => {
      const entries = await getQualityTrend(days);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No quality data yet. Use soul_quality to start tracking.",
            },
          ],
        };
      }

      const avg = entries.reduce((s, e) => s + e.score, 0) / entries.length;
      const text = entries
        .map((e) => `${e.date}: ${"*".repeat(e.score)}${"·".repeat(5 - e.score)} ${e.score}/5 — ${e.helpfulness.substring(0, 60)}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Quality Trend (avg: ${avg.toFixed(1)}/5, ${entries.length} entries):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Memory Consolidation ===

  server.tool(
    "soul_consolidate",
    "Consolidate memories — review recent memories, find weak learnings, suggest improvements. Like reviewing a journal and extracting wisdom.",
    {},
    async () => {
      const result = await consolidateMemories();
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
