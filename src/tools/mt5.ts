/**
 * MT5 Tools — MetaTrader 5 MCP tools for Soul
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  configureMt5,
  connectMt5,
  disconnectMt5,
  getPrice,
  getCandles,
  getAccountInfo,
  getPositions,
  analyzeChart,
  startMonitor,
  stopMonitor,
  getRecentSignals,
  getMt5Status,
  multiTimeframeAnalysis,
  startSmartMonitor,
  getStrategyStats,
  autoTrackOutcomes,
  getAnalysisHistory,
} from "../core/mt5-engine.js";

export function registerMt5Tools(server: McpServer) {

  server.tool(
    "soul_mt5_setup",
    "Configure MT5 connection — store account, password (encrypted), and server.",
    {
      account: z.string().describe("MT5 account number"),
      password: z.string().describe("MT5 password (will be encrypted)"),
      server: z.string().describe("MT5 server name (e.g. Exness-MT5Real7)"),
      mt5Path: z.string().optional().describe("Path to MT5 terminal64.exe (auto-detect if omitted)"),
      defaultSymbol: z.string().default("XAUUSD").describe("Default symbol to track"),
    },
    async ({ account, password, server: srv, mt5Path, defaultSymbol }) => {
      const result = configureMt5({ account, password, server: srv, mt5Path, defaultSymbol });
      return { content: [{ type: "text" as const, text: result.message }] };
    }
  );

  server.tool(
    "soul_mt5_connect",
    "Connect to MT5 terminal — spawns Python bridge and logs in.",
    {},
    async () => {
      const result = await connectMt5();
      let text = result.message;
      if (result.account) {
        const a = result.account;
        text += `\nBalance: ${a.balance} ${a.currency} | Equity: ${a.equity} | Leverage: 1:${a.leverage}`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_mt5_disconnect",
    "Disconnect from MT5.",
    {},
    async () => {
      await disconnectMt5();
      return { content: [{ type: "text" as const, text: "MT5 disconnected." }] };
    }
  );

  server.tool(
    "soul_mt5_status",
    "Check MT5 connection status.",
    {},
    async () => {
      const status = getMt5Status();
      const lines = [
        `MT5 Status:`,
        `  Connected: ${status.connected ? "✅" : "❌"}`,
        `  Monitoring: ${status.monitoring ? "✅" : "❌"}`,
        `  Config saved: ${status.config ? "✅" : "❌"}`,
      ];
      if (status.connected) {
        try {
          const acc = await getAccountInfo();
          lines.push(`  Account: ${acc.login} @ ${acc.server}`);
          lines.push(`  Balance: ${acc.balance} ${acc.currency} | Equity: ${acc.equity}`);
          lines.push(`  Profit: ${acc.profit} | Free margin: ${acc.free_margin}`);
        } catch { /* ok */ }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "soul_mt5_price",
    "Get real-time price for a symbol (default XAUUSD).",
    {
      symbol: z.string().default("XAUUSD").describe("Trading symbol"),
    },
    async ({ symbol }) => {
      const price = await getPrice(symbol);
      return { content: [{ type: "text" as const, text:
        `${symbol}: Bid ${price.bid} | Ask ${price.ask} | Spread ${price.spread}\nTime: ${price.time}`
      }] };
    }
  );

  server.tool(
    "soul_mt5_candles",
    "Get candle/OHLCV data for chart analysis.",
    {
      symbol: z.string().default("XAUUSD").describe("Trading symbol"),
      timeframe: z.string().default("H1").describe("Timeframe: M1, M5, M15, M30, H1, H4, D1, W1"),
      count: z.number().default(20).describe("Number of candles"),
    },
    async ({ symbol, timeframe, count }) => {
      const data = await getCandles(symbol, timeframe, count);
      const lines = [`${symbol} ${timeframe} — ${data.count} candles:`, ""];
      for (const c of data.candles.slice(-count)) {
        lines.push(`${c.time} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "soul_mt5_analyze",
    "Analyze chart with technical indicators (SMA, RSI, Support/Resistance) and generate trading signals.",
    {
      symbol: z.string().default("XAUUSD").describe("Trading symbol"),
      timeframe: z.string().default("H1").describe("Timeframe"),
    },
    async ({ symbol, timeframe }) => {
      const analysis = await analyzeChart(symbol, timeframe);
      const lines = [
        `📊 ${analysis.symbol} ${analysis.timeframe} Analysis`,
        `💰 Price: ${analysis.price.bid} / ${analysis.price.ask}`,
        "",
        `📈 Indicators:`,
        `  SMA(9): ${analysis.indicators.sma9?.toFixed(2)}`,
        `  SMA(21): ${analysis.indicators.sma21?.toFixed(2)}`,
        `  RSI(14): ${analysis.indicators.rsi14?.toFixed(1)}`,
        `  Support: ${analysis.indicators.support?.toFixed(2)}`,
        `  Resistance: ${analysis.indicators.resistance?.toFixed(2)}`,
      ];

      if (analysis.signals.length > 0) {
        lines.push("", "🔔 Signals:");
        for (const s of analysis.signals) {
          const emoji = s.type === "buy" ? "📈" : s.type === "sell" ? "📉" : "⚠️";
          lines.push(`  ${emoji} ${s.type.toUpperCase()} (${s.strategy}): ${s.details}`);
        }
      } else {
        lines.push("", "No signals at this time.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "soul_mt5_positions",
    "Show open trading positions.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
    },
    async ({ symbol }) => {
      const data = await getPositions(symbol);
      if (data.count === 0) {
        return { content: [{ type: "text" as const, text: "No open positions." }] };
      }
      const lines = [`Open Positions (${data.count}):`, ""];
      for (const p of data.positions) {
        const emoji = p.type === "buy" ? "📈" : "📉";
        const profitEmoji = p.profit >= 0 ? "✅" : "❌";
        lines.push(`${emoji} ${p.symbol} ${p.type.toUpperCase()} ${p.volume} lot @ ${p.open_price} → ${p.current_price} ${profitEmoji} ${p.profit}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "soul_mt5_monitor",
    "Start/stop real-time price monitoring with Telegram alerts.",
    {
      action: z.enum(["start", "stop"]).describe("start or stop"),
      symbol: z.string().default("XAUUSD").describe("Symbol to monitor"),
      intervalSec: z.number().default(60).describe("Check interval in seconds"),
      telegramChannel: z.string().optional().describe("Telegram channel name for alerts"),
    },
    async ({ action, symbol, intervalSec, telegramChannel }) => {
      if (action === "start") {
        const result = await startMonitor({ symbol, intervalSec, telegramChannel });
        return { content: [{ type: "text" as const, text: result.message }] };
      } else {
        const result = stopMonitor();
        return { content: [{ type: "text" as const, text: result.message }] };
      }
    }
  );

  server.tool(
    "soul_mt5_signals",
    "List recent trading signals.",
    {
      limit: z.number().default(10).describe("Number of signals to show"),
    },
    async ({ limit }) => {
      const signals = getRecentSignals(limit);
      if (signals.length === 0) {
        return { content: [{ type: "text" as const, text: "No signals yet. Use soul_mt5_analyze to generate signals." }] };
      }
      const lines = [`Recent Signals (${signals.length}):`, ""];
      for (const s of signals as any[]) {
        const emoji = s.signal_type === "buy" ? "📈" : s.signal_type === "sell" ? "📉" : "⚠️";
        lines.push(`${s.created_at} | ${emoji} ${s.symbol} ${s.signal_type.toUpperCase()} @ ${s.price} — ${s.details}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
