import { getDb, getRawDb } from "../db/index.js";
import { memories } from "../db/schema.js";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { TfIdfIndex } from "./tfidf.js";
import { embedText, storeEmbedding, hybridVectorSearch, getEmbeddingProvider, type HybridResult } from "./embeddings.js";

// Semantic search index — rebuilt on first search, invalidated periodically
let _tfidfIndex: TfIdfIndex | null = null;
let _tfidfBuilt = false;
let _tfidfLastBuilt = 0;
const TFIDF_REBUILD_INTERVAL_MS = 5 * 60 * 1000; // Rebuild every 5 minutes to pick up new memories

export type MemoryType = "conversation" | "knowledge" | "learning" | "wisdom";

export interface MemoryEntry {
  id: number;
  type: MemoryType;
  content: string;
  tags: string[];
  source: string | null;
  context: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RememberInput {
  content: string;
  type: MemoryType;
  tags?: string[];
  source?: string;
  context?: string;
}

/**
 * Check if content is junk (Claude Code session logs, agent commands, etc.)
 * Used by ALL memory storage paths to prevent junk from entering the database.
 */
export function isJunkContent(content: string): boolean {
  const junkPatterns = [
    /session_id.*transcript_path/,
    /permission_mode/,
    /acceptEdits/,
    /Agent used (Bash|Edit|Read|Write|Grep|Glob|Agent)/,
    /\{"command":/,
    /\{"file_path":/,
    /\{"pattern":/,
    /claude.*projects.*jsonl/i,
    /\\\\\.claude\\\\/,
    /\.claude\/projects\//,
  ];
  return junkPatterns.some(p => p.test(content));
}

export async function remember(input: RememberInput): Promise<MemoryEntry> {
  if (isJunkContent(input.content)) {
    return { id: -1, type: input.type, content: input.content, tags: "[]", source: input.source || null, context: null, supersededBy: null, isActive: true, createdAt: new Date().toISOString() } as any;
  }

  const db = getDb();

  const result = db
    .insert(memories)
    .values({
      type: input.type,
      content: input.content,
      tags: JSON.stringify(input.tags || []),
      source: input.source || null,
      context: input.context || null,
    })
    .returning()
    .get();

  // Add to TF-IDF index for semantic search
  if (_tfidfIndex) {
    _tfidfIndex.add(result.id, `${input.content} ${(input.tags || []).join(" ")}`);
  }

  // Embed at write time (async, non-blocking)
  if (getEmbeddingProvider()) {
    embedText(`${input.content} ${(input.tags || []).join(" ")}`).then(vec => {
      if (vec) storeEmbedding(result.id, vec);
    }).catch(() => {});
  }

  return mapRow(result);
}

export async function search(
  query: string,
  limit: number = 10
): Promise<MemoryEntry[]> {
  const rawDb = getRawDb();

  // FTS5 search with ranking
  const rows = rawDb
    .prepare(
      `
    SELECT m.*, rank
    FROM memories_fts fts
    JOIN memories m ON m.id = fts.rowid
    WHERE memories_fts MATCH ?
    AND m.is_active = 1
    ORDER BY rank
    LIMIT ?
  `
    )
    .all(query, limit) as any[];

  return rows.map(mapRow);
}

/**
 * Hybrid search: Vector embeddings (70%) + FTS5 (30%) when available,
 * falls back to FTS5 (60%) + TF-IDF (40%) when no embedding provider.
 * This is what makes Soul smarter than simple keyword search.
 */
export async function hybridSearch(
  query: string,
  limit: number = 10
): Promise<MemoryEntry[]> {
  // ── Vector path: use dense embeddings when available ──
  if (getEmbeddingProvider()) {
    try {
      const vectorResults = await hybridVectorSearch(query, limit);
      if (vectorResults.length > 0) {
        // Fetch full memory entries for the results
        const rawDb = getRawDb();
        const ids = vectorResults.map(r => r.memoryId);
        const placeholders = ids.map(() => "?").join(",");
        const rows = rawDb
          .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND is_active = 1`)
          .all(...ids) as any[];
        const rowMap = new Map(rows.map(r => [r.id, r]));
        // Return in score order
        return vectorResults
          .filter(vr => rowMap.has(vr.memoryId))
          .map(vr => mapRow(rowMap.get(vr.memoryId)));
      }
    } catch (e: any) {
      console.error(`[Memory] Vector search failed, falling back to TF-IDF: ${e.message}`);
    }
  }

  // ── Fallback path: FTS5 + TF-IDF (original approach) ──
  const now = Date.now();
  if (!_tfidfBuilt || now - _tfidfLastBuilt > TFIDF_REBUILD_INTERVAL_MS) {
    _tfidfIndex = new TfIdfIndex();
    const rawDb = getRawDb();
    const allDocs = rawDb
      .prepare(`SELECT id, content, tags FROM memories WHERE is_active = 1`)
      .all() as any[];
    for (const doc of allDocs) {
      _tfidfIndex.add(doc.id, `${doc.content} ${doc.tags || ""}`);
    }
    _tfidfBuilt = true;
    _tfidfLastBuilt = now;
  }

  // Step 1: FTS5 keyword search (fast, broad)
  let ftsResults: MemoryEntry[] = [];
  try {
    ftsResults = await search(query, limit * 2);
  } catch {
    // FTS5 might fail on special characters — fallback to semantic only
  }

  // Step 2: TF-IDF semantic search
  const semanticResults = _tfidfIndex!.search(query, limit * 2);
  const semanticIds = new Set(semanticResults.map((r) => r.id));
  const semanticScores = new Map(semanticResults.map((r) => [r.id, r.score]));

  // Step 3: Merge — union of both sets, scored by combined rank
  const allIds = new Set<number>();
  const combined: Array<{ entry: MemoryEntry; score: number }> = [];

  // Add FTS results with position-based score
  for (let i = 0; i < ftsResults.length; i++) {
    const ftsScore = 1 - i / ftsResults.length; // 1.0 → 0.0
    const semScore = semanticScores.get(ftsResults[i].id) || 0;
    const finalScore = ftsScore * 0.6 + semScore * 0.4; // weight FTS higher
    combined.push({ entry: ftsResults[i], score: finalScore });
    allIds.add(ftsResults[i].id);
  }

  // Add semantic-only results (not in FTS) — batch fetch to avoid N+1 queries
  const semanticOnlyIds = semanticResults
    .filter(sem => !allIds.has(sem.id as number))
    .map(sem => sem.id as number);

  if (semanticOnlyIds.length > 0) {
    const rawDb = getRawDb();
    const placeholders = semanticOnlyIds.map(() => "?").join(",");
    const rows = rawDb
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND is_active = 1`)
      .all(...semanticOnlyIds) as any[];
    for (const row of rows) {
      const entry = mapRow(row);
      const semScore = semanticScores.get(entry.id) || 0;
      combined.push({ entry, score: semScore * 0.4 });
    }
  }

  // Sort by combined score
  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, limit).map((c) => c.entry);
}

export interface ScoredMemoryEntry extends MemoryEntry {
  score: number;
}

export async function hybridSearchWithScores(
  query: string,
  limit: number = 10
): Promise<ScoredMemoryEntry[]> {
  // ── Vector path: use dense embeddings when available ──
  if (getEmbeddingProvider()) {
    try {
      const vectorResults = await hybridVectorSearch(query, limit);
      if (vectorResults.length > 0) {
        const rawDb = getRawDb();
        const ids = vectorResults.map(r => r.memoryId);
        const placeholders = ids.map(() => "?").join(",");
        const rows = rawDb
          .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND is_active = 1`)
          .all(...ids) as any[];
        const rowMap = new Map(rows.map(r => [r.id, r]));
        return vectorResults
          .filter(vr => rowMap.has(vr.memoryId))
          .map(vr => ({ ...mapRow(rowMap.get(vr.memoryId)), score: vr.score }));
      }
    } catch (e: any) {
      console.error(`[Memory] Vector search with scores failed, falling back: ${e.message}`);
    }
  }

  // ── Fallback path: FTS5 + TF-IDF ──
  const now2 = Date.now();
  if (!_tfidfBuilt || now2 - _tfidfLastBuilt > TFIDF_REBUILD_INTERVAL_MS) {
    _tfidfIndex = new TfIdfIndex();
    const rawDb = getRawDb();
    const allDocs = rawDb
      .prepare(`SELECT id, content, tags FROM memories WHERE is_active = 1`)
      .all() as any[];
    for (const doc of allDocs) {
      _tfidfIndex.add(doc.id, `${doc.content} ${doc.tags || ""}`);
    }
    _tfidfBuilt = true;
    _tfidfLastBuilt = now2;
  }

  let ftsResults: MemoryEntry[] = [];
  try {
    ftsResults = await search(query, limit * 2);
  } catch {}

  const semanticResults = _tfidfIndex!.search(query, limit * 2);
  const semanticScores = new Map(semanticResults.map((r) => [r.id, r.score]));

  const allIds = new Set<number>();
  const combined: Array<ScoredMemoryEntry> = [];

  for (let i = 0; i < ftsResults.length; i++) {
    const ftsScore = 1 - i / ftsResults.length;
    const semScore = semanticScores.get(ftsResults[i].id) || 0;
    const finalScore = ftsScore * 0.6 + semScore * 0.4;
    combined.push({ ...ftsResults[i], score: finalScore });
    allIds.add(ftsResults[i].id);
  }

  const semanticOnlyIds = semanticResults
    .filter(sem => !allIds.has(sem.id as number))
    .map(sem => sem.id as number);

  if (semanticOnlyIds.length > 0) {
    const rawDb2 = getRawDb();
    const placeholders = semanticOnlyIds.map(() => "?").join(",");
    const rows = rawDb2
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND is_active = 1`)
      .all(...semanticOnlyIds) as any[];
    for (const row of rows) {
      const entry = mapRow(row);
      const semScore = semanticScores.get(entry.id) || 0;
      combined.push({ ...entry, score: semScore * 0.4 });
    }
  }

  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, limit);
}

export async function recall(id: number): Promise<MemoryEntry | null> {
  const db = getDb();
  const result = db.select().from(memories).where(eq(memories.id, id)).get();
  return result ? mapRow(result) : null;
}

export async function list(
  type?: MemoryType,
  limit: number = 20,
  offset: number = 0
): Promise<MemoryEntry[]> {
  const db = getDb();

  const conditions = [eq(memories.isActive, true)];
  if (type) conditions.push(eq(memories.type, type));

  const results = db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return results.map(mapRow);
}

export async function supersede(
  id: number,
  reason: string
): Promise<MemoryEntry | null> {
  const db = getDb();

  // Create a new memory explaining the superseding
  const original = await recall(id);
  if (!original) return null;

  const newMemory = await remember({
    content: `[Superseded memory #${id}] ${reason}\n\nOriginal: ${original.content}`,
    type: original.type,
    tags: [...original.tags, "superseded"],
    source: `supersede:${id}`,
  });

  // Mark original as superseded (not deleted!)
  db.update(memories)
    .set({
      supersededBy: newMemory.id,
      isActive: false,
    })
    .where(eq(memories.id, id))
    .run();

  return newMemory;
}

export async function getRandomWisdom(): Promise<MemoryEntry | null> {
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `
    SELECT * FROM memories
    WHERE is_active = 1
    AND type IN ('wisdom', 'learning', 'knowledge')
    ORDER BY RANDOM()
    LIMIT 1
  `
    )
    .get() as any;

  return row ? mapRow(row) : null;
}

export async function getRecentMemories(
  limit: number = 10
): Promise<MemoryEntry[]> {
  const db = getDb();

  const results = db
    .select()
    .from(memories)
    .where(eq(memories.isActive, true))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
    .all();

  return results.map(mapRow);
}

export async function getMemoryStats(): Promise<{
  total: number;
  conversations: number;
  knowledge: number;
  learnings: number;
  wisdom: number;
}> {
  const rawDb = getRawDb();

  const total = rawDb
    .prepare(`SELECT COUNT(*) as c FROM memories WHERE is_active = 1`)
    .get() as any;

  const byType = rawDb
    .prepare(
      `SELECT type, COUNT(*) as c FROM memories WHERE is_active = 1 GROUP BY type`
    )
    .all() as any[];

  const typeMap: Record<string, number> = {};
  for (const row of byType) {
    typeMap[row.type] = row.c;
  }

  return {
    total: total?.c || 0,
    conversations: typeMap["conversation"] || 0,
    knowledge: typeMap["knowledge"] || 0,
    learnings: typeMap["learning"] || 0,
    wisdom: typeMap["wisdom"] || 0,
  };
}

// Map DB row to MemoryEntry
function mapRow(row: any): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    tags: JSON.parse(row.tags || "[]"),
    source: row.source,
    context: row.context,
    isActive: row.is_active === 1 || row.is_active === true || row.isActive === true,
    createdAt: row.created_at || row.createdAt,
  };
}
