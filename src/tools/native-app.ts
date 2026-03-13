import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  openWebUI,
  sendDesktopNotification,
  registerStartup,
  unregisterStartup,
} from "../core/tray.js";

export function registerNativeAppTools(server: McpServer) {
  server.tool(
    "soul_open_ui",
    "Open Soul's Web UI in the default browser. Can open dashboard, chat, or office.",
    {
      page: z.enum(["dashboard", "chat", "office", "community"]).default("dashboard").describe("Which page to open"),
    },
    async ({ page }) => {
      const paths: Record<string, string> = { dashboard: "/", chat: "/chat", office: "/office", community: "/community" };
      openWebUI(paths[page] || "/");
      return text(`Opened Soul ${page} in browser.`);
    }
  );

  server.tool(
    "soul_desktop_notify",
    "Send a desktop notification (Windows toast, macOS notification, Linux notify-send).",
    {
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification message"),
    },
    async ({ title, message }) => {
      sendDesktopNotification(title, message);
      return text(`Desktop notification sent: "${title}"`);
    }
  );

  server.tool(
    "soul_startup_register",
    "Register Soul to start automatically when your computer boots up.",
    {},
    async () => {
      const result = registerStartup();
      return text(result.message);
    }
  );

  server.tool(
    "soul_startup_unregister",
    "Remove Soul from startup applications.",
    {},
    async () => {
      const result = unregisterStartup();
      return text(result.message);
    }
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
