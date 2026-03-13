/**
 * MT5 Engine — MetaTrader 5 integration via Python bridge
 *
 * Spawns mt5_bridge.py as a subprocess, communicates via JSON-RPC over stdio.
 * Stores credentials encrypted, tracks prices, generates trading signals.
 */

import { spawn, exec, execSync, ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync } from "fs";
import { getRawDb } from "../db/index.js";
import { encryptSecret, safeDecryptSecret } from "./security.js";

// ─── Bridge Process ───

let bridgeProcess: ChildProcess | null = null;
let bridgeReady = false;
let pendingRequests: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
let responseBuffer = "";
let requestCounter = 0;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

// ─── Tables ───

let tableReady = false;
function ensureMt5Tables() {
  if (tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_mt5_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      server TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      mt5_path TEXT,
      default_symbol TEXT DEFAULT 'XAUUSD',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS soul_mt5_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      bid REAL NOT NULL,
      ask REAL NOT NULL,
      spread REAL NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mt5_prices_sym ON soul_mt5_prices(symbol, fetched_at);
    CREATE TABLE IF NOT EXISTS soul_mt5_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      strategy TEXT NOT NULL,
      price REAL NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      notified INTEGER DEFAULT 0,
      outcome TEXT,
      outcome_price REAL,
      outcome_pips REAL,
      outcome_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS soul_mt5_strategy_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      total_signals INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      avg_pips REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy, symbol, timeframe)
    );
    CREATE TABLE IF NOT EXISTS soul_mt5_analysis_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframes TEXT NOT NULL,
      indicators TEXT NOT NULL,
      correlation TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  tableReady = true;
}

// ─── Bridge Communication ───

function getBridgePath(): string {
  // Works in both dev and dist
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Try src/bridges first (dev), then relative from dist
  const devPath = join(thisDir, "..", "..", "src", "bridges", "mt5_bridge.py");
  const distPath = join(thisDir, "..", "bridges", "mt5_bridge.py");
  if (existsSync(devPath)) return devPath;
  if (existsSync(distPath)) return distPath;
  return devPath; // fallback
}

function sendToBridge(method: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!bridgeProcess || !bridgeReady) {
      reject(new Error("MT5 bridge not connected. Use soul_mt5_connect first."));
      return;
    }

    const id = `req_${++requestCounter}`;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`MT5 bridge timeout for ${method}`));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timer: timeout });

    const msg = JSON.stringify({ id, method, params }) + "\n";
    bridgeProcess.stdin?.write(msg);
  });
}

function handleBridgeData(data: string) {
  responseBuffer += data;
  const lines = responseBuffer.split("\n");
  responseBuffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // Ready signal
      if (msg.ready) {
        bridgeReady = true;
        continue;
      }

      // Response to a request
      const id = msg.id;
      const pending = pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch { /* skip malformed lines */ }
  }
}

// ─── Public API ───

/**
 * Store MT5 credentials (encrypted)
 */
export function configureMt5(input: {
  account: string;
  password: string;
  server: string;
  mt5Path?: string;
  defaultSymbol?: string;
}): { success: boolean; message: string } {
  ensureMt5Tables();
  const db = getRawDb();

  const encrypted = encryptSecret(input.password);

  // Upsert
  const existing = db.prepare("SELECT id FROM soul_mt5_config WHERE account = ? AND server = ?")
    .get(input.account, input.server) as any;

  if (existing) {
    db.prepare(`UPDATE soul_mt5_config SET password_encrypted = ?, mt5_path = ?, default_symbol = ?, is_active = 1 WHERE id = ?`)
      .run(encrypted, input.mt5Path || null, input.defaultSymbol || "XAUUSD", existing.id);
  } else {
    db.prepare(`INSERT INTO soul_mt5_config (account, server, password_encrypted, mt5_path, default_symbol) VALUES (?, ?, ?, ?, ?)`)
      .run(input.account, input.server, encrypted, input.mt5Path || null, input.defaultSymbol || "XAUUSD");
  }

  return { success: true, message: `MT5 config saved: account ${input.account} @ ${input.server}` };
}

/**
 * Get stored MT5 config (decrypted)
 */
export function getMt5Config(): { account: string; password: string; server: string; mt5Path?: string; defaultSymbol: string } | null {
  ensureMt5Tables();
  const db = getRawDb();
  const row = db.prepare("SELECT * FROM soul_mt5_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get() as any;
  if (!row) return null;
  return {
    account: row.account,
    password: safeDecryptSecret(row.password_encrypted),
    server: row.server,
    mt5Path: row.mt5_path,
    defaultSymbol: row.default_symbol || "XAUUSD",
  };
}

/**
 * Auto-detect MT5 terminal executable on the system
 */
function findMt5Terminal(): string | null {
  // Common installation paths on Windows
  const searchDirs = [
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "D:\\Program Files",
    process.env.LOCALAPPDATA || "",
    join(process.env.USERPROFILE || "", "AppData", "Roaming", "MetaQuotes", "Terminal"),
  ].filter(Boolean);

  const exeNames = ["terminal64.exe", "terminal.exe"];

  for (const dir of searchDirs) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (/metatrader/i.test(entry)) {
          for (const exe of exeNames) {
            const fullPath = join(dir, entry, exe);
            if (existsSync(fullPath)) return fullPath;
          }
        }
      }
    } catch { /* dir not accessible */ }
  }
  return null;
}

/**
 * Launch MT5 terminal if not already running, then wait for it to be ready
 */
async function autoLaunchMt5(): Promise<{ launched: boolean; message: string }> {
  // Check if MT5 is already running
  try {
    // execSync already imported at top
    const tasklist = execSync("tasklist /FI \"IMAGENAME eq terminal64.exe\" /NH", { encoding: "utf-8" });
    if (tasklist.includes("terminal64.exe")) {
      return { launched: true, message: "MT5 already running" };
    }
  } catch { /* ok */ }

  // Find MT5 executable
  const config = getMt5Config();
  let mt5Exe = config?.mt5Path || findMt5Terminal();

  if (!mt5Exe || !existsSync(mt5Exe)) {
    return { launched: false, message: "ไม่พบโปรแกรม MetaTrader 5 บนเครื่องนี้" };
  }

  // Launch MT5
  console.log(`[MT5] Auto-launching: ${mt5Exe}`);
  try {
    // exec already imported at top
    // Use /portable to avoid disrupting existing installations
    exec(`"${mt5Exe}"`, { windowsHide: false });

    // Wait for MT5 to initialize (up to 15 seconds)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        // execSync already imported at top
        const check = execSync("tasklist /FI \"IMAGENAME eq terminal64.exe\" /NH", { encoding: "utf-8" });
        if (check.includes("terminal64.exe")) {
          // Give MT5 a moment to fully load
          await new Promise(r => setTimeout(r, 3000));
          return { launched: true, message: `เปิด MT5 แล้ว: ${mt5Exe}` };
        }
      } catch { /* keep waiting */ }
    }
    return { launched: false, message: "เปิด MT5 แล้วแต่ไม่ตอบสนอง (timeout 15s)" };
  } catch (err: any) {
    return { launched: false, message: `ไม่สามารถเปิด MT5: ${err.message}` };
  }
}

/**
 * Connect to MT5 — auto-launch if needed, spawn Python bridge and login
 */
export async function connectMt5(): Promise<{ success: boolean; message: string; account?: any }> {
  if (bridgeProcess && bridgeReady) {
    // Already connected, check with ping
    try {
      await sendToBridge("ping");
      return { success: true, message: "Already connected to MT5." };
    } catch {
      // Bridge died, reconnect
      await disconnectMt5();
    }
  }

  const config = getMt5Config();
  if (!config) {
    return { success: false, message: "No MT5 config found. Use soul_mt5_setup first." };
  }

  // AUTO-LAUNCH: If MT5 is not running, try to open it automatically
  const launch = await autoLaunchMt5();
  console.log(`[MT5] Auto-launch: ${launch.message}`);

  const bridgePath = getBridgePath();

  return new Promise((resolve) => {
    bridgeReady = false;
    responseBuffer = "";

    // Find python
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    bridgeProcess = spawn(pythonCmd, [bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let startupTimeout = setTimeout(() => {
      resolve({ success: false, message: "MT5 bridge startup timeout (10s)" });
    }, 10000);

    bridgeProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      handleBridgeData(text);

      // On first ready signal, initialize and login
      if (bridgeReady && startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null as any;

        (async () => {
          try {
            // Initialize MT5
            const initResult = await sendToBridge("initialize", config.mt5Path ? { path: config.mt5Path } : {});
            if (!initResult.success) {
              resolve({ success: false, message: `MT5 init failed: ${JSON.stringify(initResult)}` });
              return;
            }

            // Login
            const loginResult = await sendToBridge("login", {
              account: config.account,
              password: config.password,
              server: config.server,
            });

            resolve({
              success: true,
              message: `Connected to MT5: ${config.account} @ ${config.server}`,
              account: loginResult.account || loginResult,
            });
          } catch (err: any) {
            resolve({ success: false, message: `MT5 connection error: ${err.message}` });
          }
        })();
      }
    });

    bridgeProcess.stderr?.on("data", (chunk: Buffer) => {
      // Log Python errors for debugging
      const text = chunk.toString().trim();
      if (text) console.error("[MT5 Bridge]", text);
    });

    bridgeProcess.on("close", (code) => {
      bridgeProcess = null;
      bridgeReady = false;
      // Reject all pending requests
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("MT5 bridge process exited"));
      }
      pendingRequests.clear();
    });

    bridgeProcess.on("error", (err) => {
      clearTimeout(startupTimeout);
      resolve({ success: false, message: `Cannot start Python bridge: ${err.message}. Is Python installed?` });
    });
  });
}

/**
 * Disconnect from MT5
 */
export async function disconnectMt5(): Promise<void> {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (bridgeProcess) {
    try {
      await sendToBridge("shutdown");
    } catch { /* ok */ }
    bridgeProcess.kill();
    bridgeProcess = null;
    bridgeReady = false;
  }
}

/**
 * Ensure MT5 is connected — auto-launch + auto-connect if needed
 * Every MT5 function should call this first instead of assuming bridge is ready
 */
async function ensureConnected(): Promise<void> {
  if (bridgeProcess && bridgeReady) {
    try { await sendToBridge("ping"); return; } catch { /* bridge died */ }
  }
  const result = await connectMt5();
  if (!result.success) {
    throw new Error(`MT5 ไม่พร้อม: ${result.message}`);
  }
}

/**
 * Get real-time price
 */
export async function getPrice(symbol?: string): Promise<any> {
  await ensureConnected();
  const config = getMt5Config();
  const sym = symbol || config?.defaultSymbol || "XAUUSD";
  const result = await sendToBridge("get_price", { symbol: sym });

  // Store in DB
  try {
    ensureMt5Tables();
    const db = getRawDb();
    db.prepare("INSERT INTO soul_mt5_prices (symbol, bid, ask, spread) VALUES (?, ?, ?, ?)")
      .run(sym, result.bid, result.ask, result.spread);
  } catch { /* ok */ }

  return result;
}

/**
 * Get candle data
 */
export async function getCandles(symbol?: string, timeframe?: string, count?: number): Promise<any> {
  await ensureConnected();
  const config = getMt5Config();
  return sendToBridge("get_candles", {
    symbol: symbol || config?.defaultSymbol || "XAUUSD",
    timeframe: timeframe || "H1",
    count: count || 100,
  });
}

/**
 * Get account info
 */
export async function getAccountInfo(): Promise<any> {
  await ensureConnected();
  return sendToBridge("get_account", {});
}

/**
 * Get open positions
 */
export async function getPositions(symbol?: string): Promise<any> {
  await ensureConnected();
  return sendToBridge("get_positions", symbol ? { symbol } : {});
}

/**
 * Get available symbols
 */
export async function getSymbols(pattern?: string): Promise<any> {
  return sendToBridge("get_symbols", { pattern: pattern || "*" });
}

/**
 * Check MT5 connection status
 */
export function getMt5Status(): { connected: boolean; monitoring: boolean; config: boolean } {
  const config = getMt5Config();
  return {
    connected: bridgeProcess !== null && bridgeReady,
    monitoring: monitorInterval !== null,
    config: config !== null,
  };
}

// ─── Technical Analysis ───

interface Signal {
  type: "buy" | "sell" | "alert";
  strategy: string;
  price: number;
  details: string;
}

/**
 * Simple Moving Average
 */
function calcSMA(closes: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    sma.push(sum / period);
  }
  return sma;
}

/**
 * RSI (Relative Strength Index)
 */
function calcRSI(closes: number[], period: number = 14): number[] {
  const rsi: number[] = [NaN];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push(100 - 100 / (1 + rs));
      } else {
        rsi.push(NaN);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

/**
 * Find support/resistance levels from recent candles
 */
function findLevels(candles: Array<{ high: number; low: number; close: number }>, lookback: number = 50): { support: number; resistance: number } {
  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
  };
}

/**
 * Analyze chart and generate signals
 */
export async function analyzeChart(symbol?: string, timeframe?: string): Promise<{
  symbol: string;
  timeframe: string;
  price: any;
  signals: Signal[];
  indicators: { sma9: number; sma21: number; rsi14: number; support: number; resistance: number };
}> {
  await ensureConnected();
  const config = getMt5Config();
  const sym = symbol || config?.defaultSymbol || "XAUUSD";
  const tf = timeframe || "H1";

  // Get current price and candles
  const [price, candleData] = await Promise.all([
    getPrice(sym),
    getCandles(sym, tf, 100),
  ]);

  const candles = candleData.candles as Array<{ open: number; high: number; low: number; close: number; volume: number; time: string }>;
  const closes = candles.map(c => c.close);

  // Calculate indicators
  const sma9 = calcSMA(closes, 9);
  const sma21 = calcSMA(closes, 21);
  const rsi = calcRSI(closes, 14);
  const levels = findLevels(candles);

  const lastSma9 = sma9[sma9.length - 1];
  const lastSma21 = sma21[sma21.length - 1];
  const prevSma9 = sma9[sma9.length - 2];
  const prevSma21 = sma21[sma21.length - 2];
  const lastRsi = rsi[rsi.length - 1];
  const currentPrice = price.bid;

  // Generate signals
  const signals: Signal[] = [];

  // SMA Crossover
  if (!isNaN(prevSma9) && !isNaN(prevSma21)) {
    if (prevSma9 <= prevSma21 && lastSma9 > lastSma21) {
      signals.push({
        type: "buy",
        strategy: "sma_cross",
        price: currentPrice,
        details: `SMA(9) ${lastSma9.toFixed(2)} crossed above SMA(21) ${lastSma21.toFixed(2)}`,
      });
    }
    if (prevSma9 >= prevSma21 && lastSma9 < lastSma21) {
      signals.push({
        type: "sell",
        strategy: "sma_cross",
        price: currentPrice,
        details: `SMA(9) ${lastSma9.toFixed(2)} crossed below SMA(21) ${lastSma21.toFixed(2)}`,
      });
    }
  }

  // RSI
  if (!isNaN(lastRsi)) {
    if (lastRsi > 70) {
      signals.push({ type: "sell", strategy: "rsi", price: currentPrice, details: `RSI(14) = ${lastRsi.toFixed(1)} — Overbought` });
    } else if (lastRsi < 30) {
      signals.push({ type: "buy", strategy: "rsi", price: currentPrice, details: `RSI(14) = ${lastRsi.toFixed(1)} — Oversold` });
    }
  }

  // Support/Resistance proximity
  const priceRange = levels.resistance - levels.support;
  if (priceRange > 0) {
    if (currentPrice - levels.support < priceRange * 0.05) {
      signals.push({ type: "alert", strategy: "support", price: currentPrice, details: `Near support ${levels.support.toFixed(2)}` });
    }
    if (levels.resistance - currentPrice < priceRange * 0.05) {
      signals.push({ type: "alert", strategy: "resistance", price: currentPrice, details: `Near resistance ${levels.resistance.toFixed(2)}` });
    }
  }

  // Store signals
  if (signals.length > 0) {
    try {
      ensureMt5Tables();
      const db = getRawDb();
      const stmt = db.prepare("INSERT INTO soul_mt5_signals (symbol, signal_type, strategy, price, details) VALUES (?, ?, ?, ?, ?)");
      for (const s of signals) {
        stmt.run(sym, s.type, s.strategy, s.price, s.details);
      }
    } catch { /* ok */ }
  }

  return {
    symbol: sym,
    timeframe: tf,
    price,
    signals,
    indicators: {
      sma9: lastSma9,
      sma21: lastSma21,
      rsi14: lastRsi,
      support: levels.support,
      resistance: levels.resistance,
    },
  };
}

// ─── Price Monitor ───

/**
 * Start monitoring price with alerts
 */
export async function startMonitor(input: {
  symbol?: string;
  intervalSec?: number;
  telegramChannel?: string;
}): Promise<{ success: boolean; message: string }> {
  if (monitorInterval) {
    return { success: false, message: "Monitor already running. Stop it first." };
  }

  const config = getMt5Config();
  const symbol = input.symbol || config?.defaultSymbol || "XAUUSD";
  const intervalMs = (input.intervalSec || 60) * 1000;
  const channel = input.telegramChannel;

  monitorInterval = setInterval(async () => {
    try {
      const analysis = await analyzeChart(symbol);

      if (analysis.signals.length > 0 && channel) {
        // Send alert via Telegram
        const { sendMessage } = await import("./channels.js");
        const alertLines = [
          `🔔 ${symbol} Trading Signal`,
          "",
          ...analysis.signals.map(s => {
            const emoji = s.type === "buy" ? "📈" : s.type === "sell" ? "📉" : "⚠️";
            return `${emoji} ${s.type.toUpperCase()} (${s.strategy}): ${s.details}`;
          }),
          "",
          `💰 Price: ${analysis.price.bid}`,
          `📊 SMA(9): ${analysis.indicators.sma9?.toFixed(2)} | SMA(21): ${analysis.indicators.sma21?.toFixed(2)}`,
          `📈 RSI(14): ${analysis.indicators.rsi14?.toFixed(1)}`,
          `🔻 Support: ${analysis.indicators.support?.toFixed(2)} | 🔺 Resistance: ${analysis.indicators.resistance?.toFixed(2)}`,
        ];

        await sendMessage(channel, alertLines.join("\n"));
      }
    } catch (err: any) {
      console.error("[MT5 Monitor]", err.message);
    }
  }, intervalMs);

  return { success: true, message: `Monitoring ${symbol} every ${input.intervalSec || 60}s${channel ? ` → alerts to ${channel}` : ""}` };
}

/**
 * Stop price monitor
 */
export function stopMonitor(): { success: boolean; message: string } {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    return { success: true, message: "Monitor stopped." };
  }
  return { success: false, message: "No monitor running." };
}

// ─── Price Level Alerts ───
// Real alerts that check specific price levels and notify via Telegram

interface PriceAlert {
  id: number;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  message: string;
  telegramChannel: string;
  triggered: boolean;
  createdAt: string;
}

let priceAlertInterval: ReturnType<typeof setInterval> | null = null;
const ALERT_CHECK_INTERVAL = 30_000; // Check every 30 seconds

function ensurePriceAlertTable() {
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL DEFAULT 'XAUUSD',
      target_price REAL NOT NULL,
      direction TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      telegram_channel TEXT NOT NULL DEFAULT '',
      triggered INTEGER NOT NULL DEFAULT 0,
      triggered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Add a price level alert — will notify via Telegram when price crosses the level
 */
export function addPriceAlert(input: {
  symbol?: string;
  targetPrice: number;
  direction: "above" | "below";
  message?: string;
  telegramChannel?: string;
}): { success: boolean; alertId: number; message: string } {
  ensurePriceAlertTable();
  const db = getRawDb();

  // Find telegram channel if not provided
  let channel = input.telegramChannel || "";
  if (!channel) {
    try {
      const ch = db.prepare("SELECT name FROM soul_channels WHERE channel_type = 'telegram' AND is_active = 1 LIMIT 1").get() as any;
      if (ch) channel = ch.name;
    } catch { /* ok */ }
  }

  const row = db.prepare(`
    INSERT INTO soul_price_alerts (symbol, target_price, direction, message, telegram_channel)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).get(
    input.symbol || "XAUUSD",
    input.targetPrice,
    input.direction,
    input.message || `ราคา ${input.symbol || "XAUUSD"} ถึง ${input.targetPrice}`,
    channel,
  ) as any;

  // Auto-start alert checker if not running
  startPriceAlertChecker();

  const dirLabel = input.direction === "above" ? "ยืนเหนือ" : "หลุด";
  return {
    success: true,
    alertId: row.id,
    message: `✅ ตั้งเตือนจริงแล้ว: ${input.symbol || "XAUUSD"} ${dirLabel} ${input.targetPrice} → แจ้งเตือนทาง Telegram (เช็คทุก 30 วินาที)`,
  };
}

/**
 * List active (untriggered) price alerts
 */
export function listPriceAlerts(): PriceAlert[] {
  ensurePriceAlertTable();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_price_alerts WHERE triggered = 0 ORDER BY created_at DESC").all() as any[];
}

/**
 * Cancel a price alert
 */
export function cancelPriceAlert(alertId: number): { success: boolean; message: string } {
  ensurePriceAlertTable();
  const db = getRawDb();
  const result = db.prepare("DELETE FROM soul_price_alerts WHERE id = ? AND triggered = 0").run(alertId);
  if (result.changes > 0) return { success: true, message: `ยกเลิกเตือน #${alertId} แล้ว` };
  return { success: false, message: `ไม่พบเตือน #${alertId}` };
}

/**
 * Start the background price alert checker
 */
function startPriceAlertChecker() {
  if (priceAlertInterval) return; // Already running

  console.log("[MT5] Price alert checker started (every 30s)");
  priceAlertInterval = setInterval(async () => {
    try {
      ensurePriceAlertTable();
      const db = getRawDb();
      const alerts = db.prepare("SELECT * FROM soul_price_alerts WHERE triggered = 0").all() as any[];

      if (alerts.length === 0) {
        // No active alerts — stop checking
        if (priceAlertInterval) {
          clearInterval(priceAlertInterval);
          priceAlertInterval = null;
          console.log("[MT5] Price alert checker stopped (no active alerts)");
        }
        return;
      }

      // Group alerts by symbol to minimize API calls
      const symbolAlerts = new Map<string, any[]>();
      for (const alert of alerts) {
        const existing = symbolAlerts.get(alert.symbol) || [];
        existing.push(alert);
        symbolAlerts.set(alert.symbol, existing);
      }

      for (const [symbol, alertList] of symbolAlerts) {
        try {
          await ensureConnected();
          const price = await getPrice(symbol);
          const currentBid = price.bid;

          for (const alert of alertList) {
            let triggered = false;
            if (alert.direction === "above" && currentBid >= alert.target_price) triggered = true;
            if (alert.direction === "below" && currentBid <= alert.target_price) triggered = true;

            if (triggered) {
              // Mark as triggered
              db.prepare("UPDATE soul_price_alerts SET triggered = 1, triggered_at = datetime('now') WHERE id = ?").run(alert.id);

              const dirEmoji = alert.direction === "above" ? "🔺" : "🔻";
              const dirLabel = alert.direction === "above" ? "ยืนเหนือ" : "หลุดต่ำกว่า";
              const alertMsg = [
                `🔔 Price Alert!`,
                `${dirEmoji} ${symbol} ${dirLabel} ${alert.target_price}`,
                `💰 ราคาปัจจุบัน: ${currentBid}`,
                alert.message ? `📝 ${alert.message}` : "",
              ].filter(Boolean).join("\n");

              console.log(`[MT5] 🔔 Alert triggered: ${symbol} ${alert.direction} ${alert.target_price} (current: ${currentBid})`);

              // Send Telegram notification
              if (alert.telegram_channel) {
                try {
                  const { sendMessage } = await import("./channels.js");
                  await sendMessage(alert.telegram_channel, alertMsg);
                } catch (e: any) {
                  console.error("[MT5] Alert send failed:", e.message);
                }
              }

              // Also store in memory
              try {
                const { remember } = await import("../memory/memory-engine.js");
                await remember({
                  content: `Price alert triggered: ${symbol} ${dirLabel} ${alert.target_price}. Current: ${currentBid}`,
                  type: "knowledge",
                  tags: ["price-alert", "mt5", symbol.toLowerCase()],
                  source: "price-alert",
                });
              } catch { /* ok */ }
            }
          }
        } catch (e: any) {
          console.error(`[MT5] Alert check failed for ${symbol}:`, e.message);
        }
      }
    } catch (e: any) {
      console.error("[MT5] Alert checker error:", e.message);
    }
  }, ALERT_CHECK_INTERVAL);
}

/**
 * Get recent signals from DB
 */
export function getRecentSignals(limit: number = 20): any[] {
  ensureMt5Tables();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_mt5_signals ORDER BY created_at DESC LIMIT ?").all(limit);
}

// ─── Advanced Indicators ───

/**
 * EMA (Exponential Moving Average)
 */
function calcEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { ema.push(closes[0]); continue; }
    if (i < period - 1) {
      // Use SMA for initial values
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += closes[j];
      ema.push(sum / (i + 1));
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      ema.push(sum / period);
    } else {
      ema.push(closes[i] * k + ema[i - 1] * (1 - k));
    }
  }
  return ema;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
function calcMACD(closes: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  const signalLine = calcEMA(macdLine, 9);
  const histogram: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    histogram.push(macdLine[i] - signalLine[i]);
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Bollinger Bands
 */
function calcBollinger(closes: number[], period: number = 20, stdDev: number = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calcSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - middle[i]) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper.push(middle[i] + stdDev * std);
    lower.push(middle[i] - stdDev * std);
  }
  return { upper, middle, lower };
}

/**
 * ATR (Average True Range)
 */
function calcATR(candles: Array<{ high: number; low: number; close: number }>, period: number = 14): number[] {
  const atr: number[] = [NaN];
  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
    if (i < period) { atr.push(NaN); continue; }
    if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) sum += trueRanges[j];
      atr.push(sum / period);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  return atr;
}

// ─── Multi-Timeframe Analysis ───

interface TfAnalysis {
  timeframe: string;
  trend: "bullish" | "bearish" | "neutral";
  strength: number; // 0-100
  sma9: number;
  sma21: number;
  ema50: number;
  rsi14: number;
  macd: { line: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number; position: string };
  atr: number;
  support: number;
  resistance: number;
}

/**
 * Full analysis for a single timeframe
 */
async function analyzeSingleTf(symbol: string, timeframe: string): Promise<TfAnalysis> {
  const candleData = await getCandles(symbol, timeframe, 100);
  const candles = candleData.candles as Array<{ open: number; high: number; low: number; close: number; volume: number }>;
  const closes = candles.map(c => c.close);
  const lastClose = closes[closes.length - 1];

  const sma9 = calcSMA(closes, 9);
  const sma21 = calcSMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const atr = calcATR(candles);
  const levels = findLevels(candles);

  const lastSma9 = sma9[sma9.length - 1];
  const lastSma21 = sma21[sma21.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastRsi = rsi[rsi.length - 1];
  const lastMacd = macd.macd[macd.macd.length - 1];
  const lastSignal = macd.signal[macd.signal.length - 1];
  const lastHist = macd.histogram[macd.histogram.length - 1];
  const lastBbUpper = bb.upper[bb.upper.length - 1];
  const lastBbMiddle = bb.middle[bb.middle.length - 1];
  const lastBbLower = bb.lower[bb.lower.length - 1];
  const lastAtr = atr[atr.length - 1];

  // Determine trend
  let bullishScore = 0;
  if (lastClose > lastSma9) bullishScore++;
  if (lastClose > lastSma21) bullishScore++;
  if (lastClose > lastEma50) bullishScore++;
  if (lastSma9 > lastSma21) bullishScore++;
  if (lastRsi > 50) bullishScore++;
  if (lastMacd > lastSignal) bullishScore++;
  if (lastHist > 0) bullishScore++;

  const strength = Math.round((bullishScore / 7) * 100);
  const trend = strength > 60 ? "bullish" : strength < 40 ? "bearish" : "neutral";

  // BB position
  let bbPosition = "middle";
  if (lastClose > lastBbUpper) bbPosition = "above_upper";
  else if (lastClose > lastBbMiddle) bbPosition = "upper_half";
  else if (lastClose > lastBbLower) bbPosition = "lower_half";
  else bbPosition = "below_lower";

  return {
    timeframe,
    trend,
    strength,
    sma9: lastSma9,
    sma21: lastSma21,
    ema50: lastEma50,
    rsi14: lastRsi,
    macd: { line: lastMacd, signal: lastSignal, histogram: lastHist },
    bollinger: { upper: lastBbUpper, middle: lastBbMiddle, lower: lastBbLower, position: bbPosition },
    atr: lastAtr,
    support: levels.support,
    resistance: levels.resistance,
  };
}

/**
 * Multi-timeframe analysis — correlate M15 + H1 + H4 + D1
 */
export async function multiTimeframeAnalysis(symbol?: string, timeframes?: string[]): Promise<{
  symbol: string;
  price: any;
  timeframes: TfAnalysis[];
  correlation: { aligned: boolean; direction: string; confidence: number; summary: string };
  signals: Signal[];
}> {
  await ensureConnected();
  const config = getMt5Config();
  const sym = symbol || config?.defaultSymbol || "XAUUSD";
  const tfs = timeframes || ["M15", "H1", "H4", "D1"];

  // Get price + all timeframes in parallel
  const [price, ...tfResults] = await Promise.all([
    getPrice(sym),
    ...tfs.map(tf => analyzeSingleTf(sym, tf)),
  ]);

  // Correlation analysis
  const bullishCount = tfResults.filter(t => t.trend === "bullish").length;
  const bearishCount = tfResults.filter(t => t.trend === "bearish").length;
  const aligned = bullishCount === tfs.length || bearishCount === tfs.length;
  const avgStrength = tfResults.reduce((s, t) => s + t.strength, 0) / tfs.length;

  let direction = "neutral";
  if (bullishCount > bearishCount) direction = "bullish";
  else if (bearishCount > bullishCount) direction = "bearish";

  const confidence = aligned ? 90 : Math.abs(bullishCount - bearishCount) >= 2 ? 70 : 50;

  // Generate multi-TF signals
  const signals: Signal[] = [];
  const currentPrice = price.bid;

  // All timeframes aligned
  if (aligned) {
    signals.push({
      type: direction === "bullish" ? "buy" : "sell",
      strategy: "mtf_aligned",
      price: currentPrice,
      details: `All ${tfs.length} timeframes ${direction} (${tfs.join("+")} aligned, confidence ${confidence}%)`,
    });
  }

  // Higher TF trend + lower TF pullback (best entry)
  const htf = tfResults[tfResults.length - 1]; // D1 or highest
  const ltf = tfResults[0]; // M15 or lowest
  if (htf.trend === "bullish" && ltf.rsi14 < 35) {
    signals.push({
      type: "buy",
      strategy: "mtf_pullback",
      price: currentPrice,
      details: `${htf.timeframe} bullish + ${ltf.timeframe} RSI oversold (${ltf.rsi14.toFixed(1)}) — pullback entry`,
    });
  }
  if (htf.trend === "bearish" && ltf.rsi14 > 65) {
    signals.push({
      type: "sell",
      strategy: "mtf_pullback",
      price: currentPrice,
      details: `${htf.timeframe} bearish + ${ltf.timeframe} RSI overbought (${ltf.rsi14.toFixed(1)}) — pullback entry`,
    });
  }

  // MACD divergence on H1
  const h1 = tfResults.find(t => t.timeframe === "H1");
  if (h1) {
    if (h1.macd.histogram > 0 && h1.trend === "bearish") {
      signals.push({ type: "alert", strategy: "macd_divergence", price: currentPrice, details: `H1 MACD bullish divergence (histogram +${h1.macd.histogram.toFixed(2)} vs bearish trend)` });
    }
    if (h1.macd.histogram < 0 && h1.trend === "bullish") {
      signals.push({ type: "alert", strategy: "macd_divergence", price: currentPrice, details: `H1 MACD bearish divergence (histogram ${h1.macd.histogram.toFixed(2)} vs bullish trend)` });
    }
  }

  // Bollinger squeeze (low volatility → breakout coming)
  for (const tf of tfResults) {
    const bbWidth = (tf.bollinger.upper - tf.bollinger.lower) / tf.bollinger.middle;
    if (bbWidth < 0.01) {
      signals.push({ type: "alert", strategy: "bb_squeeze", price: currentPrice, details: `${tf.timeframe} Bollinger squeeze (width ${(bbWidth * 100).toFixed(2)}%) — breakout imminent` });
    }
  }

  const summary = `${sym}: ${direction.toUpperCase()} (confidence ${confidence}%) | ${tfs.map((tf, i) => `${tf}:${tfResults[i].trend[0].toUpperCase()}`).join(" ")} | ${signals.length} signals`;

  // Store analysis log
  try {
    ensureMt5Tables();
    const db = getRawDb();
    db.prepare("INSERT INTO soul_mt5_analysis_log (symbol, timeframes, indicators, correlation, summary) VALUES (?, ?, ?, ?, ?)")
      .run(sym, JSON.stringify(tfs), JSON.stringify(tfResults.map(t => ({ tf: t.timeframe, trend: t.trend, strength: t.strength, rsi: t.rsi14 }))),
        JSON.stringify({ aligned, direction, confidence }), summary);
  } catch { /* ok */ }

  // Store signals
  if (signals.length > 0) {
    try {
      const db = getRawDb();
      const stmt = db.prepare("INSERT INTO soul_mt5_signals (symbol, signal_type, strategy, price, details) VALUES (?, ?, ?, ?, ?)");
      for (const s of signals) stmt.run(sym, s.type, s.strategy, s.price, s.details);
    } catch { /* ok */ }
  }

  return { symbol: sym, price, timeframes: tfResults, correlation: { aligned, direction, confidence, summary }, signals };
}

// ─── Signal Outcome Tracking ───

/**
 * Update a signal's outcome (did it profit?)
 */
export async function trackSignalOutcome(signalId: number, checkAfterMinutes: number = 60): Promise<any> {
  ensureMt5Tables();
  const db = getRawDb();
  const signal = db.prepare("SELECT * FROM soul_mt5_signals WHERE id = ?").get(signalId) as any;
  if (!signal) return { error: "Signal not found" };
  if (signal.outcome) return { error: "Already tracked" };

  const price = await getPrice(signal.symbol);
  const currentPrice = price.bid;
  const pips = signal.signal_type === "buy"
    ? currentPrice - signal.price
    : signal.price - currentPrice;

  const outcome = pips > 0 ? "win" : pips < 0 ? "loss" : "neutral";

  db.prepare("UPDATE soul_mt5_signals SET outcome = ?, outcome_price = ?, outcome_pips = ?, outcome_at = datetime('now') WHERE id = ?")
    .run(outcome, currentPrice, pips, signalId);

  // Update strategy stats
  db.prepare(`
    INSERT INTO soul_mt5_strategy_stats (strategy, symbol, timeframe, total_signals, wins, losses, avg_pips, win_rate, last_updated)
    VALUES (?, ?, 'H1', 1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(strategy, symbol, timeframe) DO UPDATE SET
      total_signals = total_signals + 1,
      wins = wins + excluded.wins,
      losses = losses + excluded.losses,
      avg_pips = (avg_pips * total_signals + excluded.avg_pips) / (total_signals + 1),
      win_rate = CAST(wins + excluded.wins AS REAL) / (total_signals + 1),
      last_updated = datetime('now')
  `).run(signal.strategy, signal.symbol, outcome === "win" ? 1 : 0, outcome === "loss" ? 1 : 0, pips, outcome === "win" ? 1.0 : 0.0);

  return { signalId, outcome, entryPrice: signal.price, currentPrice, pips: pips.toFixed(2), strategy: signal.strategy };
}

/**
 * Auto-track all untracked signals older than N minutes
 */
export async function autoTrackOutcomes(minAgeMinutes: number = 60): Promise<{ tracked: number; results: any[] }> {
  ensureMt5Tables();
  const db = getRawDb();
  const untracked = db.prepare(
    `SELECT id FROM soul_mt5_signals WHERE outcome IS NULL AND signal_type IN ('buy','sell') AND created_at < datetime('now', '-' || ? || ' minutes') ORDER BY created_at LIMIT 20`
  ).all(minAgeMinutes) as any[];

  const results: any[] = [];
  for (const row of untracked) {
    try {
      const r = await trackSignalOutcome(row.id);
      results.push(r);
    } catch { /* skip */ }
  }
  return { tracked: results.length, results };
}

/**
 * Get strategy statistics
 */
export function getStrategyStats(): any[] {
  ensureMt5Tables();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_mt5_strategy_stats ORDER BY win_rate DESC, total_signals DESC").all();
}

/**
 * Get analysis history
 */
export function getAnalysisHistory(limit: number = 10): any[] {
  ensureMt5Tables();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_mt5_analysis_log ORDER BY created_at DESC LIMIT ?").all(limit);
}

// ─── Enhanced Monitor with Auto-Learning ───

/**
 * Start smart monitoring — multi-TF analysis + auto-track outcomes + learn
 */
export async function startSmartMonitor(input: {
  symbol?: string;
  intervalSec?: number;
  telegramChannel?: string;
}): Promise<{ success: boolean; message: string }> {
  if (monitorInterval) {
    return { success: false, message: "Monitor already running. Stop it first." };
  }

  const config = getMt5Config();
  const symbol = input.symbol || config?.defaultSymbol || "XAUUSD";
  const intervalMs = (input.intervalSec || 300) * 1000; // default 5 min
  const channel = input.telegramChannel;

  monitorInterval = setInterval(async () => {
    try {
      // 1. Multi-timeframe analysis
      const analysis = await multiTimeframeAnalysis(symbol);

      // 2. Auto-track old signal outcomes
      await autoTrackOutcomes(60);

      // 3. Send alerts for high-confidence signals
      if (analysis.signals.length > 0 && channel) {
        const { sendMessage } = await import("./channels.js");

        // Get strategy stats for context
        const stats = getStrategyStats();
        const statsMap = new Map(stats.map((s: any) => [s.strategy, s]));

        const alertLines = [
          `🔔 ${symbol} Multi-TF Analysis`,
          `${analysis.correlation.summary}`,
          "",
          ...analysis.timeframes.map(tf => {
            const emoji = tf.trend === "bullish" ? "📈" : tf.trend === "bearish" ? "📉" : "➡️";
            return `${emoji} ${tf.timeframe}: ${tf.trend} (${tf.strength}%) | RSI ${tf.rsi14.toFixed(1)} | BB: ${tf.bollinger.position}`;
          }),
          "",
          "🔔 Signals:",
          ...analysis.signals.map(s => {
            const emoji = s.type === "buy" ? "📈" : s.type === "sell" ? "📉" : "⚠️";
            const stat = statsMap.get(s.strategy) as any;
            const winInfo = stat ? ` [WR: ${(stat.win_rate * 100).toFixed(0)}% / ${stat.total_signals} trades]` : "";
            return `${emoji} ${s.type.toUpperCase()} (${s.strategy})${winInfo}: ${s.details}`;
          }),
          "",
          `💰 Price: ${analysis.price.bid} | ATR: ${analysis.timeframes[1]?.atr?.toFixed(2) || "N/A"}`,
        ];

        await sendMessage(channel, alertLines.join("\n"));
      }
    } catch (err: any) {
      console.error("[MT5 SmartMonitor]", err.message);
    }
  }, intervalMs);

  return {
    success: true,
    message: `Smart monitoring ${symbol} every ${input.intervalSec || 300}s (multi-TF + auto-learn)${channel ? ` → alerts to ${channel}` : ""}`,
  };
}
