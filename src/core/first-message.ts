/**
 * First Message Magic — Smart daily greeting
 *
 * UPGRADE #11: When master starts a new session, Soul gives a smart greeting that includes:
 * 1. Time-aware greeting (morning/afternoon/evening)
 * 2. Pending dreams or insights since last session
 * 3. Unresolved contradictions to clarify
 * 4. Relevant reminders or follow-ups
 * 5. Activity summary since last interaction
 */

import { getRawDb } from "../db/index.js";

export interface FirstMessageContext {
  greeting: string;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  hoursSinceLastChat: number;
  pendingInsights: string[];
  pendingDreams: string[];
  unresolvedItems: string[];
  suggestedTopics: string[];
}

/**
 * Generate smart first message context for a new session
 */
export function generateFirstMessage(): FirstMessageContext {
  const now = new Date();
  const hour = now.getHours();

  // Time-aware greeting
  let timeOfDay: FirstMessageContext["timeOfDay"];
  let greeting: string;

  if (hour >= 5 && hour < 12) {
    timeOfDay = "morning";
    greeting = "อรุณสวัสดิ์ครับ";
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = "afternoon";
    greeting = "สวัสดีตอนบ่ายครับ";
  } else if (hour >= 17 && hour < 21) {
    timeOfDay = "evening";
    greeting = "สวัสดีตอนเย็นครับ";
  } else {
    timeOfDay = "night";
    greeting = "ดึกแล้วนะครับ";
  }

  // How long since last chat
  let hoursSinceLastChat = 0;
  try {
    const rawDb = getRawDb();
    const lastChat = rawDb.prepare(`
      SELECT created_at FROM soul_conversations
      ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    if (lastChat) {
      const lastTime = new Date(lastChat.created_at + "Z");
      hoursSinceLastChat = Math.round((now.getTime() - lastTime.getTime()) / (1000 * 60 * 60));
    }
  } catch { /* ok */ }

  // Pending dreams (insights Soul discovered while master was away)
  const pendingDreams: string[] = [];
  try {
    const rawDb = getRawDb();
    const dreams = rawDb.prepare(`
      SELECT content, type FROM soul_dreams
      WHERE was_shared = 0 AND confidence >= 0.5
      ORDER BY confidence DESC
      LIMIT 2
    `).all() as any[];

    for (const d of dreams) {
      pendingDreams.push(d.content);
    }
  } catch { /* ok */ }

  // Unresolved contradictions
  const unresolvedItems: string[] = [];
  try {
    const rawDb = getRawDb();
    const contradictions = rawDb.prepare(`
      SELECT topic, old_statement, new_statement FROM soul_contradiction_journal
      WHERE resolution = 'unresolved'
      ORDER BY created_at DESC
      LIMIT 2
    `).all() as any[];

    for (const c of contradictions) {
      unresolvedItems.push(`เรื่อง "${c.topic}": เคยบอกว่า "${c.old_statement}" แต่ล่าสุดบอกว่า "${c.new_statement}"`);
    }
  } catch { /* ok */ }

  // Suggested topics based on recent interests
  const suggestedTopics: string[] = [];
  try {
    const rawDb = getRawDb();
    const recentTopics = rawDb.prepare(`
      SELECT topics FROM soul_interaction_log
      WHERE created_at > datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT 20
    `).all() as any[];

    const topicCounts = new Map<string, number>();
    for (const r of recentTopics) {
      try {
        const topics = JSON.parse(r.topics || "[]");
        for (const t of topics) {
          if (t && t.length > 2) {
            topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
          }
        }
      } catch { /* skip */ }
    }

    const sorted = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [topic] of sorted) {
      suggestedTopics.push(topic);
    }
  } catch { /* ok */ }

  // Build pending insights
  const pendingInsights: string[] = [];
  if (hoursSinceLastChat > 0) {
    if (hoursSinceLastChat >= 24) {
      pendingInsights.push(`ห่างกันมา ${Math.floor(hoursSinceLastChat / 24)} วันแล้ว`);
    } else if (hoursSinceLastChat >= 2) {
      pendingInsights.push(`ห่างกันมา ${hoursSinceLastChat} ชั่วโมง`);
    }
  }

  return {
    greeting,
    timeOfDay,
    hoursSinceLastChat,
    pendingInsights,
    pendingDreams,
    unresolvedItems,
    suggestedTopics,
  };
}

/**
 * Format first message for display
 */
export async function formatFirstMessage(ctx: FirstMessageContext): Promise<string> {
  const parts: string[] = [ctx.greeting];

  // Time away
  if (ctx.pendingInsights.length > 0) {
    parts.push(ctx.pendingInsights.join(" "));
  }

  // Dreams
  if (ctx.pendingDreams.length > 0) {
    parts.push("\nระหว่างที่ไม่ได้คุยกัน ผมคิดเรื่องนี้:");
    for (const d of ctx.pendingDreams) {
      parts.push(`  • ${d}`);
    }
  }

  // Unresolved
  if (ctx.unresolvedItems.length > 0) {
    parts.push("\nมีเรื่องที่อยากถามเพิ่มเติม:");
    for (const u of ctx.unresolvedItems) {
      parts.push(`  • ${u}`);
    }
  }

  // Suggestions
  if (ctx.suggestedTopics.length > 0) {
    parts.push(`\nเรื่องที่คุณสนใจช่วงนี้: ${ctx.suggestedTopics.join(", ")}`);
  }

  // Proactive insights
  try {
    const { getTopInsight } = await import("./proactive-intelligence.js");
    const insight = getTopInsight();
    if (insight) {
      parts.push(`\n💡 ${insight.message}`);
    }
  } catch { /* ok */ }

  parts.push("\nมีอะไรให้ช่วยครับ?");

  return parts.join("\n");
}
