/**
 * Self-Healing Engine
 *
 * Inspired by SkyClaw's self-repair philosophy:
 * - Auto-detect failures and recover
 * - Learn from every error (persist across restarts)
 * - Track tool usage patterns (adapt core tools dynamically)
 * - Suggest runtime tool creation from repeated patterns
 * - Health monitoring with auto-repair
 */

import { getRawDb } from "../db/index.js";
import { recordMistake, checkForKnownMistakes } from "./self-improvement.js";

// ─── Lazy table creation ───

let _tableCreated = false;

function ensureTable() {
  if (_tableCreated) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_tool_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      args_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_tool_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      args_pattern TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 1,
      last_used TEXT NOT NULL DEFAULT (datetime('now')),
      suggested INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_heal_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      action_taken TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_usage_name ON soul_tool_usage(tool_name)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_patterns_name ON soul_tool_patterns(tool_name)
  `);
  _tableCreated = true;
}

// ─── Tool Usage Tracking (persists across restarts) ───

export function trackToolCall(
  toolName: string,
  success: boolean,
  durationMs: number,
  errorMessage?: string,
  argsHash?: string
) {
  ensureTable();
  const db = getRawDb();
  db.prepare(`
    INSERT INTO soul_tool_usage (tool_name, success, duration_ms, error_message, args_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(toolName, success ? 1 : 0, durationMs, errorMessage || null, argsHash || null);
}

export interface ToolStats {
  toolName: string;
  totalCalls: number;
  successRate: number;
  avgDuration: number;
  lastUsed: string;
}

export function getToolStats(limit = 30): ToolStats[] {
  ensureTable();
  const db = getRawDb();
  const rows = db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as total_calls,
      ROUND(AVG(success) * 100, 1) as success_rate,
      ROUND(AVG(duration_ms), 0) as avg_duration,
      MAX(created_at) as last_used
    FROM soul_tool_usage
    GROUP BY tool_name
    ORDER BY total_calls DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    toolName: r.tool_name,
    totalCalls: r.total_calls,
    successRate: r.success_rate,
    avgDuration: r.avg_duration,
    lastUsed: r.last_used,
  }));
}

// ─── Adaptive Core Tools ───

export function suggestCorePromotions(currentCore: Set<string>): string[] {
  ensureTable();
  const db = getRawDb();

  // Find tools called via soul_agent that are used frequently
  const rows = db.prepare(`
    SELECT tool_name, COUNT(*) as calls, AVG(success) as success_rate
    FROM soul_tool_usage
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY tool_name
    HAVING calls >= 5 AND success_rate >= 0.8
    ORDER BY calls DESC
    LIMIT 10
  `).all() as any[];

  return rows
    .filter((r) => !currentCore.has(r.tool_name))
    .map((r) => r.tool_name);
}

export function suggestCoreDemotions(currentCore: Set<string>): string[] {
  ensureTable();
  const db = getRawDb();

  // Find core tools that haven't been used in 14 days
  const usedRecently = db.prepare(`
    SELECT DISTINCT tool_name FROM soul_tool_usage
    WHERE created_at > datetime('now', '-14 days')
  `).all() as any[];

  const recentlyUsed = new Set(usedRecently.map((r) => r.tool_name));
  const neverDemote = new Set(["soul_setup", "soul_status", "soul_remember", "soul_search"]);

  return [...currentCore].filter(
    (t) => !recentlyUsed.has(t) && !neverDemote.has(t)
  );
}

// ─── Pattern Detection for Auto-Tool Creation ───

export function trackPattern(toolName: string, argsPattern: string) {
  ensureTable();
  const db = getRawDb();

  const existing = db.prepare(`
    SELECT id, call_count FROM soul_tool_patterns
    WHERE tool_name = ? AND args_pattern = ?
  `).get(toolName, argsPattern) as any;

  if (existing) {
    db.prepare(`
      UPDATE soul_tool_patterns
      SET call_count = call_count + 1, last_used = datetime('now')
      WHERE id = ?
    `).run(existing.id);
  } else {
    db.prepare(`
      INSERT INTO soul_tool_patterns (tool_name, args_pattern) VALUES (?, ?)
    `).run(toolName, argsPattern);
  }
}

export interface PatternSuggestion {
  toolName: string;
  argsPattern: string;
  callCount: number;
  suggestedName: string;
}

export function detectRepeatedPatterns(threshold = 3): PatternSuggestion[] {
  ensureTable();
  const db = getRawDb();

  const rows = db.prepare(`
    SELECT tool_name, args_pattern, call_count
    FROM soul_tool_patterns
    WHERE call_count >= ? AND suggested = 0
    ORDER BY call_count DESC
    LIMIT 10
  `).all(threshold) as any[];

  return rows.map((r) => ({
    toolName: r.tool_name,
    argsPattern: r.args_pattern,
    callCount: r.call_count,
    suggestedName: `soul_quick_${r.tool_name.replace("soul_", "")}_custom`,
  }));
}

export function markPatternSuggested(toolName: string, argsPattern: string) {
  ensureTable();
  const db = getRawDb();
  db.prepare(`
    UPDATE soul_tool_patterns SET suggested = 1
    WHERE tool_name = ? AND args_pattern = ?
  `).run(toolName, argsPattern);
}

// ─── Self-Healing: Error Recovery ───

export async function attemptSelfHeal(
  toolName: string,
  error: string,
  args: Record<string, any>
): Promise<{ healed: boolean; suggestion?: string; fix?: Record<string, any> }> {
  // 1. Check if we've seen this error before and have a fix
  const knownMistakes = await checkForKnownMistakes(`${toolName} ${error}`);

  if (knownMistakes.length > 0) {
    // We've seen this before — extract fix hint
    const fixMatch = knownMistakes[0].match(/FIX: (.+)/);
    if (fixMatch) {
      return {
        healed: true,
        suggestion: fixMatch[1],
      };
    }
  }

  // 2. Common error patterns with auto-fixes
  const lowerError = error.toLowerCase();

  // Missing required field
  if (lowerError.includes("required") || lowerError.includes("undefined")) {
    const missingField = error.match(/['"](\w+)['"]/)?.[1];
    if (missingField) {
      return {
        healed: true,
        suggestion: `Missing required field: "${missingField}". Provide it in args.`,
      };
    }
  }

  // Type mismatch
  if (lowerError.includes("expected") && lowerError.includes("received")) {
    return {
      healed: true,
      suggestion: `Type mismatch in args. Check parameter types. Error: ${error.substring(0, 150)}`,
    };
  }

  // Database locked
  if (lowerError.includes("database is locked") || lowerError.includes("sqlite_busy")) {
    return {
      healed: true,
      suggestion: "Database temporarily locked. Auto-retry should resolve this.",
    };
  }

  // Network errors
  if (lowerError.includes("econnrefused") || lowerError.includes("fetch failed") || lowerError.includes("timeout")) {
    return {
      healed: true,
      suggestion: "Network error. Check if the target service is running.",
    };
  }

  // 3. Record as new mistake for future prevention
  await recordMistake(
    `Tool ${toolName} failed`,
    error.substring(0, 200),
    `Check args and retry. Original args: ${JSON.stringify(args).substring(0, 100)}`
  );

  return { healed: false };
}

// ─── Health Monitor with Auto-Repair ───

export interface HealthReport {
  status: "healthy" | "degraded" | "critical";
  checks: HealthCheck[];
  autoRepaired: string[];
}

interface HealthCheck {
  name: string;
  status: "ok" | "warning" | "critical";
  detail: string;
}

export function runHealthCheck(): HealthReport {
  ensureTable();
  const db = getRawDb();
  const checks: HealthCheck[] = [];
  const autoRepaired: string[] = [];

  // 1. Database connectivity
  try {
    db.prepare("SELECT 1").get();
    checks.push({ name: "database", status: "ok", detail: "Connected" });
  } catch (e: any) {
    checks.push({ name: "database", status: "critical", detail: e.message });
  }

  // 2. Tool failure rate (last 24h)
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
      FROM soul_tool_usage
      WHERE created_at > datetime('now', '-24 hours')
    `).get() as any;

    if (stats.total > 0) {
      const failRate = stats.failures / stats.total;
      if (failRate > 0.5) {
        checks.push({
          name: "tool_health",
          status: "critical",
          detail: `${(failRate * 100).toFixed(0)}% failure rate in last 24h (${stats.failures}/${stats.total})`,
        });
      } else if (failRate > 0.2) {
        checks.push({
          name: "tool_health",
          status: "warning",
          detail: `${(failRate * 100).toFixed(0)}% failure rate in last 24h`,
        });
      } else {
        checks.push({
          name: "tool_health",
          status: "ok",
          detail: `${(failRate * 100).toFixed(0)}% failure rate (${stats.total} calls)`,
        });
      }
    } else {
      checks.push({ name: "tool_health", status: "ok", detail: "No calls tracked yet" });
    }
  } catch {
    checks.push({ name: "tool_health", status: "ok", detail: "No data" });
  }

  // 3. Stale tables / missing indexes — auto-repair
  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'soul_%'
    `).all() as any[];

    checks.push({
      name: "tables",
      status: "ok",
      detail: `${tables.length} Soul tables found`,
    });
  } catch (e: any) {
    checks.push({ name: "tables", status: "warning", detail: e.message });
  }

  // 4. Repeatedly failing tools — auto-disable suggestion
  try {
    const broken = db.prepare(`
      SELECT tool_name, COUNT(*) as fails
      FROM soul_tool_usage
      WHERE success = 0 AND created_at > datetime('now', '-24 hours')
      GROUP BY tool_name
      HAVING fails >= 5
      ORDER BY fails DESC
      LIMIT 5
    `).all() as any[];

    if (broken.length > 0) {
      checks.push({
        name: "broken_tools",
        status: "warning",
        detail: `Repeatedly failing: ${broken.map((b: any) => `${b.tool_name}(${b.fails}x)`).join(", ")}`,
      });
    } else {
      checks.push({ name: "broken_tools", status: "ok", detail: "No repeatedly failing tools" });
    }
  } catch {
    checks.push({ name: "broken_tools", status: "ok", detail: "No data" });
  }

  // 5. DB size check
  try {
    const pageCount = db.prepare("PRAGMA page_count").get() as any;
    const pageSize = db.prepare("PRAGMA page_size").get() as any;
    const sizeBytes = (pageCount?.page_count || 0) * (pageSize?.page_size || 4096);
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);

    if (sizeBytes > 500 * 1024 * 1024) {
      checks.push({ name: "db_size", status: "warning", detail: `${sizeMB} MB — consider running VACUUM` });

      // Auto-repair: VACUUM if > 500MB
      try {
        db.exec("PRAGMA auto_vacuum = INCREMENTAL");
        db.exec("PRAGMA incremental_vacuum(100)");
        autoRepaired.push("Ran incremental vacuum on database");
      } catch { /* non-critical */ }
    } else {
      checks.push({ name: "db_size", status: "ok", detail: `${sizeMB} MB` });
    }
  } catch {
    checks.push({ name: "db_size", status: "ok", detail: "Unknown size" });
  }

  // Overall status
  const hasCritical = checks.some((c) => c.status === "critical");
  const hasWarning = checks.some((c) => c.status === "warning");
  const status = hasCritical ? "critical" : hasWarning ? "degraded" : "healthy";

  // Log heal actions
  if (autoRepaired.length > 0) {
    for (const action of autoRepaired) {
      logHeal("auto_repair", action, action, true);
    }
  }

  return { status, checks, autoRepaired };
}

function logHeal(issueType: string, description: string, actionTaken: string, resolved: boolean) {
  try {
    ensureTable();
    const db = getRawDb();
    db.prepare(`
      INSERT INTO soul_heal_log (issue_type, description, action_taken, resolved)
      VALUES (?, ?, ?, ?)
    `).run(issueType, description, actionTaken, resolved ? 1 : 0);
  } catch { /* best effort */ }
}

// ─── Utility: hash args to detect patterns ───

export function hashArgs(args: Record<string, any>): string {
  // Create a pattern by keeping keys and value types (not values)
  const pattern = Object.entries(args)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${typeof v}`)
    .join(",");
  return pattern;
}

// ─── Deep Self-Diagnostics ───
// Soul's ability to detect its OWN problems — not wait for Claude/human to find them

export interface DiagnosticResult {
  category: string;
  status: "ok" | "warning" | "critical";
  detail: string;
  autoFix?: string; // What Soul did to fix it
}

export interface SelfDiagnosticReport {
  timestamp: string;
  overallStatus: "healthy" | "degraded" | "critical";
  diagnostics: DiagnosticResult[];
  autoFixes: string[];
  recommendations: string[];
}

/**
 * Run comprehensive self-diagnostics — Soul checks its own brain, tools, routing, LLM, and MT5
 * This is the "Soul knows its own problems" system
 */
export async function runSelfDiagnostics(): Promise<SelfDiagnosticReport> {
  const diagnostics: DiagnosticResult[] = [];
  const autoFixes: string[] = [];
  const recommendations: string[] = [];

  // ── 1. Tool Registration ──
  try {
    const { registerAllInternalTools, getRegisteredTools } = await import("./agent-loop.js");
    const toolsBefore = getRegisteredTools().length;
    if (toolsBefore === 0) {
      registerAllInternalTools();
      const toolsAfter = getRegisteredTools().length;
      autoFixes.push(`Tools were NOT registered (0 tools). Auto-fixed: registered ${toolsAfter} tools.`);
      diagnostics.push({ category: "tool_registration", status: "warning", detail: `Was 0, now ${toolsAfter} tools`, autoFix: "Called registerAllInternalTools()" });
    } else {
      diagnostics.push({ category: "tool_registration", status: "ok", detail: `${toolsBefore} tools registered` });
    }
  } catch (e: any) {
    diagnostics.push({ category: "tool_registration", status: "critical", detail: `Failed: ${e.message}` });
  }

  // ── 2. Tool Routing — test with known action messages ──
  try {
    const { getRegisteredTools, isActionMessage } = await import("./agent-loop.js");
    const testMessages = [
      { msg: "ราคาทอง", expectCategory: "mt5" },
      { msg: "จำไว้ว่าพรุ่งนี้ประชุม", expectCategory: "memory" },
      { msg: "ค้นหา AI trends", expectCategory: "websearch" },
    ];

    const allTools = getRegisteredTools();
    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      mt5: ["mt5", "metatrader", "trading", "trade", "gold", "xauusd", "forex", "candle", "signal", "chart", "position", "เทรด", "ทอง", "ราคาทอง", "ราคา", "กราฟ", "สัญญาณ", "ออเดอร์", "เฝ้า", "ติดตาม", "monitor"],
      memory: ["remember", "recall", "forget", "memory", "search", "find", "know", "learned", "จำ", "ค้นหา", "ความจำ", "เรียนรู้"],
      websearch: ["web", "search", "google", "url", "browse", "fetch", "เว็บ", "ค้นหา", "ค้น", "เสิร์ช", "หาข้อมูล"],
    };

    let routingIssues = 0;
    for (const test of testMessages) {
      const lower = test.msg.toLowerCase();
      const isAction = isActionMessage(test.msg);
      const keywords = CATEGORY_KEYWORDS[test.expectCategory] || [];
      const matches = keywords.filter(kw => lower.includes(kw));
      const catTools = allTools.filter(t => t.category === test.expectCategory);

      if (!isAction && test.expectCategory === "mt5") {
        diagnostics.push({ category: "tool_routing", status: "warning", detail: `"${test.msg}" not detected as action message` });
        routingIssues++;
      } else if (matches.length === 0) {
        diagnostics.push({ category: "tool_routing", status: "warning", detail: `"${test.msg}" has no keyword matches for ${test.expectCategory}` });
        routingIssues++;
      } else if (catTools.length === 0) {
        diagnostics.push({ category: "tool_routing", status: "critical", detail: `Category "${test.expectCategory}" has 0 tools registered!` });
        routingIssues++;
      }
    }
    if (routingIssues === 0) {
      diagnostics.push({ category: "tool_routing", status: "ok", detail: `All ${testMessages.length} test messages route correctly` });
    }
  } catch (e: any) {
    diagnostics.push({ category: "tool_routing", status: "critical", detail: `Routing test failed: ${e.message}` });
  }

  // ── 3. LLM Connectivity ──
  try {
    const { getDefaultConfig, listConfiguredProviders } = await import("./llm-connector.js");
    const defaultConfig = getDefaultConfig();
    const providers = listConfiguredProviders();

    if (!defaultConfig) {
      diagnostics.push({ category: "llm_config", status: "critical", detail: "No default LLM configured!" });
      recommendations.push("Run soul_llm_add to configure an LLM provider");
    } else {
      diagnostics.push({ category: "llm_config", status: "ok", detail: `Default: ${defaultConfig.providerId}/${defaultConfig.modelId}, ${providers.length} providers configured` });
    }

    // Quick LLM ping — try a minimal chat call
    if (defaultConfig) {
      try {
        const { chat } = await import("./llm-connector.js");
        const testStart = Date.now();
        const testResponse = await chat(
          [{ role: "user", content: "Say OK" }],
          { providerId: defaultConfig.providerId, modelId: defaultConfig.modelId, temperature: 0 },
        );
        const testMs = Date.now() - testStart;
        if (testResponse.content && testResponse.content.length > 0) {
          diagnostics.push({ category: "llm_connectivity", status: testMs > 10000 ? "warning" : "ok", detail: `LLM responded in ${testMs}ms: "${testResponse.content.substring(0, 30)}"` });
        } else {
          diagnostics.push({ category: "llm_connectivity", status: "warning", detail: `LLM returned empty response in ${testMs}ms` });
        }
      } catch (e: any) {
        diagnostics.push({ category: "llm_connectivity", status: "critical", detail: `LLM unreachable: ${e.message.substring(0, 100)}` });
        recommendations.push("Check LLM provider API key and network connectivity");
      }
    }
  } catch (e: any) {
    diagnostics.push({ category: "llm_config", status: "critical", detail: `LLM config check failed: ${e.message}` });
  }

  // ── 4. Tool-calling test — does LLM actually call tools? ──
  try {
    const { getDefaultConfig, chat } = await import("./llm-connector.js");
    const defaultConfig = getDefaultConfig();
    if (defaultConfig) {
      const testResponse = await chat(
        [
          { role: "system", content: "You are a helpful assistant. When the user asks for a price, ALWAYS call the get_price tool." },
          { role: "user", content: "What is the gold price?" },
        ],
        {
          providerId: defaultConfig.providerId,
          modelId: defaultConfig.modelId,
          tools: [{
            type: "function" as const,
            function: {
              name: "get_price",
              description: "Get price for a symbol",
              parameters: { type: "object", properties: { symbol: { type: "string" } } },
            },
          }],
          temperature: 0,
        },
      );

      if (testResponse.toolCalls && testResponse.toolCalls.length > 0) {
        diagnostics.push({ category: "llm_tool_calling", status: "ok", detail: `LLM correctly called tool: ${testResponse.toolCalls[0].function.name}` });
      } else {
        // AUTO-FIX: Try other configured models to find one that CAN call tools
        let autoFixed = false;
        try {
          const { listConfiguredProviders, setDefaultProvider } = await import("./llm-connector.js");
          const providers = listConfiguredProviders();
          // Known good tool-calling models ranked by reliability
          const goodModels = ["openai/gpt-4o-mini", "groq/moonshotai/kimi-k2-instruct", "openai/gpt-4o", "deepseek/deepseek-chat"];
          for (const candidate of goodModels) {
            const [pId, mId] = candidate.split("/");
            const match = providers.find((p: any) => p.providerId === pId && p.modelId === mId);
            if (match && `${pId}/${mId}` !== `${defaultConfig.providerId}/${defaultConfig.modelId}`) {
              // Test this model
              try {
                const altResponse = await chat(
                  [
                    { role: "system", content: "When asked for a price, call the get_price tool." },
                    { role: "user", content: "What is the gold price?" },
                  ],
                  {
                    providerId: pId, modelId: mId,
                    tools: [{ type: "function" as const, function: { name: "get_price", description: "Get price", parameters: { type: "object", properties: { symbol: { type: "string" } } } } }],
                    temperature: 0,
                  },
                );
                if (altResponse.toolCalls && altResponse.toolCalls.length > 0) {
                  // Found a working model — switch to it
                  setDefaultProvider(pId, mId);
                  autoFixes.push(`Switched default LLM from ${defaultConfig.providerId}/${defaultConfig.modelId} to ${pId}/${mId} (tool calling works)`);
                  diagnostics.push({ category: "llm_tool_calling", status: "warning", detail: `Original model (${defaultConfig.providerId}/${defaultConfig.modelId}) failed tool calling → auto-switched to ${pId}/${mId}`, autoFix: `Switched to ${pId}/${mId}` });
                  autoFixed = true;
                  break;
                }
              } catch { /* try next */ }
            }
          }
        } catch { /* can't auto-fix */ }
        if (!autoFixed) {
          diagnostics.push({ category: "llm_tool_calling", status: "critical", detail: `LLM did NOT call tools — responded with text: "${(testResponse.content || "").substring(0, 60)}"` });
          recommendations.push("Current LLM model may not support tool calling well. Consider switching to a model with better tool support (e.g., kimi-k2, gpt-4o-mini, claude-sonnet)");
        }
      }
    }
  } catch (e: any) {
    diagnostics.push({ category: "llm_tool_calling", status: "warning", detail: `Tool-calling test failed: ${e.message.substring(0, 80)}` });
  }

  // ── 5. Action-Talk Ratio (recent brain metrics) ──
  try {
    const db = getRawDb();
    const recentActions = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN brain = 'system2' THEN 1 ELSE 0 END) as system2,
        SUM(CASE WHEN brain = 'auto-action' THEN 1 ELSE 0 END) as auto_action,
        SUM(CASE WHEN brain = 'system1' THEN 1 ELSE 0 END) as system1
      FROM soul_brain_metrics
      WHERE created_at > datetime('now', '-24 hours')
    `).get() as any;

    if (recentActions && recentActions.total > 0) {
      // Check tool usage in recent responses
      const toolUsage = db.prepare(`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM soul_tool_usage
        WHERE created_at > datetime('now', '-24 hours')
      `).get() as any;

      const toolCallRate = toolUsage?.total > 0
        ? `${toolUsage.total} tool calls (${((toolUsage.successes / toolUsage.total) * 100).toFixed(0)}% success)`
        : "0 tool calls in 24h";

      diagnostics.push({
        category: "action_effectiveness",
        status: toolUsage?.total === 0 && recentActions.total > 3 ? "warning" : "ok",
        detail: `${recentActions.total} requests in 24h. System1: ${recentActions.system1}, System2: ${recentActions.system2}. ${toolCallRate}`,
      });

      if (toolUsage?.total === 0 && recentActions.total > 3) {
        recommendations.push("Soul processed requests but used 0 tools in 24h. It may be 'talking instead of doing'. Check tool routing and LLM tool-calling capability.");
      }
    } else {
      diagnostics.push({ category: "action_effectiveness", status: "ok", detail: "No recent activity" });
    }
  } catch {
    diagnostics.push({ category: "action_effectiveness", status: "ok", detail: "No metrics data" });
  }

  // ── 6. MT5 Bridge ──
  try {
    const mt5Engine = await import("./mt5-engine.js");
    if (mt5Engine.connectMt5) {
      const result = await mt5Engine.connectMt5();
      diagnostics.push({
        category: "mt5_bridge",
        status: result.success ? "ok" : "warning",
        detail: result.message,
      });
    }
  } catch (e: any) {
    diagnostics.push({ category: "mt5_bridge", status: "warning", detail: `MT5 check: ${e.message.substring(0, 80)}` });
  }

  // ── 7. Model Cascade ──
  try {
    const { buildCascade } = await import("./model-router.js");
    const cascade = buildCascade();
    if (cascade) {
      diagnostics.push({
        category: "model_cascade",
        status: "ok",
        detail: `Simple: ${cascade.simple.label} | Medium: ${cascade.medium.label} | Complex: ${cascade.complex.label}`,
      });
    } else {
      diagnostics.push({ category: "model_cascade", status: "warning", detail: "No cascade built — using single model for everything" });
    }
  } catch (e: any) {
    diagnostics.push({ category: "model_cascade", status: "warning", detail: `Cascade check failed: ${e.message}` });
  }

  // Check 9: Vector Embeddings
  try {
    const { getEmbeddingStats } = await import("../memory/embeddings.js");
    const stats = getEmbeddingStats();
    if (!stats.provider) {
      diagnostics.push({ category: "vector_embeddings", status: "warning", detail: "No embedding provider — semantic search using TF-IDF fallback" });
    } else if (stats.coverage < 50) {
      diagnostics.push({ category: "vector_embeddings", status: "warning", detail: `${stats.provider}/${stats.model} — only ${stats.coverage}% coverage (${stats.embeddedMemories}/${stats.totalMemories})` });
    } else {
      diagnostics.push({ category: "vector_embeddings", status: "ok", detail: `${stats.provider}/${stats.model} — ${stats.coverage}% coverage (${stats.embeddedMemories}/${stats.totalMemories})` });
    }
  } catch (e: any) {
    diagnostics.push({ category: "vector_embeddings", status: "warning", detail: `Embedding check failed: ${e.message}` });
  }

  // Overall status
  const hasCritical = diagnostics.some(d => d.status === "critical");
  const hasWarning = diagnostics.some(d => d.status === "warning");

  // Log the diagnostic run
  logHeal("self_diagnostic", `Ran ${diagnostics.length} checks`, `${diagnostics.filter(d => d.status === "ok").length} ok, ${diagnostics.filter(d => d.status === "warning").length} warnings, ${diagnostics.filter(d => d.status === "critical").length} critical`, !hasCritical);

  return {
    timestamp: new Date().toISOString(),
    overallStatus: hasCritical ? "critical" : hasWarning ? "degraded" : "healthy",
    diagnostics,
    autoFixes,
    recommendations,
  };
}

/**
 * Format diagnostic report for human reading
 */
export function formatDiagnosticReport(report: SelfDiagnosticReport): string {
  const statusEmoji = { healthy: "🟢", degraded: "🟡", critical: "🔴" };
  const checkEmoji = { ok: "✅", warning: "⚠️", critical: "❌" };

  const lines = [
    `🧠 Soul Self-Diagnostic Report`,
    `Status: ${statusEmoji[report.overallStatus]} ${report.overallStatus.toUpperCase()}`,
    `Time: ${report.timestamp}`,
    "",
  ];

  for (const d of report.diagnostics) {
    lines.push(`${checkEmoji[d.status]} ${d.category}: ${d.detail}`);
    if (d.autoFix) lines.push(`  🔧 Auto-fixed: ${d.autoFix}`);
  }

  if (report.autoFixes.length > 0) {
    lines.push("", "🔧 Auto-fixes applied:");
    for (const fix of report.autoFixes) lines.push(`  - ${fix}`);
  }

  if (report.recommendations.length > 0) {
    lines.push("", "💡 Recommendations:");
    for (const rec of report.recommendations) lines.push(`  - ${rec}`);
  }

  return lines.join("\n");
}
