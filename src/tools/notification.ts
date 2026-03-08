import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  pushNotification,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
} from "../core/notification.js";

export function registerNotificationTools(server: McpServer) {
  server.tool(
    "soul_notify",
    "Push a notification — Soul actively notifies about important things. Can be info, warning, or urgent.",
    {
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification message"),
      priority: z
        .enum(["info", "warning", "urgent"])
        .default("info")
        .describe("Priority level"),
    },
    async ({ title, message, priority }) => {
      const notification = await pushNotification({ title, message, priority });
      return {
        content: [
          {
            type: "text" as const,
            text: `Notification #${notification.id} sent [${priority}]: ${title}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_notifications",
    "Check notifications — see what Soul has been alerting you about.",
    {
      unreadOnly: z
        .boolean()
        .default(true)
        .describe("Show only unread"),
    },
    async ({ unreadOnly }) => {
      const notifications = await getNotifications(unreadOnly);
      const unread = await getUnreadCount();

      if (notifications.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No notifications. All clear!",
            },
          ],
        };
      }

      const text = notifications
        .map(
          (n) =>
            `${n.isRead ? " " : "*"} #${n.id} [${n.priority}] ${n.title}\n  ${n.message}\n  ${n.createdAt}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Notifications (${unread} unread):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_notify_read",
    "Mark a notification as read.",
    {
      id: z.number().describe("Notification ID (or 0 for all)"),
    },
    async ({ id }) => {
      if (id === 0) {
        const count = await markAllRead();
        return {
          content: [
            {
              type: "text" as const,
              text: `${count} notifications marked as read.`,
            },
          ],
        };
      }
      await markRead(id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Notification #${id} marked as read.`,
          },
        ],
      };
    }
  );
}
