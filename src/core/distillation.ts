/**
 * Knowledge Distillation — Soul learns from Teacher LLM (Claude/GPT/etc.)
 *
 * Collects high-quality Q&A pairs from interactions with powerful LLMs,
 * then exports them as training data to fine-tune smaller models.
 *
 * Flow:
 * 1. Every Claude interaction → auto-collect Q&A pair
 * 2. Rate/filter quality (only keep good answers)
 * 3. Export as JSONL for fine-tuning
 * 4. Fine-tune small model (qwen3:8b) → becomes Soul's own brain
 * 5. Repeat — Soul gets smarter with each cycle
 */

import { getRawDb } from "../db/index.js";

// ─── Database ───

function ensureDistillTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_distillation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_prompt TEXT NOT NULL DEFAULT '',
      user_message TEXT NOT NULL,
      assistant_response TEXT NOT NULL,
      teacher_model TEXT NOT NULL DEFAULT 'unknown',
      category TEXT NOT NULL DEFAULT 'general',
      quality_score INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_distill_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_pairs INTEGER NOT NULL DEFAULT 0,
      verified_pairs INTEGER NOT NULL DEFAULT 0,
      exported_at TEXT,
      fine_tune_model TEXT,
      fine_tune_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ─── Collect Training Pair ───

export function collectTrainingPair(input: {
  systemPrompt?: string;
  userMessage: string;
  assistantResponse: string;
  teacherModel?: string;
  category?: string;
  qualityScore?: number;
  tokensUsed?: number;
}): { id: number; totalPairs: number } {
  ensureDistillTable();
  const rawDb = getRawDb();

  // Auto-categorize
  const category = input.category || autoCategory(input.userMessage);

  // Auto quality score based on response length and structure
  const quality = input.qualityScore ?? autoQualityScore(input.assistantResponse);

  const result = rawDb.prepare(`
    INSERT INTO soul_distillation
    (system_prompt, user_message, assistant_response, teacher_model, category, quality_score, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.systemPrompt || "",
    input.userMessage,
    input.assistantResponse,
    input.teacherModel || "unknown",
    category,
    quality,
    input.tokensUsed || 0
  );

  const count = rawDb.prepare("SELECT COUNT(*) as c FROM soul_distillation").get() as any;

  return {
    id: Number(result.lastInsertRowid),
    totalPairs: count?.c || 0,
  };
}

// ─── Auto-categorize question ───

function autoCategory(message: string): string {
  const lower = message.toLowerCase();

  const categories: [string, RegExp[]][] = [
    ["coding", [/code|โค้ด|program|function|class|api|debug|bug|error|sql|python|javascript|typescript/]],
    ["reasoning", [/why|ทำไม|อธิบาย|explain|analyze|วิเคราะห์|เปรียบเทียบ|compare/]],
    ["math", [/คำนวณ|calculate|math|สมการ|equation|\d+.*[+\-*/]/]],
    ["creative", [/เขียน|write|story|poem|essay|blog|สร้าง/]],
    ["knowledge", [/คือ|what is|define|history|ประวัติ|ข้อมูล/]],
    ["planning", [/plan|วางแผน|strategy|design|ออกแบบ|how to|ยังไง/]],
    ["conversation", [/สวัสดี|hello|hi|thanks|ขอบคุณ|opinion|คิดยังไง/]],
  ];

  for (const [cat, patterns] of categories) {
    if (patterns.some(p => p.test(lower))) return cat;
  }
  return "general";
}

// ─── Auto quality score (1-10) ───

function autoQualityScore(response: string): number {
  let score = 5; // baseline

  // Longer = more detailed (up to a point)
  if (response.length > 200) score += 1;
  if (response.length > 500) score += 1;
  if (response.length > 1000) score += 1;

  // Has code blocks
  if (response.includes("```")) score += 1;

  // Has structured content (lists, headers)
  if (/^\d+\.|^-|^•|^#/m.test(response)) score += 1;

  // Too short = probably low quality
  if (response.length < 50) score -= 2;

  // Error messages = bad
  if (/error|failed|sorry|can't/i.test(response)) score -= 1;

  return Math.max(1, Math.min(10, score));
}

// ─── Rate a training pair ───

export function rateTrainingPair(id: number, score: number, verified: boolean = false): boolean {
  ensureDistillTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_distillation SET quality_score = ?, is_verified = ? WHERE id = ?"
  ).run(score, verified ? 1 : 0, id);
  return result.changes > 0;
}

// ─── Export as Training Data (JSONL) ───

export function exportTrainingData(options?: {
  minQuality?: number;
  verifiedOnly?: boolean;
  category?: string;
  format?: "chatml" | "alpaca" | "sharegpt";
  limit?: number;
}): { data: string; count: number; format: string } {
  ensureDistillTable();
  const rawDb = getRawDb();

  const minQ = options?.minQuality ?? 6;
  const format = options?.format ?? "chatml";
  const limit = options?.limit ?? 100000;

  let where = "WHERE quality_score >= ?";
  const params: any[] = [minQ];

  if (options?.verifiedOnly) {
    where += " AND is_verified = 1";
  }
  if (options?.category) {
    where += " AND category = ?";
    params.push(options.category);
  }

  const rows = rawDb.prepare(`
    SELECT system_prompt, user_message, assistant_response, category
    FROM soul_distillation
    ${where}
    ORDER BY quality_score DESC, id DESC
    LIMIT ?
  `).all(...params, limit) as any[];

  let lines: string[] = [];

  for (const row of rows) {
    switch (format) {
      case "chatml": {
        // ChatML format — works with most fine-tuning tools
        const entry = {
          messages: [
            ...(row.system_prompt ? [{ role: "system", content: row.system_prompt }] : []),
            { role: "user", content: row.user_message },
            { role: "assistant", content: row.assistant_response },
          ],
        };
        lines.push(JSON.stringify(entry));
        break;
      }
      case "alpaca": {
        // Alpaca format — instruction/input/output
        const entry = {
          instruction: row.user_message,
          input: "",
          output: row.assistant_response,
          ...(row.system_prompt ? { system: row.system_prompt } : {}),
        };
        lines.push(JSON.stringify(entry));
        break;
      }
      case "sharegpt": {
        // ShareGPT format — conversations array
        const entry = {
          conversations: [
            { from: "human", value: row.user_message },
            { from: "gpt", value: row.assistant_response },
          ],
          ...(row.system_prompt ? { system: row.system_prompt } : {}),
        };
        lines.push(JSON.stringify(entry));
        break;
      }
    }
  }

  return {
    data: lines.join("\n"),
    count: lines.length,
    format,
  };
}

// ─── Get Stats ───

export function getDistillStats(): {
  totalPairs: number;
  verifiedPairs: number;
  avgQuality: number;
  byCategory: Record<string, number>;
  byTeacher: Record<string, number>;
  readyForExport: number;
  estimatedTrainTime: string;
} {
  ensureDistillTable();
  const rawDb = getRawDb();

  const total = rawDb.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified,
      AVG(quality_score) as avg_q,
      SUM(CASE WHEN quality_score >= 6 THEN 1 ELSE 0 END) as ready
    FROM soul_distillation
  `).get() as any;

  const byCat = rawDb.prepare(`
    SELECT category, COUNT(*) as c FROM soul_distillation GROUP BY category ORDER BY c DESC
  `).all() as any[];

  const byTeacher = rawDb.prepare(`
    SELECT teacher_model, COUNT(*) as c FROM soul_distillation GROUP BY teacher_model ORDER BY c DESC
  `).all() as any[];

  const ready = total?.ready || 0;
  // Rough estimate: ~1 hour per 5000 pairs on RTX 4090
  const hours = Math.max(0.5, ready / 5000);

  return {
    totalPairs: total?.total || 0,
    verifiedPairs: total?.verified || 0,
    avgQuality: Math.round((total?.avg_q || 0) * 10) / 10,
    byCategory: Object.fromEntries(byCat.map(r => [r.category, r.c])),
    byTeacher: Object.fromEntries(byTeacher.map(r => [r.teacher_model, r.c])),
    readyForExport: ready,
    estimatedTrainTime: `~${hours.toFixed(1)} hours (RTX 4090)`,
  };
}

// ─── List recent pairs (for review) ───

export function getRecentPairs(limit: number = 20): Array<{
  id: number;
  userMessage: string;
  assistantResponse: string;
  teacherModel: string;
  category: string;
  qualityScore: number;
  isVerified: boolean;
  createdAt: string;
}> {
  ensureDistillTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(`
    SELECT id, user_message, assistant_response, teacher_model, category, quality_score, is_verified, created_at
    FROM soul_distillation
    ORDER BY id DESC LIMIT ?
  `).all(limit) as any[];

  return rows.map(r => ({
    id: r.id,
    userMessage: r.user_message,
    assistantResponse: r.assistant_response,
    teacherModel: r.teacher_model,
    category: r.category,
    qualityScore: r.quality_score,
    isVerified: r.is_verified === 1,
    createdAt: r.created_at,
  }));
}

// ─── Delete low quality ───

export function pruneLowQuality(maxScore: number = 3): number {
  ensureDistillTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "DELETE FROM soul_distillation WHERE quality_score <= ? AND is_verified = 0"
  ).run(maxScore);
  return result.changes;
}
