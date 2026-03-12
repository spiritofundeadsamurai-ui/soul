/**
 * Named Persistent Sessions — Save and resume named conversation sessions
 *
 * 1. Create named sessions for different topics/projects
 * 2. Resume any session by name
 * 3. Track last message and session metadata
 * 4. Integrates with conversation-tree for message history
 */

import { getRawDb } from "../db/index.js";
import { randomUUID } from "crypto";
import { getSessionTreeMessages } from "./conversation-tree.js";

export interface Session {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastMessageId: string | null;
  metadata: Record<string, any>;
}

function ensureSessionsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_sessions (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_message_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_name ON soul_sessions(name);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON soul_sessions(updated_at);
  `);
}

function mapSession(row: any): Session {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageId: row.last_message_id || null,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

/**
 * Create a new named session.
 */
export function createSession(name: string, description?: string): Session {
  ensureSessionsTable();
  const rawDb = getRawDb();
  const id = randomUUID();

  rawDb.prepare(
    "INSERT INTO soul_sessions (id, name, description) VALUES (?, ?, ?)"
  ).run(id, name, description || "");

  const row = rawDb.prepare("SELECT * FROM soul_sessions WHERE id = ?").get(id) as any;
  return mapSession(row);
}

/**
 * List all sessions, ordered by most recently updated.
 */
export function listSessions(): Session[] {
  ensureSessionsTable();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_sessions ORDER BY updated_at DESC"
  ).all() as any[];
  return rows.map(mapSession);
}

/**
 * Get a session by name or ID.
 */
export function getSession(nameOrId: string): Session | null {
  ensureSessionsTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_sessions WHERE name = ? OR id = ?"
  ).get(nameOrId, nameOrId) as any;
  return row ? mapSession(row) : null;
}

/**
 * Delete a session by name or ID.
 */
export function deleteSession(nameOrId: string): boolean {
  ensureSessionsTable();
  const rawDb = getRawDb();
  const session = getSession(nameOrId);
  if (!session) return false;

  rawDb.prepare("DELETE FROM soul_sessions WHERE id = ?").run(session.id);
  // Also clean up conversation tree messages for this session
  try {
    rawDb.prepare("DELETE FROM soul_conversation_tree WHERE session_id = ?").run(session.id);
    rawDb.prepare("DELETE FROM soul_active_branch WHERE session_id = ?").run(session.id);
  } catch {
    // Tables may not exist yet
  }
  return true;
}

/**
 * Rename a session.
 */
export function renameSession(oldName: string, newName: string): Session | null {
  ensureSessionsTable();
  const rawDb = getRawDb();
  const session = getSession(oldName);
  if (!session) return null;

  rawDb.prepare(
    "UPDATE soul_sessions SET name = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newName, session.id);

  return getSession(newName);
}

/**
 * Resume a session — returns session context with last messages.
 */
export function resumeSession(nameOrId: string): { session: Session; messages: any[] } | null {
  ensureSessionsTable();
  const session = getSession(nameOrId);
  if (!session) return null;

  // Update last accessed time
  const rawDb = getRawDb();
  rawDb.prepare(
    "UPDATE soul_sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(session.id);

  // Get recent messages from conversation tree
  const messages = getSessionMessages(nameOrId);

  return { session: { ...session, updatedAt: new Date().toISOString() }, messages };
}

/**
 * Get recent messages from conversation_tree for this session.
 */
export function getSessionMessages(nameOrId: string, limit = 20): any[] {
  const session = getSession(nameOrId);
  if (!session) return [];

  try {
    return getSessionTreeMessages(session.id, limit);
  } catch {
    return [];
  }
}

/**
 * Update session's last_message_id and updated_at.
 */
export function updateSessionLastMessage(nameOrId: string, messageId: string): Session | null {
  ensureSessionsTable();
  const session = getSession(nameOrId);
  if (!session) return null;

  const rawDb = getRawDb();
  rawDb.prepare(
    "UPDATE soul_sessions SET last_message_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(messageId, session.id);

  return getSession(session.id);
}

/**
 * Update session metadata.
 */
export function updateSessionMetadata(nameOrId: string, metadata: Record<string, any>): Session | null {
  ensureSessionsTable();
  const session = getSession(nameOrId);
  if (!session) return null;

  const merged = { ...session.metadata, ...metadata };
  const rawDb = getRawDb();
  rawDb.prepare(
    "UPDATE soul_sessions SET metadata = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(merged), session.id);

  return getSession(session.id);
}
