#!/usr/bin/env node

/**
 * soul-learn — Pipe insights directly into Soul's memory
 *
 * Usage:
 *   soul-learn "something important"           # Quick learn
 *   echo '{"content":"...","type":"..."}' | soul-learn --stdin  # From stdin (JSON)
 *   soul-learn --stdin                          # Read plain text from stdin
 *
 * Used by Claude Code hooks to auto-feed insights to Soul.
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
  // Match the real Soul schema exactly
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

function learn(content: string, type: string = "knowledge", tags: string[] = [], source: string = "claude-code") {
  if (!content || content.trim().length < 5) return;

  const db = ensureDb();
  try {
    db.prepare(
      "INSERT INTO memories (content, type, tags, source) VALUES (?, ?, ?, ?)"
    ).run(content.trim(), type, JSON.stringify(tags), source);
  } finally {
    db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useStdin = args.includes("--stdin");
  const isJson = args.includes("--json");

  if (useStdin) {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    if (!input) process.exit(0);

    if (isJson || input.startsWith("{")) {
      try {
        const data = JSON.parse(input);
        // Support Claude Code hook format (Stop event)
        if (data.hook_event_name === "Stop" && data.response) {
          // Extract key insights from Claude's response
          const response = typeof data.response === "string" ? data.response : JSON.stringify(data.response);
          if (response.length > 50) {
            // Only learn substantial responses
            const summary = response.substring(0, 500);
            learn(
              `Claude Code insight: ${summary}`,
              "learning",
              ["claude-code", "auto-learn"],
              `claude-code:${data.session_id || "unknown"}`
            );
          }
        }
        // Support PostToolUse format
        else if (data.hook_event_name === "PostToolUse" && data.tool_input) {
          const toolName = data.tool_name || "unknown";
          // Learn from significant tool outputs
          if (["Edit", "Write", "Bash"].includes(toolName)) {
            const content = typeof data.tool_input === "string"
              ? data.tool_input
              : JSON.stringify(data.tool_input).substring(0, 300);
            learn(
              `Claude Code used ${toolName}: ${content}`,
              "learning",
              ["claude-code", "tool-use", toolName.toLowerCase()],
              `claude-code:${toolName}`
            );
          }
        }
        // Support direct JSON: { content, type, tags, source }
        else if (data.content) {
          learn(data.content, data.type, data.tags, data.source);
        }
      } catch {
        // Not JSON, treat as plain text
        learn(input, "knowledge", ["claude-code"]);
      }
    } else {
      learn(input, "knowledge", ["claude-code"]);
    }
  } else {
    // Direct argument mode
    const content = args.filter(a => !a.startsWith("--")).join(" ");
    if (!content) {
      console.log("Usage: soul-learn \"something to remember\"");
      console.log("       echo '{\"content\":\"...\"}' | soul-learn --stdin");
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
