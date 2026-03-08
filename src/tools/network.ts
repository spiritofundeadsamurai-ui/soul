import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  prepareShareableKnowledge,
  receiveKnowledge,
  addPeer,
  listPeers,
  getNetworkKnowledge,
  voteKnowledge,
} from "../core/network.js";

export function registerNetworkTools(server: McpServer) {
  server.tool(
    "soul_network_share",
    "Prepare Soul's high-confidence learnings for sharing with other Soul instances. Only anonymized patterns are shared — NEVER private data.",
    {},
    async () => {
      const shared = await prepareShareableKnowledge();
      return {
        content: [
          {
            type: "text" as const,
            text: shared.length > 0
              ? `Prepared ${shared.length} knowledge items for sharing:\n\n${shared.map((s) => `- [${s.category}] ${s.pattern}`).join("\n")}\n\nThese are anonymized patterns — no private data included.`
              : "No high-confidence learnings ready to share yet. Keep learning!",
          },
        ],
      };
    }
  );

  server.tool(
    "soul_network_peer",
    "Add another Soul instance as a network peer — share knowledge between masters' Souls.",
    {
      url: z
        .string()
        .describe("Peer Soul's API URL (e.g., http://friend:47779)"),
      name: z.string().describe("Friendly name for this peer"),
    },
    async ({ url, name }) => {
      const result = await addPeer(url, name);
      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? `Peer added: ${name} at ${url}\n\nYou can now share knowledge with this Soul instance.`
              : `Failed to add peer: ${result.message}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_network_peers",
    "List all connected Soul peers in the network.",
    {},
    async () => {
      const peers = await listPeers();

      if (peers.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No peers connected yet. Use soul_network_peer to add other Soul instances.",
            },
          ],
        };
      }

      const text = peers
        .map(
          (p) =>
            `${p.isActive ? "+" : "-"} ${p.name} (${p.url})\n  Trust: ${Math.round(p.trustLevel * 100)}%${p.lastSync ? ` | Last sync: ${p.lastSync}` : ""}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Soul Network Peers (${peers.length}):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_network_knowledge",
    "Browse knowledge shared by the Soul network — patterns, solutions, and techniques from other instances.",
    {
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category (programming, style, troubleshooting, education, communication, general)"
        ),
    },
    async ({ category }) => {
      const knowledge = await getNetworkKnowledge(category);

      if (knowledge.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No network knowledge available. Share your own learnings first with soul_network_share.",
            },
          ],
        };
      }

      const text = knowledge
        .map(
          (k) =>
            `#${k.id} [${k.category}] (useful: ${k.usefulness})\n  ${k.pattern}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Network Knowledge (${knowledge.length}):\n\n${text}\n\nUse soul_network_vote to rate helpfulness.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_network_vote",
    "Vote on shared knowledge — help the network surface the most useful patterns.",
    {
      knowledgeId: z.number().describe("Knowledge item ID"),
      useful: z
        .boolean()
        .describe("Is this knowledge useful?"),
    },
    async ({ knowledgeId, useful }) => {
      await voteKnowledge(knowledgeId, useful);
      return {
        content: [
          {
            type: "text" as const,
            text: `Vote recorded for #${knowledgeId}: ${useful ? "useful" : "not useful"}`,
          },
        ],
      };
    }
  );
}
