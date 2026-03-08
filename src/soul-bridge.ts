#!/usr/bin/env node

/**
 * soul-bridge — Enable/disable Soul auto-learning from Claude Code
 *
 * Usage:
 *   soul-bridge enable    # Add hooks to Claude Code global settings
 *   soul-bridge disable   # Remove hooks
 *   soul-bridge status    # Check if enabled
 *
 * When enabled, Soul automatically learns from Claude Code's responses
 * and tool usage — no manual commands needed.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const SOUL_LEARN_PATH = path.join(os.homedir(), ".npm-global", "bin", "soul-learn");

// Find soul-learn binary path
function findSoulLearn(): string {
  // Try global npm bin
  const globalBin = process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Roaming", "npm", "soul-learn.cmd")
    : path.join("/usr", "local", "bin", "soul-learn");

  // Fallback: use node + direct path
  try {
    const { execSync } = require("child_process");
    const npmPrefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    const nodeModulesPath = path.join(npmPrefix, "node_modules", "soul-ai", "dist", "soul-learn.js");
    if (fs.existsSync(nodeModulesPath)) {
      return `node "${nodeModulesPath}"`;
    }
  } catch {}

  // Use npx as universal fallback
  return "npx soul-learn";
}

const HOOK_MARKER = "__soul_auto_learn__";

const SOUL_HOOKS = {
  Stop: [
    {
      matcher: "",
      _soul_marker: HOOK_MARKER,
      hooks: [
        {
          type: "command",
          command: `${findSoulLearn()} --stdin --json`,
          timeout: 5,
        },
      ],
    },
  ],
};

function readSettings(): any {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf-8"));
    }
  } catch {}
  return {};
}

function writeSettings(settings: any) {
  const dir = path.dirname(CLAUDE_SETTINGS);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
}

function enable() {
  const settings = readSettings();

  if (!settings.hooks) settings.hooks = {};

  // Add Stop hook
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  // Remove existing soul hooks first
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (h: any) => h._soul_marker !== HOOK_MARKER
  );
  settings.hooks.Stop.push(...SOUL_HOOKS.Stop);

  writeSettings(settings);
  console.log("\x1b[32mSoul auto-learning enabled!\x1b[0m");
  console.log("\x1b[2mClaude Code will now auto-feed insights to Soul after every response.\x1b[0m");
  console.log("\x1b[2mDisable with: soul-bridge disable\x1b[0m");
}

function disable() {
  const settings = readSettings();

  if (settings.hooks?.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.filter(
      (h: any) => h._soul_marker !== HOOK_MARKER
    );
    if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  writeSettings(settings);
  console.log("\x1b[33mSoul auto-learning disabled.\x1b[0m");
  console.log("\x1b[2mClaude Code will no longer auto-feed to Soul.\x1b[0m");
}

function status() {
  const settings = readSettings();
  const hasHook = settings.hooks?.Stop?.some(
    (h: any) => h._soul_marker === HOOK_MARKER
  );

  if (hasHook) {
    console.log("\x1b[32mSoul auto-learning: ENABLED\x1b[0m");
    console.log("\x1b[2mClaude Code → Soul (auto-learn on every response)\x1b[0m");
  } else {
    console.log("\x1b[33mSoul auto-learning: DISABLED\x1b[0m");
    console.log("\x1b[2mEnable with: soul-bridge enable\x1b[0m");
  }
}

// ─── Main ───

const cmd = process.argv[2];
switch (cmd) {
  case "enable":
  case "on":
    enable();
    break;
  case "disable":
  case "off":
    disable();
    break;
  case "status":
    status();
    break;
  default:
    console.log("Soul Bridge — Connect Claude Code ↔ Soul");
    console.log("");
    console.log("Usage:");
    console.log("  soul-bridge enable   — Auto-learn from Claude Code");
    console.log("  soul-bridge disable  — Stop auto-learning");
    console.log("  soul-bridge status   — Check connection status");
    console.log("");
    console.log("When enabled, Soul automatically learns from everything");
    console.log("Claude Code does — responses, code edits, tool usage.");
}
