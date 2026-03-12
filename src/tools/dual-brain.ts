import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDualBrainStats } from "../core/dual-brain.js";
import { getReflexStats, promoteToReflex } from "../core/reflex-engine.js";

export function registerDualBrainTools(server: McpServer) {
  server.tool(
    "soul_brain_dashboard",
    "Show dual-brain performance: System 1 (reflex) vs System 2 (LLM) stats, latency, and learning progress.",
    {},
    async () => {
      try {
        const brainStats = getDualBrainStats();
        const reflexStats = getReflexStats();

        const lines = [
          "🧠 Dual-Brain Dashboard",
          "═══════════════════════",
          "",
          `Total Requests: ${brainStats.totalRequests}`,
          `System 1 (Reflex): ${brainStats.system1Handled} (${brainStats.system1Percentage}%)`,
          `System 2 (LLM):    ${brainStats.system2Handled} (${100 - brainStats.system1Percentage}%)`,
          "",
          "⚡ Latency",
          `  System 1 avg: ${brainStats.avgSystem1LatencyMs}ms`,
          `  System 2 avg: ${brainStats.avgSystem2LatencyMs}ms`,
          `  Speedup: ${brainStats.avgSystem2LatencyMs > 0 ? Math.round(brainStats.avgSystem2LatencyMs / Math.max(brainStats.avgSystem1LatencyMs, 1)) : "∞"}x faster`,
          "",
          "🔄 Reflexes",
          `  Active: ${reflexStats.active} / ${reflexStats.total}`,
          `  Avg Confidence: ${reflexStats.avgConfidence}`,
          `  By Type: ${Object.entries(reflexStats.byType).map(([t, c]) => `${t}=${c}`).join(", ") || "none yet"}`,
          "",
          "📊 By Brain",
          ...Object.entries(brainStats.byBrain).map(([b, c]) => `  ${b}: ${c}`),
        ];

        if (brainStats.last7Days.length > 0) {
          lines.push("", "📈 Last 7 Days");
          for (const d of brainStats.last7Days) {
            const total = d.system1 + d.system2;
            const pct = total > 0 ? Math.round((d.system1 / total) * 100) : 0;
            lines.push(`  ${d.date}: S1=${d.system1} S2=${d.system2} (${pct}% reflex)`);
          }
        }

        if (reflexStats.topReflexes.length > 0) {
          lines.push("", "🏆 Top Reflexes");
          for (const r of reflexStats.topReflexes) {
            lines.push(`  [${r.reflexType}] "${r.triggerPattern.slice(0, 40)}" — ${r.hitCount} hits, ${Math.round(r.confidence * 100)}% conf`);
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_reflex_teach",
    "Teach Soul a new System 1 reflex — instant response without LLM for a specific pattern.",
    {
      trigger: z.string().describe("The trigger phrase/pattern"),
      response: z.string().describe("The instant response to give"),
      type: z.enum(["pattern", "emotional", "habit"]).default("pattern").describe("Reflex type"),
    },
    async ({ trigger, response, type }) => {
      try {
        const keywords = trigger.toLowerCase()
          .replace(/[?!.,;:'"()]/g, "")
          .split(/\s+/)
          .filter(w => w.length > 2);

        const id = promoteToReflex({
          type,
          triggerPattern: trigger,
          triggerKeywords: keywords,
          responseTemplate: response,
          qualityScore: 0.9,
          promotedFrom: "manual",
        });

        return { content: [{ type: "text" as const, text: `Reflex #${id} created: "${trigger}" → instant response. System 1 will handle this from now on.` }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
