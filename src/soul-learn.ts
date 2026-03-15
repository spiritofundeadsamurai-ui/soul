#!/usr/bin/env node

/**
 * soul-learn — Pipe insights from ANY AI agent into Soul's memory
 *
 * Usage:
 *   soul-learn "something important"                              # Quick learn
 *   echo '{"content":"...","type":"..."}' | soul-learn --stdin    # JSON from stdin
 *   soul-learn --stdin                                            # Plain text from stdin
 *   agent-output | soul-learn --stdin --json                      # From any agent hook
 *
 * Supported agent formats:
 *   - Claude Code hooks (Stop event, PostToolUse event)
 *   - Cursor/Windsurf/Cline MCP output
 *   - Aider after-change events
 *   - Generic JSON: { content, type, tags, source }
 *   - Plain text (any pipe)
 */

import Database from "better-sqlite3";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DB_PATH = path.join(SOUL_DIR, "soul.db");

function ensureDb(): Database.Database {
  if (!fs.existsSync(SOUL_DIR)) fs.mkdirSync(SOUL_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'knowledge',
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      source TEXT,
      context TEXT,
      superseded_by INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

function learn(content: string, type: string = "knowledge", tags: string[] = [], source: string = "agent") {
  if (!content || content.trim().length < 5) return;

  // Junk filter — block Claude Code session logs
  const junkPatterns = [/session_id.*transcript_path/, /permission_mode/, /acceptEdits/, /Agent used (Bash|Edit|Read|Write|Grep)/, /\{"command":/, /\.claude.*projects.*jsonl/i];
  if (junkPatterns.some(p => p.test(content))) return;

  const db = ensureDb();
  try {
    db.prepare(
      "INSERT INTO memories (content, type, tags, source) VALUES (?, ?, ?, ?)"
    ).run(content.trim(), type, JSON.stringify(tags), source);
  } finally {
    db.close();
  }
}

// ─── Agent Format Detection ───

function detectAgent(data: any): string {
  // Claude Code hooks
  if (data.hook_event_name) return "claude-code";
  // Cursor/Cline MCP format
  if (data.jsonrpc || data.method) return "mcp-agent";
  // Aider format
  if (data.aider_event || data.event_type === "file_change") return "aider";
  // Generic with source hint
  if (data.source) return data.source;
  // Default
  return "agent";
}

function processAgentData(data: any) {
  const agent = detectAgent(data);

  // ─── Claude Code: Stop event ───
  if (data.hook_event_name === "Stop" && data.response) {
    const response = typeof data.response === "string" ? data.response : JSON.stringify(data.response);
    if (response.length > 50) {
      learn(
        `Agent insight: ${response.substring(0, 500)}`,
        "learning",
        [agent, "auto-learn"],
        `${agent}:${data.session_id || "unknown"}`
      );
    }
    return true;
  }

  // ─── Claude Code: PostToolUse event ───
  if (data.hook_event_name === "PostToolUse" && data.tool_input) {
    const toolName = data.tool_name || "unknown";
    if (["Edit", "Write", "Bash"].includes(toolName)) {
      const content = typeof data.tool_input === "string"
        ? data.tool_input
        : JSON.stringify(data.tool_input).substring(0, 300);
      learn(
        `Agent used ${toolName}: ${content}`,
        "learning",
        [agent, "tool-use", toolName.toLowerCase()],
        `${agent}:${toolName}`
      );
    }
    return true;
  }

  // ─── MCP Agent (Cursor, Windsurf, Cline, Gemini) ───
  if (data.jsonrpc && data.result) {
    const result = typeof data.result === "string" ? data.result : JSON.stringify(data.result);
    if (result.length > 30) {
      learn(
        `MCP response: ${result.substring(0, 500)}`,
        "learning",
        ["mcp", agent, "auto-learn"],
        `${agent}:mcp`
      );
    }
    return true;
  }

  // ─── Aider: file change event ───
  if (data.aider_event || data.event_type === "file_change") {
    const files = data.files || data.changed_files || [];
    const summary = data.summary || data.commit_message || `Changed ${files.length} file(s)`;
    learn(
      `Aider change: ${summary}`,
      "learning",
      ["aider", "code-change"],
      "aider"
    );
    return true;
  }

  // ─── Generic JSON: { content, type, tags, source } ───
  if (data.content) {
    learn(data.content, data.type, data.tags, data.source || agent);
    return true;
  }

  return false;
}

// ─── Main ───

async function main() {
  const args = process.argv.slice(2);
  const useStdin = args.includes("--stdin");
  const isJson = args.includes("--json");

  if (useStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    if (!input) process.exit(0);

    if (isJson || input.startsWith("{")) {
      try {
        const data = JSON.parse(input);
        if (!processAgentData(data)) {
          // Fallback: store raw JSON as knowledge
          learn(input.substring(0, 500), "knowledge", ["agent", "raw"]);
        }
      } catch {
        // Not valid JSON, treat as plain text
        learn(input, "knowledge", ["agent"]);
      }
    } else {
      learn(input, "knowledge", ["agent"]);
    }
  } else {
    // Direct argument mode
    const content = args.filter(a => !a.startsWith("--")).join(" ");
    if (!content) {
      console.log("Soul Learn — Feed knowledge from any AI agent into Soul\n");
      console.log("Usage:");
      console.log("  soul-learn \"something to remember\"");
      console.log("  echo '{\"content\":\"...\"}' | soul-learn --stdin");
      console.log("  agent-output | soul-learn --stdin --json");
      console.log("\nSupported agents: Claude Code, Cursor, Windsurf, Cline, Aider, Gemini CLI");
      console.log("Or pipe output from any command.");
      process.exit(0);
    }
    learn(content);
    console.log(`Soul learned: "${content.substring(0, 80)}${content.length > 80 ? "..." : ""}"`);
  }
}

main().catch((err) => {
  console.error("soul-learn error:", err.message);
  process.exit(1);
});
