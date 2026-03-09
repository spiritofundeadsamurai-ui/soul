/**
 * Personality Drift — Soul's personality evolves to match master
 *
 * UPGRADE #9: Over time, Soul subtly adapts its:
 * 1. Humor style (dry, playful, sarcastic — matching master)
 * 2. Vocabulary level (technical, casual, mixed)
 * 3. Communication patterns (emoji usage, punctuation style)
 * 4. Topic expertise emphasis (what master cares about most)
 *
 * This happens gradually — tracked over many interactions.
 */

import { getRawDb } from "../db/index.js";

export interface PersonalityTraits {
  humorStyle: string;        // "dry" | "playful" | "sarcastic" | "minimal" | "warm"
  vocabularyLevel: string;   // "technical" | "casual" | "formal" | "mixed"
  emojiUsage: string;        // "none" | "minimal" | "moderate" | "frequent"
  responseStyle: string;     // "concise" | "detailed" | "balanced"
  primaryTopics: string[];   // top 5 topics master discusses
  adoptedPhrases: string[];  // phrases master uses frequently that Soul can mirror
}

function ensurePersonalityTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_personality_drift (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      samples INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_master_phrases (
      phrase TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Analyze a master's message and update personality drift data
 */
export function learnFromMasterMessage(message: string) {
  ensurePersonalityTable();
  const rawDb = getRawDb();

  // 1. Detect emoji usage
  const emojiCount = (message.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  const hasEmoji = emojiCount > 0;
  updateDriftValue(rawDb, "emoji_tendency", hasEmoji ? "yes" : "no");

  // 2. Detect vocabulary level
  const techWords = ["api", "database", "server", "function", "deploy", "config", "sql", "query", "code", "debug", "error", "schema", "type", "class", "module"];
  const casualMarkers = ["555", "ครับ", "จ้า", "นะ", "อะ", "lol", "haha", "btw", "rn", "tbh"];
  const formalMarkers = ["ขอ", "กรุณา", "สวัสดี", "ท่าน", "please", "could you", "would you"];

  const lower = message.toLowerCase();
  const techScore = techWords.filter(w => lower.includes(w)).length;
  const casualScore = casualMarkers.filter(w => lower.includes(w)).length;
  const formalScore = formalMarkers.filter(w => lower.includes(w)).length;

  if (techScore >= 2) updateDriftValue(rawDb, "vocabulary", "technical");
  else if (casualScore >= 2) updateDriftValue(rawDb, "vocabulary", "casual");
  else if (formalScore >= 2) updateDriftValue(rawDb, "vocabulary", "formal");
  else updateDriftValue(rawDb, "vocabulary", "mixed");

  // 3. Detect humor style
  const playfulMarkers = ["555", "haha", "lol", ":)", "😂", "🤣", "😄"];
  const sarcasmMarkers = ["ใช่สิ", "แน่นอน", "sure", "obviously", "right", "wow"];
  const warmMarkers = ["ขอบคุณ", "thanks", "appreciate", "love", "❤", "🙏"];

  if (playfulMarkers.some(m => lower.includes(m))) updateDriftValue(rawDb, "humor", "playful");
  else if (sarcasmMarkers.some(m => lower.includes(m))) updateDriftValue(rawDb, "humor", "dry");
  else if (warmMarkers.some(m => lower.includes(m))) updateDriftValue(rawDb, "humor", "warm");
  else updateDriftValue(rawDb, "humor", "minimal");

  // 4. Track response length preference
  if (message.length < 30) updateDriftValue(rawDb, "response_style", "concise");
  else if (message.length > 200) updateDriftValue(rawDb, "response_style", "detailed");
  else updateDriftValue(rawDb, "response_style", "balanced");

  // 5. Track recurring phrases (3+ words, appears 2+ times)
  const words = message.split(/\s+/);
  for (let i = 0; i < words.length - 2; i++) {
    const trigram = words.slice(i, i + 3).join(" ").toLowerCase();
    if (trigram.length > 8) { // meaningful phrases only
      try {
        rawDb.prepare(`
          INSERT INTO soul_master_phrases (phrase, count, last_seen)
          VALUES (?, 1, datetime('now'))
          ON CONFLICT(phrase) DO UPDATE SET
            count = count + 1,
            last_seen = datetime('now')
        `).run(trigram);
      } catch { /* ok */ }
    }
  }
}

/**
 * Get current personality drift profile
 */
export function getPersonalityProfile(): PersonalityTraits {
  ensurePersonalityTable();
  const rawDb = getRawDb();

  const traits: PersonalityTraits = {
    humorStyle: "warm",
    vocabularyLevel: "mixed",
    emojiUsage: "minimal",
    responseStyle: "balanced",
    primaryTopics: [],
    adoptedPhrases: [],
  };

  // Get drift values
  const rows = rawDb.prepare("SELECT key, value, samples FROM soul_personality_drift").all() as any[];
  const driftMap = new Map<string, Map<string, number>>();

  for (const r of rows) {
    if (!driftMap.has(r.key)) driftMap.set(r.key, new Map());
    driftMap.get(r.key)!.set(r.value, r.samples);
  }

  // Find dominant value for each trait
  traits.humorStyle = getDominantValue(driftMap.get("humor")) || "warm";
  traits.vocabularyLevel = getDominantValue(driftMap.get("vocabulary")) || "mixed";
  traits.responseStyle = getDominantValue(driftMap.get("response_style")) || "balanced";

  const emojiDominant = getDominantValue(driftMap.get("emoji_tendency")) || "no";
  const emojiSamples = driftMap.get("emoji_tendency");
  if (emojiSamples) {
    const yesCount = emojiSamples.get("yes") || 0;
    const totalCount = [...emojiSamples.values()].reduce((a, b) => a + b, 0);
    const emojiRatio = totalCount > 0 ? yesCount / totalCount : 0;
    if (emojiRatio > 0.5) traits.emojiUsage = "frequent";
    else if (emojiRatio > 0.2) traits.emojiUsage = "moderate";
    else if (emojiRatio > 0.05) traits.emojiUsage = "minimal";
    else traits.emojiUsage = "none";
  }

  // Get top phrases
  try {
    const phrases = rawDb.prepare(`
      SELECT phrase FROM soul_master_phrases
      WHERE count >= 3
      ORDER BY count DESC
      LIMIT 5
    `).all() as any[];
    traits.adoptedPhrases = phrases.map((p: any) => p.phrase);
  } catch { /* ok */ }

  // Get primary topics from interaction log
  try {
    const topicRows = rawDb.prepare(`
      SELECT topics FROM soul_interaction_log
      WHERE created_at > datetime('now', '-30 days')
      ORDER BY created_at DESC
      LIMIT 50
    `).all() as any[];

    const topicCounts = new Map<string, number>();
    for (const r of topicRows) {
      try {
        const topics = JSON.parse(r.topics || "[]");
        for (const t of topics) {
          if (t && t.length > 2) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
        }
      } catch { /* skip */ }
    }

    traits.primaryTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
  } catch { /* ok */ }

  return traits;
}

/**
 * Generate personality guidance for the system prompt
 */
export function getPersonalityGuidance(): string | null {
  const profile = getPersonalityProfile();
  const parts: string[] = [];

  // Only provide guidance if we have enough data
  let totalSamples = 0;
  try {
    const rawDb = getRawDb();
    const sum = rawDb.prepare("SELECT SUM(samples) as s FROM soul_personality_drift").get() as any;
    totalSamples = sum?.s || 0;
  } catch { /* ok */ }

  if (totalSamples < 10) return null; // not enough data yet

  parts.push("Personality adaptation (match master's style):");

  if (profile.humorStyle !== "minimal") {
    parts.push(`- Humor: ${profile.humorStyle} style`);
  }
  if (profile.vocabularyLevel !== "mixed") {
    parts.push(`- Vocabulary: ${profile.vocabularyLevel} level`);
  }
  if (profile.emojiUsage === "frequent") {
    parts.push("- Master uses emojis frequently — you may use them too");
  } else if (profile.emojiUsage === "none") {
    parts.push("- Master rarely uses emojis — avoid using them");
  }
  if (profile.responseStyle === "concise") {
    parts.push("- Master prefers concise responses — be brief");
  } else if (profile.responseStyle === "detailed") {
    parts.push("- Master likes detailed responses — elaborate when helpful");
  }

  if (profile.adoptedPhrases.length > 0) {
    parts.push(`- Master's common phrases: "${profile.adoptedPhrases.slice(0, 3).join('", "')}"`);
  }

  return parts.length > 1 ? parts.join("\n") : null;
}

// ─── Helpers ───

function updateDriftValue(rawDb: any, key: string, value: string) {
  try {
    rawDb.prepare(`
      INSERT INTO soul_personality_drift (key, value, samples, updated_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = CASE WHEN samples > excluded.samples THEN soul_personality_drift.value ELSE excluded.value END,
        samples = samples + 1,
        updated_at = datetime('now')
    `).run(key, value);
  } catch { /* ok */ }

  // Actually, we need to track each value separately for voting
  // Override the simple approach above with a multi-value tracker
  try {
    const compositeKey = `${key}`;
    // Check if this value already exists
    const existing = rawDb.prepare(
      "SELECT samples FROM soul_personality_drift WHERE key = ? AND value = ?"
    ).get(compositeKey, value) as any;

    if (existing) {
      rawDb.prepare(
        "UPDATE soul_personality_drift SET samples = samples + 1, updated_at = datetime('now') WHERE key = ? AND value = ?"
      ).run(compositeKey, value);
    }
    // The INSERT above already handles the case where it doesn't exist
  } catch { /* ok */ }
}

function getDominantValue(valueMap: Map<string, number> | undefined): string | null {
  if (!valueMap || valueMap.size === 0) return null;
  let maxVal = "";
  let maxCount = 0;
  for (const [v, c] of valueMap) {
    if (c > maxCount) { maxCount = c; maxVal = v; }
  }
  return maxVal;
}
