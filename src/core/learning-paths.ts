/**
 * Learning Paths — Structured learning with progress tracking
 *
 * 1. Create learning paths (e.g., "Learn Rust", "Master System Design")
 * 2. Add milestones/topics to each path
 * 3. Track progress (% complete)
 * 4. Auto-suggest next steps
 * 5. Connect with research engine for resources
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface LearningPath {
  id: number;
  title: string;
  description: string;
  difficulty: string;
  status: string;
  progress: number;
  milestones: string; // JSON array
  resources: string;  // JSON array
  createdAt: string;
  updatedAt: string;
}

function ensureLearningTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_learning_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'intermediate',
      status TEXT NOT NULL DEFAULT 'active',
      progress REAL NOT NULL DEFAULT 0,
      milestones TEXT NOT NULL DEFAULT '[]',
      resources TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function createLearningPath(input: {
  title: string;
  description?: string;
  difficulty?: string;
  milestones?: Array<{ title: string; done?: boolean }>;
  resources?: string[];
}): Promise<LearningPath> {
  ensureLearningTable();
  const rawDb = getRawDb();

  const milestones = (input.milestones || []).map(m => ({ ...m, done: m.done || false }));

  const row = rawDb.prepare(
    `INSERT INTO soul_learning_paths (title, description, difficulty, milestones, resources)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.title,
    input.description || "",
    input.difficulty || "intermediate",
    JSON.stringify(milestones),
    JSON.stringify(input.resources || [])
  ) as any;

  await remember({
    content: `[Learning Path] Started: "${input.title}" (${input.difficulty || "intermediate"})`,
    type: "learning",
    tags: ["learning-path", input.title.toLowerCase().replace(/\s+/g, "-")],
    source: "learning-paths",
  });

  return mapPath(row);
}

export function getLearningPaths(status?: string): LearningPath[] {
  ensureLearningTable();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_learning_paths WHERE 1=1";
  const params: any[] = [];
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY updated_at DESC";
  return (rawDb.prepare(sql).all(...params) as any[]).map(mapPath);
}

export async function completeMilestone(pathId: number, milestoneIndex: number): Promise<LearningPath | null> {
  ensureLearningTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  if (!row) return null;

  const milestones = JSON.parse(row.milestones);
  if (milestoneIndex < 0 || milestoneIndex >= milestones.length) return null;

  milestones[milestoneIndex].done = true;

  // Calculate progress
  const done = milestones.filter((m: any) => m.done).length;
  const progress = milestones.length > 0 ? (done / milestones.length) * 100 : 0;
  const status = progress >= 100 ? "completed" : "active";

  rawDb.prepare(
    "UPDATE soul_learning_paths SET milestones = ?, progress = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(milestones), progress, status, pathId);

  if (status === "completed") {
    await remember({
      content: `[Learning Path] Completed: "${row.title}"!`,
      type: "wisdom",
      tags: ["learning-path", "completed", row.title.toLowerCase().replace(/\s+/g, "-")],
      source: "learning-paths",
    });
  }

  const updated = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  return mapPath(updated);
}

export function addMilestone(pathId: number, title: string): LearningPath | null {
  ensureLearningTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  if (!row) return null;

  const milestones = JSON.parse(row.milestones);
  milestones.push({ title, done: false });

  // Recalculate progress
  const done = milestones.filter((m: any) => m.done).length;
  const progress = milestones.length > 0 ? (done / milestones.length) * 100 : 0;

  rawDb.prepare(
    "UPDATE soul_learning_paths SET milestones = ?, progress = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(milestones), progress, pathId);

  const updated = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  return mapPath(updated);
}

export function addResource(pathId: number, resource: string): LearningPath | null {
  ensureLearningTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  if (!row) return null;

  const resources = JSON.parse(row.resources);
  resources.push(resource);

  rawDb.prepare(
    "UPDATE soul_learning_paths SET resources = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(resources), pathId);

  const updated = rawDb.prepare("SELECT * FROM soul_learning_paths WHERE id = ?").get(pathId) as any;
  return mapPath(updated);
}

function mapPath(row: any): LearningPath {
  return {
    id: row.id, title: row.title, description: row.description,
    difficulty: row.difficulty, status: row.status,
    progress: row.progress, milestones: row.milestones,
    resources: row.resources,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
