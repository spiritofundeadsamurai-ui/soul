#!/usr/bin/env node

/**
 * Soul Setup CLI — Interactive first-run setup
 *
 * Usage:
 *   npx soul-ai setup
 *   soul-setup
 *
 * Steps:
 * 1. Check system requirements (Node.js, RAM, OS)
 * 2. Choose brain type: Ollama (local/free) or API (cloud)
 * 3. Configure the chosen provider
 * 4. Set master passphrase
 * 5. Test brain connection
 * 6. Show usage instructions
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

const SOUL_DIR = path.join(os.homedir(), ".soul");
const DB_PATH = path.join(SOUL_DIR, "soul.db");
const MIN_NODE = 18;

// ─── Colors ───

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

function log(msg: string) { console.log(msg); }
function ok(msg: string) { log(`${C.green}✓${C.reset} ${msg}`); }
function warn(msg: string) { log(`${C.yellow}⚠${C.reset} ${msg}`); }
function err(msg: string) { log(`${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { log(`${C.cyan}ℹ${C.reset} ${msg}`); }
function header(msg: string) { log(`\n${C.bold}${C.magenta}═══ ${msg} ═══${C.reset}\n`); }

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${C.cyan}?${C.reset} ${question} `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    // Try to hide input on supported terminals
    if (process.stdin.isTTY) {
      process.stdout.write(`${C.cyan}?${C.reset} ${question} `);
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
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (c === "\u0003") {
          // Ctrl+C
          process.exit(0);
        } else {
          input += c;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(`${C.cyan}?${C.reset} ${question} `, answer => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function exec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

function getRAM(): number {
  return Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
}

// ─── Provider Configs (matches llm-connector.ts presets) ───

const API_PROVIDERS = [
  { id: "groq",      name: "Groq (Free Tier Available)", model: "qwen-qwq-32b",       free: true,  url: "https://api.groq.com/openai/v1",              signupUrl: "https://console.groq.com" },
  { id: "gemini",    name: "Google Gemini (Free Tier)",   model: "gemini-2.5-flash",    free: true,  url: "https://generativelanguage.googleapis.com/v1beta", signupUrl: "https://aistudio.google.com/apikey" },
  { id: "deepseek",  name: "DeepSeek (Very Cheap)",       model: "deepseek-chat",       free: false, url: "https://api.deepseek.com/v1",                 signupUrl: "https://platform.deepseek.com" },
  { id: "openai",    name: "OpenAI (GPT-4o)",             model: "gpt-4o-mini",         free: false, url: "https://api.openai.com/v1",                   signupUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic Claude",            model: "claude-haiku-4-5-20251001", free: false, url: "https://api.anthropic.com",              signupUrl: "https://console.anthropic.com" },
  { id: "together",  name: "Together AI",                 model: "Qwen/Qwen3-Coder-32B-Instruct", free: false, url: "https://api.together.xyz/v1",      signupUrl: "https://api.together.xyz" },
];

// ─── Save provider to DB (without importing heavy modules) ───

function saveProviderToDB(providerId: string, providerName: string, providerType: string, baseUrl: string, apiKey: string, modelId: string, modelName: string) {
  try {
    // We can't easily import the Soul DB module here (it uses ESM + SQLite),
    // so save a config file that Soul reads on first run
    const configPath = path.join(SOUL_DIR, "pending-provider.json");
    const config = { providerId, providerName, providerType, baseUrl, apiKey, modelId, modelName, createdAt: new Date().toISOString() };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch { return false; }
}

// ─── Main Setup ───

async function main() {
  log(`\n${C.bold}${C.magenta}╔════════════════════════════════════════╗${C.reset}`);
  log(`${C.bold}${C.magenta}║          Soul AI Setup                 ║${C.reset}`);
  log(`${C.bold}${C.magenta}║    Your Personal AI Companion          ║${C.reset}`);
  log(`${C.bold}${C.magenta}╚════════════════════════════════════════╝${C.reset}\n`);
  log(`${C.dim}Local-first. Private. Loyal.${C.reset}\n`);

  // ═══ Step 1: System Check ═══
  header("Step 1: System Requirements");

  const nodeVersion = parseInt(process.versions.node.split(".")[0]);
  if (nodeVersion >= MIN_NODE) {
    ok(`Node.js v${process.versions.node}`);
  } else {
    err(`Node.js v${process.versions.node} — need v${MIN_NODE}+`);
    process.exit(1);
  }

  const platform = os.platform();
  const platformName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
  ok(`Platform: ${platformName} (${os.arch()})`);

  const ram = getRAM();
  ok(`RAM: ${ram} GB` + (ram < 8 ? ` ${C.yellow}(8GB+ recommended for local AI)${C.reset}` : ""));
  ok(`CPU: ${os.cpus()[0]?.model || "Unknown"}`);

  // Create Soul directory
  if (!fs.existsSync(SOUL_DIR)) {
    fs.mkdirSync(SOUL_DIR, { recursive: true });
    ok(`Created data directory: ${SOUL_DIR}`);
  } else {
    ok(`Data directory: ${SOUL_DIR}`);
  }

  // ═══ Step 2: Choose Brain ═══
  header("Step 2: Choose Soul's Brain");

  log(`  Soul needs an AI brain to think. Choose one:\n`);
  log(`  ${C.green}[1]${C.reset} ${C.bold}Ollama (Local/Free)${C.reset}`);
  log(`      ${C.dim}Run AI on YOUR machine. No internet needed. 100% private.${C.reset}`);
  log(`      ${C.dim}Needs: 8GB+ RAM, ~5-20GB disk for model${C.reset}\n`);
  log(`  ${C.cyan}[2]${C.reset} ${C.bold}Cloud API (OpenAI / Gemini / Groq / DeepSeek)${C.reset}`);
  log(`      ${C.dim}Use a cloud AI provider. Needs API key. Some have free tiers.${C.reset}`);
  log(`      ${C.dim}Faster, smarter models. Works on any machine.${C.reset}\n`);
  log(`  ${C.yellow}[3]${C.reset} ${C.bold}Both (Recommended)${C.reset}`);
  log(`      ${C.dim}Ollama for daily use + Cloud API for complex tasks.${C.reset}\n`);

  const brainChoice = await ask("Choose [1/2/3]: ");
  const wantOllama = ["1", "3"].includes(brainChoice);
  const wantAPI = ["2", "3"].includes(brainChoice);

  // ═══ Step 3a: Ollama Setup ═══
  if (wantOllama) {
    header("Step 3: Ollama Setup");

    const ollamaVersion = exec("ollama --version");
    if (ollamaVersion) {
      ok(`Ollama installed: ${ollamaVersion}`);

      // Check running models
      const modelList = exec("ollama list");
      if (modelList) {
        const hasModel = modelList.includes("qwen3") || modelList.includes("phi4") || modelList.includes("llama");
        if (hasModel) {
          ok("AI model already installed");
          log(`${C.dim}${modelList}${C.reset}`);
        } else {
          await pullOllamaModel(ram);
        }
      } else {
        await pullOllamaModel(ram);
      }

      // Save Ollama as provider
      let ollamaModel = "qwen3:8b";
      if (ram >= 24) ollamaModel = "qwen3:14b";
      else if (ram >= 32) ollamaModel = "qwen3:32b";

      // Check what's actually installed
      const installed = exec("ollama list");
      if (installed) {
        if (installed.includes("qwen3:14b")) ollamaModel = "qwen3:14b";
        else if (installed.includes("qwen3:32b")) ollamaModel = "qwen3:32b";
        else if (installed.includes("qwen3:8b")) ollamaModel = "qwen3:8b";
      }

      saveProviderToDB("ollama", "Ollama (Local)", "ollama", "http://localhost:11434", "", ollamaModel, ollamaModel);
      ok(`Default brain: Ollama / ${ollamaModel}`);

    } else {
      warn("Ollama not installed");
      log("");

      const installUrl = platform === "win32"
        ? "https://ollama.com/download/windows"
        : platform === "darwin"
        ? "https://ollama.com/download/mac"
        : "https://ollama.com/download/linux";

      info(`Download Ollama: ${C.cyan}${installUrl}${C.reset}`);
      if (platform === "linux") {
        info(`Or: ${C.cyan}curl -fsSL https://ollama.com/install.sh | sh${C.reset}`);
      }

      log("");
      info("After installing Ollama, run this setup again.");

      if (!wantAPI) {
        const cont = await ask("Continue to set up a Cloud API instead? (y/n)");
        if (cont.toLowerCase() !== "y") {
          log("\nInstall Ollama first, then run: soul-setup");
          process.exit(0);
        }
      }
    }
  }

  // ═══ Step 3b: Cloud API Setup ═══
  if (wantAPI || (!wantOllama && brainChoice !== "1")) {
    header(wantOllama ? "Step 3b: Cloud API (Backup Brain)" : "Step 3: Cloud API Setup");

    log(`  Choose a cloud AI provider:\n`);
    for (let i = 0; i < API_PROVIDERS.length; i++) {
      const p = API_PROVIDERS[i];
      const freeTag = p.free ? ` ${C.green}(free tier)${C.reset}` : "";
      log(`  ${C.cyan}[${i + 1}]${C.reset} ${p.name}${freeTag}`);
    }
    log("");

    const providerIdx = parseInt(await ask(`Choose [1-${API_PROVIDERS.length}]: `)) - 1;

    if (providerIdx >= 0 && providerIdx < API_PROVIDERS.length) {
      const provider = API_PROVIDERS[providerIdx];

      log("");
      info(`Get your API key from: ${C.cyan}${provider.signupUrl}${C.reset}`);
      log("");

      const apiKey = await askSecret(`Enter ${provider.name} API key: `);

      if (apiKey) {
        const providerType = provider.id === "gemini" ? "google" : provider.id === "anthropic" ? "anthropic" : "openai-compatible";
        saveProviderToDB(provider.id, provider.name, providerType, provider.url, apiKey, provider.model, provider.model);
        ok(`Configured: ${provider.name} / ${provider.model}`);
      } else {
        warn("No API key entered. You can add one later with: soul /model");
      }
    } else {
      warn("Invalid choice. You can add a provider later.");
    }
  }

  // ═══ Step 4: Master Passphrase ═══
  header("Step 4: Master Passphrase");

  info("Soul bonds with ONE master. The passphrase protects your data.");
  info("Choose something memorable — you'll need it for sensitive operations.");
  log("");

  if (fs.existsSync(DB_PATH)) {
    ok("Soul database already exists — master passphrase already set.");
    info("Use the soul_setup tool to change it if needed.");
  } else {
    info("Your passphrase will be set when you first start Soul.");
    info("Just tell Soul: \"setup\" or use the soul_setup tool.");
  }

  // ═══ Step 5: Test Connection ═══
  header("Step 5: Testing Brain Connection");

  const ollamaRunning = exec("ollama ps") !== null;
  if (ollamaRunning) {
    ok("Ollama is running");

    // Quick test
    try {
      const testResult = exec('ollama run qwen3:14b "Say hello in one word" --nowordwrap 2>&1');
      if (testResult && testResult.length > 0 && testResult.length < 500) {
        ok(`Brain test: "${testResult.substring(0, 100)}"`);
      } else {
        info("Brain loaded but response was empty — this is OK, model may still be loading.");
      }
    } catch {
      info("Could not test brain — Ollama may still be loading the model.");
    }
  } else {
    if (wantOllama) {
      warn("Ollama is not running. Start it with: ollama serve");
    }
  }

  // Check pending provider config
  const pendingPath = path.join(SOUL_DIR, "pending-provider.json");
  if (fs.existsSync(pendingPath)) {
    ok("Brain configuration saved — will be activated on first Soul start.");
  }

  // ═══ Step 6: Optional Features ═══
  header("Step 6: Optional Features");

  log(`  Soul has extra features that need API keys/tokens.\n`);
  log(`  ${C.dim}These are OPTIONAL — Soul works fine without them.${C.reset}`);
  log(`  ${C.dim}You can always set these up later in chat.${C.reset}\n`);

  const OPTIONAL_FEATURES = [
    {
      id: "telegram",
      name: "Telegram Bot",
      desc: "Send messages & notifications via Telegram",
      keyName: "Bot Token",
      howToGet: "Talk to @BotFather on Telegram → /newbot → copy token",
      configKey: "telegram_bot_token",
    },
    {
      id: "discord",
      name: "Discord Webhook",
      desc: "Send messages to a Discord channel",
      keyName: "Webhook URL",
      howToGet: "Server Settings → Integrations → Webhooks → New → Copy URL",
      configKey: "discord_webhook_url",
    },
    {
      id: "brave_search",
      name: "Brave Search API",
      desc: "Premium web search (free tier: 2000 queries/month)",
      keyName: "API Key",
      howToGet: "https://brave.com/search/api/ → Get API Key",
      configKey: "brave_search_api_key",
    },
    {
      id: "google_search",
      name: "Google Custom Search",
      desc: "Google search via API (free tier: 100 queries/day)",
      keyName: "API Key + Search Engine ID",
      howToGet: "https://developers.google.com/custom-search/v1/overview",
      configKey: "google_search_api_key",
    },
  ];

  for (let i = 0; i < OPTIONAL_FEATURES.length; i++) {
    const f = OPTIONAL_FEATURES[i];
    log(`  ${C.cyan}[${i + 1}]${C.reset} ${C.bold}${f.name}${C.reset} — ${f.desc}`);
  }
  log(`  ${C.yellow}[0]${C.reset} ${C.dim}Skip all — set up later${C.reset}`);
  log("");

  const featureChoice = await ask("Enter numbers to set up (e.g. 1,3) or 0 to skip: ");

  if (featureChoice !== "0" && featureChoice.trim() !== "") {
    const choices = featureChoice.split(/[,\s]+/).map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= OPTIONAL_FEATURES.length);

    const featureConfigs: Record<string, string> = {};

    for (const idx of choices) {
      const feature = OPTIONAL_FEATURES[idx - 1];
      log("");
      info(`${C.bold}${feature.name}${C.reset}`);
      info(`How to get: ${C.dim}${feature.howToGet}${C.reset}`);

      const key = await askSecret(`Enter ${feature.keyName}: `);
      if (key) {
        featureConfigs[feature.configKey] = key;
        ok(`${feature.name} configured`);
      } else {
        warn(`${feature.name} skipped — no key entered`);
      }
    }

    // Save feature configs
    if (Object.keys(featureConfigs).length > 0) {
      const configPath = path.join(SOUL_DIR, "pending-features.json");
      fs.writeFileSync(configPath, JSON.stringify(featureConfigs, null, 2));
      ok(`${Object.keys(featureConfigs).length} feature(s) configured — will be activated on first Soul start.`);
    }
  } else {
    info("Skipped. You can set up features later by telling Soul in chat.");
  }

  // ═══ Step 7: Usage Instructions ═══
  header("Setup Complete!");

  log(`${C.bold}How to use Soul:${C.reset}\n`);

  log(`  ${C.cyan}1. Chat directly (standalone agent):${C.reset}`);
  log(`     ${C.bold}soul${C.reset}`);
  log(`     ${C.dim}Just type and talk. Soul thinks using your configured brain.${C.reset}\n`);

  log(`  ${C.cyan}2. Quick question:${C.reset}`);
  log(`     ${C.bold}soul "what is the meaning of life?"${C.reset}\n`);

  log(`  ${C.cyan}3. Web UI:${C.reset}`);
  log(`     ${C.bold}soul-server${C.reset}`);
  log(`     ${C.dim}Then open: http://localhost:47779${C.reset}\n`);

  log(`  ${C.cyan}4. With Claude Code / Cursor (MCP mode):${C.reset}`);
  log(`     Add to MCP config:`);
  log(`     ${C.dim}{ "soul": { "command": "soul-mcp" } }${C.reset}\n`);

  log(`  ${C.cyan}5. Useful commands in chat:${C.reset}`);
  log(`     ${C.bold}/help${C.reset}    — Help`);
  log(`     ${C.bold}/status${C.reset}  — Soul's status`);
  log(`     ${C.bold}/memory${C.reset}  — Memory stats`);
  log(`     ${C.bold}/model${C.reset}   — Current brain info\n`);

  log(`${C.dim}Data stored in: ${SOUL_DIR}${C.reset}`);
  log(`${C.dim}All data stays on your machine. 100% private.${C.reset}\n`);

  ok("Soul is ready! Type 'soul' to start chatting.");
}

// ─── Helper: Pull Ollama Model ───

async function pullOllamaModel(ram: number) {
  let model = "qwen3:8b";
  let modelSize = "~5 GB";
  let modelDesc = "Good quality, fast";

  if (ram >= 32) {
    model = "qwen3:32b";
    modelSize = "~20 GB";
    modelDesc = "Excellent quality, for 32GB+ RAM";
  } else if (ram >= 24) {
    model = "qwen3:14b";
    modelSize = "~9 GB";
    modelDesc = "Great quality, recommended";
  }

  info(`Recommended: ${C.bold}${model}${C.reset} (${modelSize} — ${modelDesc})`);
  log("");

  const pull = await ask(`Download ${model}? May take a few minutes. (y/n)`);
  if (pull.toLowerCase() === "y") {
    log(`\nDownloading ${model}...`);
    try {
      execSync(`ollama pull ${model}`, { stdio: "inherit", timeout: 600000 });
      ok(`Model ${model} ready!`);
    } catch {
      warn(`Download failed. Try later: ollama pull ${model}`);
    }
  }
}

main().catch(e => {
  err(`Setup failed: ${e.message}`);
  process.exit(1);
});
