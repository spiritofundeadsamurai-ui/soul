/**
 * Goal Autopilot — Autonomous goal decomposition and progress tracking
 *
 * Inspired by: AutoGPT (autonomous goal pursuit), Devin (plan → execute → verify)
 *
 * What this does:
 * 1. Take a high-level goal → decompose into actionable milestones
 * 2. Each milestone → decompose into concrete tasks
 * 3. Track progress across sessions (goals persist)
 * 4. Suggest next actions based on current state
 * 5. Detect blocked goals and suggest unblocking strategies
 * 6. Generate progress reports
 *
 * This gives Soul INITIATIVE — it doesn't just respond, it PURSUES goals.
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";
import { findBestSoulForTask, listChildren } from "./soul-family.js";

export interface AutoGoal {
  id: number;
  title: string;
  description: string;
  status: "active" | "paused" | "completed" | "abandoned";
  priority: "low" | "medium" | "high" | "critical";
  milestones: Milestone[];
  progress: number; // 0-100
  assignedSoul: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  nextAction: string;
}

export interface Milestone {
  id: string;
  title: string;
  tasks: MilestoneTask[];
  status: "pending" | "in_progress" | "completed" | "blocked";
  completedAt: string | null;
}

export interface MilestoneTask {
  id: string;
  title: string;
  status: "pending" | "done" | "skipped" | "blocked";
  blockedBy: string | null;
  completedAt: string | null;
}

function ensureGoalTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_auto_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'medium',
      milestones TEXT NOT NULL DEFAULT '[]',
      progress INTEGER NOT NULL DEFAULT 0,
      assigned_soul TEXT,
      next_action TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
}

/**
 * Create a goal with auto-decomposed milestones
 */
export async function createAutoGoal(input: {
  title: string;
  description: string;
  priority?: "low" | "medium" | "high" | "critical";
  milestones?: Array<{ title: string; tasks: string[] }>;
}): Promise<{ goal: AutoGoal; plan: string }> {
  ensureGoalTable();
  const rawDb = getRawDb();

  // Auto-decompose if no milestones provided
  const milestones: Milestone[] = (input.milestones || autoDecompose(input.title, input.description)).map((m, i) => ({
    id: `m${i + 1}`,
    title: m.title,
    tasks: (m.tasks || []).map((t, j) => ({
      id: `m${i + 1}_t${j + 1}`,
      title: typeof t === "string" ? t : t,
      status: "pending" as const,
      blockedBy: null,
      completedAt: null,
    })),
    status: "pending" as const,
    completedAt: null,
  }));

  const nextAction = milestones.length > 0 && milestones[0].tasks.length > 0
    ? milestones[0].tasks[0].title
    : "Define first milestone";

  // Try to find best Soul for this goal
  let assignedSoul: string | null = null;
  try {
    const match = await findBestSoulForTask(input.title + " " + input.description);
    if (match.bestMatch) assignedSoul = match.bestMatch.name;
  } catch { /* no souls yet */ }

  const row = rawDb.prepare(
    `INSERT INTO soul_auto_goals (title, description, priority, milestones, next_action, assigned_soul)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.title,
    input.description,
    input.priority || "medium",
    JSON.stringify(milestones),
    nextAction,
    assignedSoul
  ) as any;

  // Build plan text
  let plan = `=== Goal Autopilot: "${input.title}" ===\n`;
  plan += `Priority: ${input.priority || "medium"}\n`;
  if (assignedSoul) plan += `Best Soul for this: ${assignedSoul}\n`;
  plan += `\n`;

  plan += `Milestones (${milestones.length}):\n\n`;
  for (const m of milestones) {
    plan += `${m.id}. ${m.title}\n`;
    for (const t of m.tasks) {
      plan += `  [ ] ${t.title}\n`;
    }
    plan += `\n`;
  }

  plan += `--- Next Action ---\n`;
  plan += `> ${nextAction}\n\n`;
  plan += `Use soul_goal_progress to mark tasks done.\n`;
  plan += `Use soul_goal_next to get the next suggested action.\n`;

  await remember({
    content: `[Goal Autopilot] Created: "${input.title}" — ${milestones.length} milestones, priority: ${input.priority || "medium"}`,
    type: "conversation",
    tags: ["goal-autopilot", "planning"],
    source: "goal-autopilot",
  });

  return { goal: mapGoal(row), plan };
}

/**
 * Mark a task as done in a goal
 */
export function markTaskDone(
  goalId: number,
  taskId: string
): { goal: AutoGoal; nextAction: string } | null {
  ensureGoalTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT * FROM soul_auto_goals WHERE id = ?"
  ).get(goalId) as any;
  if (!existing) return null;

  const milestones: Milestone[] = JSON.parse(existing.milestones || "[]");

  // Find and mark the task
  let found = false;
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (t.id === taskId) {
        t.status = "done";
        t.completedAt = new Date().toISOString();
        found = true;
      }
    }
    // Check if all tasks in milestone are done
    if (m.tasks.every(t => t.status === "done" || t.status === "skipped")) {
      m.status = "completed";
      m.completedAt = new Date().toISOString();
    } else if (m.tasks.some(t => t.status === "done")) {
      m.status = "in_progress";
    }
  }

  if (!found) return null;

  // Calculate progress
  const totalTasks = milestones.flatMap(m => m.tasks).length;
  const doneTasks = milestones.flatMap(m => m.tasks).filter(t => t.status === "done").length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Find next action
  const nextAction = findNextAction(milestones);

  // Check if goal is complete
  const allDone = milestones.every(m => m.status === "completed");
  const status = allDone ? "completed" : existing.status;

  rawDb.prepare(
    `UPDATE soul_auto_goals SET milestones = ?, progress = ?, next_action = ?, status = ?, updated_at = datetime('now')${allDone ? ", completed_at = datetime('now')" : ""} WHERE id = ?`
  ).run(JSON.stringify(milestones), progress, nextAction, status, goalId);

  const goal = mapGoal(rawDb.prepare("SELECT * FROM soul_auto_goals WHERE id = ?").get(goalId) as any);
  return { goal, nextAction };
}

/**
 * Get next suggested action for a goal
 */
export function getNextAction(goalId: number): {
  nextAction: string;
  progress: number;
  blockers: string[];
  suggestion: string;
} | null {
  ensureGoalTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT * FROM soul_auto_goals WHERE id = ?"
  ).get(goalId) as any;
  if (!existing) return null;

  const milestones: Milestone[] = JSON.parse(existing.milestones || "[]");
  const nextAction = findNextAction(milestones);

  // Find blockers
  const blockers = milestones
    .flatMap(m => m.tasks)
    .filter(t => t.status === "blocked")
    .map(t => `${t.title} (blocked by: ${t.blockedBy || "unknown"})`);

  // Generate suggestion
  let suggestion = "";
  const progress = existing.progress;
  if (progress === 0) suggestion = "Start with the first task. Small steps build momentum.";
  else if (progress < 25) suggestion = "Good start! Keep the momentum going.";
  else if (progress < 50) suggestion = "Almost halfway. Consider reviewing what's working and what's not.";
  else if (progress < 75) suggestion = "Past halfway! The finish line is in sight.";
  else if (progress < 100) suggestion = "Almost there! Final push — don't lose focus.";
  else suggestion = "Goal complete! Time to celebrate and set the next goal.";

  if (blockers.length > 0) {
    suggestion = `${blockers.length} task(s) blocked. Unblock these before moving forward.`;
  }

  return { nextAction, progress, blockers, suggestion };
}

/**
 * Mark a task as blocked
 */
export function markTaskBlocked(goalId: number, taskId: string, blockedBy: string): boolean {
  ensureGoalTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT * FROM soul_auto_goals WHERE id = ?"
  ).get(goalId) as any;
  if (!existing) return false;

  const milestones: Milestone[] = JSON.parse(existing.milestones || "[]");
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (t.id === taskId) {
        t.status = "blocked";
        t.blockedBy = blockedBy;
      }
    }
    if (m.tasks.some(t => t.status === "blocked")) {
      m.status = "blocked";
    }
  }

  rawDb.prepare(
    "UPDATE soul_auto_goals SET milestones = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(milestones), goalId);

  return true;
}

/**
 * List all goals
 */
export function listAutoGoals(status?: string): AutoGoal[] {
  ensureGoalTable();
  const rawDb = getRawDb();

  let sql = "SELECT * FROM soul_auto_goals";
  const params: any[] = [];
  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, updated_at DESC";

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapGoal);
}

/**
 * Get goal detail
 */
export function getAutoGoal(goalId: number): AutoGoal | null {
  ensureGoalTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare("SELECT * FROM soul_auto_goals WHERE id = ?").get(goalId) as any;
  return row ? mapGoal(row) : null;
}

/**
 * Generate a progress report across all active goals
 */
export async function getGoalsDashboard(): Promise<string> {
  const goals = listAutoGoals();
  const active = goals.filter(g => g.status === "active");
  const completed = goals.filter(g => g.status === "completed");
  const paused = goals.filter(g => g.status === "paused");

  let report = `=== Goal Autopilot Dashboard ===\n\n`;
  report += `Active: ${active.length} | Completed: ${completed.length} | Paused: ${paused.length}\n\n`;

  if (active.length > 0) {
    report += `--- Active Goals ---\n\n`;
    for (const g of active) {
      const bar = progressBar(g.progress);
      report += `[${g.priority.toUpperCase()}] ${g.title}\n`;
      report += `  ${bar} ${g.progress}%\n`;
      report += `  Next: ${g.nextAction}\n`;
      if (g.assignedSoul) report += `  Soul: ${g.assignedSoul}\n`;
      report += `\n`;
    }
  }

  if (completed.length > 0) {
    report += `--- Recently Completed ---\n`;
    for (const g of completed.slice(0, 5)) {
      report += `  [done] ${g.title} (${g.completedAt?.split("T")[0] || ""})\n`;
    }
    report += `\n`;
  }

  // Find blocked items across all goals
  const allBlocked = active.flatMap(g =>
    g.milestones.flatMap(m => m.tasks.filter(t => t.status === "blocked").map(t => ({
      goal: g.title,
      task: t.title,
      blockedBy: t.blockedBy,
    })))
  );

  if (allBlocked.length > 0) {
    report += `--- Blocked Items (need attention) ---\n`;
    for (const b of allBlocked) {
      report += `  ! ${b.goal} → ${b.task} (blocked by: ${b.blockedBy})\n`;
    }
  }

  return report;
}

/**
 * Add a milestone to an existing goal
 */
export function addMilestone(goalId: number, title: string, tasks: string[]): AutoGoal | null {
  ensureGoalTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare("SELECT * FROM soul_auto_goals WHERE id = ?").get(goalId) as any;
  if (!existing) return null;

  const milestones: Milestone[] = JSON.parse(existing.milestones || "[]");
  const newId = `m${milestones.length + 1}`;

  milestones.push({
    id: newId,
    title,
    tasks: tasks.map((t, i) => ({
      id: `${newId}_t${i + 1}`,
      title: t,
      status: "pending",
      blockedBy: null,
      completedAt: null,
    })),
    status: "pending",
    completedAt: null,
  });

  rawDb.prepare(
    "UPDATE soul_auto_goals SET milestones = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(milestones), goalId);

  return mapGoal(rawDb.prepare("SELECT * FROM soul_auto_goals WHERE id = ?").get(goalId) as any);
}

// Helpers

function autoDecompose(title: string, description: string): Array<{ title: string; tasks: string[] }> {
  // Smart decomposition based on common patterns
  return [
    {
      title: "Research & Planning",
      tasks: [
        `Research: "${title}" — understand the landscape`,
        `Define success criteria for "${title}"`,
        `Create detailed plan with timeline`,
      ],
    },
    {
      title: "Execution",
      tasks: [
        `Start implementation of "${title}"`,
        `Test and validate initial results`,
        `Iterate based on feedback`,
      ],
    },
    {
      title: "Review & Complete",
      tasks: [
        `Review all deliverables for "${title}"`,
        `Document learnings and outcomes`,
        `Mark complete and celebrate`,
      ],
    },
  ];
}

function findNextAction(milestones: Milestone[]): string {
  for (const m of milestones) {
    if (m.status === "completed") continue;
    for (const t of m.tasks) {
      if (t.status === "pending") return t.title;
    }
  }
  return "All tasks complete!";
}

function progressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
}

function mapGoal(row: any): AutoGoal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    milestones: JSON.parse(row.milestones || "[]"),
    progress: row.progress,
    assignedSoul: row.assigned_soul,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    nextAction: row.next_action || "",
  };
}
