/**
 * Daily Digest — Auto-summary of everything that happened
 *
 * 1. What memories were created today
 * 2. What knowledge was gained
 * 3. Goals progress
 * 4. Mood summary
 * 5. Time spent
 * 6. Notifications
 * 7. Highlights and achievements
 */

import { getRawDb } from "../db/index.js";
import { getMemoryStats, getRecentMemories } from "../memory/memory-engine.js";

export interface DailyDigest {
  date: string;
  memoriesCreated: number;
  knowledgeGained: number;
  topTopics: string[];
  moodSummary: string;
  timeTracked: string;
  goalsProgress: string;
  highlights: string[];
  suggestions: string[];
}

export async function generateDailyDigest(date?: string): Promise<DailyDigest> {
  const rawDb = getRawDb();
  const targetDate = date || new Date().toISOString().substring(0, 10);

  // Count memories created today
  let memoriesCreated = 0;
  try {
    const memRow = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_memories WHERE date(created_at) = ?"
    ).get(targetDate) as any;
    memoriesCreated = memRow?.c || 0;
  } catch { /* table might not exist */ }

  // Knowledge gained
  let knowledgeGained = 0;
  try {
    const knRow = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_knowledge WHERE date(created_at) = ?"
    ).get(targetDate) as any;
    knowledgeGained = knRow?.c || 0;
  } catch { /* table might not exist */ }

  // Mood summary
  let moodSummary = "No mood data";
  try {
    const moods = rawDb.prepare(
      "SELECT mood, COUNT(*) as c FROM soul_moods WHERE date(created_at) = ? GROUP BY mood ORDER BY c DESC"
    ).all(targetDate) as any[];
    if (moods.length > 0) {
      moodSummary = moods.map(m => `${m.mood} (${m.c}x)`).join(", ");
    }
  } catch { /* table might not exist */ }

  // Time tracked
  let timeTracked = "No time data";
  try {
    const timeRow = rawDb.prepare(
      "SELECT SUM(duration_min) as total FROM soul_time_entries WHERE date(started_at) = ? AND ended_at IS NOT NULL"
    ).get(targetDate) as any;
    if (timeRow?.total) {
      const hrs = Math.floor(timeRow.total / 60);
      const mins = Math.round(timeRow.total % 60);
      timeTracked = `${hrs}h ${mins}m tracked`;
    }
  } catch { /* table might not exist */ }

  // Goals progress
  let goalsProgress = "No active goals";
  try {
    const goals = rawDb.prepare(
      "SELECT status, COUNT(*) as c FROM soul_goals GROUP BY status"
    ).all() as any[];
    if (goals.length > 0) {
      goalsProgress = goals.map(g => `${g.status}: ${g.c}`).join(", ");
    }
  } catch { /* table might not exist */ }

  // Top topics from today's memories
  const topTopics: string[] = [];
  try {
    const tagRows = rawDb.prepare(
      "SELECT tags FROM soul_memories WHERE date(created_at) = ? AND tags != '[]'"
    ).all(targetDate) as any[];
    const tagCount: Record<string, number> = {};
    for (const r of tagRows) {
      try {
        const tags = JSON.parse(r.tags);
        for (const t of tags) {
          if (t && t !== "research" && t !== "url") {
            tagCount[t] = (tagCount[t] || 0) + 1;
          }
        }
      } catch { /* skip bad json */ }
    }
    const sorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    topTopics.push(...sorted.map(([tag]) => tag));
  } catch { /* table might not exist */ }

  // Highlights
  const highlights: string[] = [];
  if (memoriesCreated > 10) highlights.push(`Productive day! ${memoriesCreated} memories created`);
  if (knowledgeGained > 3) highlights.push(`${knowledgeGained} new knowledge entries`);

  // Suggestions
  const suggestions: string[] = [];
  if (memoriesCreated === 0) suggestions.push("No new memories today — try researching something interesting");
  if (moodSummary === "No mood data") suggestions.push("Track your mood with soul_mood for emotional insights");
  if (timeTracked === "No time data") suggestions.push("Try soul_timer_start to track your productivity");

  return {
    date: targetDate,
    memoriesCreated,
    knowledgeGained,
    topTopics,
    moodSummary,
    timeTracked,
    goalsProgress,
    highlights,
    suggestions,
  };
}

/**
 * Generate a weekly summary
 */
export async function generateWeeklySummary(): Promise<string> {
  const rawDb = getRawDb();
  let summary = "=== Weekly Summary ===\n\n";

  // Last 7 days memories
  try {
    const memRow = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_memories WHERE created_at >= datetime('now', '-7 days')"
    ).get() as any;
    summary += `Memories: ${memRow?.c || 0} new\n`;
  } catch { summary += "Memories: N/A\n"; }

  // Knowledge
  try {
    const knRow = rawDb.prepare(
      "SELECT COUNT(*) as c FROM soul_knowledge WHERE created_at >= datetime('now', '-7 days')"
    ).get() as any;
    summary += `Knowledge: ${knRow?.c || 0} entries\n`;
  } catch { summary += "Knowledge: N/A\n"; }

  // Time
  try {
    const timeRow = rawDb.prepare(
      "SELECT SUM(duration_min) as total FROM soul_time_entries WHERE started_at >= datetime('now', '-7 days') AND ended_at IS NOT NULL"
    ).get() as any;
    if (timeRow?.total) {
      summary += `Time tracked: ${Math.round(timeRow.total / 60 * 10) / 10}h\n`;
    }
  } catch { /* skip */ }

  // Moods
  try {
    const moods = rawDb.prepare(
      "SELECT mood, COUNT(*) as c FROM soul_moods WHERE created_at >= datetime('now', '-7 days') GROUP BY mood ORDER BY c DESC"
    ).all() as any[];
    if (moods.length > 0) {
      summary += `Moods: ${moods.map(m => `${m.mood}(${m.c})`).join(", ")}\n`;
    }
  } catch { /* skip */ }

  return summary;
}
