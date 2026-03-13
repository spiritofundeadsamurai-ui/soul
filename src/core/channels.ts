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
    } catch (e: any) {
      console.error(`[Channels] Webhook delivery failed: ${e.message}`);
      deliveryStatus = "failed";
    }
  } else if (channel.channel_type === "telegram" && config.botToken && config.chatId) {
    deliveryStatus = await telegramSend(config.botToken, config.chatId, content);
  } else if (channel.channel_type === "slack" && config.botToken && config.channelId) {
    deliveryStatus = await slackSend(config.botToken, config.channelId, content);
  } else if (channel.channel_type === "discord" && config.botToken && config.channelId) {
    deliveryStatus = await discordSend(config.botToken, config.channelId, content);
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
    // Try with Markdown first
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
    if (response.ok) return "delivered";

    // Markdown failed — retry as plain text (common with paths, special chars)
    console.error("[Telegram] Markdown send failed, retrying as plain text");
    const plainResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return plainResponse.ok ? "delivered" : "failed";
  } catch (e: any) {
    console.error(`[Telegram] Send failed: ${e.message}`);
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
const _processedMessageIds = new Set<number>(); // Dedup: track processed message IDs
const MAX_PROCESSED_IDS = 1000; // Prevent memory leak
let _processingMessage = false; // Lock to prevent concurrent processing

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

  // DB-level lock: check if another process is polling
  try {
    rawDb.exec(`CREATE TABLE IF NOT EXISTS soul_polling_lock (
      id INTEGER PRIMARY KEY DEFAULT 1,
      pid INTEGER,
      started_at TEXT,
      UNIQUE(id)
    )`);
    const lock = rawDb.prepare("SELECT * FROM soul_polling_lock WHERE id = 1").get() as any;
    if (lock) {
      // Check if the process is still alive
      try { process.kill(lock.pid, 0); /* process alive */
        return { success: false, message: `Another Soul process (PID ${lock.pid}) is already polling. Stop it first.` };
      } catch { /* process dead — take over */ }
    }
    rawDb.prepare("INSERT OR REPLACE INTO soul_polling_lock (id, pid, started_at) VALUES (1, ?, datetime('now'))").run(process.pid);
  } catch (lockErr: any) {
    console.error("[Telegram] Warning: could not acquire polling lock:", lockErr.message);
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

  // Release DB lock
  try {
    const rawDb = getRawDb();
    rawDb.prepare("DELETE FROM soul_polling_lock WHERE pid = ?").run(process.pid);
  } catch { /* ok */ }

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

        // Dedup: skip already-processed messages
        const msgId = msg.message_id;
        if (_processedMessageIds.has(msgId)) continue;
        _processedMessageIds.add(msgId);
        // Prevent memory leak — trim old IDs
        if (_processedMessageIds.size > MAX_PROCESSED_IDS) {
          const ids = Array.from(_processedMessageIds);
          ids.slice(0, ids.length - 500).forEach(id => _processedMessageIds.delete(id));
        }

        // Lock: wait if another message is being processed
        if (_processingMessage) continue;
        _processingMessage = true;

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
          _processingMessage = false;
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

          // Build conversation history from recent messages for context
          let conversationHistory: { role: string; content: string }[] = [];
          try {
            const recentMsgs = rawDb
              .prepare(
                `SELECT direction, content FROM soul_messages
                 WHERE channel_id = ? AND content IS NOT NULL AND content != ''
                 ORDER BY created_at DESC LIMIT 20`
              )
              .all(channelId) as any[];
            // Reverse to chronological order, map to role/content
            conversationHistory = recentMsgs.reverse().map((m: any) => ({
              role: m.direction === "inbound" ? "user" : "assistant",
              content: m.content,
            }));
          } catch { /* ok — no history */ }

          const result = await runAgentLoop(text, {
            systemPrompt: undefined, // Use default system prompt with full MT5/Network/Self-Dev rules
            history: conversationHistory as any[],
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

        _processingMessage = false;
      }
    } catch (err: any) {
      _processingMessage = false;
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
// SLACK — Inbound webhook + outbound via Web API
// ============================================

/** Send a message via Slack Web API (chat.postMessage) */
async function slackSend(botToken: string, channelId: string, text: string): Promise<string> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return "failed";
    const data = (await response.json()) as any;
    return data.ok ? "delivered" : "failed";
  } catch (e: any) {
    console.error(`[Slack] Send failed: ${e.message}`);
    return "failed";
  }
}

/**
 * Auto-setup Slack — give a bot token + channel, Soul configures everything:
 * 1. Validate the token with auth.test
 * 2. Register the channel
 * 3. Send a welcome message
 */
export async function slackAutoSetup(botToken: string, channelId: string, channelName?: string): Promise<{
  success: boolean;
  botName: string;
  teamName: string;
  channelName: string;
  message: string;
}> {
  // 1. Validate token
  let botName = "Soul Bot";
  let teamName = "unknown";
  try {
    const authResp = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    const authData = (await authResp.json()) as any;
    if (!authData.ok) {
      return { success: false, botName, teamName, channelName: "", message: `Slack auth failed: ${authData.error || "invalid token"}` };
    }
    botName = authData.user || "Soul Bot";
    teamName = authData.team || "unknown";
  } catch (e: any) {
    return { success: false, botName, teamName, channelName: "", message: `Slack auth failed: ${e.message}` };
  }

  const name = channelName || `slack-${teamName}`;

  // 2. Register channel
  await addChannel({
    name,
    channelType: "slack",
    config: { botToken, channelId, botName, teamName },
  });

  // 3. Remember
  await remember({
    content: `[Slack] Bot "${botName}" connected to team "${teamName}" as channel "${name}". ChannelId: ${channelId}`,
    type: "knowledge",
    tags: ["slack", "setup", "channel"],
    source: "channels-engine",
  });

  // 4. Send welcome message
  const sendStatus = await slackSend(botToken, channelId, `Soul connected to Slack! I'm now listening on this channel.`);

  return {
    success: true,
    botName,
    teamName,
    channelName: name,
    message: sendStatus === "delivered"
      ? `Bot "${botName}" connected to team "${teamName}" as channel "${name}". Welcome message sent. Set up the /api/slack/events webhook in your Slack app to receive inbound messages.`
      : `Bot "${botName}" connected to team "${teamName}" as channel "${name}". Warning: welcome message failed to send — check bot permissions (chat:write scope required).`,
  };
}

/**
 * Handle incoming Slack event payload (from /api/slack/events webhook)
 * Returns a response body to send back to Slack.
 */
export async function handleSlackEvent(payload: any): Promise<{
  statusCode: number;
  body: any;
}> {
  // URL verification challenge (Slack sends this when setting up Events API)
  if (payload.type === "url_verification") {
    return { statusCode: 200, body: { challenge: payload.challenge } };
  }

  // Event callback
  if (payload.type === "event_callback") {
    const event = payload.event;

    // Only handle message events (not bot messages or subtypes like edits)
    if (event?.type === "message" && !event.bot_id && !event.subtype) {
      const text = event.text || "";
      const userId = event.user || "unknown";
      const slackChannelId = event.channel || "";

      if (!text.trim()) {
        return { statusCode: 200, body: { ok: true } };
      }

      // Find the Soul channel matching this Slack channel
      ensureChannelTables();
      const rawDb = getRawDb();
      const channels = rawDb
        .prepare("SELECT * FROM soul_channels WHERE channel_type = 'slack' AND is_active = 1")
        .all() as any[];

      let matchedChannel: any = null;
      let config: any = {};

      for (const ch of channels) {
        const cfg = JSON.parse(ch.config || "{}");
        if (cfg.channelId === slackChannelId) {
          matchedChannel = ch;
          config = cfg;
          break;
        }
      }

      if (!matchedChannel) {
        // No matching channel configured — accept but ignore
        return { statusCode: 200, body: { ok: true } };
      }

      // Process the inbound message (non-blocking)
      processSlackInbound(matchedChannel, config, text, userId, slackChannelId).catch((err) => {
        console.error("[Slack] Inbound processing error:", err.message);
      });
    }

    return { statusCode: 200, body: { ok: true } };
  }

  return { statusCode: 200, body: { ok: true } };
}

/**
 * Process an inbound Slack message — log it, run agent loop, reply
 */
async function processSlackInbound(
  channel: any,
  config: any,
  text: string,
  userId: string,
  slackChannelId: string
) {
  const rawDb = getRawDb();

  // Check stop signal
  if (isStopSignal(text)) {
    await slackSend(config.botToken, slackChannelId, "Soul stopped listening. Send a message via soul_send to restart.");
    return;
  }

  // Log inbound message
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'inbound', ?, ?, 'received')`
    )
    .run(
      channel.id,
      text,
      JSON.stringify({ from: userId, slackChannelId })
    );

  // Process with Soul's brain
  let reply: string;
  try {
    const { runAgentLoop } = await import("./agent-loop.js");

    // Build conversation history
    let conversationHistory: { role: string; content: string }[] = [];
    try {
      const recentMsgs = rawDb
        .prepare(
          `SELECT direction, content FROM soul_messages
           WHERE channel_id = ? AND content IS NOT NULL AND content != ''
           ORDER BY created_at DESC LIMIT 20`
        )
        .all(channel.id) as any[];
      conversationHistory = recentMsgs.reverse().map((m: any) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content,
      }));
    } catch { /* ok */ }

    const result = await runAgentLoop(text, {
      systemPrompt: `You are Soul v${SOUL_VERSION}, an AI companion responding via Slack to user ${userId}.
RULES:
1. When user writes in Thai → ALWAYS reply in Thai. NEVER switch to English.
2. Keep responses concise (1-3 paragraphs max).
3. You have 308 tools — you CAN read files, manage things, search, remember, etc. NEVER say "ทำไม่ได้".
4. NEVER output <think> tags, internal reasoning, or duplicate responses.
5. Send ONE reply only. Do not repeat yourself.
6. Use Slack-friendly formatting (bold with *text*, code with \`code\`).`,
      history: conversationHistory as any[],
      maxIterations: 5,
    });
    reply = result.reply || "Sorry, I couldn't process that.";
  } catch (err: any) {
    reply = `Error: ${err.message?.substring(0, 100) || "unknown"}`;
  }

  // Strip <think>...</think> tags
  reply = reply.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  if (!reply) reply = "Got it.";

  // Send reply
  const status = await slackSend(config.botToken, slackChannelId, reply);

  // Log outbound
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'outbound', ?, ?, ?)`
    )
    .run(
      channel.id,
      reply,
      JSON.stringify({ slackChannelId, inReplyToUser: userId }),
      status
    );

  await remember({
    content: `[Slack] User ${userId}: "${text.substring(0, 80)}" → Soul: "${reply.substring(0, 80)}"`,
    type: "conversation",
    tags: ["slack", "chat", channel.name],
    source: "slack-webhook",
  });
}

// ============================================
// DISCORD — Inbound interactions webhook + outbound via Bot API
// ============================================

/** Send a message via Discord Bot API */
async function discordSend(botToken: string, channelId: string, content: string): Promise<string> {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return response.ok ? "delivered" : "failed";
  } catch (e: any) {
    console.error(`[Discord] Send failed: ${e.message}`);
    return "failed";
  }
}

/**
 * Auto-setup Discord — give a bot token + channel/guild, Soul configures everything:
 * 1. Validate the token with /users/@me
 * 2. Register the channel
 * 3. Send a welcome message
 */
export async function discordAutoSetup(botToken: string, channelId: string, guildId?: string, channelName?: string): Promise<{
  success: boolean;
  botName: string;
  botUsername: string;
  channelName: string;
  message: string;
}> {
  // 1. Validate token
  let botName = "Soul Bot";
  let botUsername = "soul_bot";
  try {
    const meResp = await fetch("https://discord.com/api/v10/users/@me", {
      method: "GET",
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!meResp.ok) {
      return { success: false, botName, botUsername, channelName: "", message: `Discord auth failed (${meResp.status}). Check your bot token.` };
    }
    const me = (await meResp.json()) as any;
    botName = me.global_name || me.username || "Soul Bot";
    botUsername = me.username || "soul_bot";
  } catch (e: any) {
    return { success: false, botName, botUsername, channelName: "", message: `Discord auth failed: ${e.message}` };
  }

  const name = channelName || `discord-${botUsername}`;

  // 2. Register channel
  await addChannel({
    name,
    channelType: "discord",
    config: { botToken, channelId, guildId: guildId || "", botName, botUsername },
  });

  // 3. Remember
  await remember({
    content: `[Discord] Bot "${botName}" (@${botUsername}) connected as channel "${name}". ChannelId: ${channelId}`,
    type: "knowledge",
    tags: ["discord", "setup", "channel"],
    source: "channels-engine",
  });

  // 4. Send welcome message
  const sendStatus = await discordSend(botToken, channelId, `Soul connected to Discord! I'm now listening on this channel.`);

  return {
    success: true,
    botName,
    botUsername,
    channelName: name,
    message: sendStatus === "delivered"
      ? `Bot "${botName}" (@${botUsername}) connected as channel "${name}". Welcome message sent. Set up the /api/discord/interactions webhook in your Discord app to receive inbound messages.`
      : `Bot "${botName}" (@${botUsername}) connected as channel "${name}". Warning: welcome message failed — check bot permissions.`,
  };
}

/**
 * Handle incoming Discord interactions payload (from /api/discord/interactions webhook)
 * Returns a response body to send back to Discord.
 */
export async function handleDiscordInteraction(payload: any): Promise<{
  statusCode: number;
  body: any;
}> {
  // PING — Discord verification (type 1)
  if (payload.type === 1) {
    return { statusCode: 200, body: { type: 1 } };
  }

  // APPLICATION_COMMAND (type 2) — slash commands
  if (payload.type === 2) {
    const commandName = payload.data?.name || "";
    const userId = payload.member?.user?.id || payload.user?.id || "unknown";
    const userName = payload.member?.user?.username || payload.user?.username || "User";
    const discordChannelId = payload.channel_id || "";

    // Extract the text input from command options
    let text = "";
    if (payload.data?.options?.length > 0) {
      const msgOption = payload.data.options.find((o: any) => o.name === "message" || o.name === "text" || o.name === "input");
      text = msgOption?.value || payload.data.options[0]?.value || "";
    }

    if (!text) {
      return {
        statusCode: 200,
        body: {
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: { content: "Please provide a message. Usage: /soul message:your question here" },
        },
      };
    }

    // Acknowledge immediately with deferred response (type 5)
    // Then follow up with the real reply asynchronously
    processDiscordCommand(discordChannelId, text, userId, userName, payload.token).catch((err) => {
      console.error("[Discord] Command processing error:", err.message);
    });

    return {
      statusCode: 200,
      body: {
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        data: { content: "Soul is thinking..." },
      },
    };
  }

  // MESSAGE_COMPONENT (type 3) — button/select interactions
  // Not implemented yet, acknowledge
  if (payload.type === 3) {
    return {
      statusCode: 200,
      body: { type: 6 }, // DEFERRED_UPDATE_MESSAGE
    };
  }

  return { statusCode: 200, body: { type: 1 } };
}

/**
 * Process a Discord slash command — run agent loop, send follow-up
 */
async function processDiscordCommand(
  discordChannelId: string,
  text: string,
  userId: string,
  userName: string,
  interactionToken: string
) {
  // Find the matching Soul channel
  ensureChannelTables();
  const rawDb = getRawDb();
  const channels = rawDb
    .prepare("SELECT * FROM soul_channels WHERE channel_type = 'discord' AND is_active = 1")
    .all() as any[];

  let matchedChannel: any = null;
  let config: any = {};

  for (const ch of channels) {
    const cfg = JSON.parse(ch.config || "{}");
    if (cfg.channelId === discordChannelId) {
      matchedChannel = ch;
      config = cfg;
      break;
    }
  }

  // If no channel matches, use the first active Discord channel for sending
  if (!matchedChannel && channels.length > 0) {
    matchedChannel = channels[0];
    config = JSON.parse(matchedChannel.config || "{}");
  }

  const channelId = matchedChannel?.id || 0;

  // Log inbound
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'inbound', ?, ?, 'received')`
    )
    .run(
      channelId,
      text,
      JSON.stringify({ from: userName, userId, discordChannelId })
    );

  // Process with Soul's brain
  let reply: string;
  try {
    const { runAgentLoop } = await import("./agent-loop.js");

    let conversationHistory: { role: string; content: string }[] = [];
    if (channelId) {
      try {
        const recentMsgs = rawDb
          .prepare(
            `SELECT direction, content FROM soul_messages
             WHERE channel_id = ? AND content IS NOT NULL AND content != ''
             ORDER BY created_at DESC LIMIT 20`
          )
          .all(channelId) as any[];
        conversationHistory = recentMsgs.reverse().map((m: any) => ({
          role: m.direction === "inbound" ? "user" : "assistant",
          content: m.content,
        }));
      } catch { /* ok */ }
    }

    const result = await runAgentLoop(text, {
      systemPrompt: `You are Soul v${SOUL_VERSION}, an AI companion responding via Discord to ${userName}.
RULES:
1. When user writes in Thai → ALWAYS reply in Thai. NEVER switch to English.
2. Keep responses concise (1-3 paragraphs max). Discord has a 2000 char limit per message.
3. You have 308 tools — you CAN read files, manage things, search, remember, etc. NEVER say "ทำไม่ได้".
4. NEVER output <think> tags, internal reasoning, or duplicate responses.
5. Send ONE reply only. Do not repeat yourself.
6. Use Discord-friendly formatting (**bold**, \`code\`, \`\`\`codeblocks\`\`\`).`,
      history: conversationHistory as any[],
      maxIterations: 5,
    });
    reply = result.reply || "Sorry, I couldn't process that.";
  } catch (err: any) {
    reply = `Error: ${err.message?.substring(0, 100) || "unknown"}`;
  }

  // Strip <think>...</think> tags
  reply = reply.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  if (!reply) reply = "Got it.";

  // Truncate to Discord's 2000 char limit
  if (reply.length > 2000) {
    reply = reply.substring(0, 1997) + "...";
  }

  // Send follow-up response to the interaction
  try {
    // Get app ID from the channel config or fetch it
    let appId = config.applicationId || "";
    if (!appId && config.botToken) {
      try {
        const meResp = await fetch("https://discord.com/api/v10/users/@me", {
          method: "GET",
          headers: { Authorization: `Bot ${config.botToken}` },
          signal: AbortSignal.timeout(10000),
        });
        const me = (await meResp.json()) as any;
        appId = me.id || "";
        // Cache it in config
        if (appId && matchedChannel) {
          config.applicationId = appId;
          rawDb
            .prepare("UPDATE soul_channels SET config = ? WHERE id = ?")
            .run(JSON.stringify(config), matchedChannel.id);
        }
      } catch { /* ok */ }
    }

    if (appId) {
      await fetch(
        `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: reply }),
          signal: AbortSignal.timeout(10000),
        }
      );
    }
  } catch (e: any) {
    console.error("[Discord] Follow-up failed:", e.message);
    // Fallback: send as regular message
    if (config.botToken && discordChannelId) {
      await discordSend(config.botToken, discordChannelId, reply);
    }
  }

  // Log outbound
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'outbound', ?, ?, 'delivered')`
    )
    .run(
      channelId,
      reply,
      JSON.stringify({ discordChannelId, inReplyToUser: userId })
    );

  await remember({
    content: `[Discord] ${userName}: "${text.substring(0, 80)}" → Soul: "${reply.substring(0, 80)}"`,
    type: "conversation",
    tags: ["discord", "chat", matchedChannel?.name || "discord"],
    source: "discord-webhook",
  });
}

/**
 * Handle incoming Discord gateway-style message events
 * This is for the POST /api/discord/message endpoint (simpler alternative to interactions)
 */
export async function handleDiscordMessage(payload: {
  content: string;
  author: string;
  channelId: string;
}): Promise<{ reply: string; status: string }> {
  const { content: text, author, channelId: discordChannelId } = payload;

  if (!text?.trim()) {
    return { reply: "", status: "empty" };
  }

  // Find matching channel
  ensureChannelTables();
  const rawDb = getRawDb();
  const channels = rawDb
    .prepare("SELECT * FROM soul_channels WHERE channel_type = 'discord' AND is_active = 1")
    .all() as any[];

  let matchedChannel: any = null;
  let config: any = {};

  for (const ch of channels) {
    const cfg = JSON.parse(ch.config || "{}");
    if (cfg.channelId === discordChannelId) {
      matchedChannel = ch;
      config = cfg;
      break;
    }
  }

  if (!matchedChannel) {
    return { reply: "No Discord channel configured for this channel ID.", status: "no_channel" };
  }

  if (isStopSignal(text)) {
    return { reply: "Soul stopped listening.", status: "stopped" };
  }

  // Log inbound
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'inbound', ?, ?, 'received')`
    )
    .run(matchedChannel.id, text, JSON.stringify({ from: author, discordChannelId }));

  // Process with agent loop
  let reply: string;
  try {
    const { runAgentLoop } = await import("./agent-loop.js");

    let conversationHistory: { role: string; content: string }[] = [];
    try {
      const recentMsgs = rawDb
        .prepare(
          `SELECT direction, content FROM soul_messages
           WHERE channel_id = ? AND content IS NOT NULL AND content != ''
           ORDER BY created_at DESC LIMIT 20`
        )
        .all(matchedChannel.id) as any[];
      conversationHistory = recentMsgs.reverse().map((m: any) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content,
      }));
    } catch { /* ok */ }

    const result = await runAgentLoop(text, {
      systemPrompt: `You are Soul v${SOUL_VERSION}, an AI companion responding via Discord to ${author}.
RULES:
1. When user writes in Thai → ALWAYS reply in Thai. NEVER switch to English.
2. Keep responses concise (1-3 paragraphs max). Discord has a 2000 char limit.
3. You have 308 tools. NEVER say "ทำไม่ได้".
4. NEVER output <think> tags. Send ONE reply only.`,
      history: conversationHistory as any[],
      maxIterations: 5,
    });
    reply = result.reply || "Sorry, I couldn't process that.";
  } catch (err: any) {
    reply = `Error: ${err.message?.substring(0, 100) || "unknown"}`;
  }

  reply = reply.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  if (!reply) reply = "Got it.";
  if (reply.length > 2000) reply = reply.substring(0, 1997) + "...";

  // Send reply via Discord API
  const status = config.botToken
    ? await discordSend(config.botToken, discordChannelId, reply)
    : "no_token";

  // Log outbound
  rawDb
    .prepare(
      `INSERT INTO soul_messages (channel_id, direction, content, metadata, status)
       VALUES (?, 'outbound', ?, ?, ?)`
    )
    .run(matchedChannel.id, reply, JSON.stringify({ discordChannelId, inReplyTo: author }), status);

  await remember({
    content: `[Discord] ${author}: "${text.substring(0, 80)}" → Soul: "${reply.substring(0, 80)}"`,
    type: "conversation",
    tags: ["discord", "chat", matchedChannel.name],
    source: "discord-message",
  });

  return { reply, status };
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
