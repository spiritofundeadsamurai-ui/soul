/**
 * Time Intelligence — Soul understands and manages time
 *
 * What most AI lacks:
 * 1. Pomodoro timer tracking
 * 2. Time spent on tasks/projects
 * 3. Productivity pattern analysis
 * 4. Focus time recommendations
 * 5. Break reminders
 */

import { getRawDb } from "../db/index.js";

export interface TimeEntry {
  id: number;
  project: string;
  task: string;
  startedAt: string;
  endedAt: string | null;
  durationMin: number;
  type: string; // work, break, learning, creative
}

function ensureTimeTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL DEFAULT 'general',
      task TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      duration_min REAL NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'work'
    )
  `);
}

/**
 * Start tracking time
 */
export function startTimer(project: string, task: string, type = "work"): TimeEntry {
  ensureTimeTable();
  const rawDb = getRawDb();

  // End any active timer first
  const active = rawDb.prepare(
    "SELECT * FROM soul_time_entries WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).get() as any;

  if (active) {
    stopTimer();
  }

  const row = rawDb.prepare(
    "INSERT INTO soul_time_entries (project, task, type) VALUES (?, ?, ?) RETURNING *"
  ).get(project, task, type) as any;

  return mapEntry(row);
}

/**
 * Stop the active timer
 */
export function stopTimer(): TimeEntry | null {
  ensureTimeTable();
  const rawDb = getRawDb();

  const active = rawDb.prepare(
    "SELECT * FROM soul_time_entries WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).get() as any;

  if (!active) return null;

  rawDb.prepare(
    `UPDATE soul_time_entries
     SET ended_at = datetime('now'),
         duration_min = (julianday('now') - julianday(started_at)) * 1440
     WHERE id = ?`
  ).run(active.id);

  const updated = rawDb.prepare("SELECT * FROM soul_time_entries WHERE id = ?").get(active.id) as any;
  return mapEntry(updated);
}

/**
 * Get active timer
 */
export function getActiveTimer(): TimeEntry | null {
  ensureTimeTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    "SELECT * FROM soul_time_entries WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).get() as any;

  return row ? mapEntry(row) : null;
}

/**
 * Get time entries for today
 */
export function getTodayEntries(): TimeEntry[] {
  ensureTimeTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    "SELECT * FROM soul_time_entries WHERE date(started_at) = date('now') ORDER BY started_at DESC"
  ).all() as any[];

  return rows.map(mapEntry);
}

/**
 * Get time summary by project
 */
export function getTimeSummary(days = 7): {
  totalHours: number;
  byProject: Record<string, number>;
  byType: Record<string, number>;
  avgDailyHours: number;
  longestStreak: number;
} {
  ensureTimeTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    `SELECT * FROM soul_time_entries
     WHERE started_at >= datetime('now', '-${days} days') AND ended_at IS NOT NULL
     ORDER BY started_at`
  ).all() as any[];

  const byProject: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalMin = 0;

  for (const r of rows) {
    const min = r.duration_min || 0;
    totalMin += min;
    byProject[r.project] = (byProject[r.project] || 0) + min;
    byType[r.type] = (byType[r.type] || 0) + min;
  }

  // Convert to hours
  const totalHours = totalMin / 60;
  for (const k of Object.keys(byProject)) byProject[k] = Math.round(byProject[k] / 60 * 10) / 10;
  for (const k of Object.keys(byType)) byType[k] = Math.round(byType[k] / 60 * 10) / 10;

  // Longest streak (consecutive days with entries)
  const dates = new Set(rows.map((r: any) => r.started_at?.substring(0, 10)));
  let longestStreak = 0;
  let currentStreak = 0;
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().substring(0, 10);
    if (dates.has(dateStr)) {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return {
    totalHours: Math.round(totalHours * 10) / 10,
    byProject,
    byType,
    avgDailyHours: Math.round((totalHours / days) * 10) / 10,
    longestStreak,
  };
}

function mapEntry(row: any): TimeEntry {
  return {
    id: row.id,
    project: row.project,
    task: row.task,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMin: row.duration_min || 0,
    type: row.type,
  };
}
