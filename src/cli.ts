#!/usr/bin/env node

/**
 * Soul CLI — Standalone AI Agent (like Claude Code)
 *
 * Features:
 *   - Multi-turn conversation with full context
 *   - Session persistence — resume previous conversations
 *   - Message queue — keep typing while Soul thinks, messages processed in order
 *   - Debounce — rapid Enter presses merge into one message
 *   - Conversation history flows to LLM every turn
 *   - /new to start fresh, /continue to resume last session
 */

import * as readline from "readline";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { soul } from "./core/soul-engine.js";
import {
  runAgentLoop,
  registerAllInternalTools,
  saveConversationTurn,
  getConversationHistory,
  listSessions,
  extractSessionInsights,
  type ProgressEvent,
} from "./core/agent-loop.js";
import { getDefaultConfig, listConfiguredProviders, addProvider } from "./core/llm-connector.js";

// ─── Terminal Colors ───

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const SOUL_DIR = path.join(os.homedir(), ".soul");
const SESSION_FILE = path.join(SOUL_DIR, "last-session.txt");

// ─── State ───

let isProcessing = false;
let turnCount = 0;

// Message queue + debounce
const messageQueue: string[] = [];
let debounceBuffer: string[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1500; // 1.5s — if user types multiple lines quickly, merge them

// ─── Command Definitions ───

const COMMANDS = [
  { cmd: "/new",      desc: "Start a new conversation",        alias: [] },
  { cmd: "/history",  desc: "Show conversation history",       alias: ["/hist"] },
  { cmd: "/sessions", desc: "List past sessions",              alias: ["/sess"] },
  { cmd: "/status",   desc: "Soul's status",                   alias: [] },
  { cmd: "/memory",   desc: "Memory statistics",               alias: ["/mem"] },
  { cmd: "/model",    desc: "Current LLM info",                alias: [] },
  { cmd: "/clear",    desc: "Clear screen",                    alias: ["/cls"] },
  { cmd: "/help",     desc: "Show all commands",               alias: ["/h"] },
  { cmd: "/exit",     desc: "Exit (session saved)",            alias: ["/quit", "/q"] },
];

function showCommandSuggestions(filter?: string) {
  const filtered = filter
    ? COMMANDS.filter(c => c.cmd.includes(filter) || c.desc.toLowerCase().includes(filter))
    : COMMANDS;

  console.log("");
  for (const c of filtered) {
    const aliases = c.alias.length > 0 ? `${C.dim} (${c.alias.join(", ")})${C.reset}` : "";
    console.log(`  ${C.cyan}${c.cmd.padEnd(12)}${C.reset}${c.desc}${aliases}`);
  }
  console.log(`\n${C.dim}  Tab to autocomplete | Type command and Enter${C.reset}`);
}

// ─── Display Helpers ───

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;

function startSpinner(msg: string) {
  stopSpinner();
  spinnerFrame = 0;
  process.stdout.write(`\n${C.dim}  ${SPINNER_FRAMES[0]} ${msg}${C.reset}`);
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stdout.write(`\r${C.dim}  ${SPINNER_FRAMES[spinnerFrame]} ${msg}${C.reset}`);
  }, 80);
}

function updateSpinner(msg: string) {
  if (spinnerInterval) {
    process.stdout.write(`\r\x1b[K${C.dim}  ${SPINNER_FRAMES[spinnerFrame]} ${msg}${C.reset}`);
  }
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write("\r\x1b[K");
  }
}

function showToolStart(tool: string, args: Record<string, any>) {
  stopSpinner();
  // Show tool name with a brief preview of args
  const argPreview = Object.entries(args)
    .slice(0, 2)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v.substring(0, 50) : JSON.stringify(v).substring(0, 50);
      return `${k}=${val}`;
    })
    .join(", ");
  console.log(`${C.dim}  ┌ ${C.yellow}${tool}${C.reset}${C.dim}${argPreview ? ` (${argPreview})` : ""}${C.reset}`);
}

function showToolEnd(tool: string, result: string, durationMs: number) {
  const elapsed = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
  const preview = result.replace(/\n/g, " ").substring(0, 80);
  console.log(`${C.dim}  └ ${C.green}done${C.reset}${C.dim} (${elapsed}) ${preview}${result.length > 80 ? "..." : ""}${C.reset}`);
}

function showToolError(tool: string, error: string) {
  console.log(`${C.dim}  └ ${C.red}error${C.reset}${C.dim}: ${error.substring(0, 100)}${C.reset}`);
}

function soulSay(msg: string) {
  console.log(`\n${C.magenta}${C.bold}Soul${C.reset}${C.dim} ›${C.reset} ${msg}`);
}

// ─── Session Management ───

function saveSessionId(sessionId: string) {
  try {
    if (!fs.existsSync(SOUL_DIR)) fs.mkdirSync(SOUL_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, sessionId);
  } catch { /* ok */ }
}

function loadLastSessionId(): string | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, "utf-8").trim();
    }
  } catch { /* ok */ }
  return null;
}

// ─── Main CLI ───

async function main() {
  const args = process.argv.slice(2);
  const isOneShotMode = args.length > 0 && !args[0].startsWith("--");

  // Initialize Soul
  try {
    await soul.initialize();
  } catch (e: any) {
    console.error(`${C.red}Failed to initialize Soul: ${e.message}${C.reset}`);
    process.exit(1);
  }

  // Register agent tools
  registerAllInternalTools();

  // Auto-import pending provider from setup-cli
  importPendingConfig();

  // Check LLM availability
  const defaultLLM = getDefaultConfig();
  const providers = listConfiguredProviders();

  if (!defaultLLM && providers.length === 0) {
    console.log(`\n${C.yellow}No LLM configured.${C.reset}`);
    console.log(`${C.dim}Run: ${C.cyan}soul-setup${C.reset}${C.dim} to configure Ollama or an API key.${C.reset}\n`);
    process.exit(1);
  }

  // One-shot mode
  if (isOneShotMode) {
    const question = args.filter(a => !a.startsWith("--")).join(" ");
    const sid = randomUUID();
    await handleMessage(question, sid);
    process.exit(0);
  }

  // ─── Interactive Mode ───
  printBanner();

  const masterName = soul.getMaster()?.name || "Master";
  const modelName = defaultLLM?.modelName || defaultLLM?.providerId || "unknown";

  // Check for previous session
  const lastSessionId = loadLastSessionId();
  let sessionId: string;
  let resumed = false;

  if (lastSessionId) {
    const lastHistory = getConversationHistory(lastSessionId, 5);
    if (lastHistory.length > 0) {
      // Show last conversation snippet
      console.log(`${C.dim}Previous conversation found (${lastHistory.length} messages):${C.reset}`);
      const lastMsg = lastHistory[lastHistory.length - 1];
      const preview = lastMsg.content.substring(0, 80);
      console.log(`${C.dim}  Last: "${preview}${lastMsg.content.length > 80 ? "..." : ""}"${C.reset}`);
      console.log(`${C.dim}  Type ${C.cyan}/new${C.reset}${C.dim} for fresh conversation, or just keep talking to continue.${C.reset}\n`);

      sessionId = lastSessionId;
      resumed = true;
    } else {
      sessionId = randomUUID();
    }
  } else {
    sessionId = randomUUID();
  }

  saveSessionId(sessionId);

  console.log(`${C.dim}Session: ${sessionId.split("-")[0]}${resumed ? " (resumed)" : ""} | Model: ${modelName} | /help for commands${C.reset}\n`);

  // ─── Tab Completer ───
  function completer(line: string): [string[], string] {
    if (!line.startsWith("/")) return [[], line];
    const lower = line.toLowerCase();
    const allCmds = COMMANDS.flatMap(c => [c.cmd, ...c.alias]);
    const hits = allCmds.filter(c => c.startsWith(lower));
    return [hits.length ? hits : allCmds, line];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.cyan}${masterName}${C.reset}${C.dim} ›${C.reset} `,
    historySize: 200,
    completer,
  });

  rl.prompt();

  // ─── Queue Processor ───
  // Runs in background, processes queued messages one by one
  async function processQueue() {
    if (isProcessing) return; // already running
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift()!;
      isProcessing = true;

      // Show remaining queue count
      if (messageQueue.length > 0) {
        console.log(`${C.dim}  (${messageQueue.length} more message${messageQueue.length > 1 ? "s" : ""} queued)${C.reset}`);
      }

      await handleMessage(msg, sessionId);
      turnCount++;
      isProcessing = false;
    }
    rl.prompt();
  }

  // ─── Debounce Flush ───
  // Merges buffered lines into one message and adds to queue
  function flushDebounce() {
    debounceTimer = null;
    if (debounceBuffer.length === 0) return;
    const merged = debounceBuffer.join("\n").trim();
    debounceBuffer = [];
    if (!merged) return;
    messageQueue.push(merged);
    processQueue();
  }

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Handle commands immediately (never queued)
    if (input.startsWith("/")) {
      // Clear any pending debounce first
      if (debounceTimer) { clearTimeout(debounceTimer); flushDebounce(); }

      // Just "/" alone → show command suggestions
      if (input === "/") {
        showCommandSuggestions();
        rl.prompt();
        return;
      }

      // Partial match suggestion — e.g. "/me" → show /memory
      if (!COMMANDS.some(c => c.cmd === input.toLowerCase() || c.alias.includes(input.toLowerCase()))) {
        const partial = input.toLowerCase();
        const matches = COMMANDS.filter(c =>
          c.cmd.startsWith(partial) || c.alias.some(a => a.startsWith(partial))
        );
        if (matches.length > 0 && matches.length <= 5) {
          console.log(`${C.dim}  Did you mean:${C.reset}`);
          for (const m of matches) {
            console.log(`  ${C.cyan}${m.cmd}${C.reset} ${C.dim}— ${m.desc}${C.reset}`);
          }
          rl.prompt();
          return;
        }
      }

      const result = handleCommand(input, sessionId, rl);
      if (result === "exit") {
        saveSessionId(sessionId);
        if (turnCount > 0) extractSessionInsights(sessionId);
        soulSay(`See you next time! (${turnCount} turns this session)`);
        rl.close();
        process.exit(0);
      } else if (result === "new_session") {
        // Extract insights from old session before switching
        extractSessionInsights(sessionId);
        sessionId = randomUUID();
        saveSessionId(sessionId);
        turnCount = 0;
        console.log(`\n${C.green}New session started: ${sessionId.split("-")[0]}${C.reset}`)
        console.log(`${C.dim}  (Previous session insights saved — Soul carries knowledge forward)${C.reset}\n`);
        rl.prompt();
        return;
      }
      rl.prompt();
      return;
    }

    // Add to debounce buffer — merge rapid lines
    debounceBuffer.push(input);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushDebounce, DEBOUNCE_MS);

    // Show feedback if Soul is busy
    if (isProcessing) {
      const pending = messageQueue.length + 1; // +1 for current buffer
      console.log(`${C.dim}  (queued — ${pending} message${pending > 1 ? "s" : ""} waiting)${C.reset}`);
    }
  });

  rl.on("close", () => {
    saveSessionId(sessionId);
    console.log("");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    saveSessionId(sessionId);
    if (turnCount > 0) extractSessionInsights(sessionId);
    console.log("");
    soulSay(`See you! (session saved, ${turnCount} turns)`);
    process.exit(0);
  });
}

// ─── Message Handler ───

async function handleMessage(input: string, sessionId: string) {
  saveConversationTurn(sessionId, "user", input);

  const startTime = Date.now();
  startSpinner("thinking...");

  try {
    const history = getConversationHistory(sessionId, 30);

    const result = await runAgentLoop(input, {
      history,
      maxIterations: 10,
      onProgress: (event) => {
        switch (event.type) {
          case "thinking":
            if (event.iteration === 1) {
              updateSpinner("thinking...");
            } else {
              updateSpinner(`thinking... (iteration ${event.iteration})`);
            }
            break;
          case "tool_start":
            showToolStart(event.tool, event.args);
            startSpinner(`running ${event.tool}...`);
            break;
          case "tool_end":
            stopSpinner();
            showToolEnd(event.tool, event.result, event.durationMs);
            break;
          case "tool_error":
            stopSpinner();
            showToolError(event.tool, event.error);
            break;
          case "responding":
            updateSpinner("composing response...");
            break;
          case "cache_hit":
            stopSpinner();
            console.log(`${C.dim}  ${C.green}cache hit${C.reset}`);
            break;
          case "knowledge_hit":
            stopSpinner();
            console.log(`${C.dim}  ${C.green}knowledge found${C.reset}${C.dim} (${event.source})${C.reset}`);
            break;
        }
      },
    });

    stopSpinner();
    soulSay(result.reply);

    // Show metadata footer
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const meta: string[] = [];
    if (result.cached) meta.push(`${C.green}cached${C.reset}${C.dim}`);
    else if (result.knowledgeHit) meta.push(`${C.green}knowledge${C.reset}${C.dim}`);
    else meta.push(result.model);
    if (result.toolsUsed.length > 0) {
      const unique = [...new Set(result.toolsUsed)];
      meta.push(`${unique.length} tool${unique.length > 1 ? "s" : ""}`);
    }
    meta.push(`${elapsed}s`);
    if (result.totalTokens > 0) meta.push(`${result.totalTokens} tok`);
    meta.push(`turn ${Math.ceil((getConversationHistory(sessionId, 100).length) / 2)}`);

    console.log(`${C.dim}  [${meta.join(" | ")}]${C.reset}`);

    saveConversationTurn(sessionId, "assistant", result.reply);

  } catch (err: any) {
    stopSpinner();
    console.log(`\n${C.red}Error: ${err.message}${C.reset}`);
    if (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed")) {
      console.log(`${C.yellow}Is Ollama running? Start it with: ${C.cyan}ollama serve${C.reset}`);
    }
  }
}

// ─── Commands ───

function handleCommand(input: string, sessionId: string, rl: readline.Interface): string | void {
  const parts = input.toLowerCase().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/help":
    case "/h":
      console.log(`\n${C.bold}Commands:${C.reset}`);
      showCommandSuggestions();
      console.log(`\n${C.dim}Just type naturally — Soul remembers the conversation.${C.reset}`);
      console.log(`${C.dim}Type ${C.cyan}/${C.reset}${C.dim} to see commands | ${C.cyan}Tab${C.reset}${C.dim} to autocomplete${C.reset}`);
      break;

    case "/new":
      return "new_session";

    case "/history":
    case "/hist": {
      const history = getConversationHistory(sessionId, 20);
      if (history.length === 0) {
        console.log(`${C.dim}  No conversation yet in this session.${C.reset}`);
      } else {
        console.log(`\n${C.bold}Conversation (${history.length} messages):${C.reset}`);
        for (const msg of history) {
          const role = msg.role === "user" ? `${C.cyan}You${C.reset}` : `${C.magenta}Soul${C.reset}`;
          const text = msg.content.substring(0, 120);
          console.log(`  ${role}: ${text}${msg.content.length > 120 ? "..." : ""}`);
        }
      }
      break;
    }

    case "/sessions":
    case "/sess": {
      const sessions = listSessions(10);
      if (sessions.length === 0) {
        console.log(`${C.dim}  No sessions yet.${C.reset}`);
      } else {
        console.log(`\n${C.bold}Recent Sessions:${C.reset}`);
        for (const s of sessions) {
          const current = s.sessionId === sessionId ? ` ${C.green}(current)${C.reset}` : "";
          console.log(`  ${s.sessionId.split("-")[0]} — ${s.messageCount} messages — ${s.lastMessage}${current}`);
        }
      }
      break;
    }

    case "/status":
      soul.getStatus().then(s => {
        console.log(`\n${C.bold}Soul Status:${C.reset}`);
        console.log(`  Initialized: ${s.initialized ? C.green + "yes" : C.red + "no"}${C.reset}`);
        console.log(`  Master: ${s.masterName || "not bound"}`);
        console.log(`  Uptime: ${s.uptime}`);
        console.log(`  Version: ${s.version}`);
      }).catch(() => console.log(`${C.red}Could not get status${C.reset}`));
      break;

    case "/memory":
    case "/mem":
      import("./memory/memory-engine.js").then(async (m) => {
        const stats = await m.getMemoryStats();
        console.log(`\n${C.bold}Memory:${C.reset} ${stats.total} total`);
        console.log(`  Conversations: ${stats.conversations} | Knowledge: ${stats.knowledge} | Learnings: ${stats.learnings} | Wisdom: ${stats.wisdom}`);
      }).catch(() => console.log(`${C.red}Could not get memory stats${C.reset}`));
      break;

    case "/model": {
      const cfg = getDefaultConfig();
      const provs = listConfiguredProviders();
      console.log(`\n${C.bold}LLM:${C.reset}`);
      if (cfg) {
        console.log(`  ${cfg.providerId} / ${cfg.modelName} (${cfg.providerType})`);
        console.log(`  URL: ${cfg.baseUrl}`);
      } else {
        console.log(`  No default provider`);
      }
      console.log(`  Providers: ${provs.length}`);
      break;
    }

    case "/clear":
    case "/cls":
      process.stdout.write("\x1b[2J\x1b[H");
      break;

    case "/exit":
    case "/quit":
    case "/q":
      return "exit";

    default:
      console.log(`${C.yellow}Unknown: ${cmd}. Try /help${C.reset}`);
  }
}

// ─── Pending Config Import ───

function importPendingConfig() {
  // Provider
  const pendingPath = path.join(SOUL_DIR, "pending-provider.json");
  if (fs.existsSync(pendingPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(pendingPath, "utf-8"));
      const result = addProvider({
        providerId: cfg.providerId,
        apiKey: cfg.apiKey || undefined,
        modelId: cfg.modelId,
        isDefault: true,
      });
      if (result.success) {
        console.log(`${C.green}Imported brain: ${cfg.providerName} / ${cfg.modelId}${C.reset}`);
      }
      fs.unlinkSync(pendingPath);
    } catch { /* ignore */ }
  }

  // Features (async imports handled lazily on first use)
  const featuresPath = path.join(SOUL_DIR, "pending-features.json");
  if (fs.existsSync(featuresPath)) {
    try {
      const features = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      // Save as simple config file for Soul to read
      const configPath = path.join(SOUL_DIR, "features-config.json");
      fs.writeFileSync(configPath, JSON.stringify(features, null, 2));
      fs.unlinkSync(featuresPath);
      console.log(`${C.green}Features config saved — will activate on use.${C.reset}`);
    } catch { /* ignore */ }
  }
}

// ─── Banner ───

function printBanner() {
  console.log(`
${C.magenta}${C.bold}╔══════════════════════════════════════╗
║            Soul AI Agent             ║
║   Your Personal AI Companion         ║
╚══════════════════════════════════════╝${C.reset}
${C.dim}Local-first. Private. Loyal.${C.reset}
`);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
