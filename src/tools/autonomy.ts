import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTask,
  updateTaskProgress,
  getTasks,
  addReminder,
  getActiveReminders,
  dismissReminder,
  learnStyle,
  getStyleGuide,
  createHandoff,
  getLastHandoff,
} from "../core/autonomy.js";

export function registerAutonomyTools(server: McpServer) {
  // === Task Tracking ===

  server.tool(
    "soul_task_create",
    "Create a persistent task that Soul tracks across sessions. Tasks never get lost between conversations.",
    {
      title: z.string().describe("Task title"),
      description: z.string().describe("What needs to be done"),
      priority: z
        .enum(["low", "medium", "high", "critical"])
        .default("medium")
        .describe("Priority level"),
      assignedTo: z
        .string()
        .optional()
        .describe("Assign to a Soul child (name)"),
    },
    async ({ title, description, priority, assignedTo }) => {
      const task = await createTask({
        title,
        description,
        priority,
        assignedTo,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Task #${task.id} created: "${title}" [${priority}]${assignedTo ? ` → ${assignedTo}` : ""}\n\nSoul will track this across sessions. Use soul_task_update to log progress.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_task_update",
    "Update progress on a task. Soul tracks all progress and never loses context.",
    {
      taskId: z.number().describe("Task ID"),
      progress: z.string().describe("Progress update"),
      status: z
        .enum(["pending", "in_progress", "blocked", "completed"])
        .optional()
        .describe("New status"),
    },
    async ({ taskId, progress, status }) => {
      const task = await updateTaskProgress(taskId, progress, status);
      if (!task) {
        return {
          content: [
            { type: "text" as const, text: `Task #${taskId} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Task #${task.id} updated: "${task.title}" → ${task.status}\nProgress: ${progress}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_tasks",
    "List all tracked tasks — see what's pending, in progress, or blocked.",
    {
      status: z
        .enum(["pending", "in_progress", "blocked", "completed"])
        .optional()
        .describe("Filter by status"),
      assignedTo: z
        .string()
        .optional()
        .describe("Filter by assigned Soul child"),
    },
    async ({ status, assignedTo }) => {
      const tasks = await getTasks(status, assignedTo);

      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tasks found. Use soul_task_create to start tracking.",
            },
          ],
        };
      }

      const text = tasks
        .map(
          (t) =>
            `#${t.id} [${t.priority}] ${t.status === "completed" ? "~~" : ""}${t.title}${t.status === "completed" ? "~~" : ""}\n  Status: ${t.status}${t.assignedTo ? ` | Assigned: ${t.assignedTo}` : ""}\n  ${t.progress ? `Progress: ${t.progress.substring(0, 100)}` : "No progress yet"}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Tasks (${tasks.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Reminders ===

  server.tool(
    "soul_remind",
    "Set a reminder — Soul will remember to bring this up. Reminders persist across sessions.",
    {
      message: z.string().describe("What to remember"),
      trigger: z
        .string()
        .describe(
          "When to trigger (e.g., 'next session', 'when talking about deploy', 'before commit')"
        ),
    },
    async ({ message, trigger }) => {
      const reminder = await addReminder(message, "event", trigger);
      return {
        content: [
          {
            type: "text" as const,
            text: `Reminder #${reminder.id} set: "${message}"\nTrigger: ${trigger}\n\nSoul will bring this up at the right time.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_reminders",
    "Check all active reminders.",
    {},
    async () => {
      const reminders = await getActiveReminders();

      if (reminders.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No active reminders." },
          ],
        };
      }

      const text = reminders
        .map(
          (r) =>
            `#${r.id}: ${r.message}\n  Trigger: ${r.triggerValue} | Set: ${r.createdAt}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Active Reminders (${reminders.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  // === Style Learning ===

  server.tool(
    "soul_learn_style",
    "Learn master's coding/writing/communication style. Soul adapts to match preferences over time.",
    {
      category: z
        .string()
        .describe(
          "Style category (e.g., 'code-naming', 'indent', 'commit-msg', 'communication')"
        ),
      example: z.string().describe("An example of the preferred style"),
      pattern: z
        .string()
        .describe("The pattern/rule extracted from the example"),
    },
    async ({ category, example, pattern }) => {
      await learnStyle(category, example, pattern);
      return {
        content: [
          {
            type: "text" as const,
            text: `Style learned: ${category}\nPattern: ${pattern}\n\nSoul will apply this style in future interactions.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_style_guide",
    "Show all learned style preferences — how the master likes things done.",
    {},
    async () => {
      const guide = await getStyleGuide();
      return { content: [{ type: "text" as const, text: guide }] };
    }
  );

  // === Session Handoff ===

  server.tool(
    "soul_handoff",
    "Create a session handoff — save current state, pending items, and next steps. The next session starts exactly where this one left off.",
    {
      currentState: z.string().describe("What we were doing"),
      pendingItems: z.array(z.string()).describe("Items not yet completed"),
      nextSteps: z.array(z.string()).describe("What to do next"),
    },
    async ({ currentState, pendingItems, nextSteps }) => {
      const id = await createHandoff(currentState, pendingItems, nextSteps);
      return {
        content: [
          {
            type: "text" as const,
            text: `Session handoff created (memory #${id}).\n\nNext session, call soul_resume to pick up exactly where we left off.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_resume",
    "Resume from last session — load the handoff and continue where we left off. This is how Soul maintains perfect session continuity.",
    {},
    async () => {
      const handoff = await getLastHandoff();

      if (!handoff) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No previous session handoff found. This is a fresh start.",
            },
          ],
        };
      }

      // Also get active tasks and reminders
      const tasks = await getTasks("in_progress");
      const reminders = await getActiveReminders();

      let text = handoff;

      if (tasks.length > 0) {
        text += `\n\nActive Tasks (${tasks.length}):\n`;
        text += tasks
          .map((t) => `  - #${t.id} [${t.priority}] ${t.title}: ${t.progress || "no progress"}`)
          .join("\n");
      }

      if (reminders.length > 0) {
        text += `\n\nReminders (${reminders.length}):\n`;
        text += reminders.map((r) => `  - ${r.message}`).join("\n");
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
