/**
 * Video Learner — Soul learns from YouTube and video content
 *
 * 1. YouTube transcript extraction (via innertube API / captions)
 * 2. Video summarization via LLM
 * 3. Key point extraction and memory storage
 * 4. Supports: YouTube, any URL with transcript/subtitles
 */

import { remember } from "../memory/memory-engine.js";

interface VideoInfo {
  title: string;
  channel: string;
  description: string;
  transcript: string;
  duration: string;
  url: string;
}

/**
 * Extract video ID from YouTube URL
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Get YouTube video info via oEmbed
 */
async function getYouTubeInfo(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { title: "Unknown", channel: "Unknown" };
    const data = await res.json() as any;
    return { title: data.title || "Unknown", channel: data.author_name || "Unknown" };
  } catch {
    return { title: "Unknown", channel: "Unknown" };
  }
}

/**
 * Extract YouTube transcript/captions
 * Uses the innertube captions endpoint (no API key needed)
 */
async function getYouTubeTranscript(videoId: string): Promise<string> {
  try {
    // Method 1: Try fetching the watch page and extracting captions URL
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "th,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!watchRes.ok) return "";
    const html = await watchRes.text();

    // Extract captions track URL from player response
    const captionMatch = html.match(/"captions":\s*(\{[\s\S]*?"captionTracks"[\s\S]*?\])/);
    if (!captionMatch) return "";

    // Find the captions JSON
    const tracksMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
    if (!tracksMatch) return "";

    let tracks: any[];
    try { tracks = JSON.parse(tracksMatch[1]); } catch { return ""; }

    // Prefer Thai, then English, then any
    let captionUrl = "";
    const preferred = tracks.find((t: any) => t.languageCode === "th");
    const english = tracks.find((t: any) => t.languageCode === "en");
    const any = tracks[0];
    captionUrl = (preferred || english || any)?.baseUrl || "";

    if (!captionUrl) return "";

    // Fetch the actual captions (XML format)
    const capRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
    if (!capRes.ok) return "";
    const capXml = await capRes.text();

    // Parse XML captions → plain text
    const textParts: string[] = [];
    const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = regex.exec(capXml)) !== null) {
      const text = match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, " ")
        .trim();
      if (text) textParts.push(text);
    }

    return textParts.join(" ").substring(0, 30000); // Limit to ~30K chars
  } catch {
    return "";
  }
}

/**
 * Learn from a YouTube video — extract transcript, summarize, remember
 */
export async function learnFromYouTube(url: string): Promise<{
  success: boolean;
  title: string;
  channel: string;
  hasTranscript: boolean;
  summary: string;
  keyPoints: string[];
  message: string;
}> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return { success: false, title: "", channel: "", hasTranscript: false, summary: "", keyPoints: [], message: "Invalid YouTube URL" };
  }

  // Get video info
  const info = await getYouTubeInfo(videoId);

  // Get transcript
  const transcript = await getYouTubeTranscript(videoId);
  const hasTranscript = transcript.length > 50;

  // Summarize with LLM if we have transcript
  let summary = "";
  let keyPoints: string[] = [];

  if (hasTranscript) {
    try {
      const { chat } = await import("./llm-connector.js");
      const summarizeResult = await chat([
        { role: "system", content: "Summarize this video transcript in Thai. Give: 1) Summary (2-3 sentences), 2) Key Points (bullet list, max 5). Be concise." },
        { role: "user", content: `Video: "${info.title}" by ${info.channel}\n\nTranscript:\n${transcript.substring(0, 10000)}` },
      ], { temperature: 0.3 });

      const response = summarizeResult.content || "";
      summary = response;

      // Extract key points
      const pointsMatch = response.match(/[-•*]\s*(.+)/g);
      if (pointsMatch) {
        keyPoints = pointsMatch.map(p => p.replace(/^[-•*]\s*/, "").trim());
      }
    } catch {
      summary = `Video: ${info.title} by ${info.channel}. Transcript available (${transcript.length} chars) but summarization failed.`;
    }
  } else {
    summary = `Video: ${info.title} by ${info.channel}. No transcript available.`;
  }

  // Remember in Soul's memory
  await remember({
    content: `[YouTube] "${info.title}" by ${info.channel}\nURL: ${url}\n${hasTranscript ? "Summary: " + summary.substring(0, 500) : "No transcript available"}`,
    type: "knowledge" as any,
    tags: ["youtube", "video", "learning", info.channel],
    source: "video-learner",
  });

  return {
    success: true,
    title: info.title,
    channel: info.channel,
    hasTranscript,
    summary,
    keyPoints,
    message: hasTranscript
      ? `เรียนรู้จาก "${info.title}" เรียบร้อย — ${keyPoints.length} key points จำไว้แล้ว`
      : `จำวิดีโอ "${info.title}" ไว้แล้ว แต่ไม่มี subtitle ให้ดึง transcript`,
  };
}
