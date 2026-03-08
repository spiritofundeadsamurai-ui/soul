/**
 * Workflow Engine — Chain tools into reusable, executable workflows
 *
 * Inspired by: Manus (workflow orchestration), LangGraph (state machines)
 *
 * What this does:
 * 1. Define workflows as a sequence of steps (each step = a tool call or action)
 * 2. Steps can pass data to each other via variables
 * 3. Conditional branching (if step A fails, do step B instead)
 * 4. Save workflows for reuse — "run my research workflow on topic X"
 * 5. Track execution history
 *
 * Example workflow: "Research & Learn"
 *   Step 1: soul_prime topic → get context
 *   Step 2: soul_learn_web topic → gather info
 *   Step 3: soul_know → store as knowledge
 *   Step 4: soul_growth_add → log the learning
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface WorkflowStep {
  id: string;
  name: string;
  tool: string;                    // MCP tool name to call
  params: Record<string, string>; // param values (can use {{variable}} from previous steps)
  onSuccess?: string;             // next step ID on success (null = next in sequence)
  onFailure?: string;             // step ID to jump to on failure (null = abort)
  saveOutputAs?: string;          // variable name to save output for later steps
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  steps: WorkflowStep[];
  tags: string[];
  createdAt: string;
  lastRunAt: string | null;
  runCount: number;
  isActive: boolean;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  workflowName: string;
  status: "running" | "completed" | "failed" | "paused";
  currentStep: number;
  variables: Record<string, string>;
  log: Array<{ step: string; status: string; output: string; timestamp: string }>;
  startedAt: string;
  completedAt: string | null;
}

function ensureWorkflowTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      current_step INTEGER NOT NULL DEFAULT 0,
      variables TEXT NOT NULL DEFAULT '{}',
      log TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
}

/**
 * Create a new workflow
 */
export function createWorkflow(input: {
  name: string;
  description: string;
  steps: WorkflowStep[];
  tags?: string[];
}): Workflow {
  ensureWorkflowTables();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    `INSERT INTO soul_workflows (name, description, steps, tags)
     VALUES (?, ?, ?, ?) RETURNING *`
  ).get(
    input.name,
    input.description,
    JSON.stringify(input.steps),
    JSON.stringify(input.tags || [])
  ) as any;

  return mapWorkflow(row);
}

/**
 * List all workflows
 */
export function listWorkflows(): Workflow[] {
  ensureWorkflowTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_workflows WHERE is_active = 1 ORDER BY run_count DESC, created_at DESC"
  ).all() as any[];
  return rows.map(mapWorkflow);
}

/**
 * Get a workflow by name
 */
export function getWorkflow(name: string): Workflow | null {
  ensureWorkflowTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_workflows WHERE name = ? AND is_active = 1"
  ).get(name) as any;
  return row ? mapWorkflow(row) : null;
}

/**
 * Start a workflow run — returns the execution plan
 * (Actual tool execution happens via MCP host, not here)
 */
export function startWorkflowRun(
  workflowName: string,
  inputVariables?: Record<string, string>
): { run: WorkflowRun; executionPlan: string } | null {
  ensureWorkflowTables();
  const rawDb = getRawDb();

  const wf = getWorkflow(workflowName);
  if (!wf) return null;

  const variables = inputVariables || {};

  const row = rawDb.prepare(
    `INSERT INTO soul_workflow_runs (workflow_id, workflow_name, status, variables, log)
     VALUES (?, ?, 'running', ?, '[]') RETURNING *`
  ).get(wf.id, wf.name, JSON.stringify(variables)) as any;

  // Update workflow run count
  rawDb.prepare(
    "UPDATE soul_workflows SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?"
  ).run(wf.id);

  // Build execution plan text
  let plan = `=== Workflow: ${wf.name} ===\n`;
  plan += `${wf.description}\n`;
  plan += `Run #${wf.runCount + 1} | Variables: ${Object.keys(variables).length}\n\n`;

  plan += `Execution Plan (${wf.steps.length} steps):\n\n`;
  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    // Resolve variables in params
    const resolvedParams: Record<string, string> = {};
    for (const [key, val] of Object.entries(step.params)) {
      resolvedParams[key] = resolveVariables(val, variables);
    }

    plan += `Step ${i + 1}: ${step.name}\n`;
    plan += `  Tool: ${step.tool}\n`;
    plan += `  Params: ${JSON.stringify(resolvedParams)}\n`;
    if (step.saveOutputAs) plan += `  Save output as: {{${step.saveOutputAs}}}\n`;
    if (step.onFailure) plan += `  On failure: jump to "${step.onFailure}"\n`;
    plan += `\n`;
  }

  plan += `--- Execute each step in order. After each step, update the run with soul_workflow_step. ---\n`;

  return { run: mapRun(row), executionPlan: plan };
}

/**
 * Update a workflow run step
 */
export function updateWorkflowStep(
  runId: number,
  stepName: string,
  status: "success" | "failed",
  output: string,
  outputVariable?: string,
  outputValue?: string
): WorkflowRun | null {
  ensureWorkflowTables();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT * FROM soul_workflow_runs WHERE id = ?"
  ).get(runId) as any;
  if (!existing) return null;

  const log: any[] = JSON.parse(existing.log || "[]");
  log.push({
    step: stepName,
    status,
    output: output.substring(0, 500),
    timestamp: new Date().toISOString(),
  });

  const variables = JSON.parse(existing.variables || "{}");
  if (outputVariable && outputValue) {
    variables[outputVariable] = outputValue;
  }

  const newStepNum = existing.current_step + 1;

  rawDb.prepare(
    `UPDATE soul_workflow_runs SET current_step = ?, log = ?, variables = ? WHERE id = ?`
  ).run(newStepNum, JSON.stringify(log), JSON.stringify(variables), runId);

  return mapRun(rawDb.prepare("SELECT * FROM soul_workflow_runs WHERE id = ?").get(runId) as any);
}

/**
 * Complete a workflow run
 */
export function completeWorkflowRun(runId: number, status: "completed" | "failed"): void {
  ensureWorkflowTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    "UPDATE soul_workflow_runs SET status = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(status, runId);
}

/**
 * Get recent workflow runs
 */
export function getWorkflowRuns(limit = 10): WorkflowRun[] {
  ensureWorkflowTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_workflow_runs ORDER BY started_at DESC LIMIT ?"
  ).all(limit) as any[];
  return rows.map(mapRun);
}

/**
 * Delete a workflow
 */
export function deleteWorkflow(name: string): boolean {
  ensureWorkflowTables();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_workflows SET is_active = 0 WHERE name = ?"
  ).run(name);
  return result.changes > 0;
}

/**
 * Built-in workflow templates
 */
export function getWorkflowTemplates(): Array<{
  name: string;
  description: string;
  steps: WorkflowStep[];
}> {
  return [
    {
      name: "research-and-learn",
      description: "Research a topic → prime context → store as knowledge → log growth",
      steps: [
        {
          id: "prime", name: "Prime Context", tool: "soul_prime",
          params: { topic: "{{topic}}" }, saveOutputAs: "context",
        },
        {
          id: "research", name: "Web Research", tool: "soul_learn_web",
          params: { query: "{{topic}}" }, saveOutputAs: "research_result",
          onFailure: "store",
        },
        {
          id: "store", name: "Store Knowledge", tool: "soul_know",
          params: { key: "{{topic}}", value: "{{research_result}}", category: "research" },
        },
        {
          id: "log", name: "Log Growth", tool: "soul_growth_add",
          params: { entryType: "insight", title: "Researched: {{topic}}", content: "{{research_result}}" },
        },
      ],
    },
    {
      name: "daily-review",
      description: "Digest → mood analysis → growth summary → suggestions",
      steps: [
        {
          id: "digest", name: "Daily Digest", tool: "soul_digest",
          params: {}, saveOutputAs: "digest",
        },
        {
          id: "mood", name: "Mood Trends", tool: "soul_mood_analysis",
          params: {}, saveOutputAs: "mood",
        },
        {
          id: "growth", name: "Growth Summary", tool: "soul_growth_summary",
          params: {}, saveOutputAs: "growth",
        },
        {
          id: "anticipate", name: "Anticipate Needs", tool: "soul_anticipate",
          params: {}, saveOutputAs: "suggestions",
        },
      ],
    },
    {
      name: "team-standup",
      description: "Team overview → activity feed → pending work → suggestions",
      steps: [
        {
          id: "team", name: "Team Status", tool: "soul_team",
          params: {}, saveOutputAs: "team_status",
        },
        {
          id: "activity", name: "Recent Activity", tool: "soul_team_activity",
          params: { limit: "10" }, saveOutputAs: "activity",
        },
        {
          id: "roster", name: "Team Roster", tool: "soul_team_roster",
          params: {},
        },
      ],
    },
    {
      name: "deep-think",
      description: "Prime context → chain-of-thought reasoning → self-review → explain",
      steps: [
        {
          id: "prime", name: "Load Context", tool: "soul_prime",
          params: { topic: "{{question}}" }, saveOutputAs: "context",
        },
        {
          id: "reason", name: "Chain of Thought", tool: "soul_reason",
          params: { question: "{{question}}" }, saveOutputAs: "reasoning",
        },
        {
          id: "review", name: "Self-Review", tool: "soul_self_review",
          params: { output: "{{reasoning}}", originalRequest: "{{question}}" },
        },
      ],
    },
  ];
}

// Helpers

function resolveVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`);
}

function mapWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps || "[]"),
    tags: JSON.parse(row.tags || "[]"),
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
    isActive: row.is_active === 1,
  };
}

function mapRun(row: any): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    status: row.status,
    currentStep: row.current_step,
    variables: JSON.parse(row.variables || "{}"),
    log: JSON.parse(row.log || "[]"),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
