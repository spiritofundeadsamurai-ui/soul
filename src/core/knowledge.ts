/**
 * Knowledge Base — Organized knowledge by category
 *
 * Learned from OpenClaw's patterns.md, lessons.md, tech-stack.md:
 * 1. Categorized knowledge entries (patterns, lessons, techniques, facts)
 * 2. Confidence scoring + reinforcement
 * 3. Source tracking (where did we learn this?)
 * 4. Searchable by category and tags
 * 5. Auto-extract patterns from experiences
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";

export interface KnowledgeEntry {
  id: number;
  title: string;
  category: string; // pattern, lesson, technique, fact, principle, tip
  content: string;
  source: string;
  confidence: number;
  useCount: number;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

function ensureKnowledgeTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'observation',
      confidence REAL NOT NULL DEFAULT 0.5,
      use_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function addKnowledge(input: {
  title: string;
  category: string;
  content: string;
  source?: string;
  confidence?: number;
  tags?: string[];
}): Promise<KnowledgeEntry> {
  ensureKnowledgeTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_knowledge (title, category, content, source, confidence, tags)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.title,
      input.category,
      input.content,
      input.source || "observation",
      input.confidence || 0.5,
      JSON.stringify(input.tags || [])
    ) as any;

  await remember({
    content: `[Knowledge] ${input.category}: "${input.title}" — ${input.content.substring(0, 200)}`,
    type: "wisdom",
    tags: ["knowledge", input.category, ...(input.tags || [])],
    source: `knowledge-base:${input.source || "observation"}`,
  });

  return mapKnowledge(row);
}

export async function getKnowledge(
  category?: string,
  search?: string,
  limit = 20
): Promise<KnowledgeEntry[]> {
  ensureKnowledgeTable();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_knowledge WHERE 1=1";
  const params: any[] = [];

  if (category) {
    query += " AND category = ?";
    params.push(category);
  }

  if (search) {
    query += " AND (title LIKE ? OR content LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  query += " ORDER BY confidence DESC, use_count DESC LIMIT ?";
  params.push(limit);

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapKnowledge);
}

export async function useKnowledge(id: number): Promise<KnowledgeEntry | null> {
  ensureKnowledgeTable();
  const rawDb = getRawDb();

  rawDb
    .prepare(
      "UPDATE soul_knowledge SET use_count = use_count + 1, confidence = MIN(1.0, confidence + 0.02), updated_at = datetime('now') WHERE id = ?"
    )
    .run(id);

  const row = rawDb.prepare("SELECT * FROM soul_knowledge WHERE id = ?").get(id) as any;
  return row ? mapKnowledge(row) : null;
}

export async function updateKnowledge(
  id: number,
  updates: { content?: string; confidence?: number; tags?: string[] }
): Promise<KnowledgeEntry | null> {
  ensureKnowledgeTable();
  const rawDb = getRawDb();

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  if (updates.content) {
    sets.push("content = ?");
    params.push(updates.content);
  }
  if (updates.confidence !== undefined) {
    sets.push("confidence = ?");
    params.push(updates.confidence);
  }
  if (updates.tags) {
    sets.push("tags = ?");
    params.push(JSON.stringify(updates.tags));
  }

  params.push(id);
  rawDb.prepare(`UPDATE soul_knowledge SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const row = rawDb.prepare("SELECT * FROM soul_knowledge WHERE id = ?").get(id) as any;
  return row ? mapKnowledge(row) : null;
}

export async function getKnowledgeStats(): Promise<{
  total: number;
  byCategory: Record<string, number>;
  avgConfidence: number;
  topUsed: KnowledgeEntry[];
}> {
  ensureKnowledgeTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_knowledge").get() as any)?.c || 0;

  const byCategory: Record<string, number> = {};
  const catRows = rawDb
    .prepare("SELECT category, COUNT(*) as c FROM soul_knowledge GROUP BY category")
    .all() as any[];
  for (const r of catRows) {
    byCategory[r.category] = r.c;
  }

  const avgRow = rawDb
    .prepare("SELECT AVG(confidence) as avg FROM soul_knowledge")
    .get() as any;
  const avgConfidence = avgRow?.avg || 0;

  const topUsed = (
    rawDb
      .prepare("SELECT * FROM soul_knowledge ORDER BY use_count DESC LIMIT 5")
      .all() as any[]
  ).map(mapKnowledge);

  return { total, byCategory, avgConfidence, topUsed };
}

function mapKnowledge(row: any): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    useCount: row.use_count,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
