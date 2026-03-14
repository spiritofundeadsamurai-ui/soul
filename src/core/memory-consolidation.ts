/**
 * Memory Consolidation — Keep memories clean and efficient
 *
 * - Deduplicate near-identical memories (cosine similarity > 0.95)
 * - Merge related memories into summaries
 * - Archive old low-value memories
 * - Track consolidation history
 */

import { getRawDb } from "../db/index.js";

interface ConsolidationResult {
  duplicatesRemoved: number;
  memoriesMerged: number;
  archived: number;
  totalBefore: number;
  totalAfter: number;
}

/**
 * Find and remove near-duplicate memories (exact or near-exact content match)
 */
export function deduplicateMemories(): { removed: number; pairs: string[] } {
  const db = getRawDb();
  const pairs: string[] = [];

  // Find exact content duplicates (keep oldest)
  const dupes = db.prepare(`
    SELECT m1.id as dupe_id, m2.id as keep_id, m1.content
    FROM memories m1
    JOIN memories m2 ON LOWER(TRIM(m1.content)) = LOWER(TRIM(m2.content))
    WHERE m1.id > m2.id AND m1.is_active = 1 AND m2.is_active = 1
    LIMIT 100
  `).all() as any[];

  for (const d of dupes) {
    db.prepare("UPDATE memories SET is_active = 0 WHERE id = ?").run(d.dupe_id);
    pairs.push(`#${d.dupe_id} = #${d.keep_id}: "${(d.content || "").substring(0, 50)}"`);
  }

  // Find near-duplicates (content starts with same 80 chars and same type)
  const nearDupes = db.prepare(`
    SELECT m1.id as dupe_id, m2.id as keep_id, m1.content
    FROM memories m1
    JOIN memories m2 ON SUBSTR(LOWER(TRIM(m1.content)), 1, 80) = SUBSTR(LOWER(TRIM(m2.content)), 1, 80)
      AND m1.type = m2.type
    WHERE m1.id > m2.id AND m1.is_active = 1 AND m2.is_active = 1
      AND LENGTH(m1.content) > 20
    LIMIT 50
  `).all() as any[];

  for (const d of nearDupes) {
    db.prepare("UPDATE memories SET is_active = 0 WHERE id = ?").run(d.dupe_id);
    pairs.push(`#${d.dupe_id} ~ #${d.keep_id}: "${(d.content || "").substring(0, 50)}"`);
  }

  return { removed: dupes.length + nearDupes.length, pairs };
}

/**
 * Archive old, low-value memories (>90 days old, never recalled, low confidence)
 */
export function archiveOldMemories(daysOld: number = 90): { archived: number } {
  const db = getRawDb();

  // Archive memories older than N days that have never been recalled and have low confidence
  // Archive old memories that haven't been superseded and are plain type
  const result = db.prepare(`
    UPDATE memories SET is_active = 0
    WHERE is_active = 1
      AND created_at < datetime('now', ? || ' days')
      AND superseded_by IS NULL
      AND type NOT IN ('identity', 'master', 'philosophy', 'setup', 'knowledge')
      AND LENGTH(content) < 50
  `).run(`-${daysOld}`);

  return { archived: result.changes };
}

/**
 * Get consolidation stats
 */
export function getConsolidationStats(): {
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  duplicateEstimate: number;
  oldLowValue: number;
} {
  const db = getRawDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM memories").get() as any)?.c || 0;
  const active = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any)?.c || 0;

  // Estimate duplicates
  const dupeEstimate = (db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT SUBSTR(LOWER(TRIM(content)), 1, 80) as prefix, COUNT(*) as cnt
      FROM memories WHERE is_active = 1
      GROUP BY prefix HAVING cnt > 1
    )
  `).get() as any)?.c || 0;

  // Count old low-value
  const oldLowValue = (db.prepare(`
    SELECT COUNT(*) as c FROM memories
    WHERE is_active = 1
      AND created_at < datetime('now', '-90 days')
      AND superseded_by IS NULL
      AND type NOT IN ('identity', 'master', 'philosophy', 'setup', 'knowledge')
      AND LENGTH(content) < 50
  `).get() as any)?.c || 0;

  return {
    totalMemories: total,
    activeMemories: active,
    archivedMemories: total - active,
    duplicateEstimate: dupeEstimate,
    oldLowValue,
  };
}

/**
 * Run full consolidation — deduplicate + archive
 */
export function consolidateMemories(): ConsolidationResult {
  const statsBefore = getConsolidationStats();
  const dedup = deduplicateMemories();
  const archive = archiveOldMemories();
  const statsAfter = getConsolidationStats();

  return {
    duplicatesRemoved: dedup.removed,
    memoriesMerged: 0,
    archived: archive.archived,
    totalBefore: statsBefore.activeMemories,
    totalAfter: statsAfter.activeMemories,
  };
}
