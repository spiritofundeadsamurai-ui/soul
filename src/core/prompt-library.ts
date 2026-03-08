/**
 * Prompt Library — Store, categorize, and reuse the best prompts
 *
 * Inspired by: Custom GPTs (OpenAI), system prompt management
 *
 * What this does:
 * 1. Save effective prompts/instructions for reuse
 * 2. Categorize by domain (coding, writing, analysis, creative, etc.)
 * 3. Version prompts — evolve them over time
 * 4. Rate prompts based on effectiveness
 * 5. Chain prompts — combine multiple prompts into a pipeline
 * 6. Share prompts via Brain Packs
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface Prompt {
  id: number;
  name: string;
  content: string;
  category: string;
  description: string;
  variables: string[];    // {{variable}} placeholders
  rating: number;         // 0-5
  useCount: number;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

function ensurePromptTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      description TEXT NOT NULL DEFAULT '',
      variables TEXT NOT NULL DEFAULT '[]',
      rating REAL NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
}

/**
 * Save a prompt to the library
 */
export function savePrompt(input: {
  name: string;
  content: string;
  category?: string;
  description?: string;
  tags?: string[];
}): Prompt {
  ensurePromptTable();
  const rawDb = getRawDb();

  // Extract variables from content
  const vars: string[] = [];
  const matches = input.content.match(/\{\{(\w+)\}\}/g);
  if (matches) {
    for (const m of matches) {
      const v = m.replace(/\{\{|\}\}/g, "");
      if (!vars.includes(v)) vars.push(v);
    }
  }

  const row = rawDb.prepare(
    `INSERT INTO soul_prompts (name, content, category, description, variables, tags)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.name,
    input.content,
    input.category || "general",
    input.description || "",
    JSON.stringify(vars),
    JSON.stringify(input.tags || [])
  ) as any;

  return mapPrompt(row);
}

/**
 * Use a prompt — applies variables and increments use count
 */
export function usePrompt(
  name: string,
  variables?: Record<string, string>
): { prompt: Prompt; rendered: string } | null {
  ensurePromptTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    "SELECT * FROM soul_prompts WHERE name = ? AND is_active = 1"
  ).get(name) as any;
  if (!row) return null;

  // Increment use count
  rawDb.prepare(
    "UPDATE soul_prompts SET use_count = use_count + 1 WHERE id = ?"
  ).run(row.id);

  // Render with variables
  let rendered = row.content;
  if (variables) {
    for (const [key, val] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }
  }

  return { prompt: mapPrompt(row), rendered };
}

/**
 * Rate a prompt — helps track which prompts are most effective
 */
export function ratePrompt(name: string, rating: number): boolean {
  ensurePromptTable();
  const rawDb = getRawDb();

  const r = Math.max(0, Math.min(5, rating));
  const existing = rawDb.prepare(
    "SELECT rating, use_count FROM soul_prompts WHERE name = ? AND is_active = 1"
  ).get(name) as any;
  if (!existing) return false;

  // Running average
  const newRating = existing.use_count > 0
    ? (existing.rating * (existing.use_count - 1) + r) / existing.use_count
    : r;

  rawDb.prepare(
    "UPDATE soul_prompts SET rating = ?, updated_at = datetime('now') WHERE name = ?"
  ).run(Math.round(newRating * 100) / 100, name);
  return true;
}

/**
 * Update/evolve a prompt — creates a new version
 */
export function evolvePrompt(name: string, newContent: string, reason: string): Prompt | null {
  ensurePromptTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT * FROM soul_prompts WHERE name = ? AND is_active = 1"
  ).get(name) as any;
  if (!existing) return null;

  // Extract new variables
  const vars: string[] = [];
  const matches = newContent.match(/\{\{(\w+)\}\}/g);
  if (matches) {
    for (const m of matches) {
      const v = m.replace(/\{\{|\}\}/g, "");
      if (!vars.includes(v)) vars.push(v);
    }
  }

  rawDb.prepare(
    `UPDATE soul_prompts SET content = ?, variables = ?, version = version + 1, updated_at = datetime('now') WHERE name = ?`
  ).run(newContent, JSON.stringify(vars), name);

  return mapPrompt(
    rawDb.prepare("SELECT * FROM soul_prompts WHERE name = ?").get(name) as any
  );
}

/**
 * List prompts — optionally filtered by category
 */
export function listPrompts(category?: string): Prompt[] {
  ensurePromptTable();
  const rawDb = getRawDb();

  let sql = "SELECT * FROM soul_prompts WHERE is_active = 1";
  const params: any[] = [];
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  sql += " ORDER BY rating DESC, use_count DESC";

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapPrompt);
}

/**
 * Search prompts by keyword
 */
export function searchPrompts(query: string): Prompt[] {
  ensurePromptTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    `SELECT * FROM soul_prompts WHERE is_active = 1 AND (name LIKE ? OR description LIKE ? OR content LIKE ? OR tags LIKE ?)
     ORDER BY rating DESC, use_count DESC LIMIT 20`
  ).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) as any[];

  return rows.map(mapPrompt);
}

/**
 * Delete a prompt
 */
export function deletePrompt(name: string): boolean {
  ensurePromptTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_prompts SET is_active = 0 WHERE name = ?"
  ).run(name);
  return result.changes > 0;
}

/**
 * Get prompt categories with counts
 */
export function getPromptCategories(): Array<{ category: string; count: number; avgRating: number }> {
  ensurePromptTable();
  const rawDb = getRawDb();
  return rawDb.prepare(
    `SELECT category, COUNT(*) as count, ROUND(AVG(rating), 1) as avg_rating
     FROM soul_prompts WHERE is_active = 1
     GROUP BY category ORDER BY count DESC`
  ).all() as any[];
}

function mapPrompt(row: any): Prompt {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    category: row.category,
    description: row.description,
    variables: JSON.parse(row.variables || "[]"),
    rating: row.rating,
    useCount: row.use_count,
    version: row.version,
    tags: JSON.parse(row.tags || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: row.is_active === 1,
  };
}
