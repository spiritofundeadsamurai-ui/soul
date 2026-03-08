/**
 * Quick Capture — Fast notes, ideas, bookmarks without friction
 *
 * 1. Instant note capture (no categorization needed)
 * 2. Idea bank with rating
 * 3. Bookmarks with tags
 * 4. Clipboard/snippet manager
 * 5. Voice-note-style quick thoughts
 */

import { getRawDb } from "../db/index.js";

export interface QuickNote {
  id: number;
  content: string;
  noteType: string; // note, idea, bookmark, thought, todo
  priority: number; // 1-5
  pinned: boolean;
  tags: string;
  url: string;
  createdAt: string;
}

function ensureQuickTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_quick_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'note',
      priority INTEGER NOT NULL DEFAULT 3,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function quickNote(content: string, type = "note", priority = 3, tags?: string[], url?: string): QuickNote {
  ensureQuickTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    "INSERT INTO soul_quick_notes (content, note_type, priority, tags, url) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(content, type, priority, JSON.stringify(tags || []), url || "") as any;

  return mapNote(row);
}

export function quickIdea(idea: string, rating = 3): QuickNote {
  return quickNote(idea, "idea", rating);
}

export function quickBookmark(url: string, title: string, tags?: string[]): QuickNote {
  return quickNote(title, "bookmark", 3, tags, url);
}

export function getQuickNotes(type?: string, pinned?: boolean, limit = 30): QuickNote[] {
  ensureQuickTable();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_quick_notes WHERE 1=1";
  const params: any[] = [];

  if (type) { sql += " AND note_type = ?"; params.push(type); }
  if (pinned !== undefined) { sql += " AND pinned = ?"; params.push(pinned ? 1 : 0); }

  sql += " ORDER BY pinned DESC, priority DESC, created_at DESC LIMIT ?";
  params.push(limit);

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapNote);
}

export function pinNote(id: number, pin = true): QuickNote | null {
  ensureQuickTable();
  const rawDb = getRawDb();
  rawDb.prepare("UPDATE soul_quick_notes SET pinned = ? WHERE id = ?").run(pin ? 1 : 0, id);
  const row = rawDb.prepare("SELECT * FROM soul_quick_notes WHERE id = ?").get(id) as any;
  return row ? mapNote(row) : null;
}

export function deleteQuickNote(id: number): boolean {
  ensureQuickTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare("DELETE FROM soul_quick_notes WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchQuickNotes(query: string): QuickNote[] {
  ensureQuickTable();
  const rawDb = getRawDb();
  return (rawDb.prepare(
    "SELECT * FROM soul_quick_notes WHERE content LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 30"
  ).all(`%${query}%`, `%${query}%`) as any[]).map(mapNote);
}

function mapNote(row: any): QuickNote {
  return {
    id: row.id, content: row.content, noteType: row.note_type,
    priority: row.priority, pinned: !!row.pinned,
    tags: row.tags, url: row.url, createdAt: row.created_at,
  };
}
