/**
 * Trading Agents — Multi-agent trading team inspired by TauricResearch/TradingAgents
 *
 * Architecture:
 *   Analyst Team (4 agents):
 *     ├── Fundamentals Analyst → วิเคราะห์พื้นฐาน (GDP, ดอกเบี้ย, เงินเฟ้อ)
 *     ├── Sentiment Analyst    → วิเคราะห์อารมณ์ตลาด (Fear & Greed, social media)
 *     ├── News Analyst         → วิเคราะห์ข่าว (Fed, สงคราม, ภัยธรรมชาติ)
 *     └── Technical Analyst    → วิเคราะห์เทคนิค (trend, support, resistance)
 *
 *   Researcher Team (2 agents):
 *     ├── Bullish Researcher   → หาเหตุผลซื้อ
 *     └── Bearish Researcher   → หาเหตุผลขาย
 *     → ทั้ง 2 คน debate กัน!
 *
 *   Execution (3 agents):
 *     ├── Trader               → ตัดสินใจ BUY/SELL/HOLD
 *     ├── Risk Manager         → ตรวจ position size, stop loss
 *     └── Portfolio Manager    → อนุมัติ/ปฏิเสธ final decision
 *
 * All agents use web search + LLM to analyze. Results combined into one signal.
 */

import { getRawDb } from "../db/index.js";

interface AgentAnalysis {
  agent: string;
  role: string;
  analysis: string;
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0-100
  keyPoints: string[];
}

interface TeamDecision {
  symbol: string;
  finalDirection: "BUY" | "SELL" | "HOLD";
  confidence: number;
  price: number;
  analyses: AgentAnalysis[];
  debate: string;
  riskCheck: string;
  portfolioApproval: boolean;
  summary: string;
  timestamp: string;
}

/**
 * Run a single agent analysis via LLM
 */
async function runAgent(
  agentName: string,
  role: string,
  systemPrompt: string,
  userMessage: string,
): Promise<AgentAnalysis> {
  try {
    const { chat } = await import("./llm-connector.js");
    const response = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.3 });

    const text = response.content || "";

    // Extract direction
    let direction: "BUY" | "SELL" | "HOLD" = "HOLD";
    if (/BUY|ซื้อ|bullish|ขึ้น|long/i.test(text)) direction = "BUY";
    if (/SELL|ขาย|bearish|ลง|short/i.test(text)) direction = "SELL";

    // Extract confidence
    const confMatch = text.match(/(\d{1,3})%/);
    const confidence = confMatch ? parseInt(confMatch[1]) : 50;

    // Extract key points
    const points = text.match(/[-•*]\s*(.+)/g)?.map(p => p.replace(/^[-•*]\s*/, "").trim()) || [];

    return { agent: agentName, role, analysis: text.substring(0, 500), direction, confidence, keyPoints: points.slice(0, 3) };
  } catch (e: any) {
    return { agent: agentName, role, analysis: `Error: ${e.message}`, direction: "HOLD", confidence: 0, keyPoints: [] };
  }
}

/**
 * Run the full trading team analysis
 */
export async function runTradingTeam(symbol: string = "XAUUSD"): Promise<TeamDecision> {
  const timestamp = new Date().toISOString();
  let currentPrice = 0;

  // Get current price
  try {
    const mt5 = await import("./mt5-engine.js");
    const p = await mt5.getPrice(symbol);
    if (p?.price) currentPrice = p.price;
  } catch {}

  // Get latest news for context
  let newsContext = "";
  try {
    const { webSearch } = await import("./web-search.js");
    const news = await webSearch(`${symbol} market news today analysis`, { maxResults: 5 });
    newsContext = news.results.map(r => `- ${r.title}`).join("\n");
  } catch {}

  const context = `Symbol: ${symbol}\nPrice: $${currentPrice.toFixed(2)}\nDate: ${timestamp}\n\nLatest News:\n${newsContext || "No news available"}`;

  // ── Phase 1: Analyst Team (4 agents in parallel) ──
  const [fundamental, sentiment, newsAnalyst, technical] = await Promise.all([
    runAgent("Fundamentals", "Fundamentals Analyst", `You are a fundamentals analyst. Analyze macroeconomic factors for ${symbol}: GDP, interest rates, inflation, central bank policy. Give your directional view (BUY/SELL/HOLD) with confidence %. Respond in Thai. Be concise (max 200 words).`, context),
    runAgent("Sentiment", "Sentiment Analyst", `You are a market sentiment analyst. Analyze market sentiment for ${symbol}: Fear & Greed index, retail vs institutional positioning, social media sentiment. Give your directional view (BUY/SELL/HOLD) with confidence %. Respond in Thai. Be concise.`, context),
    runAgent("News", "News Analyst", `You are a news analyst. Analyze these headlines for ${symbol} impact. Identify catalysts, risks, and market-moving events. Give your directional view (BUY/SELL/HOLD) with confidence %. Respond in Thai. Be concise.`, context),
    runAgent("Technical", "Technical Analyst", `You are a technical analyst. Analyze ${symbol} price action: trend direction, support/resistance, momentum, volume. Give your directional view (BUY/SELL/HOLD) with confidence %. Respond in Thai. Be concise.`, context),
  ]);

  await new Promise(r => setTimeout(r, 2000)); // Rate limit pause

  // ── Phase 2: Researcher Debate (Bull vs Bear) ──
  const analystSummary = [fundamental, sentiment, newsAnalyst, technical]
    .map(a => `${a.agent}: ${a.direction} (${a.confidence}%) — ${a.keyPoints[0] || a.analysis.substring(0, 80)}`)
    .join("\n");

  const [bull, bear] = await Promise.all([
    runAgent("Bull", "Bullish Researcher", `You are the BULLISH researcher. The analyst team provided these views:\n${analystSummary}\n\nMake the strongest case for BUYING ${symbol}. Find every reason to be bullish. Respond in Thai. Max 150 words.`, context),
    runAgent("Bear", "Bearish Researcher", `You are the BEARISH researcher. The analyst team provided these views:\n${analystSummary}\n\nMake the strongest case for SELLING ${symbol}. Find every reason to be bearish. Respond in Thai. Max 150 words.`, context),
  ]);

  await new Promise(r => setTimeout(r, 2000));

  // ── Phase 3: Trader Decision ──
  const debateContext = `BULL case:\n${bull.analysis.substring(0, 300)}\n\nBEAR case:\n${bear.analysis.substring(0, 300)}`;

  const trader = await runAgent("Trader", "Head Trader", `You are the head trader making the final call on ${symbol}.

Analyst views:
${analystSummary}

Debate:
${debateContext}

Based on ALL evidence, make your decision: BUY, SELL, or HOLD.
Give confidence %, entry price, stop loss, take profit.
Respond in Thai. Be decisive — no "maybe".`, context);

  await new Promise(r => setTimeout(r, 2000));

  // ── Phase 4: Risk Manager Check ──
  const riskManager = await runAgent("Risk", "Risk Manager", `You are the risk manager reviewing this trade decision:
${trader.analysis.substring(0, 300)}

Check:
1. Is the risk/reward ratio acceptable (min 1:2)?
2. Is position size appropriate?
3. Is stop loss reasonable?
4. Any hidden risks from news?
APPROVE or REJECT with reason. Respond in Thai.`, context);

  await new Promise(r => setTimeout(r, 2000));

  // ── Phase 5: Portfolio Manager Approval ──
  const pmApproval = await runAgent("PM", "Portfolio Manager", `You are the portfolio manager. Final approval needed.
Trader wants: ${trader.direction} ${symbol} at $${currentPrice}
Risk manager: ${riskManager.analysis.substring(0, 200)}
Team consensus: ${[fundamental, sentiment, newsAnalyst, technical].filter(a => a.direction === trader.direction).length}/4 analysts agree

APPROVE or REJECT. One word + one sentence reason. Thai.`, context);

  const approved = /APPROVE|อนุมัติ|ผ่าน|เห็นด้วย/i.test(pmApproval.analysis);

  // ── Compile Final Decision ──
  const analyses = [fundamental, sentiment, newsAnalyst, technical, bull, bear, trader, riskManager, pmApproval];

  // Calculate team confidence (weighted average)
  const teamConfidence = Math.round(
    (fundamental.confidence * 0.2 + sentiment.confidence * 0.15 +
     newsAnalyst.confidence * 0.15 + technical.confidence * 0.2 +
     trader.confidence * 0.3) / 1
  );

  const decision: TeamDecision = {
    symbol,
    finalDirection: approved ? trader.direction : "HOLD",
    confidence: approved ? teamConfidence : 30,
    price: currentPrice,
    analyses,
    debate: debateContext,
    riskCheck: riskManager.analysis.substring(0, 300),
    portfolioApproval: approved,
    summary: "",
    timestamp,
  };

  // Build summary
  const lines: string[] = [];
  lines.push(`🏢 Soul Trading Team — ${symbol}`);
  lines.push(`📅 ${timestamp.substring(0, 16)}`);
  lines.push(`💰 Price: $${currentPrice.toFixed(2)}`);
  lines.push("");
  lines.push("📊 Analyst Team:");
  lines.push(`  ${fundamental.direction === "BUY" ? "🟢" : fundamental.direction === "SELL" ? "🔴" : "⚪"} Fundamentals: ${fundamental.direction} (${fundamental.confidence}%)`);
  lines.push(`  ${sentiment.direction === "BUY" ? "🟢" : sentiment.direction === "SELL" ? "🔴" : "⚪"} Sentiment: ${sentiment.direction} (${sentiment.confidence}%)`);
  lines.push(`  ${newsAnalyst.direction === "BUY" ? "🟢" : newsAnalyst.direction === "SELL" ? "🔴" : "⚪"} News: ${newsAnalyst.direction} (${newsAnalyst.confidence}%)`);
  lines.push(`  ${technical.direction === "BUY" ? "🟢" : technical.direction === "SELL" ? "🔴" : "⚪"} Technical: ${technical.direction} (${technical.confidence}%)`);
  lines.push("");
  lines.push("🔬 Research Debate:");
  lines.push(`  🐂 Bull: ${bull.keyPoints[0] || bull.analysis.substring(0, 60)}`);
  lines.push(`  🐻 Bear: ${bear.keyPoints[0] || bear.analysis.substring(0, 60)}`);
  lines.push("");
  lines.push(`🎯 Trader Decision: ${trader.direction} (${trader.confidence}%)`);
  lines.push(`🛡️ Risk Manager: ${/APPROVE|อนุมัติ/i.test(riskManager.analysis) ? "✅ APPROVED" : "⚠️ CONCERNS"}`);
  lines.push(`👔 Portfolio Manager: ${approved ? "✅ APPROVED" : "❌ REJECTED"}`);
  lines.push("");
  lines.push(`══════════════════════`);
  lines.push(`FINAL: ${decision.finalDirection === "BUY" ? "🟢 BUY" : decision.finalDirection === "SELL" ? "🔴 SELL" : "⚪ HOLD"} ${symbol} | Confidence: ${decision.confidence}%`);
  if (!approved) lines.push("⚠️ Trade NOT approved by portfolio manager");
  lines.push(`══════════════════════`);
  lines.push("\n⚠️ ไม่ใช่คำแนะนำการลงทุน — ใช้วิจารณญาณของตัวเอง");

  decision.summary = lines.join("\n");

  // Save to journal
  try {
    const { recordSignal } = await import("./trading-signal.js");
    recordSignal({
      symbol,
      direction: decision.finalDirection === "HOLD" ? "NEUTRAL" : decision.finalDirection,
      confidence: decision.confidence,
      price: currentPrice,
      reasons: analyses.map(a => `${a.agent}: ${a.direction} (${a.confidence}%)`),
      newsCorrelation: newsContext,
      timeframes: ["multi-agent"],
      strategy: "trading_agents_team",
      validated: approved,
    });
  } catch {}

  // Send to Telegram if approved
  if (approved && decision.finalDirection !== "HOLD") {
    try {
      const { sendMessage, listChannels } = await import("./channels.js");
      const channels = await listChannels();
      for (const ch of channels) {
        if (ch.channelType === "telegram" && ch.isActive) {
          await sendMessage(ch.name, decision.summary);
          break;
        }
      }
    } catch {}
  }

  return decision;
}
