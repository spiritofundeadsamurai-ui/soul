import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  webSearch,
  searchAndFetch,
  fetchPageContent,
  configureSearchProvider,
  listSearchProviders,
} from "../core/web-search.js";

/**
 * Web Search Tools — Soul can discover information from the web
 *
 * Tools:
 * 1. soul_web_search — Search the web for information
 * 2. soul_web_fetch — Fetch and extract content from a URL
 * 3. soul_web_search_deep — Search + fetch top results in one call
 * 4. soul_search_provider_add — Configure a search API provider
 * 5. soul_search_providers — List configured search providers
 */

export function registerWebSearchTools(server: McpServer) {
  // soul_web_search — Search the web
  server.tool(
    "soul_web_search",
    "Search the web for any topic — returns titles, URLs, and snippets. Uses DuckDuckGo (free, no API key) by default, or Brave/Google/SearXNG if configured.",
    {
      query: z.string().describe("Search query"),
      maxResults: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Maximum results to return"),
      provider: z
        .enum(["auto", "duckduckgo", "brave", "google", "searxng"])
        .default("auto")
        .describe("Search provider (auto tries all available)"),
    },
    async ({ query, maxResults, provider }) => {
      try {
        const result = await webSearch(query, { maxResults, provider });

        if (result.results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No results found for "${query}" (provider: ${result.provider}).\n\nTips:\n- Try different keywords\n- Use English for broader results\n- Configure additional search providers with soul_search_provider_add`,
              },
            ],
          };
        }

        let text = `Web Search: "${query}"\nProvider: ${result.provider} | Results: ${result.totalResults}\n\n`;

        for (let i = 0; i < result.results.length; i++) {
          const r = result.results[i];
          text += `${i + 1}. ${r.title}\n`;
          text += `   ${r.url}\n`;
          if (r.snippet) {
            text += `   ${r.snippet}\n`;
          }
          text += "\n";
        }

        text += `\nTo read full content, use soul_web_fetch with any URL above.`;
        text += `\nTo search and read in one step, use soul_web_search_deep.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${err.message || "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // soul_web_fetch — Fetch and read a URL
  server.tool(
    "soul_web_fetch",
    "Fetch a URL and extract clean text content — removes HTML, scripts, styles, navigation. Returns readable text for analysis.",
    {
      url: z.string().url().describe("URL to fetch"),
    },
    async ({ url }) => {
      try {
        const page = await fetchPageContent(url);

        let text = `Page: ${page.title}\n`;
        text += `URL: ${page.url}\n`;
        text += `Words: ${page.wordCount} | Fetched: ${page.fetchedAt}\n`;
        text += `${"─".repeat(60)}\n\n`;
        text += page.text;

        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch URL: ${err.message || "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // soul_web_search_deep — Search + fetch top results
  server.tool(
    "soul_web_search_deep",
    "Search the web AND read top results in one step — returns search results plus full text content of the top pages. Great for research tasks.",
    {
      query: z.string().describe("Search query"),
      fetchTop: z
        .number()
        .min(1)
        .max(5)
        .default(3)
        .describe("How many top results to fetch full content"),
      maxResults: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Maximum search results"),
    },
    async ({ query, fetchTop, maxResults }) => {
      try {
        const result = await searchAndFetch(query, {
          maxResults,
          fetchTop,
        });

        let text = `Deep Search: "${query}"\n`;
        text += `Provider: ${result.provider} | Results: ${result.results.length} | Pages fetched: ${result.pages.length}\n\n`;

        // Search results overview
        text += `═══ Search Results ═══\n\n`;
        for (let i = 0; i < result.results.length; i++) {
          const r = result.results[i];
          const fetched = result.pages.some((p) => p.url === r.url);
          text += `${i + 1}. ${fetched ? "[FETCHED] " : ""}${r.title}\n`;
          text += `   ${r.url}\n`;
          if (r.snippet) text += `   ${r.snippet}\n`;
          text += "\n";
        }

        // Fetched page content
        if (result.pages.length > 0) {
          text += `\n═══ Fetched Page Content ═══\n\n`;

          for (const page of result.pages) {
            text += `─── ${page.title} ───\n`;
            text += `URL: ${page.url}\n`;
            text += `Words: ${page.wordCount}\n\n`;
            // Limit each page to ~5000 chars to keep output reasonable
            const maxPageChars = 5000;
            if (page.text.length > maxPageChars) {
              text +=
                page.text.substring(0, maxPageChars) +
                `\n\n[...truncated, ${page.wordCount} words total]\n`;
            } else {
              text += page.text;
            }
            text += `\n\n${"═".repeat(60)}\n\n`;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Deep search failed: ${err.message || "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // soul_search_provider_add — Configure a search provider
  server.tool(
    "soul_search_provider_add",
    "Configure a search API provider — add Brave Search, Google Custom Search, or SearXNG for better web search results.",
    {
      provider: z
        .enum(["brave", "google", "searxng"])
        .describe("Search provider to configure"),
      apiKey: z
        .string()
        .optional()
        .describe("API key (required for Brave and Google)"),
      cx: z
        .string()
        .optional()
        .describe("Google Custom Search Engine ID (required for Google)"),
      baseUrl: z
        .string()
        .optional()
        .describe("SearXNG instance URL (e.g., https://search.example.com)"),
    },
    async ({ provider, apiKey, cx, baseUrl }) => {
      try {
        if (provider === "brave" && !apiKey) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Brave Search requires an API key. Get one free at: https://brave.com/search/api/",
              },
            ],
          };
        }

        if (provider === "google" && (!apiKey || !cx)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Google Custom Search requires both an API key and a CX (Search Engine ID).\nGet them at: https://programmablesearchengine.google.com/",
              },
            ],
          };
        }

        if (provider === "searxng" && !baseUrl) {
          return {
            content: [
              {
                type: "text" as const,
                text: "SearXNG requires a base URL of your instance (e.g., https://search.example.com)",
              },
            ],
          };
        }

        configureSearchProvider({
          provider,
          apiKey,
          baseUrl,
          enabled: true,
          ...(cx ? { cx } : {}),
        } as any);

        return {
          content: [
            {
              type: "text" as const,
              text: `Search provider "${provider}" configured successfully!\nIt will be used automatically for web searches.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to configure provider: ${err.message || "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // soul_search_providers — List configured providers
  server.tool(
    "soul_search_providers",
    "List all configured search providers and their status.",
    {},
    async () => {
      const providers = listSearchProviders();

      let text = "Search Providers:\n\n";

      for (const p of providers) {
        const status = p.enabled ? "✓ Enabled" : "✗ Disabled";
        text += `${status} | ${p.provider}`;
        if (p.apiKey) text += ` (API key: ${p.apiKey.substring(0, 6)}...)`;
        if (p.baseUrl) text += ` (URL: ${p.baseUrl})`;
        text += "\n";
      }

      text += `\nDefault: DuckDuckGo (free, no key needed)`;
      text += `\nFor better results, add: soul_search_provider_add`;

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
