#!/usr/bin/env node

/**
 * Soul Setup — Beautiful interactive first-run experience
 *
 * Design principles:
 * 1. Auto-detect everything (hardware, Ollama, models)
 * 2. Minimal choices (brain → key → done)
 * 3. Live test before finishing
 * 4. Visual polish (logo, colors, progress)
 * 5. Optional features deferred to chat ("soul_connect" later)
 *
 * Usage:
 *   npx soul-ai setup
 *   soul-setup
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { isMasterSetup, setupMaster } from "./core/master.js";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DB_PATH = path.join(SOUL_DIR, "soul.db");

// ─── Colors & Symbols ───

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

const BOX = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", dot: "●" };

function log(msg = "") { console.log(msg); }
function ok(msg: string) { log(`  ${C.green}✓${C.reset} ${msg}`); }
function warn(msg: string) { log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function err(msg: string) { log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { log(`  ${C.cyan}ℹ${C.reset} ${msg}`); }
function line(char = BOX.h, len = 60) { return char.repeat(len); }

function step(num: number, title: string) {
  log();
  log(`  ${C.magenta}${C.bold}${BOX.dot} Step ${num}${C.reset}  ${C.bold}${title}${C.reset}`);
  log(`  ${C.dim}${line(BOX.h, 50)}${C.reset}`);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`  ${C.cyan}❯${C.reset} ${question} `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      process.stdout.write(`  ${C.cyan}❯${C.reset} ${question} `);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      let input = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw || false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (c === "\u007f" || c === "\b") {
          if (input.length > 0) { input = input.slice(0, -1); process.stdout.write("\b \b"); }
        } else if (c === "\u0003") {
          stdin.setRawMode(wasRaw || false);
          process.exit(0);
        } else {
          input += c;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(`  ${C.cyan}❯${C.reset} ${question} `, answer => { rl.close(); resolve(answer.trim()); });
    }
  });
}

function exec(cmd: string): string | null {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { return null; }
}

function getRAM(): number { return Math.round(os.totalmem() / (1024 ** 3) * 10) / 10; }

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ─── Provider configs ───

const API_PROVIDERS = [
  { id: "groq",      name: "Groq",            model: "qwen/qwen3-32b",            free: true,  type: "openai-compatible", url: "https://api.groq.com/openai/v1",              signupUrl: "https://console.groq.com",            desc: "Ultra-fast, free tier" },
  { id: "gemini",    name: "Google Gemini",    model: "gemini-2.5-flash",           free: true,  type: "google",            url: "https://generativelanguage.googleapis.com/v1beta", signupUrl: "https://aistudio.google.com/apikey", desc: "Free tier, huge context" },
  { id: "deepseek",  name: "DeepSeek",         model: "deepseek-chat",              free: false, type: "openai-compatible", url: "https://api.deepseek.com/v1",                 signupUrl: "https://platform.deepseek.com",       desc: "Very cheap, high quality" },
  { id: "openai",    name: "OpenAI",           model: "gpt-4o-mini",                free: false, type: "openai-compatible", url: "https://api.openai.com/v1",                   signupUrl: "https://platform.openai.com/api-keys", desc: "GPT-4o models" },
  { id: "anthropic", name: "Anthropic Claude", model: "claude-haiku-4-5-20251001",  free: false, type: "anthropic",         url: "https://api.anthropic.com",                   signupUrl: "https://console.anthropic.com",        desc: "Claude models" },
  { id: "together",  name: "Together AI",      model: "Qwen/Qwen3-Coder-32B-Instruct", free: false, type: "openai-compatible", url: "https://api.together.xyz/v1",           signupUrl: "https://api.together.xyz",             desc: "Many open models" },
];

function saveConfig(providerId: string, providerName: string, providerType: string, baseUrl: string, apiKey: string, modelId: string) {
  fs.mkdirSync(SOUL_DIR, { recursive: true });
  const configPath = path.join(SOUL_DIR, "pending-provider.json");
  fs.writeFileSync(configPath, JSON.stringify({
    providerId, providerName, providerType, baseUrl, apiKey, modelId, modelName: modelId,
    createdAt: new Date().toISOString(),
  }, null, 2));
}

// ─── Auto-Detect System ───

interface SystemInfo {
  nodeVersion: number;
  platform: string;
  platformName: string;
  arch: string;
  ram: number;
  cpu: string;
  ollamaInstalled: boolean;
  ollamaVersion: string;
  ollamaRunning: boolean;
  ollamaModels: string[];
  hasExistingDB: boolean;
  hasGPU: boolean;
  gpuInfo: string;
}

function detectSystem(): SystemInfo {
  const platform = os.platform();
  const ram = getRAM();

  // Ollama
  const ollamaVersion = exec("ollama --version") || "";
  const ollamaInstalled = ollamaVersion.length > 0;
  const ollamaRunning = exec("ollama ps") !== null;
  let ollamaModels: string[] = [];
  if (ollamaInstalled) {
    const list = exec("ollama list");
    if (list) {
      ollamaModels = list.split("\n")
        .slice(1) // skip header
        .map(line => line.split(/\s+/)[0])
        .filter(m => m && m.length > 0);
    }
  }

  // GPU
  let hasGPU = false;
  let gpuInfo = "";
  if (platform === "win32") {
    const gpu = exec("wmic path win32_VideoController get name 2>NUL");
    if (gpu) {
      const gpuLines = gpu.split("\n").map(l => l.trim()).filter(l => l && l !== "Name");
      if (gpuLines.length > 0) {
        gpuInfo = gpuLines[0];
        hasGPU = /nvidia|geforce|rtx|gtx|radeon|rx\s/i.test(gpuInfo);
      }
    }
  } else {
    const nvidia = exec("nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null");
    if (nvidia) { gpuInfo = nvidia; hasGPU = true; }
  }

  return {
    nodeVersion: parseInt(process.versions.node.split(".")[0]),
    platform,
    platformName: platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux",
    arch: os.arch(),
    ram,
    cpu: os.cpus()[0]?.model || "Unknown",
    ollamaInstalled,
    ollamaVersion,
    ollamaRunning,
    ollamaModels,
    hasExistingDB: fs.existsSync(DB_PATH),
    hasGPU,
    gpuInfo,
  };
}

function recommendModel(ram: number, hasGPU: boolean): { model: string; size: string; quality: string } {
  if (ram >= 32 && hasGPU) return { model: "qwen3:32b", size: "~20 GB", quality: "Excellent — coding, reasoning, multilingual" };
  if (ram >= 24) return { model: "qwen3:14b", size: "~9 GB", quality: "Great — balanced speed + quality" };
  if (ram >= 16) return { model: "qwen3:8b", size: "~5 GB", quality: "Good — fast, efficient" };
  return { model: "qwen3:8b", size: "~5 GB", quality: "Lightweight — works on 8GB+ RAM" };
}

// ─── Main Setup ───

async function main() {
  // ─── Logo ───
  log();
  log(`  ${C.magenta}${C.bold}${BOX.tl}${line(BOX.h, 54)}${BOX.tr}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}                                                      ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}███████╗  ██████╗  ██╗   ██╗ ██╗     ${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}██╔════╝ ██╔═══██╗ ██║   ██║ ██║     ${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}███████╗ ██║   ██║ ██║   ██║ ██║     ${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}╚════██║ ██║   ██║ ██║   ██║ ██║     ${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}███████║ ╚██████╔╝ ╚██████╔╝ ███████╗${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.magenta}${C.bold}╚══════╝  ╚═════╝   ╚═════╝  ╚══════╝${C.reset}           ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}                                                      ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.dim}Your Personal AI Companion${C.reset}                         ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}   ${C.dim}Local-first ${C.gray}•${C.dim} Private ${C.gray}•${C.dim} Loyal ${C.gray}•${C.dim} 308+ tools${C.reset}          ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.v}${C.reset}                                                      ${C.magenta}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.magenta}${C.bold}${BOX.bl}${line(BOX.h, 54)}${BOX.br}${C.reset}`);
  log();

  // ─── Auto-detect ───
  process.stdout.write(`  ${C.dim}Scanning your system...${C.reset}`);
  const sys = detectSystem();
  process.stdout.write(`\r  ${C.green}✓${C.reset} System scanned                \n`);
  log();

  // Show system summary in a compact box
  log(`  ${C.dim}${BOX.tl}${line(BOX.h, 50)}${BOX.tr}${C.reset}`);
  log(`  ${C.dim}${BOX.v}${C.reset}  ${C.bold}System${C.reset}   ${sys.platformName} ${sys.arch} ${C.gray}•${C.reset} Node ${process.versions.node}     ${C.dim}${BOX.v}${C.reset}`);
  log(`  ${C.dim}${BOX.v}${C.reset}  ${C.bold}RAM${C.reset}      ${sys.ram} GB${sys.ram >= 16 ? ` ${C.green}✓${C.reset}` : ` ${C.yellow}(8GB+ recommended)${C.reset}`}${" ".repeat(Math.max(0, 30 - String(sys.ram).length))}${C.dim}${BOX.v}${C.reset}`);
  if (sys.hasGPU) {
    log(`  ${C.dim}${BOX.v}${C.reset}  ${C.bold}GPU${C.reset}      ${sys.gpuInfo.substring(0, 38)}${" ".repeat(Math.max(0, 30 - Math.min(38, sys.gpuInfo.length)))}${C.dim}${BOX.v}${C.reset}`);
  }
  log(`  ${C.dim}${BOX.v}${C.reset}  ${C.bold}Ollama${C.reset}   ${sys.ollamaInstalled ? `${C.green}Installed${C.reset} ${sys.ollamaModels.length > 0 ? `(${sys.ollamaModels.length} models)` : ""}` : `${C.yellow}Not installed${C.reset}`}${" ".repeat(Math.max(0, 25))}${C.dim}${BOX.v}${C.reset}`);
  if (sys.hasExistingDB) {
    log(`  ${C.dim}${BOX.v}${C.reset}  ${C.bold}Data${C.reset}     ${C.green}Existing Soul database found${C.reset}       ${C.dim}${BOX.v}${C.reset}`);
  }
  log(`  ${C.dim}${BOX.bl}${line(BOX.h, 50)}${BOX.br}${C.reset}`);
  log();

  // Validate Node.js
  if (sys.nodeVersion < 18) {
    err(`Node.js v${process.versions.node} — need v18+. Please upgrade Node.js.`);
    process.exit(1);
  }

  // Create data directory
  fs.mkdirSync(SOUL_DIR, { recursive: true });

  // ═══ Step 1: Master Binding ═══
  step(1, "Bind Soul to You");
  log();

  let masterAlreadyBound = false;
  try {
    masterAlreadyBound = await isMasterSetup();
  } catch {
    // DB not initialized yet — master not set up
  }

  if (masterAlreadyBound) {
    ok("Master already bound. Skipping identity setup.");
  } else {
    info("Soul needs to know who its master is.");
    log();

    const masterName = await ask("What's your name?");
    if (!masterName) {
      err("Name is required. Please run setup again.");
      process.exit(1);
    }

    let passphrase = "";
    while (true) {
      passphrase = await askSecret("Choose a passphrase (min 4 chars):");
      if (passphrase.length >= 4) break;
      warn("Passphrase must be at least 4 characters. Try again.");
    }

    try {
      await setupMaster(masterName, passphrase);
      log();
      ok(`Soul is now bound to you, ${C.bold}${masterName}${C.reset}!`);
    } catch (e: any) {
      err(`Failed to bind master: ${e.message}`);
      process.exit(1);
    }
  }

  // ═══ Step 2: Choose Brain ═══
  step(2, "Choose Soul's Brain");
  log();

  // Smart recommendation based on what's detected
  if (sys.ollamaInstalled && sys.ollamaModels.length > 0) {
    info(`Ollama detected with ${sys.ollamaModels.length} model(s): ${C.bold}${sys.ollamaModels.slice(0, 3).join(", ")}${C.reset}`);
    log();
  }

  const rec = recommendModel(sys.ram, sys.hasGPU);

  log(`  ${C.green}[1]${C.reset} ${C.bold}🖥️  Ollama — Local & Free${C.reset}`);
  log(`      ${C.dim}AI runs on YOUR machine. 100% private. No internet needed.${C.reset}`);
  if (sys.ollamaInstalled) {
    log(`      ${C.green}✓ Ollama ready${C.reset} ${C.dim}— Recommended: ${rec.model} (${rec.quality})${C.reset}`);
  } else {
    log(`      ${C.yellow}⚠ Ollama not installed${C.reset} ${C.dim}— will help you set up${C.reset}`);
  }
  log();

  log(`  ${C.cyan}[2]${C.reset} ${C.bold}☁️  Cloud API — Fast & Powerful${C.reset}`);
  log(`      ${C.dim}OpenAI, Gemini, Groq (free!), DeepSeek, Claude, Together.${C.reset}`);
  log(`      ${C.dim}Works on any machine. Some providers have free tiers.${C.reset}`);
  log();

  log(`  ${C.yellow}[3]${C.reset} ${C.bold}🔥 Both — Best of Both Worlds${C.reset} ${C.green}(recommended)${C.reset}`);
  log(`      ${C.dim}Local for privacy + Cloud for power. Soul auto-routes.${C.reset}`);
  log();

  const brainChoice = await ask("Choose [1/2/3]:");
  const wantOllama = ["1", "3"].includes(brainChoice);
  const wantAPI = ["2", "3"].includes(brainChoice);

  // ═══ Step 3: Configure Brain(s) ═══
  let ollamaReady = false;
  let apiReady = false;

  if (wantOllama) {
    step(3, wantAPI ? "Setup Local Brain (Ollama)" : "Setup Brain");
    log();

    if (!sys.ollamaInstalled) {
      warn("Ollama not installed yet.");
      log();
      const installUrl = sys.platform === "win32"
        ? "https://ollama.com/download/windows"
        : sys.platform === "darwin"
        ? "https://ollama.com/download/mac"
        : "https://ollama.com/download/linux";

      info(`Download from: ${C.cyan}${C.bold}${installUrl}${C.reset}`);
      if (sys.platform === "linux") {
        info(`Or run: ${C.cyan}curl -fsSL https://ollama.com/install.sh | sh${C.reset}`);
      }
      log();
      info("Install Ollama, then run this setup again.");

      if (!wantAPI) {
        const cont = await ask("Set up a Cloud API instead? (y/n):");
        if (cont.toLowerCase() === "y") {
          // Fall through to API setup
        } else {
          log();
          info(`Run ${C.bold}soul-setup${C.reset} again after installing Ollama.`);
          process.exit(0);
        }
      }
    } else {
      // Ollama is installed — check for models
      if (sys.ollamaModels.length > 0) {
        ok(`Models found: ${C.bold}${sys.ollamaModels.slice(0, 5).join(", ")}${C.reset}`);

        // Pick best available model
        let bestModel = sys.ollamaModels[0];
        const preferred = ["qwen3:32b", "qwen3-coder:32b", "qwen3:14b", "qwen3-coder:14b", "qwen3:8b"];
        for (const p of preferred) {
          if (sys.ollamaModels.includes(p)) { bestModel = p; break; }
        }

        log();
        log(`  ${C.dim}Available models:${C.reset}`);
        for (let i = 0; i < Math.min(sys.ollamaModels.length, 8); i++) {
          const m = sys.ollamaModels[i];
          const isBest = m === bestModel;
          log(`  ${isBest ? C.green + "▸" : " "} ${C.bold}${m}${C.reset}${isBest ? ` ${C.green}← recommended${C.reset}` : ""}`);
        }
        log();

        const modelChoice = await ask(`Use ${C.bold}${bestModel}${C.reset}? (Enter for yes, or type model name):`);
        const selectedModel = modelChoice.trim() || bestModel;

        saveConfig("ollama", "Ollama (Local)", "ollama", "http://localhost:11434", "", selectedModel);
        ok(`Brain set: ${C.bold}Ollama / ${selectedModel}${C.reset}`);
        ollamaReady = true;

      } else {
        // No models — offer to download
        info(`No AI models found. Let's download one.`);
        log();
        log(`  ${C.bold}Recommended for your system (${sys.ram}GB RAM${sys.hasGPU ? " + GPU" : ""}):${C.reset}`);
        log(`  ${C.green}▸${C.reset} ${C.bold}${rec.model}${C.reset} (${rec.size}) — ${rec.quality}`);
        log();

        const pull = await ask(`Download ${rec.model}? (y/n):`);
        if (pull.toLowerCase() === "y") {
          log();
          log(`  ${C.dim}Downloading ${rec.model}... (this may take a few minutes)${C.reset}`);
          try {
            execSync(`ollama pull ${rec.model}`, { stdio: "inherit", timeout: 600000 });
            log();
            ok(`${rec.model} downloaded!`);
            saveConfig("ollama", "Ollama (Local)", "ollama", "http://localhost:11434", "", rec.model);
            ollamaReady = true;
          } catch {
            warn(`Download failed. Try later: ${C.bold}ollama pull ${rec.model}${C.reset}`);
          }
        } else {
          info(`You can download a model later: ${C.bold}ollama pull ${rec.model}${C.reset}`);
          saveConfig("ollama", "Ollama (Local)", "ollama", "http://localhost:11434", "", rec.model);
          ollamaReady = true;
        }
      }
    }
  }

  if (wantAPI || (!ollamaReady && wantOllama)) {
    const stepNum = wantOllama && ollamaReady ? 4 : 3;
    step(stepNum, wantOllama ? "Setup Cloud Brain (Backup)" : "Setup Brain");
    log();

    log(`  ${C.bold}Choose a provider:${C.reset}`);
    log();
    for (let i = 0; i < API_PROVIDERS.length; i++) {
      const p = API_PROVIDERS[i];
      const tag = p.free ? `${C.green} FREE${C.reset}` : `${C.dim} paid${C.reset}`;
      log(`  ${C.cyan}[${i + 1}]${C.reset} ${C.bold}${p.name}${C.reset}${tag} ${C.dim}— ${p.desc}${C.reset}`);
    }
    log();

    const providerIdx = parseInt(await ask(`Choose [1-${API_PROVIDERS.length}]:`)) - 1;

    if (providerIdx >= 0 && providerIdx < API_PROVIDERS.length) {
      const provider = API_PROVIDERS[providerIdx];
      log();
      info(`Get your API key: ${C.cyan}${C.bold}${provider.signupUrl}${C.reset}`);
      log();

      const apiKey = await askSecret(`Paste ${provider.name} API key:`);

      if (apiKey) {
        // If Ollama is also configured, save API as non-default
        if (!ollamaReady) {
          saveConfig(provider.id, provider.name, provider.type, provider.url, apiKey, provider.model);
        } else {
          // Save as additional provider
          const configPath = path.join(SOUL_DIR, "pending-api-provider.json");
          fs.writeFileSync(configPath, JSON.stringify({
            providerId: provider.id, providerName: provider.name, providerType: provider.type,
            baseUrl: provider.url, apiKey, modelId: provider.model, modelName: provider.model,
          }, null, 2));
        }
        ok(`${provider.name} configured (${provider.model})`);
        apiReady = true;
      } else {
        warn("No key entered. You can add one later in chat.");
      }
    }
  }

  // ═══ Step 3: Live Test ═══
  if (ollamaReady || apiReady) {
    const testStep = (wantOllama && wantAPI) ? 5 : 4;
    step(testStep, "Testing Brain");
    log();

    let testPassed = false;

    if (ollamaReady && sys.ollamaRunning) {
      process.stdout.write(`  ${C.dim}Testing Ollama...${C.reset}`);
      try {
        const model = sys.ollamaModels[0] || "qwen3:8b";
        const result = exec(`ollama run ${model} "Say 'Soul is ready' in one sentence" --nowordwrap 2>&1`);
        if (result && result.length > 0 && result.length < 500) {
          process.stdout.write(`\r  ${C.green}✓${C.reset} Brain responds: ${C.italic}"${result.substring(0, 80)}"${C.reset}${" ".repeat(20)}\n`);
          testPassed = true;
        } else {
          process.stdout.write(`\r  ${C.yellow}⚠${C.reset} Brain loaded (model may still be warming up)${" ".repeat(20)}\n`);
          testPassed = true;
        }
      } catch {
        process.stdout.write(`\r  ${C.yellow}⚠${C.reset} Could not test — Ollama may still be loading${" ".repeat(20)}\n`);
      }
    } else if (ollamaReady && !sys.ollamaRunning) {
      warn(`Ollama is not running. Start it with: ${C.bold}ollama serve${C.reset}`);
      testPassed = true; // Config is saved, just not running
    }

    if (apiReady && !testPassed) {
      ok("Cloud API configured — will be tested on first chat.");
      testPassed = true;
    }

    if (!testPassed) {
      warn("No brain could be tested. Configuration saved — will activate on first run.");
    }
  }

  // ═══ Final: Success! ═══
  log();
  log(`  ${C.green}${C.bold}${BOX.tl}${line(BOX.h, 50)}${BOX.tr}${C.reset}`);
  log(`  ${C.green}${C.bold}${BOX.v}${C.reset}  ${C.green}${C.bold}✨ Soul is ready!${C.reset}${" ".repeat(34)}${C.green}${C.bold}${BOX.v}${C.reset}`);
  log(`  ${C.green}${C.bold}${BOX.bl}${line(BOX.h, 50)}${BOX.br}${C.reset}`);
  log();

  log(`  ${C.bold}Quick Start:${C.reset}`);
  log();
  log(`  ${C.cyan}soul${C.reset}                    ${C.dim}Interactive chat${C.reset}`);
  log(`  ${C.cyan}soul "question"${C.reset}          ${C.dim}Quick question${C.reset}`);
  log(`  ${C.cyan}soul-server${C.reset}              ${C.dim}Web UI → http://localhost:47779${C.reset}`);
  log();

  log(`  ${C.bold}Connect more later:${C.reset}`);
  log();
  log(`  ${C.dim}In chat, just tell Soul:${C.reset}`);
  log(`  ${C.cyan}"ต่อ Telegram ด้วย token นี้ ..."${C.reset}     ${C.dim}Telegram bot${C.reset}`);
  log(`  ${C.cyan}"connect discord webhook URL"${C.reset}         ${C.dim}Discord${C.reset}`);
  log(`  ${C.cyan}"add openai key sk-..."${C.reset}               ${C.dim}Cloud AI${C.reset}`);
  log(`  ${C.cyan}"อัพเดตตัวเอง"${C.reset}                       ${C.dim}Self-update${C.reset}`);
  log();

  log(`  ${C.bold}MCP mode${C.reset} ${C.dim}(Claude Code / Cursor / Gemini CLI):${C.reset}`);
  log(`  ${C.dim}Add to config: ${C.cyan}{ "soul": { "command": "soul-mcp" } }${C.reset}`);
  log();

  log(`  ${C.dim}Data: ${SOUL_DIR} ${C.gray}•${C.dim} All data stays on your machine.${C.reset}`);
  log();
}

main().catch(e => {
  err(`Setup failed: ${e.message}`);
  process.exit(1);
});
