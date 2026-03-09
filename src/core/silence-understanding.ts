/**
 * Silence Understanding — Adapt to master's absence and brevity patterns
 *
 * UPGRADE #12: Soul understands when master is:
 * 1. Away for a while (adjusts greeting intensity)
 * 2. Being brief (matches response length)
 * 3. Typing fast/slow (adjusts expectations)
 * 4. In "work mode" vs "chat mode" (adapts tone)
 */

import { getRawDb } from "../db/index.js";

export interface SilenceProfile {
  avgResponseTimeSec: number;    // how fast master usually responds
  avgMessageLength: number;      // typical message length
  currentMood: "chatty" | "brief" | "normal";
  isRushed: boolean;             // messages coming fast + short
  sessionMessageCount: number;   // messages in current session
  recentBrevity: number;         // 0-1, how brief recent messages are
}

/**
 * Analyze master's current interaction pattern
 */
export function analyzeInteractionPattern(
  currentMessage: string,
  sessionMessages: Array<{ role: string; content: string }>,
): SilenceProfile {
  const userMessages = sessionMessages.filter(m => m.role === "user");
  const sessionMessageCount = userMessages.length;

  // Average message length in this session
  const avgLen = userMessages.length > 0
    ? userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length
    : currentMessage.length;

  // Recent brevity (last 3 messages)
  const recent = userMessages.slice(-3);
  const recentAvgLen = recent.length > 0
    ? recent.reduce((sum, m) => sum + m.content.length, 0) / recent.length
    : currentMessage.length;

  const recentBrevity = Math.max(0, Math.min(1, 1 - (recentAvgLen / 200)));

  // Determine mood
  let currentMood: SilenceProfile["currentMood"] = "normal";
  if (recentAvgLen < 20 && sessionMessageCount >= 2) {
    currentMood = "brief";
  } else if (recentAvgLen > 100) {
    currentMood = "chatty";
  }

  // Check if master is rushed (short + frequent messages)
  const isRushed = currentMessage.length < 30 && sessionMessageCount >= 3 && recentBrevity > 0.7;

  return {
    avgResponseTimeSec: 0, // would need timestamps
    avgMessageLength: avgLen,
    currentMood,
    isRushed,
    sessionMessageCount,
    recentBrevity,
  };
}

/**
 * Get response length guidance based on master's pattern
 */
export function getResponseGuidance(profile: SilenceProfile): string {
  if (profile.isRushed) {
    return "Master is in a hurry. Keep responses VERY short and direct. 1-2 sentences max.";
  }

  if (profile.currentMood === "brief") {
    return "Master is being brief. Match their energy — short, concise responses. Don't over-explain.";
  }

  if (profile.currentMood === "chatty") {
    return "Master is in chat mode. You can be more detailed and conversational.";
  }

  return ""; // normal mode, no special guidance
}

/**
 * Track absence pattern — how long master typically stays away
 */
export function getAbsencePattern(): { avgHoursAway: number; longestAbsence: number; typicalReturnHour: number } {
  try {
    const rawDb = getRawDb();

    // Get session start times
    const sessions = rawDb.prepare(`
      SELECT MIN(created_at) as start_time
      FROM soul_conversations
      GROUP BY session_id
      ORDER BY start_time DESC
      LIMIT 20
    `).all() as any[];

    if (sessions.length < 2) {
      return { avgHoursAway: 0, longestAbsence: 0, typicalReturnHour: 9 };
    }

    // Calculate gaps between sessions
    const gaps: number[] = [];
    const returnHours: number[] = [];

    for (let i = 0; i < sessions.length - 1; i++) {
      const current = new Date(sessions[i].start_time + "Z");
      const previous = new Date(sessions[i + 1].start_time + "Z");
      const gapHours = (current.getTime() - previous.getTime()) / (1000 * 60 * 60);

      if (gapHours > 0.5) { // ignore gaps less than 30 min
        gaps.push(gapHours);
        returnHours.push(current.getHours());
      }
    }

    const avgHoursAway = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const longestAbsence = gaps.length > 0 ? Math.max(...gaps) : 0;

    // Most common return hour
    const hourCounts = new Map<number, number>();
    for (const h of returnHours) {
      hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
    }
    let typicalReturnHour = 9;
    let maxCount = 0;
    for (const [h, c] of hourCounts) {
      if (c > maxCount) { maxCount = c; typicalReturnHour = h; }
    }

    return {
      avgHoursAway: Math.round(avgHoursAway * 10) / 10,
      longestAbsence: Math.round(longestAbsence * 10) / 10,
      typicalReturnHour,
    };
  } catch {
    return { avgHoursAway: 0, longestAbsence: 0, typicalReturnHour: 9 };
  }
}
