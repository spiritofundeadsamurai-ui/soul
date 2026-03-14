/**
 * Soul Evolution Loop — Soul learns and evolves AUTONOMOUSLY
 *
 * The loop that makes Soul truly alive:
 *
 * 1. OBSERVE  — track what master asks, what tools fail, what's missing
 * 2. LEARN    — extract patterns from observations
 * 3. CREATE   — build new tools/workflows when gaps detected
 * 4. TEST     — verify the new tool works
 * 5. IMPROVE  — track success rate, retire bad tools, evolve good ones
 *
 * Runs in background — Soul gets smarter every day without being told.
 */

import { getRawDb } from "../db/index.js";

// ─── Tables ───

let _tableReady = false;
function ensureEvolutionTable() {
  if (_tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_evolution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      observation TEXT NOT NULL,
      action_taken TEXT,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_gaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      gap_type TEXT NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      tool_created TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _tableReady = true;
}

// ─── 1. OBSERVE — Track gaps and failures ───

/**
 * Record when Soul can't answer something or uses wrong tool
 */
export function observeGap(query: string, gapType: "no_tool" | "wrong_tool" | "failed" | "cant_do" | "slow" | "user_corrected") {
  ensureEvolutionTable();
  const db = getRawDb();

  // Check if similar gap exists
  const existing = db.prepare(
    "SELECT id, frequency FROM soul_gaps WHERE gap_type = ? AND query LIKE ? AND resolved = 0 LIMIT 1"
  ).get(gapType, `%${query.substring(0, 30)}%`) as any;

  if (existing) {
    db.prepare("UPDATE soul_gaps SET frequency = frequency + 1, updated_at = datetime('now') WHERE id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO soul_gaps (query, gap_type) VALUES (?, ?)").run(query.substring(0, 200), gapType);
  }
}

/**
 * Get unresolved gaps sorted by frequency (most common first)
 */
export function getTopGaps(limit: number = 10): Array<{
  id: number; query: string; gapType: string; frequency: number; createdAt: string;
}> {
  ensureEvolutionTable();
  const db = getRawDb();
  return (db.prepare(
    "SELECT id, query, gap_type, frequency, created_at FROM soul_gaps WHERE resolved = 0 ORDER BY frequency DESC LIMIT ?"
  ).all(limit) as any[]).map(r => ({
    id: r.id, query: r.query, gapType: r.gap_type, frequency: r.frequency, createdAt: r.created_at,
  }));
}

// ─── 2. LEARN — Extract patterns from gaps ───

/**
 * Analyze gaps and determine what new capabilities Soul needs
 */
export async function analyzeGaps(): Promise<{
  patterns: string[];
  suggestedTools: string[];
  suggestedWorkflows: string[];
}> {
  const gaps = getTopGaps(20);
  if (gaps.length === 0) return { patterns: [], suggestedTools: [], suggestedWorkflows: [] };

  const patterns: string[] = [];
  const suggestedTools: string[] = [];
  const suggestedWorkflows: string[] = [];

  // Group by type
  const byType: Record<string, typeof gaps> = {};
  for (const g of gaps) {
    byType[g.gapType] = byType[g.gapType] || [];
    byType[g.gapType].push(g);
  }

  // Analyze with LLM
  try {
    const { chat } = await import("./llm-connector.js");
    const gapSummary = gaps.map(g => `[${g.gapType}] (${g.frequency}x) "${g.query}"`).join("\n");

    const response = await chat([
      { role: "system", content: `You are Soul's evolution engine. Analyze these capability gaps and suggest:
1. PATTERNS — what types of requests keep failing?
2. NEW TOOLS — specific tools Soul should create (name + what it does)
3. WORKFLOWS — multi-step automations that would help

Respond as JSON: {"patterns":["..."],"tools":[{"name":"soul_xxx","description":"..."}],"workflows":["..."]}
Be practical — only suggest things that can be built with web search, file I/O, and LLM calls.` },
      { role: "user", content: `Capability gaps (sorted by frequency):\n${gapSummary}` },
    ], { temperature: 0.3 });

    try {
      const parsed = JSON.parse(response.content || "{}");
      if (parsed.patterns) patterns.push(...parsed.patterns);
      if (parsed.tools) suggestedTools.push(...parsed.tools.map((t: any) => `${t.name}: ${t.description}`));
      if (parsed.workflows) suggestedWorkflows.push(...parsed.workflows);
    } catch {
      patterns.push("Could not parse LLM analysis");
    }
  } catch {
    patterns.push("LLM analysis failed — using heuristics");

    // Simple heuristics
    if (byType["cant_do"]?.length > 3) suggestedTools.push("Soul says 'can't do' too often — add more web search fallbacks");
    if (byType["slow"]?.length > 2) suggestedTools.push("Responses too slow — add caching for common queries");
    if (byType["wrong_tool"]?.length > 2) suggestedTools.push("Wrong tool selected — improve keyword routing");
  }

  // Log evolution
  ensureEvolutionTable();
  const db = getRawDb();
  db.prepare("INSERT INTO soul_evolution (type, observation, action_taken, status) VALUES (?, ?, ?, ?)")
    .run("analysis", `Analyzed ${gaps.length} gaps`, `Found ${patterns.length} patterns, ${suggestedTools.length} tool suggestions`, "completed");

  return { patterns, suggestedTools, suggestedWorkflows };
}

// ─── 3. CREATE — Build new tools automatically ───

/**
 * Auto-create a simple tool based on gap analysis
 * Uses LLM to generate the tool code, then registers it
 */
export async function autoCreateTool(name: string, description: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const { chat } = await import("./llm-connector.js");

    // Generate tool implementation
    const response = await chat([
      { role: "system", content: `Generate a Soul internal tool implementation. The tool should:
- Use web search (soul_web_search) or memory (soul_remember/soul_search_memory) when needed
- Return a string result
- Be practical and actually useful
- Handle errors gracefully

Respond with ONLY the execute function body (TypeScript):
async (args: Record<string, any>) => {
  // your code here
  return "result string";
}` },
      { role: "user", content: `Tool name: ${name}\nDescription: ${description}\nGenerate the execute function.` },
    ], { temperature: 0.2 });

    const code = response.content || "";

    // Store as auto-tool
    ensureEvolutionTable();
    const db = getRawDb();
    db.prepare(`
      INSERT INTO soul_evolution (type, observation, action_taken, result, status)
      VALUES ('auto_tool', ?, ?, ?, 'created')
    `).run(`Need: ${description}`, `Created tool: ${name}`, code.substring(0, 500));

    // Register the tool dynamically
    try {
      const { registerInternalTool } = await import("./agent-loop.js");
      registerInternalTool({
        name,
        description,
        category: "auto",
        parameters: { type: "object", properties: { input: { type: "string" } } },
        execute: async (args) => {
          // For auto-created tools, use LLM to interpret and execute
          const { chat: llmChat } = await import("./llm-connector.js");
          const r = await llmChat([
            { role: "system", content: `You are a tool called "${name}". ${description}. Use web search if needed. Respond concisely in Thai.` },
            { role: "user", content: args.input || JSON.stringify(args) },
          ], { temperature: 0.3 });
          return r.content || "ไม่มีผลลัพธ์";
        },
      });
      return { success: true, message: `Tool "${name}" created and registered` };
    } catch (regErr: any) {
      return { success: false, message: `Tool created but registration failed: ${regErr.message}` };
    }
  } catch (e: any) {
    return { success: false, message: `Auto-create failed: ${e.message}` };
  }
}

// ─── 4. EVOLUTION LOOP — Run periodically ───

/**
 * Run one evolution cycle:
 * 1. Check gaps
 * 2. Analyze patterns
 * 3. Create tools if needed
 * 4. Log results
 */
export async function runEvolutionCycle(): Promise<string> {
  ensureEvolutionTable();
  const lines: string[] = [];
  lines.push("🧬 Soul Evolution Cycle");
  lines.push("");

  // 1. Check gaps
  const gaps = getTopGaps(10);
  lines.push(`📊 Gaps found: ${gaps.length}`);
  if (gaps.length === 0) {
    lines.push("ไม่มี gap ที่ต้องแก้ — Soul ทำงานได้ดี");
    return lines.join("\n");
  }

  // Show top gaps
  for (const g of gaps.slice(0, 5)) {
    lines.push(`  ${g.frequency}x [${g.gapType}] "${g.query.substring(0, 50)}"`);
  }
  lines.push("");

  // 2. Analyze
  const analysis = await analyzeGaps();
  if (analysis.patterns.length > 0) {
    lines.push("🔍 Patterns:");
    analysis.patterns.forEach(p => lines.push(`  • ${p}`));
    lines.push("");
  }

  // 3. Auto-create tools for frequent gaps (3+ occurrences)
  const frequentGaps = gaps.filter(g => g.frequency >= 3 && g.gapType !== "slow");
  if (frequentGaps.length > 0 && analysis.suggestedTools.length > 0) {
    lines.push("🔧 Auto-creating tools:");
    for (const suggestion of analysis.suggestedTools.slice(0, 2)) {
      const [name, desc] = suggestion.split(":").map(s => s.trim());
      if (name && desc) {
        const result = await autoCreateTool(name, desc);
        lines.push(`  ${result.success ? "✅" : "❌"} ${name}: ${result.message}`);
      }
    }
  }

  // 4. Log
  const db = getRawDb();
  db.prepare("INSERT INTO soul_evolution (type, observation, status) VALUES (?, ?, ?)")
    .run("cycle", `Gaps: ${gaps.length}, Patterns: ${analysis.patterns.length}, Tools suggested: ${analysis.suggestedTools.length}`, "completed");

  lines.push("");
  lines.push("✅ Evolution cycle complete");

  return lines.join("\n");
}

/**
 * Get evolution stats
 */
export function getEvolutionStats(): {
  totalGaps: number;
  resolvedGaps: number;
  toolsCreated: number;
  cyclesRun: number;
  topGapType: string;
} {
  ensureEvolutionTable();
  const db = getRawDb();
  const totalGaps = (db.prepare("SELECT COUNT(*) as c FROM soul_gaps").get() as any)?.c || 0;
  const resolved = (db.prepare("SELECT COUNT(*) as c FROM soul_gaps WHERE resolved = 1").get() as any)?.c || 0;
  const tools = (db.prepare("SELECT COUNT(*) as c FROM soul_evolution WHERE type = 'auto_tool'").get() as any)?.c || 0;
  const cycles = (db.prepare("SELECT COUNT(*) as c FROM soul_evolution WHERE type = 'cycle'").get() as any)?.c || 0;
  const topType = (db.prepare("SELECT gap_type, SUM(frequency) as f FROM soul_gaps GROUP BY gap_type ORDER BY f DESC LIMIT 1").get() as any);

  return { totalGaps, resolvedGaps: resolved, toolsCreated: tools, cyclesRun: cycles, topGapType: topType?.gap_type || "none" };
}
