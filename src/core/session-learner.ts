/**
 * Session Learner — Soul learns LESSONS from Claude Code, not logs
 *
 * Instead of recording every command, Soul learns:
 * 1. What bug was fixed and HOW
 * 2. What feature was built and WHY
 * 3. What mistake was made and what to AVOID
 * 4. What tool/library was used and WHEN to use it
 *
 * Triggered at end of coding session — summarizes with LLM → stores as wisdom
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

/**
 * Summarize a coding session into lessons
 * Takes raw git diff/log and extracts wisdom
 */
export async function learnFromSession(input: {
  project: string;
  gitLog?: string;
  gitDiff?: string;
  summary?: string;
  agent?: string;
}): Promise<{ success: boolean; lessons: string[]; message: string }> {
  const lessons: string[] = [];

  // If summary provided directly, use it
  if (input.summary) {
    await remember({
      content: `[Session Lesson] ${input.project}: ${input.summary}`,
      type: "learning" as any,
      tags: ["session", "lesson", input.project, input.agent || "claude-code"],
      source: "session-learner",
    });
    lessons.push(input.summary);
    return { success: true, lessons, message: `Learned: ${input.summary}` };
  }

  // Use git log + diff to generate lessons via LLM
  const context = [
    input.gitLog ? `Git Log:\n${input.gitLog.substring(0, 2000)}` : "",
    input.gitDiff ? `Changes:\n${input.gitDiff.substring(0, 3000)}` : "",
  ].filter(Boolean).join("\n\n");

  if (!context) {
    return { success: false, lessons: [], message: "No git log or summary provided" };
  }

  try {
    const { chat } = await import("./llm-connector.js");
    const response = await chat([
      {
        role: "system",
        content: `You extract LESSONS from a coding session. Not logs, not commands — LESSONS.

For each lesson, write ONE sentence in Thai that answers:
- What was the problem?
- How was it solved?
- What should we remember for next time?

Format: Return a JSON array of strings. Max 5 lessons.
Example: ["แก้ bug token หมดอายุ — เก็บ token ใน SQLite แทน memory เพื่อให้อยู่รอด restart", "Gemini Flash ฟรี 1M token/วัน ดีกว่า Groq 10K/นาที สำหรับ Soul"]`,
      },
      {
        role: "user",
        content: `Project: ${input.project}\n\n${context}`,
      },
    ], { temperature: 0.3 });

    try {
      const parsed = JSON.parse(response.content || "[]");
      if (Array.isArray(parsed)) {
        for (const lesson of parsed.slice(0, 5)) {
          if (typeof lesson === "string" && lesson.length > 10) {
            await remember({
              content: `[Session Lesson] ${input.project}: ${lesson}`,
              type: "learning" as any,
              tags: ["session", "lesson", input.project],
              source: "session-learner",
            });
            lessons.push(lesson);
          }
        }
      }
    } catch {
      // LLM didn't return valid JSON — store raw summary
      const raw = (response.content || "").substring(0, 300);
      if (raw.length > 20) {
        await remember({
          content: `[Session Lesson] ${input.project}: ${raw}`,
          type: "learning" as any,
          tags: ["session", "lesson", input.project],
          source: "session-learner",
        });
        lessons.push(raw);
      }
    }
  } catch (e: any) {
    return { success: false, lessons: [], message: `LLM failed: ${e.message}` };
  }

  return {
    success: lessons.length > 0,
    lessons,
    message: lessons.length > 0
      ? `เรียนรู้ ${lessons.length} บทเรียนจาก ${input.project}`
      : "ไม่พบบทเรียนจาก session นี้",
  };
}

/**
 * Quick lesson — master tells Soul what they learned
 */
export async function quickLesson(lesson: string, project?: string): Promise<string> {
  await remember({
    content: `[Lesson] ${project ? project + ": " : ""}${lesson}`,
    type: "learning" as any,
    tags: ["lesson", "quick", ...(project ? [project] : [])],
    source: "master",
  });
  return `จำบทเรียนไว้แล้ว: ${lesson}`;
}

/**
 * Get all lessons for a project
 */
export function getLessons(project?: string, limit: number = 20): Array<{ id: number; content: string; createdAt: string }> {
  const db = getRawDb();
  const query = project
    ? "SELECT id, content, created_at FROM memories WHERE is_active = 1 AND content LIKE ? AND tags LIKE '%lesson%' ORDER BY created_at DESC LIMIT ?"
    : "SELECT id, content, created_at FROM memories WHERE is_active = 1 AND tags LIKE '%lesson%' ORDER BY created_at DESC LIMIT ?";
  const params = project ? [`%${project}%`, limit] : [limit];
  return (db.prepare(query).all(...params) as any[]).map(r => ({
    id: r.id, content: r.content, createdAt: r.created_at,
  }));
}
