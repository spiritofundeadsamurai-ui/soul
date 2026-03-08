/**
 * Web Search Engine — Soul can discover information autonomously
 *
 * Multiple search backends (all free, no API key needed by default):
 * 1. DuckDuckGo HTML — scrape search results (no API key)
 * 2. SearXNG — self-hosted meta-search (if available)
 * 3. Google Custom Search — with API key (optional)
 * 4. Brave Search — with API key (optional)
 *
 * Features:
 * - Auto-fallback between providers
 * - Result deduplication
 * - Content extraction from top results
 * - Web safety check before fetching
 * - Rate limiting to be respectful
 */

import { checkUrlSafety } from "./web-safety.js";
import { getRawDb } from "../db/index.js";

// ─── Types ───

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // which provider found it
}

export interface SearchOptions {
  maxResults?: number;
  language?: string;
  region?: string;
  safeSearch?: boolean;
  provider?: "auto" | "duckduckgo" | "searxng" | "google" | "brave";
  timeRange?: "day" | "week" | "month" | "year" | "all";
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string; // cleaned text content
  wordCount: number;
  fetchedAt: string;
}

interface SearchProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
}

// ─── Rate limiting ───

const rateLimiter = new Map<string, number>();
const RATE_LIMIT_MS = 2000; // 2 seconds between requests to same domain

function canRequest(domain: string): boolean {
  const last = rateLimiter.get(domain) || 0;
  return Date.now() - last >= RATE_LIMIT_MS;
}

function recordRequest(domain: string): void {
  rateLimiter.set(domain, Date.now());
}

// ─── Provider configs (from DB) ───

function getProviderConfigs(): SearchProviderConfig[] {
  const configs: SearchProviderConfig[] = [
    { provider: "duckduckgo", enabled: true }, // always available, no key needed
  ];

  try {
    const db = getRawDb();
    const rows = db
      .prepare(
        `SELECT key, value FROM soul_config WHERE key LIKE 'search_provider_%'`
      )
      .all() as Array<{ key: string; value: string }>;

    for (const row of rows) {
      try {
        const config = JSON.parse(row.value);
        configs.push(config);
      } catch {
        // skip malformed config
      }
    }
  } catch {
    // DB not ready, use defaults
  }

  return configs;
}

// ─── DuckDuckGo HTML Search (no API key) ───

async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    // Use DuckDuckGo HTML lite version
    const encoded = encodeURIComponent(query);
    const url = `https://lite.duckduckgo.com/lite/?q=${encoded}`;

    if (!canRequest("duckduckgo.com")) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    recordRequest("duckduckgo.com");

    if (!resp.ok) return results;

    const html = await resp.text();

    // DDG lite wraps URLs as //duckduckgo.com/l/?uddg=<encoded_url>&rut=...
    // Parse the actual URLs from the uddg parameter
    const linkRegex =
      /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      let href = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      if (!href || !title) continue;

      // Extract actual URL from DDG redirect
      const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        href = decodeURIComponent(uddgMatch[1]);
      } else if (href.startsWith("//duckduckgo.com")) {
        continue; // internal DDG link without target
      }

      // Ensure it's an absolute URL
      if (!href.startsWith("http")) continue;

      links.push({ url: href, title });
    }

    // Extract snippets — DDG lite uses <td class="result-snippet">
    const snippetRegex =
      /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
    }

    // If no snippets found via class, try extracting text from result rows
    if (snippets.length === 0) {
      // DDG lite puts snippets in separate <td> cells after the link
      const snippetAlt = /<td[^>]*>\s*<span[^>]*class="link-text"[^>]*>([\s\S]*?)<\/span>/gi;
      while ((match = snippetAlt.exec(html)) !== null) {
        snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
      }
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
        source: "duckduckgo",
      });
    }
  } catch (err) {
    // DuckDuckGo failed, return empty
  }

  return results;
}

// ─── Brave Search (needs API key) ───

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`;

    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return results;

    const data = (await resp.json()) as {
      web?: {
        results?: Array<{
          title: string;
          url: string;
          description: string;
        }>;
      };
    };

    for (const r of data.web?.results || []) {
      results.push({
        title: r.title,
        url: r.url,
        snippet: r.description,
        source: "brave",
      });
    }
  } catch {
    // Brave failed
  }

  return results;
}

// ─── Google Custom Search (needs API key + CX) ───

async function searchGoogle(
  query: string,
  maxResults: number,
  apiKey: string,
  cx: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?q=${encoded}&key=${apiKey}&cx=${cx}&num=${Math.min(maxResults, 10)}`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return results;

    const data = (await resp.json()) as {
      items?: Array<{
        title: string;
        link: string;
        snippet: string;
      }>;
    };

    for (const item of data.items || []) {
      results.push({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: "google",
      });
    }
  } catch {
    // Google failed
  }

  return results;
}

// ─── SearXNG (self-hosted meta-search) ───

async function searchSearXNG(
  query: string,
  maxResults: number,
  baseUrl: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const encoded = encodeURIComponent(query);
    const url = `${baseUrl}/search?q=${encoded}&format=json&categories=general&language=all`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return results;

    const data = (await resp.json()) as {
      results?: Array<{
        title: string;
        url: string;
        content: string;
        engine: string;
      }>;
    };

    for (const r of (data.results || []).slice(0, maxResults)) {
      results.push({
        title: r.title,
        url: r.url,
        snippet: r.content,
        source: `searxng:${r.engine}`,
      });
    }
  } catch {
    // SearXNG failed
  }

  return results;
}

// ─── Content Extraction ───

/**
 * Fetch a URL and extract clean text content
 */
export async function fetchPageContent(url: string): Promise<FetchedPage> {
  // Safety check first
  const safety = await checkUrlSafety(url);
  if (!safety.safe) {
    throw new Error(`URL blocked by safety check: ${safety.risk}`);
  }

  if (!canRequest(new URL(url).hostname)) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SoulAI/1.0; +https://github.com/soul-ai/soul)",
      Accept: "text/html,application/xhtml+xml,text/plain",
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  recordRequest(new URL(url).hostname);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  const rawText = await resp.text();

  let title = "";
  let text = "";

  if (contentType.includes("text/html") || contentType.includes("xhtml")) {
    // Extract title
    const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : "";

    // Remove unwanted elements
    text = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Replace block elements with newlines
      .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, "\n")
      // Remove remaining tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      // Clean up whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    // Plain text
    text = rawText.trim();
    title = text.split("\n")[0]?.substring(0, 100) || url;
  }

  // Truncate very long pages
  const maxChars = 50000;
  if (text.length > maxChars) {
    text = text.substring(0, maxChars) + "\n\n[...truncated at 50,000 characters]";
  }

  const words = text.split(/\s+/).filter(Boolean);

  return {
    url,
    title,
    text,
    wordCount: words.length,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Main Search Function ───

/**
 * Search the web for a query — auto-selects best available provider
 */
export async function webSearch(
  query: string,
  options: SearchOptions = {}
): Promise<{
  results: SearchResult[];
  provider: string;
  query: string;
  totalResults: number;
}> {
  const maxResults = options.maxResults || 10;
  const provider = options.provider || "auto";

  const configs = getProviderConfigs();

  let results: SearchResult[] = [];
  let usedProvider = "none";

  if (provider === "auto") {
    // Try providers in order of preference
    for (const config of configs) {
      if (!config.enabled) continue;

      if (config.provider === "brave" && config.apiKey) {
        results = await searchBrave(query, maxResults, config.apiKey);
        if (results.length > 0) {
          usedProvider = "brave";
          break;
        }
      } else if (config.provider === "google" && config.apiKey) {
        results = await searchGoogle(
          query,
          maxResults,
          config.apiKey,
          (config as any).cx || ""
        );
        if (results.length > 0) {
          usedProvider = "google";
          break;
        }
      } else if (config.provider === "searxng" && config.baseUrl) {
        results = await searchSearXNG(query, maxResults, config.baseUrl);
        if (results.length > 0) {
          usedProvider = "searxng";
          break;
        }
      } else if (config.provider === "duckduckgo") {
        results = await searchDuckDuckGo(query, maxResults);
        if (results.length > 0) {
          usedProvider = "duckduckgo";
          break;
        }
      }
    }
  } else {
    // Use specific provider
    const config = configs.find((c) => c.provider === provider);

    switch (provider) {
      case "duckduckgo":
        results = await searchDuckDuckGo(query, maxResults);
        usedProvider = "duckduckgo";
        break;
      case "brave":
        if (config?.apiKey) {
          results = await searchBrave(query, maxResults, config.apiKey);
          usedProvider = "brave";
        }
        break;
      case "google":
        if (config?.apiKey) {
          results = await searchGoogle(
            query,
            maxResults,
            config.apiKey,
            (config as any).cx || ""
          );
          usedProvider = "google";
        }
        break;
      case "searxng":
        if (config?.baseUrl) {
          results = await searchSearXNG(query, maxResults, config.baseUrl);
          usedProvider = "searxng";
        }
        break;
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    const norm = r.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });

  return {
    results: deduped,
    provider: usedProvider,
    query,
    totalResults: deduped.length,
  };
}

/**
 * Search and fetch top results — combines search + content extraction
 */
export async function searchAndFetch(
  query: string,
  options: SearchOptions & { fetchTop?: number } = {}
): Promise<{
  results: SearchResult[];
  pages: FetchedPage[];
  provider: string;
  query: string;
}> {
  const searchResults = await webSearch(query, options);
  const fetchTop = options.fetchTop || 3;

  const pages: FetchedPage[] = [];

  for (const result of searchResults.results.slice(0, fetchTop)) {
    try {
      const page = await fetchPageContent(result.url);
      pages.push(page);
    } catch {
      // Skip pages that fail to fetch
    }
  }

  return {
    results: searchResults.results,
    pages,
    provider: searchResults.provider,
    query,
  };
}

/**
 * Configure a search provider
 */
export function configureSearchProvider(config: SearchProviderConfig): void {
  const db = getRawDb();
  db.prepare(
    `INSERT OR REPLACE INTO soul_config (key, value) VALUES (?, ?)`
  ).run(`search_provider_${config.provider}`, JSON.stringify(config));
}

/**
 * List configured search providers
 */
export function listSearchProviders(): SearchProviderConfig[] {
  return getProviderConfigs();
}
