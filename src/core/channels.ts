/**
 * Channels Engine — Multi-platform messaging
 *
 * Learned from OpenClaw: Soul should talk to master everywhere:
 * 1. Telegram, Discord, LINE, WhatsApp (via webhooks)
 * 2. Message queue for delivery
 * 3. Channel-specific formatting
 * 4. Inbound message processing
 * 5. Stop signal detection
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface Channel {
  id: number;
  name: string;
  channelType: string; // telegram, discord, line, whatsapp, webhook
  config: string; // JSON config
  isActive: boolean;
  createdAt: string;
}

export interface Message {
  id: number;
  channelId: number;
  direction: "inbound" | "outbound";
  content: string;
  metadata: string;
  status: string;
  createdAt: string;
}

function ensureChannelTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      channel_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES soul_channels(id)
    );
  `);
}

export async function addChannel(input: {
  name: string;
  channelType: string;
  config: Record<string, any>;
}): Promise<Channel> {
  ensureChannelTables();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_channels (name, channel_type, config)
       VALUES (?, ?, ?) RETURNING *`
    )
    .get(input.name, input.channelType, JSON.stringify(input.config)) as any;

  return mapChannel(row);
}

export async function listChannels(): Promise<Channel[]> {
  ensureChannelTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare("SELECT * FROM soul_channels ORDER BY name").all() as any[];
  return rows.map(mapChannel);
}

export async function sendMessage(
  channelName: string,
  content: string,
  metadata?: Record<string, any>
): Promise<Message | null> {
  ensureChannelTables();
  const rawDb = getRawDb();

  // Find channel
  const channel = rawDb
    .prepare("SELECT * FROM soul_channels WHERE name = ? AND is_active = 1")
    .get(channelName) as any;

  if (!channel) return null;

  const config = JSON.parse(channel.config || "{}");

  // Queue the message
  const row = rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'outbound', ?, ?, 'queued') RETURNING *`
    )
    .get(
      channel.id,
      content,
      JSON.stringify(metadata || {})
    ) as any;

  // Attempt delivery based on channel type
  let deliveryStatus = "queued";

  if (channel.channel_type === "webhook" && config.url) {
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "soul",
          channel: channelName,
          content,
          timestamp: new Date().toISOString(),
          ...metadata,
        }),
        signal: AbortSignal.timeout(10000),
      });

      deliveryStatus = response.ok ? "delivered" : "failed";
    } catch {
      deliveryStatus = "failed";
    }
  } else if (channel.channel_type === "telegram" && config.botToken && config.chatId) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text: content,
            parse_mode: "Markdown",
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      deliveryStatus = response.ok ? "delivered" : "failed";
    } catch {
      deliveryStatus = "failed";
    }
  }

  // Update status
  rawDb
    .prepare("UPDATE soul_messages SET status = ? WHERE id = ?")
    .run(deliveryStatus, row.id);

  await remember({
    content: `[Message] Sent to ${channelName}: ${content.substring(0, 100)}`,
    type: "conversation",
    tags: ["message", channelName, channel.channel_type],
    source: "channels-engine",
  });

  return mapMessage({ ...row, status: deliveryStatus });
}

export async function getMessageHistory(
  channelName?: string,
  limit = 50
): Promise<Message[]> {
  ensureChannelTables();
  const rawDb = getRawDb();

  let query = "SELECT m.* FROM soul_messages m";
  const params: any[] = [];

  if (channelName) {
    query += " JOIN soul_channels c ON m.channel_id = c.id WHERE c.name = ?";
    params.push(channelName);
  }

  query += " ORDER BY m.created_at DESC LIMIT ?";
  params.push(limit);

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapMessage);
}

// ============================================
// STOP SIGNAL DETECTION
// ============================================

const STOP_WORDS = ["stop", "หยุด", "ยกเลิก", "cancel", "พอ", "quit"];

export function isStopSignal(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return STOP_WORDS.some((w) => lower === w || lower.startsWith(w + " "));
}

// ============================================
// Helpers
// ============================================

function mapChannel(row: any): Channel {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type,
    config: row.config,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    direction: row.direction,
    content: row.content,
    metadata: row.metadata,
    status: row.status,
    createdAt: row.created_at,
  };
}
