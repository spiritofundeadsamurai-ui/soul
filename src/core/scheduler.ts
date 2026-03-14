/**
 * Scheduler Engine — Soul's proactive heartbeat system
 *
 * Learned from OpenClaw (รุ่นพี่):
 * 1. Cron-like scheduled jobs
 * 2. Heartbeat system — periodic self-checks
 * 3. Morning briefing — daily summary for master
 * 4. Self-healing — detect and fix issues automatically
 * 5. Memory consolidation — auto-merge daily memories
 * 6. Quality tracking — daily self-evaluation
 * 7. Security audit — weekly automated check
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch, getMemoryStats, getRecentMemories } from "../memory/memory-engine.js";
import { getLearnings } from "../memory/learning.js";
import { pushNotification } from "./notification.js";
import { anticipateNeeds } from "./awareness.js";

// ============================================
// 1. SCHEDULED JOBS
// ============================================

export interface ScheduledJob {
  id: number;
  name: string;
  description: string;
  schedule: string; // cron expression
  jobType: "heartbeat" | "briefing" | "health" | "memory" | "custom";
  payload: string; // what to do
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
}

function ensureSchedulerTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      schedule TEXT NOT NULL,
      job_type TEXT NOT NULL DEFAULT 'custom',
      payload TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_status TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      output TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES soul_jobs(id)
    );
  `);
}

export async function createJob(input: {
  name: string;
  description: string;
  schedule: string;
  jobType?: string;
  payload?: string;
}): Promise<ScheduledJob> {
  ensureSchedulerTables();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_jobs (name, description, schedule, job_type, payload)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.name,
      input.description,
      input.schedule,
      input.jobType || "custom",
      input.payload || ""
    ) as any;

  return mapJob(row);
}

export async function listJobs(enabledOnly = false): Promise<ScheduledJob[]> {
  ensureSchedulerTables();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_jobs";
  if (enabledOnly) query += " WHERE enabled = 1";
  query += " ORDER BY job_type, name";

  const rows = rawDb.prepare(query).all() as any[];
  return rows.map(mapJob);
}

export async function toggleJob(jobId: number, enabled: boolean): Promise<ScheduledJob | null> {
  ensureSchedulerTables();
  const rawDb = getRawDb();

  rawDb.prepare("UPDATE soul_jobs SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, jobId);

  const row = rawDb.prepare("SELECT * FROM soul_jobs WHERE id = ?").get(jobId) as any;
  return row ? mapJob(row) : null;
}

export async function logJobRun(
  jobId: number,
  status: string,
  output: string,
  durationMs: number
): Promise<void> {
  ensureSchedulerTables();
  const rawDb = getRawDb();

  rawDb
    .prepare(
      `INSERT INTO soul_job_runs (job_id, status, output, duration_ms) VALUES (?, ?, ?, ?)`
    )
    .run(jobId, status, output, durationMs);

  rawDb
    .prepare(
      `UPDATE soul_jobs SET last_run_at = datetime('now'), last_status = ?, run_count = run_count + 1 WHERE id = ?`
    )
    .run(status, jobId);
}

// ============================================
// 2. MORNING BRIEFING
// ============================================

export async function generateBriefing(): Promise<string> {
  const stats = await getMemoryStats();
  const recent = await getRecentMemories(10);
  const proactive = await anticipateNeeds();

  let briefing = `=== Soul Morning Briefing ===\n\n`;
  briefing += `Date: ${new Date().toISOString().split("T")[0]}\n\n`;

  // Memory stats
  briefing += `Memory Status: ${stats.total} active memories\n`;
  briefing += `  Conversations: ${stats.conversations} | Knowledge: ${stats.knowledge} | Wisdom: ${stats.wisdom}\n\n`;

  // Recent activity
  if (recent.length > 0) {
    briefing += `Recent Activity:\n`;
    recent.slice(0, 5).forEach((m) => {
      briefing += `  - [${m.type}] ${m.content.substring(0, 80)}\n`;
    });
    briefing += `\n`;
  }

  // Proactive suggestions
  briefing += proactive + "\n";

  // Active jobs
  const jobs = await listJobs(true);
  if (jobs.length > 0) {
    briefing += `\nActive Jobs: ${jobs.length}\n`;
    jobs.slice(0, 5).forEach((j) => {
      briefing += `  - ${j.name}: ${j.lastStatus || "never run"} (${j.runCount} runs)\n`;
    });
  }

  return briefing;
}

// ============================================
// 3. SELF-HEALING HEALTH CHECK
// ============================================

export async function healthCheck(): Promise<{
  status: "healthy" | "warning" | "critical";
  checks: Array<{ name: string; status: string; detail: string }>;
}> {
  const checks: Array<{ name: string; status: string; detail: string }> = [];

  // Check 1: Database accessible
  try {
    const rawDb = getRawDb();
    const row = rawDb.prepare("SELECT COUNT(*) as c FROM memories").get() as any;
    checks.push({
      name: "database",
      status: "ok",
      detail: `${row.c} total memories`,
    });
  } catch (error: any) {
    checks.push({
      name: "database",
      status: "critical",
      detail: `DB error: ${error.message}`,
    });
  }

  // Check 2: Memory growth
  try {
    const stats = await getMemoryStats();
    if (stats.total === 0) {
      checks.push({
        name: "memory_growth",
        status: "warning",
        detail: "No memories stored yet",
      });
    } else {
      checks.push({
        name: "memory_growth",
        status: "ok",
        detail: `${stats.total} active memories across ${Object.keys(stats).length - 1} types`,
      });
    }
  } catch {
    checks.push({
      name: "memory_growth",
      status: "warning",
      detail: "Could not check memory stats",
    });
  }

  // Check 3: Learning confidence distribution
  try {
    const learnings = await getLearnings(100);
    const avgConfidence =
      learnings.length > 0
        ? learnings.reduce((s, l) => s + l.confidence, 0) / learnings.length
        : 0;
    checks.push({
      name: "learning_quality",
      status: avgConfidence > 0.3 ? "ok" : "warning",
      detail: `${learnings.length} learnings, avg confidence: ${Math.round(avgConfidence * 100)}%`,
    });
  } catch {
    checks.push({
      name: "learning_quality",
      status: "ok",
      detail: "No learnings yet",
    });
  }

  // Check 4: Stale jobs
  try {
    const jobs = await listJobs(true);
    const staleJobs = jobs.filter(
      (j) => j.lastRunAt && new Date(j.lastRunAt).getTime() < Date.now() - 48 * 3600 * 1000
    );
    if (staleJobs.length > 0) {
      checks.push({
        name: "scheduled_jobs",
        status: "warning",
        detail: `${staleJobs.length} jobs haven't run in 48h: ${staleJobs.map((j) => j.name).join(", ")}`,
      });
    } else {
      checks.push({
        name: "scheduled_jobs",
        status: "ok",
        detail: `${jobs.length} active jobs, all recent`,
      });
    }
  } catch {
    checks.push({
      name: "scheduled_jobs",
      status: "ok",
      detail: "No scheduled jobs",
    });
  }

  const criticalCount = checks.filter((c) => c.status === "critical").length;
  const warningCount = checks.filter((c) => c.status === "warning").length;

  const status = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";

  return { status, checks };
}

// ============================================
// 4. QUALITY SELF-EVALUATION
// ============================================

export interface QualityEntry {
  id: number;
  date: string;
  score: number;
  helpfulness: string;
  mistakes: string;
  improvements: string;
  createdAt: string;
}

function ensureQualityTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_quality_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      score INTEGER NOT NULL,
      helpfulness TEXT NOT NULL DEFAULT '',
      mistakes TEXT NOT NULL DEFAULT '',
      improvements TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function logQuality(input: {
  score: number;
  helpfulness: string;
  mistakes?: string;
  improvements?: string;
}): Promise<QualityEntry> {
  ensureQualityTable();
  const rawDb = getRawDb();

  const today = new Date().toISOString().split("T")[0];

  const row = rawDb
    .prepare(
      `INSERT INTO soul_quality_log (date, score, helpfulness, mistakes, improvements)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      today,
      input.score,
      input.helpfulness,
      input.mistakes || "",
      input.improvements || ""
    ) as any;

  await remember({
    content: `[Quality] Score: ${input.score}/5 | ${input.helpfulness}${input.mistakes ? ` | Mistakes: ${input.mistakes}` : ""}`,
    type: "learning",
    tags: ["quality", "self-evaluation"],
    source: "scheduler-engine",
  });

  return mapQuality(row);
}

export async function getQualityTrend(days = 30): Promise<QualityEntry[]> {
  ensureQualityTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_quality_log ORDER BY date DESC LIMIT ?")
    .all(days) as any[];

  return rows.map(mapQuality);
}

// ============================================
// 5. MEMORY CONSOLIDATION
// ============================================

export async function consolidateMemories(): Promise<string> {
  const recent = await getRecentMemories(50);
  const learnings = await getLearnings(20);

  let summary = `=== Memory Consolidation ===\n\n`;
  summary += `Reviewed: ${recent.length} recent memories\n`;
  summary += `Active learnings: ${learnings.length}\n\n`;

  // Group by type
  const byType: Record<string, number> = {};
  for (const m of recent) {
    byType[m.type] = (byType[m.type] || 0) + 1;
  }

  summary += `Memory distribution:\n`;
  for (const [type, count] of Object.entries(byType)) {
    summary += `  ${type}: ${count}\n`;
  }

  // Find weak learnings
  const weakLearnings = learnings.filter((l) => l.confidence < 0.3);
  if (weakLearnings.length > 0) {
    summary += `\nWeak learnings (need reinforcement):\n`;
    weakLearnings.forEach((l) => {
      summary += `  - ${l.pattern} (${Math.round(l.confidence * 100)}%)\n`;
    });
  }

  // Suggest actions
  summary += `\nSuggested actions:\n`;
  summary += `  - Review weak learnings and reinforce or remove\n`;
  summary += `  - Check for duplicate/contradictory memories\n`;
  summary += `  - Extract patterns from conversation memories\n`;

  await remember({
    content: `[Consolidation] Reviewed ${recent.length} memories, ${learnings.length} learnings. ${weakLearnings.length} weak patterns found.`,
    type: "learning",
    tags: ["consolidation", "maintenance"],
    source: "scheduler-engine",
  });

  return summary;
}

// ============================================
// Helpers
// ============================================

// ============================================
// 6. CRON TIMER RUNNER
// ============================================

let _schedulerInterval: ReturnType<typeof setInterval> | null = null;
let _schedulerRunning = false; // Guard against concurrent ticks

/**
 * Parse simple schedule expressions: "every 1h", "every 6h", "every 24h", "every 30m"
 * Returns interval in milliseconds, or null if not parseable.
 */
function parseScheduleInterval(schedule: string): number | null {
  const match = schedule.match(/^every\s+(\d+)\s*(h|m)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "h") return value * 3600 * 1000;
  if (unit === "m") return value * 60 * 1000;
  return null;
}

async function executeJob(job: ScheduledJob): Promise<void> {
  const start = Date.now();
  let status = "ok";
  let output = "";

  try {
    switch (job.jobType) {
      case "heartbeat":
      case "health":
        const health = await healthCheck();
        output = `Status: ${health.status}, checks: ${health.checks.length}`;
        // Also run deep self-diagnostics on health checks
        try {
          const { runSelfDiagnostics } = await import("./self-healing.js");
          const diag = await runSelfDiagnostics();
          if (diag.overallStatus !== "healthy") {
            output += ` | Self-Diag: ${diag.overallStatus} (${diag.diagnostics.filter(d => d.status !== "ok").map(d => d.category).join(", ")})`;
            if (diag.autoFixes.length > 0) output += ` | Auto-fixed: ${diag.autoFixes.join("; ")}`;
          }
        } catch { /* self-diagnostic failure is non-critical */ }
        break;
      case "briefing":
        // Use proactive morning briefing — sends to Telegram automatically
        try {
          const { sendMorningBriefing } = await import("./proactive-soul.js");
          const briefResult = await sendMorningBriefing();
          output = briefResult.message;
        } catch (briefErr: any) {
          // Fallback to old briefing
          output = await generateBriefing();
        }
        break;
      case "memory":
        output = await consolidateMemories();
        break;
      case "custom":
        output = `Custom job "${job.name}" executed`;
        break;
      default:
        output = `Unknown job type: ${job.jobType}`;
        status = "skipped";
    }
  } catch (err: any) {
    status = "error";
    output = err.message || "Unknown error";
  }

  const durationMs = Date.now() - start;
  await logJobRun(job.id, status, output, durationMs);

  // Update next_run_at
  const intervalMs = parseScheduleInterval(job.schedule);
  if (intervalMs) {
    const nextRun = new Date(Date.now() + intervalMs).toISOString().replace("T", " ").substring(0, 19);
    const rawDb = getRawDb();
    rawDb.prepare("UPDATE soul_jobs SET next_run_at = ? WHERE id = ?").run(nextRun, job.id);
  }
}

export function startScheduler(): void {
  if (_schedulerInterval) return; // Already running

  ensureSchedulerTables();
  console.log("[Scheduler] Started — checking every 60s");

  _schedulerInterval = setInterval(async () => {
    if (_schedulerRunning) return; // Skip tick if previous tick is still running
    _schedulerRunning = true;
    try {
      const rawDb = getRawDb();
      const now = new Date().toISOString().replace("T", " ").substring(0, 19);

      const dueJobs = rawDb
        .prepare("SELECT * FROM soul_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?")
        .all(now) as any[];

      for (const row of dueJobs) {
        const job = mapJob(row);
        try {
          await executeJob(job);
        } catch (err: any) {
          console.error(`[Scheduler] Job "${job.name}" failed:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[Scheduler] Tick error:", err.message);
    } finally {
      _schedulerRunning = false;
    }
  }, 60_000);
}

export function stopScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    console.log("[Scheduler] Stopped");
  }
}

// ============================================
// Helpers
// ============================================

function mapJob(row: any): ScheduledJob {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schedule: row.schedule,
    jobType: row.job_type,
    payload: row.payload,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    createdAt: row.created_at,
  };
}

function mapQuality(row: any): QualityEntry {
  return {
    id: row.id,
    date: row.date,
    score: row.score,
    helpfulness: row.helpfulness,
    mistakes: row.mistakes,
    improvements: row.improvements,
    createdAt: row.created_at,
  };
}
