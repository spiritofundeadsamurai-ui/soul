import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { broadcastNotification, sendToClient, listConnectedClients, getClientCount } from "../core/ws-notifications.js";

export function registerWsNotificationTools(server: McpServer) {
  server.tool(
    "soul_ws_broadcast",
    "Broadcast a real-time notification to all connected WebSocket clients.",
    {
      event: z.string().describe("Event name (e.g. memory_created, task_completed)"),
      data: z.record(z.string(), z.any()).describe("Event data payload"),
    },
    async ({ event, data }) => {
      const sent = broadcastNotification(event, data);
      return { content: [{ type: "text" as const, text: `Broadcast "${event}" to ${sent} client(s)` }] };
    }
  );

  server.tool(
    "soul_ws_send",
    "Send a notification to a specific connected WebSocket client.",
    {
      clientId: z.string().describe("Target client ID"),
      event: z.string().describe("Event name"),
      data: z.record(z.string(), z.any()).describe("Event data payload"),
    },
    async ({ clientId, event, data }) => {
      const ok = sendToClient(clientId, event, data);
      return { content: [{ type: "text" as const, text: ok ? `Sent "${event}" to client ${clientId}` : `Client ${clientId} not found` }] };
    }
  );

  server.tool(
    "soul_ws_clients",
    "List all currently connected WebSocket clients.",
    {},
    async () => {
      const clients = listConnectedClients();
      const count = getClientCount();
      if (count === 0) return { content: [{ type: "text" as const, text: "No WebSocket clients connected." }] };
      const list = clients.map(c => `  ${c.id} — connected ${c.connectedAt}`).join("\n");
      return { content: [{ type: "text" as const, text: `${count} connected client(s):\n${list}` }] };
    }
  );
}
