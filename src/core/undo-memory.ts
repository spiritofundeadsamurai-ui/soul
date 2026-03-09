/**
 * Undo Memory — Mark memories as incorrect or outdated
 *
 * UPGRADE #14: Master can tell Soul "that's wrong" and Soul will:
 * 1. Mark the memory as incorrect
 * 2. Record WHY it was wrong (correction)
 * 3. Prevent it from being used in future responses
 * 4. Learn from the correction to avoid similar mistakes
 */

import { getRawDb } from "../db/index.js";

export interface MemoryCorrection {
  id: number;
  memoryId: number;
  originalContent: string;
  correction: string;
  reason: string;
  createdAt: string;
}

function ensureCorrectionTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_memory_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      original_content TEXT NOT NULL,
      correction TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'master correction',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Mark a memory as incorrect
 */
export function undoMemory(memoryId: number, correction: string, reason?: string): MemoryCorrection | null {
  ensureCorrectionTable();
  const rawDb = getRawDb();

  // Get original memory
  const memory = rawDb.prepare("SELECT content FROM memories WHERE id = ?").get(memoryId) as any;
  if (!memory) return null;

  // Record correction
  const row = rawDb.prepare(`
    INSERT INTO soul_memory_corrections (memory_id, original_content, correction, reason)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(memoryId, memory.content, correction, reason || "master correction") as any;

  // Mark original memory as superseded (add tag)
  try {
    const existing = rawDb.prepare("SELECT tags FROM memories WHERE id = ?").get(memoryId) as any;
    if (existing) {
      let tags: string[] = [];
      try { tags = JSON.parse(existing.tags || "[]"); } catch { /* ok */ }
      if (!tags.includes("corrected")) {
        tags.push("corrected", "undo");
        rawDb.prepare("UPDATE memories SET tags = ? WHERE id = ?").run(JSON.stringify(tags), memoryId);
      }
    }
  } catch { /* ok */ }

  // If correction provides new info, store it as a new memory
  if (correction && correction.length > 5) {
    try {
      rawDb.prepare(`
        INSERT INTO memories (content, type, tags, source, created_at)
        VALUES (?, 'learning', '["correction", "from-undo"]', 'undo-memory', datetime('now'))
      `).run(`CORRECTION: ${memory.content.substring(0, 100)} → ${correction}`);
    } catch { /* ok */ }
  }

  return row ? {
    id: row.id,
    memoryId: row.memory_id,
    originalContent: row.original_content,
    correction: row.correction,
    reason: row.reason,
    createdAt: row.created_at,
  } : null;
}

/**
 * Search for a memory to undo by content
 */
export function findMemoryToUndo(query: string): Array<{ id: number; content: string; type: string; createdAt: string }> {
  const rawDb = getRawDb();

  try {
    const rows = rawDb.prepare(`
      SELECT id, content, type, created_at FROM memories
      WHERE content LIKE ? AND tags NOT LIKE '%corrected%'
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%${query}%`) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      content: r.content,
      type: r.type,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Get list of corrected memories
 */
export function getCorrectionHistory(limit = 10): MemoryCorrection[] {
  ensureCorrectionTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(`
    SELECT * FROM soul_memory_corrections
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    memoryId: r.memory_id,
    originalContent: r.original_content,
    correction: r.correction,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/**
 * Check if a memory has been corrected (used during search to filter out bad data)
 */
export function isMemoryCorrected(memoryId: number): boolean {
  ensureCorrectionTable();
  const rawDb = getRawDb();

  try {
    const row = rawDb.prepare(
      "SELECT id FROM soul_memory_corrections WHERE memory_id = ?"
    ).get(memoryId) as any;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Get correction stats
 */
export function getCorrectionStats(): { total: number; recent: number } {
  ensureCorrectionTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_memory_corrections").get() as any)?.c || 0;
  const recent = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_memory_corrections WHERE created_at > datetime('now', '-7 days')"
  ).get() as any)?.c || 0;

  return { total, recent };
}
