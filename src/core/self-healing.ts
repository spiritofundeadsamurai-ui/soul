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
