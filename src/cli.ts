#!/usr/bin/env node

/**
 * Soul CLI — Interactive AI Companion Terminal (Claude Code-style UX)
 *
 * Features:
 *   - Multi-line input: \ at end of line continues, or paste multi-line text
 *   - Message queue: keep typing while Soul thinks
 *   - Streaming responses with real-time token output
 *   - Tool execution with live progress display
 *   - Session persistence and resume
 *   - Ctrl+C to interrupt generation or exit
 *   - Tab completion for commands
 *   - Visual input area with clear chat separation
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

// ─── Terminal Colors & Styles ───

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgDim: "\x1b[48;5;236m",
  gray: "\x1b[90m",
};

// Box drawing characters
const BOX = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  thinH: "─",
  dot: "●",
  arrow: "❯",
  arrowRight: "→",
};

const SOUL_DIR = path.join(os.homedir(), ".soul");
const SESSION_FILE = path.join(SOUL_DIR, "last-session.txt");

// ─── State ───

let isProcessing = false;
let turnCount = 0;
let activeChildName: string | null = null;
let abortController: AbortController | null = null;

// Message queue + debounce
const messageQueue: string[] = [];
let debounceBuffer: string[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// Multi-line input state
let multilineBuffer: string[] = [];
let isMultilineMode = false;

// ─── Command Definitions ───

const COMMANDS = [
  { cmd: "/new",      desc: "Start a new conversation",        alias: [] },
  { cmd: "/talk",     desc: "Switch to talk to a Soul Child",  alias: ["/t"] },
  { cmd: "/team",     desc: "Show all Soul Children",          alias: [] },
  { cmd: "/history",  desc: "Show conversation history",       alias: ["/hist"] },
  { cmd: "/sessions", desc: "List past sessions",              alias: ["/sess"] },
  { cmd: "/status",   desc: "Soul's status",                   alias: [] },
  { cmd: "/memory",   desc: "Memory statistics",               alias: ["/mem"] },
  { cmd: "/model",    desc: "Current LLM info",                alias: [] },
  { cmd: "/clear",    desc: "Clear screen",                    alias: ["/cls"] },
  { cmd: "/help",     desc: "Show all commands",               alias: ["/h", "/?"] },
  { cmd: "/energy",   desc: "Soul's energy/cost report",       alias: [] },
  { cmd: "/dreams",   desc: "Show Soul's dreams & insights",   alias: [] },
  { cmd: "/handoff",  desc: "Export context for other AIs",    alias: [] },
  { cmd: "/quality",  desc: "Response quality trends",         alias: [] },
  { cmd: "/insights", desc: "Proactive insights from Soul",    alias: [] },
  { cmd: "/patterns", desc: "What Soul learned about you",     alias: [] },
  { cmd: "/exit",     desc: "Exit (session saved)",            alias: ["/quit", "/q"] },
];

// ─── Display Helpers ───

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let activeRl: readline.Interface | null = null;

function getTermWidth(): number {
  return process.stdout.columns || 80;
}

function horizontalLine(char: string = BOX.thinH, width?: number): string {
  const w = width || getTermWidth();
  return char.repeat(Math.min(w, 120));
}

function startSpinner(msg: string) {
  stopSpinner();
  spinnerFrame = 0;
  console.log(`${C.dim}  ${SPINNER_FRAMES[0]} ${msg}${C.reset}`);
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stdout.write(`\x1b[1A\r\x1b[K${C.dim}  ${SPINNER_FRAMES[spinnerFrame]} ${msg}${C.reset}\n`);
  }, 80);
}

function updateSpinner(msg: string) {
  if (spinnerInterval) {
    process.stdout.write(`\x1b[1A\r\x1b[K${C.dim}  ${SPINNER_FRAMES[spinnerFrame]} ${msg}${C.reset}\n`);
  }
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write(`\x1b[1A\r\x1b[K`);
  }
}

function showToolStart(tool: string, args: Record<string, any>) {
  stopSpinner();
  const argPreview = Object.entries(args)
    .slice(0, 2)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v.substring(0, 50) : JSON.stringify(v).substring(0, 50);
      return `${k}=${val}`;
    })
    .join(", ");
  console.log(`${C.dim}  ${C.yellow}▸${C.reset}${C.dim} ${C.yellow}${tool}${C.reset}${C.dim}${argPreview ? ` ${C.gray}${argPreview}${C.reset}` : ""}${C.reset}`);
}

function showToolEnd(tool: string, result: string, durationMs: number) {
  const elapsed = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
  const preview = result.replace(/\n/g, " ").substring(0, 80);
  console.log(`${C.dim}  ${C.green}✓${C.reset}${C.dim} ${tool} ${C.gray}(${elapsed})${C.reset}${C.dim} ${preview}${result.length > 80 ? "…" : ""}${C.reset}`);
}

function showToolError(tool: string, error: string) {
  console.log(`${C.dim}  ${C.red}✗${C.reset}${C.dim} ${tool}: ${error.substring(0, 100)}${C.reset}`);
}

function soulSay(msg: string) {
  const speaker = activeChildName || "Soul";
  const color = activeChildName ? C.cyan : C.magenta;
  console.log(`\n${color}${C.bold}${speaker}${C.reset} ${msg}`);
}

function showInputHint() {
  if (isMultilineMode) {
    console.log(`${C.dim}  (multi-line mode: type ${C.cyan}.send${C.reset}${C.dim} or empty line to send, ${C.cyan}.cancel${C.reset}${C.dim} to discard)${C.reset}`);
  }
}

function getPrompt(): string {
  const masterName = soul.getMaster()?.name || "You";
  if (isMultilineMode) {
    return `${C.dim}${BOX.vertical}${C.reset}  `;
  }
  if (activeChildName) {
    return `${C.cyan}${masterName}${C.reset} ${C.dim}${BOX.arrow}${C.cyan} ${activeChildName}${C.reset} ${C.dim}${BOX.arrow}${C.reset} `;
  }
  return `${C.cyan}${masterName}${C.reset} ${C.dim}${BOX.arrow}${C.reset} `;
}

// ─── Multi-line Input ───

function enterMultilineMode(firstLine: string, rl: readline.Interface) {
  isMultilineMode = true;
  multilineBuffer = [firstLine];
  console.log(`${C.dim}${BOX.topLeft}${horizontalLine(BOX.horizontal, 40)}${C.reset}`);
  console.log(`${C.dim}${BOX.vertical}${C.reset}  ${firstLine}`);
  showInputHint();
  rl.setPrompt(getPrompt());
  rl.prompt();
}

function exitMultilineMode(rl: readline.Interface): string | null {
  isMultilineMode = false;
  multilineBuffer = [];
  rl.setPrompt(getPrompt());
  return null;
}

// ─── Command Suggestions ───

function showCommandSuggestions(filter?: string) {
  const filtered = filter
    ? COMMANDS.filter(c => c.cmd.includes(filter) || c.desc.toLowerCase().includes(filter))
    : COMMANDS;

  console.log("");
  for (const c of filtered) {
    const aliases = c.alias.length > 0 ? `${C.gray} (${c.alias.join(", ")})${C.reset}` : "";
    console.log(`  ${C.cyan}${c.cmd.padEnd(12)}${C.reset}${c.desc}${aliases}`);
  }
  console.log(`\n${C.dim}  Tab to autocomplete | \\ at end of line for multi-line input${C.reset}`);
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

  // One-shot mode: soul "question here"
  if (isOneShotMode) {
    const question = args.filter(a => !a.startsWith("--")).join(" ");
    const sid = randomUUID();
    await handleMessage(question, sid);
    process.exit(0);
  }

  // ─── Interactive Mode ───
  printBanner();

  const masterName = soul.getMaster()?.name || "You";
  const modelName = defaultLLM?.modelName || defaultLLM?.providerId || "unknown";

  // Check for previous session
  const lastSessionId = loadLastSessionId();
  let sessionId: string;
  let resumed = false;

  if (lastSessionId) {
    const lastHistory = getConversationHistory(lastSessionId, 5);
    if (lastHistory.length > 0) {
      console.log(`${C.dim}Previous conversation found (${lastHistory.length} messages)${C.reset}`);
      const lastMsg = lastHistory[lastHistory.length - 1];
      const preview = lastMsg.content.substring(0, 80);
      console.log(`${C.dim}  Last: "${preview}${lastMsg.content.length > 80 ? "…" : ""}"${C.reset}`);
      console.log(`${C.dim}  Type ${C.cyan}/new${C.reset}${C.dim} for fresh conversation, or just keep talking.${C.reset}\n`);
      sessionId = lastSessionId;
      resumed = true;
    } else {
      sessionId = randomUUID();
    }
  } else {
    sessionId = randomUUID();
  }

  saveSessionId(sessionId);

  // Status line
  const sessionShort = sessionId.split("-")[0];
  console.log(`${C.dim}${horizontalLine()}${C.reset}`);
  console.log(`${C.dim}  Session: ${sessionShort}${resumed ? " (resumed)" : ""}  ${C.gray}│${C.dim}  Model: ${modelName}  ${C.gray}│${C.dim}  ${C.cyan}/help${C.dim} for commands  ${C.gray}│${C.dim}  ${C.cyan}\\${C.dim} for multi-line${C.reset}`);
  console.log(`${C.dim}${horizontalLine()}${C.reset}\n`);

  // Smart greeting on new session
  if (!resumed) {
    try {
      const { generateFirstMessage, formatFirstMessage } = await import("./core/first-message.js");
      const ctx = generateFirstMessage();
      const hasContent = ctx.pendingDreams.length > 0 || ctx.unresolvedItems.length > 0 || ctx.hoursSinceLastChat > 2;
      if (hasContent) {
        soulSay(await formatFirstMessage(ctx));
      } else {
        soulSay(ctx.greeting + " มีอะไรให้ช่วยครับ?");
      }
      console.log("");
    } catch { /* first run */ }
  }

  // Dream cycle in background
  try {
    import("./core/soul-dreams.js").then(({ dreamCycle }) => dreamCycle()).catch(() => {});
  } catch { /* ok */ }

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
    prompt: getPrompt(),
    historySize: 500,
    completer,
  });
  activeRl = rl;

  rl.prompt();

  // ─── Queue Processor ───
  async function processQueue() {
    if (isProcessing) return;
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift()!;
      isProcessing = true;

      if (messageQueue.length > 0) {
        console.log(`${C.dim}  (${messageQueue.length} more queued)${C.reset}`);
      }

      await handleMessage(msg, sessionId);
      turnCount++;
      isProcessing = false;
    }
    rl.setPrompt(getPrompt());
    rl.prompt();
  }

  // ─── Debounce Flush ───
  function flushDebounce() {
    debounceTimer = null;
    if (debounceBuffer.length === 0) return;
    const merged = debounceBuffer.join("\n").trim();
    debounceBuffer = [];
    if (!merged) return;
    messageQueue.push(merged);
    processQueue();
  }

  // ─── Input Handler ───
  rl.on("line", (line) => {
    const raw = line;
    const input = line.trim();

    // ── Multi-line mode handling ──
    if (isMultilineMode) {
      // Empty line or .send → submit the multi-line message
      if (input === "" || input === ".send") {
        const fullMessage = multilineBuffer.join("\n").trim();
        console.log(`${C.dim}${BOX.bottomLeft}${horizontalLine(BOX.horizontal, 40)}${C.reset}`);
        isMultilineMode = false;
        multilineBuffer = [];
        rl.setPrompt(getPrompt());

        if (fullMessage) {
          messageQueue.push(fullMessage);
          processQueue();
        } else {
          rl.prompt();
        }
        return;
      }

      // .cancel → discard
      if (input === ".cancel") {
        console.log(`${C.dim}${BOX.bottomLeft}${horizontalLine(BOX.horizontal, 40)} ${C.yellow}cancelled${C.reset}`);
        exitMultilineMode(rl);
        rl.prompt();
        return;
      }

      // Continue accumulating lines
      multilineBuffer.push(raw);
      // Check if this line also ends with \
      if (raw.trimEnd().endsWith("\\")) {
        multilineBuffer[multilineBuffer.length - 1] = raw.trimEnd().slice(0, -1);
      }
      rl.setPrompt(getPrompt());
      rl.prompt();
      return;
    }

    // Empty input
    if (!input) { rl.prompt(); return; }

    // ── Commands (handle immediately) ──
    if (input.startsWith("/")) {
      if (debounceTimer) { clearTimeout(debounceTimer); flushDebounce(); }

      if (input === "/" || input === "/?") {
        showCommandSuggestions();
        rl.prompt();
        return;
      }

      // Partial match suggestion
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
        console.log("");
        soulSay(`See you next time! (${turnCount} turns this session)`);
        console.log(`\n${C.dim}${horizontalLine()}${C.reset}\n`);
        rl.close();
        process.exit(0);
      } else if (result === "new_session") {
        extractSessionInsights(sessionId);
        sessionId = randomUUID();
        saveSessionId(sessionId);
        turnCount = 0;
        console.log(`\n${C.green}${BOX.dot} New session: ${sessionId.split("-")[0]}${C.reset}`);
        console.log(`${C.dim}  Previous session insights saved — Soul carries knowledge forward.${C.reset}\n`);
        rl.prompt();
        return;
      }
      rl.prompt();
      return;
    }

    // ── Multi-line trigger: line ends with \ ──
    if (raw.trimEnd().endsWith("\\")) {
      const firstLine = raw.trimEnd().slice(0, -1);
      enterMultilineMode(firstLine, rl);
      return;
    }

    // ── Normal message → queue ──
    debounceBuffer.push(input);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushDebounce, DEBOUNCE_MS);

    if (isProcessing) {
      const pending = messageQueue.length + debounceBuffer.length;
      console.log(`${C.dim}  ${C.yellow}◆${C.reset}${C.dim} queued (${pending} waiting)${C.reset}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    saveSessionId(sessionId);
    console.log("");
    process.exit(0);
  });

  // Ctrl+C handling: interrupt generation or exit
  let ctrlCCount = 0;
  let ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  process.on("SIGINT", () => {
    // If processing, abort the current generation
    if (isProcessing && abortController) {
      abortController.abort();
      stopSpinner();
      console.log(`\n${C.yellow}  ■ Generation interrupted${C.reset}`);
      isProcessing = false;
      rl.setPrompt(getPrompt());
      rl.prompt();
      return;
    }

    // If in multi-line mode, cancel it
    if (isMultilineMode) {
      console.log(`\n${C.dim}${BOX.bottomLeft}${horizontalLine(BOX.horizontal, 40)} ${C.yellow}cancelled${C.reset}`);
      exitMultilineMode(rl);
      rl.prompt();
      return;
    }

    // Double Ctrl+C to exit
    ctrlCCount++;
    if (ctrlCCount >= 2) {
      saveSessionId(sessionId);
      if (turnCount > 0) extractSessionInsights(sessionId);
      console.log("");
      soulSay(`See you! (session saved, ${turnCount} turns)`);
      console.log(`\n${C.dim}${horizontalLine()}${C.reset}\n`);
      process.exit(0);
    }

    console.log(`\n${C.dim}  Press Ctrl+C again to exit, or keep typing.${C.reset}`);
    rl.prompt();

    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    ctrlCTimer = setTimeout(() => { ctrlCCount = 0; }, 2000);
  });
}

// ─── Message Handler ───

async function handleMessage(input: string, sessionId: string) {
  saveConversationTurn(sessionId, "user", input);

  const startTime = Date.now();
  startSpinner("thinking…");

  // Create abort controller for this request
  abortController = new AbortController();

  try {
    const history = getConversationHistory(sessionId, 12);
    let streamStarted = false;

    const result = await runAgentLoop(input, {
      history,
      maxIterations: 10,
      childName: activeChildName || undefined,
      onProgress: (event) => {
        // Check if aborted
        if (abortController?.signal.aborted) return;

        switch (event.type) {
          case "thinking":
            if (event.iteration === 1) {
              updateSpinner("thinking…");
            } else {
              updateSpinner(`thinking… (step ${event.iteration})`);
            }
            break;
          case "tool_start":
            showToolStart(event.tool, event.args);
            startSpinner(`running ${event.tool}…`);
            break;
          case "tool_end":
            stopSpinner();
            showToolEnd(event.tool, event.result, event.durationMs);
            break;
          case "tool_error":
            stopSpinner();
            showToolError(event.tool, event.error);
            break;
          case "streaming_token":
            if (!streamStarted) {
              stopSpinner();
              const speaker = activeChildName || "Soul";
              const speakerColor = activeChildName ? C.cyan : C.magenta;
              process.stdout.write(`\n${speakerColor}${C.bold}${speaker}${C.reset} `);
              streamStarted = true;
            }
            process.stdout.write(event.token);
            break;
          case "responding":
            if (!streamStarted) updateSpinner("composing response…");
            break;
          case "cache_hit":
            stopSpinner();
            console.log(`${C.dim}  ${C.green}⚡ cache hit${C.reset}`);
            break;
          case "knowledge_hit":
            stopSpinner();
            console.log(`${C.dim}  ${C.green}📚 knowledge found${C.reset}${C.dim} (${event.source})${C.reset}`);
            break;
        }
      },
    });

    stopSpinner();
    abortController = null;

    if (streamStarted) {
      console.log(""); // End streaming line
    } else {
      soulSay(result.reply);
    }

    // ── Metadata footer ──
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
    const turnNum = Math.ceil((getConversationHistory(sessionId, 100).length) / 2);
    meta.push(`turn ${turnNum}`);
    if (result.confidence) meta.push(`${result.confidence.overall}% conf`);

    console.log(`${C.gray}  ${meta.join(" ${C.dim}│${C.gray} ")}${C.reset}\n`);

    saveConversationTurn(sessionId, "assistant", result.reply);

  } catch (err: any) {
    stopSpinner();
    const wasAborted = abortController?.signal.aborted;
    abortController = null;

    if (err.name === "AbortError" || wasAborted) {
      console.log(`\n${C.yellow}  ■ Interrupted${C.reset}\n`);
    } else {
      console.log(`\n${C.red}  ✗ Error: ${err.message}${C.reset}`);
      if (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed")) {
        console.log(`${C.yellow}  Is Ollama running? Start with: ${C.cyan}ollama serve${C.reset}`);
      }
      console.log("");
    }
  }

  if (activeRl) {
    activeRl.setPrompt(getPrompt());
    activeRl.prompt();
  }
}

// ─── Commands ───

function handleCommand(input: string, sessionId: string, rl: readline.Interface): string | void {
  const parts = input.toLowerCase().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/help":
    case "/h":
    case "/?":
      console.log(`\n${C.bold}Commands:${C.reset}`);
      showCommandSuggestions();
      console.log(`\n${C.dim}  Tips: type naturally to chat | ${C.cyan}\\${C.reset}${C.dim} at end of line for multi-line | Tab to autocomplete${C.reset}`);
      break;

    case "/new":
      return "new_session";

    case "/talk":
    case "/t": {
      const rawParts = input.split(/\s+/);
      const childArg = rawParts.slice(1).join(" ");
      if (!childArg || childArg === "soul" || childArg === "core") {
        activeChildName = null;
        rl.setPrompt(getPrompt());
        console.log(`\n${C.magenta}${BOX.dot} Now talking to ${C.bold}Soul Core${C.reset}`);
      } else {
        activeChildName = childArg;
        rl.setPrompt(getPrompt());
        console.log(`\n${C.cyan}${BOX.dot} Now talking to ${C.bold}${childArg}${C.reset}${C.dim} (${C.cyan}/talk soul${C.reset}${C.dim} to go back)${C.reset}`);
      }
      break;
    }

    case "/team": {
      console.log(`\n${C.bold}Soul Team:${C.reset}`);
      console.log(`  ${C.magenta}${BOX.dot} Soul Core${C.reset} — Central AI companion ${activeChildName === null ? `${C.green}(active)${C.reset}` : ""}`);
      try {
        const rawDb = require("better-sqlite3")(require("path").join(require("os").homedir(), ".soul", "soul.db"));
        const children = rawDb.prepare("SELECT name, specialty, level FROM soul_children WHERE is_active = 1 ORDER BY level DESC").all() as any[];
        rawDb.close();
        if (children.length === 0) {
          console.log(`\n${C.dim}  No children yet. Ask Soul to create specialists.${C.reset}`);
        } else {
          for (const c of children) {
            const isActive = activeChildName === c.name;
            console.log(`  ${C.cyan}${BOX.dot} ${c.name}${C.reset} [Lv.${c.level}] — ${c.specialty} ${isActive ? `${C.green}(active)${C.reset}` : ""}`);
          }
          console.log(`\n${C.dim}  Use ${C.cyan}/talk <name>${C.reset}${C.dim} to switch${C.reset}`);
        }
      } catch {
        console.log(`${C.dim}  Could not load team.${C.reset}`);
      }
      break;
    }

    case "/history":
    case "/hist": {
      const history = getConversationHistory(sessionId, 20);
      if (history.length === 0) {
        console.log(`${C.dim}  No conversation yet.${C.reset}`);
      } else {
        console.log(`\n${C.bold}Conversation (${history.length} messages):${C.reset}`);
        for (const msg of history) {
          const role = msg.role === "user"
            ? `${C.cyan}You${C.reset}`
            : `${C.magenta}Soul${C.reset}`;
          const text = msg.content.substring(0, 120);
          console.log(`  ${role} ${C.dim}${BOX.arrow}${C.reset} ${text}${msg.content.length > 120 ? "…" : ""}`);
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
          console.log(`  ${C.dim}${BOX.dot}${C.reset} ${s.sessionId.split("-")[0]} — ${s.messageCount} messages — ${s.lastMessage}${current}`);
        }
      }
      break;
    }

    case "/status":
      soul.getStatus().then(s => {
        console.log(`\n${C.bold}Soul Status:${C.reset}`);
        console.log(`  Initialized: ${s.initialized ? C.green + "yes" : C.red + "no"}${C.reset}`);
        console.log(`  Master: ${s.masterName || "not bound"}`);
        console.log(`  Uptime: ${s.uptime}s`);
        console.log(`  Version: ${s.version}`);
        console.log(`  Memories: ${s.memoryStats.total} total`);
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
        console.log(`  ${C.cyan}${cfg.providerId}${C.reset} / ${cfg.modelName} (${cfg.providerType})`);
        console.log(`  ${C.dim}URL: ${cfg.baseUrl}${C.reset}`);
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

    case "/energy":
      import("./core/energy-awareness.js").then(({ getEnergyReport, formatEnergyReport }) => {
        console.log(`\n${formatEnergyReport(getEnergyReport())}`);
      }).catch(() => console.log(`${C.dim}  No energy data yet.${C.reset}`));
      break;

    case "/dreams":
      import("./core/soul-dreams.js").then(async ({ getUnsharedDreams, markDreamsShared, getDreamStats }) => {
        const stats = getDreamStats();
        const dreams = getUnsharedDreams(5);
        console.log(`\n${C.bold}Soul Dreams:${C.reset} ${stats.total} total (${stats.connections} connections, ${stats.patterns} patterns)`);
        if (dreams.length > 0) {
          for (const d of dreams) {
            console.log(`  ${C.cyan}[${d.type}]${C.reset} ${d.content}`);
          }
          markDreamsShared(dreams.map(d => d.id));
        } else {
          console.log(`${C.dim}  No new dreams.${C.reset}`);
        }
      }).catch(() => console.log(`${C.dim}  Dreams not available yet.${C.reset}`));
      break;

    case "/handoff":
      import("./core/context-handoff.js").then(({ exportContext, formatContextForExport }) => {
        const packet = exportContext(sessionId);
        const text = formatContextForExport(packet);
        console.log(`\n${text}`);
        console.log(`\n${C.dim}Copy and paste into another AI to continue.${C.reset}`);
      }).catch(() => console.log(`${C.dim}  Context handoff not available.${C.reset}`));
      break;

    case "/quality":
      import("./core/response-quality.js").then(({ getQualityTrends }) => {
        const t = getQualityTrends();
        console.log(`\n${C.bold}Response Quality:${C.reset} (${t.totalScored} scored)`);
        console.log(`  Overall: ${Math.round(t.avgOverall * 100)}% | Relevance: ${Math.round(t.avgRelevance * 100)}% | Completeness: ${Math.round(t.avgCompleteness * 100)}%`);
        console.log(`  Trend: ${t.trend === "improving" ? C.green : t.trend === "declining" ? C.red : C.dim}${t.trend}${C.reset}`);
      }).catch(() => console.log(`${C.dim}  Quality data not available.${C.reset}`));
      break;

    case "/insights":
      import("./core/proactive-intelligence.js").then(({ generateProactiveInsights, formatInsights }) => {
        const insights = generateProactiveInsights();
        console.log(`\n${C.bold}Proactive Insights:${C.reset}`);
        if (insights.length === 0) {
          console.log(`${C.dim}  No insights right now.${C.reset}`);
        } else {
          console.log(formatInsights(insights));
        }
      }).catch(() => console.log(`${C.dim}  Insights not available.${C.reset}`));
      break;

    case "/patterns":
      import("./core/active-learning.js").then(({ getMasterPatterns }) => {
        const p = getMasterPatterns();
        console.log(`\n${C.bold}What Soul Learned About You:${C.reset}`);
        console.log(`  Topics: ${p.topTopics.slice(0, 7).map((t: any) => `${t.pattern} (${t.frequency}x)`).join(", ") || "none yet"}`);
        console.log(`  Active hours: ${p.activeHours.join(":00, ") || "unknown"}`);
        console.log(`  Question style: ${p.questionStyle}`);
      }).catch(() => console.log(`${C.dim}  Not enough data yet.${C.reset}`));
      break;

    case "/exit":
    case "/quit":
    case "/q":
      return "exit";

    default:
      console.log(`${C.yellow}Unknown: ${cmd}${C.reset}${C.dim} — try ${C.cyan}/help${C.reset}`);
  }
}

// ─── Pending Config Import ───

function importPendingConfig() {
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
        console.log(`${C.green}${BOX.dot} Imported brain: ${cfg.providerName} / ${cfg.modelId}${C.reset}`);
      }
      fs.unlinkSync(pendingPath);
    } catch { /* ignore */ }
  }

  const featuresPath = path.join(SOUL_DIR, "pending-features.json");
  if (fs.existsSync(featuresPath)) {
    try {
      const features = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const configPath = path.join(SOUL_DIR, "features-config.json");
      fs.writeFileSync(configPath, JSON.stringify(features, null, 2));
      fs.unlinkSync(featuresPath);
      console.log(`${C.green}${BOX.dot} Features config saved.${C.reset}`);
    } catch { /* ignore */ }
  }
}

// ─── Banner ───

function printBanner() {
  const w = Math.min(getTermWidth(), 60);
  const title = "Soul AI";
  const subtitle = "Your Personal AI Companion";
  const pad = (s: string, len: number) => {
    const space = Math.max(0, len - s.length);
    const left = Math.floor(space / 2);
    return " ".repeat(left) + s + " ".repeat(space - left);
  };

  console.log("");
  console.log(`  ${C.magenta}${C.bold}${BOX.topLeft}${BOX.horizontal.repeat(w - 2)}${BOX.topRight}${C.reset}`);
  console.log(`  ${C.magenta}${C.bold}${BOX.vertical}${pad(title, w - 2)}${BOX.vertical}${C.reset}`);
  console.log(`  ${C.magenta}${BOX.vertical}${C.reset}${C.dim}${pad(subtitle, w - 2)}${C.reset}${C.magenta}${BOX.vertical}${C.reset}`);
  console.log(`  ${C.magenta}${C.bold}${BOX.bottomLeft}${BOX.horizontal.repeat(w - 2)}${BOX.bottomRight}${C.reset}`);
  console.log(`  ${C.dim}Local-first. Private. Loyal.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
