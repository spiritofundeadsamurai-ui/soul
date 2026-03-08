/**
 * Universal LLM Connector — Connect Soul to ANY LLM provider
 *
 * Supported providers:
 * - Ollama (local, free)
 * - OpenAI (GPT-4o, GPT-5, o3, o4-mini)
 * - Anthropic Claude (Haiku, Sonnet, Opus)
 * - Google Gemini (Flash, Pro)
 * - Groq (ultra-fast inference)
 * - DeepSeek (budget)
 * - Together AI
 * - Fireworks AI
 * - Any OpenAI-compatible API
 *
 * Features:
 * - Switch provider/model at runtime
 * - Version management (pin specific model versions)
 * - Tool routing (send only relevant tools per turn)
 * - Conversation history management
 * - Streaming support ready
 * - Cost tracking
 */

import { getRawDb } from "../db/index.js";

// ─── Types ───

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: "ollama" | "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
  isActive: boolean;
  isDefault: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costInputPerM: number;  // $ per 1M input tokens
  costOutputPerM: number; // $ per 1M output tokens
  version?: string;
  tags: string[];         // "latest", "stable", "preview", "free"
}

// ─── Provider Registry ───

const PROVIDER_PRESETS: Record<string, Omit<ProviderConfig, "apiKey" | "isActive" | "isDefault">> = {
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    models: [
      { id: "qwen3-coder:32b", name: "qwen3-coder:32b", displayName: "Qwen3 Coder 32B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local", "recommended"] },
      { id: "qwen3-coder:14b", name: "qwen3-coder:14b", displayName: "Qwen3 Coder 14B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local"] },
      { id: "qwen3:32b", name: "qwen3:32b", displayName: "Qwen3 32B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local"] },
      { id: "qwen3:14b", name: "qwen3:14b", displayName: "Qwen3 14B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local", "recommended"] },
      { id: "qwen3:8b", name: "qwen3:8b", displayName: "Qwen3 8B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local", "lightweight"] },
      { id: "mistral-small3.2", name: "mistral-small3.2", displayName: "Mistral Small 3.2", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: true, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local"] },
      { id: "phi4", name: "phi4", displayName: "Phi-4 14B", contextWindow: 16384, maxOutput: 4096, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local"] },
      { id: "llama3.3", name: "llama3.3", displayName: "Llama 3.3 70B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local", "large"] },
      { id: "gemma3:27b", name: "gemma3:27b", displayName: "Gemma 3 27B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: true, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local"] },
      { id: "glm-4.7-flash", name: "glm-4.7-flash", displayName: "GLM 4.7 Flash", contextWindow: 131072, maxOutput: 4096, supportsTools: true, supportsVision: false, costInputPerM: 0, costOutputPerM: 0, tags: ["free", "local", "lightweight"] },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o-mini", name: "gpt-4o-mini", displayName: "GPT-4o Mini", contextWindow: 128000, maxOutput: 16384, supportsTools: true, supportsVision: true, costInputPerM: 0.15, costOutputPerM: 0.60, tags: ["budget", "fast"] },
      { id: "gpt-4o", name: "gpt-4o", displayName: "GPT-4o", contextWindow: 128000, maxOutput: 16384, supportsTools: true, supportsVision: true, costInputPerM: 2.50, costOutputPerM: 10.00, tags: ["recommended"] },
      { id: "gpt-5", name: "gpt-5", displayName: "GPT-5", contextWindow: 1000000, maxOutput: 32768, supportsTools: true, supportsVision: true, costInputPerM: 1.25, costOutputPerM: 10.00, tags: ["latest", "flagship"] },
      { id: "o4-mini", name: "o4-mini", displayName: "o4-mini (Reasoning)", contextWindow: 200000, maxOutput: 100000, supportsTools: true, supportsVision: true, costInputPerM: 1.10, costOutputPerM: 4.40, tags: ["reasoning"] },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: [
      { id: "claude-haiku-4-5-20251001", name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 8192, supportsTools: true, supportsVision: true, costInputPerM: 1.00, costOutputPerM: 5.00, tags: ["budget", "fast"] },
      { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", contextWindow: 1000000, maxOutput: 64000, supportsTools: true, supportsVision: true, costInputPerM: 3.00, costOutputPerM: 15.00, tags: ["recommended", "latest"] },
      { id: "claude-opus-4-6", name: "claude-opus-4-6", displayName: "Claude Opus 4.6", contextWindow: 1000000, maxOutput: 64000, supportsTools: true, supportsVision: true, costInputPerM: 5.00, costOutputPerM: 25.00, tags: ["flagship", "latest"] },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    type: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-2.5-flash", name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", contextWindow: 1048576, maxOutput: 65536, supportsTools: true, supportsVision: true, costInputPerM: 0.15, costOutputPerM: 0.60, tags: ["budget", "fast", "recommended"] },
      { id: "gemini-2.5-pro", name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", contextWindow: 2097152, maxOutput: 65536, supportsTools: true, supportsVision: true, costInputPerM: 1.25, costOutputPerM: 10.00, tags: ["flagship"] },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq (Ultra-Fast)",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.1-8b-instant", name: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0.05, costOutputPerM: 0.08, tags: ["budget", "ultra-fast"] },
      { id: "qwen-qwq-32b", name: "qwen-qwq-32b", displayName: "Qwen QwQ 32B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0.29, costOutputPerM: 0.59, tags: ["recommended", "fast"] },
      { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B", contextWindow: 131072, maxOutput: 32768, supportsTools: true, supportsVision: false, costInputPerM: 0.59, costOutputPerM: 0.79, tags: ["quality"] },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", name: "deepseek-chat", displayName: "DeepSeek V3.2", contextWindow: 128000, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0.28, costOutputPerM: 0.42, tags: ["budget", "recommended"] },
      { id: "deepseek-reasoner", name: "deepseek-reasoner", displayName: "DeepSeek R1", contextWindow: 128000, maxOutput: 65536, supportsTools: true, supportsVision: false, costInputPerM: 0.28, costOutputPerM: 0.42, tags: ["reasoning"] },
    ],
  },
  together: {
    id: "together",
    name: "Together AI",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    models: [
      { id: "Qwen/Qwen3-Coder-32B-Instruct", name: "Qwen/Qwen3-Coder-32B-Instruct", displayName: "Qwen3 Coder 32B", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0.20, costOutputPerM: 0.20, tags: ["budget"] },
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "meta-llama/Llama-3.3-70B-Instruct-Turbo", displayName: "Llama 3.3 70B Turbo", contextWindow: 131072, maxOutput: 8192, supportsTools: true, supportsVision: false, costInputPerM: 0.59, costOutputPerM: 0.79, tags: ["quality"] },
    ],
  },
};

// ─── Database ───

function ensureLLMTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_llm_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ─── Config Management ───

export function getProviderPresets(): Record<string, any> {
  return PROVIDER_PRESETS;
}

export function addProvider(input: {
  providerId: string;
  apiKey?: string;
  modelId: string;
  customBaseUrl?: string;
  isDefault?: boolean;
}): { success: boolean; message: string } {
  ensureLLMTable();
  const rawDb = getRawDb();

  const preset = PROVIDER_PRESETS[input.providerId];
  if (!preset) {
    return { success: false, message: `Unknown provider "${input.providerId}". Available: ${Object.keys(PROVIDER_PRESETS).join(", ")}` };
  }

  const model = preset.models.find((m: ModelConfig) => m.id === input.modelId);
  if (!model) {
    return { success: false, message: `Unknown model "${input.modelId}" for ${preset.name}. Available: ${preset.models.map((m: ModelConfig) => m.id).join(", ")}` };
  }

  // Check if Ollama needs no API key
  if (input.providerId !== "ollama" && !input.apiKey) {
    return { success: false, message: `API key required for ${preset.name}. Set with apiKey parameter.` };
  }

  // Clear other defaults if this is default
  if (input.isDefault) {
    rawDb.prepare("UPDATE soul_llm_config SET is_default = 0").run();
  }

  // Upsert
  const existing = rawDb.prepare(
    "SELECT id FROM soul_llm_config WHERE provider_id = ? AND model_id = ?"
  ).get(input.providerId, input.modelId) as any;

  if (existing) {
    rawDb.prepare(
      `UPDATE soul_llm_config SET api_key = ?, base_url = ?, is_default = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(input.apiKey || "", input.customBaseUrl || preset.baseUrl, input.isDefault ? 1 : 0, existing.id);
  } else {
    rawDb.prepare(
      `INSERT INTO soul_llm_config (provider_id, provider_name, provider_type, base_url, api_key, model_id, model_name, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.providerId, preset.name, preset.type, input.customBaseUrl || preset.baseUrl, input.apiKey || "", input.modelId, model.displayName, input.isDefault ? 1 : 0);
  }

  return { success: true, message: `${preset.name} / ${model.displayName} configured${input.isDefault ? " (default)" : ""}.` };
}

export function setDefaultProvider(providerId: string, modelId: string): boolean {
  ensureLLMTable();
  const rawDb = getRawDb();
  rawDb.prepare("UPDATE soul_llm_config SET is_default = 0").run();
  const result = rawDb.prepare(
    "UPDATE soul_llm_config SET is_default = 1 WHERE provider_id = ? AND model_id = ? AND is_active = 1"
  ).run(providerId, modelId);
  return result.changes > 0;
}

export function getDefaultConfig(): { providerId: string; providerType: string; baseUrl: string; apiKey: string; modelId: string; modelName: string } | null {
  ensureLLMTable();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_llm_config WHERE is_default = 1 AND is_active = 1 LIMIT 1"
  ).get() as any;
  if (!row) return null;
  return {
    providerId: row.provider_id,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    modelId: row.model_id,
    modelName: row.model_name,
  };
}

export function listConfiguredProviders(): Array<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  isDefault: boolean;
  isActive: boolean;
}> {
  ensureLLMTable();
  const rawDb = getRawDb();
  return (rawDb.prepare("SELECT * FROM soul_llm_config ORDER BY is_default DESC, provider_name").all() as any[]).map(r => ({
    providerId: r.provider_id,
    providerName: r.provider_name,
    modelId: r.model_id,
    modelName: r.model_name,
    isDefault: r.is_default === 1,
    isActive: r.is_active === 1,
  }));
}

export function removeProvider(providerId: string, modelId: string): boolean {
  ensureLLMTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_llm_config SET is_active = 0 WHERE provider_id = ? AND model_id = ?"
  ).run(providerId, modelId);
  return result.changes > 0;
}

// ─── Chat Completion ───

export async function chat(
  messages: LLMMessage[],
  options?: {
    providerId?: string;
    modelId?: string;
    tools?: LLMToolDef[];
    temperature?: number;
    maxTokens?: number;
  }
): Promise<LLMResponse> {
  ensureLLMTable();

  // Get config
  let config: any;
  if (options?.providerId && options?.modelId) {
    const rawDb = getRawDb();
    config = rawDb.prepare(
      "SELECT * FROM soul_llm_config WHERE provider_id = ? AND model_id = ? AND is_active = 1"
    ).get(options.providerId, options.modelId) as any;
  }
  if (!config) {
    const def = getDefaultConfig();
    if (!def) throw new Error("No LLM configured. Use soul_llm_add to add a provider first.");
    config = { provider_type: def.providerType, base_url: def.baseUrl, api_key: def.apiKey, model_id: def.modelId, provider_id: def.providerId };
  }

  const temperature = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;

  let response: LLMResponse;

  switch (config.provider_type) {
    case "ollama":
      response = await chatOllama(config, messages, options?.tools, temperature, maxTokens);
      break;
    case "openai-compatible":
      response = await chatOpenAI(config, messages, options?.tools, temperature, maxTokens);
      break;
    case "anthropic":
      response = await chatAnthropic(config, messages, options?.tools, temperature, maxTokens);
      break;
    case "google":
      response = await chatGemini(config, messages, options?.tools, temperature, maxTokens);
      break;
    default:
      throw new Error(`Unknown provider type: ${config.provider_type}`);
  }

  // Track usage
  trackUsage(config.provider_id, config.model_id, response.usage);

  return response;
}

// ─── Provider Implementations ───

async function chatOllama(
  config: any, messages: LLMMessage[], tools?: LLMToolDef[], temperature?: number, maxTokens?: number
): Promise<LLMResponse> {
  // Ollama supports OpenAI-compatible API at /v1/chat/completions
  const url = `${config.base_url}/v1/chat/completions`;

  // Prepare messages — for qwen3 models, prepend /no_think to disable thinking mode
  // (qwen3 uses thinking tokens by default, which can return empty content)
  const isQwen3 = /qwen3/i.test(config.model_id);
  let formattedMessages = messages.map(formatOpenAIMessage);

  if (isQwen3) {
    // Find the last user message and prepend /no_think to disable thinking mode
    const lastUserIdx = formattedMessages.map((m: any) => m.role).lastIndexOf("user");
    if (lastUserIdx >= 0) {
      formattedMessages = [...formattedMessages];
      formattedMessages[lastUserIdx] = {
        ...formattedMessages[lastUserIdx],
        content: "/no_think\n" + (formattedMessages[lastUserIdx].content || ""),
      };
    }
  }

  const body: any = {
    model: config.model_id,
    messages: formattedMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 4096,
    options: { num_predict: maxTokens || 4096 },
  };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error (${res.status}): ${text}`);
  }

  const data = await res.json() as any;
  const response = parseOpenAIResponse(data, "ollama");

  // Fallback: if content is null, check for reasoning_content (thinking models)
  if (response.content === null) {
    const msg = data.choices?.[0]?.message;
    if (msg?.reasoning_content) {
      response.content = msg.reasoning_content;
    }
  }

  return response;
}

async function chatOpenAI(
  config: any, messages: LLMMessage[], tools?: LLMToolDef[], temperature?: number, maxTokens?: number
): Promise<LLMResponse> {
  const url = `${config.base_url}/chat/completions`;

  const body: any = {
    model: config.model_id,
    messages: messages.map(formatOpenAIMessage),
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) body.tools = tools;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.api_key}`,
  };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${config.provider_id} error (${res.status}): ${text.substring(0, 300)}`);
  }

  const data = await res.json() as any;
  return parseOpenAIResponse(data, config.provider_id);
}

async function chatAnthropic(
  config: any, messages: LLMMessage[], tools?: LLMToolDef[], temperature?: number, maxTokens?: number
): Promise<LLMResponse> {
  const url = `${config.base_url}/v1/messages`;

  // Convert to Anthropic format
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystemMsgs = messages.filter(m => m.role !== "system");

  const anthropicMessages = nonSystemMsgs.map(m => {
    if (m.role === "tool") {
      return {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: m.tool_call_id || "", content: m.content }],
      };
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
      return { role: "assistant" as const, content };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const body: any = {
    model: config.model_id,
    max_tokens: maxTokens ?? 4096,
    messages: anthropicMessages,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (temperature !== undefined) body.temperature = temperature;
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error (${res.status}): ${text.substring(0, 300)}`);
  }

  const data = await res.json() as any;

  // Parse Anthropic response
  const toolCalls: LLMToolCall[] = [];
  let textContent = "";
  for (const block of data.content || []) {
    if (block.type === "text") textContent += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  return {
    content: textContent || null,
    toolCalls,
    model: data.model,
    provider: "anthropic",
    usage: {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
    finishReason: data.stop_reason || "end_turn",
  };
}

async function chatGemini(
  config: any, messages: LLMMessage[], tools?: LLMToolDef[], temperature?: number, maxTokens?: number
): Promise<LLMResponse> {
  // SECURITY: API key in header, not URL (prevents key leak in logs)
  const url = `${config.base_url}/models/${config.model_id}:generateContent`;

  // Convert to Gemini format
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystemMsgs = messages.filter(m => m.role !== "system");

  const contents = nonSystemMsgs.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens ?? 4096,
    },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  if (tools && tools.length > 0) {
    body.tools = [{
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.api_key,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error (${res.status}): ${text.substring(0, 300)}`);
  }

  const data = await res.json() as any;
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let textContent = "";
  const toolCalls: LLMToolCall[] = [];
  for (const part of parts) {
    if (part.text) textContent += part.text;
    if (part.functionCall) {
      toolCalls.push({
        id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }

  return {
    content: textContent || null,
    toolCalls,
    model: config.model_id,
    provider: "google",
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0,
    },
    finishReason: candidate?.finishReason || "STOP",
  };
}

// ─── Helpers ───

function formatOpenAIMessage(m: LLMMessage): any {
  const msg: any = { role: m.role, content: m.content };
  if (m.name) msg.name = m.name;
  if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
  if (m.tool_calls) msg.tool_calls = m.tool_calls;
  return msg;
}

function parseOpenAIResponse(data: any, provider: string): LLMResponse {
  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  return {
    content: msg.content || null,
    toolCalls: msg.tool_calls || [],
    model: data.model || "unknown",
    provider,
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    },
    finishReason: choice?.finish_reason || "stop",
  };
}

function trackUsage(providerId: string, modelId: string, usage: LLMResponse["usage"]) {
  try {
    const rawDb = getRawDb();
    const preset = PROVIDER_PRESETS[providerId];
    const model = preset?.models.find((m: ModelConfig) => m.id === modelId);
    const cost = model
      ? (usage.inputTokens / 1_000_000 * model.costInputPerM) + (usage.outputTokens / 1_000_000 * model.costOutputPerM)
      : 0;

    rawDb.prepare(
      "INSERT INTO soul_llm_usage (provider_id, model_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)"
    ).run(providerId, modelId, usage.inputTokens, usage.outputTokens, Math.round(cost * 10000) / 10000);
  } catch { /* ignore tracking errors */ }
}

// ─── Usage Stats ───

export function getUsageStats(): {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Array<{ provider: string; calls: number; tokens: number; cost: number }>;
  last7Days: Array<{ date: string; calls: number; cost: number }>;
} {
  ensureLLMTable();
  const rawDb = getRawDb();

  const total = rawDb.prepare(
    "SELECT COUNT(*) as calls, SUM(input_tokens + output_tokens) as tokens, SUM(cost_usd) as cost FROM soul_llm_usage"
  ).get() as any;

  const byProvider = rawDb.prepare(
    `SELECT provider_id as provider, COUNT(*) as calls, SUM(input_tokens + output_tokens) as tokens, SUM(cost_usd) as cost
     FROM soul_llm_usage GROUP BY provider_id ORDER BY cost DESC`
  ).all() as any[];

  const last7Days = rawDb.prepare(
    `SELECT DATE(created_at) as date, COUNT(*) as calls, SUM(cost_usd) as cost
     FROM soul_llm_usage WHERE created_at >= datetime('now', '-7 days')
     GROUP BY DATE(created_at) ORDER BY date`
  ).all() as any[];

  return {
    totalCalls: total?.calls || 0,
    totalTokens: total?.tokens || 0,
    totalCostUsd: Math.round((total?.cost || 0) * 10000) / 10000,
    byProvider,
    last7Days,
  };
}

// ─── Add Custom Provider ───

export function addCustomProvider(input: {
  id: string;
  name: string;
  type: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
  isDefault?: boolean;
}): { success: boolean; message: string } {
  ensureLLMTable();
  const rawDb = getRawDb();

  if (input.isDefault) {
    rawDb.prepare("UPDATE soul_llm_config SET is_default = 0").run();
  }

  rawDb.prepare(
    `INSERT INTO soul_llm_config (provider_id, provider_name, provider_type, base_url, api_key, model_id, model_name, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.id, input.name, input.type, input.baseUrl, input.apiKey, input.modelId, input.modelName, input.isDefault ? 1 : 0);

  // Add to presets dynamically for this session
  if (!PROVIDER_PRESETS[input.id]) {
    (PROVIDER_PRESETS as any)[input.id] = {
      id: input.id,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      models: [{
        id: input.modelId,
        name: input.modelId,
        displayName: input.modelName,
        contextWindow: input.contextWindow || 128000,
        maxOutput: 8192,
        supportsTools: true,
        supportsVision: false,
        costInputPerM: 0,
        costOutputPerM: 0,
        tags: ["custom"],
      }],
    };
  }

  return { success: true, message: `Custom provider "${input.name}" added with model "${input.modelName}".` };
}

// ─── Smart Router — Soul picks the best model automatically ───

export type TaskComplexity = "simple" | "moderate" | "complex" | "expert";
export type TaskCategory = "chat" | "code" | "analysis" | "creative" | "translation" | "reasoning" | "tool_use";

interface RouteDecision {
  providerId: string;
  modelId: string;
  modelName: string;
  reason: string;
  estimatedCost: number; // USD per call (0 = free)
  isFree: boolean;
}

/**
 * Smart Router — Soul analyzes the task and picks the best model
 *
 * Strategy:
 * 1. Simple tasks → always use local Ollama (free)
 * 2. Moderate tasks → local if good model available, else cheapest API
 * 3. Complex tasks → best available (API if configured, else local)
 * 4. Expert tasks → strongest model (Claude/GPT if keys available)
 *
 * Also considers:
 * - Is Ollama running?
 * - Which API keys are configured?
 * - Budget preference (free-only vs allow-paid)
 * - Task category (code → coder model, reasoning → reasoning model)
 */
export function routeTask(input: {
  text: string;
  category?: TaskCategory;
  complexity?: TaskComplexity;
  requireTools?: boolean;
  preferFree?: boolean;  // default true
  maxCostUsd?: number;   // per-call budget limit
}): RouteDecision {
  ensureLLMTable();
  const rawDb = getRawDb();

  // Auto-detect complexity if not provided
  const complexity = input.complexity || detectComplexity(input.text);
  const category = input.category || detectCategory(input.text);
  const preferFree = input.preferFree !== false; // default true
  const maxCost = input.maxCostUsd ?? (preferFree ? 0 : 0.05);

  // Get all configured providers
  const configs = rawDb.prepare(
    "SELECT * FROM soul_llm_config WHERE is_active = 1 ORDER BY is_default DESC"
  ).all() as any[];

  // Check if Ollama is reachable (cached for 60s)
  const ollamaAlive = isOllamaAlive();

  // Build candidate list
  const candidates: Array<RouteDecision & { score: number }> = [];

  for (const cfg of configs) {
    const preset = PROVIDER_PRESETS[cfg.provider_id];
    const model = preset?.models.find((m: ModelConfig) => m.id === cfg.model_id);
    if (!model) continue;

    // Skip Ollama if not running
    if (cfg.provider_type === "ollama" && !ollamaAlive) continue;

    // Skip paid if preferFree and cost > 0
    const estimatedTokens = estimateTokens(input.text);
    const estimatedCost = (estimatedTokens / 1_000_000 * model.costInputPerM) + (estimatedTokens * 2 / 1_000_000 * model.costOutputPerM);
    const isFree = model.costInputPerM === 0 && model.costOutputPerM === 0;

    if (preferFree && !isFree && maxCost === 0) continue;
    if (estimatedCost > maxCost && maxCost > 0) continue;

    // Skip models that don't support tools if tools needed
    if (input.requireTools && !model.supportsTools) continue;

    // Score the model for this task
    let score = 0;

    // Quality scoring by model capability
    const modelSize = extractModelSize(model.id);
    score += Math.min(modelSize / 5, 20); // bigger = better, max 20

    // Category match bonus
    if (category === "code" && (model.id.includes("coder") || model.tags.includes("code"))) score += 15;
    if (category === "reasoning" && (model.id.includes("reason") || model.id.includes("r1") || model.id.includes("o4"))) score += 15;
    if (category === "creative" && modelSize >= 14) score += 10;

    // Complexity match
    if (complexity === "simple") {
      // Prefer lightweight models for simple tasks
      if (modelSize <= 8) score += 10;
      if (isFree) score += 20;
    } else if (complexity === "moderate") {
      if (modelSize >= 8 && modelSize <= 32) score += 10;
      if (isFree) score += 15;
    } else if (complexity === "complex") {
      if (modelSize >= 14) score += 10;
      // Allow paid if much better
      if (!isFree && modelSize >= 70) score += 5;
    } else if (complexity === "expert") {
      if (modelSize >= 32) score += 15;
      // Expert tasks benefit from top-tier models
      if (model.tags.includes("flagship")) score += 20;
    }

    // Free bonus (always prefer free when quality is similar)
    if (isFree) score += 10;

    // Default provider bonus
    if (cfg.is_default) score += 5;

    // Tool support
    if (model.supportsTools) score += 3;

    // Context window (bigger is better for complex tasks)
    if (complexity === "complex" || complexity === "expert") {
      if (model.contextWindow >= 128000) score += 5;
    }

    candidates.push({
      providerId: cfg.provider_id,
      modelId: cfg.model_id,
      modelName: model.displayName,
      reason: "",
      estimatedCost,
      isFree,
      score,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // Fallback: return default or Ollama
    return {
      providerId: "ollama",
      modelId: "qwen3:14b",
      modelName: "Qwen3 14B (fallback)",
      reason: "ไม่พบ provider ที่ใช้ได้ — ใช้ Ollama default",
      estimatedCost: 0,
      isFree: true,
    };
  }

  const winner = candidates[0];
  const reasons: string[] = [];

  if (winner.isFree) reasons.push("ฟรี");
  else reasons.push(`~$${winner.estimatedCost.toFixed(4)}/call`);

  reasons.push(`${complexity} task`);
  if (category !== "chat") reasons.push(category);
  if (candidates.length > 1) reasons.push(`เลือกจาก ${candidates.length} ตัวเลือก`);

  winner.reason = reasons.join(" | ");
  return winner;
}

/**
 * Smart chat — auto-routes to best model, then calls it
 */
export async function smartChat(
  messages: LLMMessage[],
  options?: {
    category?: TaskCategory;
    complexity?: TaskComplexity;
    requireTools?: boolean;
    preferFree?: boolean;
    maxCostUsd?: number;
    tools?: LLMToolDef[];
    temperature?: number;
    maxTokens?: number;
  }
): Promise<LLMResponse & { routeDecision: RouteDecision }> {
  // Refresh Ollama alive cache before routing
  await checkOllamaAlive();

  const userText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");

  const decision = routeTask({
    text: userText,
    category: options?.category,
    complexity: options?.complexity,
    requireTools: options?.requireTools || (options?.tools && options.tools.length > 0),
    preferFree: options?.preferFree,
    maxCostUsd: options?.maxCostUsd,
  });

  const response = await chat(messages, {
    providerId: decision.providerId,
    modelId: decision.modelId,
    tools: options?.tools,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
  });

  return { ...response, routeDecision: decision };
}

/**
 * Get routing explanation — show how Soul would route different tasks
 */
export function explainRouting(): Array<{
  complexity: TaskComplexity;
  category: TaskCategory;
  decision: RouteDecision;
}> {
  const results: Array<{ complexity: TaskComplexity; category: TaskCategory; decision: RouteDecision }> = [];

  const complexities: TaskComplexity[] = ["simple", "moderate", "complex", "expert"];
  const categories: TaskCategory[] = ["chat", "code", "analysis", "reasoning"];

  for (const complexity of complexities) {
    for (const category of categories) {
      const decision = routeTask({
        text: `test ${complexity} ${category}`,
        complexity,
        category,
        preferFree: true,
      });
      results.push({ complexity, category, decision });
    }
  }

  return results;
}

// ─── Smart Router Helpers ───

let ollamaAliveCache: { alive: boolean; checkedAt: number } = { alive: false, checkedAt: 0 };

function isOllamaAlive(): boolean {
  return ollamaAliveCache.alive;
}

// Async version that actually checks Ollama connectivity
export async function checkOllamaAlive(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    const alive = res.ok;
    ollamaAliveCache = { alive, checkedAt: Date.now() };
    return alive;
  } catch {
    ollamaAliveCache = { alive: false, checkedAt: Date.now() };
    return false;
  }
}

function detectComplexity(text: string): TaskComplexity {
  const len = text.length;
  const lower = text.toLowerCase();

  // Expert indicators
  if (/วิเคราะห์เชิงลึก|deep\s*analysis|synthesize|compare\s*and\s*contrast|evaluate|ประเมิน|ออกแบบ|architect/i.test(text)) return "expert";
  if (/research|วิจัย|prove|พิสูจน์|theorem|strategy/i.test(text)) return "expert";

  // Complex indicators
  if (/explain|อธิบาย|analyze|วิเคราะห์|summarize|สรุป|review|debug|refactor/i.test(text)) return "complex";
  if (len > 500) return "complex";

  // Moderate indicators
  if (/write|เขียน|create|สร้าง|translate|แปล|compare|เปรียบเทียบ/i.test(text)) return "moderate";
  if (len > 100) return "moderate";

  return "simple";
}

function detectCategory(text: string): TaskCategory {
  const lower = text.toLowerCase();

  if (/code|โค้ด|function|class|bug|debug|program|compile|typescript|python|javascript|api|sql|query/i.test(text)) return "code";
  if (/reason|think|logic|proof|math|คำนวณ|ตรรก|เหตุผล|solve|problem/i.test(text)) return "reasoning";
  if (/analyze|วิเคราะห์|data|statistics|สถิติ|pattern|trend|report|รายงาน/i.test(text)) return "analysis";
  if (/write|เขียน|story|poem|creative|บทความ|นิยาย|กลอน|compose/i.test(text)) return "creative";
  if (/translate|แปล|ภาษา|language|中文|日本語|한국어/i.test(text)) return "translation";
  if (/tool|function_call|execute|run|ทำ|จัดการ|ตั้งค่า/i.test(text)) return "tool_use";

  return "chat";
}

function estimateTokens(text: string): number {
  // Rough estimate: ~1 token per 4 chars for English, ~1 per 2 for Thai/CJK
  const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const otherChars = text.length - thaiChars;
  return Math.ceil(thaiChars / 2 + otherChars / 4) + 200; // +200 for system prompt overhead
}

function extractModelSize(modelId: string): number {
  // Extract parameter count from model name
  const match = modelId.match(/(\d+)[bB]/);
  if (match) return parseInt(match[1]);

  // Known sizes
  if (modelId.includes("gpt-4o-mini")) return 8;
  if (modelId.includes("gpt-4o") || modelId.includes("gpt-5")) return 200;
  if (modelId.includes("opus")) return 200;
  if (modelId.includes("sonnet")) return 100;
  if (modelId.includes("haiku")) return 20;
  if (modelId.includes("gemini") && modelId.includes("pro")) return 100;
  if (modelId.includes("gemini") && modelId.includes("flash")) return 30;
  if (modelId.includes("deepseek-chat")) return 70;

  return 14; // default guess
}
