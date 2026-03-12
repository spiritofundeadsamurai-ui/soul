/**
 * Auto-Tool Creator — Completes the self-healing loop
 *
 * When the self-healing engine detects repeated tool usage patterns,
 * this module auto-generates composite tools that chain those sequences.
 *
 * Safety:
 * - Auto-created tools require master approval before use (like skills)
 * - Generated code can only call existing soul tools
 * - Max 20 auto-tools to prevent bloat
 */

import { getRawDb } from "../db/index.js";
import { detectRepeatedPatterns, markPatternSuggested } from "./self-healing.js";

// ─── Interfaces ───

export interface ParamDef {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  defaultValue?: any;
}

export interface AutoToolSuggestion {
  id: string;
  name: string;
  description: string;
  toolSequence: string[];
  frequency: number;
  confidence: number;
  suggestedParams: ParamDef[];
  status: "suggested" | "approved" | "created" | "rejected";
}

interface AutoToolRow {
  id: number;
  name: string;
  description: string;
  tool_sequence: string;
  params: string;
  code: string;
  frequency: number;
  confidence: number;
  status: string;
  created_at: string;
  approved_at: string | null;
}

// ─── Lazy table creation ───

let _tableCreated = false;
const MAX_AUTO_TOOLS = 20;

function ensureAutoToolTable() {
  if (_tableCreated) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_auto_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      tool_sequence TEXT NOT NULL DEFAULT '[]',
      params TEXT NOT NULL DEFAULT '[]',
      code TEXT NOT NULL DEFAULT '',
      frequency INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_tools_status ON soul_auto_tools(status)
  `);
  _tableCreated = true;
}

// ─── Pattern Analysis ───

/**
 * Analyze tool usage patterns from soul_tool_patterns table.
 * Looks for tool sequences that repeat 3+ times and builds suggestions.
 */
export function analyzePatterns(): AutoToolSuggestion[] {
  ensureAutoToolTable();
  const db = getRawDb();

  // Check current count — don't exceed max
  const countRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM soul_auto_tools WHERE status != 'rejected'`
  ).get() as any;
  if (countRow && countRow.cnt >= MAX_AUTO_TOOLS) {
    return [];
  }

  // Get repeated patterns from self-healing engine
  const patterns = detectRepeatedPatterns(3);
  if (patterns.length === 0) return [];

  // Also look for tool sequences: tools called in close time proximity
  const sequenceRows = db.prepare(`
    SELECT
      group_concat(tool_name, '->') as sequence,
      COUNT(*) as freq
    FROM (
      SELECT tool_name, args_pattern,
        NTILE(100) OVER (ORDER BY last_used) as time_bucket
      FROM soul_tool_patterns
      WHERE call_count >= 2
    )
    GROUP BY time_bucket
    HAVING COUNT(*) >= 2
    ORDER BY freq DESC
    LIMIT 10
  `).all() as any[];

  const suggestions: AutoToolSuggestion[] = [];
  const existingNames = new Set(
    (db.prepare(`SELECT name FROM soul_auto_tools`).all() as any[])
      .map((r) => r.name)
  );

  // Build suggestions from repeated single-tool patterns
  for (const p of patterns) {
    const toolName = `soul_auto_${p.toolName.replace("soul_", "")}`;
    if (existingNames.has(toolName)) continue;

    const confidence = Math.min(p.callCount / 10, 1.0);
    if (confidence < 0.3) continue;

    // Parse args pattern to derive params
    const suggestedParams = deriveParams(p.argsPattern);

    suggestions.push({
      id: `pat_${p.toolName}_${Date.now()}`,
      name: toolName,
      description: `Auto-generated: optimized ${p.toolName} with preset pattern (${p.argsPattern})`,
      toolSequence: [p.toolName],
      frequency: p.callCount,
      confidence,
      suggestedParams,
      status: "suggested",
    });
  }

  // Build suggestions from tool sequences
  for (const row of sequenceRows) {
    if (!row.sequence) continue;
    const tools = (row.sequence as string).split("->").map((t) => t.trim());
    if (tools.length < 2) continue;

    const seqName = tools
      .map((t) => t.replace("soul_", ""))
      .join("_then_");
    const toolName = `soul_auto_${seqName}`.substring(0, 60);
    if (existingNames.has(toolName)) continue;

    const confidence = Math.min(row.freq / 5, 1.0);
    if (confidence < 0.3) continue;

    suggestions.push({
      id: `seq_${seqName}_${Date.now()}`,
      name: toolName,
      description: `Auto-generated: chain ${tools.join(" -> ")} (detected ${row.freq} times)`,
      toolSequence: tools,
      frequency: row.freq,
      confidence,
      suggestedParams: [],
      status: "suggested",
    });
  }

  return suggestions;
}

/**
 * Derive parameter definitions from an args pattern string.
 * Pattern format: "key1:type,key2:type"
 */
function deriveParams(argsPattern: string): ParamDef[] {
  if (!argsPattern) return [];
  const params: ParamDef[] = [];

  const parts = argsPattern.split(",");
  for (const part of parts) {
    const [name, type] = part.split(":");
    if (!name || !type) continue;

    params.push({
      name: name.trim(),
      type: (type.trim() === "number" ? "number" : type.trim() === "boolean" ? "boolean" : "string") as ParamDef["type"],
      description: `Parameter: ${name.trim()}`,
      required: true,
    });
  }

  return params;
}

// ─── Tool Generation ───

/**
 * Generate TypeScript code for a composite tool that chains detected tool sequence.
 * Generated code calls existing soul tools via the toolStore, passing results between steps.
 */
export function generateToolCode(suggestion: AutoToolSuggestion): string {
  const { toolSequence, suggestedParams, name, description } = suggestion;

  let code = `// Auto-generated tool: ${name}\n`;
  code += `// ${description}\n`;
  code += `// Tool sequence: ${toolSequence.join(" -> ")}\n\n`;

  // Build the function body
  code += `async function execute(args, toolStore) {\n`;
  code += `  const results = [];\n`;
  code += `  let previousResult = null;\n\n`;

  for (let i = 0; i < toolSequence.length; i++) {
    const tool = toolSequence[i];
    code += `  // Step ${i + 1}: ${tool}\n`;
    code += `  const entry_${i} = toolStore.get("${tool}");\n`;
    code += `  if (!entry_${i}) {\n`;
    code += `    results.push({ step: ${i + 1}, tool: "${tool}", error: "Tool not found" });\n`;
    code += `  } else {\n`;
    code += `    try {\n`;

    if (i === 0) {
      code += `      const result_${i} = await entry_${i}.handler(args);\n`;
    } else {
      code += `      const stepArgs = { ...args, _previousResult: previousResult };\n`;
      code += `      const result_${i} = await entry_${i}.handler(stepArgs);\n`;
    }

    code += `      previousResult = result_${i};\n`;
    code += `      results.push({ step: ${i + 1}, tool: "${tool}", success: true, result: result_${i} });\n`;
    code += `    } catch (err) {\n`;
    code += `      results.push({ step: ${i + 1}, tool: "${tool}", error: err.message || String(err) });\n`;
    code += `    }\n`;
    code += `  }\n\n`;
  }

  code += `  return results;\n`;
  code += `}\n`;

  return code;
}

/**
 * Create an auto-tool from a suggestion: generates code, persists to DB.
 * Does NOT register it — registration happens only after master approval.
 */
export async function createAutoTool(
  suggestion: AutoToolSuggestion
): Promise<{ toolName: string; code: string }> {
  ensureAutoToolTable();
  const db = getRawDb();

  // Check max limit
  const countRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM soul_auto_tools WHERE status != 'rejected'`
  ).get() as any;
  if (countRow && countRow.cnt >= MAX_AUTO_TOOLS) {
    throw new Error(
      `Auto-tool limit reached (${MAX_AUTO_TOOLS}). Reject or remove existing auto-tools first.`
    );
  }

  // Generate code
  const code = generateToolCode(suggestion);

  // Persist
  db.prepare(`
    INSERT OR REPLACE INTO soul_auto_tools
    (name, description, tool_sequence, params, code, frequency, confidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested')
  `).run(
    suggestion.name,
    suggestion.description,
    JSON.stringify(suggestion.toolSequence),
    JSON.stringify(suggestion.suggestedParams),
    code,
    suggestion.frequency,
    suggestion.confidence
  );

  // Mark source patterns as suggested so they don't re-trigger
  for (const tool of suggestion.toolSequence) {
    markPatternSuggested(tool, "");
  }

  return { toolName: suggestion.name, code };
}

// ─── Persistence ───

export function saveSuggestion(suggestion: AutoToolSuggestion): void {
  ensureAutoToolTable();
  const db = getRawDb();

  const existing = db.prepare(
    `SELECT id FROM soul_auto_tools WHERE name = ?`
  ).get(suggestion.name) as any;

  if (existing) {
    db.prepare(`
      UPDATE soul_auto_tools
      SET description = ?, tool_sequence = ?, params = ?, frequency = ?, confidence = ?, status = ?
      WHERE name = ?
    `).run(
      suggestion.description,
      JSON.stringify(suggestion.toolSequence),
      JSON.stringify(suggestion.suggestedParams),
      suggestion.frequency,
      suggestion.confidence,
      suggestion.status,
      suggestion.name
    );
  } else {
    db.prepare(`
      INSERT INTO soul_auto_tools (name, description, tool_sequence, params, code, frequency, confidence, status)
      VALUES (?, ?, ?, ?, '', ?, ?, ?)
    `).run(
      suggestion.name,
      suggestion.description,
      JSON.stringify(suggestion.toolSequence),
      JSON.stringify(suggestion.suggestedParams),
      suggestion.frequency,
      suggestion.confidence,
      suggestion.status
    );
  }
}

export function listSuggestions(
  statusFilter?: string
): AutoToolSuggestion[] {
  ensureAutoToolTable();
  const db = getRawDb();

  let query = `SELECT * FROM soul_auto_tools`;
  const params: any[] = [];
  if (statusFilter) {
    query += ` WHERE status = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY frequency DESC, confidence DESC`;

  const rows = db.prepare(query).all(...params) as AutoToolRow[];
  return rows.map(mapRow);
}

export function approveSuggestion(id: number): AutoToolSuggestion | null {
  ensureAutoToolTable();
  const db = getRawDb();

  const row = db.prepare(`SELECT * FROM soul_auto_tools WHERE id = ?`).get(id) as AutoToolRow | undefined;
  if (!row) return null;

  // Generate code if not yet generated
  let code = row.code;
  if (!code) {
    const suggestion = mapRow(row);
    code = generateToolCode(suggestion);
  }

  db.prepare(`
    UPDATE soul_auto_tools
    SET status = 'approved', approved_at = datetime('now'), code = ?
    WHERE id = ?
  `).run(code, id);

  const updated = db.prepare(`SELECT * FROM soul_auto_tools WHERE id = ?`).get(id) as AutoToolRow;
  return mapRow(updated);
}

export function rejectSuggestion(id: number): AutoToolSuggestion | null {
  ensureAutoToolTable();
  const db = getRawDb();

  const row = db.prepare(`SELECT * FROM soul_auto_tools WHERE id = ?`).get(id) as AutoToolRow | undefined;
  if (!row) return null;

  db.prepare(`
    UPDATE soul_auto_tools SET status = 'rejected' WHERE id = ?
  `).run(id);

  const updated = db.prepare(`SELECT * FROM soul_auto_tools WHERE id = ?`).get(id) as AutoToolRow;
  return mapRow(updated);
}

export function getAutoTool(id: number): AutoToolSuggestion | null {
  ensureAutoToolTable();
  const db = getRawDb();

  const row = db.prepare(`SELECT * FROM soul_auto_tools WHERE id = ?`).get(id) as AutoToolRow | undefined;
  return row ? mapRow(row) : null;
}

// ─── Integration with self-healing ───

/**
 * Called during health checks. Analyzes patterns and auto-suggests
 * when they cross the threshold (3+ repeats, 0.7+ confidence).
 */
export function checkAndSuggestAutoTools(): AutoToolSuggestion[] {
  const suggestions = analyzePatterns();
  const saved: AutoToolSuggestion[] = [];

  for (const s of suggestions) {
    if (s.confidence >= 0.7 && s.frequency >= 3) {
      saveSuggestion(s);
      saved.push(s);
    }
  }

  return saved;
}

// ─── Helpers ───

function mapRow(row: AutoToolRow): AutoToolSuggestion {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    toolSequence: safeParseJSON(row.tool_sequence, []),
    frequency: row.frequency,
    confidence: row.confidence,
    suggestedParams: safeParseJSON(row.params, []),
    status: row.status as AutoToolSuggestion["status"],
  };
}

function safeParseJSON<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
