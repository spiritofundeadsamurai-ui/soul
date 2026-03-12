import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addChannel,
  listChannels,
  sendMessage,
  getMessageHistory,
  telegramAutoSetup,
  startTelegramPolling,
  stopTelegramPolling,
  getTelegramPollingStatus,
  slackAutoSetup,
  discordAutoSetup,
  selfUpdate,
  checkForUpdate,
} from "../core/channels.js";

export function registerChannelTools(server: McpServer) {
  // ─── Universal Connect — Soul sets up ANY integration ───
  server.tool(
    "soul_connect",
    "Connect Soul to ANY service — Telegram, Discord, LLM, webhook, etc. Just give the service name and credentials, Soul handles the rest. Examples: soul_connect('telegram', {botToken:'...'}), soul_connect('discord', {webhookUrl:'...'}), soul_connect('ollama', {host:'...'})",
    {
      service: z
        .string()
        .describe("Service to connect: telegram, discord, webhook, ollama, openai, groq, deepseek, gemini, together, custom"),
      credentials: z
        .string()
        .describe("JSON with credentials — e.g. {\"botToken\":\"123\"} for Telegram, {\"webhookUrl\":\"...\"} for Discord, {\"apiKey\":\"...\"} for LLMs"),
      name: z
        .string()
        .optional()
        .describe("Custom name for this connection (auto-generated if omitted)"),
    },
    async ({ service, credentials, name }) => {
      try {
        const creds = JSON.parse(credentials);
        const svc = service.toLowerCase().trim();

        // ─── Telegram ───
        if (svc === "telegram" || svc === "tg") {
          const token = creds.botToken || creds.token || creds.bot_token;
          if (!token) {
            return text("Telegram needs a botToken. Get one from @BotFather on Telegram.\nUsage: {\"botToken\": \"123456:ABC-DEF\"}");
          }
          const result = await telegramAutoSetup(token, name);
          if (!result.success) {
            return text(`Telegram setup failed: ${result.message}`);
          }
          return text(
            `✅ Telegram connected!\n\n` +
            `Bot: @${result.botUsername} (${result.botName})\n` +
            `Channel: "${result.channelName}"\n` +
            (result.waitingForChat
              ? `\n⚠️ Send a message to @${result.botUsername} on Telegram first, then use soul_telegram_listen to start receiving messages.`
              : `\nReady to send and receive! Use soul_telegram_listen("${result.channelName}") to auto-reply.`)
          );
        }

        // ─── Slack ───
        if (svc === "slack") {
          const botToken = creds.botToken || creds.bot_token || creds.token;
          const channelId = creds.channelId || creds.channel_id || creds.channel;
          if (!botToken) {
            return text("Slack needs a botToken (Bot User OAuth Token starting with xoxb-).\nGet one: api.slack.com → Your Apps → OAuth & Permissions → Bot User OAuth Token\nUsage: {\"botToken\": \"xoxb-...\", \"channelId\": \"C01234567\"}");
          }
          if (!channelId) {
            return text("Slack needs a channelId.\nRight-click a channel → View channel details → copy the Channel ID at the bottom.\nUsage: {\"botToken\": \"xoxb-...\", \"channelId\": \"C01234567\"}");
          }
          const result = await slackAutoSetup(botToken, channelId, name);
          if (!result.success) {
            return text(`Slack setup failed: ${result.message}`);
          }
          return text(
            `✅ Slack connected!\n\n` +
            `Bot: ${result.botName}\n` +
            `Team: ${result.teamName}\n` +
            `Channel: "${result.channelName}"\n\n` +
            `To receive inbound messages, add this URL as your Slack Events webhook:\n` +
            `  POST http://<your-soul-host>:47779/api/slack/events\n\n` +
            `Required Slack app scopes: chat:write, channels:history, app_mentions:read\n` +
            `Subscribe to bot events: message.channels, message.im`
          );
        }

        // ─── Discord ───
        if (svc === "discord") {
          const botToken = creds.botToken || creds.bot_token;
          const channelId = creds.channelId || creds.channel_id || creds.channel;
          const guildId = creds.guildId || creds.guild_id || creds.guild;

          // If botToken is provided, use full bot integration
          if (botToken && channelId) {
            const result = await discordAutoSetup(botToken, channelId, guildId, name);
            if (!result.success) {
              return text(`Discord setup failed: ${result.message}`);
            }
            return text(
              `✅ Discord connected!\n\n` +
              `Bot: ${result.botName} (@${result.botUsername})\n` +
              `Channel: "${result.channelName}"\n\n` +
              `To receive inbound messages, add this URL as your Discord Interactions endpoint:\n` +
              `  POST http://<your-soul-host>:47779/api/discord/interactions\n\n` +
              `Or for simpler bot integration, POST messages to:\n` +
              `  POST http://<your-soul-host>:47779/api/discord/message\n` +
              `  Body: {"content":"message","author":"user","channelId":"${channelId}"}`
            );
          }

          // Fallback to webhook-only (outbound only)
          const webhookUrl = creds.webhookUrl || creds.webhook_url || creds.url;
          if (!webhookUrl && !botToken) {
            return text("Discord needs either:\n1. Bot token + channel ID (full bidirectional): {\"botToken\": \"...\", \"channelId\": \"...\"}\n2. Webhook URL (outbound only): {\"webhookUrl\": \"https://discord.com/api/webhooks/...\"}");
          }
          if (webhookUrl) {
            const channelName = name || "discord";
            await addChannel({
              name: channelName,
              channelType: "discord",
              config: { webhookUrl, ...creds },
            });
            try {
              const testResp = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: "Soul connected to Discord!" }),
                signal: AbortSignal.timeout(10000),
              });
              return text(
                `✅ Discord connected (webhook-only, outbound)!\n\nChannel: "${channelName}"\nWebhook: ${testResp.ok ? "Working" : "Failed to send test message"}\n\nUse soul_send("${channelName}", "message") to send.\nFor bidirectional, use botToken + channelId instead.`
              );
            } catch {
              return text(`✅ Discord channel "${channelName}" saved, but test message failed. Check the webhook URL.`);
            }
          }
          return text("Discord needs a channelId with the botToken.\nUsage: {\"botToken\": \"...\", \"channelId\": \"...\"}");
        }

        // ─── Webhook (generic) ───
        if (svc === "webhook" || svc === "custom") {
          const url = creds.url || creds.webhookUrl;
          if (!url) {
            return text("Webhook needs a URL.\nUsage: {\"url\": \"https://your-server.com/webhook\"}");
          }
          const channelName = name || "webhook";
          await addChannel({
            name: channelName,
            channelType: "webhook",
            config: { url, ...creds },
          });
          return text(`✅ Webhook connected!\n\nChannel: "${channelName}"\nURL: ${url}\n\nUse soul_send("${channelName}", "message") to send.`);
        }

        // ─── LLM Providers ───
        const llmProviders: Record<string, string> = {
          ollama: "ollama",
          openai: "openai",
          groq: "groq",
          deepseek: "deepseek",
          gemini: "gemini",
          together: "together",
          anthropic: "anthropic",
          claude: "anthropic",
          openrouter: "openrouter",
        };

        if (svc in llmProviders) {
          try {
            const { addProvider, getProviderPresets } = await import("../core/llm-connector.js");
            const providerId = llmProviders[svc];
            const presets = getProviderPresets();
            const preset = presets[providerId];

            if (!preset) {
              return text(`Unknown LLM provider "${svc}". Available: ${Object.keys(presets).join(", ")}`);
            }

            const modelId = creds.model || creds.modelId || preset.models[0]?.id;
            const apiKey = creds.apiKey || creds.api_key || creds.key || creds.token;
            const customBaseUrl = creds.baseUrl || creds.base_url || creds.url || creds.host;

            if (providerId !== "ollama" && !apiKey) {
              return text(`${preset.name} needs an API key.\nUsage: {"apiKey": "sk-..."}\nAvailable models: ${preset.models.map((m: any) => m.id).join(", ")}`);
            }

            const result = addProvider({
              providerId,
              apiKey: apiKey || undefined,
              modelId,
              customBaseUrl: customBaseUrl || undefined,
              isDefault: creds.default === true,
            });

            if (!result.success) {
              return text(`Connection failed: ${result.message}`);
            }

            return text(`✅ ${preset.name} connected!\n\nModel: ${modelId}\n${result.message}\n\nUse soul_llm_list to see all models, soul_smart_chat to chat.`);
          } catch (err: any) {
            return text(`Failed to connect ${svc}: ${err.message}`);
          }
        }

        // ─── Unknown service ───
        // Save as generic channel
        const channelName = name || svc;
        await addChannel({
          name: channelName,
          channelType: svc,
          config: creds,
        });
        return text(`Channel "${channelName}" (${svc}) saved with provided config.\nUse soul_send("${channelName}", "message") to send.`);

      } catch (error: any) {
        if (error.message?.includes("JSON")) {
          return text(`Invalid JSON in credentials. Use format: {"key": "value"}\nError: ${error.message}`);
        }
        return text(`Connection failed: ${error.message}`);
      }
    }
  );

  // ─── Telegram Listen (start polling) ───
  server.tool(
    "soul_telegram_listen",
    "Start listening for Telegram messages — Soul will auto-reply to every message using its brain. This runs in the background.",
    {
      channel: z.string().describe("Telegram channel name (from soul_connect or soul_channel_add)"),
    },
    async ({ channel }) => {
      const result = await startTelegramPolling(channel);
      return text(result.message);
    }
  );

  // ─── Telegram Stop ───
  server.tool(
    "soul_telegram_stop",
    "Stop listening for Telegram messages.",
    {},
    async () => {
      const result = stopTelegramPolling();
      return text(result.message);
    }
  );

  // ─── Telegram Status ───
  server.tool(
    "soul_telegram_status",
    "Check if Telegram polling is active.",
    {},
    async () => {
      const status = getTelegramPollingStatus();
      return text(
        status.active
          ? `Telegram polling is ACTIVE (offset: ${status.offset})`
          : "Telegram polling is NOT running. Use soul_telegram_listen to start."
      );
    }
  );

  // ─── Self Update ───
  server.tool(
    "soul_self_update",
    "Update Soul to the latest version from npm. Soul can update itself!",
    {},
    async () => {
      const result = await selfUpdate();
      return text(result.message);
    }
  );

  // ─── Check Update ───
  server.tool(
    "soul_check_update",
    "Check if a newer version of Soul is available (without installing).",
    {},
    async () => {
      const info = await checkForUpdate();
      if (info.updateAvailable) {
        return text(`Update available! Current: ${info.currentVersion} → Latest: ${info.latestVersion}\nUse soul_self_update to install.`);
      }
      return text(`Soul is up to date (${info.currentVersion}).`);
    }
  );

  // ─── Original tools (kept for backward compatibility) ───

  server.tool(
    "soul_channel_add",
    "Add a messaging channel — Telegram, Discord, webhook, or custom. Prefer soul_connect for easier setup.",
    {
      name: z.string().describe("Channel name (e.g., 'my-telegram', 'work-slack')"),
      channelType: z
        .enum(["telegram", "discord", "slack", "webhook", "line", "whatsapp", "custom"])
        .describe("Channel type"),
      config: z
        .string()
        .describe("JSON config (e.g., {\"botToken\":\"...\",\"chatId\":\"...\"} for Telegram, {\"url\":\"...\"} for webhook)"),
    },
    async ({ name, channelType, config }) => {
      try {
        const parsed = JSON.parse(config);
        await addChannel({ name, channelType, config: parsed });
        return text(`Channel "${name}" added (${channelType}). Use soul_send to send messages.`);
      } catch (error: any) {
        return text(`Failed to add channel: ${error.message}`);
      }
    }
  );

  server.tool(
    "soul_channels",
    "List all messaging channels.",
    {},
    async () => {
      const channels = await listChannels();

      if (channels.length === 0) {
        return text("No channels configured. Use soul_connect to connect Telegram, Discord, LLMs, etc.");
      }

      const lines = channels.map((c) => {
        // Mask sensitive data in display
        let configSummary = "";
        try {
          const cfg = JSON.parse(c.config);
          const keys = Object.keys(cfg);
          configSummary = keys.map(k => {
            const v = String(cfg[k]);
            if (k.toLowerCase().includes("token") || k.toLowerCase().includes("key") || k.toLowerCase().includes("secret")) {
              return `${k}: ****${v.slice(-4)}`;
            }
            return `${k}: ${v.substring(0, 30)}`;
          }).join(", ");
        } catch { /* ok */ }

        return `${c.isActive ? "✅" : "❌"} "${c.name}" (${c.channelType})${configSummary ? ` — ${configSummary}` : ""}`;
      });

      return text(`Channels (${channels.length}):\n\n${lines.join("\n")}`);
    }
  );

  server.tool(
    "soul_send",
    "Send a message through a channel — reach your master on Telegram, Discord, or any configured channel.",
    {
      channel: z.string().describe("Channel name"),
      message: z.string().describe("Message to send"),
    },
    async ({ channel, message }) => {
      const result = await sendMessage(channel, message);

      if (!result) {
        return text(`Channel "${channel}" not found or inactive. Use soul_channels to see available channels.`);
      }

      return text(`Message ${result.status}: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}" → ${channel}`);
    }
  );

  server.tool(
    "soul_messages",
    "View message history for a channel.",
    {
      channel: z
        .string()
        .optional()
        .describe("Channel name (all if omitted)"),
      limit: z
        .number()
        .default(20)
        .describe("Number of messages"),
    },
    async ({ channel, limit }) => {
      const messages = await getMessageHistory(channel, limit);

      if (messages.length === 0) {
        return text("No messages yet.");
      }

      const lines = messages.map(
        (m) =>
          `[${m.direction === "inbound" ? "←" : "→"}] ${m.status} | ${m.content.substring(0, 100)}\n  ${m.createdAt}`
      );

      return text(`Messages (${messages.length}):\n\n${lines.join("\n\n")}`);
    }
  );
}

// Helper to create text response
function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
