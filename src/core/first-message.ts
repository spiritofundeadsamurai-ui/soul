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

// ─── i18n: detect language from SOUL_LANG env or default to Thai ───
function getLang(): "th" | "en" {
  const env = process.env.SOUL_LANG?.toLowerCase();
  if (env === "en" || env === "english") return "en";
  return "th";
}

const i18n = {
  th: {
    morning: "อรุณสวัสดิ์ครับ",
    afternoon: "สวัสดีตอนบ่ายครับ",
    evening: "สวัสดีตอนเย็นครับ",
    night: "ดึกแล้วนะครับ",
    awayDays: (d: number) => `ห่างกันมา ${d} วันแล้ว`,
    awayHours: (h: number) => `ห่างกันมา ${h} ชั่วโมง`,
    dreamsIntro: "\nระหว่างที่ไม่ได้คุยกัน ผมคิดเรื่องนี้:",
    unresolvedIntro: "\nมีเรื่องที่อยากถามเพิ่มเติม:",
    contradiction: (topic: string, old_s: string, new_s: string) => `เรื่อง "${topic}": เคยบอกว่า "${old_s}" แต่ล่าสุดบอกว่า "${new_s}"`,
    interests: (topics: string) => `\nเรื่องที่คุณสนใจช่วงนี้: ${topics}`,
    ready: "\nมีอะไรให้ช่วยครับ?",
  },
  en: {
    morning: "Good morning!",
    afternoon: "Good afternoon!",
    evening: "Good evening!",
    night: "It's late!",
    awayDays: (d: number) => `It's been ${d} days since we last talked`,
    awayHours: (h: number) => `It's been ${h} hours since we last talked`,
    dreamsIntro: "\nWhile you were away, I thought about:",
    unresolvedIntro: "\nI have some follow-up questions:",
    contradiction: (topic: string, old_s: string, new_s: string) => `About "${topic}": you said "${old_s}" but later said "${new_s}"`,
    interests: (topics: string) => `\nYour recent interests: ${topics}`,
    ready: "\nHow can I help?",
  },
};

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

  const lang = getLang();
  const t = i18n[lang];

  if (hour >= 5 && hour < 12) {
    timeOfDay = "morning";
    greeting = t.morning;
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = "afternoon";
    greeting = t.afternoon;
  } else if (hour >= 17 && hour < 21) {
    timeOfDay = "evening";
    greeting = t.evening;
  } else {
    timeOfDay = "night";
    greeting = t.night;
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
      const lang = getLang();
      unresolvedItems.push(i18n[lang].contradiction(c.topic, c.old_statement, c.new_statement));
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
    const lang = getLang();
    if (hoursSinceLastChat >= 24) {
      pendingInsights.push(i18n[lang].awayDays(Math.floor(hoursSinceLastChat / 24)));
    } else if (hoursSinceLastChat >= 2) {
      pendingInsights.push(i18n[lang].awayHours(hoursSinceLastChat));
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

  const lang = getLang();
  const t = i18n[lang];

  // Dreams
  if (ctx.pendingDreams.length > 0) {
    parts.push(t.dreamsIntro);
    for (const d of ctx.pendingDreams) {
      parts.push(`  • ${d}`);
    }
  }

  // Unresolved
  if (ctx.unresolvedItems.length > 0) {
    parts.push(t.unresolvedIntro);
    for (const u of ctx.unresolvedItems) {
      parts.push(`  • ${u}`);
    }
  }

  // Suggestions
  if (ctx.suggestedTopics.length > 0) {
    parts.push(t.interests(ctx.suggestedTopics.join(", ")));
  }

  // Proactive insights
  try {
    const { getTopInsight } = await import("./proactive-intelligence.js");
    const insight = getTopInsight();
    if (insight) {
      parts.push(`\n💡 ${insight.message}`);
    }
  } catch { /* ok */ }

  parts.push(t.ready);

  return parts.join("\n");
}
