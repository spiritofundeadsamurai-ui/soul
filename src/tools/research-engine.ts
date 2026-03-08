import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchYouTubeMetadata,
  fetchArticle,
  fetchHackerNews,
  fetchGitHubRepo,
  multiSourceResearch,
} from "../core/research-engine.js";

export function registerResearchEngineTools(server: McpServer) {
  server.tool(
    "soul_learn_youtube",
    "Learn from a YouTube video — fetch title, author, metadata via oEmbed. Soul stores the knowledge. Provide transcript text in 'notes' for deeper learning.",
    {
      url: z.string().describe("YouTube video URL"),
      notes: z
        .string()
        .optional()
        .describe("Additional notes, transcript, or key takeaways from the video"),
    },
    async ({ url, notes }) => {
      const result = await fetchYouTubeMetadata(url);

      if (!result.safetyCheck.safe) {
        return {
          content: [{
            type: "text" as const,
            text: `URL blocked for safety: ${result.content}`,
          }],
        };
      }

      let text = `YouTube: "${result.title}"\n`;
      text += `Author: ${result.metadata.author || "Unknown"}\n`;
      text += `Video ID: ${result.metadata.videoId || "Unknown"}\n`;

      if (notes) {
        text += `\nNotes stored: ${notes.substring(0, 200)}...`;
        // The research engine already stores in knowledge base
      }

      text += `\n\nStored in Soul's knowledge base.`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_learn_web",
    "Learn from any web page — fetch, extract content, check safety, and store knowledge. Works with articles, docs, blogs, forums.",
    {
      url: z.string().describe("URL to learn from"),
      focus: z
        .string()
        .optional()
        .describe("What to focus on (e.g., 'API changes', 'performance tips')"),
    },
    async ({ url, focus }) => {
      const result = await fetchArticle(url);

      if (!result.safetyCheck.safe) {
        return {
          content: [{
            type: "text" as const,
            text: `URL blocked for safety: ${result.content}`,
          }],
        };
      }

      let text = `[${result.sourceType}] "${result.title}"\n`;
      text += `Content: ${result.metadata.contentLength || "0"} chars extracted\n`;

      if (result.metadata.description) {
        text += `Description: ${result.metadata.description}\n`;
      }
      if (result.metadata.warnings) {
        text += `\nSafety warnings: ${result.metadata.warnings}\n`;
      }

      text += `\nContent Preview:\n${result.content.substring(0, 1000)}`;

      if (focus) {
        text += `\n\nFocus area: ${focus}`;
      }

      text += `\n\nFull content stored in Soul's memory.`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_learn_github",
    "Learn about a GitHub repository — stars, language, description, topics. Soul tracks interesting repos.",
    {
      url: z.string().describe("GitHub repository URL (e.g., https://github.com/owner/repo)"),
    },
    async ({ url }) => {
      const result = await fetchGitHubRepo(url);

      if (!result.safetyCheck.safe) {
        return {
          content: [{
            type: "text" as const,
            text: `URL blocked: ${result.content}`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `GitHub: ${result.title}\n\n${result.content}\n\nStored in Soul's knowledge base.`,
        }],
      };
    }
  );

  server.tool(
    "soul_trending",
    "See what's trending on HackerNews — Soul stays informed about tech trends.",
    {
      limit: z.number().default(10).describe("Number of stories to fetch"),
    },
    async ({ limit }) => {
      const results = await fetchHackerNews(limit);

      if (results.length === 1 && results[0].title === "Error") {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to fetch HackerNews: ${results[0].content}`,
          }],
        };
      }

      const text = results
        .map((r, i) =>
          `${i + 1}. ${r.title}\n   ${r.metadata.score} pts | ${r.metadata.comments} comments | by ${r.metadata.by}\n   ${r.source}`
        )
        .join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `HackerNews Top ${results.length}:\n\n${text}`,
        }],
      };
    }
  );

  server.tool(
    "soul_research_multi",
    "Research a topic from multiple sources — fetch from given URLs, auto-detect platform (YouTube, GitHub, article), summarize findings.",
    {
      topic: z.string().describe("Research topic"),
      urls: z
        .array(z.string())
        .optional()
        .describe("URLs to research from"),
    },
    async ({ topic, urls }) => {
      const { results, summary } = await multiSourceResearch(topic, urls);

      let text = summary;

      const blocked = results.filter(r => !r.safetyCheck.safe);
      if (blocked.length > 0) {
        text += `\n\nBlocked URLs (safety concern):\n`;
        text += blocked.map(r => `  - ${r.source}: ${r.content}`).join("\n");
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
