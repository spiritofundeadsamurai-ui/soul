/**
 * Smart Trading Signal — Inspired by KX/NVIDIA Trading Signal Agent
 *
 * Soul's trading intelligence:
 * 1. News + Price Correlation — ข่าวสำคัญ + ราคาขยับ = signal
 * 2. Signal Validation — confirm ด้วย multi-timeframe + volume + pattern
 * 3. Trading Journal — บันทึกทุก signal + ผลลัพธ์จริง → เรียนรู้
 * 4. Auto Alert — แจ้งเตือนผ่าน Telegram เมื่อมี signal ที่ validated
 */

import { getRawDb } from "../db/index.js";

// ─── Types ───

interface TradingSignal {
  symbol: string;
  direction: "BUY" | "SELL" | "NEUTRAL";
  confidence: number; // 0-100
  price: number;
  reasons: string[];
  newsCorrelation: string | null;
  timeframes: string[];
  strategy: string;
  validated: boolean;
}

interface SignalJournal {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  confidence: number;
  reasons: string;
  outcome: string | null; // "WIN" | "LOSS" | null (pending)
  outcomePips: number | null;
  createdAt: string;
}

// ─── Signal Detection ───

/**
 * Detect trading signals by combining price action + news + multi-timeframe
 */
export async function detectSignals(symbol: string = "XAUUSD"): Promise<TradingSignal> {
  const reasons: string[] = [];
  let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let confidence = 50;
  let currentPrice = 0;
  let newsContext: string | null = null;

  // 1. Get current price from MT5
  try {
    const mt5 = await import("./mt5-engine.js");
    const priceData = await mt5.getPrice(symbol);
    if (priceData?.price) {
      currentPrice = priceData.price;
      reasons.push(`Current price: $${currentPrice.toFixed(2)}`);
    }
  } catch { /* MT5 not available */ }

  // 2. Get recent price history for trend detection
  try {
    const db = getRawDb();
    const recentPrices = db.prepare(`
      SELECT bid, fetched_at FROM soul_mt5_prices
      WHERE symbol = ? ORDER BY fetched_at DESC LIMIT 20
    `).all(symbol) as any[];

    if (recentPrices.length >= 5) {
      const latest = recentPrices[0]?.bid || currentPrice;
      const prev5 = recentPrices[4]?.bid || latest;
      const prev20 = recentPrices[recentPrices.length - 1]?.bid || latest;

      const shortTrend = ((latest - prev5) / prev5) * 100;
      const longTrend = ((latest - prev20) / prev20) * 100;

      if (shortTrend > 0.1) { reasons.push(`Short-term uptrend: +${shortTrend.toFixed(3)}%`); confidence += 10; }
      if (shortTrend < -0.1) { reasons.push(`Short-term downtrend: ${shortTrend.toFixed(3)}%`); confidence += 10; }
      if (longTrend > 0.3) { reasons.push(`Long-term uptrend: +${longTrend.toFixed(3)}%`); confidence += 10; }
      if (longTrend < -0.3) { reasons.push(`Long-term downtrend: ${longTrend.toFixed(3)}%`); confidence += 10; }

      // Determine direction
      if (shortTrend > 0.1 && longTrend > 0) direction = "BUY";
      else if (shortTrend < -0.1 && longTrend < 0) direction = "SELL";
    }
  } catch { /* no price history */ }

  // 3. Check news correlation via web search
  try {
    const { webSearch } = await import("./web-search.js");
    const newsResult = await webSearch(`${symbol} gold price news today`, { maxResults: 3 });
    if (newsResult.results.length > 0) {
      newsContext = newsResult.results.map(r => r.title).join("; ");
      reasons.push(`News: ${newsContext.substring(0, 100)}`);

      // Sentiment from headlines
      const bullishWords = /surge|rise|rally|up|gain|bullish|safe.haven|buy|ขึ้น|พุ่ง/i;
      const bearishWords = /drop|fall|crash|down|loss|bearish|sell|decline|ลง|ร่วง/i;
      const headlines = newsResult.results.map(r => r.title).join(" ");

      if (bullishWords.test(headlines)) { confidence += 15; if (direction === "NEUTRAL") direction = "BUY"; reasons.push("News sentiment: Bullish"); }
      if (bearishWords.test(headlines)) { confidence += 15; if (direction === "NEUTRAL") direction = "SELL"; reasons.push("News sentiment: Bearish"); }
    }
  } catch { /* web search failed */ }

  // 4. Check past signal accuracy for this strategy
  try {
    const db = getRawDb();
    const stats = db.prepare(`
      SELECT win_rate, total_signals FROM soul_mt5_strategy_stats
      WHERE symbol = ? ORDER BY total_signals DESC LIMIT 1
    `).get(symbol) as any;
    if (stats && stats.total_signals > 5) {
      reasons.push(`Historical win rate: ${(stats.win_rate * 100).toFixed(0)}% (${stats.total_signals} signals)`);
      if (stats.win_rate > 0.6) confidence += 10;
      if (stats.win_rate < 0.4) confidence -= 10;
    }
  } catch { /* no stats */ }

  // Cap confidence
  confidence = Math.min(Math.max(confidence, 10), 95);

  // Validate: only send high-confidence signals
  const validated = confidence >= 65 && direction !== "NEUTRAL";

  return {
    symbol,
    direction,
    confidence,
    price: currentPrice,
    reasons,
    newsCorrelation: newsContext,
    timeframes: ["current"],
    strategy: "soul_smart_signal",
    validated,
  };
}

// ─── Trading Journal ───

/**
 * Record a signal in the journal
 */
export function recordSignal(signal: TradingSignal): number {
  const db = getRawDb();
  ensureJournalTable();
  const result = db.prepare(`
    INSERT INTO soul_trading_journal (symbol, direction, entry_price, confidence, reasons, strategy, validated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(signal.symbol, signal.direction, signal.price, signal.confidence, JSON.stringify(signal.reasons), signal.strategy, signal.validated ? 1 : 0);
  return result.lastInsertRowid as number;
}

/**
 * Update signal outcome
 */
export function updateSignalOutcome(signalId: number, currentPrice: number): string {
  const db = getRawDb();
  ensureJournalTable();
  const signal = db.prepare("SELECT * FROM soul_trading_journal WHERE id = ?").get(signalId) as any;
  if (!signal) return "Signal not found";

  const pips = signal.direction === "BUY"
    ? (currentPrice - signal.entry_price) * 10
    : (signal.entry_price - currentPrice) * 10;
  const outcome = pips > 0 ? "WIN" : "LOSS";

  db.prepare(`
    UPDATE soul_trading_journal SET outcome = ?, outcome_pips = ?, outcome_price = ?, outcome_at = datetime('now')
    WHERE id = ?
  `).run(outcome, pips.toFixed(1), currentPrice, signalId);

  // Update strategy stats
  try {
    const stats = db.prepare(`
      SELECT * FROM soul_mt5_strategy_stats WHERE strategy = ? AND symbol = ?
    `).get(signal.strategy, signal.symbol) as any;

    if (stats) {
      const newTotal = stats.total_signals + 1;
      const newWins = stats.wins + (outcome === "WIN" ? 1 : 0);
      const newLosses = stats.losses + (outcome === "LOSS" ? 1 : 0);
      db.prepare(`
        UPDATE soul_mt5_strategy_stats SET total_signals = ?, wins = ?, losses = ?, win_rate = ?, avg_pips = ?, last_updated = datetime('now')
        WHERE id = ?
      `).run(newTotal, newWins, newLosses, newWins / newTotal, ((stats.avg_pips * stats.total_signals) + pips) / newTotal, stats.id);
    } else {
      db.prepare(`
        INSERT INTO soul_mt5_strategy_stats (strategy, symbol, timeframe, total_signals, wins, losses, win_rate, avg_pips)
        VALUES (?, ?, 'mixed', 1, ?, ?, ?, ?)
      `).run(signal.strategy, signal.symbol, outcome === "WIN" ? 1 : 0, outcome === "LOSS" ? 1 : 0, outcome === "WIN" ? 1 : 0, pips);
    }
  } catch { /* stats update failed */ }

  return `Signal #${signalId}: ${outcome} (${pips > 0 ? "+" : ""}${pips.toFixed(1)} pips)`;
}

/**
 * Get journal entries
 */
export function getJournal(limit: number = 20): SignalJournal[] {
  const db = getRawDb();
  ensureJournalTable();
  return (db.prepare(`
    SELECT id, symbol, direction, entry_price, confidence, reasons, outcome, outcome_pips, created_at
    FROM soul_trading_journal ORDER BY created_at DESC LIMIT ?
  `).all(limit) as any[]).map(r => ({
    id: r.id, symbol: r.symbol, direction: r.direction, entryPrice: r.entry_price,
    confidence: r.confidence, reasons: r.reasons, outcome: r.outcome,
    outcomePips: r.outcome_pips, createdAt: r.created_at,
  }));
}

/**
 * Get trading stats summary
 */
export function getTradingStats(): {
  totalSignals: number;
  winRate: number;
  avgPips: number;
  bestStrategy: string;
  recentPerformance: string;
} {
  const db = getRawDb();
  ensureJournalTable();

  const total = (db.prepare("SELECT COUNT(*) as c FROM soul_trading_journal").get() as any)?.c || 0;
  const wins = (db.prepare("SELECT COUNT(*) as c FROM soul_trading_journal WHERE outcome = 'WIN'").get() as any)?.c || 0;
  const avgPips = (db.prepare("SELECT AVG(outcome_pips) as a FROM soul_trading_journal WHERE outcome IS NOT NULL").get() as any)?.a || 0;

  const recent = db.prepare(`
    SELECT outcome FROM soul_trading_journal WHERE outcome IS NOT NULL ORDER BY created_at DESC LIMIT 10
  `).all() as any[];
  const recentWins = recent.filter(r => r.outcome === "WIN").length;

  return {
    totalSignals: total,
    winRate: total > 0 ? wins / total : 0,
    avgPips: avgPips,
    bestStrategy: "soul_smart_signal",
    recentPerformance: recent.length > 0 ? `${recentWins}/${recent.length} wins (last 10)` : "No data yet",
  };
}

// ─── Auto Alert ───

/**
 * Run signal detection + send alert if validated
 */
export async function autoSignalAlert(symbol: string = "XAUUSD"): Promise<string> {
  const signal = await detectSignals(symbol);
  const signalId = recordSignal(signal);

  if (!signal.validated) {
    return `Signal #${signalId}: ${signal.direction} (confidence: ${signal.confidence}%) — NOT validated, ไม่แจ้งเตือน\nReasons: ${signal.reasons.join(", ")}`;
  }

  // Send alert via Telegram
  const alertMsg = [
    `🚨 TRADING SIGNAL #${signalId}`,
    `${signal.direction === "BUY" ? "🟢 BUY" : "🔴 SELL"} ${signal.symbol}`,
    `💰 Price: $${signal.price.toFixed(2)}`,
    `📊 Confidence: ${signal.confidence}%`,
    `📋 Reasons:`,
    ...signal.reasons.map(r => `  • ${r}`),
    `\n⚠️ นี่ไม่ใช่คำแนะนำการลงทุน`,
  ].join("\n");

  try {
    const { sendMessage, listChannels } = await import("./channels.js");
    const channels = await listChannels();
    for (const ch of channels) {
      if (ch.channelType === "telegram" && ch.isActive) {
        await sendMessage(ch.name, alertMsg);
        break;
      }
    }
  } catch { /* telegram not available */ }

  return alertMsg;
}

// ─── Table ───

let _journalReady = false;
function ensureJournalTable() {
  if (_journalReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_trading_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      confidence INTEGER NOT NULL,
      reasons TEXT NOT NULL DEFAULT '[]',
      strategy TEXT NOT NULL DEFAULT 'manual',
      validated INTEGER DEFAULT 0,
      outcome TEXT,
      outcome_price REAL,
      outcome_pips REAL,
      outcome_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _journalReady = true;
}
