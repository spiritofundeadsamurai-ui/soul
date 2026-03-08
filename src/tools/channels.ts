import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addChannel,
  listChannels,
  sendMessage,
  getMessageHistory,
} from "../core/channels.js";

export function registerChannelTools(server: McpServer) {
  server.tool(
    "soul_channel_add",
    "Add a messaging channel — Telegram, Discord, webhook, or custom. Soul can send messages to master through multiple channels.",
    {
      name: z.string().describe("Channel name (e.g., 'my-telegram', 'work-slack')"),
      channelType: z
        .enum(["telegram", "discord", "webhook", "line", "whatsapp", "custom"])
        .describe("Channel type"),
      config: z
        .string()
        .describe("JSON config (e.g., {\"botToken\":\"...\",\"chatId\":\"...\"} for Telegram, {\"url\":\"...\"} for webhook)"),
    },
    async ({ name, channelType, config }) => {
      try {
        const parsed = JSON.parse(config);
        const channel = await addChannel({ name, channelType, config: parsed });
        return {
          content: [
            {
              type: "text" as const,
              text: `Channel "${name}" added (${channelType}).\nSoul can now send messages through this channel using soul_send.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to add channel: ${error.message}`,
            },
          ],
        };
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
        return {
          content: [
            {
              type: "text" as const,
              text: "No channels configured. Use soul_channel_add to connect Telegram, Discord, webhook, etc.",
            },
          ],
        };
      }

      const text = channels
        .map(
          (c) =>
            `${c.isActive ? "+" : "-"} "${c.name}" (${c.channelType})`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Messaging Channels (${channels.length}):\n\n${text}`,
          },
        ],
      };
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Channel "${channel}" not found or inactive. Use soul_channels to see available channels.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Message ${result.status}: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}" → ${channel}`,
          },
        ],
      };
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
        return {
          content: [
            {
              type: "text" as const,
              text: "No messages yet.",
            },
          ],
        };
      }

      const text = messages
        .map(
          (m) =>
            `[${m.direction}] ${m.status} | ${m.content.substring(0, 100)}\n  ${m.createdAt}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Messages (${messages.length}):\n\n${text}`,
          },
        ],
      };
    }
  );
}
