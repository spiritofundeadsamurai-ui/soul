import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  quickNote, quickIdea, quickBookmark,
  getQuickNotes, pinNote, deleteQuickNote, searchQuickNotes,
} from "../core/quick-capture.js";

export function registerQuickCaptureTools(server: McpServer) {
  server.tool(
    "soul_note",
    "Quick note — capture a thought instantly without categorization. Fast and frictionless.",
    {
      content: z.string().describe("Note content"),
      priority: z.number().min(1).max(5).default(3).describe("Priority (1-5)"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
    },
    async ({ content, priority, tags }) => {
      const note = quickNote(content, "note", priority, tags);
      return { content: [{ type: "text" as const, text: `Note #${note.id} saved.` }] };
    }
  );

  server.tool(
    "soul_idea",
    "Capture an idea — rate its potential (1-5). Great ideas float to the top.",
    {
      idea: z.string().describe("The idea"),
      rating: z.number().min(1).max(5).default(3).describe("How good? (1=meh, 5=brilliant)"),
    },
    async ({ idea, rating }) => {
      const note = quickIdea(idea, rating);
      return { content: [{ type: "text" as const, text: `Idea #${note.id} captured (${"*".repeat(rating)}).` }] };
    }
  );

  server.tool(
    "soul_bookmark",
    "Save a bookmark — URL with title and tags for later reference.",
    {
      url: z.string().describe("URL to bookmark"),
      title: z.string().describe("Bookmark title"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ url, title, tags }) => {
      const note = quickBookmark(url, title, tags);
      return { content: [{ type: "text" as const, text: `Bookmarked: "${title}" #${note.id}` }] };
    }
  );

  server.tool(
    "soul_notes",
    "View quick notes, ideas, or bookmarks.",
    {
      type: z.enum(["note", "idea", "bookmark", "thought", "todo"]).optional().describe("Filter by type"),
      pinned: z.boolean().optional().describe("Only pinned items"),
    },
    async ({ type, pinned }) => {
      const notes = getQuickNotes(type, pinned);
      if (notes.length === 0) {
        return { content: [{ type: "text" as const, text: "No notes. Use soul_note, soul_idea, or soul_bookmark." }] };
      }

      const text = notes.map(n => {
        let line = `${n.pinned ? "[PIN] " : ""}#${n.id} [${n.noteType}] P${n.priority} — ${n.content.substring(0, 100)}`;
        if (n.url) line += `\n  URL: ${n.url}`;
        return line;
      }).join("\n");

      return { content: [{ type: "text" as const, text: `Notes (${notes.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_note_pin",
    "Pin/unpin a note — pinned notes always appear first.",
    {
      id: z.number().describe("Note ID"),
      pin: z.boolean().default(true).describe("Pin (true) or unpin (false)"),
    },
    async ({ id, pin }) => {
      const note = pinNote(id, pin);
      if (!note) return { content: [{ type: "text" as const, text: "Note not found." }] };
      return { content: [{ type: "text" as const, text: `${pin ? "Pinned" : "Unpinned"}: #${id}` }] };
    }
  );

  server.tool(
    "soul_note_delete",
    "Delete a quick note.",
    {
      id: z.number().describe("Note ID to delete"),
    },
    async ({ id }) => {
      const deleted = deleteQuickNote(id);
      return { content: [{ type: "text" as const, text: deleted ? `Note #${id} deleted.` : "Note not found." }] };
    }
  );

  server.tool(
    "soul_note_search",
    "Search quick notes by keyword.",
    {
      query: z.string().describe("Search keyword"),
    },
    async ({ query }) => {
      const notes = searchQuickNotes(query);
      if (notes.length === 0) {
        return { content: [{ type: "text" as const, text: `No notes matching "${query}".` }] };
      }
      const text = notes.map(n => `#${n.id} [${n.noteType}] ${n.content.substring(0, 100)}`).join("\n");
      return { content: [{ type: "text" as const, text: `Found ${notes.length}:\n\n${text}` }] };
    }
  );
}
