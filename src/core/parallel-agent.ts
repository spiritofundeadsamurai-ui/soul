/**
 * Parallel Multi-Agent Execution — Worker Threads
 *
 * Runs multiple agent tasks in parallel using Node.js worker_threads.
 * Main thread acts as coordinator — handles DB/tool execution (SQLite is not thread-safe).
 * Workers handle LLM calls and decision-making, sending tool requests back to main thread.
 *
 * Architecture:
 * - AgentPool manages a pool of worker threads
 * - Workers receive tasks, run simplified agent loops (LLM only)
 * - When a worker needs to execute a tool, it sends a message to main thread
 * - Main thread executes the tool (safe for SQLite) and returns the result
 * - Worker continues its loop with the tool result
 */

import { Worker } from "worker_threads";
import { cpus } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getRawDb } from "../db/index.js";
import { getRegisteredTools, type InternalTool } from "./agent-loop.js";

// ─── Types ───

export interface AgentTask {
  id: string;
  goal: string;
  tools: string[];        // which tools this agent can use
  context?: string;
  providerId?: string;    // which LLM to use
  maxSteps?: number;
  timeout?: number;       // ms, default 60000
}

export interface AgentResult {
  taskId: string;
  status: "completed" | "failed" | "timeout";
  result?: string;
  error?: string;
  stepsUsed: number;
  duration: number;
}

// Messages between main thread and workers
interface WorkerRequest {
  type: "execute_tool";
  requestId: string;
  toolName: string;
  args: Record<string, any>;
}

interface WorkerResponse {
  type: "tool_result";
  requestId: string;
  result?: string;
  error?: string;
}

interface WorkerTaskMessage {
  type: "task";
  task: AgentTask;
  availableTools: Array<{ name: string; description: string; parameters: Record<string, any> }>;
}

interface WorkerResultMessage {
  type: "result";
  result: AgentResult;
}

// ─── DB ───

function ensureParallelTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_parallel_tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      worker_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_parallel_tasks_parent
      ON soul_parallel_tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_parallel_tasks_status
      ON soul_parallel_tasks(status);
  `);
}

function recordTask(task: AgentTask, parentId?: string) {
  ensureParallelTable();
  const rawDb = getRawDb();
  try {
    rawDb.prepare(`
      INSERT OR REPLACE INTO soul_parallel_tasks (id, parent_task_id, goal, status)
      VALUES (?, ?, ?, 'running')
    `).run(task.id, parentId || null, task.goal);
  } catch { /* non-critical */ }
}

function completeTask(taskId: string, result: AgentResult) {
  ensureParallelTable();
  const rawDb = getRawDb();
  try {
    rawDb.prepare(`
      UPDATE soul_parallel_tasks
      SET status = ?, result = ?, completed_at = datetime('now'), duration_ms = ?
      WHERE id = ?
    `).run(result.status, result.result || result.error || "", result.duration, taskId);
  } catch { /* non-critical */ }
}

// ─── Worker Pool ───

export class AgentPool {
  private maxWorkers: number;
  private activeWorkers: Map<number, Worker> = new Map();
  private taskQueue: Array<{
    task: AgentTask;
    parentId?: string;
    resolve: (result: AgentResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private workerIdCounter = 0;
  private shuttingDown = false;
  private workerScriptPath: string;

  constructor(maxWorkers?: number) {
    this.maxWorkers = maxWorkers ?? Math.min(cpus().length - 1, 4);
    if (this.maxWorkers < 1) this.maxWorkers = 1;

    // Resolve worker script path relative to this file
    const __dirname = dirname(fileURLToPath(import.meta.url));
    this.workerScriptPath = join(__dirname, "agent-worker.js");
  }

  /**
   * Execute a single agent task using a worker thread
   */
  async execute(task: AgentTask, parentId?: string): Promise<AgentResult> {
    if (this.shuttingDown) {
      return {
        taskId: task.id,
        status: "failed",
        error: "Pool is shutting down",
        stepsUsed: 0,
        duration: 0,
      };
    }

    return new Promise<AgentResult>((resolve, reject) => {
      this.taskQueue.push({ task, parentId, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Execute multiple tasks in parallel, returning all results
   */
  async executeParallel(tasks: AgentTask[], parentId?: string): Promise<AgentResult[]> {
    if (tasks.length === 0) return [];

    // Generate a parent task ID for grouping
    const groupId = parentId || `parallel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Record parent task
    ensureParallelTable();
    const rawDb = getRawDb();
    try {
      rawDb.prepare(`
        INSERT OR REPLACE INTO soul_parallel_tasks (id, goal, status)
        VALUES (?, ?, 'running')
      `).run(groupId, `Parallel execution: ${tasks.length} tasks`);
    } catch { /* non-critical */ }

    // Launch all tasks
    const promises = tasks.map(task => this.execute(task, groupId));
    const results = await Promise.allSettled(promises);

    // Map settled results to AgentResult
    const mapped = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        taskId: tasks[i].id,
        status: "failed" as const,
        error: r.reason?.message || "Unknown error",
        stepsUsed: 0,
        duration: 0,
      };
    });

    // Complete parent task
    const allDone = mapped.every(r => r.status === "completed");
    try {
      rawDb.prepare(`
        UPDATE soul_parallel_tasks
        SET status = ?, result = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(
        allDone ? "completed" : "partial",
        `${mapped.filter(r => r.status === "completed").length}/${mapped.length} completed`,
        groupId
      );
    } catch { /* non-critical */ }

    return mapped;
  }

  /**
   * Gracefully shutdown all workers
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Reject all queued tasks
    for (const queued of this.taskQueue) {
      queued.resolve({
        taskId: queued.task.id,
        status: "failed",
        error: "Pool shutdown",
        stepsUsed: 0,
        duration: 0,
      });
    }
    this.taskQueue = [];

    // Terminate all workers
    const terminations = Array.from(this.activeWorkers.values()).map(worker =>
      worker.terminate()
    );
    await Promise.allSettled(terminations);
    this.activeWorkers.clear();
  }

  // ─── Internal ───

  private processQueue() {
    while (this.taskQueue.length > 0 && this.activeWorkers.size < this.maxWorkers) {
      const item = this.taskQueue.shift();
      if (!item) break;
      this.spawnWorker(item.task, item.parentId, item.resolve, item.reject);
    }
  }

  private spawnWorker(
    task: AgentTask,
    parentId: string | undefined,
    resolve: (result: AgentResult) => void,
    reject: (error: Error) => void,
  ) {
    const workerId = ++this.workerIdCounter;
    const startTime = Date.now();
    const timeout = task.timeout ?? 60000;

    // Record task in DB
    recordTask(task, parentId);

    // Get tool definitions the worker is allowed to use
    const allTools = getRegisteredTools();
    const allowedTools = task.tools.length > 0
      ? allTools.filter(t => task.tools.includes(t.name))
      : allTools;

    const toolDefs = allowedTools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let worker: Worker;
    try {
      worker = new Worker(this.workerScriptPath, {
        workerData: { workerId },
      });
    } catch (err: any) {
      // Worker script may not exist yet (not compiled) — fall back to inline execution
      this.executeInline(task, parentId, startTime, resolve);
      return;
    }

    this.activeWorkers.set(workerId, worker);

    // Timeout handler
    const timer = setTimeout(() => {
      const result: AgentResult = {
        taskId: task.id,
        status: "timeout",
        error: `Task timed out after ${timeout}ms`,
        stepsUsed: 0,
        duration: Date.now() - startTime,
      };
      completeTask(task.id, result);
      worker.terminate();
      this.activeWorkers.delete(workerId);
      resolve(result);
      this.processQueue();
    }, timeout);

    // Handle messages from worker
    worker.on("message", async (msg: any) => {
      if (msg.type === "execute_tool") {
        // Worker wants to run a tool — execute on main thread (SQLite safe)
        const request = msg as WorkerRequest;
        const tool = allTools.find(t => t.name === request.toolName);
        let response: WorkerResponse;

        if (!tool) {
          response = {
            type: "tool_result",
            requestId: request.requestId,
            error: `Tool "${request.toolName}" not found or not allowed`,
          };
        } else {
          try {
            const result = await tool.execute(request.args);
            response = {
              type: "tool_result",
              requestId: request.requestId,
              result,
            };
          } catch (err: any) {
            response = {
              type: "tool_result",
              requestId: request.requestId,
              error: err.message || "Tool execution failed",
            };
          }
        }

        try {
          worker.postMessage(response);
        } catch { /* worker may have exited */ }

      } else if (msg.type === "result") {
        // Worker finished
        clearTimeout(timer);
        const resultMsg = msg as WorkerResultMessage;
        const result = {
          ...resultMsg.result,
          duration: Date.now() - startTime,
        };
        completeTask(task.id, result);
        worker.terminate();
        this.activeWorkers.delete(workerId);
        resolve(result);
        this.processQueue();
      }
    });

    worker.on("error", (err: Error) => {
      clearTimeout(timer);
      const result: AgentResult = {
        taskId: task.id,
        status: "failed",
        error: err.message,
        stepsUsed: 0,
        duration: Date.now() - startTime,
      };
      completeTask(task.id, result);
      this.activeWorkers.delete(workerId);
      resolve(result);
      this.processQueue();
    });

    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (this.activeWorkers.has(workerId)) {
        // Unexpected exit
        const result: AgentResult = {
          taskId: task.id,
          status: "failed",
          error: `Worker exited with code ${code}`,
          stepsUsed: 0,
          duration: Date.now() - startTime,
        };
        completeTask(task.id, result);
        this.activeWorkers.delete(workerId);
        resolve(result);
        this.processQueue();
      }
    });

    // Send task to worker
    const taskMessage: WorkerTaskMessage = {
      type: "task",
      task,
      availableTools: toolDefs,
    };
    worker.postMessage(taskMessage);
  }

  /**
   * Fallback: Execute task inline (no worker thread) when worker script
   * is unavailable. This still provides parallel execution via Promise.all.
   */
  private async executeInline(
    task: AgentTask,
    parentId: string | undefined,
    startTime: number,
    resolve: (result: AgentResult) => void,
  ) {
    try {
      const { runAgentLoop } = await import("./agent-loop.js");
      const agentResult = await runAgentLoop(task.goal, {
        providerId: task.providerId,
        maxIterations: task.maxSteps ?? 5,
      });

      const result: AgentResult = {
        taskId: task.id,
        status: "completed",
        result: agentResult.reply,
        stepsUsed: agentResult.iterations,
        duration: Date.now() - startTime,
      };
      completeTask(task.id, result);
      resolve(result);
    } catch (err: any) {
      const result: AgentResult = {
        taskId: task.id,
        status: "failed",
        error: err.message,
        stepsUsed: 0,
        duration: Date.now() - startTime,
      };
      completeTask(task.id, result);
      resolve(result);
    }
    this.processQueue();
  }
}

// ─── Singleton Pool ───

let _pool: AgentPool | null = null;

export function getAgentPool(maxWorkers?: number): AgentPool {
  if (!_pool) {
    _pool = new AgentPool(maxWorkers);
  }
  return _pool;
}

export async function shutdownPool(): Promise<void> {
  if (_pool) {
    await _pool.shutdown();
    _pool = null;
  }
}

// ─── Query Functions ───

export function getParallelTaskStatus(taskId: string): {
  id: string;
  goal: string;
  status: string;
  result: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  subtasks: Array<{
    id: string;
    goal: string;
    status: string;
    result: string | null;
    durationMs: number | null;
  }>;
} | null {
  ensureParallelTable();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    "SELECT * FROM soul_parallel_tasks WHERE id = ?"
  ).get(taskId) as any;

  if (!row) return null;

  const subtasks = rawDb.prepare(
    "SELECT * FROM soul_parallel_tasks WHERE parent_task_id = ? ORDER BY started_at"
  ).all(taskId) as any[];

  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    result: row.result,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    subtasks: subtasks.map((s: any) => ({
      id: s.id,
      goal: s.goal,
      status: s.status,
      result: s.result,
      durationMs: s.duration_ms,
    })),
  };
}

export function listParallelTasks(limit = 20): Array<{
  id: string;
  goal: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  subtaskCount: number;
}> {
  ensureParallelTable();
  const rawDb = getRawDb();

  const rows = rawDb.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM soul_parallel_tasks sub WHERE sub.parent_task_id = t.id) as subtask_count
    FROM soul_parallel_tasks t
    WHERE t.parent_task_id IS NULL
    ORDER BY t.started_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    goal: r.goal,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
    subtaskCount: r.subtask_count,
  }));
}
