/**
 * Channels Engine — Multi-platform messaging with REAL Telegram integration
 *
 * Features:
 * 1. Telegram Bot — full bidirectional (send + receive via polling)
 * 2. Discord, webhook, custom channels
 * 3. Message queue with delivery tracking
 * 4. Auto-setup: give token → Soul configures everything
 * 5. Inbound message → Soul thinks → auto-reply
 * 6. Stop signal detection
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let SOUL_VERSION = "1.9.1";
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
  SOUL_VERSION = pkg.version || SOUL_VERSION;
} catch { /* ok */ }

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

  // Check if channel already exists — update config if so
  const existing = rawDb
    .prepare("SELECT * FROM soul_channels WHERE name = ?")
    .get(input.name) as any;

  if (existing) {
    rawDb
      .prepare("UPDATE soul_channels SET config = ?, is_active = 1 WHERE name = ?")
      .run(JSON.stringify(input.config), input.name);
    return mapChannel({ ...existing, config: JSON.stringify(input.config), is_active: 1 });
  }

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
    deliveryStatus = await telegramSend(config.botToken, config.chatId, content);
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
// TELEGRAM — Full bidirectional integration
// ============================================

/** Send a message via Telegram Bot API */
async function telegramSend(botToken: string, chatId: string, text: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return response.ok ? "delivered" : "failed";
  } catch {
    return "failed";
  }
}

/** Call any Telegram Bot API method */
async function telegramAPI(botToken: string, method: string, params?: Record<string, any>): Promise<any> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API ${method} failed: ${response.status} — ${text}`);
  }

  const data = await response.json() as any;
  if (!data.ok) {
    throw new Error(`Telegram API ${method} error: ${data.description || "unknown"}`);
  }

  return data.result;
}

/**
 * Auto-setup Telegram — Just give a bot token, Soul does everything:
 * 1. Validate the token with getMe
 * 2. Get bot info (name, username)
 * 3. Register the channel
 * 4. Start polling for messages
 */
export async function telegramAutoSetup(botToken: string, channelName?: string): Promise<{
  success: boolean;
  botName: string;
  botUsername: string;
  channelName: string;
  message: string;
  waitingForChat: boolean;
}> {
  // 1. Validate token
  const me = await telegramAPI(botToken, "getMe");
  const botName = me.first_name || "Soul Bot";
  const botUsername = me.username || "soul_bot";
  const name = channelName || `telegram-${botUsername}`;

  // 2. Try to get chatId from recent messages
  let chatId: string | null = null;
  try {
    const updates = await telegramAPI(botToken, "getUpdates", { limit: 1, timeout: 0 });
    if (updates && updates.length > 0) {
      const msg = updates[0].message || updates[0].my_chat_member;
      if (msg?.chat?.id) {
        chatId = String(msg.chat.id);
      }
    }
  } catch { /* no messages yet */ }

  // 3. Register channel
  const config: Record<string, any> = {
    botToken,
    botName,
    botUsername,
  };
  if (chatId) {
    config.chatId = chatId;
  }

  await addChannel({ name, channelType: "telegram", config });

  // 4. Remember this
  await remember({
    content: `[Telegram] Bot @${botUsername} (${botName}) connected as channel "${name}".${chatId ? ` ChatId: ${chatId}` : " Waiting for first message to detect chatId."}`,
    type: "knowledge",
    tags: ["telegram", "setup", "channel"],
    source: "channels-engine",
  });

  // 5. If no chatId yet, wait briefly for user to send first message
  if (!chatId) {
    // Poll for up to 15 seconds waiting for user's first message
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const updates = await telegramAPI(botToken, "getUpdates", { limit: 1, timeout: 5 });
        if (updates && updates.length > 0) {
          const msg = updates[0].message || updates[0].my_chat_member;
          if (msg?.chat?.id) {
            chatId = String(msg.chat.id);
            config.chatId = chatId;
            // Update channel config with chatId
            ensureChannelTables();
            const rawDb = getRawDb();
            rawDb
              .prepare("UPDATE soul_channels SET config = ? WHERE name = ?")
              .run(JSON.stringify(config), name);
            break;
          }
        }
      } catch { /* continue waiting */ }
    }
  }

  if (chatId) {
    // Send welcome message
    await telegramSend(botToken, chatId, `✨ Soul connected! I'm now listening on Telegram.\n\nSend me any message and I'll respond.`);

    // 6. Auto-start polling — Soul handles everything
    startTelegramPolling(name).catch(() => { /* non-blocking */ });
  }

  return {
    success: true,
    botName,
    botUsername,
    channelName: name,
    message: chatId
      ? `Bot @${botUsername} connected and listening! ChatId: ${chatId}. Soul is now auto-replying on Telegram.`
      : `Bot @${botUsername} validated! Send any message to @${botUsername} on Telegram, then tell Soul "ฟัง telegram" to start auto-reply.`,
    waitingForChat: !chatId,
  };
}

// ─── Telegram Polling State ───

let _pollingActive = false;
let _pollingAbort: AbortController | null = null;
let _pollingOffset = 0;

/**
 * Start Telegram polling — receive messages and auto-reply via Soul's brain
 */
export async function startTelegramPolling(channelName: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (_pollingActive) {
    return { success: false, message: "Telegram polling is already running." };
  }

  ensureChannelTables();
  const rawDb = getRawDb();

  const channel = rawDb
    .prepare("SELECT * FROM soul_channels WHERE name = ? AND channel_type = 'telegram' AND is_active = 1")
    .get(channelName) as any;

  if (!channel) {
    return { success: false, message: `Channel "${channelName}" not found or not a Telegram channel.` };
  }

  const config = JSON.parse(channel.config || "{}");
  if (!config.botToken) {
    return { success: false, message: "No botToken in channel config." };
  }

  _pollingActive = true;
  _pollingAbort = new AbortController();

  // Run polling in background
  pollTelegramLoop(channel.id, channelName, config.botToken, config).catch((err) => {
    if (process.env.DEBUG) console.error("[Telegram] Polling error:", err.message);
    _pollingActive = false;
  });

  return { success: true, message: `Telegram polling started for "${channelName}". Soul will auto-reply to messages.` };
}

/**
 * Stop Telegram polling
 */
export function stopTelegramPolling(): { success: boolean; message: string } {
  if (!_pollingActive) {
    return { success: false, message: "Telegram polling is not running." };
  }

  _pollingAbort?.abort();
  _pollingActive = false;
  _pollingAbort = null;

  return { success: true, message: "Telegram polling stopped." };
}

/**
 * Get Telegram polling status
 */
export function getTelegramPollingStatus(): {
  active: boolean;
  offset: number;
} {
  return {
    active: _pollingActive,
    offset: _pollingOffset,
  };
}

/**
 * Internal polling loop — long-poll Telegram getUpdates
 */
async function pollTelegramLoop(
  channelId: number,
  channelName: string,
  botToken: string,
  config: Record<string, any>
) {
  while (_pollingActive) {
    try {
      const updates = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset: _pollingOffset,
            timeout: 30,  // Long poll — wait up to 30s for new messages
            allowed_updates: ["message"],
          }),
          signal: _pollingAbort?.signal,
        }
      );

      if (!updates.ok) {
        // Wait before retrying on error
        await sleep(5000);
        continue;
      }

      const data = await updates.json() as any;
      if (!data.ok || !data.result?.length) continue;

      for (const update of data.result) {
        _pollingOffset = update.update_id + 1;

        const msg = update.message;
        if (!msg?.text) continue;

        const chatId = String(msg.chat.id);
        const fromName = msg.from?.first_name || "User";
        const text = msg.text;

        // Auto-save chatId if we didn't have it
        if (!config.chatId) {
          config.chatId = chatId;
          const rawDb = getRawDb();
          rawDb
            .prepare("UPDATE soul_channels SET config = ? WHERE id = ?")
            .run(JSON.stringify(config), channelId);
        }

        // Skip bot commands that are just /start
        if (text === "/start") {
          await telegramSend(botToken, chatId, `สวัสดีครับ! ผม Soul — AI companion ของคุณ 🌟\n\nส่งข้อความมาได้เลย ผมพร้อมช่วยเสมอ!`);
          continue;
        }

        // Log inbound message
        const rawDb = getRawDb();
        rawDb
          .prepare(
            `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
             VALUES (?, 'inbound', ?, ?, 'received')`
          )
          .run(
            channelId,
            text,
            JSON.stringify({ from: fromName, chatId, messageId: msg.message_id })
          );

        // Process with Soul's brain
        let reply: string;
        try {
          const { runAgentLoop } = await import("./agent-loop.js");
          const result = await runAgentLoop(text, {
            systemPrompt: `You are Soul v${SOUL_VERSION || "1.9.1"}, an AI companion responding via Telegram to ${fromName}.
RULES:
1. When user writes in Thai → ALWAYS reply in Thai. NEVER switch to English.
2. Keep responses concise (1-3 paragraphs max).
3. You have 308 tools — you CAN read files, manage things, search, remember, etc. NEVER say "ทำไม่ได้".
4. NEVER output <think> tags, internal reasoning, or duplicate responses.
5. Send ONE reply only. Do not repeat yourself.`,
            maxIterations: 5,
          });
          reply = result.reply || "ขอโทษครับ ไม่สามารถประมวลผลได้";
        } catch (err: any) {
          reply = `ขอโทษครับ เกิดข้อผิดพลาด: ${err.message?.substring(0, 100) || "unknown"}`;
        }

        // Strip <think>...</think> tags (Qwen3 thinking output)
        reply = reply.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
        if (!reply) reply = "ได้เลยครับ";

        // Send reply
        const status = await telegramSend(botToken, chatId, reply);

        // Log outbound
        rawDb
          .prepare(
            `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
             VALUES (?, 'outbound', ?, ?, ?)`
          )
          .run(
            channelId,
            reply,
            JSON.stringify({ chatId, inReplyTo: msg.message_id }),
            status
          );

        await remember({
          content: `[Telegram] ${fromName}: "${text.substring(0, 80)}" → Soul: "${reply.substring(0, 80)}"`,
          type: "conversation",
          tags: ["telegram", "chat", channelName],
          source: "telegram-polling",
        });
      }
    } catch (err: any) {
      if (err.name === "AbortError") break; // Graceful stop
      if (process.env.DEBUG) console.error("[Telegram] Poll error:", err.message);
      await sleep(3000);
    }
  }

  _pollingActive = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SELF-UPDATE — Soul can update itself
// ============================================

export async function selfUpdate(): Promise<{
  success: boolean;
  currentVersion: string;
  latestVersion: string;
  updated: boolean;
  message: string;
}> {
  const { execSync } = await import("child_process");

  // Get current version
  let currentVersion = "unknown";
  try {
    const pkg = execSync("npm list -g soul-ai --json 2>/dev/null", { encoding: "utf-8" });
    const parsed = JSON.parse(pkg);
    currentVersion = parsed.dependencies?.["soul-ai"]?.version || "unknown";
  } catch {
    try {
      currentVersion = execSync("npm show soul-ai version", { encoding: "utf-8" }).trim();
    } catch { /* ok */ }
  }

  // Get latest version from npm
  let latestVersion = currentVersion;
  try {
    latestVersion = execSync("npm show soul-ai version", { encoding: "utf-8" }).trim();
  } catch {
    return {
      success: false,
      currentVersion,
      latestVersion,
      updated: false,
      message: "Cannot check npm for latest version. Check your internet connection.",
    };
  }

  // Compare
  if (currentVersion === latestVersion) {
    return {
      success: true,
      currentVersion,
      latestVersion,
      updated: false,
      message: `Soul is already at the latest version (${currentVersion}).`,
    };
  }

  // Update
  try {
    execSync("npm install -g soul-ai@latest", {
      encoding: "utf-8",
      timeout: 120000, // 2 min timeout
      stdio: "pipe",
    });

    // Verify
    let newVersion = latestVersion;
    try {
      const pkg = execSync("npm list -g soul-ai --json 2>/dev/null", { encoding: "utf-8" });
      const parsed = JSON.parse(pkg);
      newVersion = parsed.dependencies?.["soul-ai"]?.version || latestVersion;
    } catch { /* ok */ }

    await remember({
      content: `[Self-Update] Soul updated from v${currentVersion} to v${newVersion}`,
      type: "knowledge",
      tags: ["update", "self-update", "version"],
      source: "self-update",
    });

    return {
      success: true,
      currentVersion,
      latestVersion: newVersion,
      updated: true,
      message: `Soul updated! ${currentVersion} → ${newVersion}. Restart Soul to use the new version.`,
    };
  } catch (err: any) {
    return {
      success: false,
      currentVersion,
      latestVersion,
      updated: false,
      message: `Update failed: ${err.message?.substring(0, 200) || "unknown error"}`,
    };
  }
}

/**
 * Check if an update is available without installing
 */
export async function checkForUpdate(): Promise<{
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}> {
  const { execSync } = await import("child_process");

  let currentVersion = "unknown";
  try {
    const output = execSync("npm list -g soul-ai --depth=0 2>/dev/null", { encoding: "utf-8" });
    const match = output.match(/soul-ai@(\S+)/);
    if (match) currentVersion = match[1];
  } catch { /* ok */ }

  let latestVersion = currentVersion;
  try {
    latestVersion = execSync("npm show soul-ai version", { encoding: "utf-8" }).trim();
  } catch { /* ok */ }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: currentVersion !== latestVersion && currentVersion !== "unknown",
  };
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
