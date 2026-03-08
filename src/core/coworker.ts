/**
 * Coworker System — Soul Children as Real Working Agents
 *
 * Like Claude's sub-agents, each Soul Child is a coworker that:
 * 1. Has a work queue (assigned tasks)
 * 2. Logs work activity (what they did, when, results)
 * 3. Shares findings with other coworkers
 * 4. Reports status to master
 * 5. Grows expertise from completed work
 *
 * Architecture:
 * - Soul Core = Project Manager (assigns, monitors, coordinates)
 * - Soul Children = Specialists (each has domain expertise)
 * - Shared Memory = Company Wiki (everyone reads/writes)
 * - Brain View = Company Dashboard (see everyone's status)
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";
import { listChildren, getChild, type SoulChild } from "./soul-family.js";

// ─── Types ───

export interface WorkItem {
  id: number;
  childName: string;
  title: string;
  description: string;
  status: "queued" | "working" | "review" | "done" | "blocked";
  priority: "low" | "normal" | "high" | "urgent";
  result: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WorkLog {
  id: number;
  childName: string;
  workItemId: number | null;
  action: string;
  detail: string;
  createdAt: string;
}

export interface CoworkerStatus {
  name: string;
  specialty: string;
  personality: string;
  abilities: string[];
  currentWork: WorkItem | null;
  queuedItems: number;
  completedItems: number;
  recentActivity: WorkLog[];
  expertise: string[];
}

// ─── DB ───

function ensureCoworkerTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      priority TEXT NOT NULL DEFAULT 'normal',
      result TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_name TEXT NOT NULL,
      work_item_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_expertise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_name TEXT NOT NULL,
      skill TEXT NOT NULL,
      level REAL NOT NULL DEFAULT 0.1,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(child_name, skill)
    );
  `);
}

// ─── Work Assignment ───

/**
 * Assign work to a Soul Child coworker
 */
export async function assignWork(input: {
  childName: string;
  title: string;
  description: string;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<WorkItem> {
  ensureCoworkerTables();
  const rawDb = getRawDb();

  const child = await getChild(input.childName);
  if (!child) throw new Error(`Coworker "${input.childName}" not found`);

  const row = rawDb.prepare(`
    INSERT INTO soul_work_items (child_name, title, description, priority)
    VALUES (?, ?, ?, ?) RETURNING *
  `).get(input.childName, input.title, input.description, input.priority || "normal") as any;

  // Log activity
  logActivity(input.childName, row.id, "assigned", `New task: ${input.title}`);

  await remember({
    content: `[Coworker] Assigned "${input.title}" to ${input.childName} (${child.specialty}) [${input.priority || "normal"}]`,
    type: "conversation",
    tags: ["coworker", "assign", input.childName.toLowerCase()],
    source: "coworker-system",
  });

  return mapWorkItem(row);
}

/**
 * Auto-assign work to the best coworker based on specialty
 */
export async function autoAssign(input: {
  title: string;
  description: string;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<{ assignedTo: string; workItem: WorkItem; reason: string }> {
  const children = await listChildren();
  if (children.length === 0) throw new Error("No coworkers available. Use soul_spawn to create one.");

  const taskText = `${input.title} ${input.description}`.toLowerCase();

  // Score each child based on specialty match + workload
  let bestChild = children[0];
  let bestScore = -1;
  let reason = "";

  for (const child of children) {
    let score = 0;
    const spec = child.specialty.toLowerCase();
    const abilities = child.abilities.map(a => a.toLowerCase());

    // Specialty match
    if (taskText.includes(spec)) score += 10;
    for (const ab of abilities) {
      if (taskText.includes(ab)) score += 5;
    }

    // Check expertise
    ensureCoworkerTables();
    const rawDb = getRawDb();
    const expertise = rawDb.prepare(
      "SELECT skill, level FROM soul_expertise WHERE child_name = ? ORDER BY level DESC LIMIT 10"
    ).all(child.name) as any[];

    for (const exp of expertise) {
      if (taskText.includes(exp.skill.toLowerCase())) score += exp.level * 8;
    }

    // Penalize for heavy workload
    const workload = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status IN ('queued', 'working')"
    ).get(child.name) as any;
    score -= (workload?.c || 0) * 2;

    if (score > bestScore) {
      bestScore = score;
      bestChild = child;
      reason = score > 0
        ? `Best match: ${child.specialty} (score: ${score})`
        : `Least busy coworker (${child.specialty})`;
    }
  }

  const workItem = await assignWork({
    childName: bestChild.name,
    title: input.title,
    description: input.description,
    priority: input.priority,
  });

  return { assignedTo: bestChild.name, workItem, reason };
}

// ─── Work Progress ───

/**
 * Start working on a task
 */
export function startWork(workItemId: number): WorkItem | null {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(`
    UPDATE soul_work_items SET status = 'working', started_at = datetime('now')
    WHERE id = ? RETURNING *
  `).get(workItemId) as any;
  if (!row) return null;
  logActivity(row.child_name, workItemId, "started", `Working on: ${row.title}`);
  return mapWorkItem(row);
}

/**
 * Submit work result
 */
export async function submitWork(workItemId: number, result: string): Promise<WorkItem | null> {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(`
    UPDATE soul_work_items SET status = 'review', result = ?
    WHERE id = ? RETURNING *
  `).get(result, workItemId) as any;
  if (!row) return null;

  logActivity(row.child_name, workItemId, "submitted", `Result: ${result.substring(0, 100)}`);

  // Grow expertise from completed work
  const taskWords = `${row.title} ${row.description}`.toLowerCase().split(/\s+/);
  const skillWords = taskWords.filter(w => w.length > 3);
  for (const word of [...new Set(skillWords)].slice(0, 5)) {
    growExpertise(row.child_name, word, 0.05);
  }

  return mapWorkItem(row);
}

/**
 * Complete/approve a work item
 */
export async function completeWork(workItemId: number, feedback?: string): Promise<WorkItem | null> {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(`
    UPDATE soul_work_items SET status = 'done', completed_at = datetime('now')
    WHERE id = ? RETURNING *
  `).get(workItemId) as any;
  if (!row) return null;

  logActivity(row.child_name, workItemId, "completed", feedback || "Task approved");

  // Store result as knowledge
  await remember({
    content: `[${row.child_name}] Completed: ${row.title}\nResult: ${row.result}${feedback ? '\nFeedback: ' + feedback : ''}`,
    type: "knowledge",
    tags: ["coworker", "result", row.child_name.toLowerCase()],
    source: `coworker:${row.child_name}`,
  });

  // Bigger expertise boost for completed work
  growExpertise(row.child_name, row.title.toLowerCase().split(/\s+/)[0] || "general", 0.15);

  return mapWorkItem(row);
}

/**
 * Share findings between coworkers
 */
export async function shareFinding(input: {
  fromChild: string;
  finding: string;
  relatedSkill: string;
}): Promise<{ sharedWith: string[] }> {
  ensureCoworkerTables();
  const children = await listChildren();
  const sharedWith: string[] = [];

  await remember({
    content: `[Shared by ${input.fromChild}] ${input.finding}`,
    type: "learning",
    tags: ["coworker", "shared", input.fromChild.toLowerCase(), input.relatedSkill],
    source: `coworker:${input.fromChild}`,
  });

  logActivity(input.fromChild, null, "shared", input.finding.substring(0, 100));

  for (const child of children) {
    if (child.name !== input.fromChild) {
      sharedWith.push(child.name);
      // Passive expertise gain for receiving shared knowledge
      growExpertise(child.name, input.relatedSkill, 0.02);
    }
  }

  // Expertise boost for sharer
  growExpertise(input.fromChild, input.relatedSkill, 0.08);

  return { sharedWith };
}

// ─── Status & Dashboard ───

/**
 * Get full status of a coworker
 */
export async function getCoworkerStatus(childName: string): Promise<CoworkerStatus | null> {
  ensureCoworkerTables();
  const child = await getChild(childName);
  if (!child) return null;

  const rawDb = getRawDb();

  const currentWork = rawDb.prepare(
    "SELECT * FROM soul_work_items WHERE child_name = ? AND status = 'working' ORDER BY created_at DESC LIMIT 1"
  ).get(childName) as any;

  const queued = rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status IN ('queued', 'working')"
  ).get(childName) as any;

  const completed = rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status = 'done'"
  ).get(childName) as any;

  const recentLogs = rawDb.prepare(
    "SELECT * FROM soul_work_logs WHERE child_name = ? ORDER BY created_at DESC LIMIT 10"
  ).all(childName) as any[];

  const expertise = rawDb.prepare(
    "SELECT skill, level FROM soul_expertise WHERE child_name = ? ORDER BY level DESC LIMIT 10"
  ).all(childName) as any[];

  return {
    name: child.name,
    specialty: child.specialty,
    personality: child.personality,
    abilities: child.abilities,
    currentWork: currentWork ? mapWorkItem(currentWork) : null,
    queuedItems: queued?.c || 0,
    completedItems: completed?.c || 0,
    recentActivity: recentLogs.map(mapWorkLog),
    expertise: expertise.map((e: any) => `${e.skill} (${Math.round(e.level * 100)}%)`),
  };
}

/**
 * Get team overview — all coworkers status
 */
export async function getTeamOverview(): Promise<{
  totalCoworkers: number;
  activeWork: number;
  completedTotal: number;
  coworkers: Array<{
    name: string;
    specialty: string;
    status: "idle" | "working" | "reviewing";
    currentTask: string | null;
    queued: number;
    completed: number;
    topSkills: string[];
  }>;
}> {
  ensureCoworkerTables();
  const children = await listChildren();
  const rawDb = getRawDb();

  const coworkers = children.map(child => {
    const current = rawDb.prepare(
      "SELECT title FROM soul_work_items WHERE child_name = ? AND status = 'working' LIMIT 1"
    ).get(child.name) as any;

    const reviewing = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status = 'review'"
    ).get(child.name) as any;

    const queued = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status IN ('queued', 'working')"
    ).get(child.name) as any;

    const completed = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_work_items WHERE child_name = ? AND status = 'done'"
    ).get(child.name) as any;

    const skills = rawDb.prepare(
      "SELECT skill FROM soul_expertise WHERE child_name = ? ORDER BY level DESC LIMIT 3"
    ).all(child.name) as any[];

    const status = current ? "working" : (reviewing?.c > 0 ? "reviewing" : "idle");

    return {
      name: child.name,
      specialty: child.specialty,
      status: status as "idle" | "working" | "reviewing",
      currentTask: current?.title || null,
      queued: queued?.c || 0,
      completed: completed?.c || 0,
      topSkills: skills.map((s: any) => s.skill),
    };
  });

  const activeWork = coworkers.filter(c => c.status === "working").length;
  const completedTotal = coworkers.reduce((sum, c) => sum + c.completed, 0);

  return {
    totalCoworkers: coworkers.length,
    activeWork,
    completedTotal,
    coworkers,
  };
}

/**
 * Get work history for a coworker
 */
export function getWorkHistory(childName: string, limit = 20): WorkItem[] {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_work_items WHERE child_name = ? ORDER BY created_at DESC LIMIT ?"
  ).all(childName, limit) as any[];
  return rows.map(mapWorkItem);
}

/**
 * Get all work logs (team activity feed)
 */
export function getTeamActivity(limit = 30): WorkLog[] {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_work_logs ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as any[];
  return rows.map(mapWorkLog);
}

// ─── Expertise System ───

function growExpertise(childName: string, skill: string, amount: number) {
  const rawDb = getRawDb();
  const clean = skill.replace(/[^a-z0-9\-_]/gi, "").substring(0, 50);
  if (!clean) return;

  try {
    rawDb.prepare(`
      INSERT INTO soul_expertise (child_name, skill, level, evidence_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(child_name, skill) DO UPDATE SET
        level = MIN(1.0, level + ?),
        evidence_count = evidence_count + 1,
        updated_at = datetime('now')
    `).run(childName, clean, Math.min(1, amount), amount);
  } catch { /* skip */ }
}

export function getExpertise(childName: string): Array<{ skill: string; level: number; evidence: number }> {
  ensureCoworkerTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_expertise WHERE child_name = ? ORDER BY level DESC"
  ).all(childName) as any[];
  return rows.map((r: any) => ({ skill: r.skill, level: r.level, evidence: r.evidence_count }));
}

// ─── Internal Helpers ───

function logActivity(childName: string, workItemId: number | null, action: string, detail: string) {
  const rawDb = getRawDb();
  try {
    rawDb.prepare(
      "INSERT INTO soul_work_logs (child_name, work_item_id, action, detail) VALUES (?, ?, ?, ?)"
    ).run(childName, workItemId, action, detail);
  } catch { /* non-critical */ }
}

function mapWorkItem(row: any): WorkItem {
  return {
    id: row.id,
    childName: row.child_name,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    result: row.result,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapWorkLog(row: any): WorkLog {
  return {
    id: row.id,
    childName: row.child_name,
    workItemId: row.work_item_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  };
}
