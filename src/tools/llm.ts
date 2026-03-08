import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addProvider,
  listConfiguredProviders,
  setDefaultProvider,
  removeProvider,
  getProviderPresets,
  getUsageStats,
  addCustomProvider,
  chat,
  smartChat,
  routeTask,
  explainRouting,
  checkOllamaAlive,
  getDefaultConfig,
  type LLMMessage,
  type TaskCategory,
  type TaskComplexity,
} from "../core/llm-connector.js";
import {
  runAgentLoop,
  registerAllInternalTools,
  listSessions,
} from "../core/agent-loop.js";
import {
  getTokenSavingsStats,
  getCacheStats,
  cleanExpiredCache,
} from "../core/smart-cache.js";

export function registerLLMTools(server: McpServer) {

  server.tool(
    "soul_llm_add",
    "Add/configure an LLM provider for Soul's brain. Supports: ollama (free local), openai, anthropic, gemini, groq, deepseek, together. Example: soul_llm_add({ providerId: 'ollama', modelId: 'qwen3-coder:32b', isDefault: true })",
    {
      providerId: z.enum(["ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "together"]).describe("Provider to add"),
      modelId: z.string().describe("Model ID (e.g. 'qwen3-coder:32b', 'gpt-4o', 'claude-sonnet-4-6')"),
      apiKey: z.string().optional().describe("API key (not needed for Ollama)"),
      customBaseUrl: z.string().optional().describe("Override default base URL"),
      isDefault: z.boolean().default(true).describe("Set as default provider"),
    },
    async ({ providerId, modelId, apiKey, customBaseUrl, isDefault }) => {
      const result = addProvider({ providerId, modelId, apiKey, customBaseUrl, isDefault });
      return {
        content: [{ type: "text" as const, text: result.success ? `✓ ${result.message}` : `✗ ${result.message}` }],
      };
    }
  );

  server.tool(
    "soul_llm_list",
    "List all configured LLM providers and which is default.",
    {},
    async () => {
      const providers = listConfiguredProviders();
      if (providers.length === 0) {
        return { content: [{ type: "text" as const, text: "No LLM providers configured.\n\nQuick start:\n  soul_llm_add({ providerId: 'ollama', modelId: 'qwen3-coder:32b', isDefault: true })" }] };
      }

      let text = "=== Configured LLM Providers ===\n\n";
      for (const p of providers) {
        const marker = p.isDefault ? " ★ DEFAULT" : "";
        const status = p.isActive ? "active" : "disabled";
        text += `${p.providerName} / ${p.modelName}${marker}\n  ID: ${p.providerId}/${p.modelId} [${status}]\n\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_llm_default",
    "Set which LLM provider/model Soul uses by default.",
    {
      providerId: z.string().describe("Provider ID"),
      modelId: z.string().describe("Model ID"),
    },
    async ({ providerId, modelId }) => {
      const ok = setDefaultProvider(providerId, modelId);
      return {
        content: [{ type: "text" as const, text: ok ? `Default set to ${providerId}/${modelId}` : `Failed — provider not found or inactive.` }],
      };
    }
  );

  server.tool(
    "soul_llm_models",
    "List all available models from all providers (including ones not yet configured).",
    {
      provider: z.string().optional().describe("Filter by provider ID"),
    },
    async ({ provider }) => {
      const presets = getProviderPresets();
      let text = "=== Available LLM Models ===\n\n";

      const keys = provider ? [provider] : Object.keys(presets);
      for (const key of keys) {
        const p = presets[key];
        if (!p) continue;
        text += `── ${p.name} ──\n`;
        text += `  Type: ${p.type} | Base URL: ${p.baseUrl}\n`;
        for (const m of p.models) {
          const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
          const cost = m.costInputPerM === 0 ? "FREE" : `$${m.costInputPerM}/$${m.costOutputPerM} per 1M tokens`;
          text += `  • ${m.displayName} (${m.id})${tags}\n`;
          text += `    Context: ${(m.contextWindow / 1024).toFixed(0)}K | Max output: ${(m.maxOutput / 1024).toFixed(0)}K | Tools: ${m.supportsTools ? "✓" : "✗"} | Vision: ${m.supportsVision ? "✓" : "✗"} | ${cost}\n`;
        }
        text += "\n";
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_llm_chat",
    "Chat with Soul's LLM brain directly. Send a message and get a response from the configured LLM.",
    {
      message: z.string().describe("Message to send"),
      systemPrompt: z.string().optional().describe("Override system prompt"),
      providerId: z.string().optional().describe("Use specific provider (otherwise uses default)"),
      modelId: z.string().optional().describe("Use specific model"),
      temperature: z.number().min(0).max(2).optional().describe("Temperature (0-2, default 0.7)"),
    },
    async ({ message, systemPrompt, providerId, modelId, temperature }) => {
      try {
        const messages: LLMMessage[] = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        } else {
          messages.push({
            role: "system",
            content: "You are Soul, a loyal AI companion. You remember everything, learn from interactions, and grow smarter over time. Respond helpfully and warmly.",
          });
        }
        messages.push({ role: "user", content: message });

        const response = await chat(messages, { providerId, modelId, temperature });
        let text = response.content || "(no response)";
        text += `\n\n─── ${response.provider}/${response.model} | ${response.usage.totalTokens} tokens ───`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `LLM Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_llm_usage",
    "See LLM usage stats — total calls, tokens, costs, breakdown by provider.",
    {},
    async () => {
      const stats = getUsageStats();

      let text = `=== LLM Usage Stats ===\n\n`;
      text += `Total calls: ${stats.totalCalls}\n`;
      text += `Total tokens: ${stats.totalTokens.toLocaleString()}\n`;
      text += `Total cost: $${stats.totalCostUsd.toFixed(4)}\n\n`;

      if (stats.byProvider.length > 0) {
        text += `By Provider:\n`;
        for (const p of stats.byProvider) {
          text += `  ${p.provider}: ${p.calls} calls, ${p.tokens?.toLocaleString() || 0} tokens, $${(p.cost || 0).toFixed(4)}\n`;
        }
      }

      if (stats.last7Days.length > 0) {
        text += `\nLast 7 Days:\n`;
        for (const d of stats.last7Days) {
          text += `  ${d.date}: ${d.calls} calls, $${(d.cost || 0).toFixed(4)}\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_llm_custom",
    "Add a custom LLM provider (any OpenAI-compatible API). For providers not in the preset list.",
    {
      id: z.string().describe("Unique provider ID (e.g. 'my-local-llm')"),
      name: z.string().describe("Display name"),
      baseUrl: z.string().describe("Base URL (e.g. 'http://localhost:8080/v1')"),
      apiKey: z.string().default("").describe("API key if needed"),
      modelId: z.string().describe("Model ID to use"),
      modelName: z.string().describe("Display name for the model"),
      contextWindow: z.number().optional().describe("Context window size (default 128K)"),
      isDefault: z.boolean().default(false).describe("Set as default"),
    },
    async ({ id, name, baseUrl, apiKey, modelId, modelName, contextWindow, isDefault }) => {
      const result = addCustomProvider({ id, name, type: "openai-compatible", baseUrl, apiKey, modelId, modelName, contextWindow, isDefault });
      return { content: [{ type: "text" as const, text: result.success ? `✓ ${result.message}` : `✗ ${result.message}` }] };
    }
  );

  server.tool(
    "soul_llm_remove",
    "Disable/remove an LLM provider configuration.",
    {
      providerId: z.string().describe("Provider ID"),
      modelId: z.string().describe("Model ID"),
    },
    async ({ providerId, modelId }) => {
      const ok = removeProvider(providerId, modelId);
      return {
        content: [{ type: "text" as const, text: ok ? `Removed ${providerId}/${modelId}` : `Not found or already removed.` }],
      };
    }
  );

  // ─── Agent Mode — Soul thinks and acts autonomously ───

  server.tool(
    "soul_agent",
    "Talk to Soul as an autonomous agent. Soul will THINK, pick tools, execute them, and give you a complete answer — like talking to qwen3-coder or Claude Code. This is Soul's brain.",
    {
      message: z.string().describe("What you want Soul to do/answer"),
      sessionId: z.string().optional().describe("Session ID for conversation continuity (auto-generated if not set)"),
      maxIterations: z.number().optional().describe("Max thinking loops (default 10)"),
      temperature: z.number().optional().describe("Temperature 0-2 (default 0.7)"),
      providerId: z.string().optional().describe("Override provider"),
      modelId: z.string().optional().describe("Override model"),
    },
    async ({ message, sessionId, maxIterations, temperature, providerId, modelId }) => {
      try {
        // Ensure internal tools are registered
        registerAllInternalTools();

        const { saveConversationTurn, getConversationHistory } = await import("../core/agent-loop.js");

        const sid = sessionId || `session_${Date.now()}`;

        // Get history for this session
        const history = getConversationHistory(sid, 20);

        // Save user message
        saveConversationTurn(sid, "user", message);

        // Run agent loop
        const result = await runAgentLoop(message, {
          providerId,
          modelId,
          maxIterations,
          temperature,
          history,
        });

        // Save Soul's reply
        saveConversationTurn(sid, "assistant", result.reply);

        let text = result.reply;
        text += `\n\n─── Soul Agent ───`;
        text += `\nModel: ${result.provider}/${result.model}`;
        text += `\nIterations: ${result.iterations} | Tokens: ${result.totalTokens}`;
        if (result.toolsUsed.length > 0) {
          text += `\nTools used: ${[...new Set(result.toolsUsed)].join(", ")}`;
        }
        text += `\nSession: ${sid}`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Agent Error: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_agent_sessions",
    "List recent Soul agent chat sessions.",
    {},
    async () => {
      const sessions = listSessions(10);
      if (sessions.length === 0) {
        return { content: [{ type: "text" as const, text: "No agent sessions yet. Start one with soul_agent." }] };
      }
      let text = "=== Soul Agent Sessions ===\n\n";
      for (const s of sessions) {
        text += `${s.sessionId} — ${s.messageCount} messages, last: ${s.lastMessage}\n`;
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── Token Savings Dashboard ───

  server.tool(
    "soul_token_savings",
    "See how much tokens Soul has saved by learning — cache hits, knowledge lookups, daily trends. Shows how Soul gets cheaper over time.",
    {},
    async () => {
      const savings = getTokenSavingsStats();
      const cache = getCacheStats();

      let text = `=== Token Savings Dashboard ===\n\n`;
      text += `Total tokens used: ${savings.totalUsed.toLocaleString()}\n`;
      text += `Total tokens saved: ${savings.totalSaved.toLocaleString()}\n`;
      text += `Savings rate: ${savings.savingsRate}\n`;
      text += `Cache hit rate: ${savings.cacheHitRate}\n`;
      text += `Knowledge hits: ${savings.knowledgeHits}\n\n`;

      text += `Cache: ${cache.totalEntries} entries, ${cache.totalHits} total hits\n`;

      if (cache.topQueries.length > 0) {
        text += `\nTop cached queries:\n`;
        for (const q of cache.topQueries.slice(0, 5)) {
          text += `  ${q.hits}x hits — "${q.query.substring(0, 60)}..." (saved ${q.saved} tokens)\n`;
        }
      }

      if (savings.byDay.length > 0) {
        text += `\nDaily trend:\n`;
        for (const d of savings.byDay.slice(0, 7)) {
          const bar = "█".repeat(Math.min(20, Math.round(parseFloat(d.rate) / 5)));
          text += `  ${d.date}: used ${d.used}, saved ${d.saved} (${d.rate}) ${bar}\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_cache_clean",
    "Clean expired cache entries.",
    {},
    async () => {
      const removed = cleanExpiredCache();
      return { content: [{ type: "text" as const, text: `Cleaned ${removed} expired cache entries.` }] };
    }
  );

  // ─── Smart Router Tools ───

  server.tool(
    "soul_smart_chat",
    "Smart chat — Soul auto-picks the best model based on task complexity. ฉลาดเลือก Ollama (ฟรี) หรือ API (ถ้ามี) ตามความยากของงาน",
    {
      message: z.string().describe("Your message / question / task"),
      category: z.enum(["chat", "code", "analysis", "creative", "translation", "reasoning", "tool_use"]).optional()
        .describe("Task category (auto-detected if not set)"),
      complexity: z.enum(["simple", "moderate", "complex", "expert"]).optional()
        .describe("Task complexity (auto-detected if not set)"),
      preferFree: z.boolean().default(true).describe("Prefer free models (default: true)"),
      maxCostUsd: z.number().optional().describe("Max cost per call in USD (0 = free only)"),
      systemPrompt: z.string().optional().describe("System prompt override"),
    },
    async ({ message, category, complexity, preferFree, maxCostUsd, systemPrompt }) => {
      try {
        const messages: LLMMessage[] = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        else messages.push({ role: "system", content: "You are Soul, a helpful AI assistant. Respond in the same language as the user." });
        messages.push({ role: "user", content: message });

        const result = await smartChat(messages, {
          category: category as TaskCategory | undefined,
          complexity: complexity as TaskComplexity | undefined,
          preferFree,
          maxCostUsd,
        });

        const d = result.routeDecision;
        const header = `[${d.modelName}] ${d.isFree ? "🟢 ฟรี" : "💰 " + d.estimatedCost.toFixed(4) + " USD"} | ${d.reason}\n\n`;

        return { content: [{ type: "text" as const, text: header + (result.content || "(no response)") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_route_explain",
    "Show how Soul routes different tasks — which model for which complexity/category. ดูว่า Soul จะเลือก model ไหนสำหรับงานแบบต่างๆ",
    {},
    async () => {
      const routes = explainRouting();
      let text = `=== Smart Router — Model Selection Map ===\n\n`;
      text += `${"Complexity".padEnd(12)} ${"Category".padEnd(12)} ${"Model".padEnd(25)} ${"Cost".padEnd(10)} Reason\n`;
      text += `${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(25)} ${"─".repeat(10)} ${"─".repeat(20)}\n`;

      for (const r of routes) {
        const cost = r.decision.isFree ? "🟢 FREE" : `💰 $${r.decision.estimatedCost.toFixed(4)}`;
        text += `${r.complexity.padEnd(12)} ${r.category.padEnd(12)} ${r.decision.modelName.padEnd(25)} ${cost.padEnd(10)} ${r.decision.reason}\n`;
      }

      // Check Ollama
      const ollamaUp = await checkOllamaAlive();
      text += `\nOllama: ${ollamaUp ? "🟢 Running" : "🔴 Offline"}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_route_test",
    "Test how Soul would route a specific text — see which model it picks and why.",
    {
      text: z.string().describe("Sample text/task to route"),
      preferFree: z.boolean().default(true).describe("Prefer free models"),
    },
    async ({ text, preferFree }) => {
      const decision = routeTask({ text, preferFree });
      const label = decision.isFree ? "🟢 ฟรี" : `💰 ~$${decision.estimatedCost.toFixed(4)}`;
      return { content: [{ type: "text" as const, text:
        `Route: ${decision.modelName} (${decision.providerId})\n` +
        `Cost: ${label}\n` +
        `Reason: ${decision.reason}`
      }] };
    }
  );
}
