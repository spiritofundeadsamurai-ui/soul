#!/usr/bin/env node

/**
 * Soul MCP Server — Lite Mode
 *
 * Registers ~50 essential tools for Claude Code integration.
 * Full 324-tool set available via HTTP API (server.ts).
 *
 * Why: Claude Code has practical limits on MCP tool count.
 * 156KB of tool definitions causes timeout/rejection.
 * Lite mode keeps it under 30KB for reliable discovery.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { soul } from "./core/soul-engine.js";

// Essential tool modules (~40 tools)
import { registerTools } from "./tools/index.js";             // Core: ask, remember, search, learn, status (~16)
import { registerKnowledgeTools } from "./tools/knowledge.js"; // Knowledge base (4)
import { registerFileSystemTools } from "./tools/file-system.js"; // File ops (6)
import { registerWebSearchTools } from "./tools/web-search.js"; // Web search (5)
import { registerQuickCaptureTools } from "./tools/quick-capture.js"; // Notes, ideas (7)
import { registerLLMTools } from "./tools/llm.js";             // Smart chat, LLM routing (6+)

async function main() {
  const { needsSetup } = await soul.initialize();

  const server = new McpServer({
    name: "soul",
    version: "1.7.0",
  });

  // Register essential tools only (~40 tools)
  registerTools(server);           // Core (~16)
  registerKnowledgeTools(server);  // Knowledge (4)
  registerFileSystemTools(server); // File system (6)
  registerWebSearchTools(server);  // Web search (5)
  registerQuickCaptureTools(server); // Quick capture (7)
  registerLLMTools(server);        // LLM routing (6)

  if (needsSetup) {
    console.error("[Soul Lite] First run — use soul_setup to bind to your master.");
  } else {
    const master = soul.getMaster();
    console.error(`[Soul Lite] Awakened (lite mode, ~40 tools). Bound to ${master?.name}. Ready.`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[Soul Lite] Fatal error:", err);
  process.exit(1);
});
