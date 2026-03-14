/**
 * Data Export/Import — Portable Soul data
 *
 * Export: memories, knowledge, goals, habits, people, learnings → JSON
 * Import: Restore from exported JSON file
 */

import { getRawDb } from "../db/index.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const EXPORT_DIR = join(homedir(), ".soul", "exports");

interface SoulExport {
  version: string;
  exportedAt: string;
  sections: {
    memories?: any[];
    knowledge?: any[];
    goals?: any[];
    habits?: any[];
    people?: any[];
    learnings?: any[];
    settings?: Record<string, any>;
  };
  stats: {
    totalRecords: number;
    sections: Record<string, number>;
  };
}

/**
 * Export Soul data to JSON
 */
export function exportData(options?: {
  sections?: string[];
  outputPath?: string;
}): { success: boolean; path: string; message: string; stats: Record<string, number> } {
  const db = getRawDb();
  const sections = options?.sections || ["memories", "knowledge", "goals", "habits", "people", "learnings"];
  const stats: Record<string, number> = {};
  const data: SoulExport = {
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    sections: {},
    stats: { totalRecords: 0, sections: {} },
  };

  for (const section of sections) {
    try {
      let rows: any[] = [];
      switch (section) {
        case "memories":
          rows = db.prepare("SELECT id, content, type, tags, source, created_at FROM memories WHERE is_active = 1 ORDER BY created_at DESC").all() as any[];
          break;
        case "knowledge":
          rows = db.prepare("SELECT * FROM soul_knowledge WHERE 1=1 ORDER BY created_at DESC").all() as any[];
          break;
        case "goals":
          rows = db.prepare("SELECT * FROM soul_goals WHERE status != 'deleted' ORDER BY created_at DESC").all() as any[];
          break;
        case "habits":
          rows = db.prepare("SELECT * FROM soul_habits ORDER BY created_at DESC").all() as any[];
          break;
        case "people":
          rows = db.prepare("SELECT * FROM soul_people ORDER BY created_at DESC").all() as any[];
          break;
        case "learnings":
          rows = db.prepare("SELECT * FROM soul_learnings ORDER BY created_at DESC").all() as any[];
          break;
      }
      (data.sections as any)[section] = rows;
      stats[section] = rows.length;
      data.stats.totalRecords += rows.length;
    } catch {
      stats[section] = 0;
    }
  }

  data.stats.sections = stats;

  // Write to file
  mkdirSync(EXPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const fileName = `soul-export-${timestamp}.json`;
  const filePath = options?.outputPath || join(EXPORT_DIR, fileName);
  writeFileSync(filePath, JSON.stringify(data, null, 2));

  const totalRecords = Object.values(stats).reduce((a, b) => a + b, 0);
  return {
    success: true,
    path: filePath,
    message: `Exported ${totalRecords} records (${sections.join(", ")}) to ${fileName}`,
    stats,
  };
}

/**
 * Import Soul data from JSON file
 */
export function importData(filePath: string, options?: {
  merge?: boolean; // true = merge with existing, false = skip duplicates
}): { success: boolean; message: string; imported: Record<string, number> } {
  if (!existsSync(filePath)) {
    return { success: false, message: `File not found: ${filePath}`, imported: {} };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: SoulExport = JSON.parse(raw);
    const db = getRawDb();
    const imported: Record<string, number> = {};

    // Import memories
    if (data.sections.memories) {
      let count = 0;
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO memories (content, type, tags, source, created_at, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      for (const m of data.sections.memories) {
        try {
          const result = stmt.run(m.content, m.type || "general", m.tags || "", m.source || "import", m.created_at || new Date().toISOString());
          if (result.changes > 0) count++;
        } catch { /* skip duplicates */ }
      }
      imported.memories = count;
    }

    // Import knowledge
    if (data.sections.knowledge) {
      let count = 0;
      for (const k of data.sections.knowledge) {
        try {
          db.prepare("INSERT OR IGNORE INTO soul_knowledge (category, topic, content, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(k.category, k.topic, k.content, k.source || "import", k.confidence || 0.8, k.created_at || new Date().toISOString());
          count++;
        } catch { /* skip */ }
      }
      imported.knowledge = count;
    }

    const totalImported = Object.values(imported).reduce((a, b) => a + b, 0);
    return {
      success: true,
      message: `Imported ${totalImported} records from ${data.exportedAt || "unknown date"}`,
      imported,
    };
  } catch (e: any) {
    return { success: false, message: `Import failed: ${e.message}`, imported: {} };
  }
}

/**
 * List available exports
 */
export function listExports(): Array<{ name: string; path: string; size: string; date: string }> {
  mkdirSync(EXPORT_DIR, { recursive: true });
  try {
    return readdirSync(EXPORT_DIR)
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => {
        const fullPath = join(EXPORT_DIR, f);
        const stats = statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: (stats.size / 1024).toFixed(1) + " KB",
          date: stats.mtime.toISOString().substring(0, 16),
        };
      })
      .sort((a: any, b: any) => b.date.localeCompare(a.date));
  } catch { return []; }
}
