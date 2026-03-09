import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAutoGoal,
  markTaskDone,
  getNextAction,
  markTaskBlocked,
  listAutoGoals,
  getAutoGoal,
  getGoalsDashboard,
  addMilestone,
} from "../core/goal-autopilot.js";

export function registerGoalAutopilotTools(server: McpServer) {

  server.tool(
    "soul_autopilot",
    "Set a goal and Soul auto-decomposes it into milestones and tasks. Tracks progress across sessions. Like AutoGPT — Soul PURSUES goals, not just responds.",
    {
      title: z.string().describe("Goal title (clear, actionable)"),
      description: z.string().describe("Detailed description of what success looks like"),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium").describe("Priority level"),
      milestones: z.array(z.object({
        title: z.string().describe("Milestone name"),
        tasks: z.array(z.string()).describe("Tasks within this milestone"),
      })).optional().describe("Custom milestones (auto-generated if omitted)"),
    },
    async ({ title, description, priority, milestones }) => {
      const { goal, plan } = await createAutoGoal({ title, description, priority, milestones });
      return {
        content: [{
          type: "text" as const,
          text: `Goal #${goal.id} created!\n\n${plan}`,
        }],
      };
    }
  );

  server.tool(
    "soul_goal_progress",
    "Mark a task as done in a goal — updates progress, suggests next action.",
    {
      goalId: z.number().describe("Goal ID"),
      taskId: z.string().describe("Task ID to mark done (e.g. 'm1_t1')"),
    },
    async ({ goalId, taskId }) => {
      const result = markTaskDone(goalId, taskId);
      if (!result) {
        return { content: [{ type: "text" as const, text: `Goal #${goalId} or task "${taskId}" not found.` }] };
      }
      const { goal, nextAction } = result;
      const bar = `[${"#".repeat(Math.round(goal.progress / 5))}${"-".repeat(20 - Math.round(goal.progress / 5))}]`;

      let text = `Task done! ${bar} ${goal.progress}%\n\n`;
      if (goal.status === "completed") {
        text += `Goal "${goal.title}" COMPLETED! All milestones done.\n`;
      } else {
        text += `Next action: ${nextAction}\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_goal_next",
    "Get the next suggested action for a goal — what to do now, blockers, progress.",
    {
      goalId: z.number().describe("Goal ID"),
    },
    async ({ goalId }) => {
      const result = getNextAction(goalId);
      if (!result) {
        return { content: [{ type: "text" as const, text: `Goal #${goalId} not found.` }] };
      }

      let text = `Progress: ${result.progress}%\n`;
      text += `Next: ${result.nextAction}\n`;
      if (result.blockers.length > 0) {
        text += `\nBlockers:\n${result.blockers.map(b => `  ! ${b}`).join("\n")}\n`;
      }
      text += `\n${result.suggestion}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_goal_block",
    "Mark a task as blocked — records what's blocking it.",
    {
      goalId: z.number().describe("Goal ID"),
      taskId: z.string().describe("Task ID to block"),
      reason: z.string().describe("What's blocking this task"),
    },
    async ({ goalId, taskId, reason }) => {
      const ok = markTaskBlocked(goalId, taskId, reason);
      return {
        content: [{
          type: "text" as const,
          text: ok
            ? `Task "${taskId}" marked as blocked: ${reason}`
            : `Goal #${goalId} or task "${taskId}" not found.`,
        }],
      };
    }
  );

  server.tool(
    "soul_goal_detail",
    "View detailed status of a goal — all milestones, tasks, progress.",
    {
      goalId: z.number().describe("Goal ID"),
    },
    async ({ goalId }) => {
      const goal = getAutoGoal(goalId);
      if (!goal) {
        return { content: [{ type: "text" as const, text: `Goal #${goalId} not found.` }] };
      }

      let text = `=== Goal: "${goal.title}" ===\n`;
      text += `Status: ${goal.status} | Priority: ${goal.priority} | Progress: ${goal.progress}%\n`;
      if (goal.assignedSoul) text += `Assigned: ${goal.assignedSoul}\n`;
      text += `\n`;

      for (const m of goal.milestones) {
        const icon = m.status === "completed" ? "[x]" : m.status === "blocked" ? "[!]" : m.status === "in_progress" ? "[~]" : "[ ]";
        text += `${icon} ${m.id}. ${m.title}\n`;
        for (const t of m.tasks) {
          const tIcon = t.status === "done" ? "[x]" : t.status === "blocked" ? "[!]" : "[ ]";
          text += `  ${tIcon} ${t.id}: ${t.title}`;
          if (t.blockedBy) text += ` (blocked: ${t.blockedBy})`;
          text += `\n`;
        }
        text += `\n`;
      }

      text += `Next: ${goal.nextAction}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_goals_dashboard",
    "Dashboard of all autopilot goals — active, completed, paused, blocked items.",
    {
      status: z.string().optional().describe("Filter by status: active, completed, paused, abandoned"),
    },
    async ({ status }) => {
      if (status) {
        const goals = listAutoGoals(status);
        if (goals.length === 0) {
          return { content: [{ type: "text" as const, text: `No ${status} goals.` }] };
        }
        let text = `${status.toUpperCase()} Goals (${goals.length}):\n\n`;
        text += goals.map(g => `#${g.id} [${g.priority}] ${g.title} — ${g.progress}%`).join("\n");
        return { content: [{ type: "text" as const, text }] };
      }

      const dashboard = await getGoalsDashboard();
      return { content: [{ type: "text" as const, text: dashboard }] };
    }
  );

  server.tool(
    "soul_goal_milestone",
    "Add a new milestone to an existing goal.",
    {
      goalId: z.number().describe("Goal ID"),
      title: z.string().describe("Milestone title"),
      tasks: z.array(z.string()).describe("Tasks within this milestone"),
    },
    async ({ goalId, title, tasks }) => {
      const goal = addMilestone(goalId, title, tasks);
      if (!goal) {
        return { content: [{ type: "text" as const, text: `Goal #${goalId} not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Milestone "${title}" added to goal "${goal.title}" with ${tasks.length} tasks.`,
        }],
      };
    }
  );
}
