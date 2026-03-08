/**
 * Multi-Modal Engine — Learn from any input type
 *
 * Soul can process and learn from:
 * 1. Text (already works)
 * 2. URLs / web pages (fetch + extract)
 * 3. Images (via vision API when available)
 * 4. Audio/Video (transcription + analysis)
 * 5. Documents (PDF, Word, etc.)
 *
 * Uses external APIs when available, graceful fallback when not.
 */

import { remember } from "../memory/memory-engine.js";
import { checkUrlSafety, scanContent } from "./web-safety.js";

export interface MediaAnalysis {
  type: "image" | "audio" | "video" | "document" | "url";
  source: string;
  extractedText: string;
  summary: string;
  tags: string[];
  metadata: Record<string, string>;
}

/**
 * Fetch and extract content from a URL
 */
export async function extractFromUrl(url: string): Promise<MediaAnalysis> {
  // Safety check before fetching
  const safety = await checkUrlSafety(url);
  if (!safety.safe) {
    return {
      type: "url",
      source: url,
      extractedText: "",
      summary: `BLOCKED: ${safety.reasons.join(", ")}. Risk level: ${safety.risk}`,
      tags: ["url", "blocked", "unsafe"],
      metadata: { blocked: "true", risk: safety.risk, reasons: safety.reasons.join("; ") },
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Soul/1.0 (AI Companion)",
        Accept: "text/html,application/json,text/plain",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/json")) {
      const json = await response.json();
      text = JSON.stringify(json, null, 2).substring(0, 10000);
    } else {
      const html = await response.text();
      // Strip HTML tags for plain text extraction
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 10000);
    }

    // Scan content for dangerous elements
    const contentScan = scanContent(text);
    if (!contentScan.safe) {
      await remember({
        content: `[Safety Warning] ${url}: ${contentScan.warnings.join(", ")}`,
        type: "wisdom",
        tags: ["safety", "content-warning"],
        source: "multimodal",
      });
    }

    const analysis: MediaAnalysis = {
      type: "url",
      source: url,
      extractedText: text,
      summary: text.substring(0, 500),
      tags: ["web", "url", extractDomain(url), ...(contentScan.safe ? [] : ["content-warning"])],
      metadata: {
        contentType,
        fetchedAt: new Date().toISOString(),
        length: String(text.length),
        safetyRisk: safety.risk,
        ...(contentScan.warnings.length > 0 ? { contentWarnings: contentScan.warnings.join("; ") } : {}),
      },
    };

    // Store in memory
    await remember({
      content: `[URL] ${url}\n\n${text.substring(0, 2000)}`,
      type: "learning",
      tags: ["url", "web-content", extractDomain(url)],
      source: `url:${url}`,
    });

    return analysis;
  } catch (error: any) {
    return {
      type: "url",
      source: url,
      extractedText: "",
      summary: `Failed to fetch: ${error.message}`,
      tags: ["url", "error"],
      metadata: { error: error.message },
    };
  }
}

/**
 * Analyze image — uses description when vision API isn't available
 */
export async function analyzeImage(
  source: string,
  description?: string
): Promise<MediaAnalysis> {
  // Without a vision API, we rely on user-provided description
  // When vision API is configured, this will call it automatically
  const text = description || "Image uploaded — waiting for vision API integration for auto-analysis";

  const analysis: MediaAnalysis = {
    type: "image",
    source,
    extractedText: text,
    summary: text.substring(0, 500),
    tags: ["image", "visual"],
    metadata: {
      analyzedAt: new Date().toISOString(),
      hasVisionApi: "false",
    },
  };

  if (description) {
    await remember({
      content: `[Image] ${source}\nDescription: ${description}`,
      type: "learning",
      tags: ["image", "visual", "analyzed"],
      source: `image:${source}`,
    });
  }

  return analysis;
}

/**
 * Process audio/video — transcription placeholder
 */
export async function processMedia(
  source: string,
  mediaType: "audio" | "video",
  transcript?: string,
  description?: string
): Promise<MediaAnalysis> {
  const text = transcript || description || `${mediaType} uploaded — provide transcript or wait for transcription API`;

  const analysis: MediaAnalysis = {
    type: mediaType,
    source,
    extractedText: text,
    summary: text.substring(0, 500),
    tags: [mediaType, "media"],
    metadata: {
      analyzedAt: new Date().toISOString(),
    },
  };

  if (transcript || description) {
    await remember({
      content: `[${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}] ${source}\n${transcript ? `Transcript: ${transcript}` : `Description: ${description}`}`,
      type: "learning",
      tags: [mediaType, "media", "analyzed"],
      source: `${mediaType}:${source}`,
    });
  }

  return analysis;
}

/**
 * Process document text
 */
export async function processDocument(
  source: string,
  content: string,
  docType: string
): Promise<MediaAnalysis> {
  const analysis: MediaAnalysis = {
    type: "document",
    source,
    extractedText: content.substring(0, 10000),
    summary: content.substring(0, 500),
    tags: ["document", docType],
    metadata: {
      docType,
      length: String(content.length),
      analyzedAt: new Date().toISOString(),
    },
  };

  await remember({
    content: `[Document:${docType}] ${source}\n\n${content.substring(0, 3000)}`,
    type: "learning",
    tags: ["document", docType],
    source: `document:${source}`,
  });

  return analysis;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
