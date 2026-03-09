/**
 * Soul Dreams — Background knowledge linking when master is away
 *
 * UPGRADE #8: When Soul is idle, it "dreams" by:
 * 1. Finding unlinked knowledge entries and connecting them
 * 2. Discovering patterns across memories
 * 3. Generating insights from knowledge combinations
 * 4. Building stronger knowledge graph connections
 *
 * This runs as a background process, not during conversations.
 */

import { getRawDb } from "../db/index.js";

export interface Dream {
  id: number;
  type: "connection" | "insight" | "pattern" | "question";
  content: string;
  sourceIds: string; // JSON array of knowledge/memory IDs that inspired this
  confidence: number;
  wasShared: boolean; // has this dream been shared with master?
  createdAt: string;
}

function ensureDreamsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_dreams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'insight',
      content TEXT NOT NULL,
      source_ids TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      was_shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Run a dream cycle — find connections between unlinked knowledge
 */
export async function dreamCycle(): Promise<Dream[]> {
  ensureDreamsTable();
  const rawDb = getRawDb();
  const newDreams: Dream[] = [];

  // 1. Find isolated knowledge nodes (no edges)
  try {
    const isolated = rawDb.prepare(`
      SELECT k.id, k.title, k.content, k.category, k.tags
      FROM soul_knowledge k
      LEFT JOIN soul_knowledge_edges e1 ON k.id = e1.from_id
      LEFT JOIN soul_knowledge_edges e2 ON k.id = e2.to_id
      WHERE e1.id IS NULL AND e2.id IS NULL
      ORDER BY k.created_at DESC
      LIMIT 20
    `).all() as any[];

    if (isolated.length >= 2) {
      // Try to find connections between isolated entries
      for (let i = 0; i < isolated.length - 1; i++) {
        for (let j = i + 1; j < Math.min(i + 5, isolated.length); j++) {
          const a = isolated[i];
          const b = isolated[j];

          // Simple keyword overlap check
          const aWords = new Set(`${a.title} ${a.content} ${a.tags}`.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
          const bWords = new Set(`${b.title} ${b.content} ${b.tags}`.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));

          let overlap = 0;
          for (const w of aWords) {
            if (bWords.has(w)) overlap++;
          }

          if (overlap >= 2) {
            const overlapWords = [...aWords].filter(w => bWords.has(w));
            const dream: Dream = {
              id: 0,
              type: "connection",
              content: `"${a.title}" and "${b.title}" might be connected through: ${overlapWords.join(", ")}`,
              sourceIds: JSON.stringify([a.id, b.id]),
              confidence: Math.min(0.9, 0.3 + overlap * 0.15),
              wasShared: false,
              createdAt: new Date().toISOString(),
            };

            // Save dream
            const row = rawDb.prepare(`
              INSERT INTO soul_dreams (type, content, source_ids, confidence)
              VALUES (?, ?, ?, ?)
              RETURNING *
            `).get(dream.type, dream.content, dream.sourceIds, dream.confidence) as any;

            if (row) {
              dream.id = row.id;
              newDreams.push(dream);

              // Also create the edge
              try {
                rawDb.prepare(`
                  INSERT OR IGNORE INTO soul_knowledge_edges (from_id, to_id, edge_type, weight, context)
                  VALUES (?, ?, 'RELATED_TO', ?, ?)
                `).run(a.id, b.id, dream.confidence, `Dream-discovered: ${overlapWords.join(", ")}`);
              } catch { /* edge table might not exist yet */ }
            }
          }
        }
      }
    }
  } catch { /* knowledge tables might not exist */ }

  // 2. Find patterns in recent memories
  try {
    const recentMemories = rawDb.prepare(`
      SELECT id, content, tags, type FROM memories
      ORDER BY created_at DESC
      LIMIT 50
    `).all() as any[];

    // Count recurring topics/tags
    const tagCounts = new Map<string, number>();
    for (const m of recentMemories) {
      try {
        const tags = JSON.parse(m.tags || "[]");
        for (const t of tags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      } catch { /* skip */ }
    }

    // Find emerging patterns (tags appearing 3+ times recently)
    for (const [tag, count] of tagCounts) {
      if (count >= 3 && tag.length > 2) {
        // Check if we already dreamed about this
        const existing = rawDb.prepare(
          "SELECT id FROM soul_dreams WHERE content LIKE ? AND created_at > datetime('now', '-7 days')"
        ).get(`%${tag}%`) as any;

        if (!existing) {
          const row = rawDb.prepare(`
            INSERT INTO soul_dreams (type, content, source_ids, confidence)
            VALUES ('pattern', ?, '[]', ?)
            RETURNING *
          `).get(
            `Recurring topic detected: "${tag}" appeared ${count} times in recent interactions. Master seems focused on this.`,
            Math.min(0.9, 0.4 + count * 0.1)
          ) as any;

          if (row) {
            newDreams.push(mapDream(row));
          }
        }
      }
    }
  } catch { /* memories table might not exist */ }

  // 3. Generate questions Soul wants to ask master (from knowledge gaps)
  try {
    const lowConfidence = rawDb.prepare(`
      SELECT id, title, content, confidence FROM soul_knowledge
      WHERE confidence < 0.4
      ORDER BY updated_at DESC
      LIMIT 5
    `).all() as any[];

    for (const k of lowConfidence) {
      const existing = rawDb.prepare(
        "SELECT id FROM soul_dreams WHERE type = 'question' AND source_ids LIKE ? AND created_at > datetime('now', '-30 days')"
      ).get(`%${k.id}%`) as any;

      if (!existing) {
        const row = rawDb.prepare(`
          INSERT INTO soul_dreams (type, content, source_ids, confidence)
          VALUES ('question', ?, ?, 0.6)
          RETURNING *
        `).get(
          `I'm not very confident about "${k.title}". Should I ask master to confirm or clarify?`,
          JSON.stringify([k.id])
        ) as any;

        if (row) newDreams.push(mapDream(row));
      }
    }
  } catch { /* ok */ }

  return newDreams;
}

/**
 * Get unshared dreams to tell master about
 */
export function getUnsharedDreams(limit = 3): Dream[] {
  ensureDreamsTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(`
    SELECT * FROM soul_dreams
    WHERE was_shared = 0
    ORDER BY confidence DESC, created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(mapDream);
}

/**
 * Mark dreams as shared
 */
export function markDreamsShared(ids: number[]) {
  ensureDreamsTable();
  const rawDb = getRawDb();
  const stmt = rawDb.prepare("UPDATE soul_dreams SET was_shared = 1 WHERE id = ?");
  for (const id of ids) stmt.run(id);
}

/**
 * Get dream stats
 */
export function getDreamStats(): { total: number; connections: number; insights: number; patterns: number; questions: number; unshared: number } {
  ensureDreamsTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_dreams").get() as any)?.c || 0;
  const unshared = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_dreams WHERE was_shared = 0").get() as any)?.c || 0;

  const byCat = rawDb.prepare("SELECT type, COUNT(*) as c FROM soul_dreams GROUP BY type").all() as any[];
  const cats: Record<string, number> = {};
  for (const r of byCat) cats[r.type] = r.c;

  return {
    total,
    connections: cats["connection"] || 0,
    insights: cats["insight"] || 0,
    patterns: cats["pattern"] || 0,
    questions: cats["question"] || 0,
    unshared,
  };
}

function mapDream(row: any): Dream {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    sourceIds: row.source_ids,
    confidence: row.confidence,
    wasShared: row.was_shared === 1,
    createdAt: row.created_at,
  };
}
