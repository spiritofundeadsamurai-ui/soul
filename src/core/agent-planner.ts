/**
 * Agent Planner — Planning Step + Backtracking for the Agent Loop
 *
 * Before executing tools, the agent generates a plan with steps.
 * If a step fails, it tries alternatives or backtracks to a previous step.
 * Plans are persisted in SQLite for learning and review.
 *
 * Inspired by: HTN planning, STRIPS, and LLM-based task decomposition
 */

import { getRawDb } from "../db/index.js";
import crypto from "crypto";

// ─── Interfaces ───

export interface PlanStep {
  id: number;
  action: string;
  toolName?: string;
  expectedOutcome: string;
  status: "pending" | "executing" | "done" | "failed" | "skipped";
  result?: string;
  alternatives?: string[];
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  currentStep: number;
  status: "planning" | "executing" | "completed" | "failed" | "backtracked";
  backtrackCount: number;
  backtrackHistory: BacktrackEntry[];
  createdAt: string;
  completedAt?: string;
}

export interface BacktrackEntry {
  fromStep: number;
  toStep: number;
  reason: string;
  timestamp: string;
}

export interface PlanResult {
  plan: Plan;
  success: boolean;
  finalOutput: string;
}

// ─── Configuration ───

const DEFAULT_MAX_BACKTRACK_DEPTH = 3;

// ─── Database ───

function ensureAgentPlansTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_agent_plans (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'planning',
      backtrack_count INTEGER NOT NULL DEFAULT 0,
      backtrack_history TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
}

// ─── Plan Persistence ───

export function savePlan(plan: Plan): void {
  ensureAgentPlansTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare("SELECT id FROM soul_agent_plans WHERE id = ?").get(plan.id);

  if (existing) {
    rawDb.prepare(`
      UPDATE soul_agent_plans
      SET goal = ?, steps = ?, status = ?, backtrack_count = ?,
          backtrack_history = ?, completed_at = ?
      WHERE id = ?
    `).run(
      plan.goal,
      JSON.stringify(plan.steps),
      plan.status,
      plan.backtrackCount,
      JSON.stringify(plan.backtrackHistory),
      plan.completedAt || null,
      plan.id
    );
  } else {
    rawDb.prepare(`
      INSERT INTO soul_agent_plans (id, goal, steps, status, backtrack_count, backtrack_history, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.id,
      plan.goal,
      JSON.stringify(plan.steps),
      plan.status,
      plan.backtrackCount,
      JSON.stringify(plan.backtrackHistory),
      plan.createdAt,
      plan.completedAt || null
    );
  }
}

export function loadPlan(id: string): Plan | null {
  ensureAgentPlansTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare("SELECT * FROM soul_agent_plans WHERE id = ?").get(id) as any;
  if (!row) return null;

  return {
    id: row.id,
    goal: row.goal,
    steps: JSON.parse(row.steps),
    currentStep: findCurrentStep(JSON.parse(row.steps)),
    status: row.status,
    backtrackCount: row.backtrack_count,
    backtrackHistory: JSON.parse(row.backtrack_history),
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}

export function listRecentPlans(limit: number = 10): Plan[] {
  ensureAgentPlansTable();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_agent_plans ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    goal: row.goal,
    steps: JSON.parse(row.steps),
    currentStep: findCurrentStep(JSON.parse(row.steps)),
    status: row.status,
    backtrackCount: row.backtrack_count,
    backtrackHistory: JSON.parse(row.backtrack_history),
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  }));
}

function findCurrentStep(steps: PlanStep[]): number {
  const idx = steps.findIndex((s) => s.status === "pending" || s.status === "executing");
  return idx >= 0 ? idx : steps.length - 1;
}

// ─── Plan Generation ───

export async function generatePlan(
  goal: string,
  availableTools: string[],
  context?: string
): Promise<Plan> {
  const steps = decomposeToPlanSteps(goal, availableTools, context);

  const plan: Plan = {
    id: crypto.randomUUID(),
    goal,
    steps,
    currentStep: 0,
    status: "planning",
    backtrackCount: 0,
    backtrackHistory: [],
    createdAt: new Date().toISOString(),
  };

  savePlan(plan);
  return plan;
}

/**
 * Decompose a goal into plan steps based on available tools and heuristics.
 * Uses keyword matching to map goal parts to tools.
 */
function decomposeToPlanSteps(
  goal: string,
  availableTools: string[],
  context?: string
): PlanStep[] {
  const lower = goal.toLowerCase();
  const steps: PlanStep[] = [];
  let stepId = 1;

  // Heuristic decomposition: break goal into logical phases
  // Phase 1: Information gathering (if goal mentions search/find/check/analyze)
  const gatherKeywords = ["search", "find", "check", "analyze", "look", "read", "get", "list", "show", "ค้นหา", "หา", "ดู", "อ่าน"];
  const gatherMatched = gatherKeywords.some((kw) => lower.includes(kw));

  if (gatherMatched) {
    const gatherTool = availableTools.find((t) =>
      t.includes("search") || t.includes("read") || t.includes("list") || t.includes("find")
    );
    steps.push({
      id: stepId++,
      action: "Gather information relevant to the goal",
      toolName: gatherTool,
      expectedOutcome: "Retrieved relevant data for the task",
      status: "pending",
      alternatives: availableTools
        .filter((t) => t.includes("search") || t.includes("recall") || t.includes("knowledge"))
        .slice(0, 3),
    });
  }

  // Phase 2: Processing/thinking (if goal mentions think/decide/plan/brainstorm)
  const thinkKeywords = ["think", "decide", "plan", "brainstorm", "reason", "evaluate", "คิด", "ตัดสินใจ", "วางแผน"];
  const thinkMatched = thinkKeywords.some((kw) => lower.includes(kw));

  if (thinkMatched) {
    const thinkTool = availableTools.find((t) =>
      t.includes("think") || t.includes("reason") || t.includes("brainstorm") || t.includes("decide")
    );
    steps.push({
      id: stepId++,
      action: "Process and analyze gathered information",
      toolName: thinkTool,
      expectedOutcome: "Analyzed data and formed conclusions",
      status: "pending",
      alternatives: availableTools
        .filter((t) => t.includes("think") || t.includes("analyze") || t.includes("evaluate"))
        .slice(0, 3),
    });
  }

  // Phase 3: Action/creation (if goal mentions create/write/make/save/remember)
  const actionKeywords = ["create", "write", "make", "save", "remember", "add", "build", "generate", "สร้าง", "เขียน", "จำ", "บันทึก"];
  const actionMatched = actionKeywords.some((kw) => lower.includes(kw));

  if (actionMatched) {
    const actionTool = availableTools.find((t) =>
      t.includes("create") || t.includes("write") || t.includes("save") || t.includes("remember")
    );
    steps.push({
      id: stepId++,
      action: "Execute the primary action for the goal",
      toolName: actionTool,
      expectedOutcome: "Successfully completed the main action",
      status: "pending",
      alternatives: availableTools
        .filter((t) => t.includes("create") || t.includes("save") || t.includes("add"))
        .slice(0, 3),
    });
  }

  // Phase 4: Verification/confirmation
  const verifyKeywords = ["verify", "confirm", "check", "validate", "test", "ตรวจสอบ", "ยืนยัน"];
  const verifyMatched = verifyKeywords.some((kw) => lower.includes(kw));

  if (verifyMatched || steps.length > 1) {
    steps.push({
      id: stepId++,
      action: "Verify the result and confirm completion",
      toolName: availableTools.find((t) => t.includes("status") || t.includes("check") || t.includes("list")),
      expectedOutcome: "Confirmed that the goal was achieved",
      status: "pending",
      alternatives: [],
    });
  }

  // Fallback: if no steps were created, create a single direct-action step
  if (steps.length === 0) {
    const bestTool = availableTools[0];
    steps.push({
      id: stepId++,
      action: `Execute goal directly: ${goal}`,
      toolName: bestTool,
      expectedOutcome: "Goal completed successfully",
      status: "pending",
      alternatives: availableTools.slice(1, 4),
    });
  }

  return steps;
}

// ─── Backtracking ───

/**
 * Handle a step failure — try alternatives first, then backtrack if needed.
 */
export function handleStepFailure(
  plan: Plan,
  stepId: number,
  error: string,
  maxBacktrackDepth: number = DEFAULT_MAX_BACKTRACK_DEPTH
): Plan {
  const stepIndex = plan.steps.findIndex((s) => s.id === stepId);
  if (stepIndex < 0) return plan;

  const step = plan.steps[stepIndex];
  step.status = "failed";
  step.result = `Failed: ${error}`;

  // Try alternatives for this step
  if (step.alternatives && step.alternatives.length > 0) {
    const nextAlternative = step.alternatives.shift()!;

    // Create a retry step with the alternative tool
    const retryStep: PlanStep = {
      id: step.id, // reuse same id
      action: step.action + " (retry with alternative)",
      toolName: nextAlternative,
      expectedOutcome: step.expectedOutcome,
      status: "pending",
      alternatives: step.alternatives,
    };

    plan.steps[stepIndex] = retryStep;
    plan.currentStep = stepIndex;
    plan.status = "executing";
    savePlan(plan);
    return plan;
  }

  // No alternatives left — backtrack if within depth limit
  if (plan.backtrackCount < maxBacktrackDepth && stepIndex > 0) {
    const backtrackTo = stepIndex - 1;
    plan = backtrack(plan, backtrackTo);
    plan.backtrackHistory.push({
      fromStep: stepId,
      toStep: plan.steps[backtrackTo].id,
      reason: error,
      timestamp: new Date().toISOString(),
    });
    plan.backtrackCount++;
    plan.status = "backtracked";
    savePlan(plan);
    return plan;
  }

  // Exhausted all options — mark plan as failed
  plan.status = "failed";
  plan.completedAt = new Date().toISOString();
  savePlan(plan);
  return plan;
}

/**
 * Backtrack to a specific step — reset all steps from that point onwards.
 */
export function backtrack(plan: Plan, toStep: number): Plan {
  if (toStep < 0 || toStep >= plan.steps.length) return plan;

  // Reset steps from toStep onwards
  for (let i = toStep; i < plan.steps.length; i++) {
    plan.steps[i].status = "pending";
    plan.steps[i].result = undefined;
  }

  plan.currentStep = toStep;
  return plan;
}

// ─── Integration Hook ───

/**
 * Wrap tool execution with planning + backtracking logic.
 *
 * Usage from agent-loop.ts:
 *   const result = await withPlanning(goal, toolNames, async (step) => {
 *     return await executeToolByName(step.toolName, args);
 *   });
 */
export async function withPlanning(
  goal: string,
  tools: string[],
  executor: (step: PlanStep) => Promise<string>,
  maxBacktrackDepth: number = DEFAULT_MAX_BACKTRACK_DEPTH
): Promise<PlanResult> {
  // Generate plan
  const plan = await generatePlan(goal, tools);
  plan.status = "executing";
  savePlan(plan);

  const outputs: string[] = [];

  while (plan.currentStep < plan.steps.length) {
    const step = plan.steps[plan.currentStep];

    // Skip steps that are already done
    if (step.status === "done" || step.status === "skipped") {
      plan.currentStep++;
      continue;
    }

    step.status = "executing";
    savePlan(plan);

    try {
      const result = await executor(step);
      step.status = "done";
      step.result = result;
      outputs.push(result);
      plan.currentStep++;
      savePlan(plan);
    } catch (err: any) {
      const errorMsg = err.message || String(err);

      // handleStepFailure will try alternatives or backtrack
      const updatedPlan = handleStepFailure(plan, step.id, errorMsg, maxBacktrackDepth);

      // Copy updated state back
      plan.steps = updatedPlan.steps;
      plan.currentStep = updatedPlan.currentStep;
      plan.status = updatedPlan.status;
      plan.backtrackCount = updatedPlan.backtrackCount;
      plan.backtrackHistory = updatedPlan.backtrackHistory;

      if (plan.status === "failed") {
        return {
          plan,
          success: false,
          finalOutput: `Plan failed at step ${step.id}: ${errorMsg}\n\nCompleted outputs:\n${outputs.join("\n")}`,
        };
      }

      // Otherwise continue the loop (will retry or backtrack)
    }
  }

  // All steps done
  plan.status = "completed";
  plan.completedAt = new Date().toISOString();
  savePlan(plan);

  return {
    plan,
    success: true,
    finalOutput: outputs.join("\n\n"),
  };
}

// ─── Utility ───

/**
 * Format a plan as a readable string for display.
 */
export function formatPlan(plan: Plan): string {
  const statusIcons: Record<string, string> = {
    pending: "[ ]",
    executing: "[>]",
    done: "[x]",
    failed: "[!]",
    skipped: "[-]",
  };

  let text = `Plan: ${plan.goal}\n`;
  text += `ID: ${plan.id}\n`;
  text += `Status: ${plan.status} | Steps: ${plan.steps.length} | Backtracks: ${plan.backtrackCount}\n`;
  text += `Created: ${plan.createdAt}${plan.completedAt ? ` | Completed: ${plan.completedAt}` : ""}\n\n`;

  for (const step of plan.steps) {
    const icon = statusIcons[step.status] || "[ ]";
    text += `${icon} Step ${step.id}: ${step.action}\n`;
    if (step.toolName) text += `    Tool: ${step.toolName}\n`;
    text += `    Expected: ${step.expectedOutcome}\n`;
    if (step.result) text += `    Result: ${step.result}\n`;
    if (step.alternatives && step.alternatives.length > 0) {
      text += `    Alternatives: ${step.alternatives.join(", ")}\n`;
    }
    text += "\n";
  }

  if (plan.backtrackHistory.length > 0) {
    text += "Backtrack History:\n";
    for (const bt of plan.backtrackHistory) {
      text += `  Step ${bt.fromStep} -> Step ${bt.toStep}: ${bt.reason} (${bt.timestamp})\n`;
    }
  }

  return text;
}
