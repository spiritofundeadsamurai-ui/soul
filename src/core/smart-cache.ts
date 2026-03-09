/**
 * Smart Cache + Token Optimizer — ยิ่ง Soul เรียนรู้ ยิ่งใช้ token น้อยลง
 *
 * Strategy:
 * 1. Response Cache — คำถามเหมือนกัน/คล้ายกัน ตอบจาก cache
 * 2. Knowledge-First — ค้น memory ก่อนถาม LLM
 * 3. Model Cascade — คำถามง่ายใช้โมเดลเล็ก, ยากใช้ใหญ่
 * 4. Token Tracking — วัดผลว่าประหยัดไปเท่าไหร่
 */

import { getRawDb } from "../db/index.js";
import { hybridSearchWithScores } from "../memory/memory-engine.js";
import { getKnowledge } from "./knowledge.js";

// ─── Database ───

function ensureCacheTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_response_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_hash TEXT NOT NULL,
      query_text TEXT NOT NULL,
      response TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_hit_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    )
  `);
  rawDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_cache_hash ON soul_response_cache(query_hash)
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_token_savings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      cache_misses INTEGER NOT NULL DEFAULT 0,
      knowledge_hits INTEGER NOT NULL DEFAULT 0,
      cascade_savings INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ─── Hash for similarity matching ───

function hashQuery(query: string): string {
  // Normalize: lowercase, trim, remove extra spaces, remove punctuation
  const normalized = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:'"()]/g, "");

  // Simple hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const chr = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `q_${Math.abs(hash).toString(36)}`;
}

// ─── Cache Operations ───

export function getCachedResponse(query: string): { response: string; tokensSaved: number } | null {
  ensureCacheTable();
  const rawDb = getRawDb();
  const hash = hashQuery(query);

  const row = rawDb.prepare(`
    SELECT id, response, tokens_saved FROM soul_response_cache
    WHERE query_hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY hit_count DESC LIMIT 1
  `).get(hash) as any;

  if (!row) return null;

  // Update hit count
  rawDb.prepare(`
    UPDATE soul_response_cache SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id = ?
  `).run(row.id);

  // Track savings
  trackSavings({ tokensSaved: row.tokens_saved, cacheHits: 1 });

  return { response: row.response, tokensSaved: row.tokens_saved };
}

export function cacheResponse(query: string, response: string, tokensUsed: number, ttlHours?: number): void {
  ensureCacheTable();
  const rawDb = getRawDb();
  const hash = hashQuery(query);

  const expiresAt = ttlHours
    ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
    : null;

  // Check if exists
  const existing = rawDb.prepare(
    "SELECT id FROM soul_response_cache WHERE query_hash = ?"
  ).get(hash) as any;

  if (existing) {
    rawDb.prepare(`
      UPDATE soul_response_cache
      SET response = ?, tokens_saved = ?, last_hit_at = datetime('now')
      WHERE id = ?
    `).run(response, tokensUsed, existing.id);
  } else {
    rawDb.prepare(`
      INSERT INTO soul_response_cache (query_hash, query_text, response, tokens_saved, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(hash, query.substring(0, 500), response, tokensUsed, expiresAt);
  }
}

// ─── Knowledge-First Lookup ───

export async function knowledgeFirstLookup(query: string): Promise<{ found: boolean; answer: string; source: string } | null> {
  try {
    // Skip for very short/simple messages — not worth searching
    if (query.trim().length < 10) return null;

    // 1. Search memories (with scores for threshold filtering)
    const memories = await hybridSearchWithScores(query, 3);
    const strongMatch = memories.find((m) => m.score > 0.8);
    if (strongMatch) {
      trackSavings({ knowledgeHits: 1, tokensSaved: 300 });
      return {
        found: true,
        answer: strongMatch.content,
        source: `memory #${strongMatch.id}`,
      };
    }

    // 2. Search knowledge base
    const knowledge = await getKnowledge(undefined, query, 3);
    if (knowledge.length > 0) {
      const best = knowledge[0] as any;
      // Check if knowledge entry is detailed enough to be a standalone answer
      if (best.content && best.content.length > 50) {
        trackSavings({ knowledgeHits: 1, tokensSaved: 400 });
        return {
          found: true,
          answer: `${best.title}: ${best.content}`,
          source: `knowledge [${best.category}]`,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Model Cascade ───

export interface CascadeConfig {
  simple: { providerId: string; modelId: string; maxTokens: number };
  medium: { providerId: string; modelId: string; maxTokens: number };
  complex: { providerId: string; modelId: string; maxTokens: number };
}

export function classifyComplexity(message: string): "simple" | "medium" | "complex" {
  const lower = message.toLowerCase();
  const len = message.length;

  // Simple: greetings, yes/no, short factual
  const simplePatterns = [
    /^(hi|hello|hey|สวัสดี|หวัดดี|ดี)/,
    /^(yes|no|ok|ใช่|ไม่|โอเค|ได้|ดี)/,
    /^(thanks|ขอบคุณ|thx)/,
    /เวลา|กี่โมง|วันนี้|what time|today/,
  ];
  if (len < 30 || simplePatterns.some(p => p.test(lower))) {
    return "simple";
  }

  // Complex: multi-step, code, analysis, research
  const complexPatterns = [
    /วิเคราะห์|analyze|analysis/,
    /เขียนโค้ด|write code|implement|สร้าง.*ระบบ/,
    /เปรียบเทียบ|compare|อธิบาย.*ละเอียด/,
    /วางแผน|plan|strategy|ออกแบบ|design/,
    /research|วิจัย|ค้นคว้า/,
    /debug|fix|แก้.*bug/,
    /step.by.step|ขั้นตอน/,
  ];
  if (len > 200 || complexPatterns.some(p => p.test(lower))) {
    return "complex";
  }

  return "medium";
}

export function getCascadeModel(
  complexity: "simple" | "medium" | "complex",
  cascade?: CascadeConfig
): { providerId: string; modelId: string } | null {
  if (!cascade) return null; // Use default

  switch (complexity) {
    case "simple": return cascade.simple;
    case "medium": return cascade.medium;
    case "complex": return cascade.complex;
  }
}

// ─── Token Savings Tracking ───

function trackSavings(data: {
  tokensUsed?: number;
  tokensSaved?: number;
  cacheHits?: number;
  cacheMisses?: number;
  knowledgeHits?: number;
  cascadeSavings?: number;
}) {
  try {
    ensureCacheTable();
    const rawDb = getRawDb();
    const today = new Date().toISOString().split("T")[0];

    const existing = rawDb.prepare(
      "SELECT id FROM soul_token_savings WHERE date = ?"
    ).get(today) as any;

    if (existing) {
      rawDb.prepare(`
        UPDATE soul_token_savings SET
          tokens_used = tokens_used + ?,
          tokens_saved = tokens_saved + ?,
          cache_hits = cache_hits + ?,
          cache_misses = cache_misses + ?,
          knowledge_hits = knowledge_hits + ?,
          cascade_savings = cascade_savings + ?
        WHERE id = ?
      `).run(
        data.tokensUsed || 0,
        data.tokensSaved || 0,
        data.cacheHits || 0,
        data.cacheMisses || 0,
        data.knowledgeHits || 0,
        data.cascadeSavings || 0,
        existing.id
      );
    } else {
      rawDb.prepare(`
        INSERT INTO soul_token_savings (date, tokens_used, tokens_saved, cache_hits, cache_misses, knowledge_hits, cascade_savings)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        today,
        data.tokensUsed || 0,
        data.tokensSaved || 0,
        data.cacheHits || 0,
        data.cacheMisses || 0,
        data.knowledgeHits || 0,
        data.cascadeSavings || 0
      );
    }
  } catch (err: any) {
    // Log but don't crash on tracking errors — non-critical for main flow
    if (process.env.DEBUG) console.error("[SmartCache] tracking error:", err.message);
  }
}

export function trackTokensUsed(tokens: number) {
  trackSavings({ tokensUsed: tokens, cacheMisses: 1 });
}

// ─── Stats ───

export function getTokenSavingsStats(): {
  totalUsed: number;
  totalSaved: number;
  savingsRate: string;
  cacheHitRate: string;
  knowledgeHits: number;
  byDay: Array<{ date: string; used: number; saved: number; rate: string }>;
} {
  ensureCacheTable();
  const rawDb = getRawDb();

  const total = rawDb.prepare(`
    SELECT
      SUM(tokens_used) as used,
      SUM(tokens_saved) as saved,
      SUM(cache_hits) as hits,
      SUM(cache_misses) as misses,
      SUM(knowledge_hits) as kh
    FROM soul_token_savings
  `).get() as any;

  const used = total?.used || 0;
  const saved = total?.saved || 0;
  const hits = total?.hits || 0;
  const misses = total?.misses || 0;
  const totalRequests = hits + misses;

  const byDay = (rawDb.prepare(`
    SELECT date, tokens_used as used, tokens_saved as saved
    FROM soul_token_savings
    ORDER BY date DESC LIMIT 30
  `).all() as any[]).map(d => ({
    date: d.date,
    used: d.used,
    saved: d.saved,
    rate: d.used + d.saved > 0
      ? `${((d.saved / (d.used + d.saved)) * 100).toFixed(1)}%`
      : "0%",
  }));

  return {
    totalUsed: used,
    totalSaved: saved,
    savingsRate: used + saved > 0
      ? `${((saved / (used + saved)) * 100).toFixed(1)}%`
      : "0%",
    cacheHitRate: totalRequests > 0
      ? `${((hits / totalRequests) * 100).toFixed(1)}%`
      : "0%",
    knowledgeHits: total?.kh || 0,
    byDay,
  };
}

export function getCacheStats(): {
  totalEntries: number;
  totalHits: number;
  topQueries: Array<{ query: string; hits: number; saved: number }>;
} {
  ensureCacheTable();
  const rawDb = getRawDb();

  const count = rawDb.prepare("SELECT COUNT(*) as c FROM soul_response_cache").get() as any;
  const totalHits = rawDb.prepare("SELECT SUM(hit_count) as h FROM soul_response_cache").get() as any;
  const top = rawDb.prepare(`
    SELECT query_text as query, hit_count as hits, tokens_saved * hit_count as saved
    FROM soul_response_cache
    ORDER BY hit_count DESC LIMIT 10
  `).all() as any[];

  return {
    totalEntries: count?.c || 0,
    totalHits: totalHits?.h || 0,
    topQueries: top,
  };
}

// ─── Cleanup ───

export function cleanExpiredCache(): number {
  ensureCacheTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "DELETE FROM soul_response_cache WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ).run();
  return result.changes;
}
