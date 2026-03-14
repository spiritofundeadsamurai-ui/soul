/**
 * Outbound Webhooks — Notify external systems on Soul events
 *
 * Events: goal_completed, error, backup_created, memory_milestone,
 *         channel_connected, daily_digest, custom
 */

import { getRawDb } from "../db/index.js";

let _tableReady = false;

function ensureWebhookTable() {
  if (_tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '*',
      secret TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_triggered TEXT,
      last_status INTEGER,
      fail_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _tableReady = true;
}

export function addWebhook(input: {
  name: string;
  url: string;
  events?: string[];
  secret?: string;
}): { success: boolean; id: number; message: string } {
  ensureWebhookTable();
  const db = getRawDb();
  const events = (input.events || ["*"]).join(",");
  const result = db.prepare(
    "INSERT INTO soul_webhooks (name, url, events, secret) VALUES (?, ?, ?, ?)"
  ).run(input.name, input.url, events, input.secret || null);
  return { success: true, id: result.lastInsertRowid as number, message: `Webhook "${input.name}" added for events: ${events}` };
}

export function listWebhooks(): Array<{
  id: number;
  name: string;
  url: string;
  events: string;
  isActive: boolean;
  lastTriggered: string | null;
  failCount: number;
}> {
  ensureWebhookTable();
  const db = getRawDb();
  const rows = db.prepare("SELECT * FROM soul_webhooks ORDER BY created_at DESC").all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    url: r.url,
    events: r.events,
    isActive: r.is_active === 1,
    lastTriggered: r.last_triggered,
    failCount: r.fail_count,
  }));
}

export function removeWebhook(id: number): boolean {
  ensureWebhookTable();
  const db = getRawDb();
  const result = db.prepare("DELETE FROM soul_webhooks WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Fire an event to all matching webhooks
 */
export async function fireWebhook(event: string, payload: Record<string, any>): Promise<number> {
  ensureWebhookTable();
  const db = getRawDb();

  const hooks = db.prepare(
    "SELECT * FROM soul_webhooks WHERE is_active = 1"
  ).all() as any[];

  let fired = 0;
  for (const hook of hooks) {
    const events = (hook.events || "*").split(",").map((e: string) => e.trim());
    if (!events.includes("*") && !events.includes(event)) continue;

    try {
      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        soul: "Soul AI",
        data: payload,
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (hook.secret) {
        const { createHmac } = await import("crypto");
        headers["X-Soul-Signature"] = createHmac("sha256", hook.secret).update(body).digest("hex");
      }

      const response = await fetch(hook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      db.prepare(
        "UPDATE soul_webhooks SET last_triggered = datetime('now'), last_status = ?, fail_count = 0 WHERE id = ?"
      ).run(response.status, hook.id);

      fired++;
    } catch (e: any) {
      const newFailCount = (hook.fail_count || 0) + 1;
      // Auto-disable after 10 consecutive failures
      const disable = newFailCount >= 10;
      db.prepare(
        "UPDATE soul_webhooks SET last_triggered = datetime('now'), last_status = 0, fail_count = ?, is_active = ? WHERE id = ?"
      ).run(newFailCount, disable ? 0 : 1, hook.id);

      if (disable) {
        console.log(`[Webhook] Disabled "${hook.name}" after ${newFailCount} failures`);
      }
    }
  }

  return fired;
}
