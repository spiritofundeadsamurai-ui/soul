import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assignWork, autoAssign, startWork, submitWork, completeWork,
  shareFinding, getCoworkerStatus, getTeamOverview,
  getWorkHistory, getTeamActivity, getExpertise,
} from "../core/coworker.js";

export function registerCoworkerTools(server: McpServer) {

  server.tool(
    "soul_assign",
    "Assign work to a specific Soul coworker. Like giving a task to a team member.",
    {
      childName: z.string().describe("Coworker name (Soul Child)"),
      title: z.string().describe("Task title"),
      description: z.string().default("").describe("Task details"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    },
    async ({ childName, title, description, priority }) => {
      try {
        const item = await assignWork({ childName, title, description, priority });
        return { content: [{ type: "text" as const, text: `Assigned to ${childName}: "${title}" [${priority}]\nWork item #${item.id}` }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_auto_assign",
    "Auto-assign work to the best coworker based on expertise match and workload. Soul picks the right person.",
    {
      title: z.string().describe("Task title"),
      description: z.string().default("").describe("Task details"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    },
    async ({ title, description, priority }) => {
      try {
        const { assignedTo, workItem, reason } = await autoAssign({ title, description, priority });
        return { content: [{ type: "text" as const, text: `Auto-assigned to: ${assignedTo}\nReason: ${reason}\nTask: "${title}" [${priority}]\nWork item #${workItem.id}` }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_work_start",
    "Start working on a queued task. Changes status from 'queued' to 'working'.",
    { workItemId: z.number().describe("Work item ID") },
    async ({ workItemId }) => {
      const item = startWork(workItemId);
      if (!item) return { content: [{ type: "text" as const, text: "Work item not found." }] };
      return { content: [{ type: "text" as const, text: `${item.childName} started working on: "${item.title}"` }] };
    }
  );

  server.tool(
    "soul_work_submit",
    "Submit work result for review. Coworker reports what they did.",
    {
      workItemId: z.number().describe("Work item ID"),
      result: z.string().describe("Work result / output"),
    },
    async ({ workItemId, result }) => {
      const item = await submitWork(workItemId, result);
      if (!item) return { content: [{ type: "text" as const, text: "Work item not found." }] };
      return { content: [{ type: "text" as const, text: `${item.childName} submitted: "${item.title}"\nStatus: review\nResult: ${result.substring(0, 200)}` }] };
    }
  );

  server.tool(
    "soul_work_approve",
    "Approve/complete a submitted work item. Master accepts the result.",
    {
      workItemId: z.number().describe("Work item ID"),
      feedback: z.string().optional().describe("Feedback for the coworker"),
    },
    async ({ workItemId, feedback }) => {
      const item = await completeWork(workItemId, feedback);
      if (!item) return { content: [{ type: "text" as const, text: "Work item not found." }] };
      return { content: [{ type: "text" as const, text: `Approved: "${item.title}" by ${item.childName}\n${feedback ? 'Feedback: ' + feedback : 'No feedback.'}` }] };
    }
  );

  server.tool(
    "soul_share_finding",
    "Share a finding/insight between coworkers. Like a team standup update.",
    {
      fromChild: z.string().describe("Who is sharing"),
      finding: z.string().describe("What was found/learned"),
      relatedSkill: z.string().describe("Related skill area"),
    },
    async ({ fromChild, finding, relatedSkill }) => {
      const { sharedWith } = await shareFinding({ fromChild, finding, relatedSkill });
      return { content: [{ type: "text" as const, text: `${fromChild} shared: "${finding.substring(0, 100)}"\nShared with: ${sharedWith.join(", ") || "no other coworkers"}` }] };
    }
  );

  server.tool(
    "soul_coworker_status",
    "Get detailed status of a specific coworker — current task, queue, history, expertise.",
    { name: z.string().describe("Coworker name") },
    async ({ name }) => {
      const status = await getCoworkerStatus(name);
      if (!status) return { content: [{ type: "text" as const, text: `Coworker "${name}" not found.` }] };

      let text = `=== ${status.name} (${status.specialty}) ===\n`;
      text += `Personality: ${status.personality}\n`;
      text += `Abilities: ${status.abilities.join(", ")}\n\n`;
      text += `Current: ${status.currentWork ? status.currentWork.title + ' [' + status.currentWork.priority + ']' : 'Idle'}\n`;
      text += `Queue: ${status.queuedItems} | Completed: ${status.completedItems}\n`;
      if (status.expertise.length > 0) {
        text += `\nExpertise:\n${status.expertise.map(e => '  ' + e).join('\n')}\n`;
      }
      if (status.recentActivity.length > 0) {
        text += `\nRecent Activity:\n`;
        status.recentActivity.slice(0, 5).forEach(a => {
          text += `  [${a.action}] ${a.detail.substring(0, 80)} (${a.createdAt})\n`;
        });
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_team",
    "Team overview — see all coworkers, who's working on what, workload balance.",
    {},
    async () => {
      const overview = await getTeamOverview();
      if (overview.totalCoworkers === 0) {
        return { content: [{ type: "text" as const, text: "No coworkers yet. Use soul_spawn to create Soul Children, then soul_assign to give them work." }] };
      }

      let text = `=== Soul Team (${overview.totalCoworkers} coworkers) ===\n`;
      text += `Active: ${overview.activeWork} | Completed total: ${overview.completedTotal}\n\n`;

      for (const cw of overview.coworkers) {
        const statusIcon = cw.status === 'working' ? '[WORKING]' : cw.status === 'reviewing' ? '[REVIEW]' : '[IDLE]';
        text += `${statusIcon} ${cw.name} — ${cw.specialty}\n`;
        if (cw.currentTask) text += `  Task: ${cw.currentTask}\n`;
        text += `  Queue: ${cw.queued} | Done: ${cw.completed}`;
        if (cw.topSkills.length > 0) text += ` | Skills: ${cw.topSkills.join(', ')}`;
        text += '\n\n';
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_work_history",
    "Work history for a coworker — past tasks and results.",
    {
      name: z.string().describe("Coworker name"),
      limit: z.number().default(10).describe("How many items"),
    },
    async ({ name, limit }) => {
      const items = getWorkHistory(name, limit);
      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: `No work history for "${name}".` }] };
      }
      const text = items.map(i =>
        `#${i.id} [${i.status}] ${i.title} (${i.priority})${i.result ? '\n  Result: ' + i.result.substring(0, 100) : ''}`
      ).join('\n');
      return { content: [{ type: "text" as const, text: `Work history for ${name} (${items.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_team_activity",
    "Team activity feed — recent actions across all coworkers.",
    { limit: z.number().default(20) },
    async ({ limit }) => {
      const logs = getTeamActivity(limit);
      if (logs.length === 0) {
        return { content: [{ type: "text" as const, text: "No team activity yet." }] };
      }
      const text = logs.map(l =>
        `[${l.createdAt}] ${l.childName} — ${l.action}: ${l.detail.substring(0, 80)}`
      ).join('\n');
      return { content: [{ type: "text" as const, text: `Team Activity:\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_expertise",
    "View a coworker's expertise — skills they've developed from work.",
    { name: z.string().describe("Coworker name") },
    async ({ name }) => {
      const skills = getExpertise(name);
      if (skills.length === 0) {
        return { content: [{ type: "text" as const, text: `${name} hasn't developed expertise yet. Assign work with soul_assign.` }] };
      }
      const text = skills.map(s => {
        const bar = '#'.repeat(Math.round(s.level * 20)).padEnd(20, '-');
        return `${s.skill.padEnd(20)} [${bar}] ${Math.round(s.level * 100)}% (${s.evidence} tasks)`;
      }).join('\n');
      return { content: [{ type: "text" as const, text: `${name}'s Expertise:\n\n${text}` }] };
    }
  );
}
