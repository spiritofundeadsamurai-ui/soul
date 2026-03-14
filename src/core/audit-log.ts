/**
 * Audit Log — Track all significant actions
 *
 * Records who did what, when, and the result.
 * Queryable via API and agent tools.
 */

import { getRawDb } from "../db/index.js";

let _tableReady = false;

function ensureAuditTable() {
  if (_tableReady) return;
  const db = getRawDb();
  // Use a separate table name to avoid conflict with existing soul_audit_v2
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_audit_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      actor TEXT NOT NULL DEFAULT 'system',
      detail TEXT,
      ip TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _tableReady = true;
}

export function logAudit(input: {
  action: string;
  category?: string;
  actor?: string;
  detail?: string;
  ip?: string;
  success?: boolean;
}) {
  ensureAuditTable();
  const db = getRawDb();
  try {
    db.prepare(`
      INSERT INTO soul_audit_v2 (action, category, actor, detail, ip, success)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.action,
      input.category || "general",
      input.actor || "system",
      input.detail || null,
      input.ip || null,
      input.success !== false ? 1 : 0,
    );
  } catch { /* don't break on audit failures */ }
}

export function getAuditLog(options?: {
  limit?: number;
  category?: string;
  actor?: string;
  since?: string;
}): Array<{
  id: number;
  action: string;
  category: string;
  actor: string;
  detail: string | null;
  ip: string | null;
  success: boolean;
  createdAt: string;
}> {
  ensureAuditTable();
  const db = getRawDb();
  const limit = options?.limit || 50;

  let query = "SELECT * FROM soul_audit_v2 WHERE 1=1";
  const params: any[] = [];

  if (options?.category) { query += " AND category = ?"; params.push(options.category); }
  if (options?.actor) { query += " AND actor = ?"; params.push(options.actor); }
  if (options?.since) { query += " AND created_at > ?"; params.push(options.since); }

  query += " ORDER BY id DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    category: r.category,
    actor: r.actor,
    detail: r.detail,
    ip: r.ip,
    success: r.success === 1,
    createdAt: r.created_at,
  }));
}

export function getAuditStats(): {
  total: number;
  today: number;
  categories: Record<string, number>;
} {
  ensureAuditTable();
  const db = getRawDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM soul_audit_v2").get() as any)?.c || 0;
  const today = (db.prepare("SELECT COUNT(*) as c FROM soul_audit_v2 WHERE created_at > datetime('now', '-24 hours')").get() as any)?.c || 0;

  const cats = db.prepare(`
    SELECT category, COUNT(*) as c FROM soul_audit_v2
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY category ORDER BY c DESC LIMIT 10
  `).all() as any[];

  const categories: Record<string, number> = {};
  for (const cat of cats) categories[cat.category] = cat.c;

  return { total, today, categories };
}
