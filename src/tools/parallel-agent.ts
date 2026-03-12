import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAgentPool,
  getParallelTaskStatus,
  listParallelTasks,
  type AgentTask,
} from "../core/parallel-agent.js";

export function registerParallelTools(server: McpServer) {

  server.tool(
    "soul_parallel_run",
    "Run multiple agent tasks in parallel using worker threads. Each task gets its own agent loop with access to specified tools. Great for research, analysis, or any work that can be split into independent subtasks.",
    {
      tasks: z.array(z.object({
        id: z.string().optional().describe("Task ID (auto-generated if omitted)"),
        goal: z.string().describe("What this agent should accomplish"),
        tools: z.array(z.string()).default([]).describe("Tool names this agent can use (empty = all tools)"),
        context: z.string().optional().describe("Additional context for the agent"),
        providerId: z.string().optional().describe("LLM provider to use (default = current default)"),
        maxSteps: z.number().optional().describe("Max agent loop iterations (default 5)"),
        timeout: z.number().optional().describe("Timeout in ms (default 60000)"),
      })).describe("Array of tasks to run in parallel"),
    },
    async ({ tasks }) => {
      try {
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "No tasks provided." }] };
        }

        if (tasks.length > 10) {
          return { content: [{ type: "text" as const, text: "Maximum 10 parallel tasks allowed." }] };
        }

        // Assign IDs to tasks that don't have them
        const agentTasks: AgentTask[] = tasks.map((t, i) => ({
          id: t.id || `task_${Date.now()}_${i}`,
          goal: t.goal,
          tools: t.tools || [],
          context: t.context,
          providerId: t.providerId,
          maxSteps: t.maxSteps,
          timeout: t.timeout,
        }));

        const pool = getAgentPool();
        const results = await pool.executeParallel(agentTasks);

        // Format results
        let text = `=== Parallel Execution: ${results.length} tasks ===\n\n`;

        const completed = results.filter(r => r.status === "completed").length;
        const failed = results.filter(r => r.status === "failed").length;
        const timedOut = results.filter(r => r.status === "timeout").length;

        text += `Summary: ${completed} completed, ${failed} failed, ${timedOut} timed out\n`;
        text += `Total time: ${Math.max(...results.map(r => r.duration))}ms (parallel)\n\n`;

        for (const result of results) {
          const statusIcon = result.status === "completed" ? "[OK]"
            : result.status === "timeout" ? "[TIMEOUT]"
            : "[FAIL]";

          text += `${statusIcon} Task: ${result.taskId}\n`;
          text += `  Steps: ${result.stepsUsed} | Duration: ${result.duration}ms\n`;

          if (result.result) {
            const preview = result.result.length > 300
              ? result.result.substring(0, 300) + "..."
              : result.result;
            text += `  Result: ${preview}\n`;
          }
          if (result.error) {
            text += `  Error: ${result.error}\n`;
          }
          text += "\n";
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Parallel execution failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_parallel_status",
    "Check status of a parallel execution or list recent parallel tasks.",
    {
      taskId: z.string().optional().describe("Specific task/group ID to check"),
      limit: z.number().default(10).describe("Number of recent tasks to list"),
    },
    async ({ taskId, limit }) => {
      try {
        if (taskId) {
          const status = getParallelTaskStatus(taskId);
          if (!status) {
            return { content: [{ type: "text" as const, text: `Task "${taskId}" not found.` }] };
          }

          let text = `=== Parallel Task: ${status.id} ===\n`;
          text += `Goal: ${status.goal}\n`;
          text += `Status: ${status.status}\n`;
          text += `Started: ${status.startedAt}\n`;
          if (status.completedAt) text += `Completed: ${status.completedAt}\n`;
          if (status.durationMs) text += `Duration: ${status.durationMs}ms\n`;
          if (status.result) text += `Result: ${status.result}\n`;

          if (status.subtasks.length > 0) {
            text += `\nSubtasks (${status.subtasks.length}):\n`;
            for (const sub of status.subtasks) {
              const icon = sub.status === "completed" ? "[OK]"
                : sub.status === "running" ? "[...]"
                : "[FAIL]";
              text += `  ${icon} ${sub.id}: ${sub.goal.substring(0, 60)}\n`;
              if (sub.durationMs) text += `      Duration: ${sub.durationMs}ms\n`;
              if (sub.result) text += `      Result: ${sub.result.substring(0, 100)}\n`;
            }
          }

          return { content: [{ type: "text" as const, text }] };
        }

        // List recent parallel tasks
        const tasks = listParallelTasks(limit);
        if (tasks.length === 0) {
          return { content: [{ type: "text" as const, text: "No parallel tasks found. Use soul_parallel_run to start." }] };
        }

        let text = `=== Recent Parallel Tasks (${tasks.length}) ===\n\n`;
        for (const t of tasks) {
          const icon = t.status === "completed" ? "[OK]"
            : t.status === "running" ? "[...]"
            : t.status === "partial" ? "[PARTIAL]"
            : "[FAIL]";
          text += `${icon} ${t.id}\n`;
          text += `  Goal: ${t.goal.substring(0, 80)}\n`;
          text += `  Started: ${t.startedAt}`;
          if (t.durationMs) text += ` | Duration: ${t.durationMs}ms`;
          if (t.subtaskCount > 0) text += ` | Subtasks: ${t.subtaskCount}`;
          text += "\n\n";
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );
}
