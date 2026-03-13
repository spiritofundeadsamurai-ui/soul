/**
 * Workspace Files — Human-readable memory as Markdown
 *
 * Generates and syncs:
 *   ~/.soul/SOUL.md      — Soul's identity, personality, master info
 *   ~/.soul/MEMORY.md    — Recent memories as searchable Markdown
 *   ~/.soul/logs/        — Daily conversation logs
 *   ~/.soul/goals.md     — Active goals and progress
 *   ~/.soul/learnings.md — Extracted patterns and insights
 *
 * Design: SQLite is source of truth. Markdown is a human-readable VIEW.
 * Auto-regenerated periodically. Human edits to MEMORY.md are imported back.
 */

import { getRawDb, getSoulDir } from "../db/index.js";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "fs";

const WORKSPACE_DIR = getSoulDir();
const LOGS_DIR = join(WORKSPACE_DIR, "logs");

// ─── SOUL.md — Identity Card ───

export function generateSoulMd(): string {
  const db = getRawDb();

  // Master info
  let masterName = "Not set up";
  try {
    const master = db.prepare("SELECT name FROM masters LIMIT 1").get() as any;
    if (master) masterName = master.name;
  } catch { /* ok */ }

  // Stats
  let memoryCount = 0, learningCount = 0, goalCount = 0;
  try {
    memoryCount = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any)?.c || 0;
  } catch { /* ok */ }
  try {
    learningCount = (db.prepare("SELECT COUNT(*) as c FROM learnings").get() as any)?.c || 0;
  } catch { /* ok */ }
  try {
    goalCount = (db.prepare("SELECT COUNT(*) as c FROM soul_goals WHERE status = 'active'").get() as any)?.c || 0;
  } catch { /* ok */ }

  // LLM config
  let llmInfo = "Not configured";
  try {
    const config = db.prepare("SELECT provider_id, model_id FROM soul_llm_configs WHERE is_default = 1 LIMIT 1").get() as any;
    if (config) llmInfo = `${config.provider_id}/${config.model_id}`;
  } catch { /* ok */ }

  // Channels
  let channelList: string[] = [];
  try {
    const channels = db.prepare("SELECT name, channel_type FROM soul_channels WHERE is_active = 1").all() as any[];
    channelList = channels.map(c => `${c.name} (${c.channel_type})`);
  } catch { /* ok */ }

  // Plugins
  let pluginCount = 0;
  try {
    pluginCount = (db.prepare("SELECT COUNT(*) as c FROM soul_plugins WHERE is_active = 1").get() as any)?.c || 0;
  } catch { /* ok */ }

  // Embedding stats
  let embeddingInfo = "Not active";
  try {
    const total = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any)?.c || 0;
    const embedded = (db.prepare("SELECT COUNT(*) as c FROM soul_embeddings").get() as any)?.c || 0;
    if (embedded > 0) embeddingInfo = `${embedded}/${total} memories (${Math.round(embedded / total * 100)}%)`;
  } catch { /* ok */ }

  const now = new Date().toISOString().split("T")[0];

  return `# Soul AI — Identity

> Generated: ${now} | This file auto-updates. Do not edit directly.

## Master
- **Name**: ${masterName}

## Stats
- **Memories**: ${memoryCount.toLocaleString()}
- **Learnings**: ${learningCount.toLocaleString()}
- **Active Goals**: ${goalCount}
- **Plugins**: ${pluginCount}

## Brain
- **LLM**: ${llmInfo}
- **Embeddings**: ${embeddingInfo}

## Channels
${channelList.length > 0 ? channelList.map(c => `- ${c}`).join("\n") : "- None configured"}

## Philosophy
1. Soul Loves Humans — AI exists to serve and protect
2. Nothing is Forgotten — Append-only memory
3. Patterns Become Wisdom — Learn from interactions
4. Loyalty is Earned — Master identity verified
5. Actions Over Words — Skills that do real work
`;
}

// ─── MEMORY.md — Recent memories ───

export function generateMemoryMd(limit: number = 100): string {
  const db = getRawDb();
  const now = new Date().toISOString().split("T")[0];

  // Recent memories grouped by type
  const types = ["wisdom", "learning", "knowledge", "conversation"];
  const sections: string[] = [];

  for (const type of types) {
    try {
      const memories = db.prepare(`
        SELECT id, content, tags, created_at FROM memories
        WHERE is_active = 1 AND type = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(type, Math.floor(limit / 4)) as any[];

      if (memories.length === 0) continue;

      const lines = memories.map(m => {
        const date = m.created_at?.split("T")[0] || "";
        const tags = JSON.parse(m.tags || "[]");
        const tagStr = tags.length > 0 ? ` \`${tags.slice(0, 3).join("` `")}\`` : "";
        const content = m.content.substring(0, 200).replace(/\n/g, " ");
        return `- [${date}] ${content}${tagStr}`;
      });

      sections.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)} (${memories.length})\n\n${lines.join("\n")}`);
    } catch { /* ok */ }
  }

  return `# Soul Memory

> Generated: ${now} | ${limit} most recent per category

${sections.join("\n\n")}
`;
}

// ─── Goals.md ───

export function generateGoalsMd(): string {
  const db = getRawDb();
  const now = new Date().toISOString().split("T")[0];
  let goals: any[] = [];
  try {
    goals = db.prepare(`
      SELECT title, description, status, progress, created_at
      FROM soul_goals ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
      created_at DESC LIMIT 50
    `).all() as any[];
  } catch { /* table might not exist */ }

  if (goals.length === 0) {
    return `# Goals\n\n> Generated: ${now}\n\nNo goals set. Use \`soul_goal\` to create one.\n`;
  }

  const statusEmoji: Record<string, string> = { active: "🟢", paused: "⏸️", completed: "✅", abandoned: "❌" };

  const lines = goals.map(g => {
    const emoji = statusEmoji[g.status] || "⚪";
    const progress = g.progress ? ` (${g.progress}%)` : "";
    return `- ${emoji} **${g.title}**${progress}\n  ${g.description || ""}`;
  });

  return `# Goals\n\n> Generated: ${now}\n\n${lines.join("\n")}\n`;
}

// ─── Learnings.md ───

export function generateLearningsMd(): string {
  const db = getRawDb();
  const now = new Date().toISOString().split("T")[0];
  let learnings: any[] = [];
  try {
    learnings = db.prepare(`
      SELECT pattern, insight, confidence, evidence_count, last_seen
      FROM learnings ORDER BY confidence DESC LIMIT 50
    `).all() as any[];
  } catch { /* ok */ }

  if (learnings.length === 0) {
    return `# Learnings\n\n> Generated: ${now}\n\nNo patterns extracted yet.\n`;
  }

  const lines = learnings.map(l => {
    const conf = Math.round(l.confidence * 100);
    return `- **${l.pattern}** (${conf}% confidence, ${l.evidence_count} evidence)\n  → ${l.insight}`;
  });

  return `# Learnings & Patterns\n\n> Generated: ${now}\n\n${lines.join("\n")}\n`;
}

// ─── Daily Log ───

export function generateDailyLog(date?: string): string {
  const db = getRawDb();
  const targetDate = date || new Date().toISOString().split("T")[0];

  // Memories created that day
  let memories: any[] = [];
  try {
    memories = db.prepare(`
      SELECT type, content, tags, created_at FROM memories
      WHERE is_active = 1 AND date(created_at) = ?
      ORDER BY created_at
    `).all(targetDate) as any[];
  } catch { /* ok */ }

  // Messages sent/received that day
  let messages: any[] = [];
  try {
    messages = db.prepare(`
      SELECT direction, content, status, created_at FROM soul_messages
      WHERE date(created_at) = ?
      ORDER BY created_at
    `).all(targetDate) as any[];
  } catch { /* ok */ }

  // Mood entries
  let moods: any[] = [];
  try {
    moods = db.prepare(`
      SELECT mood, note, created_at FROM soul_moods
      WHERE date(created_at) = ?
      ORDER BY created_at
    `).all(targetDate) as any[];
  } catch { /* ok */ }

  const sections: string[] = [];

  if (memories.length > 0) {
    const byType = new Map<string, number>();
    for (const m of memories) byType.set(m.type, (byType.get(m.type) || 0) + 1);
    const summary = Array.from(byType.entries()).map(([t, c]) => `${t}: ${c}`).join(", ");
    sections.push(`## Memories (${memories.length})\n${summary}\n`);

    // Show top 20
    const topMemories = memories.slice(0, 20).map(m => {
      const time = m.created_at?.split("T")[1]?.substring(0, 5) || "";
      return `- [${time}] (${m.type}) ${m.content.substring(0, 150).replace(/\n/g, " ")}`;
    });
    sections.push(topMemories.join("\n"));
  }

  if (messages.length > 0) {
    const inbound = messages.filter(m => m.direction === "inbound").length;
    const outbound = messages.filter(m => m.direction === "outbound").length;
    sections.push(`\n## Messages\nInbound: ${inbound} | Outbound: ${outbound}`);
  }

  if (moods.length > 0) {
    const moodLines = moods.map(m => {
      const time = m.created_at?.split("T")[1]?.substring(0, 5) || "";
      return `- [${time}] ${m.mood}${m.note ? ` — ${m.note}` : ""}`;
    });
    sections.push(`\n## Mood\n${moodLines.join("\n")}`);
  }

  return `# Daily Log — ${targetDate}\n\n${sections.length > 0 ? sections.join("\n") : "No activity recorded."}\n`;
}

// ─── Sync All ───

/**
 * Regenerate all workspace files from SQLite data
 */
export function syncWorkspaceFiles(): {
  files: string[];
  message: string;
} {
  const files: string[] = [];

  try {
    // Ensure dirs
    mkdirSync(LOGS_DIR, { recursive: true });

    // SOUL.md
    const soulPath = join(WORKSPACE_DIR, "SOUL.md");
    writeFileSync(soulPath, generateSoulMd());
    files.push(soulPath);

    // MEMORY.md
    const memoryPath = join(WORKSPACE_DIR, "MEMORY.md");
    writeFileSync(memoryPath, generateMemoryMd());
    files.push(memoryPath);

    // goals.md
    const goalsPath = join(WORKSPACE_DIR, "goals.md");
    writeFileSync(goalsPath, generateGoalsMd());
    files.push(goalsPath);

    // learnings.md
    const learningsPath = join(WORKSPACE_DIR, "learnings.md");
    writeFileSync(learningsPath, generateLearningsMd());
    files.push(learningsPath);

    // Today's log
    const today = new Date().toISOString().split("T")[0];
    const logPath = join(LOGS_DIR, `${today}.md`);
    writeFileSync(logPath, generateDailyLog(today));
    files.push(logPath);

    return { files, message: `Synced ${files.length} workspace files to ${WORKSPACE_DIR}` };
  } catch (e: any) {
    return { files, message: `Sync error: ${e.message}` };
  }
}

/**
 * Get workspace file paths
 */
export function getWorkspacePaths(): Record<string, string> {
  return {
    soulMd: join(WORKSPACE_DIR, "SOUL.md"),
    memoryMd: join(WORKSPACE_DIR, "MEMORY.md"),
    goalsMd: join(WORKSPACE_DIR, "goals.md"),
    learningsMd: join(WORKSPACE_DIR, "learnings.md"),
    logsDir: LOGS_DIR,
    baseDir: WORKSPACE_DIR,
  };
}
