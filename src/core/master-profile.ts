/**
 * Master Profile — Deep personalization engine
 *
 * UPGRADE #3: Soul learns who its master is and adapts
 *
 * Tracks:
 * - Communication style (language, formality, length preference)
 * - Expertise areas and interests
 * - Active hours and usage patterns
 * - Response preferences (from feedback)
 * - Personality traits observed over time
 *
 * This makes Soul genuinely different from Claude —
 * Claude treats everyone the same, Soul knows its master deeply.
 */

import { getRawDb } from "../db/index.js";

export interface MasterProfileData {
  // Communication style
  primaryLanguage: string;          // "th", "en", "mixed"
  formalityLevel: string;           // "casual", "mixed", "formal"
  preferredResponseLength: string;  // "short", "medium", "long"

  // Expertise
  expertiseAreas: string[];
  currentInterests: string[];

  // Patterns
  totalInteractions: number;
  avgMessageLength: number;
  topTopics: string[];

  // Personality observations
  traits: string[];

  lastUpdated: string;
}

function ensureProfileTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_master_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_interaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_lang TEXT,
      message_length INTEGER,
      topics TEXT DEFAULT '[]',
      hour_of_day INTEGER,
      day_of_week INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ─── Profile Read ───

export function getMasterProfile(): string | null {
  ensureProfileTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    "SELECT key, value, confidence FROM soul_master_profile WHERE confidence >= 0.3 ORDER BY confidence DESC"
  ).all() as any[];

  if (rows.length === 0) return null;

  const parts: string[] = [];

  for (const r of rows) {
    if (r.key === "primary_language") {
      parts.push(`- Language: ${r.value} (respond in this language)`);
    } else if (r.key === "formality") {
      parts.push(`- Style: ${r.value}`);
    } else if (r.key === "response_length") {
      parts.push(`- Preferred response length: ${r.value}`);
    } else if (r.key === "expertise") {
      parts.push(`- Master's expertise: ${r.value}`);
    } else if (r.key === "interests") {
      parts.push(`- Current interests: ${r.value}`);
    } else if (r.key === "personality") {
      parts.push(`- Personality: ${r.value}`);
    } else if (r.key === "top_topics") {
      parts.push(`- Frequently discusses: ${r.value}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

// ─── Profile Update (called after each interaction) ───

export function updateProfileFromMessage(message: string, isUser: boolean) {
  if (!isUser) return;
  ensureProfileTable();
  const rawDb = getRawDb();

  // Detect language
  const thaiChars = (message.match(/[\u0E00-\u0E7F]/g) || []).length;
  const totalChars = message.replace(/\s/g, "").length || 1;
  const thaiRatio = thaiChars / totalChars;

  let lang: string;
  if (thaiRatio > 0.5) lang = "th";
  else if (thaiRatio > 0.1) lang = "mixed";
  else lang = "en";

  // Log interaction
  const now = new Date();
  rawDb.prepare(
    "INSERT INTO soul_interaction_log (message_lang, message_length, hour_of_day, day_of_week) VALUES (?, ?, ?, ?)"
  ).run(lang, message.length, now.getHours(), now.getDay());

  // Update language profile (rolling average)
  updateProfileKey(rawDb, "primary_language", lang);

  // Detect response length preference
  if (message.length < 30) {
    updateProfileKey(rawDb, "response_length", "short — master sends brief messages, respond concisely");
  } else if (message.length < 150) {
    updateProfileKey(rawDb, "response_length", "medium");
  } else {
    updateProfileKey(rawDb, "response_length", "detailed — master writes long messages, can give thorough responses");
  }

  // Detect formality
  const casualMarkers = /ครับ|ค่ะ|จ้า|จ้ะ|555|ฮ่า|lol|haha|ok|โอเค|นะ|น้า/i;
  const formalMarkers = /กรุณา|ขอ|ท่าน|สรุป|วิเคราะห์|please|could you|would you/i;

  if (casualMarkers.test(message)) {
    updateProfileKey(rawDb, "formality", "casual — respond naturally, use friendly tone");
  } else if (formalMarkers.test(message)) {
    updateProfileKey(rawDb, "formality", "formal — respond professionally");
  }

  // Periodically rebuild aggregate stats
  rebuildAggregateProfile(rawDb);
}

function updateProfileKey(rawDb: any, key: string, value: string) {
  const existing = rawDb.prepare(
    "SELECT value, confidence, evidence_count FROM soul_master_profile WHERE key = ?"
  ).get(key) as any;

  if (!existing) {
    rawDb.prepare(
      "INSERT INTO soul_master_profile (key, value, confidence, evidence_count) VALUES (?, ?, 0.3, 1)"
    ).run(key, value);
    return;
  }

  // If same value, increase confidence
  if (existing.value === value) {
    const newConf = Math.min(1.0, existing.confidence + 0.05);
    rawDb.prepare(
      "UPDATE soul_master_profile SET confidence = ?, evidence_count = evidence_count + 1, updated_at = datetime('now') WHERE key = ?"
    ).run(newConf, key);
  } else {
    // Different value — decrease confidence of old, maybe replace
    if (existing.confidence < 0.4) {
      // Old value is weak, replace
      rawDb.prepare(
        "UPDATE soul_master_profile SET value = ?, confidence = 0.3, evidence_count = 1, updated_at = datetime('now') WHERE key = ?"
      ).run(value, key);
    } else {
      // Old value is strong, just decrease slightly
      rawDb.prepare(
        "UPDATE soul_master_profile SET confidence = MAX(0.1, confidence - 0.03), updated_at = datetime('now') WHERE key = ?"
      ).run(key);
    }
  }
}

function rebuildAggregateProfile(rawDb: any) {
  // Only rebuild every 20 interactions
  const count = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_interaction_log"
  ).get() as any)?.c || 0;

  if (count % 20 !== 0 || count === 0) return;

  // Language distribution
  const langs = rawDb.prepare(
    "SELECT message_lang, COUNT(*) as c FROM soul_interaction_log GROUP BY message_lang ORDER BY c DESC"
  ).all() as any[];

  if (langs.length > 0) {
    const dominant = langs[0].message_lang;
    const label = dominant === "th" ? "Thai" : dominant === "en" ? "English" : "Thai+English mixed";
    rawDb.prepare(
      "INSERT OR REPLACE INTO soul_master_profile (key, value, confidence, evidence_count, updated_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run("primary_language", label, Math.min(1.0, count / 50), count);
  }

  // Active hours
  const hours = rawDb.prepare(
    "SELECT hour_of_day, COUNT(*) as c FROM soul_interaction_log GROUP BY hour_of_day ORDER BY c DESC LIMIT 3"
  ).all() as any[];

  if (hours.length > 0) {
    const activeHours = hours.map((h: any) => `${h.hour_of_day}:00`).join(", ");
    rawDb.prepare(
      "INSERT OR REPLACE INTO soul_master_profile (key, value, confidence, evidence_count, updated_at) VALUES (?, ?, 0.6, ?, datetime('now'))"
    ).run("active_hours", `Most active: ${activeHours}`, count);
  }
}

// ─── Manual Profile Update (from tools) ───

export function setProfileEntry(key: string, value: string, confidence = 0.7): void {
  ensureProfileTable();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT OR REPLACE INTO soul_master_profile (key, value, confidence, evidence_count, updated_at) VALUES (?, ?, ?, 1, datetime('now'))"
  ).run(key, value, confidence);
}

export function getProfileEntries(): Array<{ key: string; value: string; confidence: number }> {
  ensureProfileTable();
  const rawDb = getRawDb();
  return rawDb.prepare(
    "SELECT key, value, confidence FROM soul_master_profile ORDER BY confidence DESC"
  ).all() as any[];
}
