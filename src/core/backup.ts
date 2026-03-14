/**
 * Auto-Backup System — Never lose Soul's memories
 *
 * - Auto-backup SQLite DB on startup
 * - Daily scheduled backup via scheduler
 * - Max 7 backups rotated (oldest deleted)
 * - Restore from any backup
 * - Backup integrity verification
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { getRawDb } from "../db/index.js";

const BACKUP_DIR = join(homedir(), ".soul", "backups");
const MAX_BACKUPS = 7;

function ensureBackupDir() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Get the path to the SQLite database file
 */
function getDbPath(): string {
  const db = getRawDb();
  // better-sqlite3 stores the path as .name
  return (db as any).name || join(homedir(), ".soul", "soul.db");
}

/**
 * Create a backup of the SQLite database
 * Uses SQLite's VACUUM INTO for a consistent, compact backup
 */
export function createBackup(label?: string): { success: boolean; path: string; message: string; sizeBytes: number } {
  ensureBackupDir();

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
  const suffix = label ? `-${label.replace(/[^a-zA-Z0-9-_]/g, "")}` : "";
  const backupName = `soul-backup-${timestamp}${suffix}.db`;
  const backupPath = join(BACKUP_DIR, backupName);

  try {
    const db = getRawDb();
    // VACUUM INTO creates a compact, consistent copy
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    const stats = statSync(backupPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    // Rotate old backups
    rotateBackups();

    return {
      success: true,
      path: backupPath,
      message: `Backup created: ${backupName} (${sizeMB} MB)`,
      sizeBytes: stats.size,
    };
  } catch (e: any) {
    // Fallback: simple file copy
    try {
      const dbPath = getDbPath();
      copyFileSync(dbPath, backupPath);
      const stats = statSync(backupPath);
      rotateBackups();
      return {
        success: true,
        path: backupPath,
        message: `Backup created (copy): ${backupName} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
        sizeBytes: stats.size,
      };
    } catch (copyErr: any) {
      return { success: false, path: "", message: `Backup failed: ${e.message}`, sizeBytes: 0 };
    }
  }
}

/**
 * List all available backups (newest first)
 */
export function listBackups(): Array<{ name: string; path: string; size: number; sizeMB: string; createdAt: Date }> {
  ensureBackupDir();
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("soul-backup-") && f.endsWith(".db"))
      .map(f => {
        const fullPath = join(BACKUP_DIR, f);
        const stats = statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: stats.size,
          sizeMB: (stats.size / 1024 / 1024).toFixed(1),
          createdAt: stats.mtime,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return files;
  } catch {
    return [];
  }
}

/**
 * Restore from a backup file
 * WARNING: This replaces the current database!
 */
export async function restoreBackup(backupNameOrPath: string): Promise<{ success: boolean; message: string }> {
  const fullPath = backupNameOrPath.includes("/") || backupNameOrPath.includes("\\")
    ? backupNameOrPath
    : join(BACKUP_DIR, backupNameOrPath);

  if (!existsSync(fullPath)) {
    return { success: false, message: `Backup not found: ${backupNameOrPath}` };
  }

  try {
    // Verify the backup is a valid SQLite DB
    const { default: Database } = await import("better-sqlite3");
    const testDb = new Database(fullPath, { readonly: true });
    const tables = testDb.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any;
    testDb.close();
    if (!tables || tables.c < 1) {
      return { success: false, message: "Backup file is not a valid Soul database." };
    }

    // Create a safety backup of current DB before restore
    createBackup("pre-restore");

    // Copy backup over current DB
    const dbPath = getDbPath();
    copyFileSync(fullPath, dbPath);

    return {
      success: true,
      message: `Restored from ${basename(fullPath)}. Restart Soul for changes to take effect.`,
    };
  } catch (e: any) {
    return { success: false, message: `Restore failed: ${e.message}` };
  }
}

/**
 * Verify a backup's integrity
 */
export async function verifyBackup(backupNameOrPath: string): Promise<{ valid: boolean; tables: number; message: string }> {
  const fullPath = backupNameOrPath.includes("/") || backupNameOrPath.includes("\\")
    ? backupNameOrPath
    : join(BACKUP_DIR, backupNameOrPath);

  if (!existsSync(fullPath)) {
    return { valid: false, tables: 0, message: "File not found" };
  }

  try {
    const { default: Database } = await import("better-sqlite3");
    const testDb = new Database(fullPath, { readonly: true });
    const intCheck = testDb.prepare("PRAGMA integrity_check").get() as any;
    const tables = testDb.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any;
    const memories = testDb.prepare("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any;
    testDb.close();

    const isOk = intCheck?.integrity_check === "ok";
    return {
      valid: isOk,
      tables: tables?.c || 0,
      message: isOk
        ? `Valid: ${tables.c} tables, ${memories?.c || 0} memories`
        : `Integrity check failed: ${intCheck?.integrity_check}`,
    };
  } catch (e: any) {
    return { valid: false, tables: 0, message: `Verify failed: ${e.message}` };
  }
}

/**
 * Rotate backups — keep only MAX_BACKUPS newest
 */
function rotateBackups() {
  const backups = listBackups();
  if (backups.length <= MAX_BACKUPS) return;

  // Delete oldest backups beyond the limit
  const toDelete = backups.slice(MAX_BACKUPS);
  for (const b of toDelete) {
    try {
      unlinkSync(b.path);
    } catch { /* ok */ }
  }
}

/**
 * Get backup stats
 */
export function getBackupStats(): {
  totalBackups: number;
  latestBackup: string | null;
  totalSizeMB: string;
  backupDir: string;
} {
  const backups = listBackups();
  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
  return {
    totalBackups: backups.length,
    latestBackup: backups.length > 0 ? backups[0].name : null,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(1),
    backupDir: BACKUP_DIR,
  };
}
