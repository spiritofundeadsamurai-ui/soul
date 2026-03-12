import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generatePlan,
  loadPlan,
  listRecentPlans,
  formatPlan,
} from "../core/agent-planner.js";

export function registerPlannerTools(server: McpServer) {

  server.tool(
    "soul_plan_create",
    "Create an execution plan for a goal — breaks it into steps with tools, expected outcomes, and fallback alternatives. Supports backtracking on failure.",
    {
      goal: z.string().describe("What you want to achieve (e.g. 'research AI safety and write a summary')"),
      tools: z.array(z.string()).optional().describe("Available tool names to use in the plan (auto-detected if empty)"),
      context: z.string().optional().describe("Additional context for planning"),
    },
    async ({ goal, tools, context }) => {
      try {
        const availableTools = tools && tools.length > 0 ? tools : [
          "soul_search", "soul_remember", "soul_know", "soul_think_framework",
          "soul_brainstorm", "soul_decide", "soul_write", "soul_note",
          "soul_research", "soul_web_search", "soul_create_report",
        ];
        const plan = await generatePlan(goal, availableTools, context);
        return {
          content: [{
            type: "text" as const,
            text: `Plan created!\n\n${formatPlan(plan)}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed to create plan: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_plan_status",
    "Check the progress of an execution plan — see which steps are done, pending, or failed.",
    {
      plan_id: z.string().describe("Plan ID to check"),
    },
    async ({ plan_id }) => {
      const plan = loadPlan(plan_id);
      if (!plan) {
        return { content: [{ type: "text" as const, text: `Plan "${plan_id}" not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: formatPlan(plan),
        }],
      };
    }
  );

  server.tool(
    "soul_plan_list",
    "List recent execution plans — see what plans were created, their status, and success rate.",
    {
      limit: z.number().min(1).max(50).default(10).describe("How many plans to show"),
    },
    async ({ limit }) => {
      const plans = listRecentPlans(limit);

      if (plans.length === 0) {
        return { content: [{ type: "text" as const, text: "No plans found. Use soul_plan_create to create one." }] };
      }

      const completed = plans.filter((p) => p.status === "completed").length;
      const failed = plans.filter((p) => p.status === "failed").length;
      const active = plans.filter((p) => ["planning", "executing", "backtracked"].includes(p.status)).length;

      let text = `=== Agent Plans ===\n\n`;
      text += `Total: ${plans.length} | Completed: ${completed} | Failed: ${failed} | Active: ${active}\n`;
      text += `Success rate: ${plans.length > 0 ? Math.round((completed / plans.length) * 100) : 0}%\n\n`;

      for (const plan of plans) {
        const stepsDone = plan.steps.filter((s) => s.status === "done").length;
        const stepsTotal = plan.steps.length;
        text += `[${plan.status.toUpperCase()}] ${plan.goal}\n`;
        text += `  ID: ${plan.id} | Steps: ${stepsDone}/${stepsTotal} | Backtracks: ${plan.backtrackCount}\n`;
        text += `  Created: ${plan.createdAt}\n\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
