import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createSession, listSessions, getSession,
  deleteSession, renameSession, resumeSession,
} from "../core/sessions.js";
import {
  createBranch, switchBranch, formatTree,
  addTreeMessage, getBranch, getChildren,
} from "../core/conversation-tree.js";

export function registerSessionTools(server: McpServer) {
  // ─── Session Tools ───

  server.tool(
    "soul_session_create",
    "Create a named persistent session — give conversations a name so you can resume them later.",
    {
      name: z.string().describe("Session name (unique)"),
      description: z.string().optional().describe("What this session is about"),
    },
    async ({ name, description }) => {
      try {
        const session = createSession(name, description);
        return {
          content: [{
            type: "text" as const,
            text: `Session "${session.name}" created (ID: ${session.id}).`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to create session: ${e.message}`,
          }],
        };
      }
    }
  );

  server.tool(
    "soul_session_list",
    "List all named sessions — see what conversations are saved.",
    {},
    async () => {
      const sessions = listSessions();
      if (sessions.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No sessions yet. Use soul_session_create to start one.",
          }],
        };
      }

      const text = sessions.map(s => {
        const desc = s.description ? ` — ${s.description}` : "";
        return `- ${s.name}${desc}\n  ID: ${s.id} | Updated: ${s.updatedAt}`;
      }).join("\n");

      return {
        content: [{
          type: "text" as const,
          text: `Sessions (${sessions.length}):\n\n${text}`,
        }],
      };
    }
  );

  server.tool(
    "soul_session_resume",
    "Resume a named session — reload context and recent messages.",
    {
      name: z.string().describe("Session name or ID"),
    },
    async ({ name }) => {
      const result = resumeSession(name);
      if (!result) {
        return {
          content: [{
            type: "text" as const,
            text: `Session "${name}" not found.`,
          }],
        };
      }

      const { session, messages } = result;
      let text = `Resumed session "${session.name}"`;
      if (session.description) text += ` — ${session.description}`;
      text += `\nID: ${session.id}`;

      if (messages.length > 0) {
        text += `\n\nLast ${messages.length} messages:\n`;
        text += messages.map(m => {
          const preview = m.content.substring(0, 120).replace(/\n/g, " ");
          return `  [${m.role}] ${preview}`;
        }).join("\n");
      } else {
        text += "\n\nNo messages yet in this session.";
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_session_delete",
    "Delete a named session and its conversation history.",
    {
      name: z.string().describe("Session name or ID"),
    },
    async ({ name }) => {
      const deleted = deleteSession(name);
      return {
        content: [{
          type: "text" as const,
          text: deleted ? `Session "${name}" deleted.` : `Session "${name}" not found.`,
        }],
      };
    }
  );

  // ─── Branch Tools ───

  server.tool(
    "soul_branch_create",
    "Create a conversation branch from a specific message — explore alternative paths.",
    {
      session_id: z.string().describe("Current session ID"),
      parent_message_id: z.string().describe("Message ID to branch from"),
    },
    async ({ session_id, parent_message_id }) => {
      try {
        const newSessionId = createBranch(session_id, parent_message_id);
        return {
          content: [{
            type: "text" as const,
            text: `Branch created! New session ID: ${newSessionId}\nBranched from message: ${parent_message_id}`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to create branch: ${e.message}`,
          }],
        };
      }
    }
  );

  server.tool(
    "soul_branch_switch",
    "Switch to a different branch in the conversation tree.",
    {
      session_id: z.string().describe("Session ID"),
      message_id: z.string().describe("Message ID to switch to"),
    },
    async ({ session_id, message_id }) => {
      try {
        const result = switchBranch(session_id, message_id);
        const branch = getBranch(message_id);
        return {
          content: [{
            type: "text" as const,
            text: `Switched to message ${result.activeMessageId}.\nBranch depth: ${branch.length} messages.`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to switch branch: ${e.message}`,
          }],
        };
      }
    }
  );

  server.tool(
    "soul_branch_tree",
    "Show the conversation tree structure — visualize all branches.",
    {
      session_id: z.string().describe("Session ID"),
    },
    async ({ session_id }) => {
      const tree = formatTree(session_id);
      return {
        content: [{
          type: "text" as const,
          text: `Conversation Tree:\n\n${tree}`,
        }],
      };
    }
  );
}
