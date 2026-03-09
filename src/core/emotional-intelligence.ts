/**
 * Emotional Intelligence Engine — Soul understands and responds to emotions
 *
 * What most AI lacks:
 * 1. Emotion detection from text
 * 2. Mood tracking over time
 * 3. Empathetic responses calibrated to emotional state
 * 4. Emotional memory — remember how master felt in past situations
 * 5. Stress detection and wellness suggestions
 * 6. Celebration of achievements
 */

import { getRawDb } from "../db/index.js";
import { remember, search } from "../memory/memory-engine.js";

export interface MoodEntry {
  id: number;
  mood: string;
  intensity: number; // 1-10
  context: string;
  triggers: string;
  suggestion: string;
  createdAt: string;
}

// Emotion keywords (Thai + English)
const EMOTION_MAP: Record<string, string[]> = {
  happy: ["happy", "glad", "excited", "great", "awesome", "wonderful", "ดีใจ", "สนุก", "เยี่ยม", "สุดยอด", "ยินดี", "มีความสุข"],
  sad: ["sad", "down", "depressed", "unhappy", "disappointed", "เศร้า", "เสียใจ", "ผิดหวัง", "ท้อ", "เหงา", "หดหู่"],
  angry: ["angry", "frustrated", "annoyed", "mad", "furious", "โกรธ", "หงุดหงิด", "โมโห", "รำคาญ", "เซ็ง"],
  anxious: ["worried", "anxious", "nervous", "stressed", "overwhelmed", "กังวล", "เครียด", "กลัว", "ตื่นเต้น", "ประหม่า"],
  tired: ["tired", "exhausted", "burned out", "drained", "fatigue", "เหนื่อย", "อ่อนเพลีย", "หมดแรง", "ง่วง"],
  motivated: ["motivated", "inspired", "determined", "energized", "focused", "มุ่งมั่น", "ตั้งใจ", "มีแรง", "ฮึกเหิม"],
  confused: ["confused", "lost", "uncertain", "unsure", "stuck", "สับสน", "งง", "ไม่แน่ใจ", "ติดขัด"],
  grateful: ["grateful", "thankful", "appreciate", "blessed", "ขอบคุณ", "ซาบซึ้ง", "สำนึกบุญคุณ"],
  proud: ["proud", "accomplished", "achieved", "succeeded", "ภูมิใจ", "สำเร็จ", "ทำได้"],
};

// Empathetic responses by mood
const EMPATHETIC_RESPONSES: Record<string, string[]> = {
  happy: [
    "That's wonderful! Your positive energy is contagious.",
    "I'm glad to hear that! Let's channel this energy into something great.",
    "Happiness shared is happiness doubled. What made you feel this way?",
  ],
  sad: [
    "I'm here for you. It's okay to feel this way — emotions are what make us human.",
    "Take your time. Sometimes we need to feel the sadness before we can move forward.",
    "Would you like to talk about it, or would you prefer a distraction?",
  ],
  angry: [
    "I understand your frustration. Let's take a breath and think about this together.",
    "Your feelings are valid. Let's find a constructive way to channel this energy.",
    "When you're ready, let's break down what's bothering you step by step.",
  ],
  anxious: [
    "Let's slow down and tackle things one at a time. You don't have to handle everything at once.",
    "Deep breaths. What's the smallest next step we can take right now?",
    "Anxiety often makes things seem bigger than they are. Let's list what's actually within our control.",
  ],
  tired: [
    "Rest is productive too. Have you considered taking a break?",
    "You've been working hard. Let me handle what I can while you recharge.",
    "Even machines need downtime. Your wellbeing comes first.",
  ],
  motivated: [
    "Let's ride this wave of motivation! What shall we tackle?",
    "I love this energy. Let's set some goals and crush them.",
    "Great mindset! Let's make the most of this moment.",
  ],
  confused: [
    "Let's untangle this together. What's the core question?",
    "Confusion is the first step to understanding. Let's break it down.",
    "Tell me what you know, and we'll figure out the rest together.",
  ],
  grateful: [
    "Gratitude is a powerful mindset. It's great that you notice the good things.",
    "You deserve good things. Keep that appreciation mindset.",
  ],
  proud: [
    "You should be proud! Achievement is earned through effort.",
    "Congratulations! Let's remember this feeling for tough times ahead.",
  ],
};

// Wellness suggestions by mood
const WELLNESS_SUGGESTIONS: Record<string, string[]> = {
  sad: ["Go for a walk outside", "Listen to your favorite music", "Reach out to someone you trust", "Write about your feelings"],
  angry: ["Physical exercise to release tension", "Count to 10 before responding", "Write down what triggered this", "Take a cold splash of water"],
  anxious: ["5-4-3-2-1 grounding: 5 things you see, 4 hear, 3 touch, 2 smell, 1 taste", "Box breathing: 4 sec in, 4 hold, 4 out, 4 hold", "Write down worst case scenario — is it really that bad?"],
  tired: ["Power nap (20 min)", "Hydrate — drink water", "Stretch for 5 minutes", "Step outside for fresh air", "Consider your sleep schedule"],
  confused: ["Write down what you know vs don't know", "Ask someone for a different perspective", "Sleep on it — answers often come after rest"],
};

function ensureMoodTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mood TEXT NOT NULL,
      intensity INTEGER NOT NULL DEFAULT 5,
      context TEXT NOT NULL DEFAULT '',
      triggers TEXT NOT NULL DEFAULT '',
      suggestion TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Detect emotion from text — UPGRADE #6: LLM-based + keyword fallback
 *
 * Strategy:
 * 1. Try LLM classification (accurate, handles negation/sarcasm)
 * 2. Fall back to keyword matching if LLM unavailable
 */
export function detectEmotion(text: string): { mood: string; confidence: number } {
  // Keyword-based detection (synchronous fallback — always available)
  return detectEmotionKeyword(text);
}

/**
 * LLM-based emotion detection (async, more accurate)
 * Handles negation ("ไม่มีความสุข" = sad), sarcasm, complex emotions
 */
export async function detectEmotionLLM(text: string): Promise<{ mood: string; confidence: number; reason: string }> {
  try {
    const { chat } = await import("./llm-connector.js");
    const response = await chat(
      [
        {
          role: "system",
          content: `Classify the emotion in the user's message. Output EXACTLY one line in format:
MOOD:<mood> CONFIDENCE:<0.0-1.0> REASON:<brief reason>

Valid moods: happy, sad, angry, anxious, tired, motivated, confused, grateful, proud, neutral

Examples:
"ฉันไม่มีความสุขเลย" → MOOD:sad CONFIDENCE:0.8 REASON:negation of happiness indicates sadness
"555 ตลกมาก" → MOOD:happy CONFIDENCE:0.9 REASON:Thai laughter expression
"เหนื่อยมากแต่ก็สนุก" → MOOD:motivated CONFIDENCE:0.6 REASON:mixed tired+fun leans positive`,
        },
        { role: "user", content: text.substring(0, 300) },
      ],
      { temperature: 0.1, maxTokens: 60 },
    );

    const output = response.content?.trim() || "";
    const moodMatch = output.match(/MOOD:(\w+)/);
    const confMatch = output.match(/CONFIDENCE:([\d.]+)/);
    const reasonMatch = output.match(/REASON:(.+)/);

    if (moodMatch) {
      const mood = moodMatch[1].toLowerCase();
      const validMoods = ["happy", "sad", "angry", "anxious", "tired", "motivated", "confused", "grateful", "proud", "neutral"];
      if (validMoods.includes(mood)) {
        return {
          mood,
          confidence: confMatch ? parseFloat(confMatch[1]) : 0.7,
          reason: reasonMatch ? reasonMatch[1].trim() : "",
        };
      }
    }
  } catch { /* LLM unavailable, fall through */ }

  // Fallback to keyword
  const kw = detectEmotionKeyword(text);
  return { ...kw, reason: "keyword-based detection" };
}

function detectEmotionKeyword(text: string): { mood: string; confidence: number } {
  const lowerText = text.toLowerCase();

  // UPGRADE: Handle negation — "ไม่มีความสุข" should NOT match happy
  const negationPatterns = /ไม่|ไม่ได้|not|don't|doesn't|isn't|never|no longer/;
  const hasNegation = negationPatterns.test(lowerText);

  let bestMood = "neutral";
  let bestScore = 0;

  for (const [mood, keywords] of Object.entries(EMOTION_MAP)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        score += 1;
      }
    }

    // If negation detected and this is a positive mood, reduce score
    if (hasNegation && ["happy", "motivated", "proud", "grateful"].includes(mood)) {
      score = Math.max(0, score - 2);
    }
    // If negation + positive keywords → flip to opposite mood
    if (hasNegation && score === 0 && mood === "sad") {
      const happyKeywords = EMOTION_MAP.happy || [];
      for (const kw of happyKeywords) {
        if (lowerText.includes(kw)) score += 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMood = mood;
    }
  }

  const confidence = bestScore > 0 ? Math.min(1, bestScore / 3) : 0;
  return { mood: bestMood, confidence };
}

/**
 * Log a mood entry
 */
export async function logMood(
  mood: string,
  intensity: number,
  context: string,
  triggers?: string
): Promise<MoodEntry> {
  ensureMoodTable();
  const rawDb = getRawDb();

  // Get suggestion
  const suggestions = WELLNESS_SUGGESTIONS[mood] || [];
  const suggestion = suggestions.length > 0
    ? suggestions[Math.floor(Math.random() * suggestions.length)]
    : "";

  const row = rawDb.prepare(
    "INSERT INTO soul_moods (mood, intensity, context, triggers, suggestion) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(mood, intensity, context, triggers || "", suggestion) as any;

  // Store in memory for long-term emotional understanding
  await remember({
    content: `[Mood] ${mood} (${intensity}/10): ${context}${triggers ? ` | Triggers: ${triggers}` : ""}`,
    type: "conversation",
    tags: ["mood", mood, `intensity-${intensity}`],
    source: "emotional-intelligence",
  });

  return {
    id: row.id,
    mood: row.mood,
    intensity: row.intensity,
    context: row.context,
    triggers: row.triggers,
    suggestion: row.suggestion,
    createdAt: row.created_at,
  };
}

/**
 * Get empathetic response for a mood
 */
export function getEmpatheticResponse(mood: string): string {
  const responses = EMPATHETIC_RESPONSES[mood] || [
    "I'm here for you, whatever you need.",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Get mood history
 */
export async function getMoodHistory(limit = 20): Promise<MoodEntry[]> {
  ensureMoodTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(
    "SELECT * FROM soul_moods ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as any[];

  return rows.map(r => ({
    id: r.id,
    mood: r.mood,
    intensity: r.intensity,
    context: r.context,
    triggers: r.triggers,
    suggestion: r.suggestion,
    createdAt: r.created_at,
  }));
}

/**
 * Analyze mood trends
 */
export async function analyzeMoodTrends(): Promise<{
  dominantMood: string;
  avgIntensity: number;
  moodDistribution: Record<string, number>;
  recentTrend: string;
  stressLevel: string;
}> {
  ensureMoodTable();
  const rawDb = getRawDb();

  // Last 30 entries
  const rows = rawDb.prepare(
    "SELECT * FROM soul_moods ORDER BY created_at DESC LIMIT 30"
  ).all() as any[];

  if (rows.length === 0) {
    return {
      dominantMood: "unknown",
      avgIntensity: 0,
      moodDistribution: {},
      recentTrend: "No mood data yet",
      stressLevel: "unknown",
    };
  }

  // Count moods
  const moodDistribution: Record<string, number> = {};
  let totalIntensity = 0;

  for (const r of rows) {
    moodDistribution[r.mood] = (moodDistribution[r.mood] || 0) + 1;
    totalIntensity += r.intensity;
  }

  // Find dominant mood
  const dominantMood = Object.entries(moodDistribution)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";

  const avgIntensity = totalIntensity / rows.length;

  // Recent trend (last 5 vs previous 5)
  const recent5 = rows.slice(0, 5);
  const prev5 = rows.slice(5, 10);

  let recentTrend = "stable";
  if (recent5.length >= 3 && prev5.length >= 3) {
    const recentAvg = recent5.reduce((a: number, r: any) => a + r.intensity, 0) / recent5.length;
    const prevAvg = prev5.reduce((a: number, r: any) => a + r.intensity, 0) / prev5.length;

    const negativeMoods = new Set(["sad", "angry", "anxious", "tired"]);
    const recentNegative = recent5.filter((r: any) => negativeMoods.has(r.mood)).length;

    if (recentNegative >= 3) recentTrend = "declining — many negative moods recently";
    else if (recentAvg > prevAvg + 2) recentTrend = "improving — intensity rising positively";
    else recentTrend = "stable";
  }

  // Stress level
  const stressMoods = ["anxious", "angry", "tired"];
  const stressCount = rows.filter((r: any) => stressMoods.includes(r.mood)).length;
  const stressRatio = stressCount / rows.length;

  let stressLevel = "low";
  if (stressRatio > 0.6) stressLevel = "high";
  else if (stressRatio > 0.3) stressLevel = "moderate";

  return { dominantMood, avgIntensity, moodDistribution, recentTrend, stressLevel };
}
