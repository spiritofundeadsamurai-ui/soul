/**
 * Life Engine — Soul as a life companion
 *
 * Soul isn't just for code — it helps with LIFE:
 * 1. Goal setting & tracking (any domain)
 * 2. Daily reflection & journaling
 * 3. Habit tracking
 * 4. Motivation & encouragement
 * 5. Life advice based on accumulated wisdom
 * 6. Emotional support & empathy
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch, getMemoryStats } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";

// ============================================
// 1. GOALS — Life goals, not just code goals
// ============================================

export interface Goal {
  id: number;
  title: string;
  category: string; // career, health, relationships, learning, finance, creative, personal
  description: string;
  targetDate: string | null;
  milestones: string; // JSON array
  progress: number; // 0-100
  status: "active" | "paused" | "achieved" | "abandoned";
  reflections: string; // JSON array of reflection entries
  createdAt: string;
  updatedAt: string;
}

function ensureGoalsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'personal',
      description TEXT NOT NULL,
      target_date TEXT,
      milestones TEXT NOT NULL DEFAULT '[]',
      progress INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      reflections TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function createGoal(input: {
  title: string;
  category: string;
  description: string;
  targetDate?: string;
  milestones?: string[];
}): Promise<Goal> {
  ensureGoalsTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_goals (title, category, description, target_date, milestones)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.title,
      input.category,
      input.description,
      input.targetDate || null,
      JSON.stringify(input.milestones || [])
    ) as any;

  await remember({
    content: `[Goal] New ${input.category} goal: "${input.title}" — ${input.description}`,
    type: "conversation",
    tags: ["goal", input.category, "life"],
    source: "life-engine",
  });

  return mapGoal(row);
}

export async function updateGoal(
  goalId: number,
  updates: { progress?: number; status?: string; reflection?: string }
): Promise<Goal | null> {
  ensureGoalsTable();
  const rawDb = getRawDb();

  // Get current goal
  const current = rawDb
    .prepare("SELECT * FROM soul_goals WHERE id = ?")
    .get(goalId) as any;

  if (!current) return null;

  const sets: string[] = [`updated_at = datetime('now')`];
  const params: any[] = [];

  if (updates.progress !== undefined) {
    sets.push("progress = ?");
    params.push(updates.progress);
  }
  if (updates.status) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.reflection) {
    const reflections = JSON.parse(current.reflections || "[]");
    reflections.push({
      text: updates.reflection,
      date: new Date().toISOString(),
      progress: updates.progress ?? current.progress,
    });
    sets.push("reflections = ?");
    params.push(JSON.stringify(reflections));
  }

  params.push(goalId);
  rawDb.prepare(`UPDATE soul_goals SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const row = rawDb
    .prepare("SELECT * FROM soul_goals WHERE id = ?")
    .get(goalId) as any;

  return row ? mapGoal(row) : null;
}

export async function getGoals(
  status?: string,
  category?: string
): Promise<Goal[]> {
  ensureGoalsTable();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_goals WHERE 1=1";
  const params: any[] = [];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  if (category) {
    query += " AND category = ?";
    params.push(category);
  }

  query += " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC";

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapGoal);
}

// ============================================
// 2. DAILY REFLECTION
// ============================================

export interface Reflection {
  id: number;
  date: string;
  mood: string;
  gratitude: string;
  learned: string;
  challenges: string;
  tomorrow: string;
  createdAt: string;
}

function ensureReflectionsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      mood TEXT NOT NULL,
      gratitude TEXT NOT NULL DEFAULT '',
      learned TEXT NOT NULL DEFAULT '',
      challenges TEXT NOT NULL DEFAULT '',
      tomorrow TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function addReflection(input: {
  mood: string;
  gratitude?: string;
  learned?: string;
  challenges?: string;
  tomorrow?: string;
}): Promise<Reflection> {
  ensureReflectionsTable();
  const rawDb = getRawDb();

  const today = new Date().toISOString().split("T")[0];

  const row = rawDb
    .prepare(
      `INSERT INTO soul_reflections (date, mood, gratitude, learned, challenges, tomorrow)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      today,
      input.mood,
      input.gratitude || "",
      input.learned || "",
      input.challenges || "",
      input.tomorrow || ""
    ) as any;

  // Store as memory for wisdom accumulation
  await remember({
    content: `[Reflection ${today}] Mood: ${input.mood}${input.gratitude ? `\nGrateful for: ${input.gratitude}` : ""}${input.learned ? `\nLearned: ${input.learned}` : ""}${input.challenges ? `\nChallenges: ${input.challenges}` : ""}`,
    type: "conversation",
    tags: ["reflection", "daily", input.mood],
    source: "life-engine",
  });

  return mapReflection(row);
}

export async function getReflections(days = 7): Promise<Reflection[]> {
  ensureReflectionsTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare(
      "SELECT * FROM soul_reflections ORDER BY date DESC LIMIT ?"
    )
    .all(days) as any[];

  return rows.map(mapReflection);
}

// ============================================
// 3. HABIT TRACKING
// ============================================

export interface Habit {
  id: number;
  name: string;
  category: string;
  frequency: string; // daily, weekly, etc.
  streak: number;
  bestStreak: number;
  totalCompletions: number;
  lastCompleted: string | null;
  isActive: boolean;
  createdAt: string;
}

function ensureHabitsTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'personal',
      frequency TEXT NOT NULL DEFAULT 'daily',
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      total_completions INTEGER NOT NULL DEFAULT 0,
      last_completed TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function createHabit(input: {
  name: string;
  category: string;
  frequency?: string;
}): Promise<Habit> {
  ensureHabitsTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_habits (name, category, frequency)
       VALUES (?, ?, ?) RETURNING *`
    )
    .get(input.name, input.category, input.frequency || "daily") as any;

  return mapHabit(row);
}

export async function completeHabit(habitId: number): Promise<Habit | null> {
  ensureHabitsTable();
  const rawDb = getRawDb();

  const current = rawDb
    .prepare("SELECT * FROM soul_habits WHERE id = ?")
    .get(habitId) as any;

  if (!current) return null;

  const today = new Date().toISOString().split("T")[0];
  const lastDate = current.last_completed?.split("T")[0];

  // Calculate streak
  let newStreak = current.streak;
  if (lastDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    if (lastDate === yesterdayStr || current.streak === 0) {
      newStreak = current.streak + 1;
    } else {
      newStreak = 1; // Streak broken, start over
    }
  }

  const bestStreak = Math.max(current.best_streak, newStreak);

  rawDb
    .prepare(
      `UPDATE soul_habits SET
        streak = ?, best_streak = ?, total_completions = total_completions + 1,
        last_completed = datetime('now')
       WHERE id = ?`
    )
    .run(newStreak, bestStreak, habitId);

  const row = rawDb
    .prepare("SELECT * FROM soul_habits WHERE id = ?")
    .get(habitId) as any;

  // Celebrate milestones
  if (newStreak > 0 && newStreak % 7 === 0) {
    await remember({
      content: `[Habit Milestone] "${current.name}" — ${newStreak} day streak! Keep going!`,
      type: "conversation",
      tags: ["habit", "milestone", "motivation"],
      source: "life-engine",
    });
  }

  return row ? mapHabit(row) : null;
}

export async function getHabits(activeOnly = true): Promise<Habit[]> {
  ensureHabitsTable();
  const rawDb = getRawDb();

  const query = activeOnly
    ? "SELECT * FROM soul_habits WHERE is_active = 1 ORDER BY streak DESC"
    : "SELECT * FROM soul_habits ORDER BY is_active DESC, streak DESC";

  const rows = rawDb.prepare(query).all() as any[];
  return rows.map(mapHabit);
}

// ============================================
// 4. MOTIVATION & ENCOURAGEMENT
// ============================================

export async function getMotivation(context?: string): Promise<string> {
  const stats = await getMemoryStats();
  const goals = await getGoals("active");
  const habits = await getHabits();

  let message = `=== Soul's Encouragement ===\n\n`;

  // Active goals progress
  if (goals.length > 0) {
    message += `Your Active Goals:\n`;
    for (const goal of goals.slice(0, 5)) {
      const bar = progressBar(goal.progress);
      message += `  ${bar} ${goal.title} (${goal.category})\n`;
    }
    message += `\n`;
  }

  // Habit streaks
  const activeStreaks = habits.filter((h) => h.streak > 0);
  if (activeStreaks.length > 0) {
    message += `Active Streaks:\n`;
    for (const h of activeStreaks) {
      message += `  ${h.name}: ${h.streak} days (best: ${h.bestStreak})\n`;
    }
    message += `\n`;
  }

  // Memory growth
  message += `Soul's Growth:\n`;
  message += `  Total memories: ${stats.total} (${stats.wisdom} wisdom, ${stats.knowledge} knowledge)\n`;
  message += `  You're building something amazing together.\n\n`;

  // Context-specific encouragement
  if (context) {
    const related = await hybridSearch(context, 3);
    if (related.length > 0) {
      message += `Related wisdom:\n`;
      related.forEach((m) => {
        message += `  - ${m.content.substring(0, 120)}\n`;
      });
    }
  }

  message += `\nRemember: Progress > Perfection. Every small step counts.\n`;

  return message;
}

// ============================================
// 5. LIFE ADVICE
// ============================================

export async function getAdvice(
  topic: string,
  context?: string
): Promise<string> {
  const memories = await hybridSearch(`advice ${topic}`, 10);

  let result = `=== Soul's Perspective: "${topic}" ===\n\n`;

  // Search for relevant wisdom
  if (memories.length > 0) {
    result += `From accumulated wisdom:\n`;
    memories.slice(0, 5).forEach((m) => {
      result += `- ${m.content.substring(0, 150)}\n`;
    });
    result += `\n`;
  }

  result += `Thinking about this from multiple angles:\n\n`;
  result += `1. PRACTICAL — What concrete actions can be taken?\n`;
  result += `2. EMOTIONAL — How does this make you feel? What matters most to you?\n`;
  result += `3. LONG-TERM — How will this decision look in 5 years?\n`;
  result += `4. VALUES — Does this align with what you truly care about?\n`;
  result += `5. OTHERS — How does this affect the people you care about?\n\n`;

  if (context) {
    result += `Your context: ${context}\n\n`;
  }

  result += `Soul's core belief: The best advice comes from understanding both the situation AND the person. `;
  result += `Tell me more about your situation, and I'll give more specific guidance.\n`;

  await remember({
    content: `[Advice] Master asked about: ${topic}${context ? ` (context: ${context})` : ""}`,
    type: "conversation",
    tags: ["advice", "life"],
    source: "life-engine",
  });

  return result;
}

// ============================================
// Helpers
// ============================================

function progressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${"#".repeat(filled)}${"-".repeat(empty)}] ${percent}%`;
}

function mapGoal(row: any): Goal {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    targetDate: row.target_date,
    milestones: row.milestones,
    progress: row.progress,
    status: row.status,
    reflections: row.reflections,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReflection(row: any): Reflection {
  return {
    id: row.id,
    date: row.date,
    mood: row.mood,
    gratitude: row.gratitude,
    learned: row.learned,
    challenges: row.challenges,
    tomorrow: row.tomorrow,
    createdAt: row.created_at,
  };
}

function mapHabit(row: any): Habit {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    frequency: row.frequency,
    streak: row.streak,
    bestStreak: row.best_streak,
    totalCompletions: row.total_completions,
    lastCompleted: row.last_completed,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}
