import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  startTimer,
  stopTimer,
  getActiveTimer,
  getTodayEntries,
  getTimeSummary,
} from "../core/time-intelligence.js";

export function registerTimeTools(server: McpServer) {
  server.tool(
    "soul_timer_start",
    "Start tracking time on a task — Soul monitors how you spend your time and helps optimize productivity.",
    {
      project: z.string().default("general").describe("Project name"),
      task: z.string().describe("What you're working on"),
      type: z
        .enum(["work", "break", "learning", "creative", "meeting", "planning"])
        .default("work")
        .describe("Type of activity"),
    },
    async ({ project, task, type }) => {
      const entry = startTimer(project, task, type);
      return {
        content: [{
          type: "text" as const,
          text: `Timer started: "${task}" [${project}]\nType: ${type}\nStarted: ${entry.startedAt}\n\nUse soul_timer_stop when done.`,
        }],
      };
    }
  );

  server.tool(
    "soul_timer_stop",
    "Stop the active timer — logs time spent.",
    {},
    async () => {
      const entry = stopTimer();
      if (!entry) {
        return {
          content: [{
            type: "text" as const,
            text: "No active timer. Use soul_timer_start to begin tracking.",
          }],
        };
      }

      const minutes = Math.round(entry.durationMin);
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      return {
        content: [{
          type: "text" as const,
          text: `Timer stopped: "${entry.task}" [${entry.project}]\nDuration: ${duration}\nType: ${entry.type}`,
        }],
      };
    }
  );

  server.tool(
    "soul_timer_status",
    "Check what's currently being timed.",
    {},
    async () => {
      const active = getActiveTimer();
      if (!active) {
        return {
          content: [{
            type: "text" as const,
            text: "No active timer.",
          }],
        };
      }

      const now = new Date();
      const started = new Date(active.startedAt);
      const elapsedMin = Math.round((now.getTime() - started.getTime()) / 60000);
      const hours = Math.floor(elapsedMin / 60);
      const mins = elapsedMin % 60;

      return {
        content: [{
          type: "text" as const,
          text: `Active: "${active.task}" [${active.project}]\nElapsed: ${hours > 0 ? `${hours}h ` : ""}${mins}m\nType: ${active.type}\nStarted: ${active.startedAt}`,
        }],
      };
    }
  );

  server.tool(
    "soul_time_today",
    "See today's time entries — what you've worked on, how long, by project.",
    {},
    async () => {
      const entries = getTodayEntries();

      if (entries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No time entries today. Use soul_timer_start to begin.",
          }],
        };
      }

      let totalMin = 0;
      const text = entries.map(e => {
        const min = Math.round(e.durationMin);
        totalMin += min;
        const dur = e.endedAt ? `${min}m` : "running...";
        return `  ${e.type} | ${e.project} | "${e.task}" — ${dur}`;
      }).join("\n");

      const totalHrs = Math.floor(totalMin / 60);
      const totalMins = totalMin % 60;

      return {
        content: [{
          type: "text" as const,
          text: `Today's Time (${totalHrs}h ${totalMins}m total):\n\n${text}`,
        }],
      };
    }
  );

  server.tool(
    "soul_time_summary",
    "Weekly/monthly time summary — hours by project, productivity trends, streaks.",
    {
      days: z.number().default(7).describe("Number of days to analyze"),
    },
    async ({ days }) => {
      const summary = getTimeSummary(days);

      let text = `=== Time Summary (${days} days) ===\n\n`;
      text += `Total: ${summary.totalHours}h\n`;
      text += `Daily avg: ${summary.avgDailyHours}h\n`;
      text += `Longest streak: ${summary.longestStreak} days\n\n`;

      text += `By Project:\n`;
      for (const [p, h] of Object.entries(summary.byProject)) {
        text += `  ${p}: ${h}h\n`;
      }

      text += `\nBy Type:\n`;
      for (const [t, h] of Object.entries(summary.byType)) {
        text += `  ${t}: ${h}h\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
