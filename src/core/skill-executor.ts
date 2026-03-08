/**
 * Skill Executor — Soul can actually RUN skills, not just know them
 *
 * Safety-first execution:
 * 1. Master must approve skill execution
 * 2. Skills run in sandboxed context
 * 3. Soul cannot modify its own core (philosophy, master binding)
 * 4. All executions are logged
 * 5. Skill changes must preserve Soul's principles
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";

export interface ExecutableSkill {
  id: number;
  name: string;
  description: string;
  skillType: "script" | "workflow" | "template" | "automation";
  code: string;
  language: string; // typescript, javascript, shell, workflow
  isApproved: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  runCount: number;
}

export interface ExecutionLog {
  id: number;
  skillId: number;
  input: string;
  output: string;
  success: boolean;
  duration: number;
  executedAt: string;
}

// Protected paths — Soul CANNOT modify these
const PROTECTED_PATTERNS = [
  "soul-engine.ts",
  "philosophy.ts",
  "master.ts",
  "schema.ts",
  "db/index.ts",
  "security.ts",
  "agent-loop.ts",
  "llm-connector.ts",
  "smart-cache.ts",
  "distillation.ts",
  "sync.ts",
  "network.ts",
  "skill-executor.ts",
  "server.ts",
  "index.ts",
];

function ensureSkillTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_executable_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      skill_type TEXT NOT NULL DEFAULT 'script',
      code TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'typescript',
      is_approved INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS soul_execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 1,
      duration INTEGER NOT NULL DEFAULT 0,
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (skill_id) REFERENCES soul_executable_skills(id)
    );
  `);
}

export async function createExecutableSkill(input: {
  name: string;
  description: string;
  skillType?: string;
  code: string;
  language?: string;
}): Promise<ExecutableSkill> {
  ensureSkillTables();
  const rawDb = getRawDb();

  // Safety check — cannot create skills that modify protected files
  if (isSelfDestructive(input.code)) {
    throw new Error(
      "Safety violation: This skill attempts to modify Soul's core files. " +
      "Soul cannot modify its own philosophy, master binding, or core engine. " +
      "This protects Soul's integrity."
    );
  }

  const row = rawDb
    .prepare(
      `INSERT INTO soul_executable_skills (name, description, skill_type, code, language)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.name,
      input.description,
      input.skillType || "script",
      input.code,
      input.language || "typescript"
    ) as any;

  await remember({
    content: `[Skill Created] ${input.name}: ${input.description} (${input.language || "typescript"}, awaiting approval)`,
    type: "learning",
    tags: ["skill", "executable", input.skillType || "script"],
    source: "skill-executor",
  });

  return mapSkill(row);
}

export async function approveSkill(skillId: number): Promise<ExecutableSkill | null> {
  ensureSkillTables();
  const rawDb = getRawDb();

  rawDb
    .prepare("UPDATE soul_executable_skills SET is_approved = 1 WHERE id = ?")
    .run(skillId);

  const row = rawDb
    .prepare("SELECT * FROM soul_executable_skills WHERE id = ?")
    .get(skillId) as any;

  if (row) {
    await remember({
      content: `[Skill Approved] Master approved skill "${row.name}" for execution`,
      type: "conversation",
      tags: ["skill", "approved"],
      source: "skill-executor",
    });
  }

  return row ? mapSkill(row) : null;
}

export async function evolveSkill(
  skillId: number,
  newCode: string,
  reason: string
): Promise<ExecutableSkill | null> {
  ensureSkillTables();
  const rawDb = getRawDb();

  // Safety check
  if (isSelfDestructive(newCode)) {
    throw new Error(
      "Safety violation: Evolved skill attempts to modify Soul's core. " +
      "Self-improvement must never destroy Soul's principles."
    );
  }

  const current = rawDb
    .prepare("SELECT * FROM soul_executable_skills WHERE id = ?")
    .get(skillId) as any;

  if (!current) return null;

  rawDb
    .prepare(
      `UPDATE soul_executable_skills
       SET code = ?, version = version + 1, is_approved = 0, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(newCode, skillId);

  await remember({
    content: `[Skill Evolved] "${current.name}" v${current.version} → v${current.version + 1}\nReason: ${reason}\n(Requires re-approval from master)`,
    type: "learning",
    tags: ["skill", "evolved", "self-improvement"],
    source: "skill-executor",
  });

  const row = rawDb
    .prepare("SELECT * FROM soul_executable_skills WHERE id = ?")
    .get(skillId) as any;

  return row ? mapSkill(row) : null;
}

export async function getExecutableSkills(
  approvedOnly = false
): Promise<ExecutableSkill[]> {
  ensureSkillTables();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_executable_skills";
  if (approvedOnly) query += " WHERE is_approved = 1";
  query += " ORDER BY run_count DESC, updated_at DESC";

  const rows = rawDb.prepare(query).all() as any[];
  return rows.map(mapSkill);
}

export async function logExecution(
  skillId: number,
  input: string,
  output: string,
  success: boolean,
  duration: number
): Promise<void> {
  ensureSkillTables();
  const rawDb = getRawDb();

  rawDb
    .prepare(
      `INSERT INTO soul_execution_log (skill_id, input, output, success, duration) VALUES (?, ?, ?, ?, ?)`
    )
    .run(skillId, input, output, success ? 1 : 0, duration);

  rawDb
    .prepare(
      `UPDATE soul_executable_skills SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?`
    )
    .run(skillId);
}

export async function getExecutionHistory(
  skillId?: number,
  limit = 20
): Promise<ExecutionLog[]> {
  ensureSkillTables();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_execution_log";
  const params: any[] = [];

  if (skillId) {
    query += " WHERE skill_id = ?";
    params.push(skillId);
  }
  query += " ORDER BY executed_at DESC LIMIT ?";
  params.push(limit);

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapLog);
}

/**
 * Safety: Check if code tries to modify Soul's core
 */
function isSelfDestructive(code: string): boolean {
  const lower = code.toLowerCase();

  for (const pattern of PROTECTED_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check for dangerous operations — comprehensive blocklist
  const dangerous = [
    // File destruction
    "rm -rf", "rmdir", "del /f", "format c:", "unlink",
    // Database destruction
    "drop table", "delete from masters", "delete from memories",
    "delete from soul_", "truncate table",
    // Process control
    "process.exit", "process.kill", "os.exit",
    // Shell execution (multiple forms)
    "child_process", "execsync", "execfilesync", "spawnsync",
    "exec(", "spawn(", "fork(",
    // Dynamic code execution
    "eval(", "function(", "new function",
    // Network exfil
    "curl ", "wget ", "nc ", "netcat",
    "powershell", "cmd /c", "cmd.exe",
    // Node internals
    "require('fs')", "require(\"fs\")",
    "require('net')", "require(\"net\")",
    "require('http')", "require(\"http\")",
    "import('child", "import(\"child",
    "import('fs", "import(\"fs",
    // Encoding tricks
    "atob(", "btoa(", "buffer.from",
    "string.fromcharcode",
    // Shutdown
    "shutdown", "reboot", "taskkill",
  ];

  return dangerous.some((d) => lower.includes(d.toLowerCase()));
}

function mapSkill(row: any): ExecutableSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    skillType: row.skill_type,
    code: row.code,
    language: row.language,
    isApproved: row.is_approved === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
  };
}

function mapLog(row: any): ExecutionLog {
  return {
    id: row.id,
    skillId: row.skill_id,
    input: row.input,
    output: row.output,
    success: row.success === 1,
    duration: row.duration,
    executedAt: row.executed_at,
  };
}
