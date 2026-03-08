/**
 * Sync Engine — Cross-device memory synchronization
 *
 * Soul's memory should be available everywhere:
 * 1. Export/import memory snapshots
 * 2. Sync to remote storage (configurable)
 * 3. Merge strategies for conflict resolution
 * 4. Incremental sync (only new memories)
 */

import { getRawDb } from "../db/index.js";
import { remember, getMemoryStats } from "../memory/memory-engine.js";
import { sanitizeColumns, safePath, filterExportData, logSecurityEvent } from "./security.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface SyncSnapshot {
  version: string;
  timestamp: string;
  deviceId: string;
  stats: {
    memories: number;
    learnings: number;
    tasks: number;
    goals: number;
    habits: number;
    decisions: number;
  };
  data: {
    memories: any[];
    learnings: any[];
    tasks: any[];
    goals: any[];
    habits: any[];
    decisions: any[];
    reflections: any[];
    writings: any[];
    skills: any[];
    notifications: any[];
  };
}

function getDeviceId(): string {
  const configDir = path.join(os.homedir(), ".soul");
  const deviceFile = path.join(configDir, "device-id");

  try {
    return fs.readFileSync(deviceFile, "utf-8").trim();
  } catch {
    const id = `${os.hostname()}-${Date.now().toString(36)}`;
    try {
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(deviceFile, id);
    } catch {
      // Non-critical
    }
    return id;
  }
}

/**
 * Export all Soul data as a snapshot
 */
export async function exportSnapshot(): Promise<SyncSnapshot> {
  const rawDb = getRawDb();

  const safeAll = (query: string): any[] => {
    try {
      return rawDb.prepare(query).all() as any[];
    } catch {
      return [];
    }
  };

  const memories = safeAll("SELECT * FROM memories WHERE is_active = 1");
  const learnings = safeAll("SELECT * FROM learnings");
  const tasks = safeAll("SELECT * FROM soul_tasks");
  const goals = safeAll("SELECT * FROM soul_goals");
  const habits = safeAll("SELECT * FROM soul_habits");
  const decisions = safeAll("SELECT * FROM soul_decisions");
  const reflections = safeAll("SELECT * FROM soul_reflections");
  const writings = safeAll("SELECT * FROM soul_writing");
  const skills = safeAll("SELECT * FROM soul_executable_skills");
  const notifications = safeAll("SELECT * FROM soul_notifications WHERE is_read = 0");

  // SECURITY: Filter out any items containing sensitive data (passwords, keys, etc.)
  const safeMemories = filterExportData(memories);
  const safeLearnings = filterExportData(learnings);

  return {
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    deviceId: getDeviceId(),
    stats: {
      memories: safeMemories.length,
      learnings: safeLearnings.length,
      tasks: tasks.length,
      goals: goals.length,
      habits: habits.length,
      decisions: decisions.length,
    },
    data: {
      memories: safeMemories,
      learnings: safeLearnings,
      tasks,
      goals,
      habits,
      decisions,
      reflections,
      writings,
      skills,
      notifications,
    },
  };
}

/**
 * Save snapshot to a file
 */
export async function saveSnapshotToFile(
  filePath?: string
): Promise<string> {
  const snapshot = await exportSnapshot();
  const soulDir = path.join(os.homedir(), ".soul");
  // SECURITY: restrict file writes to ~/.soul/ directory
  const outputPath = filePath
    ? safePath(filePath, soulDir)
    : path.join(soulDir, `snapshot-${Date.now()}.json`);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
  logSecurityEvent("snapshot_exported", { path: outputPath });

  return outputPath;
}

/**
 * Import snapshot — merge with existing data
 */
export async function importSnapshot(
  snapshotData: string | SyncSnapshot,
  strategy: "merge" | "replace" = "merge"
): Promise<{ imported: Record<string, number>; conflicts: number }> {
  const snapshot: SyncSnapshot =
    typeof snapshotData === "string"
      ? JSON.parse(snapshotData)
      : snapshotData;

  const rawDb = getRawDb();
  const imported: Record<string, number> = {};
  let conflicts = 0;

  // Import memories
  if (snapshot.data.memories.length > 0) {
    let count = 0;
    for (const mem of snapshot.data.memories) {
      try {
        // Check for duplicate by content hash
        const existing = rawDb
          .prepare("SELECT id FROM memories WHERE content = ? AND type = ?")
          .get(mem.content, mem.type);

        if (!existing) {
          await remember({
            content: mem.content,
            type: mem.type,
            tags: typeof mem.tags === "string" ? JSON.parse(mem.tags) : (mem.tags || []),
            source: mem.source || `sync:${snapshot.deviceId}`,
          });
          count++;
        } else {
          conflicts++;
        }
      } catch {
        conflicts++;
      }
    }
    imported.memories = count;
  }

  // Import learnings
  if (snapshot.data.learnings.length > 0) {
    let count = 0;
    for (const learning of snapshot.data.learnings) {
      try {
        const existing = rawDb
          .prepare("SELECT id FROM learnings WHERE pattern = ?")
          .get(learning.pattern);

        if (!existing) {
          rawDb
            .prepare(
              "INSERT INTO learnings (pattern, confidence, evidence_count, memory_ids, first_seen) VALUES (?, ?, ?, ?, ?)"
            )
            .run(
              learning.pattern,
              learning.confidence,
              learning.evidence_count || learning.reinforcement_count || 1,
              learning.memory_ids || learning.related_memory_ids || "[]",
              learning.first_seen || learning.created_at
            );
          count++;
        } else {
          conflicts++;
        }
      } catch {
        conflicts++;
      }
    }
    imported.learnings = count;
  }

  // Import other tables with safe insert
  const tableMappings = [
    { key: "tasks", table: "soul_tasks" },
    { key: "goals", table: "soul_goals" },
    { key: "habits", table: "soul_habits" },
    { key: "decisions", table: "soul_decisions" },
    { key: "reflections", table: "soul_reflections" },
    { key: "writings", table: "soul_writing" },
  ];

  for (const { key, table } of tableMappings) {
    const items = (snapshot.data as any)[key] || [];
    if (items.length > 0) {
      let count = 0;
      for (const item of items) {
        try {
          const rawColumns = Object.keys(item).filter((k) => k !== "id");
          // SECURITY: whitelist column names to prevent SQL injection
          const columns = sanitizeColumns(table, rawColumns);
          if (columns.length === 0) {
            logSecurityEvent("sync_import_blocked", { table, rejectedColumns: rawColumns });
            conflicts++;
            continue;
          }
          const values = columns.map((c) => item[c]);
          const placeholders = columns.map(() => "?").join(", ");
          const columnNames = columns.join(", ");

          rawDb
            .prepare(
              `INSERT OR IGNORE INTO ${table} (${columnNames}) VALUES (${placeholders})`
            )
            .run(...values);
          count++;
        } catch {
          conflicts++;
        }
      }
      imported[key] = count;
    }
  }

  await remember({
    content: `[Sync] Imported snapshot from ${snapshot.deviceId}: ${JSON.stringify(imported)} | ${conflicts} conflicts`,
    type: "conversation",
    tags: ["sync", "import"],
    source: "sync-engine",
  });

  return { imported, conflicts };
}

/**
 * Load snapshot from file
 */
export async function loadSnapshotFromFile(
  filePath: string
): Promise<{ imported: Record<string, number>; conflicts: number }> {
  const soulDir = path.join(os.homedir(), ".soul");
  // SECURITY: restrict file reads to ~/.soul/ directory
  const safeFP = safePath(filePath, soulDir);
  logSecurityEvent("snapshot_imported", { path: safeFP });
  const content = fs.readFileSync(safeFP, "utf-8");
  return importSnapshot(content, "merge");
}

/**
 * Get sync status
 */
export async function getSyncStatus(): Promise<{
  deviceId: string;
  lastExport: string | null;
  snapshotCount: number;
  snapshotDir: string;
}> {
  const snapshotDir = path.join(os.homedir(), ".soul");
  let snapshotCount = 0;
  let lastExport: string | null = null;

  try {
    const files = fs.readdirSync(snapshotDir).filter((f) => f.startsWith("snapshot-"));
    snapshotCount = files.length;
    if (files.length > 0) {
      const latest = files.sort().reverse()[0];
      const stat = fs.statSync(path.join(snapshotDir, latest));
      lastExport = stat.mtime.toISOString();
    }
  } catch {
    // Dir might not exist
  }

  return {
    deviceId: getDeviceId(),
    lastExport,
    snapshotCount,
    snapshotDir,
  };
}
