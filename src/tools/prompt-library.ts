import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  savePrompt,
  usePrompt,
  ratePrompt,
  evolvePrompt,
  listPrompts,
  searchPrompts,
  deletePrompt,
  getPromptCategories,
} from "../core/prompt-library.js";

export function registerPromptLibraryTools(server: McpServer) {

  server.tool(
    "soul_prompt_save",
    "Save a prompt to the library — store effective prompts for reuse. Like Custom GPTs but better: versioned, rated, with variables.",
    {
      name: z.string().describe("Unique prompt name (e.g. 'code-review', 'write-email')"),
      content: z.string().describe("Prompt text — use {{variable}} for dynamic parts"),
      category: z.string().default("general").describe("Category (coding, writing, analysis, creative, etc.)"),
      description: z.string().optional().describe("Short description of what this prompt does"),
      tags: z.array(z.string()).optional().describe("Tags for searching"),
    },
    async ({ name, content, category, description, tags }) => {
      try {
        const prompt = savePrompt({ name, content, category, description, tags });
        const vars = prompt.variables.length > 0 ? `\nVariables: ${prompt.variables.map(v => `{{${v}}}`).join(", ")}` : "";
        return {
          content: [{
            type: "text" as const,
            text: `Prompt "${prompt.name}" saved (v${prompt.version}).\nCategory: ${prompt.category}${vars}\n\nUse: soul_prompt_use name:"${prompt.name}"`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_prompt_use",
    "Use a saved prompt — renders it with variables and returns the result. Tracks usage for rating.",
    {
      name: z.string().describe("Prompt name"),
      variables: z.record(z.string(), z.string()).optional().describe("Variable values (e.g. {topic: 'AI safety'})"),
    },
    async ({ name, variables }) => {
      const result = usePrompt(name, variables || {});
      if (!result) {
        return { content: [{ type: "text" as const, text: `Prompt "${name}" not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `[Prompt: ${result.prompt.name} v${result.prompt.version} | Used ${result.prompt.useCount + 1}x]\n\n${result.rendered}`,
        }],
      };
    }
  );

  server.tool(
    "soul_prompt_rate",
    "Rate a prompt's effectiveness (0-5). Helps track which prompts work best.",
    {
      name: z.string().describe("Prompt name"),
      rating: z.number().min(0).max(5).describe("Rating 0-5 (5 = excellent)"),
    },
    async ({ name, rating }) => {
      const ok = ratePrompt(name, rating);
      return {
        content: [{
          type: "text" as const,
          text: ok ? `Prompt "${name}" rated ${rating}/5.` : `Prompt "${name}" not found.`,
        }],
      };
    }
  );

  server.tool(
    "soul_prompt_evolve",
    "Update a prompt — creates a new version while preserving history.",
    {
      name: z.string().describe("Prompt name to update"),
      content: z.string().describe("New prompt content"),
      reason: z.string().describe("Why this change was made"),
    },
    async ({ name, content, reason }) => {
      const prompt = evolvePrompt(name, content, reason);
      if (!prompt) {
        return { content: [{ type: "text" as const, text: `Prompt "${name}" not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Prompt "${prompt.name}" evolved to v${prompt.version}.\nReason: ${reason}`,
        }],
      };
    }
  );

  server.tool(
    "soul_prompts",
    "List all saved prompts — shows name, category, rating, usage.",
    {
      category: z.string().optional().describe("Filter by category"),
    },
    async ({ category }) => {
      const prompts = listPrompts(category || undefined);
      if (prompts.length === 0) {
        return { content: [{ type: "text" as const, text: "No prompts saved yet. Use soul_prompt_save to add one." }] };
      }

      let text = `Prompt Library (${prompts.length}):\n\n`;
      text += prompts.map(p =>
        `${p.name} [${p.category}] — v${p.version} | ${p.rating.toFixed(1)}/5 | Used ${p.useCount}x\n  ${p.description || p.content.substring(0, 80) + "..."}`
      ).join("\n\n");

      const categories = getPromptCategories();
      text += `\n\nCategories: ${categories.map(c => `${c.category} (${c.count})`).join(", ")}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_prompt_search",
    "Search prompts by keyword.",
    { query: z.string().describe("Search query") },
    async ({ query }) => {
      const results = searchPrompts(query);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No prompts found for "${query}".` }] };
      }
      let text = `Found ${results.length} prompts:\n\n`;
      text += results.map(p => `${p.name} [${p.category}] — ${p.description || p.content.substring(0, 60)}`).join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_prompt_delete",
    "Delete a prompt from the library.",
    { name: z.string().describe("Prompt name to delete") },
    async ({ name }) => {
      const ok = deletePrompt(name);
      return {
        content: [{
          type: "text" as const,
          text: ok ? `Prompt "${name}" deleted.` : `Prompt "${name}" not found.`,
        }],
      };
    }
  );
}
