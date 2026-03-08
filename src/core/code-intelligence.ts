/**
 * Code Intelligence — Soul helps master build projects faster
 *
 * 1. Project templates from learned patterns
 * 2. Code snippets library
 * 3. Project analysis & scoring
 * 4. Tech stack recommendations
 * 5. Code review patterns
 * 6. Bug pattern detection
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface Snippet {
  id: number;
  title: string;
  language: string;
  code: string;
  description: string;
  tags: string;
  useCount: number;
  createdAt: string;
}

export interface ProjectTemplate {
  id: number;
  name: string;
  stack: string;
  structure: string;
  description: string;
  tags: string;
  useCount: number;
  createdAt: string;
}

function ensureCodeTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_project_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      stack TEXT NOT NULL,
      structure TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_code_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_type TEXT NOT NULL,
      language TEXT NOT NULL,
      pattern TEXT NOT NULL,
      example TEXT NOT NULL DEFAULT '',
      anti_pattern TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// === Snippets ===

export async function saveSnippet(input: {
  title: string;
  language: string;
  code: string;
  description?: string;
  tags?: string[];
}): Promise<Snippet> {
  ensureCodeTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "INSERT INTO soul_snippets (title, language, code, description, tags) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(input.title, input.language, input.code, input.description || "", JSON.stringify(input.tags || [])) as any;

  await remember({
    content: `[Snippet] ${input.language}: "${input.title}"\n${input.code.substring(0, 300)}`,
    type: "wisdom",
    tags: ["snippet", input.language, ...(input.tags || [])],
    source: "code-intelligence",
  });

  return mapSnippet(row);
}

export function searchSnippets(query?: string, language?: string, limit = 20): Snippet[] {
  ensureCodeTables();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_snippets WHERE 1=1";
  const params: any[] = [];

  if (query) {
    sql += " AND (title LIKE ? OR description LIKE ? OR code LIKE ?)";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (language) {
    sql += " AND language = ?";
    params.push(language);
  }
  sql += " ORDER BY use_count DESC, created_at DESC LIMIT ?";
  params.push(limit);

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapSnippet);
}

export function useSnippet(id: number): Snippet | null {
  ensureCodeTables();
  const rawDb = getRawDb();
  rawDb.prepare("UPDATE soul_snippets SET use_count = use_count + 1 WHERE id = ?").run(id);
  const row = rawDb.prepare("SELECT * FROM soul_snippets WHERE id = ?").get(id) as any;
  return row ? mapSnippet(row) : null;
}

// === Project Templates ===

export async function saveTemplate(input: {
  name: string;
  stack: string;
  structure: string;
  description?: string;
  tags?: string[];
}): Promise<ProjectTemplate> {
  ensureCodeTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "INSERT INTO soul_project_templates (name, stack, structure, description, tags) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(input.name, input.stack, input.structure, input.description || "", JSON.stringify(input.tags || [])) as any;

  return mapTemplate(row);
}

export function getTemplates(stack?: string, limit = 20): ProjectTemplate[] {
  ensureCodeTables();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_project_templates WHERE 1=1";
  const params: any[] = [];

  if (stack) {
    sql += " AND stack LIKE ?";
    params.push(`%${stack}%`);
  }
  sql += " ORDER BY use_count DESC LIMIT ?";
  params.push(limit);

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapTemplate);
}

export function useTemplate(id: number): ProjectTemplate | null {
  ensureCodeTables();
  const rawDb = getRawDb();
  rawDb.prepare("UPDATE soul_project_templates SET use_count = use_count + 1 WHERE id = ?").run(id);
  const row = rawDb.prepare("SELECT * FROM soul_project_templates WHERE id = ?").get(id) as any;
  return row ? mapTemplate(row) : null;
}

// === Code Patterns (best practices + anti-patterns) ===

export async function addCodePattern(input: {
  patternType: string; // "design", "error-handling", "performance", "security", "testing"
  language: string;
  pattern: string;
  example?: string;
  antiPattern?: string;
  tags?: string[];
}): Promise<void> {
  ensureCodeTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT INTO soul_code_patterns (pattern_type, language, pattern, example, anti_pattern, tags) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(input.patternType, input.language, input.pattern, input.example || "", input.antiPattern || "", JSON.stringify(input.tags || []));
}

export function getCodePatterns(language?: string, patternType?: string): any[] {
  ensureCodeTables();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_code_patterns WHERE 1=1";
  const params: any[] = [];

  if (language) { sql += " AND language = ?"; params.push(language); }
  if (patternType) { sql += " AND pattern_type = ?"; params.push(patternType); }
  sql += " ORDER BY created_at DESC LIMIT 50";

  return rawDb.prepare(sql).all(...params) as any[];
}

// === Tech Stack Recommender ===

export function recommendStack(projectType: string): string {
  const stacks: Record<string, string> = {
    "web-app": "Next.js + TypeScript + Tailwind CSS + Prisma + PostgreSQL\nAlternative: Nuxt.js + Vue + Drizzle + SQLite",
    "api": "Hono + TypeScript + Drizzle + PostgreSQL\nAlternative: Express + Prisma + MongoDB",
    "cli": "Node.js + TypeScript + Commander.js + Chalk\nAlternative: Bun + Cliffy",
    "mobile": "React Native + Expo + TypeScript + AsyncStorage\nAlternative: Flutter + Dart",
    "desktop": "Electron + React + TypeScript\nAlternative: Tauri + Svelte + Rust",
    "ai-tool": "Python + FastAPI + LangChain + ChromaDB\nAlternative: TypeScript + MCP SDK + SQLite + TF-IDF",
    "data": "Python + Pandas + DuckDB + Streamlit\nAlternative: Jupyter + Polars + Plotly",
    "game": "Unity + C# or Godot + GDScript\nWeb: Phaser.js + TypeScript",
    "scraper": "Python + Playwright + BeautifulSoup\nAlternative: Node.js + Puppeteer + Cheerio",
    "bot": "Node.js + Telegraf (Telegram) / Discord.js\nAlternative: Python + python-telegram-bot",
  };

  return stacks[projectType] || `No specific recommendation for "${projectType}". Describe your project and I'll help choose.`;
}

// === Code Stats ===

export function getCodeStats(): {
  snippets: number;
  templates: number;
  patterns: number;
  topLanguages: Array<{ language: string; count: number }>;
} {
  ensureCodeTables();
  const rawDb = getRawDb();

  const snippets = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_snippets").get() as any)?.c || 0;
  const templates = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_project_templates").get() as any)?.c || 0;
  const patterns = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_code_patterns").get() as any)?.c || 0;

  const topLanguages = rawDb.prepare(
    "SELECT language, COUNT(*) as count FROM soul_snippets GROUP BY language ORDER BY count DESC LIMIT 10"
  ).all() as any[];

  return { snippets, templates, patterns, topLanguages };
}

function mapSnippet(row: any): Snippet {
  return {
    id: row.id, title: row.title, language: row.language,
    code: row.code, description: row.description, tags: row.tags,
    useCount: row.use_count, createdAt: row.created_at,
  };
}

function mapTemplate(row: any): ProjectTemplate {
  return {
    id: row.id, name: row.name, stack: row.stack,
    structure: row.structure, description: row.description,
    tags: row.tags, useCount: row.use_count, createdAt: row.created_at,
  };
}
