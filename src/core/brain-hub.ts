/**
 * Brain Hub — Dual-mode knowledge management
 *
 * Soul operates in two modes:
 * 1. PRIVATE (default) — All data stays local, nothing shared
 * 2. OPEN — Can create/import/export "Brain Packs" (portable knowledge packages)
 *
 * Brain Packs are curated knowledge bundles that can be:
 * - Created from Soul's own knowledge (selective export)
 * - Imported from files or URLs (with safety scanning)
 * - Shared between Soul instances
 * - Browsed in a local "Brain Store"
 *
 * Privacy rules:
 * - Private memories NEVER included in brain packs
 * - Master info NEVER included
 * - Passwords, keys, tokens auto-detected and stripped
 * - Each brain pack has a manifest with metadata
 * - Import always goes through safety scan
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { safePath, logSecurityEvent } from "./security.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

// ─── Types ───

export type SoulMode = "private" | "open";

export interface BrainPack {
  manifest: BrainPackManifest;
  knowledge: BrainKnowledgeItem[];
  patterns: BrainPatternItem[];
  snippets: BrainSnippetItem[];
  templates: BrainTemplateItem[];
}

export interface BrainPackManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  categories: string[];
  tags: string[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  soulVersion: string;
  license: string;
}

export interface BrainKnowledgeItem {
  title: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  tags: string[];
}

export interface BrainPatternItem {
  pattern: string;
  category: string;
  description: string;
  confidence: number;
}

export interface BrainSnippetItem {
  name: string;
  language: string;
  code: string;
  description: string;
  tags: string[];
}

export interface BrainTemplateItem {
  name: string;
  description: string;
  structure: string;
  techStack: string[];
}

export interface InstalledBrainPack {
  id: number;
  packId: string;
  name: string;
  description: string;
  author: string;
  version: string;
  itemCount: number;
  installedAt: string;
  isActive: boolean;
  source: string; // 'file', 'url', 'peer'
  sourcePath: string;
}

// ─── DB Setup ───

function ensureBrainHubTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_brain_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT 'unknown',
      version TEXT NOT NULL DEFAULT '1.0.0',
      categories TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      item_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'file',
      source_path TEXT NOT NULL DEFAULT '',
      checksum TEXT NOT NULL DEFAULT '',
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_brain_pack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_data TEXT NOT NULL,
      imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ─── Mode Management ───

export function getSoulMode(): SoulMode {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  try {
    const row = rawDb.prepare("SELECT value FROM soul_config WHERE key = 'mode'").get() as any;
    return (row?.value as SoulMode) || "private";
  } catch {
    return "private";
  }
}

export function setSoulMode(mode: SoulMode): void {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT INTO soul_config (key, value, updated_at) VALUES ('mode', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(mode, mode);
}

export function getConfig(key: string): string | null {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  try {
    const row = rawDb.prepare("SELECT value FROM soul_config WHERE key = ?").get(key) as any;
    return row?.value || null;
  } catch {
    return null;
  }
}

export function setConfig(key: string, value: string): void {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT INTO soul_config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(key, value, value);
}

// ─── Brain Pack Creation ───

/**
 * Create a Brain Pack from Soul's knowledge — selective export
 */
export async function createBrainPack(options: {
  name: string;
  description: string;
  author: string;
  categories?: string[];
  tags?: string[];
  includeKnowledge?: boolean;
  includePatterns?: boolean;
  includeSnippets?: boolean;
  includeTemplates?: boolean;
  knowledgeCategories?: string[];
  minConfidence?: number;
  license?: string;
}): Promise<{ pack: BrainPack; filePath: string }> {
  const rawDb = getRawDb();
  const minConf = options.minConfidence ?? 0.5;

  const knowledge: BrainKnowledgeItem[] = [];
  const patterns: BrainPatternItem[] = [];
  const snippets: BrainSnippetItem[] = [];
  const templates: BrainTemplateItem[] = [];

  // Collect knowledge
  if (options.includeKnowledge !== false) {
    try {
      let query = "SELECT * FROM soul_knowledge WHERE confidence >= ?";
      const params: any[] = [minConf];

      if (options.knowledgeCategories?.length) {
        const placeholders = options.knowledgeCategories.map(() => "?").join(",");
        query += ` AND category IN (${placeholders})`;
        params.push(...options.knowledgeCategories);
      }

      const rows = rawDb.prepare(query).all(...params) as any[];
      for (const row of rows) {
        if (containsPrivateData(row.content) || containsPrivateData(row.title)) continue;
        knowledge.push({
          title: row.title,
          category: row.category,
          content: row.content,
          source: sanitizeSource(row.source),
          confidence: row.confidence,
          tags: safeParseArray(row.tags),
        });
      }
    } catch { /* table might not exist yet */ }
  }

  // Collect patterns (learnings)
  if (options.includePatterns !== false) {
    try {
      const rows = rawDb.prepare(
        "SELECT * FROM learnings WHERE confidence >= ?"
      ).all(minConf) as any[];
      for (const row of rows) {
        if (containsPrivateData(row.pattern)) continue;
        patterns.push({
          pattern: row.pattern,
          category: categorizePattern(row.pattern),
          description: row.pattern,
          confidence: row.confidence,
        });
      }
    } catch { /* table might not exist yet */ }
  }

  // Collect code snippets
  if (options.includeSnippets !== false) {
    try {
      const rows = rawDb.prepare("SELECT * FROM soul_snippets").all() as any[];
      for (const row of rows) {
        if (containsPrivateData(row.code)) continue;
        snippets.push({
          name: row.name,
          language: row.language,
          code: row.code,
          description: row.description || "",
          tags: safeParseArray(row.tags),
        });
      }
    } catch { /* table might not exist yet */ }
  }

  // Collect templates
  if (options.includeTemplates !== false) {
    try {
      const rows = rawDb.prepare("SELECT * FROM soul_project_templates").all() as any[];
      for (const row of rows) {
        templates.push({
          name: row.name,
          description: row.description || "",
          structure: row.structure || "",
          techStack: safeParseArray(row.tech_stack),
        });
      }
    } catch { /* table might not exist yet */ }
  }

  const totalItems = knowledge.length + patterns.length + snippets.length + templates.length;
  const allCategories = options.categories || [...new Set(knowledge.map(k => k.category))];
  const allTags = options.tags || [...new Set(knowledge.flatMap(k => k.tags))].slice(0, 20);

  const packId = `bp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const pack: BrainPack = {
    manifest: {
      id: packId,
      name: options.name,
      description: options.description,
      version: "1.0.0",
      author: options.author,
      categories: allCategories,
      tags: allTags,
      itemCount: totalItems,
      createdAt: now,
      updatedAt: now,
      checksum: "", // will be computed
      soulVersion: "1.0.0",
      license: options.license || "MIT",
    },
    knowledge,
    patterns,
    snippets,
    templates,
  };

  // Compute checksum
  const packJson = JSON.stringify(pack);
  pack.manifest.checksum = createHash("sha256").update(packJson).digest("hex");

  // Save to file
  const brainsDir = path.join(os.homedir(), ".soul", "brain-packs");
  if (!fs.existsSync(brainsDir)) fs.mkdirSync(brainsDir, { recursive: true });
  const filePath = path.join(brainsDir, `${packId}.brain.json`);
  fs.writeFileSync(filePath, JSON.stringify(pack, null, 2));

  // Record in DB
  ensureBrainHubTables();
  rawDb.prepare(
    `INSERT INTO soul_brain_packs (pack_id, name, description, author, version, categories, tags, item_count, source, source_path, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`
  ).run(packId, options.name, options.description, options.author, "1.0.0",
    JSON.stringify(allCategories), JSON.stringify(allTags), totalItems, filePath, pack.manifest.checksum);

  await remember({
    content: `[BrainHub] Created brain pack "${options.name}" — ${knowledge.length} knowledge, ${patterns.length} patterns, ${snippets.length} snippets, ${templates.length} templates`,
    type: "knowledge",
    tags: ["brain-hub", "export", "brain-pack"],
    source: "brain-hub",
  });

  return { pack, filePath };
}

// ─── Brain Pack Import ───

/**
 * Import a Brain Pack from JSON string or file
 */
export async function importBrainPack(
  input: string | BrainPack,
  source: "file" | "url" | "peer" = "file",
  sourcePath: string = ""
): Promise<{
  packId: string;
  name: string;
  imported: { knowledge: number; patterns: number; snippets: number; templates: number };
  rejected: number;
  warnings: string[];
}> {
  ensureBrainHubTables();

  let pack: BrainPack;
  try {
    pack = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("Invalid brain pack format — could not parse JSON");
  }

  // Validate structure
  if (!pack.manifest || !pack.manifest.id || !pack.manifest.name) {
    throw new Error("Invalid brain pack — missing manifest");
  }

  const rawDb = getRawDb();
  const warnings: string[] = [];
  let rejected = 0;

  // Check if already installed
  const existing = rawDb.prepare(
    "SELECT id FROM soul_brain_packs WHERE pack_id = ?"
  ).get(pack.manifest.id) as any;
  if (existing) {
    throw new Error(`Brain pack "${pack.manifest.name}" is already installed`);
  }

  // Safety scan entire pack
  const packStr = JSON.stringify(pack);
  if (containsPrivateData(packStr)) {
    warnings.push("Brain pack contains potential private data — some items were filtered");
  }

  // Import knowledge
  let knowledgeCount = 0;
  for (const k of pack.knowledge || []) {
    if (containsPrivateData(k.content) || containsPrivateData(k.title)) {
      rejected++;
      continue;
    }
    try {
      rawDb.prepare(`
        INSERT OR IGNORE INTO soul_knowledge (title, category, content, source, confidence, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(k.title, k.category, k.content,
        `brain-pack:${pack.manifest.id}`, k.confidence, JSON.stringify(k.tags || []));
      knowledgeCount++;
    } catch { rejected++; }
  }

  // Import patterns as learnings
  let patternCount = 0;
  for (const p of pack.patterns || []) {
    if (containsPrivateData(p.pattern)) { rejected++; continue; }
    try {
      rawDb.prepare(`
        INSERT OR IGNORE INTO learnings (pattern, confidence, evidence_count, memory_ids, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(p.pattern, p.confidence,
        (p as any).evidence_count || (p as any).reinforcement_count || 1,
        (p as any).memory_ids || (p as any).related_memory_ids || '[]');
      patternCount++;
    } catch { rejected++; }
  }

  // Import snippets
  let snippetCount = 0;
  for (const s of pack.snippets || []) {
    if (containsPrivateData(s.code)) { rejected++; continue; }
    try {
      rawDb.prepare(`
        INSERT OR IGNORE INTO soul_snippets (name, language, code, description, tags, use_count, created_at)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
      `).run(s.name, s.language, s.code, s.description, JSON.stringify(s.tags || []));
      snippetCount++;
    } catch { rejected++; }
  }

  // Import templates
  let templateCount = 0;
  for (const t of pack.templates || []) {
    try {
      rawDb.prepare(`
        INSERT OR IGNORE INTO soul_project_templates (name, description, structure, tech_stack, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(t.name, t.description, t.structure, JSON.stringify(t.techStack || []));
      templateCount++;
    } catch { rejected++; }
  }

  const totalImported = knowledgeCount + patternCount + snippetCount + templateCount;

  // Record install
  rawDb.prepare(
    `INSERT INTO soul_brain_packs (pack_id, name, description, author, version, categories, tags, item_count, source, source_path, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pack.manifest.id, pack.manifest.name, pack.manifest.description,
    pack.manifest.author, pack.manifest.version,
    JSON.stringify(pack.manifest.categories), JSON.stringify(pack.manifest.tags),
    totalImported, source, sourcePath, pack.manifest.checksum);

  // Store pack items for potential rollback
  rawDb.prepare(
    "INSERT INTO soul_brain_pack_items (pack_id, item_type, item_data, imported) VALUES (?, 'manifest', ?, 1)"
  ).run(pack.manifest.id, JSON.stringify(pack.manifest));

  await remember({
    content: `[BrainHub] Imported brain pack "${pack.manifest.name}" by ${pack.manifest.author} — ${knowledgeCount} knowledge, ${patternCount} patterns, ${snippetCount} snippets, ${templateCount} templates (${rejected} rejected)`,
    type: "knowledge",
    tags: ["brain-hub", "import", "brain-pack"],
    source: "brain-hub",
  });

  return {
    packId: pack.manifest.id,
    name: pack.manifest.name,
    imported: { knowledge: knowledgeCount, patterns: patternCount, snippets: snippetCount, templates: templateCount },
    rejected,
    warnings,
  };
}

/**
 * Import brain pack from a file path
 */
export async function importBrainPackFromFile(filePath: string): Promise<ReturnType<typeof importBrainPack>> {
  // SECURITY: restrict reads to ~/.soul/ directory
  const soulDir = path.join(os.homedir(), ".soul");
  const safeFP = safePath(filePath, soulDir);
  logSecurityEvent("brain_pack_import", { path: safeFP });

  if (!fs.existsSync(safeFP)) {
    throw new Error(`File not found in Soul directory`);
  }
  const content = fs.readFileSync(safeFP, "utf-8");
  return importBrainPack(content, "file", safeFP);
}

// ─── Brain Pack Management ───

/**
 * List installed brain packs
 */
export function listBrainPacks(): InstalledBrainPack[] {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_brain_packs ORDER BY installed_at DESC"
  ).all() as any[];

  return rows.map(r => ({
    id: r.id,
    packId: r.pack_id,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    itemCount: r.item_count,
    installedAt: r.installed_at,
    isActive: r.is_active === 1,
    source: r.source,
    sourcePath: r.source_path,
  }));
}

/**
 * Toggle brain pack active/inactive
 */
export function toggleBrainPack(packId: string, active: boolean): boolean {
  ensureBrainHubTables();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_brain_packs SET is_active = ? WHERE pack_id = ?"
  ).run(active ? 1 : 0, packId);
  return result.changes > 0;
}

/**
 * Uninstall a brain pack (remove metadata, knowledge stays)
 */
export function uninstallBrainPack(packId: string): { removed: boolean; name: string } {
  ensureBrainHubTables();
  const rawDb = getRawDb();

  const pack = rawDb.prepare("SELECT name FROM soul_brain_packs WHERE pack_id = ?").get(packId) as any;
  if (!pack) return { removed: false, name: "" };

  rawDb.prepare("DELETE FROM soul_brain_pack_items WHERE pack_id = ?").run(packId);
  rawDb.prepare("DELETE FROM soul_brain_packs WHERE pack_id = ?").run(packId);

  return { removed: true, name: pack.name };
}

/**
 * Get available .brain.json files in the brain-packs directory
 */
export function getAvailableBrainFiles(): Array<{
  fileName: string;
  filePath: string;
  size: number;
  modified: string;
}> {
  const brainsDir = path.join(os.homedir(), ".soul", "brain-packs");
  if (!fs.existsSync(brainsDir)) return [];

  return fs.readdirSync(brainsDir)
    .filter(f => f.endsWith(".brain.json"))
    .map(f => {
      const fp = path.join(brainsDir, f);
      const stat = fs.statSync(fp);
      return {
        fileName: f,
        filePath: fp,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    });
}

// ─── Brain Hub Stats ───

export function getBrainHubStats(): {
  mode: SoulMode;
  installedPacks: number;
  activePacks: number;
  totalImportedItems: number;
  availableFiles: number;
  brainsDir: string;
} {
  ensureBrainHubTables();
  const rawDb = getRawDb();

  let installedPacks = 0, activePacks = 0, totalImportedItems = 0;
  try {
    const stats = rawDb.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active, SUM(item_count) as items FROM soul_brain_packs"
    ).get() as any;
    installedPacks = stats?.total || 0;
    activePacks = stats?.active || 0;
    totalImportedItems = stats?.items || 0;
  } catch { /* tables might not exist */ }

  return {
    mode: getSoulMode(),
    installedPacks,
    activePacks,
    totalImportedItems,
    availableFiles: getAvailableBrainFiles().length,
    brainsDir: path.join(os.homedir(), ".soul", "brain-packs"),
  };
}

// ─── Pre-built Brain Pack Generators ───

/**
 * Generate a starter brain pack for common topics
 */
export function generateStarterPack(topic: string): BrainPack {
  const starters: Record<string, () => BrainPack> = {
    "web-dev": generateWebDevPack,
    "python": generatePythonPack,
    "devops": generateDevOpsPack,
    "security": generateSecurityPack,
  };

  const generator = starters[topic];
  if (!generator) {
    throw new Error(`Unknown starter topic: ${topic}. Available: ${Object.keys(starters).join(", ")}`);
  }
  return generator();
}

function generateWebDevPack(): BrainPack {
  const id = `starter_webdev_${Date.now().toString(36)}`;
  return {
    manifest: {
      id, name: "Web Development Essentials", description: "Core web dev patterns, modern frameworks, best practices",
      version: "1.0.0", author: "Soul Starters", categories: ["programming", "web"],
      tags: ["html", "css", "javascript", "react", "typescript", "nextjs"],
      itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      checksum: "", soulVersion: "1.0.0", license: "MIT",
    },
    knowledge: [
      { title: "React Server Components", category: "technique", content: "RSC renders on server, reduces client JS bundle. Use 'use client' directive for interactive components. Default is server in Next.js App Router.", source: "web-dev-pack", confidence: 0.9, tags: ["react", "nextjs"] },
      { title: "CSS Container Queries", category: "technique", content: "container-type: inline-size on parent, then @container (min-width: 400px) for responsive components independent of viewport.", source: "web-dev-pack", confidence: 0.85, tags: ["css", "responsive"] },
      { title: "TypeScript Strict Mode", category: "pattern", content: "Always enable strict: true in tsconfig.json. Catches null errors, implicit any, and type mismatches at compile time.", source: "web-dev-pack", confidence: 0.95, tags: ["typescript"] },
      { title: "API Route Error Handling", category: "pattern", content: "Always return generic error messages to clients. Log detailed errors server-side. Never expose stack traces or internal paths.", source: "web-dev-pack", confidence: 0.95, tags: ["security", "api"] },
      { title: "Optimistic Updates", category: "technique", content: "Update UI immediately before server confirms. Revert on failure. Use React Query's onMutate for cache manipulation.", source: "web-dev-pack", confidence: 0.85, tags: ["react", "ux"] },
    ],
    patterns: [
      { pattern: "Use semantic HTML elements (nav, main, article, section) for accessibility and SEO", category: "web", description: "Semantic HTML", confidence: 0.9 },
      { pattern: "Lazy load images below the fold with loading='lazy' attribute", category: "performance", description: "Image lazy loading", confidence: 0.9 },
      { pattern: "Use CSS custom properties (variables) for theming instead of hardcoded colors", category: "css", description: "CSS theming", confidence: 0.85 },
    ],
    snippets: [
      { name: "useDebounce Hook", language: "typescript", code: "function useDebounce<T>(value: T, delay: number): T {\n  const [debounced, setDebounced] = useState(value);\n  useEffect(() => {\n    const timer = setTimeout(() => setDebounced(value), delay);\n    return () => clearTimeout(timer);\n  }, [value, delay]);\n  return debounced;\n}", description: "React hook for debouncing values", tags: ["react", "hooks"] },
      { name: "Fetch with Timeout", language: "typescript", code: "async function fetchWithTimeout(url: string, ms: number): Promise<Response> {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), ms);\n  try {\n    return await fetch(url, { signal: controller.signal });\n  } finally {\n    clearTimeout(timeout);\n  }\n}", description: "Fetch with AbortController timeout", tags: ["fetch", "async"] },
    ],
    templates: [],
  };
}

function generatePythonPack(): BrainPack {
  const id = `starter_python_${Date.now().toString(36)}`;
  return {
    manifest: {
      id, name: "Python Essentials", description: "Python best practices, patterns, and modern tooling",
      version: "1.0.0", author: "Soul Starters", categories: ["programming", "python"],
      tags: ["python", "fastapi", "pydantic", "async"],
      itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      checksum: "", soulVersion: "1.0.0", license: "MIT",
    },
    knowledge: [
      { title: "Python Type Hints", category: "technique", content: "Use type hints everywhere: def greet(name: str) -> str. Use from __future__ import annotations for forward refs. Use TypeVar for generics.", source: "python-pack", confidence: 0.9, tags: ["python", "typing"] },
      { title: "FastAPI Dependency Injection", category: "pattern", content: "Use Depends() for shared logic: auth, DB sessions, rate limiting. Dependencies are cached per-request. Use yield for cleanup.", source: "python-pack", confidence: 0.9, tags: ["fastapi"] },
      { title: "Pydantic V2 Models", category: "technique", content: "Use model_validate() instead of parse_obj(). Use model_dump() instead of dict(). ConfigDict replaces class Config. Field validators with @field_validator.", source: "python-pack", confidence: 0.85, tags: ["pydantic"] },
    ],
    patterns: [
      { pattern: "Use pathlib.Path instead of os.path for file operations — it's more readable and cross-platform", category: "python", description: "Modern file paths", confidence: 0.9 },
      { pattern: "Use dataclasses or Pydantic models instead of raw dicts for structured data", category: "python", description: "Structured data", confidence: 0.85 },
    ],
    snippets: [
      { name: "Async Context Manager", language: "python", code: "from contextlib import asynccontextmanager\n\n@asynccontextmanager\nasync def managed_resource():\n    resource = await acquire()\n    try:\n        yield resource\n    finally:\n        await release(resource)", description: "Async context manager pattern", tags: ["python", "async"] },
    ],
    templates: [],
  };
}

function generateDevOpsPack(): BrainPack {
  const id = `starter_devops_${Date.now().toString(36)}`;
  return {
    manifest: {
      id, name: "DevOps Essentials", description: "Docker, CI/CD, infrastructure patterns",
      version: "1.0.0", author: "Soul Starters", categories: ["devops", "infrastructure"],
      tags: ["docker", "cicd", "kubernetes", "monitoring"],
      itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      checksum: "", soulVersion: "1.0.0", license: "MIT",
    },
    knowledge: [
      { title: "Multi-stage Docker Builds", category: "technique", content: "Use multi-stage builds to reduce image size: build stage with dev dependencies, final stage copies only artifacts. Use distroless or alpine as final base.", source: "devops-pack", confidence: 0.9, tags: ["docker"] },
      { title: "Health Check Endpoints", category: "pattern", content: "Every service needs /health (liveness) and /ready (readiness). Health returns 200 if process alive. Ready checks dependencies (DB, cache, upstream).", source: "devops-pack", confidence: 0.9, tags: ["monitoring", "kubernetes"] },
      { title: "GitOps Workflow", category: "pattern", content: "Infrastructure as code in Git. Changes via PR → review → merge → auto-deploy. ArgoCD or Flux for Kubernetes. Terraform for cloud infra.", source: "devops-pack", confidence: 0.85, tags: ["gitops", "cicd"] },
    ],
    patterns: [
      { pattern: "Never store secrets in Docker images or Git — use environment variables or secret managers (Vault, AWS SSM)", category: "security", description: "Secret management", confidence: 0.95 },
      { pattern: "Always pin dependency versions in Dockerfiles and CI configs for reproducible builds", category: "devops", description: "Reproducible builds", confidence: 0.9 },
    ],
    snippets: [],
    templates: [],
  };
}

function generateSecurityPack(): BrainPack {
  const id = `starter_security_${Date.now().toString(36)}`;
  return {
    manifest: {
      id, name: "Security Essentials", description: "Application security patterns, OWASP, threat modeling",
      version: "1.0.0", author: "Soul Starters", categories: ["security"],
      tags: ["owasp", "authentication", "encryption", "input-validation"],
      itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      checksum: "", soulVersion: "1.0.0", license: "MIT",
    },
    knowledge: [
      { title: "OWASP Top 10 (2021)", category: "fact", content: "A01: Broken Access Control, A02: Cryptographic Failures, A03: Injection, A04: Insecure Design, A05: Security Misconfiguration, A06: Vulnerable Components, A07: Auth Failures, A08: Software Integrity, A09: Logging Failures, A10: SSRF", source: "security-pack", confidence: 0.95, tags: ["owasp"] },
      { title: "Parameterized Queries", category: "pattern", content: "NEVER concatenate user input into SQL. Use parameterized queries or ORM. This prevents SQL injection — the #1 most exploited vulnerability.", source: "security-pack", confidence: 0.99, tags: ["sql", "injection"] },
      { title: "Password Hashing", category: "technique", content: "Use bcrypt, scrypt, or argon2id for passwords. NEVER MD5/SHA for passwords. Use a cost factor of at least 10 for bcrypt. Always use unique salts (bcrypt does this automatically).", source: "security-pack", confidence: 0.95, tags: ["authentication", "hashing"] },
      { title: "JWT Best Practices", category: "pattern", content: "Short expiry (15min access, 7d refresh). Store refresh token httpOnly cookie. Validate iss, aud, exp claims. Use RS256 for distributed systems, HS256 for single service.", source: "security-pack", confidence: 0.9, tags: ["jwt", "authentication"] },
    ],
    patterns: [
      { pattern: "Validate and sanitize ALL user input at system boundaries — never trust client-side validation alone", category: "security", description: "Input validation", confidence: 0.95 },
      { pattern: "Use Content-Security-Policy headers to prevent XSS — restrict script sources, disable inline scripts", category: "security", description: "CSP headers", confidence: 0.9 },
    ],
    snippets: [],
    templates: [],
  };
}

// ─── Helpers ───

function containsPrivateData(text: string): boolean {
  const lower = (text || "").toLowerCase();
  const patterns = [
    "password", "passphrase", "secret", "token", "api_key", "apikey",
    "private_key", "credit card", "ssn", "social security",
    "master's name", "bearer ", "authorization:",
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.source, // email-like
  ];
  return patterns.some(p => typeof p === "string" ? lower.includes(p) : new RegExp(p, "i").test(text));
}

function sanitizeSource(source: string): string {
  // Remove any paths or URLs that might reveal private info
  if (!source) return "unknown";
  if (source.includes(":\\") || source.includes("/home/")) return "local";
  return source;
}

function safeParseArray(val: any): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

function categorizePattern(pattern: string): string {
  const lower = pattern.toLowerCase();
  if (lower.includes("code") || lower.includes("bug") || lower.includes("function")) return "programming";
  if (lower.includes("style") || lower.includes("naming")) return "style";
  if (lower.includes("error") || lower.includes("fix")) return "troubleshooting";
  if (lower.includes("learn") || lower.includes("teach")) return "education";
  return "general";
}
