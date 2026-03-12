/**
 * Agent Worker — Runs inside a worker_thread
 *
 * Receives an AgentTask, runs a simplified agent loop using LLM calls,
 * and sends tool execution requests back to the main thread (since SQLite
 * is not thread-safe, all DB/tool operations happen on the main thread).
 *
 * Communication protocol:
 * - Main → Worker: { type: "task", task, availableTools }
 * - Worker → Main: { type: "execute_tool", requestId, toolName, args }
 * - Main → Worker: { type: "tool_result", requestId, result?, error? }
 * - Worker → Main: { type: "result", result: AgentResult }
 */

import { parentPort, workerData } from "worker_threads";

if (!parentPort) {
  throw new Error("agent-worker.ts must be run inside a worker_thread");
}

const port = parentPort;
const workerId: number = workerData?.workerId ?? 0;

// ─── Types (duplicated to avoid cross-thread import issues) ───

interface AgentTask {
  id: string;
  goal: string;
  tools: string[];
  context?: string;
  providerId?: string;
  maxSteps?: number;
  timeout?: number;
}

interface AgentResult {
  taskId: string;
  status: "completed" | "failed" | "timeout";
  result?: string;
  error?: string;
  stepsUsed: number;
  duration: number;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

// ─── Tool Execution via Main Thread ───

let requestIdCounter = 0;
const pendingRequests = new Map<string, {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}>();

function executeToolOnMainThread(toolName: string, args: Record<string, any>): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = `w${workerId}_r${++requestIdCounter}`;
    pendingRequests.set(requestId, { resolve, reject });

    port.postMessage({
      type: "execute_tool",
      requestId,
      toolName,
      args,
    });
  });
}

// ─── Simplified Agent Loop (LLM-driven, tools via main thread) ───

async function runWorkerAgentLoop(
  task: AgentTask,
  tools: ToolDef[],
): Promise<AgentResult> {
  const startTime = Date.now();
  const maxSteps = task.maxSteps ?? 5;
  let stepsUsed = 0;

  try {
    // Dynamic import — LLM connector should work in worker threads
    // since it only makes HTTP calls (no SQLite)
    const { chat } = await import("./llm-connector.js");

    const systemPrompt = `You are a Soul AI agent worker executing a specific task.
Your task: ${task.goal}
${task.context ? `Context: ${task.context}` : ""}

You have access to tools. Use them to complete the task. Be concise and focused.
When you have completed the task, provide your final answer without calling more tools.`;

    const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task.goal },
    ];

    const toolDefs = tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Agent loop: LLM thinks → calls tools → reads results → repeats
    for (let step = 0; step < maxSteps; step++) {
      stepsUsed++;

      let response;
      try {
        response = await chat(
          messages as any,
          {
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            providerId: task.providerId,
          },
        );
      } catch (err: any) {
        // LLM call failed — return what we have
        return {
          taskId: task.id,
          status: "failed",
          error: `LLM error: ${err.message}`,
          stepsUsed,
          duration: Date.now() - startTime,
        };
      }

      // Check for tool calls
      const toolCalls = response.toolCalls || [];

      if (toolCalls.length === 0) {
        // No tool calls — LLM is done, extract final answer
        const reply = response.content || "";
        return {
          taskId: task.id,
          status: "completed",
          result: typeof reply === "string" ? reply : JSON.stringify(reply),
          stepsUsed,
          duration: Date.now() - startTime,
        };
      }

      // Execute tool calls via main thread
      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: response.content || "",
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgsRaw = toolCall.function.arguments;
        const toolArgs = typeof toolArgsRaw === "string" ? JSON.parse(toolArgsRaw) : toolArgsRaw;
        const callId = toolCall.id || `call_${Date.now()}`;

        let toolResult: string;
        try {
          toolResult = await executeToolOnMainThread(toolName, toolArgs);
        } catch (err: any) {
          toolResult = `Error: ${err.message}`;
        }

        messages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: callId,
        });
      }
    }

    // Max steps reached — return last state
    return {
      taskId: task.id,
      status: "completed",
      result: `Completed after ${maxSteps} steps. Last context available in conversation.`,
      stepsUsed,
      duration: Date.now() - startTime,
    };

  } catch (err: any) {
    return {
      taskId: task.id,
      status: "failed",
      error: err.message || "Unknown worker error",
      stepsUsed,
      duration: Date.now() - startTime,
    };
  }
}

// ─── Message Handler ───

port.on("message", async (msg: any) => {
  if (msg.type === "task") {
    // Received a task to execute
    const { task, availableTools } = msg;
    const result = await runWorkerAgentLoop(task, availableTools || []);
    port.postMessage({ type: "result", result });

  } else if (msg.type === "tool_result") {
    // Received tool execution result from main thread
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pendingRequests.delete(msg.requestId);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result || "");
      }
    }
  }
});
