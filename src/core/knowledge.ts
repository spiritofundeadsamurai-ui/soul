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

  const entry = mapKnowledge(row);

  // UPGRADE #7: Auto-link with existing knowledge
  try {
    await autoLinkKnowledge(entry.id);
  } catch { /* non-critical */ }

  return entry;
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

// ============================================================
// UPGRADE #7: Knowledge Graph — Node+Edge relationships
// ============================================================

export type EdgeType = "RELATED_TO" | "SUPPORTS" | "CONTRADICTS" | "PART_OF" | "USED_BY" | "LEADS_TO" | "DEPENDS_ON";

export interface KnowledgeEdge {
  id: number;
  fromId: number;
  toId: number;
  edgeType: EdgeType;
  weight: number;
  context: string;
  createdAt: string;
}

function ensureKnowledgeEdgesTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_knowledge_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'RELATED_TO',
      weight REAL NOT NULL DEFAULT 1.0,
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_id, to_id, edge_type)
    )
  `);
  rawDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_ke_from ON soul_knowledge_edges(from_id)
  `);
  rawDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_ke_to ON soul_knowledge_edges(to_id)
  `);
}

/**
 * Add an edge between two knowledge entries
 */
export function addKnowledgeEdge(
  fromId: number,
  toId: number,
  edgeType: EdgeType,
  context = "",
  weight = 1.0,
): KnowledgeEdge | null {
  ensureKnowledgeEdgesTable();
  const rawDb = getRawDb();

  try {
    const row = rawDb.prepare(
      `INSERT INTO soul_knowledge_edges (from_id, to_id, edge_type, weight, context)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_id, to_id, edge_type) DO UPDATE SET weight = weight + 0.1, context = ?
       RETURNING *`
    ).get(fromId, toId, edgeType, weight, context, context) as any;

    return row ? mapEdge(row) : null;
  } catch {
    return null;
  }
}

/**
 * Get all edges for a knowledge entry (both directions)
 */
export function getKnowledgeEdges(knowledgeId: number): KnowledgeEdge[] {
  ensureKnowledgeEdgesTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    `SELECT * FROM soul_knowledge_edges WHERE from_id = ? OR to_id = ? ORDER BY weight DESC`
  ).all(knowledgeId, knowledgeId) as any[];

  return rows.map(mapEdge);
}

/**
 * Traverse the knowledge graph — find connected knowledge up to N hops
 */
export function traverseKnowledgeGraph(
  startId: number,
  maxDepth = 2,
  edgeTypes?: EdgeType[],
): Array<{ knowledge: KnowledgeEntry; depth: number; via: EdgeType }> {
  ensureKnowledgeTable();
  ensureKnowledgeEdgesTable();
  const rawDb = getRawDb();

  const visited = new Set<number>([startId]);
  const results: Array<{ knowledge: KnowledgeEntry; depth: number; via: EdgeType }> = [];
  let frontier = [startId];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: number[] = [];

    for (const nodeId of frontier) {
      let query = `SELECT * FROM soul_knowledge_edges WHERE from_id = ? OR to_id = ?`;
      const params: any[] = [nodeId, nodeId];

      if (edgeTypes && edgeTypes.length > 0) {
        const placeholders = edgeTypes.map(() => "?").join(",");
        query += ` AND edge_type IN (${placeholders})`;
        params.push(...edgeTypes);
      }

      const edges = rawDb.prepare(query).all(...params) as any[];

      for (const edge of edges) {
        const neighborId = edge.from_id === nodeId ? edge.to_id : edge.from_id;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const kRow = rawDb.prepare("SELECT * FROM soul_knowledge WHERE id = ?").get(neighborId) as any;
        if (kRow) {
          results.push({
            knowledge: mapKnowledge(kRow),
            depth,
            via: edge.edge_type,
          });
          nextFrontier.push(neighborId);
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return results;
}

/**
 * Auto-link new knowledge with existing entries based on keyword overlap
 */
export async function autoLinkKnowledge(newEntryId: number): Promise<number> {
  ensureKnowledgeTable();
  ensureKnowledgeEdgesTable();
  const rawDb = getRawDb();

  const newEntry = rawDb.prepare("SELECT * FROM soul_knowledge WHERE id = ?").get(newEntryId) as any;
  if (!newEntry) return 0;

  // Find potentially related entries by searching keywords
  const titleWords = newEntry.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
  const contentWords = newEntry.content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4).slice(0, 10);
  const searchTerms = [...new Set([...titleWords, ...contentWords])];

  let linked = 0;
  const seen = new Set<number>([newEntryId]);

  for (const term of searchTerms.slice(0, 5)) {
    const matches = rawDb.prepare(
      `SELECT * FROM soul_knowledge WHERE id != ? AND (title LIKE ? OR content LIKE ?) LIMIT 3`
    ).all(newEntryId, `%${term}%`, `%${term}%`) as any[];

    for (const match of matches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);

      // Determine edge type
      let edgeType: EdgeType = "RELATED_TO";
      if (match.category === newEntry.category) edgeType = "RELATED_TO";
      if (newEntry.content.toLowerCase().includes(match.title.toLowerCase())) edgeType = "DEPENDS_ON";

      addKnowledgeEdge(newEntryId, match.id, edgeType, `auto-linked via keyword: ${term}`);
      linked++;

      if (linked >= 5) return linked; // limit auto-links
    }
  }

  return linked;
}

/**
 * Get knowledge graph stats
 */
export function getKnowledgeGraphStats(): { nodes: number; edges: number; avgConnections: number; isolatedNodes: number } {
  ensureKnowledgeTable();
  ensureKnowledgeEdgesTable();
  const rawDb = getRawDb();

  const nodes = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_knowledge").get() as any)?.c || 0;
  const edges = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_knowledge_edges").get() as any)?.c || 0;

  const connectedNodes = (rawDb.prepare(
    "SELECT COUNT(DISTINCT id) as c FROM (SELECT from_id as id FROM soul_knowledge_edges UNION SELECT to_id as id FROM soul_knowledge_edges)"
  ).get() as any)?.c || 0;

  return {
    nodes,
    edges,
    avgConnections: nodes > 0 ? Math.round((edges * 2 / nodes) * 10) / 10 : 0,
    isolatedNodes: nodes - connectedNodes,
  };
}

function mapEdge(row: any): KnowledgeEdge {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    edgeType: row.edge_type,
    weight: row.weight,
    context: row.context,
    createdAt: row.created_at,
  };
}
