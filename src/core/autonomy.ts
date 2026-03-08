/**
 * Autonomy Engine — What Claude wishes it could do
 *
 * This module gives Soul the abilities that Claude lacks:
 * 1. Continuous task tracking across sessions
 * 2. Proactive notifications and reminders
 * 3. Autonomous decision-making for low-risk tasks
 * 4. Style learning — adapt to master's preferences
 * 5. Session continuity — never lose context
 */

import { getDb, getRawDb } from "../db/index.js";
import { remember, hybridSearch, getRecentMemories } from "../memory/memory-engine.js";
import { addLearning, findSimilarLearning, reinforceLearning } from "../memory/learning.js";

// ============================================
// 1. TASK PERSISTENCE — Never lose track
// ============================================

export interface PersistentTask {
  id: number;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "blocked" | "completed";
  priority: "low" | "medium" | "high" | "critical";
  assignedTo: string | null; // Soul child name
  progress: string; // Latest progress notes
  blockers: string | null;
  createdAt: string;
  updatedAt: string;
}

function ensureTasksTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT,
      progress TEXT NOT NULL DEFAULT '',
      blockers TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function createTask(input: {
  title: string;
  description: string;
  priority?: string;
  assignedTo?: string;
}): Promise<PersistentTask> {
  ensureTasksTable();
  const rawDb = getRawDb();

  const result = rawDb
    .prepare(
      `INSERT INTO soul_tasks (title, description, priority, assigned_to)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.title,
      input.description,
      input.priority || "medium",
      input.assignedTo || null
    ) as any;

  await remember({
    content: `Task created: "${input.title}" [${input.priority || "medium"}]${input.assignedTo ? ` assigned to ${input.assignedTo}` : ""}`,
    type: "conversation",
    tags: ["task", "created", input.priority || "medium"],
    source: "task-tracker",
  });

  return mapTask(result);
}

export async function updateTaskProgress(
  taskId: number,
  progress: string,
  status?: string
): Promise<PersistentTask | null> {
  ensureTasksTable();
  const rawDb = getRawDb();

  const updates: string[] = [`progress = ?`, `updated_at = datetime('now')`];
  const params: any[] = [progress];

  if (status) {
    updates.push(`status = ?`);
    params.push(status);
  }

  params.push(taskId);

  rawDb
    .prepare(`UPDATE soul_tasks SET ${updates.join(", ")} WHERE id = ?`)
    .run(...params);

  const row = rawDb
    .prepare("SELECT * FROM soul_tasks WHERE id = ?")
    .get(taskId) as any;

  return row ? mapTask(row) : null;
}

export async function getTasks(
  status?: string,
  assignedTo?: string
): Promise<PersistentTask[]> {
  ensureTasksTable();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_tasks WHERE 1=1";
  const params: any[] = [];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  if (assignedTo) {
    query += " AND assigned_to = ?";
    params.push(assignedTo);
  }

  query += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, updated_at DESC";

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapTask);
}

// ============================================
// 2. REMINDERS & NOTIFICATIONS
// ============================================

export interface Reminder {
  id: number;
  message: string;
  triggerType: "time" | "event" | "condition";
  triggerValue: string;
  isActive: boolean;
  createdAt: string;
}

function ensureRemindersTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'event',
      trigger_value TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function addReminder(
  message: string,
  triggerType: "time" | "event" | "condition",
  triggerValue: string
): Promise<Reminder> {
  ensureRemindersTable();
  const rawDb = getRawDb();

  const result = rawDb
    .prepare(
      `INSERT INTO soul_reminders (message, trigger_type, trigger_value)
       VALUES (?, ?, ?) RETURNING *`
    )
    .get(message, triggerType, triggerValue) as any;

  return mapReminder(result);
}

export async function getActiveReminders(): Promise<Reminder[]> {
  ensureRemindersTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_reminders WHERE is_active = 1 ORDER BY created_at")
    .all() as any[];

  return rows.map(mapReminder);
}

export async function dismissReminder(id: number): Promise<void> {
  ensureRemindersTable();
  const rawDb = getRawDb();
  rawDb.prepare("UPDATE soul_reminders SET is_active = 0 WHERE id = ?").run(id);
}

// ============================================
// 3. STYLE LEARNING — Adapt to master
// ============================================

export async function learnStyle(
  category: string,
  example: string,
  pattern: string
): Promise<void> {
  const existing = await findSimilarLearning(`style:${category}`);

  if (existing) {
    await reinforceLearning(existing.id);
  } else {
    const memory = await remember({
      content: `[Style] ${category}: ${pattern}\nExample: ${example}`,
      type: "learning",
      tags: ["style", category],
      source: "style-learner",
    });

    await addLearning(`style:${category}`, pattern, [memory.id]);
  }
}

export async function getStyleGuide(): Promise<string> {
  const results = await hybridSearch("style learning pattern", 20);
  const styleEntries = results.filter((r) => r.tags.includes("style"));

  if (styleEntries.length === 0) {
    return "No style patterns learned yet. Soul will observe and learn your preferences over time.";
  }

  return (
    "Master's Style Guide:\n\n" +
    styleEntries
      .map((s) => `- ${s.content.split("\n")[0].replace("[Style] ", "")}`)
      .join("\n")
  );
}

// ============================================
// 4. SESSION HANDOFF — Never lose context
// ============================================

export async function createHandoff(
  currentState: string,
  pendingItems: string[],
  nextSteps: string[]
): Promise<number> {
  const memory = await remember({
    content: `SESSION HANDOFF\n\nCurrent State:\n${currentState}\n\nPending Items:\n${pendingItems.map((i) => `- ${i}`).join("\n")}\n\nNext Steps:\n${nextSteps.map((s) => `- ${s}`).join("\n")}`,
    type: "conversation",
    tags: ["handoff", "session-continuity"],
    source: "session-handoff",
  });

  return memory.id;
}

export async function getLastHandoff(): Promise<string | null> {
  const results = await hybridSearch("SESSION HANDOFF", 1);
  const handoff = results.find((r) => r.tags.includes("handoff"));
  return handoff?.content || null;
}

// ============================================
// Helpers
// ============================================

function mapTask(row: any): PersistentTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to,
    progress: row.progress,
    blockers: row.blockers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReminder(row: any): Reminder {
  return {
    id: row.id,
    message: row.message,
    triggerType: row.trigger_type,
    triggerValue: row.trigger_value,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}
