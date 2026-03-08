import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  saveSnippet, searchSnippets, useSnippet,
  saveTemplate, getTemplates, useTemplate,
  addCodePattern, getCodePatterns,
  recommendStack, getCodeStats,
} from "../core/code-intelligence.js";

export function registerCodeIntelligenceTools(server: McpServer) {
  server.tool(
    "soul_snippet_save",
    "Save a reusable code snippet — Soul remembers useful code patterns for quick reuse.",
    {
      title: z.string().describe("Snippet title"),
      language: z.string().describe("Programming language"),
      code: z.string().describe("The code snippet"),
      description: z.string().optional().describe("What it does"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ title, language, code, description, tags }) => {
      const snippet = await saveSnippet({ title, language, code, description, tags });
      return {
        content: [{
          type: "text" as const,
          text: `Snippet saved: "${title}" [${language}] #${snippet.id}\nUse soul_snippet_find to search snippets.`,
        }],
      };
    }
  );

  server.tool(
    "soul_snippet_find",
    "Search saved code snippets by keyword or language.",
    {
      query: z.string().optional().describe("Search keyword"),
      language: z.string().optional().describe("Filter by language"),
    },
    async ({ query, language }) => {
      const snippets = searchSnippets(query, language);
      if (snippets.length === 0) {
        return { content: [{ type: "text" as const, text: "No snippets found." }] };
      }
      const text = snippets.map(s =>
        `#${s.id} [${s.language}] "${s.title}" (used ${s.useCount}x)\n  ${s.code.substring(0, 150)}...`
      ).join("\n\n");
      return { content: [{ type: "text" as const, text: `Snippets (${snippets.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_snippet_use",
    "Get a snippet by ID and mark it as used.",
    {
      id: z.number().describe("Snippet ID"),
    },
    async ({ id }) => {
      const snippet = useSnippet(id);
      if (!snippet) return { content: [{ type: "text" as const, text: "Snippet not found." }] };
      return {
        content: [{
          type: "text" as const,
          text: `"${snippet.title}" [${snippet.language}]:\n\n${snippet.code}`,
        }],
      };
    }
  );

  server.tool(
    "soul_template_save",
    "Save a project template — reusable project structure for quick bootstrapping.",
    {
      name: z.string().describe("Template name (e.g., 'nextjs-api', 'cli-tool')"),
      stack: z.string().describe("Tech stack description"),
      structure: z.string().describe("Directory structure and key files"),
      description: z.string().optional().describe("What this template is for"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ name, stack, structure, description, tags }) => {
      const template = await saveTemplate({ name, stack, structure, description, tags });
      return {
        content: [{
          type: "text" as const,
          text: `Template saved: "${name}" #${template.id}\nStack: ${stack}`,
        }],
      };
    }
  );

  server.tool(
    "soul_templates",
    "Browse project templates — find a starting point for new projects.",
    {
      stack: z.string().optional().describe("Filter by tech stack"),
    },
    async ({ stack }) => {
      const templates = getTemplates(stack);
      if (templates.length === 0) {
        return { content: [{ type: "text" as const, text: "No templates. Use soul_template_save to create one." }] };
      }
      const text = templates.map(t =>
        `#${t.id} "${t.name}" (${t.stack}) — used ${t.useCount}x\n  ${t.description || t.structure.substring(0, 100)}`
      ).join("\n\n");
      return { content: [{ type: "text" as const, text: `Templates (${templates.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_code_pattern",
    "Add a code pattern or anti-pattern — best practices Soul remembers.",
    {
      patternType: z.enum(["design", "error-handling", "performance", "security", "testing"]).describe("Pattern category"),
      language: z.string().describe("Programming language"),
      pattern: z.string().describe("The pattern description"),
      example: z.string().optional().describe("Code example"),
      antiPattern: z.string().optional().describe("What NOT to do"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ patternType, language, pattern, example, antiPattern, tags }) => {
      await addCodePattern({ patternType, language, pattern, example, antiPattern, tags });
      return {
        content: [{
          type: "text" as const,
          text: `Pattern saved: [${patternType}] ${language}\n${pattern}${antiPattern ? `\nAnti-pattern: ${antiPattern}` : ""}`,
        }],
      };
    }
  );

  server.tool(
    "soul_code_patterns",
    "Browse code patterns — best practices and anti-patterns by language.",
    {
      language: z.string().optional().describe("Filter by language"),
      patternType: z.string().optional().describe("Filter by type"),
    },
    async ({ language, patternType }) => {
      const patterns = getCodePatterns(language, patternType);
      if (patterns.length === 0) {
        return { content: [{ type: "text" as const, text: "No patterns yet." }] };
      }
      const text = patterns.map((p: any) =>
        `[${p.pattern_type}] ${p.language}: ${p.pattern}${p.anti_pattern ? `\n  Anti: ${p.anti_pattern}` : ""}`
      ).join("\n\n");
      return { content: [{ type: "text" as const, text: `Patterns (${patterns.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_recommend_stack",
    "Get tech stack recommendation for a project type — Soul suggests the best tools.",
    {
      projectType: z.enum(["web-app", "api", "cli", "mobile", "desktop", "ai-tool", "data", "game", "scraper", "bot"])
        .describe("Type of project"),
    },
    async ({ projectType }) => {
      const rec = recommendStack(projectType);
      return {
        content: [{
          type: "text" as const,
          text: `Recommended stack for "${projectType}":\n\n${rec}`,
        }],
      };
    }
  );

  server.tool(
    "soul_code_stats",
    "Code intelligence statistics — snippets, templates, patterns overview.",
    {},
    async () => {
      const stats = getCodeStats();
      let text = `=== Code Intelligence ===\n\n`;
      text += `Snippets: ${stats.snippets}\n`;
      text += `Templates: ${stats.templates}\n`;
      text += `Patterns: ${stats.patterns}\n`;
      if (stats.topLanguages.length > 0) {
        text += `\nTop Languages:\n`;
        stats.topLanguages.forEach((l: any) => { text += `  ${l.language}: ${l.count} snippets\n`; });
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
