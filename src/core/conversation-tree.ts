/**
 * Conversation Tree — Tree-based conversation branching
 *
 * Inspired by Pi Coding Agent's branching conversations:
 * - Each message has a parent_id forming a tree structure
 * - Users can branch from any point in conversation history
 * - Switch between branches, view full tree structure
 */

import { getRawDb } from "../db/index.js";
import { randomUUID } from "crypto";

export interface TreeMessage {
  id: string;
  sessionId: string;
  parentId: string | null;
  role: string;
  content: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface ActiveBranch {
  sessionId: string;
  activeMessageId: string;
}

function ensureConversationTreeTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_conversation_tree (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conv_tree_session ON soul_conversation_tree(session_id);
    CREATE INDEX IF NOT EXISTS idx_conv_tree_parent ON soul_conversation_tree(parent_id);

    CREATE TABLE IF NOT EXISTS soul_active_branch (
      session_id TEXT PRIMARY KEY,
      active_message_id TEXT NOT NULL
    );
  `);
}

function mapMessage(row: any): TreeMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id || null,
    role: row.role,
    content: row.content,
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
  };
}

/**
 * Add a message to the conversation tree.
 */
export function addTreeMessage(
  sessionId: string,
  parentId: string | null,
  role: string,
  content: string,
  metadata?: Record<string, any>
): TreeMessage {
  ensureConversationTreeTable();
  const rawDb = getRawDb();
  const id = randomUUID();
  const meta = JSON.stringify(metadata || {});

  rawDb.prepare(
    "INSERT INTO soul_conversation_tree (id, session_id, parent_id, role, content, metadata) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, sessionId, parentId || null, role, content, meta);

  // Update active branch pointer
  rawDb.prepare(
    "INSERT OR REPLACE INTO soul_active_branch (session_id, active_message_id) VALUES (?, ?)"
  ).run(sessionId, id);

  const row = rawDb.prepare("SELECT * FROM soul_conversation_tree WHERE id = ?").get(id) as any;
  return mapMessage(row);
}

/**
 * Create a new branch from an existing message.
 * Returns a new session_id for the branch.
 */
export function createBranch(sessionId: string, parentMessageId: string): string {
  ensureConversationTreeTable();
  const rawDb = getRawDb();

  // Verify parent message exists
  const parent = rawDb.prepare("SELECT * FROM soul_conversation_tree WHERE id = ?").get(parentMessageId) as any;
  if (!parent) {
    throw new Error(`Message ${parentMessageId} not found`);
  }

  const newSessionId = randomUUID();

  // Copy the path from root to parentMessageId into the new session
  const path = getBranch(parentMessageId);
  for (const msg of path) {
    rawDb.prepare(
      "INSERT INTO soul_conversation_tree (id, session_id, parent_id, role, content, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), newSessionId, msg.parentId, msg.role, msg.content, JSON.stringify(msg.metadata));
  }

  // Set active branch to the last copied message
  const lastMsg = rawDb.prepare(
    "SELECT id FROM soul_conversation_tree WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(newSessionId) as any;

  if (lastMsg) {
    rawDb.prepare(
      "INSERT OR REPLACE INTO soul_active_branch (session_id, active_message_id) VALUES (?, ?)"
    ).run(newSessionId, lastMsg.id);
  }

  return newSessionId;
}

/**
 * Get the path from root to a specific message (the branch).
 */
export function getBranch(messageId: string): TreeMessage[] {
  ensureConversationTreeTable();
  const rawDb = getRawDb();
  const path: TreeMessage[] = [];
  let currentId: string | null = messageId;

  while (currentId) {
    const row = rawDb.prepare("SELECT * FROM soul_conversation_tree WHERE id = ?").get(currentId) as any;
    if (!row) break;
    path.unshift(mapMessage(row));
    currentId = row.parent_id || null;
  }

  return path;
}

/**
 * Get all direct children (branches) of a message.
 */
export function getChildren(messageId: string): TreeMessage[] {
  ensureConversationTreeTable();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_conversation_tree WHERE parent_id = ? ORDER BY created_at ASC"
  ).all(messageId) as any[];
  return rows.map(mapMessage);
}

/**
 * Get full tree structure for a session.
 */
export function getTree(sessionId: string): TreeMessage[] {
  ensureConversationTreeTable();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(
    "SELECT * FROM soul_conversation_tree WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId) as any[];
  return rows.map(mapMessage);
}

/**
 * Switch active branch pointer to a specific message.
 */
export function switchBranch(sessionId: string, messageId: string): ActiveBranch {
  ensureConversationTreeTable();
  const rawDb = getRawDb();

  // Verify message exists and belongs to session
  const msg = rawDb.prepare(
    "SELECT * FROM soul_conversation_tree WHERE id = ? AND session_id = ?"
  ).get(messageId, sessionId) as any;

  if (!msg) {
    throw new Error(`Message ${messageId} not found in session ${sessionId}`);
  }

  rawDb.prepare(
    "INSERT OR REPLACE INTO soul_active_branch (session_id, active_message_id) VALUES (?, ?)"
  ).run(sessionId, messageId);

  return { sessionId, activeMessageId: messageId };
}

/**
 * Get the active branch pointer for a session.
 */
export function getActiveBranch(sessionId: string): ActiveBranch | null {
  ensureConversationTreeTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_active_branch WHERE session_id = ?"
  ).get(sessionId) as any;

  if (!row) return null;
  return { sessionId: row.session_id, activeMessageId: row.active_message_id };
}

/**
 * Get messages for a session, optionally limited.
 */
export function getSessionTreeMessages(sessionId: string, limit = 50): TreeMessage[] {
  ensureConversationTreeTable();
  const rawDb = getRawDb();

  // Get active branch pointer
  const active = getActiveBranch(sessionId);
  if (!active) {
    // No active branch — return latest messages
    const rows = rawDb.prepare(
      "SELECT * FROM soul_conversation_tree WHERE session_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(sessionId, limit) as any[];
    return rows.reverse().map(mapMessage);
  }

  // Return the branch path to the active message
  const branch = getBranch(active.activeMessageId);
  return branch.slice(-limit);
}

/**
 * Format tree as text for display.
 */
export function formatTree(sessionId: string): string {
  const messages = getTree(sessionId);
  if (messages.length === 0) return "Empty conversation tree.";

  // Build adjacency map
  const childrenMap = new Map<string | "root", TreeMessage[]>();
  childrenMap.set("root", []);

  for (const msg of messages) {
    const key = msg.parentId || "root";
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(msg);
  }

  const lines: string[] = [];
  const active = getActiveBranch(sessionId);

  function renderNode(msgId: string | "root", depth: number) {
    const children = childrenMap.get(msgId) || [];
    for (const child of children) {
      const prefix = "  ".repeat(depth);
      const marker = active?.activeMessageId === child.id ? " [ACTIVE]" : "";
      const branch = children.length > 1 ? " [BRANCH]" : "";
      const preview = child.content.substring(0, 80).replace(/\n/g, " ");
      lines.push(`${prefix}${child.role}: ${preview}${marker}${branch}`);
      renderNode(child.id, depth + 1);
    }
  }

  renderNode("root", 0);
  return lines.join("\n");
}
