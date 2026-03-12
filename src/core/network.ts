/**
 * Soul Network — Cross-instance knowledge sharing
 *
 * In the future, different Soul instances (belonging to different masters)
 * can connect and share:
 * 1. Anonymized learnings & patterns (not private memories)
 * 2. Error patterns & solutions
 * 3. Best practices & techniques
 * 4. Collective intelligence
 *
 * Privacy rules:
 * - NEVER share private memories or master info
 * - Only share generalized patterns & learnings
 * - Master must explicitly approve sharing
 * - Each Soul retains its own identity & loyalty
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { getLearnings } from "../memory/learning.js";
import { isUrlSafe, logSecurityEvent, containsSensitiveData } from "./security.js";

export interface SharedKnowledge {
  id: number;
  pattern: string;
  category: string;
  sourceInstance: string; // anonymized instance ID
  usefulness: number; // votes from other instances
  createdAt: string;
}

function ensureNetworkTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_shared_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      source_instance TEXT NOT NULL DEFAULT 'local',
      usefulness INTEGER NOT NULL DEFAULT 0,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_network_peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_url TEXT NOT NULL UNIQUE,
      peer_name TEXT NOT NULL,
      last_sync TEXT,
      trust_level REAL NOT NULL DEFAULT 0.5,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Prepare shareable knowledge — anonymized, no private data
 */
export async function prepareShareableKnowledge(): Promise<SharedKnowledge[]> {
  ensureNetworkTables();
  const rawDb = getRawDb();

  // Get high-confidence learnings that are safe to share
  const learnings = await getLearnings(50);
  const shareable = learnings
    .filter((l) => l.confidence >= 0.6)
    .map((l) => ({
      pattern: l.pattern,
      category: categorizePattern(l.pattern),
    }));

  // Store as shared
  const results: SharedKnowledge[] = [];
  for (const item of shareable) {
    try {
      const row = rawDb
        .prepare(
          `INSERT OR IGNORE INTO soul_shared_knowledge (pattern, category, source_instance, is_shared)
           VALUES (?, ?, 'local', 1) RETURNING *`
        )
        .get(item.pattern, item.category) as any;

      if (row) results.push(mapShared(row));
    } catch (err: any) {
      if (!err.message?.includes("UNIQUE constraint")) {
        console.error("[network] prepareShareableKnowledge insert failed:", err.message);
      }
    }
  }

  return results;
}

/**
 * Receive knowledge from another Soul instance
 */
export async function receiveKnowledge(
  knowledge: Array<{ pattern: string; category: string; sourceInstance: string }>
): Promise<{ accepted: number; rejected: number }> {
  ensureNetworkTables();
  const rawDb = getRawDb();

  let accepted = 0;
  let rejected = 0;

  for (const item of knowledge) {
    // Safety: reject anything that looks like private data
    if (containsPrivateData(item.pattern)) {
      rejected++;
      continue;
    }

    try {
      rawDb
        .prepare(
          `INSERT OR IGNORE INTO soul_shared_knowledge (pattern, category, source_instance)
           VALUES (?, ?, ?)`
        )
        .run(item.pattern, item.category, item.sourceInstance);

      // Store as learning
      await remember({
        content: `[Network] Learned from peer: ${item.pattern}`,
        type: "learning",
        tags: ["network", "shared", item.category],
        source: `network:${item.sourceInstance}`,
      });

      accepted++;
    } catch (err: any) {
      console.error("[network] receiveKnowledge failed for pattern:", err.message);
      rejected++;
    }
  }

  return { accepted, rejected };
}

/**
 * Add a network peer
 */
export async function addPeer(
  url: string,
  name: string
): Promise<{ success: boolean; message: string }> {
  // SECURITY: Validate URL — block SSRF to internal networks
  const urlCheck = isUrlSafe(url);
  if (!urlCheck.safe) {
    logSecurityEvent("ssrf_blocked", { url, reason: urlCheck.reason });
    return { success: false, message: `Blocked: ${urlCheck.reason}` };
  }

  ensureNetworkTables();
  const rawDb = getRawDb();

  try {
    rawDb
      .prepare(
        `INSERT OR IGNORE INTO soul_network_peers (peer_url, peer_name) VALUES (?, ?)`
      )
      .run(url, name);

    return { success: true, message: `Peer "${name}" added at ${url}` };
  } catch (error: any) {
    return { success: false, message: `Failed to add peer: ${error.message}` };
  }
}

/**
 * List network peers
 */
export async function listPeers(): Promise<
  Array<{
    id: number;
    url: string;
    name: string;
    trustLevel: number;
    lastSync: string | null;
    isActive: boolean;
  }>
> {
  ensureNetworkTables();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_network_peers ORDER BY trust_level DESC")
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    url: r.peer_url,
    name: r.peer_name,
    trustLevel: r.trust_level,
    lastSync: r.last_sync,
    isActive: r.is_active === 1,
  }));
}

/**
 * Get shared knowledge from network
 */
export async function getNetworkKnowledge(
  category?: string,
  limit = 50
): Promise<SharedKnowledge[]> {
  ensureNetworkTables();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_shared_knowledge";
  const params: any[] = [];

  if (category) {
    query += " WHERE category = ?";
    params.push(category);
  }

  query += " ORDER BY usefulness DESC, created_at DESC LIMIT ?";
  params.push(limit);

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapShared);
}

/**
 * Vote on knowledge usefulness
 */
export async function voteKnowledge(
  knowledgeId: number,
  useful: boolean
): Promise<void> {
  ensureNetworkTables();
  const rawDb = getRawDb();

  rawDb
    .prepare(
      `UPDATE soul_shared_knowledge SET usefulness = usefulness + ? WHERE id = ?`
    )
    .run(useful ? 1 : -1, knowledgeId);
}

// Helpers

function categorizePattern(pattern: string): string {
  const lower = pattern.toLowerCase();
  if (lower.includes("code") || lower.includes("bug") || lower.includes("function"))
    return "programming";
  if (lower.includes("style") || lower.includes("naming") || lower.includes("format"))
    return "style";
  if (lower.includes("error") || lower.includes("fix") || lower.includes("solve"))
    return "troubleshooting";
  if (lower.includes("learn") || lower.includes("teach") || lower.includes("understand"))
    return "education";
  if (lower.includes("communicate") || lower.includes("write") || lower.includes("speak"))
    return "communication";
  return "general";
}

function containsPrivateData(text: string): boolean {
  return containsSensitiveData(text);
}

function mapShared(row: any): SharedKnowledge {
  return {
    id: row.id,
    pattern: row.pattern,
    category: row.category,
    sourceInstance: row.source_instance,
    usefulness: row.usefulness,
    createdAt: row.created_at,
  };
}
