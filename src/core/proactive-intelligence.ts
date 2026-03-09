/**
 * Proactive Intelligence — Soul tells master things without being asked
 *
 * UPGRADE #23: Soul becomes proactive:
 * 1. "I noticed you've been asking about X a lot — here's a summary"
 * 2. "Based on your patterns, you might find this useful..."
 * 3. "Your knowledge about X is outdated — want me to refresh?"
 * 4. "You haven't reviewed your goals in 7 days"
 * 5. "I found a connection between two things you asked about separately"
 */

import { getRawDb } from "../db/index.js";

export interface ProactiveInsight {
  type: "trend" | "reminder" | "connection" | "stale" | "suggestion";
  priority: number;  // 1-10 (10 = most important)
  message: string;
  actionable: boolean;
  expiresAt?: string; // ISO date — after this, don't show
}

/**
 * Generate proactive insights based on current state
 */
export function generateProactiveInsights(): ProactiveInsight[] {
  const insights: ProactiveInsight[] = [];
  const rawDb = getRawDb();

  // 1. Stale knowledge detection
  try {
    const stale = rawDb.prepare(`
      SELECT COUNT(*) as c FROM soul_knowledge
      WHERE updated_at < datetime('now', '-30 days')
      AND confidence > 0.3
      AND use_count >= 2
    `).get() as any;

    if (stale?.c > 5) {
      insights.push({
        type: "stale",
        priority: 6,
        message: `มีความรู้ ${stale.c} รายการที่ไม่ได้อัปเดตมากกว่า 30 วัน อาจจะเก่าไปแล้ว`,
        actionable: true,
      });
    }
  } catch { /* ok */ }

  // 2. Goal neglect detection
  try {
    const neglectedGoals = rawDb.prepare(`
      SELECT content FROM memories
      WHERE type = 'goal' AND tags LIKE '%active%'
      AND created_at < datetime('now', '-7 days')
      LIMIT 3
    `).all() as any[];

    if (neglectedGoals.length > 0) {
      insights.push({
        type: "reminder",
        priority: 7,
        message: `มีเป้าหมายที่ยังไม่ได้ตรวจสอบ ${neglectedGoals.length} รายการ: "${neglectedGoals[0].content?.substring(0, 60)}"`,
        actionable: true,
      });
    }
  } catch { /* ok */ }

  // 3. Topic trend detection
  try {
    const trending = rawDb.prepare(`
      SELECT pattern, frequency FROM soul_active_learning
      WHERE category = 'topic' AND frequency >= 5
      AND last_seen > datetime('now', '-3 days')
      ORDER BY frequency DESC LIMIT 1
    `).get() as any;

    if (trending) {
      insights.push({
        type: "trend",
        priority: 5,
        message: `ช่วงนี้คุณสนใจเรื่อง "${trending.pattern}" มาก (${trending.frequency} ครั้ง) — ต้องการให้ผมสรุปสิ่งที่รู้เกี่ยวกับเรื่องนี้มั้ย?`,
        actionable: true,
      });
    }
  } catch { /* ok */ }

  // 4. Unresolved contradiction reminder
  try {
    const contradictions = rawDb.prepare(`
      SELECT COUNT(*) as c FROM soul_contradiction_journal
      WHERE resolution = 'unresolved'
    `).get() as any;

    if (contradictions?.c > 0) {
      insights.push({
        type: "connection",
        priority: 4,
        message: `มีเรื่องที่คุณเคยพูดขัดแย้งกัน ${contradictions.c} เรื่อง ยังไม่ได้ชี้แจง`,
        actionable: true,
      });
    }
  } catch { /* ok */ }

  // 5. Memory correction pattern
  try {
    const corrections = rawDb.prepare(`
      SELECT COUNT(*) as c FROM soul_memory_corrections
      WHERE created_at > datetime('now', '-7 days')
    `).get() as any;

    if (corrections?.c >= 3) {
      insights.push({
        type: "suggestion",
        priority: 8,
        message: `สัปดาห์นี้มีการแก้ไขความจำผิด ${corrections.c} ครั้ง ผมจะระมัดระวังมากขึ้นในเรื่องที่มักผิดพลาด`,
        actionable: false,
      });
    }
  } catch { /* ok */ }

  // 6. Pending dreams worth sharing
  try {
    const dreams = rawDb.prepare(`
      SELECT COUNT(*) as c FROM soul_dreams
      WHERE was_shared = 0 AND confidence >= 0.7
    `).get() as any;

    if (dreams?.c > 0) {
      insights.push({
        type: "connection",
        priority: 3,
        message: `ผมค้นพบความเชื่อมโยงใหม่ ${dreams.c} เรื่อง ระหว่างความรู้ที่มี ต้องการฟังมั้ย?`,
        actionable: true,
      });
    }
  } catch { /* ok */ }

  // 7. Quality trend alert
  try {
    const qualityDip = rawDb.prepare(`
      SELECT AVG(overall) as recent_avg FROM soul_response_quality
      ORDER BY created_at DESC LIMIT 10
    `).get() as any;

    const qualityBaseline = rawDb.prepare(`
      SELECT AVG(overall) as baseline_avg FROM soul_response_quality
    `).get() as any;

    if (qualityDip?.recent_avg && qualityBaseline?.baseline_avg) {
      if (qualityDip.recent_avg < qualityBaseline.baseline_avg - 0.1) {
        insights.push({
          type: "suggestion",
          priority: 9,
          message: `คุณภาพคำตอบล่าสุดลดลง (${Math.round(qualityDip.recent_avg * 100)}% vs เฉลี่ย ${Math.round(qualityBaseline.baseline_avg * 100)}%) — อาจต้องปรับปรุงวิธีคิด`,
          actionable: false,
        });
      }
    }
  } catch { /* ok */ }

  // Sort by priority (highest first)
  insights.sort((a, b) => b.priority - a.priority);
  return insights;
}

/**
 * Get top proactive insight for injection into greeting or response
 */
export function getTopInsight(): ProactiveInsight | null {
  const insights = generateProactiveInsights();
  return insights.length > 0 ? insights[0] : null;
}

/**
 * Format insights for display
 */
export function formatInsights(insights: ProactiveInsight[]): string {
  if (insights.length === 0) return "ไม่มีข้อสังเกตใหม่ในตอนนี้";

  const lines = insights.map(i => {
    const icon = i.type === "trend" ? "📈" : i.type === "reminder" ? "⏰" : i.type === "connection" ? "🔗" : i.type === "stale" ? "📦" : "💡";
    return `${icon} ${i.message}`;
  });

  return lines.join("\n");
}
