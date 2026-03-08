import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  startWorkflowRun,
  updateWorkflowStep,
  completeWorkflowRun,
  getWorkflowRuns,
  deleteWorkflow,
  getWorkflowTemplates,
} from "../core/workflow-engine.js";

export function registerWorkflowTools(server: McpServer) {

  server.tool(
    "soul_workflow_create",
    "Create a reusable workflow — a chain of Soul tools that run in sequence. Like a recipe: define once, run many times with different inputs.",
    {
      name: z.string().describe("Workflow name (unique)"),
      description: z.string().describe("What this workflow does"),
      steps: z.array(z.object({
        id: z.string().describe("Step ID (for branching)"),
        name: z.string().describe("Step display name"),
        tool: z.string().describe("Soul tool to call (e.g. 'soul_prime')"),
        params: z.record(z.string(), z.string()).describe("Tool parameters — use {{variable}} for dynamic values"),
        saveOutputAs: z.string().optional().describe("Save output as variable for later steps"),
        onFailure: z.string().optional().describe("Step ID to jump to on failure"),
      })).describe("Workflow steps in execution order"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ name, description, steps, tags }) => {
      try {
        const wf = createWorkflow({ name, description, steps, tags });
        return {
          content: [{
            type: "text" as const,
            text: `Workflow "${wf.name}" created with ${wf.steps.length} steps.\n\n${wf.steps.map((s, i) => `  ${i + 1}. ${s.name} → ${s.tool}`).join("\n")}\n\nRun it with: soul_workflow_run name:"${wf.name}"`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_workflow_run",
    "Execute a workflow — runs the steps in order, passing data between them. Returns the execution plan to follow.",
    {
      name: z.string().describe("Workflow name to run"),
      variables: z.record(z.string(), z.string()).optional().describe("Input variables (e.g. {topic: 'AI safety'})"),
    },
    async ({ name, variables }) => {
      const result = startWorkflowRun(name, variables || {});
      if (!result) {
        return { content: [{ type: "text" as const, text: `Workflow "${name}" not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `${result.executionPlan}\nRun ID: ${result.run.id}\n\nExecute each step now. After each, call soul_workflow_step to log progress.`,
        }],
      };
    }
  );

  server.tool(
    "soul_workflow_step",
    "Log a workflow step result — records success/failure and saves output for the next step.",
    {
      runId: z.number().describe("Workflow run ID"),
      stepName: z.string().describe("Step name that was executed"),
      status: z.enum(["success", "failed"]).describe("Step result"),
      output: z.string().describe("Step output (summary)"),
      saveAs: z.string().optional().describe("Variable name to save output as"),
      saveValue: z.string().optional().describe("Value to save (if different from output)"),
    },
    async ({ runId, stepName, status, output, saveAs, saveValue }) => {
      const run = updateWorkflowStep(runId, stepName, status, output, saveAs, saveValue);
      if (!run) {
        return { content: [{ type: "text" as const, text: `Run #${runId} not found.` }] };
      }

      const stepsTotal = run.log.length;
      const text = `Step "${stepName}": ${status}\nProgress: ${stepsTotal} steps completed\nVariables: ${JSON.stringify(run.variables)}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_workflow_done",
    "Mark a workflow run as completed or failed.",
    {
      runId: z.number().describe("Workflow run ID"),
      status: z.enum(["completed", "failed"]).describe("Final status"),
    },
    async ({ runId, status }) => {
      completeWorkflowRun(runId, status);
      return { content: [{ type: "text" as const, text: `Workflow run #${runId}: ${status}` }] };
    }
  );

  server.tool(
    "soul_workflows",
    "List all saved workflows — shows name, description, step count, and run history.",
    {},
    async () => {
      const workflows = listWorkflows();
      if (workflows.length === 0) {
        const templates = getWorkflowTemplates();
        let text = "No workflows yet.\n\nAvailable templates (use soul_workflow_template to install):\n\n";
        text += templates.map(t => `  - ${t.name}: ${t.description}`).join("\n");
        return { content: [{ type: "text" as const, text }] };
      }

      let text = `Workflows (${workflows.length}):\n\n`;
      text += workflows.map(w =>
        `${w.name} — ${w.description}\n  ${w.steps.length} steps | Run ${w.runCount}x${w.lastRunAt ? ` | Last: ${w.lastRunAt.split("T")[0]}` : ""}`
      ).join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_workflow_template",
    "Install a built-in workflow template — pre-made workflows for common tasks.",
    {
      name: z.string().describe("Template name: 'research-and-learn', 'daily-review', 'team-standup', 'deep-think'"),
    },
    async ({ name }) => {
      const templates = getWorkflowTemplates();
      const template = templates.find(t => t.name === name);

      if (!template) {
        return {
          content: [{
            type: "text" as const,
            text: `Template "${name}" not found.\n\nAvailable: ${templates.map(t => t.name).join(", ")}`,
          }],
        };
      }

      try {
        const wf = createWorkflow({
          name: template.name,
          description: template.description,
          steps: template.steps,
          tags: ["template"],
        });
        return {
          content: [{
            type: "text" as const,
            text: `Template "${wf.name}" installed!\n${wf.description}\n\n${wf.steps.map((s, i) => `  ${i + 1}. ${s.name} → ${s.tool}`).join("\n")}\n\nRun: soul_workflow_run name:"${wf.name}" variables:{topic:"..."}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_workflow_history",
    "View recent workflow run history — see what ran, status, and timing.",
    {
      limit: z.number().default(10).describe("Number of runs to show"),
    },
    async ({ limit }) => {
      const runs = getWorkflowRuns(limit);
      if (runs.length === 0) {
        return { content: [{ type: "text" as const, text: "No workflow runs yet." }] };
      }

      let text = `Recent Runs (${runs.length}):\n\n`;
      text += runs.map(r => {
        const duration = r.completedAt
          ? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
          : "in progress";
        return `#${r.id} ${r.workflowName} [${r.status}] — ${r.log.length} steps | ${duration}`;
      }).join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_workflow_delete",
    "Delete a workflow.",
    { name: z.string().describe("Workflow name to delete") },
    async ({ name }) => {
      const ok = deleteWorkflow(name);
      return {
        content: [{
          type: "text" as const,
          text: ok ? `Workflow "${name}" deleted.` : `Workflow "${name}" not found.`,
        }],
      };
    }
  );
}
