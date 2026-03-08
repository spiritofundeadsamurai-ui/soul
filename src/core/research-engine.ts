/**
 * Research Engine — Soul learns from external sources
 *
 * Soul can actively seek knowledge from:
 * 1. YouTube videos (oEmbed metadata)
 * 2. Social media (Reddit, Twitter, HackerNews)
 * 3. Technical docs (GitHub, MDN, StackOverflow)
 * 4. News and articles
 * 5. Academic papers (arXiv)
 *
 * All with web safety checks before fetching.
 */

import { remember } from "../memory/memory-engine.js";
import { addKnowledge } from "./knowledge.js";
import { checkUrlSafety, scanContent } from "./web-safety.js";

export interface ResearchResult {
  source: string;
  sourceType: "youtube" | "reddit" | "hackernews" | "github" | "article" | "docs" | "social" | "unknown";
  title: string;
  content: string;
  metadata: Record<string, string>;
  safetyCheck: { safe: boolean; risk: string };
}

// Platform detection
function detectPlatform(url: string): ResearchResult["sourceType"] {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("reddit.com")) return "reddit";
  if (host.includes("news.ycombinator.com")) return "hackernews";
  if (host.includes("github.com")) return "github";
  if (host.includes("twitter.com") || host.includes("x.com")) return "social";
  if (host.includes("medium.com") || host.includes("dev.to") || host.includes("hashnode")) return "article";
  if (host.includes("mdn") || host.includes("docs.") || host.includes("learn.microsoft")) return "docs";
  return "unknown";
}

/**
 * Extract YouTube video ID from various URL formats
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/v\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
    /youtu\.be\/([^?]+)/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch YouTube metadata via oEmbed API (no API key needed)
 */
export async function fetchYouTubeMetadata(url: string): Promise<ResearchResult> {
  const videoId = extractYouTubeId(url);
  const safetyCheck = await checkUrlSafety(url);

  if (!safetyCheck.safe) {
    return {
      source: url, sourceType: "youtube", title: "Blocked",
      content: `URL blocked: ${safetyCheck.reasons.join(", ")}`,
      metadata: {}, safetyCheck: { safe: false, risk: safetyCheck.risk },
    };
  }

  try {
    // oEmbed API — free, no key needed
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) throw new Error(`oEmbed failed: ${response.status}`);

    const data = await response.json() as any;

    const title = data.title || "Unknown Video";
    const author = data.author_name || "Unknown";
    const thumbnailUrl = data.thumbnail_url || "";

    const content = `YouTube Video: "${title}" by ${author}\nVideo ID: ${videoId}\nThumbnail: ${thumbnailUrl}`;

    // Store in knowledge base
    await addKnowledge({
      title: `YouTube: ${title}`,
      category: "fact",
      content,
      source: "youtube",
      tags: ["youtube", "video", author.toLowerCase()],
    });

    return {
      source: url, sourceType: "youtube", title,
      content,
      metadata: { videoId: videoId || "", author, thumbnailUrl },
      safetyCheck: { safe: true, risk: "none" },
    };
  } catch (error: any) {
    return {
      source: url, sourceType: "youtube", title: "Error",
      content: `Failed to fetch YouTube metadata: ${error.message}`,
      metadata: {}, safetyCheck: { safe: true, risk: "none" },
    };
  }
}

/**
 * Fetch and extract article content from any URL
 */
export async function fetchArticle(url: string): Promise<ResearchResult> {
  const safety = await checkUrlSafety(url);
  const sourceType = detectPlatform(url);

  if (!safety.safe) {
    return {
      source: url, sourceType, title: "Blocked",
      content: `URL blocked: ${safety.reasons.join(", ")}`,
      metadata: {}, safetyCheck: { safe: false, risk: safety.risk },
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Soul/1.0 (AI Research Agent)",
        "Accept": "text/html,application/json,text/plain",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    let rawText = await response.text();

    // Scan content for dangers
    const contentScan = scanContent(rawText);
    if (!contentScan.safe) {
      await remember({
        content: `[Safety Warning] ${url}: ${contentScan.warnings.join(", ")}`,
        type: "wisdom",
        tags: ["safety", "warning", "web-content"],
        source: "research-engine",
      });
    }

    // Extract title
    const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Extract meta description
    const descMatch = rawText.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
    const description = descMatch ? descMatch[1] : "";

    // Clean HTML to text
    let cleanText = rawText
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Limit content size
    cleanText = cleanText.substring(0, 15000);

    // Store in memory
    await remember({
      content: `[Research] ${title}\nURL: ${url}\n\n${cleanText.substring(0, 3000)}`,
      type: "learning",
      tags: ["research", sourceType, new URL(url).hostname],
      source: url,
    });

    return {
      source: url, sourceType, title,
      content: cleanText,
      metadata: {
        description,
        contentType,
        fetchedAt: new Date().toISOString(),
        contentLength: String(cleanText.length),
        ...(contentScan.warnings.length > 0 ? { warnings: contentScan.warnings.join("; ") } : {}),
      },
      safetyCheck: { safe: true, risk: safety.risk },
    };
  } catch (error: any) {
    return {
      source: url, sourceType, title: "Error",
      content: `Failed to fetch: ${error.message}`,
      metadata: {}, safetyCheck: { safe: true, risk: safety.risk },
    };
  }
}

/**
 * Fetch HackerNews top stories
 */
export async function fetchHackerNews(limit = 10): Promise<ResearchResult[]> {
  try {
    const response = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      { signal: AbortSignal.timeout(10000) }
    );
    const ids = (await response.json()) as number[];
    const topIds = ids.slice(0, limit);

    const results: ResearchResult[] = [];
    for (const id of topIds) {
      const itemRes = await fetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        { signal: AbortSignal.timeout(5000) }
      );
      const item = (await itemRes.json()) as any;
      if (item && item.title) {
        results.push({
          source: item.url || `https://news.ycombinator.com/item?id=${id}`,
          sourceType: "hackernews",
          title: item.title,
          content: `${item.title} (${item.score} points, ${item.descendants || 0} comments)\n${item.url || ""}`,
          metadata: {
            hnId: String(id),
            score: String(item.score),
            comments: String(item.descendants || 0),
            by: item.by || "unknown",
          },
          safetyCheck: { safe: true, risk: "none" },
        });
      }
    }
    return results;
  } catch (error: any) {
    return [{
      source: "https://news.ycombinator.com",
      sourceType: "hackernews",
      title: "Error",
      content: `Failed to fetch HN: ${error.message}`,
      metadata: {}, safetyCheck: { safe: true, risk: "none" },
    }];
  }
}

/**
 * Fetch GitHub repo info (no API key needed for public repos)
 */
export async function fetchGitHubRepo(repoUrl: string): Promise<ResearchResult> {
  const safety = await checkUrlSafety(repoUrl);
  if (!safety.safe) {
    return {
      source: repoUrl, sourceType: "github", title: "Blocked",
      content: `URL blocked: ${safety.reasons.join(", ")}`,
      metadata: {}, safetyCheck: { safe: false, risk: safety.risk },
    };
  }

  try {
    // Extract owner/repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (!match) throw new Error("Invalid GitHub URL");

    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

    const response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Soul/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`GitHub API ${response.status}`);

    const data = (await response.json()) as any;

    const content = [
      `Repository: ${data.full_name}`,
      `Description: ${data.description || "No description"}`,
      `Stars: ${data.stargazers_count} | Forks: ${data.forks_count} | Issues: ${data.open_issues_count}`,
      `Language: ${data.language || "Unknown"}`,
      `License: ${data.license?.name || "None"}`,
      `Last updated: ${data.updated_at}`,
      `Topics: ${(data.topics || []).join(", ")}`,
    ].join("\n");

    await addKnowledge({
      title: `GitHub: ${data.full_name}`,
      category: "fact",
      content,
      source: "github",
      tags: ["github", "repo", data.language?.toLowerCase() || "unknown", ...(data.topics || [])],
    });

    return {
      source: repoUrl, sourceType: "github",
      title: data.full_name,
      content,
      metadata: {
        stars: String(data.stargazers_count),
        forks: String(data.forks_count),
        language: data.language || "unknown",
        license: data.license?.name || "none",
      },
      safetyCheck: { safe: true, risk: "none" },
    };
  } catch (error: any) {
    return {
      source: repoUrl, sourceType: "github", title: "Error",
      content: `Failed to fetch GitHub repo: ${error.message}`,
      metadata: {}, safetyCheck: { safe: true, risk: "none" },
    };
  }
}

/**
 * Multi-source research — fetch from multiple platforms
 */
export async function multiSourceResearch(topic: string, urls?: string[]): Promise<{
  results: ResearchResult[];
  summary: string;
}> {
  const results: ResearchResult[] = [];

  if (urls) {
    for (const url of urls) {
      const platform = detectPlatform(url);
      if (platform === "youtube") {
        results.push(await fetchYouTubeMetadata(url));
      } else if (platform === "github") {
        results.push(await fetchGitHubRepo(url));
      } else {
        results.push(await fetchArticle(url));
      }
    }
  }

  // Generate summary
  const successResults = results.filter(r => r.safetyCheck.safe && r.title !== "Error");
  const summary = successResults.length > 0
    ? `Research on "${topic}": Found ${successResults.length} sources.\n\n` +
      successResults.map((r, i) => `${i + 1}. [${r.sourceType}] ${r.title}\n   ${r.content.substring(0, 200)}`).join("\n\n")
    : `No results found for "${topic}".`;

  // Store research summary
  if (successResults.length > 0) {
    await remember({
      content: `[Research Summary] ${topic}\n\n${summary}`,
      type: "knowledge",
      tags: ["research", "summary", topic.toLowerCase().replace(/\s+/g, "-")],
      source: "research-engine",
    });
  }

  return { results, summary };
}
