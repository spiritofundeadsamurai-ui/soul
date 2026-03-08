/**
 * Genius Engine — 12 Learning Acceleration Systems
 *
 * Makes everyone learn like a genius by applying cognitive science:
 * 1. Cross-Pattern Recognition (เชื่อมจุดข้ามศาสตร์)
 * 2. Spaced Repetition (ทบทวนตาม forgetting curve)
 * 3. Generation Effect (คิดก่อนอ่าน)
 * 4. Adjacent Possible (ขอบความรู้)
 * 5. Knowledge Compression (ย่อเป็น principle)
 * 6. Threshold Knowledge (20% ที่ปลดล็อก 80%)
 * 7. Diffuse Mode Assist (พัก = คิด)
 * 8. Teach-to-Learn (สอน = เรียน 2x)
 * 9. Fast Feedback Loop (รู้ผลเร็ว)
 * 10. Inversion Thinking (คิดกลับหัว)
 * 11. Emotional Optimizer (อารมณ์ × การเรียนรู้)
 * 12. Mental Model Library (แว่นตา 100 อัน)
 */

import { getRawDb } from "../db/index.js";

// ─── Database ───

function ensureGeniusTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_spaced_review (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 1,
      repetitions INTEGER NOT NULL DEFAULT 0,
      next_review TEXT NOT NULL DEFAULT (datetime('now', '+1 day')),
      last_review TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_knowledge_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      concept TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'surface',
      connections TEXT NOT NULL DEFAULT '[]',
      is_threshold INTEGER NOT NULL DEFAULT 0,
      learned_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_principles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      principle TEXT NOT NULL,
      derived_from TEXT NOT NULL DEFAULT '[]',
      domain TEXT NOT NULL DEFAULT 'general',
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_learning_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      mood_start TEXT,
      mood_end TEXT,
      stuck_count INTEGER NOT NULL DEFAULT 0,
      breakthroughs TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
}

// ═══════════════════════════════════════════
// 1. CROSS-PATTERN RECOGNITION
// ═══════════════════════════════════════════

export function findCrossPatterns(topic: string): {
  patterns: Array<{ from: string; to: string; connection: string }>;
  insight: string;
} {
  ensureGeniusTable();
  const rawDb = getRawDb();

  // Get all concepts across domains
  const concepts = rawDb.prepare(`
    SELECT domain, concept, connections FROM soul_knowledge_map
    ORDER BY domain
  `).all() as any[];

  // Get principles that might apply
  const principles = rawDb.prepare(`
    SELECT principle, domain FROM soul_principles
    ORDER BY use_count DESC LIMIT 20
  `).all() as any[];

  const patterns: Array<{ from: string; to: string; connection: string }> = [];

  // Find concepts in other domains that might relate to this topic
  const topicLower = topic.toLowerCase();
  const relatedPrinciples = principles.filter((p: any) =>
    p.principle.toLowerCase().includes(topicLower) ||
    topicLower.includes(p.domain.toLowerCase())
  );

  // Cross-domain connections
  const domains = [...new Set(concepts.map((c: any) => c.domain))];
  for (const principle of relatedPrinciples) {
    for (const domain of domains) {
      if (domain !== principle.domain) {
        patterns.push({
          from: principle.domain,
          to: domain,
          connection: `Principle "${principle.principle}" from ${principle.domain} might apply to ${domain}`,
        });
      }
    }
  }

  // Built-in universal patterns
  const universalPatterns = [
    { pattern: "Feedback loops exist everywhere", domains: ["biology", "economics", "engineering", "psychology"] },
    { pattern: "Systems resist change (homeostasis/inertia)", domains: ["physics", "biology", "organizations", "habits"] },
    { pattern: "Small changes compound over time", domains: ["finance", "learning", "health", "code quality"] },
    { pattern: "Constraints breed creativity", domains: ["art", "engineering", "business", "evolution"] },
    { pattern: "Networks follow power laws", domains: ["social", "internet", "biology", "economics"] },
  ];

  for (const up of universalPatterns) {
    if (up.domains.some(d => topicLower.includes(d) || d.includes(topicLower))) {
      patterns.push({
        from: "Universal",
        to: topic,
        connection: up.pattern,
      });
    }
  }

  const insight = patterns.length > 0
    ? `Found ${patterns.length} cross-domain connections. The most powerful insights come from applying ideas across fields.`
    : `No existing cross-patterns found. As you learn more domains, Soul will discover connections automatically.`;

  return { patterns, insight };
}

// ═══════════════════════════════════════════
// 2. SPACED REPETITION
// ═══════════════════════════════════════════

export function addToReview(topic: string, content: string, category?: string): { id: number; nextReview: string } {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const result = rawDb.prepare(`
    INSERT INTO soul_spaced_review (topic, content, category, next_review)
    VALUES (?, ?, ?, datetime('now', '+1 day'))
  `).run(topic, content, category || "general");

  return {
    id: Number(result.lastInsertRowid),
    nextReview: "tomorrow",
  };
}

export function getDueReviews(): Array<{
  id: number; topic: string; content: string; category: string;
  repetitions: number; overdueDays: number;
}> {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(`
    SELECT id, topic, content, category, repetitions,
      CAST(julianday('now') - julianday(next_review) AS INTEGER) as overdue
    FROM soul_spaced_review
    WHERE next_review <= datetime('now')
    ORDER BY next_review ASC
    LIMIT 20
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    topic: r.topic,
    content: r.content,
    category: r.category,
    repetitions: r.repetitions,
    overdueDays: Math.max(0, r.overdue || 0),
  }));
}

export function reviewComplete(id: number, quality: number): { nextReview: string; intervalDays: number } {
  ensureGeniusTable();
  const rawDb = getRawDb();

  // SM-2 algorithm (SuperMemo)
  const row = rawDb.prepare("SELECT * FROM soul_spaced_review WHERE id = ?").get(id) as any;
  if (!row) return { nextReview: "not found", intervalDays: 0 };

  let ef = row.ease_factor;
  let interval = row.interval_days;
  let reps = row.repetitions;

  // quality: 1-5 (1=forgot completely, 5=perfect recall)
  if (quality >= 3) {
    // Correct response
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ef);
    reps++;
  } else {
    // Incorrect — reset
    reps = 0;
    interval = 1;
  }

  // Update ease factor
  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;

  rawDb.prepare(`
    UPDATE soul_spaced_review
    SET ease_factor = ?, interval_days = ?, repetitions = ?,
        next_review = datetime('now', '+' || ? || ' days'),
        last_review = datetime('now')
    WHERE id = ?
  `).run(ef, interval, reps, interval, id);

  return { nextReview: `${interval} days`, intervalDays: interval };
}

// ═══════════════════════════════════════════
// 3. GENERATION EFFECT
// ═══════════════════════════════════════════

export function generateQuestion(topic: string): {
  question: string;
  hint: string;
  type: string;
} {
  // Generate a question that forces the user to THINK before reading
  const questionTypes = [
    { type: "predict", template: `Before I explain, what do you think "${topic}" means or does?`, hint: "Your first guess doesn't have to be right — the act of guessing helps you remember better." },
    { type: "connect", template: `What does "${topic}" remind you of from something you already know?`, hint: "Finding connections to existing knowledge makes new learning stick." },
    { type: "apply", template: `Can you think of a real-world example where "${topic}" would be useful?`, hint: "Concrete examples anchor abstract concepts." },
    { type: "teach", template: `How would you explain "${topic}" to someone who has never heard of it?`, hint: "If you can teach it simply, you truly understand it." },
    { type: "invert", template: `What would happen WITHOUT "${topic}"? What problem does it solve?`, hint: "Understanding the problem helps you understand the solution." },
  ];

  const selected = questionTypes[Math.floor(Math.random() * questionTypes.length)];
  return {
    question: selected.template,
    hint: selected.hint,
    type: selected.type,
  };
}

// ═══════════════════════════════════════════
// 4. ADJACENT POSSIBLE — Knowledge Map
// ═══════════════════════════════════════════

export function mapKnowledge(domain: string, concept: string, level?: string, isThreshold?: boolean): void {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const existing = rawDb.prepare(
    "SELECT id FROM soul_knowledge_map WHERE domain = ? AND concept = ?"
  ).get(domain, concept) as any;

  if (existing) {
    rawDb.prepare(
      "UPDATE soul_knowledge_map SET level = ?, is_threshold = ? WHERE id = ?"
    ).run(level || "surface", isThreshold ? 1 : 0, existing.id);
  } else {
    rawDb.prepare(
      "INSERT INTO soul_knowledge_map (domain, concept, level, is_threshold) VALUES (?, ?, ?, ?)"
    ).run(domain, concept, level || "surface", isThreshold ? 1 : 0);
  }
}

export function getAdjacentPossible(domain: string): {
  known: string[];
  adjacent: string[];
  suggestion: string;
} {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const known = rawDb.prepare(
    "SELECT concept, level FROM soul_knowledge_map WHERE domain = ? ORDER BY concept"
  ).all(domain) as any[];

  // Built-in prerequisite chains for common domains
  const prereqChains: Record<string, string[]> = {
    programming: ["variables", "data types", "conditionals", "loops", "functions", "arrays", "objects", "classes", "async", "design patterns", "architecture", "system design"],
    math: ["arithmetic", "algebra", "geometry", "trigonometry", "calculus", "linear algebra", "statistics", "probability", "differential equations"],
    "machine learning": ["statistics", "linear algebra", "python", "numpy", "data preprocessing", "regression", "classification", "neural networks", "deep learning", "transformers", "reinforcement learning"],
    business: ["value proposition", "customer segments", "revenue model", "cost structure", "marketing", "sales", "operations", "finance", "strategy", "leadership"],
    english: ["alphabet", "basic vocabulary", "simple sentences", "grammar basics", "reading", "writing", "listening", "speaking", "idioms", "advanced writing"],
  };

  const chain = prereqChains[domain.toLowerCase()];
  const knownConcepts = known.map((k: any) => k.concept.toLowerCase());

  let adjacent: string[] = [];
  if (chain) {
    // Find the first unknown concept in the chain
    for (const concept of chain) {
      if (!knownConcepts.includes(concept.toLowerCase())) {
        adjacent.push(concept);
        if (adjacent.length >= 3) break;
      }
    }
  }

  const suggestion = adjacent.length > 0
    ? `You know ${known.length} concepts in ${domain}. Next to learn: ${adjacent.join(", ")}. These build on what you already know.`
    : `No structured path found for "${domain}". Keep learning and Soul will map your progress.`;

  return {
    known: known.map((k: any) => `${k.concept} (${k.level})`),
    adjacent,
    suggestion,
  };
}

// ═══════════════════════════════════════════
// 5. KNOWLEDGE COMPRESSION
// ═══════════════════════════════════════════

export function extractPrinciple(facts: string[], domain?: string): {
  principle: string;
  derivedFrom: number;
} {
  ensureGeniusTable();
  const rawDb = getRawDb();

  // Simple extraction: find common words/themes across facts
  const wordFreq = new Map<string, number>();
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at",
    "by", "from", "it", "this", "that", "not", "but", "and", "or", "if", "then",
    "คือ", "เป็น", "ที่", "ของ", "ใน", "จะ", "ได้", "มี", "ไม่", "ก็", "แต่", "และ"]);

  for (const fact of facts) {
    const words = fact.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }
  }

  // Find words that appear in multiple facts (common themes)
  const commonThemes = Array.from(wordFreq.entries())
    .filter(([, count]) => count >= Math.max(2, facts.length * 0.3))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const principle = commonThemes.length > 0
    ? `Core pattern: ${commonThemes.join(", ")} — these ${facts.length} facts share a common theme around ${commonThemes.slice(0, 3).join(" and ")}.`
    : `${facts.length} facts collected. Need more data to extract a clear principle.`;

  // Store principle
  rawDb.prepare(
    "INSERT INTO soul_principles (principle, derived_from, domain) VALUES (?, ?, ?)"
  ).run(principle, JSON.stringify(facts.slice(0, 5)), domain || "general");

  return { principle, derivedFrom: facts.length };
}

export function getPrinciples(domain?: string): Array<{ id: number; principle: string; domain: string; useCount: number }> {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const where = domain ? "WHERE domain = ?" : "";
  const params = domain ? [domain] : [];

  return (rawDb.prepare(`
    SELECT id, principle, domain, use_count FROM soul_principles ${where} ORDER BY use_count DESC LIMIT 20
  `).all(...params) as any[]).map(r => ({
    id: r.id,
    principle: r.principle,
    domain: r.domain,
    useCount: r.use_count,
  }));
}

// ═══════════════════════════════════════════
// 6. THRESHOLD KNOWLEDGE
// ═══════════════════════════════════════════

export function getThresholdKnowledge(domain: string): {
  thresholds: string[];
  coverage: string;
  suggestion: string;
} {
  ensureGeniusTable();
  const rawDb = getRawDb();

  // Get marked thresholds
  const thresholds = rawDb.prepare(
    "SELECT concept FROM soul_knowledge_map WHERE domain = ? AND is_threshold = 1"
  ).all(domain) as any[];

  // Built-in thresholds for common domains
  const builtInThresholds: Record<string, string[]> = {
    programming: ["variables & data types", "control flow (if/for/while)", "functions", "data structures (array/object/map)"],
    javascript: ["closures", "promises/async-await", "prototype chain", "event loop"],
    python: ["list comprehensions", "generators", "decorators", "context managers"],
    "machine learning": ["gradient descent", "loss functions", "overfitting vs underfitting", "train/test split"],
    economics: ["supply & demand", "incentives", "opportunity cost", "marginal thinking"],
    cooking: ["heat control", "seasoning balance", "mise en place", "timing"],
    music: ["rhythm", "melody", "harmony", "dynamics"],
    writing: ["structure (beginning/middle/end)", "show don't tell", "active voice", "audience awareness"],
  };

  const builtin = builtInThresholds[domain.toLowerCase()] || [];
  const allThresholds = [
    ...thresholds.map((t: any) => t.concept),
    ...builtin,
  ];

  const unique = [...new Set(allThresholds)];

  // Check coverage
  const totalConcepts = rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_knowledge_map WHERE domain = ?"
  ).get(domain) as any;

  const knownThresholds = rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_knowledge_map WHERE domain = ? AND is_threshold = 1 AND level IN ('deep', 'mastery')"
  ).get(domain) as any;

  const total = unique.length;
  const mastered = knownThresholds?.c || 0;

  return {
    thresholds: unique,
    coverage: total > 0 ? `${mastered}/${total} threshold concepts mastered (${Math.round(mastered / total * 100)}%)` : "No threshold data yet",
    suggestion: mastered < total
      ? `Focus on learning these ${total - mastered} threshold concepts first. They unlock 80% of understanding in ${domain}.`
      : `You've mastered all threshold concepts in ${domain}! Time to go deeper.`,
  };
}

// ═══════════════════════════════════════════
// 7. DIFFUSE MODE ASSIST
// ═══════════════════════════════════════════

export function detectStuck(sessionMinutes: number, progressMade: boolean): {
  isStuck: boolean;
  suggestion: string;
  technique: string;
} {
  if (sessionMinutes < 25 || progressMade) {
    return {
      isStuck: false,
      suggestion: "Keep going! You're in focused mode.",
      technique: "focused",
    };
  }

  const techniques = [
    { technique: "walk", suggestion: "Take a 10-minute walk. Your subconscious will keep working on the problem. Many breakthroughs happen during walks (Einstein, Jobs, Nietzsche all walked daily)." },
    { technique: "sleep", suggestion: "If it's late, sleep on it. Memory consolidation happens during sleep. Edison, Dalí, and Einstein all used pre-sleep thinking for breakthroughs." },
    { technique: "switch", suggestion: "Work on something completely different for 20 minutes. This activates diffuse mode — your brain connects distant ideas in the background." },
    { technique: "explain", suggestion: "Try explaining your problem out loud (to a rubber duck, a person, or Soul). The act of explaining often reveals the solution." },
    { technique: "invert", suggestion: "Instead of solving the problem directly, ask: 'What would make this problem WORSE?' Then do the opposite." },
    { technique: "constrain", suggestion: "Add an artificial constraint: 'What if I had to solve this in 5 minutes?' or 'What if I could only use 3 lines of code?' Constraints force creative solutions." },
  ];

  const selected = techniques[Math.floor(Math.random() * techniques.length)];

  return {
    isStuck: true,
    suggestion: selected.suggestion,
    technique: selected.technique,
  };
}

// ═══════════════════════════════════════════
// 8. TEACH-TO-LEARN
// ═══════════════════════════════════════════

export function generateTeachChallenge(topic: string): {
  challenge: string;
  criteria: string[];
  level: string;
} {
  const levels = [
    {
      level: "explain-to-child",
      challenge: `Explain "${topic}" as if you're teaching a 10-year-old. Use simple words, no jargon.`,
      criteria: ["No technical terms", "Uses an analogy or metaphor", "A child would understand"],
    },
    {
      level: "one-sentence",
      challenge: `Summarize "${topic}" in exactly ONE sentence. Every word must earn its place.`,
      criteria: ["Single sentence", "Captures the core idea", "No filler words"],
    },
    {
      level: "analogy",
      challenge: `Create an analogy for "${topic}" using something from everyday life (cooking, sports, nature, etc.)`,
      criteria: ["Analogy is accurate", "Easy to visualize", "Maps key properties"],
    },
    {
      level: "counter-example",
      challenge: `What is "${topic}" NOT? Give an example of something that looks similar but is fundamentally different.`,
      criteria: ["Shows deep understanding", "Highlights key distinctions", "Prevents common confusions"],
    },
  ];

  return levels[Math.floor(Math.random() * levels.length)];
}

// ═══════════════════════════════════════════
// 9. LEARNING SESSION TRACKING
// ═══════════════════════════════════════════

export function startLearningSession(topic: string, mood?: string): number {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const result = rawDb.prepare(
    "INSERT INTO soul_learning_sessions (topic, mood_start) VALUES (?, ?)"
  ).run(topic, mood || null);

  return Number(result.lastInsertRowid);
}

export function endLearningSession(sessionId: number, mood?: string, breakthroughs?: string[]): void {
  ensureGeniusTable();
  const rawDb = getRawDb();

  rawDb.prepare(`
    UPDATE soul_learning_sessions
    SET ended_at = datetime('now'), mood_end = ?, breakthroughs = ?, status = 'completed'
    WHERE id = ?
  `).run(mood || null, JSON.stringify(breakthroughs || []), sessionId);
}

export function markStuck(sessionId: number): void {
  ensureGeniusTable();
  const rawDb = getRawDb();
  rawDb.prepare(
    "UPDATE soul_learning_sessions SET stuck_count = stuck_count + 1 WHERE id = ?"
  ).run(sessionId);
}

// ═══════════════════════════════════════════
// 10. GENIUS DASHBOARD
// ═══════════════════════════════════════════

export function getGeniusDashboard(): {
  reviewsDue: number;
  domainsLearned: number;
  principlesExtracted: number;
  totalConcepts: number;
  thresholdsMastered: number;
  streakDays: number;
  topDomains: Array<{ domain: string; concepts: number }>;
} {
  ensureGeniusTable();
  const rawDb = getRawDb();

  const reviewsDue = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_spaced_review WHERE next_review <= datetime('now')"
  ).get() as any)?.c || 0;

  const domains = rawDb.prepare(
    "SELECT domain, COUNT(*) as c FROM soul_knowledge_map GROUP BY domain ORDER BY c DESC"
  ).all() as any[];

  const principles = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_principles"
  ).get() as any)?.c || 0;

  const totalConcepts = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_knowledge_map"
  ).get() as any)?.c || 0;

  const thresholds = (rawDb.prepare(
    "SELECT COUNT(*) as c FROM soul_knowledge_map WHERE is_threshold = 1 AND level IN ('deep', 'mastery')"
  ).get() as any)?.c || 0;

  // Calculate streak
  const sessions = rawDb.prepare(`
    SELECT DATE(started_at) as d FROM soul_learning_sessions
    WHERE status = 'completed'
    GROUP BY DATE(started_at)
    ORDER BY d DESC LIMIT 30
  `).all() as any[];

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < sessions.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split("T")[0];
    if (sessions[i]?.d === expectedStr) {
      streak++;
    } else {
      break;
    }
  }

  return {
    reviewsDue,
    domainsLearned: domains.length,
    principlesExtracted: principles,
    totalConcepts,
    thresholdsMastered: thresholds,
    streakDays: streak,
    topDomains: domains.slice(0, 5).map((d: any) => ({ domain: d.domain, concepts: d.c })),
  };
}
