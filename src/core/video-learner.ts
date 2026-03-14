/**
 * Video Learner — Soul learns from YouTube and video content
 *
 * 1. YouTube transcript extraction (via innertube API / captions)
 * 2. Video summarization via LLM
 * 3. Key point extraction and memory storage
 * 4. Supports: YouTube, any URL with transcript/subtitles
 */

import { remember } from "../memory/memory-engine.js";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

// ─── Video Vision — Extract frames + analyze with Gemini Vision ───

/**
 * Check if ffmpeg is available
 */
export function hasFfmpeg(): boolean {
  try { execSync("ffmpeg -version", { stdio: "pipe", timeout: 5000 }); return true; } catch { return false; }
}

/**
 * Download YouTube video (audio+video) to temp file using yt-dlp or fallback
 */
async function downloadVideo(url: string): Promise<string | null> {
  const tempDir = join(tmpdir(), "soul-video-" + Date.now());
  mkdirSync(tempDir, { recursive: true });
  const outPath = join(tempDir, "video.mp4");

  // Try yt-dlp first
  try {
    execSync(`yt-dlp -f "best[height<=720]" -o "${outPath}" "${url}"`, { timeout: 120000, stdio: "pipe" });
    if (existsSync(outPath)) return outPath;
  } catch { /* yt-dlp not available */ }

  // Fallback: try youtube-dl
  try {
    execSync(`youtube-dl -f "best[height<=720]" -o "${outPath}" "${url}"`, { timeout: 120000, stdio: "pipe" });
    if (existsSync(outPath)) return outPath;
  } catch { /* youtube-dl not available */ }

  return null;
}

/**
 * Extract frames from video file using ffmpeg
 * One frame every N seconds
 */
export function extractFrames(videoPath: string, intervalSec: number = 30, maxFrames: number = 10): string[] {
  if (!hasFfmpeg()) return [];
  const frameDir = join(tmpdir(), "soul-frames-" + Date.now());
  mkdirSync(frameDir, { recursive: true });

  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${intervalSec}" -frames:v ${maxFrames} -q:v 2 "${join(frameDir, "frame_%03d.jpg")}"`,
      { timeout: 60000, stdio: "pipe" },
    );
    return readdirSync(frameDir)
      .filter(f => f.endsWith(".jpg"))
      .sort()
      .map(f => join(frameDir, f));
  } catch {
    return [];
  }
}

/**
 * Analyze video frames using Gemini Vision API
 */
export async function analyzeFrames(framePaths: string[], context?: string): Promise<string> {
  if (framePaths.length === 0) return "No frames to analyze.";

  try {
    // Use Gemini Vision API
    const { getRawDb } = await import("../db/index.js");
    const db = getRawDb();
    const geminiConfig = db.prepare(
      "SELECT api_key FROM soul_llm_config WHERE provider_id = 'gemini' AND is_active = 1"
    ).get() as any;

    if (!geminiConfig?.api_key) return "Gemini API key needed for vision analysis.";

    let apiKey = geminiConfig.api_key;
    try {
      const { safeDecryptSecret } = await import("./security.js");
      const decrypted = safeDecryptSecret(apiKey);
      if (decrypted) apiKey = decrypted;
    } catch { /* use raw */ }

    // Encode frames as base64
    const imageParts = framePaths.slice(0, 5).map(fp => {
      const data = readFileSync(fp);
      return {
        inlineData: {
          mimeType: "image/jpeg",
          data: data.toString("base64"),
        },
      };
    });

    const prompt = context
      ? `Analyze these video frames. Context: ${context}\n\nDescribe what you see in each frame, then summarize the overall content. Respond in Thai.`
      : "Analyze these video frames. Describe what you see and summarize the overall video content. Respond in Thai.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              ...imageParts,
            ],
          }],
        }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!response.ok) return `Vision API error: ${response.status}`;
    const data = await response.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available.";
  } catch (e: any) {
    return `Vision analysis failed: ${e.message}`;
  }
}

/**
 * Full video analysis: download → extract frames → vision AI → summarize
 */
export async function analyzeVideo(url: string): Promise<{
  success: boolean;
  title: string;
  frameCount: number;
  analysis: string;
  message: string;
}> {
  // Get info first
  const videoId = extractYouTubeId(url);
  const info = videoId ? await getYouTubeInfo(videoId) : { title: url, channel: "Unknown" };

  // Download video
  const videoPath = await downloadVideo(url);
  if (!videoPath) {
    return {
      success: false, title: info.title, frameCount: 0, analysis: "",
      message: "ดาวน์โหลดวิดีโอไม่ได้ — ต้องติดตั้ง yt-dlp: pip install yt-dlp",
    };
  }

  // Extract frames
  const frames = extractFrames(videoPath, 30, 8);
  if (frames.length === 0) {
    return {
      success: false, title: info.title, frameCount: 0, analysis: "",
      message: "ดึง frame ไม่ได้ — ตรวจสอบ ffmpeg",
    };
  }

  // Analyze with Vision AI
  const transcript = videoId ? await getYouTubeTranscript(videoId) : "";
  const analysis = await analyzeFrames(frames, transcript ? `Transcript: ${transcript.substring(0, 2000)}` : undefined);

  // Remember
  await remember({
    content: `[Video Analysis] "${info.title}"\nFrames: ${frames.length}\nAnalysis: ${analysis.substring(0, 500)}`,
    type: "knowledge" as any,
    tags: ["video", "vision", "analysis"],
    source: "video-learner",
  });

  // Cleanup frames
  try {
    for (const f of frames) unlinkSync(f);
  } catch { /* ok */ }

  return {
    success: true,
    title: info.title,
    frameCount: frames.length,
    analysis,
    message: `วิเคราะห์วิดีโอ "${info.title}" เสร็จ — ${frames.length} frames, vision AI analyzed`,
  };
}
