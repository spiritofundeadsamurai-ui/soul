import { getDb } from "../db/index.js";
import { learnings } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

export interface Learning {
  id: number;
  pattern: string;
  insight: string;
  confidence: number;
  evidenceCount: number;
  memoryIds: number[];
  firstSeen: string;
  lastSeen: string;
}

export async function addLearning(
  pattern: string,
  insight: string,
  memoryIds: number[] = []
): Promise<Learning> {
  const db = getDb();

  const result = db
    .insert(learnings)
    .values({
      pattern,
      insight,
      memoryIds: JSON.stringify(memoryIds),
    })
    .returning()
    .get();

  return mapRow(result);
}

export async function getLearnings(limit: number = 20): Promise<Learning[]> {
  const db = getDb();

  const results = db
    .select()
    .from(learnings)
    .orderBy(desc(learnings.confidence))
    .limit(limit)
    .all();

  return results.map(mapRow);
}

export async function reinforceLearning(id: number): Promise<Learning | null> {
  const db = getDb();

  const existing = db.select().from(learnings).where(eq(learnings.id, id)).get();
  if (!existing) return null;

  const newConfidence = Math.min(1.0, existing.confidence + 0.1);
  const newCount = existing.evidenceCount + 1;

  db.update(learnings)
    .set({
      confidence: newConfidence,
      evidenceCount: newCount,
      lastSeen: sql`datetime('now')`,
    })
    .where(eq(learnings.id, id))
    .run();

  const updated = db.select().from(learnings).where(eq(learnings.id, id)).get();
  return updated ? mapRow(updated) : null;
}

export async function findSimilarLearning(
  pattern: string
): Promise<Learning | null> {
  const db = getDb();

  // Simple substring match — can be improved with FTS later
  const results = db
    .select()
    .from(learnings)
    .where(sql`pattern LIKE ${"%" + pattern + "%"}`)
    .limit(1)
    .all();

  return results.length > 0 ? mapRow(results[0]) : null;
}

function mapRow(row: any): Learning {
  return {
    id: row.id,
    pattern: row.pattern,
    insight: row.insight,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount ?? row.evidence_count,
    memoryIds: JSON.parse(row.memoryIds ?? row.memory_ids ?? "[]"),
    firstSeen: row.firstSeen ?? row.first_seen,
    lastSeen: row.lastSeen ?? row.last_seen,
  };
}
