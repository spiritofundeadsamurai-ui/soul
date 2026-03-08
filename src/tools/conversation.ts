import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  logConversation, getConversationHistory,
  recallContext, getConversationStats,
} from "../core/conversation-context.js";

export function registerConversationTools(server: McpServer) {
  server.tool(
    "soul_conversation_log",
    "Log a conversation summary — Soul remembers what was discussed, key decisions, and action items.",
    {
      topic: z.string().describe("Conversation topic"),
      summary: z.string().describe("Brief summary of what was discussed"),
      keyPoints: z.array(z.string()).optional().describe("Key points covered"),
      decisions: z.array(z.string()).optional().describe("Decisions made"),
      actionItems: z.array(z.string()).optional().describe("Action items/next steps"),
    },
    async ({ topic, summary, keyPoints, decisions, actionItems }) => {
      const log = logConversation({
        sessionId: `session-${Date.now()}`,
        topic, summary, keyPoints, decisions, actionItems,
      });
      return {
        content: [{
          type: "text" as const,
          text: `Conversation logged: "${topic}" #${log.id}\n${decisions?.length ? `Decisions: ${decisions.length}` : ""}${actionItems?.length ? ` | Actions: ${actionItems.length}` : ""}`,
        }],
      };
    }
  );

  server.tool(
    "soul_conversation_history",
    "View past conversations — search by topic or browse all.",
    {
      topic: z.string().optional().describe("Search by topic"),
      limit: z.number().default(10).describe("Max results"),
    },
    async ({ topic, limit }) => {
      const logs = getConversationHistory(topic, limit);
      if (logs.length === 0) {
        return { content: [{ type: "text" as const, text: "No conversations logged yet." }] };
      }

      const text = logs.map(l => {
        let line = `#${l.id} [${l.createdAt}] "${l.topic}"\n  ${l.summary.substring(0, 150)}`;
        try {
          const actions = JSON.parse(l.actionItems);
          if (actions.length > 0) line += `\n  Actions: ${actions.length} items`;
        } catch { /* skip */ }
        return line;
      }).join("\n\n");

      return { content: [{ type: "text" as const, text: `Conversations (${logs.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_recall_context",
    "Recall everything about a topic — past conversations + related memories. Perfect for resuming work.",
    {
      topic: z.string().describe("Topic to recall context for"),
    },
    async ({ topic }) => {
      const { conversations, relatedMemories } = await recallContext(topic);

      let text = `=== Context for "${topic}" ===\n\n`;

      if (conversations.length > 0) {
        text += `Past Conversations:\n`;
        conversations.forEach(c => {
          text += `  [${c.createdAt}] ${c.summary.substring(0, 200)}\n`;
        });
      }

      if (relatedMemories.length > 0) {
        text += `\nRelated Memories:\n`;
        relatedMemories.forEach((m: any) => {
          text += `  #${m.id} [${m.type}] ${m.content.substring(0, 150)}\n`;
        });
      }

      if (conversations.length === 0 && relatedMemories.length === 0) {
        text += "No previous context found on this topic.";
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_conversation_stats",
    "Conversation statistics — total, unique topics, most discussed.",
    {},
    async () => {
      const stats = getConversationStats();
      let text = `=== Conversation Stats ===\n\n`;
      text += `Total: ${stats.total}\n`;
      text += `Unique topics: ${stats.uniqueTopics}\n`;
      text += `Sessions (7 days): ${stats.recentSessions}\n`;

      if (stats.topTopics.length > 0) {
        text += `\nMost Discussed:\n`;
        stats.topTopics.forEach((t: any) => { text += `  "${t.topic}": ${t.count}x\n`; });
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
