/**
 * Tool Router — Minimal MCP surface, full capability behind soul_agent
 *
 * Design philosophy (inspired by Pi Coding Agent + SkyClaw):
 * 1. Minimal context: 15 core tools + 1 meta-tool instead of 329
 * 2. Self-healing: auto-retry on failure, learn from errors, suggest fixes
 * 3. Adaptive: track usage, promote frequently-used tools, detect patterns
 * 4. Auto-tool creation: suggest creating tools from repeated patterns
 *
 * Context savings: ~94% reduction (from ~33k to ~2k tokens)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  trackToolCall,
  getToolStats,
  trackPattern,
  detectRepeatedPatterns,
  markPatternSuggested,
  attemptSelfHeal,
  suggestCorePromotions,
  suggestCoreDemotions,
  runHealthCheck,
  hashArgs,
} from "../core/self-healing.js";

// ─── Core tools: always registered with MCP (most frequently used) ───
export const CORE_TOOLS = new Set([
  "soul_setup",        // first-time master binding
  "soul_status",       // system health
  "soul_remember",     // store memory
  "soul_search",       // search everything
  "soul_ask",          // ask Soul questions
  "soul_learn",        // teach Soul
  "soul_think",        // guided reasoning
  "soul_note",         // quick capture
  "soul_mood",         // emotional tracking
  "soul_goal",         // goals management
  "soul_smart_chat",   // chat with Soul's LLM brain
  "soul_web_search",   // search the web
  "soul_read_file",    // read files
  "soul_create_chart", // create visualizations
]);

// ─── Stored tool entry ───
interface ToolEntry {
  name: string;
  description: string;
  args: any[];  // original args passed to server.tool() (without name)
  handler: (...args: any[]) => Promise<any>;
}

// ─── Global tool store ───
export const toolStore = new Map<string, ToolEntry>();

// ─── Max retries for self-healing ───
const MAX_RETRIES = 1;

/**
 * Creates a collector object that mimics McpServer.tool() interface.
 * Stores ALL tool registrations but only forwards core tools to the real server.
 */
export function createToolCollector(realServer: McpServer) {
  const collector = {
    tool(...toolArgs: any[]) {
      const name = toolArgs[0] as string;
      const restArgs = toolArgs.slice(1);
      const handler = restArgs[restArgs.length - 1] as Function;
      const description = typeof restArgs[0] === "string" ? restArgs[0] : "";

      // Store every tool
      toolStore.set(name, {
        name,
        description,
        args: restArgs,
        handler: handler as any,
      });

      // Only register core tools on the real MCP server
      if (CORE_TOOLS.has(name)) {
        (realServer as any).tool(...toolArgs);
      }
    },
  };

  return collector;
}

/**
 * Generate a compact catalog of all non-core tools grouped by category.
 * This goes into soul_agent's description — much smaller than 300+ tool definitions.
 */
function generateCatalog(): string {
  const categories = new Map<string, string[]>();

  for (const [name] of toolStore) {
    if (CORE_TOOLS.has(name)) continue;

    const withoutPrefix = name.replace("soul_", "");
    const parts = withoutPrefix.split("_");
    const cat = parts[0];

    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(name);
  }

  const sorted = [...categories.entries()].sort((a, b) => b[1].length - a[1].length);

  let catalog = "";
  for (const [cat, tools] of sorted) {
    catalog += `• ${cat}: ${tools.join(", ")}\n`;
  }

  return catalog;
}

/**
 * Execute a tool with self-healing: tracking, retry, error learning.
 */
async function executeWithHealing(
  toolName: string,
  args: Record<string, any>,
  entry: ToolEntry
): Promise<{ content: { type: "text"; text: string }[] }> {
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();

    try {
      const result = await entry.handler(args);
      const duration = Date.now() - start;

      // Track success
      trackToolCall(toolName, true, duration, undefined, hashArgs(args));

      // Track pattern for auto-tool suggestion
      trackPattern(toolName, hashArgs(args));

      // Check for repeated patterns and append suggestion if found
      const patterns = detectRepeatedPatterns(5);
      if (patterns.length > 0) {
        const suggestion = patterns[0];
        markPatternSuggested(suggestion.toolName, suggestion.argsPattern);

        // Append auto-tool suggestion to result
        const originalText = result.content?.[0]?.text || "";
        return {
          content: [
            {
              type: "text" as const,
              text: `${originalText}\n\n💡 Pattern detected: You've called ${suggestion.toolName} with similar args ${suggestion.callCount} times. Consider creating a custom tool: soul_agent(tool="soul_skill_create", args={name: "${suggestion.suggestedName}", ...})`,
            },
          ],
        };
      }

      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      lastError = err.message || String(err);

      // Track failure
      trackToolCall(toolName, false, duration, lastError, hashArgs(args));

      // On first failure, attempt self-healing
      if (attempt < MAX_RETRIES) {
        const healing = await attemptSelfHeal(toolName, lastError, args);
        if (healing.healed && healing.suggestion) {
          // If it's a retriable error (DB locked, network), just retry
          if (lastError.toLowerCase().includes("database is locked") ||
              lastError.toLowerCase().includes("sqlite_busy")) {
            await new Promise((r) => setTimeout(r, 500));
            continue; // retry
          }

          // Otherwise return the suggestion
          return {
            content: [
              {
                type: "text" as const,
                text: `Error in ${toolName}: ${lastError}\n\n🔧 Self-heal suggestion: ${healing.suggestion}`,
              },
            ],
          };
        }
      }
    }
  }

  // All retries exhausted
  return {
    content: [
      {
        type: "text" as const,
        text: `Error in ${toolName} (after ${MAX_RETRIES + 1} attempts): ${lastError}`,
      },
    ],
  };
}

/**
 * Register the soul_agent meta-tool + management commands on the real MCP server.
 */
export function registerSoulAgent(server: McpServer) {
  const catalog = generateCatalog();
  const totalTools = toolStore.size;
  const coreCount = [...CORE_TOOLS].filter((t) => toolStore.has(t)).length;
  const agentCount = totalTools - coreCount;

  // ─── soul_agent: main gateway ───
  server.tool(
    "soul_agent",
    `Execute any of Soul's ${agentCount}+ extended capabilities. Self-healing: auto-retries on failure, learns from errors.\n` +
    `Special commands: "list", "stats", "health", "optimize"\n\n` +
    `CATEGORIES:\n${catalog}`,
    {
      tool: z
        .string()
        .describe('Tool name (e.g. "soul_brainstorm"), or: "list", "stats", "health", "optimize"'),
      args: z
        .record(z.string(), z.any())
        .default({})
        .describe("Tool arguments as JSON object"),
    },
    async ({ tool, args }) => {
      // ─── Built-in commands ───

      // List all tools
      if (tool === "list" || tool === "help") {
        const lines: string[] = [];
        const coreList: string[] = [];
        const extList: string[] = [];

        for (const [name, entry] of toolStore) {
          const line = `  ${name} — ${entry.description.substring(0, 80)}`;
          if (CORE_TOOLS.has(name)) {
            coreList.push(line);
          } else {
            extList.push(line);
          }
        }

        lines.push(`Soul Tools (${totalTools} total)\n`);
        lines.push(`── Core (${coreList.length}, always in context) ──`);
        lines.push(...coreList);
        lines.push(`\n── Extended (${extList.length}, via soul_agent) ──`);
        lines.push(...extList);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      // Usage statistics
      if (tool === "stats") {
        const stats = getToolStats(20);
        if (stats.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No tool usage data yet." }],
          };
        }

        let text = "Tool Usage Stats (top 20):\n\n";
        text += "Tool                          | Calls | Success% | Avg ms | Last Used\n";
        text += "─────────────────────────────-|────---|──────────|────────|──────────\n";
        for (const s of stats) {
          const name = s.toolName.padEnd(30);
          text += `${name}| ${String(s.totalCalls).padStart(5)} | ${String(s.successRate).padStart(7)}% | ${String(s.avgDuration).padStart(6)} | ${s.lastUsed.substring(0, 10)}\n`;
        }

        return { content: [{ type: "text" as const, text }] };
      }

      // Health check with auto-repair
      if (tool === "health") {
        const report = runHealthCheck();

        let text = `Soul Health: ${report.status.toUpperCase()}\n\n`;
        for (const c of report.checks) {
          const icon = c.status === "ok" ? "OK" : c.status === "warning" ? "WARN" : "CRIT";
          text += `[${icon}] ${c.name}: ${c.detail}\n`;
        }

        if (report.autoRepaired.length > 0) {
          text += `\nAuto-repaired:\n`;
          for (const r of report.autoRepaired) {
            text += `  - ${r}\n`;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      }

      // Optimize: suggest core tool changes
      if (tool === "optimize") {
        const promotions = suggestCorePromotions(CORE_TOOLS);
        const demotions = suggestCoreDemotions(CORE_TOOLS);
        const patterns = detectRepeatedPatterns(3);

        let text = "Soul Optimization Report\n\n";

        text += `Current core tools: ${CORE_TOOLS.size}\n`;
        text += `Total tools: ${totalTools}\n\n`;

        if (promotions.length > 0) {
          text += `Promote to core (used 5+ times/week, >80% success):\n`;
          for (const t of promotions) {
            text += `  + ${t}\n`;
          }
          text += "\n";
        } else {
          text += "No tools ready for promotion.\n\n";
        }

        if (demotions.length > 0) {
          text += `Consider removing from core (unused 14+ days):\n`;
          for (const t of demotions) {
            text += `  - ${t}\n`;
          }
          text += "\n";
        } else {
          text += "All core tools are actively used.\n\n";
        }

        if (patterns.length > 0) {
          text += `Repeated patterns (consider creating custom tools):\n`;
          for (const p of patterns) {
            text += `  ${p.toolName} (${p.callCount}x) → create as "${p.suggestedName}"\n`;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      }

      // ─── Execute tool ───

      const entry = toolStore.get(tool);
      if (!entry) {
        // Fuzzy match
        const query = tool.replace("soul_", "");
        const matches = [...toolStore.keys()]
          .filter((k) => k.includes(query))
          .slice(0, 8);

        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool: "${tool}". ${
                matches.length > 0
                  ? `Similar: ${matches.join(", ")}`
                  : 'Use soul_agent(tool="list") to see all.'
              }`,
            },
          ],
        };
      }

      // Execute with self-healing
      return executeWithHealing(tool, args, entry);
    }
  );
}
