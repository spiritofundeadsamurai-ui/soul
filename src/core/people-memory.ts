/**
 * People Memory — Soul remembers people master interacts with
 *
 * 1. Remember names, roles, preferences, relationships
 * 2. Track interactions (when did master last talk about this person?)
 * 3. Remember context about people (likes, dislikes, projects)
 * 4. Relationship mapping
 * 5. Birthday/important date reminders
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface Person {
  id: number;
  name: string;
  nickname: string;
  role: string;
  relationship: string;
  notes: string;
  traits: string;
  lastMentioned: string;
  mentionCount: number;
  importantDates: string;
  createdAt: string;
  updatedAt: string;
}

function ensurePeopleTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      relationship TEXT NOT NULL DEFAULT 'acquaintance',
      notes TEXT NOT NULL DEFAULT '',
      traits TEXT NOT NULL DEFAULT '[]',
      last_mentioned TEXT NOT NULL DEFAULT (datetime('now')),
      mention_count INTEGER NOT NULL DEFAULT 1,
      important_dates TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function addPerson(input: {
  name: string;
  nickname?: string;
  role?: string;
  relationship?: string;
  notes?: string;
  traits?: string[];
  importantDates?: Record<string, string>;
}): Promise<Person> {
  ensurePeopleTable();
  const rawDb = getRawDb();

  // Check if person exists
  const existing = rawDb.prepare(
    "SELECT * FROM soul_people WHERE LOWER(name) = LOWER(?) OR LOWER(nickname) = LOWER(?)"
  ).get(input.name, input.name) as any;

  if (existing) {
    // Update existing
    rawDb.prepare(
      `UPDATE soul_people SET
        notes = CASE WHEN ? != '' THEN notes || '\n' || ? ELSE notes END,
        mention_count = mention_count + 1,
        last_mentioned = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(input.notes || "", input.notes || "", existing.id);

    const updated = rawDb.prepare("SELECT * FROM soul_people WHERE id = ?").get(existing.id) as any;
    return mapPerson(updated);
  }

  const row = rawDb.prepare(
    `INSERT INTO soul_people (name, nickname, role, relationship, notes, traits, important_dates)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.name,
    input.nickname || "",
    input.role || "",
    input.relationship || "acquaintance",
    input.notes || "",
    JSON.stringify(input.traits || []),
    JSON.stringify(input.importantDates || {})
  ) as any;

  await remember({
    content: `[Person] ${input.name}${input.role ? ` (${input.role})` : ""}: ${input.notes || "New contact"}`,
    type: "conversation",
    tags: ["person", input.name.toLowerCase(), input.relationship || "acquaintance"],
    source: "people-memory",
  });

  return mapPerson(row);
}

export function findPerson(nameOrNickname: string): Person | null {
  ensurePeopleTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_people WHERE LOWER(name) LIKE LOWER(?) OR LOWER(nickname) LIKE LOWER(?)"
  ).get(`%${nameOrNickname}%`, `%${nameOrNickname}%`) as any;
  return row ? mapPerson(row) : null;
}

export function listPeople(relationship?: string, limit = 50): Person[] {
  ensurePeopleTable();
  const rawDb = getRawDb();
  let sql = "SELECT * FROM soul_people WHERE 1=1";
  const params: any[] = [];

  if (relationship) {
    sql += " AND relationship = ?";
    params.push(relationship);
  }
  sql += " ORDER BY last_mentioned DESC LIMIT ?";
  params.push(limit);

  return (rawDb.prepare(sql).all(...params) as any[]).map(mapPerson);
}

export async function updatePerson(id: number, updates: {
  notes?: string;
  role?: string;
  relationship?: string;
  traits?: string[];
  importantDates?: Record<string, string>;
}): Promise<Person | null> {
  ensurePeopleTable();
  const rawDb = getRawDb();

  const sets: string[] = ["updated_at = datetime('now')", "last_mentioned = datetime('now')"];
  const params: any[] = [];

  if (updates.notes) { sets.push("notes = notes || '\n' || ?"); params.push(updates.notes); }
  if (updates.role) { sets.push("role = ?"); params.push(updates.role); }
  if (updates.relationship) { sets.push("relationship = ?"); params.push(updates.relationship); }
  if (updates.traits) { sets.push("traits = ?"); params.push(JSON.stringify(updates.traits)); }
  if (updates.importantDates) { sets.push("important_dates = ?"); params.push(JSON.stringify(updates.importantDates)); }

  params.push(id);
  rawDb.prepare(`UPDATE soul_people SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const row = rawDb.prepare("SELECT * FROM soul_people WHERE id = ?").get(id) as any;
  return row ? mapPerson(row) : null;
}

export function getPeopleStats(): {
  total: number;
  byRelationship: Record<string, number>;
  recentlyMentioned: Person[];
} {
  ensurePeopleTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_people").get() as any)?.c || 0;
  const byRel: Record<string, number> = {};
  const relRows = rawDb.prepare("SELECT relationship, COUNT(*) as c FROM soul_people GROUP BY relationship").all() as any[];
  for (const r of relRows) byRel[r.relationship] = r.c;

  const recent = (rawDb.prepare("SELECT * FROM soul_people ORDER BY last_mentioned DESC LIMIT 5").all() as any[]).map(mapPerson);

  return { total, byRelationship: byRel, recentlyMentioned: recent };
}

function mapPerson(row: any): Person {
  return {
    id: row.id, name: row.name, nickname: row.nickname,
    role: row.role, relationship: row.relationship,
    notes: row.notes, traits: row.traits,
    lastMentioned: row.last_mentioned, mentionCount: row.mention_count,
    importantDates: row.important_dates,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
