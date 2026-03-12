#!/usr/bin/env node

/**
 * soul-bridge — Connect ANY AI agent to Soul's auto-learning
 *
 * Supported agents:
 *   - Claude Code    (~/.claude/settings.json hooks)
 *   - Cursor         (~/.cursor/settings.json / MCP)
 *   - Windsurf       (~/.windsurf/settings.json)
 *   - Cline          (~/.cline/settings.json)
 *   - Aider          (~/.aider/config.yml)
 *   - Any agent      (stdin pipe: agent output | soul-learn --stdin)
 *
 * Usage:
 *   soul-bridge enable                  # Auto-detect & connect all found agents
 *   soul-bridge enable claude           # Connect Claude Code only
 *   soul-bridge enable cursor           # Connect Cursor only
 *   soul-bridge enable --all            # Connect all supported agents
 *   soul-bridge disable                 # Disconnect all agents
 *   soul-bridge disable claude          # Disconnect specific agent
 *   soul-bridge status                  # Show all connections
 *   soul-bridge list                    # List supported agents
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

const HOME = os.homedir();
const HOOK_MARKER = "__soul_auto_learn__";

// ─── Colors ───

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// ─── Agent Definitions ───

interface AgentConfig {
  id: string;
  name: string;
  settingsPath: string;
  type: "hooks-json" | "mcp-json" | "yaml-config" | "env-file";
  detect: () => boolean;
  enable: (soulLearnCmd: string) => void;
  disable: () => void;
  isEnabled: () => boolean;
}

function findSoulLearn(): string {
  // Try global npm bin (Windows)
  if (process.platform === "win32") {
    const appData = path.join(HOME, "AppData", "Roaming", "npm", "soul-learn.cmd");
    if (fs.existsSync(appData)) return `"${appData}"`;
  }

  // Try global npm bin (Unix)
  const unixBin = path.join("/usr", "local", "bin", "soul-learn");
  if (fs.existsSync(unixBin)) return unixBin;

  // Try npm prefix
  try {
    const npmPrefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    const nodeModulesPath = path.join(npmPrefix, "node_modules", "soul-ai", "dist", "soul-learn.js");
    if (fs.existsSync(nodeModulesPath)) {
      return `node "${nodeModulesPath}"`;
    }
  } catch {}

  // Universal fallback
  return "npx soul-learn";
}

// ─── Helper: Read/Write JSON settings ───

function readJson(filePath: string): any {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}
  return {};
}

function writeJson(filePath: string, data: any) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Agent: Claude Code ───

function createClaudeAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".claude", "settings.json");

  return {
    id: "claude",
    name: "Claude Code",
    settingsPath,
    type: "hooks-json",
    detect: () => {
      return fs.existsSync(path.join(HOME, ".claude")) ||
        fs.existsSync(settingsPath);
    },
    enable: (cmd) => {
      const settings = readJson(settingsPath);
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.Stop) settings.hooks.Stop = [];
      settings.hooks.Stop = settings.hooks.Stop.filter((h: any) => h._soul_marker !== HOOK_MARKER);
      settings.hooks.Stop.push({
        matcher: "",
        _soul_marker: HOOK_MARKER,
        hooks: [{ type: "command", command: `${cmd} --stdin --json`, timeout: 5 }],
      });
      writeJson(settingsPath, settings);
    },
    disable: () => {
      const settings = readJson(settingsPath);
      if (settings.hooks?.Stop) {
        settings.hooks.Stop = settings.hooks.Stop.filter((h: any) => h._soul_marker !== HOOK_MARKER);
        if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }
      writeJson(settingsPath, settings);
    },
    isEnabled: () => {
      const settings = readJson(settingsPath);
      return settings.hooks?.Stop?.some((h: any) => h._soul_marker === HOOK_MARKER) ?? false;
    },
  };
}

// ─── Agent: Cursor ───

function createCursorAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".cursor", "settings.json");

  return {
    id: "cursor",
    name: "Cursor",
    settingsPath,
    type: "mcp-json",
    detect: () => {
      return fs.existsSync(path.join(HOME, ".cursor")) ||
        fs.existsSync(settingsPath);
    },
    enable: (cmd) => {
      const settings = readJson(settingsPath);
      // Cursor uses MCP servers or custom commands
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers["soul-bridge"] = {
        command: "npx",
        args: ["soul-ai"],
        _soul_marker: HOOK_MARKER,
      };
      // Also add to hooks if Cursor supports them
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.onSave) settings.hooks.onSave = [];
      settings.hooks.onSave = settings.hooks.onSave.filter((h: any) => h._soul_marker !== HOOK_MARKER);
      settings.hooks.onSave.push({
        _soul_marker: HOOK_MARKER,
        command: `${cmd} --stdin`,
      });
      writeJson(settingsPath, settings);
    },
    disable: () => {
      const settings = readJson(settingsPath);
      if (settings.mcpServers?.["soul-bridge"]) {
        delete settings.mcpServers["soul-bridge"];
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      if (settings.hooks?.onSave) {
        settings.hooks.onSave = settings.hooks.onSave.filter((h: any) => h._soul_marker !== HOOK_MARKER);
        if (settings.hooks.onSave.length === 0) delete settings.hooks.onSave;
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }
      writeJson(settingsPath, settings);
    },
    isEnabled: () => {
      const settings = readJson(settingsPath);
      return !!settings.mcpServers?.["soul-bridge"]?._soul_marker ||
        settings.hooks?.onSave?.some((h: any) => h._soul_marker === HOOK_MARKER) || false;
    },
  };
}

// ─── Agent: Windsurf ───

function createWindsurfAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".windsurf", "settings.json");

  return {
    id: "windsurf",
    name: "Windsurf",
    settingsPath,
    type: "mcp-json",
    detect: () => {
      return fs.existsSync(path.join(HOME, ".windsurf")) ||
        fs.existsSync(path.join(HOME, ".codeium"));
    },
    enable: (cmd) => {
      const settings = readJson(settingsPath);
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers["soul-bridge"] = {
        command: "npx",
        args: ["soul-ai"],
        _soul_marker: HOOK_MARKER,
      };
      writeJson(settingsPath, settings);
    },
    disable: () => {
      const settings = readJson(settingsPath);
      if (settings.mcpServers?.["soul-bridge"]) {
        delete settings.mcpServers["soul-bridge"];
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      writeJson(settingsPath, settings);
    },
    isEnabled: () => {
      const settings = readJson(settingsPath);
      return !!settings.mcpServers?.["soul-bridge"]?._soul_marker;
    },
  };
}

// ─── Agent: Cline ───

function createClineAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".cline", "settings.json");

  return {
    id: "cline",
    name: "Cline",
    settingsPath,
    type: "mcp-json",
    detect: () => {
      return fs.existsSync(path.join(HOME, ".cline"));
    },
    enable: (cmd) => {
      const settings = readJson(settingsPath);
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers["soul-bridge"] = {
        command: "npx",
        args: ["soul-ai"],
        _soul_marker: HOOK_MARKER,
      };
      writeJson(settingsPath, settings);
    },
    disable: () => {
      const settings = readJson(settingsPath);
      if (settings.mcpServers?.["soul-bridge"]) {
        delete settings.mcpServers["soul-bridge"];
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      writeJson(settingsPath, settings);
    },
    isEnabled: () => {
      const settings = readJson(settingsPath);
      return !!settings.mcpServers?.["soul-bridge"]?._soul_marker;
    },
  };
}

// ─── Agent: Aider ───

function createAiderAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".aider.conf.yml");
  const envPath = path.join(HOME, ".aider.env");

  return {
    id: "aider",
    name: "Aider",
    settingsPath,
    type: "yaml-config",
    detect: () => {
      return fs.existsSync(settingsPath) || fs.existsSync(envPath) ||
        fs.existsSync(path.join(HOME, ".aider"));
    },
    enable: (cmd) => {
      // Aider supports --after-change hook
      let content = "";
      if (fs.existsSync(settingsPath)) {
        content = fs.readFileSync(settingsPath, "utf-8");
      }
      // Remove old soul bridge lines
      const lines = content.split("\n").filter(l => !l.includes(HOOK_MARKER) && !l.includes("soul-learn"));
      lines.push(`# ${HOOK_MARKER}`);
      lines.push(`after-change: ${cmd} --stdin`);
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsPath, lines.join("\n") + "\n");
    },
    disable: () => {
      if (!fs.existsSync(settingsPath)) return;
      const content = fs.readFileSync(settingsPath, "utf-8");
      const lines = content.split("\n").filter(l => !l.includes(HOOK_MARKER) && !l.includes("soul-learn"));
      fs.writeFileSync(settingsPath, lines.join("\n"));
    },
    isEnabled: () => {
      if (!fs.existsSync(settingsPath)) return false;
      const content = fs.readFileSync(settingsPath, "utf-8");
      return content.includes(HOOK_MARKER);
    },
  };
}

// ─── Agent: Gemini CLI ───

function createGeminiAgent(): AgentConfig {
  const settingsPath = path.join(HOME, ".gemini", "settings.json");

  return {
    id: "gemini",
    name: "Gemini CLI",
    settingsPath,
    type: "mcp-json",
    detect: () => {
      return fs.existsSync(path.join(HOME, ".gemini"));
    },
    enable: (cmd) => {
      const settings = readJson(settingsPath);
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers["soul-bridge"] = {
        command: "npx",
        args: ["soul-ai"],
        _soul_marker: HOOK_MARKER,
      };
      writeJson(settingsPath, settings);
    },
    disable: () => {
      const settings = readJson(settingsPath);
      if (settings.mcpServers?.["soul-bridge"]) {
        delete settings.mcpServers["soul-bridge"];
        if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      }
      writeJson(settingsPath, settings);
    },
    isEnabled: () => {
      const settings = readJson(settingsPath);
      return !!settings.mcpServers?.["soul-bridge"]?._soul_marker;
    },
  };
}

// ─── All Agents ───

const ALL_AGENTS: AgentConfig[] = [
  createClaudeAgent(),
  createCursorAgent(),
  createWindsurfAgent(),
  createClineAgent(),
  createAiderAgent(),
  createGeminiAgent(),
];

function getAgent(id: string): AgentConfig | undefined {
  return ALL_AGENTS.find(a => a.id === id);
}

function getDetectedAgents(): AgentConfig[] {
  return ALL_AGENTS.filter(a => a.detect());
}

// ─── Commands ───

function enable(agentId?: string, forceAll?: boolean) {
  const cmd = findSoulLearn();
  let targets: AgentConfig[];

  if (forceAll) {
    targets = ALL_AGENTS;
  } else if (agentId) {
    const agent = getAgent(agentId);
    if (!agent) {
      console.log(`${C.red}Unknown agent: ${agentId}${C.reset}`);
      console.log(`${C.dim}Available: ${ALL_AGENTS.map(a => a.id).join(", ")}${C.reset}`);
      return;
    }
    targets = [agent];
  } else {
    // Auto-detect
    targets = getDetectedAgents();
    if (targets.length === 0) {
      console.log(`${C.yellow}No AI agents detected on this system.${C.reset}`);
      console.log(`${C.dim}Supported agents:${C.reset}`);
      for (const a of ALL_AGENTS) {
        console.log(`  ${C.cyan}${a.id.padEnd(12)}${C.reset}${a.name}`);
      }
      console.log(`\n${C.dim}Install an agent first, or use: soul-bridge enable <agent>${C.reset}`);
      return;
    }
  }

  let connected = 0;
  for (const agent of targets) {
    try {
      agent.enable(cmd);
      console.log(`${C.green}✓${C.reset} ${C.bold}${agent.name}${C.reset} ${C.green}connected${C.reset} ${C.dim}(${agent.settingsPath})${C.reset}`);
      connected++;
    } catch (err: any) {
      console.log(`${C.red}✗${C.reset} ${agent.name} — ${err.message}`);
    }
  }

  if (connected > 0) {
    console.log(`\n${C.green}${C.bold}Soul auto-learning enabled!${C.reset}`);
    console.log(`${C.dim}${connected} agent${connected > 1 ? "s" : ""} now feed insights to Soul automatically.${C.reset}`);
    console.log(`${C.dim}Disable with: soul-bridge disable${C.reset}`);
  }
}

function disable(agentId?: string) {
  const targets = agentId ? [getAgent(agentId)].filter(Boolean) as AgentConfig[] : ALL_AGENTS;

  let disconnected = 0;
  for (const agent of targets) {
    if (agent.isEnabled()) {
      try {
        agent.disable();
        console.log(`${C.yellow}✓${C.reset} ${agent.name} ${C.yellow}disconnected${C.reset}`);
        disconnected++;
      } catch (err: any) {
        console.log(`${C.red}✗${C.reset} ${agent.name} — ${err.message}`);
      }
    }
  }

  if (disconnected === 0) {
    console.log(`${C.dim}No active connections to disconnect.${C.reset}`);
  } else {
    console.log(`\n${C.yellow}Soul auto-learning disabled for ${disconnected} agent${disconnected > 1 ? "s" : ""}.${C.reset}`);
  }
}

function status() {
  console.log(`\n${C.bold}${C.magenta}Soul Bridge${C.reset} — Agent Connections\n`);

  const detected = getDetectedAgents();
  let anyEnabled = false;

  for (const agent of ALL_AGENTS) {
    const installed = agent.detect();
    const enabled = agent.isEnabled();
    if (enabled) anyEnabled = true;

    let statusIcon: string;
    let statusText: string;
    if (enabled) {
      statusIcon = `${C.green}●${C.reset}`;
      statusText = `${C.green}connected${C.reset}`;
    } else if (installed) {
      statusIcon = `${C.yellow}○${C.reset}`;
      statusText = `${C.yellow}detected${C.reset}${C.dim} (not connected)${C.reset}`;
    } else {
      statusIcon = `${C.dim}·${C.reset}`;
      statusText = `${C.dim}not installed${C.reset}`;
    }

    console.log(`  ${statusIcon} ${C.bold}${agent.name.padEnd(14)}${C.reset} ${statusText}`);
  }

  console.log("");
  if (anyEnabled) {
    console.log(`${C.green}Soul is learning from connected agents automatically.${C.reset}`);
  } else if (detected.length > 0) {
    console.log(`${C.yellow}${detected.length} agent${detected.length > 1 ? "s" : ""} detected but not connected.${C.reset}`);
    console.log(`${C.dim}Run: soul-bridge enable${C.reset}`);
  } else {
    console.log(`${C.dim}No agents detected. Install an AI agent to get started.${C.reset}`);
  }

  // Universal pipe method
  console.log(`\n${C.dim}Universal method (works with any agent):${C.reset}`);
  console.log(`${C.cyan}  your-agent-output | npx soul-learn --stdin${C.reset}`);
}

function listAgents() {
  console.log(`\n${C.bold}Supported AI Agents:${C.reset}\n`);

  for (const agent of ALL_AGENTS) {
    const installed = agent.detect();
    const icon = installed ? `${C.green}✓${C.reset}` : `${C.dim}·${C.reset}`;
    console.log(`  ${icon} ${C.cyan}${agent.id.padEnd(12)}${C.reset} ${agent.name}${C.dim} (${agent.type})${C.reset}`);
  }

  console.log(`\n${C.bold}Universal (any agent):${C.reset}`);
  console.log(`  ${C.cyan}pipe${C.reset}         ${C.dim}your-output | npx soul-learn --stdin${C.reset}`);
  console.log(`  ${C.cyan}direct${C.reset}       ${C.dim}npx soul-learn "something to remember"${C.reset}`);
  console.log(`  ${C.cyan}json${C.reset}         ${C.dim}echo '{"content":"..."}' | npx soul-learn --stdin --json${C.reset}`);
  console.log(`  ${C.cyan}http${C.reset}         ${C.dim}curl -X POST http://localhost:3000/api/learn -d '{"content":"..."}'${C.reset}`);
  console.log(`  ${C.cyan}mcp${C.reset}          ${C.dim}Add soul-ai as MCP server in any compatible agent${C.reset}`);
}

// ─── Main ───

const args = process.argv.slice(2);
const cmd = args[0];
const target = args[1];
const hasAll = args.includes("--all");

switch (cmd) {
  case "enable":
  case "on":
  case "connect":
    enable(target, hasAll);
    break;
  case "disable":
  case "off":
  case "disconnect":
    disable(target);
    break;
  case "status":
  case "check":
    status();
    break;
  case "list":
  case "agents":
    listAgents();
    break;
  default:
    console.log(`
${C.magenta}${C.bold}Soul Bridge${C.reset} — Connect ANY AI agent to Soul

${C.bold}Usage:${C.reset}
  soul-bridge enable               Auto-detect & connect all found agents
  soul-bridge enable ${C.cyan}claude${C.reset}        Connect specific agent
  soul-bridge enable --all         Connect all supported agents
  soul-bridge disable              Disconnect all agents
  soul-bridge disable ${C.cyan}cursor${C.reset}       Disconnect specific agent
  soul-bridge status               Show all connections
  soul-bridge list                 List supported agents

${C.bold}Supported Agents:${C.reset}
  ${C.cyan}claude${C.reset}    Claude Code     (hooks)
  ${C.cyan}cursor${C.reset}    Cursor          (MCP + hooks)
  ${C.cyan}windsurf${C.reset}  Windsurf        (MCP)
  ${C.cyan}cline${C.reset}     Cline           (MCP)
  ${C.cyan}aider${C.reset}     Aider           (after-change hook)
  ${C.cyan}gemini${C.reset}    Gemini CLI      (MCP)

${C.bold}Universal (any agent):${C.reset}
  ${C.dim}your-agent | npx soul-learn --stdin${C.reset}
  ${C.dim}npx soul-learn "something to remember"${C.reset}
`);
}
