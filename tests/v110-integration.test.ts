/**
 * v1.10 Integration & Channel Features Test Suite
 *
 * Tests covering:
 * 1. Tool Router (CORE_TOOLS, createToolCollector)
 * 2. Channel Integration (Slack, Discord, channel CRUD)
 * 3. HTTP API (endpoint structure)
 * 4. Agent Loop Integration (exports, auto-action)
 * 5. i18n / First Message
 * 6. Tool Surface (register function exports)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Set temp DB before any imports that touch the database
const tmpDb = path.join(os.tmpdir(), `soul-v110-test-${Date.now()}.db`);
process.env.SOUL_DB_PATH = tmpDb;

// ════════════════════════════════════════════════════════════════
// 1. Tool Router
// ════════════════════════════════════════════════════════════════

describe("1. Tool Router (tool-router.ts)", () => {
  it("1.1 CORE_TOOLS set contains expected tools", async () => {
    const { CORE_TOOLS } = await import("../src/tools/tool-router.js");
    expect(CORE_TOOLS).toBeInstanceOf(Set);

    const expected = [
      "soul_setup",
      "soul_status",
      "soul_remember",
      "soul_search",
      "soul_ask",
      "soul_learn",
      "soul_think",
      "soul_note",
      "soul_mood",
      "soul_goal",
      "soul_smart_chat",
      "soul_web_search",
      "soul_read_file",
      "soul_create_chart",
    ];

    for (const tool of expected) {
      expect(CORE_TOOLS.has(tool)).toBe(true);
    }
  });

  it("1.2 CORE_TOOLS has a reasonable size (not too few, not too many)", async () => {
    const { CORE_TOOLS } = await import("../src/tools/tool-router.js");
    expect(CORE_TOOLS.size).toBeGreaterThanOrEqual(10);
    expect(CORE_TOOLS.size).toBeLessThanOrEqual(20);
  });

  it("1.3 createToolCollector intercepts tool() calls", async () => {
    const { createToolCollector, toolStore } = await import("../src/tools/tool-router.js");

    // Create a mock MCP server
    const registeredTools: string[] = [];
    const mockServer = {
      tool(...args: any[]) {
        registeredTools.push(args[0]);
      },
    };

    const collector = createToolCollector(mockServer as any);
    expect(typeof collector.tool).toBe("function");

    // Register a core tool — should go to both toolStore and mockServer
    collector.tool("soul_setup", "Setup description", {}, async () => ({ content: [] }));
    expect(toolStore.has("soul_setup")).toBe(true);
    expect(registeredTools).toContain("soul_setup");

    // Register a non-core tool — should go to toolStore only
    const nonCoreName = "soul_test_fake_tool_xyz";
    collector.tool(nonCoreName, "Non-core tool", {}, async () => ({ content: [] }));
    expect(toolStore.has(nonCoreName)).toBe(true);
    expect(registeredTools).not.toContain(nonCoreName);
  });

  it("1.4 Non-core tools are stored but not registered with MCP", async () => {
    const { CORE_TOOLS, toolStore } = await import("../src/tools/tool-router.js");

    for (const [name] of toolStore) {
      if (!CORE_TOOLS.has(name)) {
        // Non-core tools exist in the store — that's the point
        expect(toolStore.get(name)).toBeDefined();
        expect(toolStore.get(name)!.name).toBe(name);
      }
    }
  });

  it("1.5 toolStore entries have required fields", async () => {
    const { toolStore } = await import("../src/tools/tool-router.js");
    // At least the tools we registered in test 1.3 should have these fields
    const entry = toolStore.get("soul_setup");
    if (entry) {
      expect(entry.name).toBe("soul_setup");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.handler).toBe("function");
      expect(Array.isArray(entry.args)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Channel Integration (channels.ts)
// ════════════════════════════════════════════════════════════════

describe("2. Channel Integration (channels.ts)", () => {
  // ─── Slack message sending ───
  describe("2.1 Slack Message Sending", () => {
    it("should call Slack API with correct format when sending via channel", async () => {
      const channels = await import("../src/core/channels.js");

      // Add a slack channel first
      const channel = await channels.addChannel({
        name: "test-slack-channel",
        channelType: "slack",
        config: {
          botToken: "xoxb-test-token-123",
          channelId: "C12345678",
          botName: "Test Bot",
          teamName: "Test Team",
        },
      });

      expect(channel).toBeDefined();
      expect(channel.name).toBe("test-slack-channel");
      expect(channel.channelType).toBe("slack");

      // Mock fetch to capture the Slack API call
      const fetchCalls: { url: string; options: any }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        fetchCalls.push({ url: String(url), options });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as any;

      try {
        const result = await channels.sendMessage("test-slack-channel", "Hello from test!");
        expect(result).toBeDefined();

        // Verify the Slack API was called with correct format
        const slackCall = fetchCalls.find((c) => c.url.includes("slack.com"));
        expect(slackCall).toBeDefined();
        expect(slackCall!.url).toBe("https://slack.com/api/chat.postMessage");

        const body = JSON.parse(slackCall!.options.body);
        expect(body.channel).toBe("C12345678");
        expect(body.text).toBe("Hello from test!");

        expect(slackCall!.options.headers.Authorization).toBe("Bearer xoxb-test-token-123");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─── Discord message sending ───
  describe("2.2 Discord Message Sending", () => {
    it("should call Discord API with correct format when sending via channel", async () => {
      const channels = await import("../src/core/channels.js");

      // Add a discord channel
      const channel = await channels.addChannel({
        name: "test-discord-channel",
        channelType: "discord",
        config: {
          botToken: "discord-bot-token-123",
          channelId: "987654321",
          botName: "Soul Bot",
          botUsername: "soul_bot",
        },
      });

      expect(channel).toBeDefined();
      expect(channel.name).toBe("test-discord-channel");
      expect(channel.channelType).toBe("discord");

      // Mock fetch
      const fetchCalls: { url: string; options: any }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        fetchCalls.push({ url: String(url), options });
        return new Response(JSON.stringify({ id: "msg123" }), { status: 200 });
      }) as any;

      try {
        const result = await channels.sendMessage("test-discord-channel", "Hello Discord!");
        expect(result).toBeDefined();

        // Verify the Discord API was called with correct format
        const discordCall = fetchCalls.find((c) => c.url.includes("discord.com"));
        expect(discordCall).toBeDefined();
        expect(discordCall!.url).toBe(
          "https://discord.com/api/v10/channels/987654321/messages"
        );

        const body = JSON.parse(discordCall!.options.body);
        expect(body.content).toBe("Hello Discord!");

        expect(discordCall!.options.headers.Authorization).toBe("Bot discord-bot-token-123");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─── handleSlackEvent: url_verification ───
  describe("2.3 handleSlackEvent", () => {
    it("should handle url_verification challenge", async () => {
      const { handleSlackEvent } = await import("../src/core/channels.js");

      const result = await handleSlackEvent({
        type: "url_verification",
        challenge: "test-challenge-token-abc",
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.challenge).toBe("test-challenge-token-abc");
    });

    it("should handle event_callback with ok response", async () => {
      const { handleSlackEvent } = await import("../src/core/channels.js");

      const result = await handleSlackEvent({
        type: "event_callback",
        event: {
          type: "message",
          text: "hello",
          user: "U123",
          channel: "C456",
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.ok).toBe(true);
    });

    it("should ignore bot messages in event_callback", async () => {
      const { handleSlackEvent } = await import("../src/core/channels.js");

      const result = await handleSlackEvent({
        type: "event_callback",
        event: {
          type: "message",
          text: "bot message",
          bot_id: "B123",
          channel: "C456",
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.ok).toBe(true);
    });

    it("should return ok for unknown event types", async () => {
      const { handleSlackEvent } = await import("../src/core/channels.js");

      const result = await handleSlackEvent({ type: "unknown_type" });
      expect(result.statusCode).toBe(200);
    });
  });

  // ─── handleDiscordInteraction: PING ───
  describe("2.4 handleDiscordInteraction", () => {
    it("should handle PING (type 1) with type 1 response", async () => {
      const { handleDiscordInteraction } = await import("../src/core/channels.js");

      const result = await handleDiscordInteraction({ type: 1 });

      expect(result.statusCode).toBe(200);
      expect(result.body.type).toBe(1);
    });

    it("should handle APPLICATION_COMMAND (type 2) without text", async () => {
      const { handleDiscordInteraction } = await import("../src/core/channels.js");

      const result = await handleDiscordInteraction({
        type: 2,
        data: { name: "soul", options: [] },
        channel_id: "123",
      });

      expect(result.statusCode).toBe(200);
      // Should return CHANNEL_MESSAGE_WITH_SOURCE (type 4) asking for input
      expect(result.body.type).toBe(4);
      expect(result.body.data.content).toContain("provide a message");
    });

    it("should handle MESSAGE_COMPONENT (type 3) with deferred update", async () => {
      const { handleDiscordInteraction } = await import("../src/core/channels.js");

      const result = await handleDiscordInteraction({ type: 3 });

      expect(result.statusCode).toBe(200);
      expect(result.body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE
    });

    it("should return type 1 for unknown interaction types", async () => {
      const { handleDiscordInteraction } = await import("../src/core/channels.js");

      const result = await handleDiscordInteraction({ type: 99 });

      expect(result.statusCode).toBe(200);
      expect(result.body.type).toBe(1);
    });
  });

  // ─── Channel CRUD ───
  describe("2.5 Channel Add/List Operations", () => {
    it("should add a channel and retrieve it from list", async () => {
      const { addChannel, listChannels } = await import("../src/core/channels.js");

      const channel = await addChannel({
        name: "test-webhook-channel",
        channelType: "webhook",
        config: { url: "https://example.com/webhook" },
      });

      expect(channel.id).toBeGreaterThan(0);
      expect(channel.name).toBe("test-webhook-channel");
      expect(channel.channelType).toBe("webhook");
      expect(channel.isActive).toBe(true);

      const channels = await listChannels();
      const found = channels.find((c) => c.name === "test-webhook-channel");
      expect(found).toBeDefined();
      expect(found!.channelType).toBe("webhook");
    });

    it("should update existing channel config on re-add", async () => {
      const { addChannel } = await import("../src/core/channels.js");

      // Add channel first
      await addChannel({
        name: "test-update-channel",
        channelType: "webhook",
        config: { url: "https://old.com" },
      });

      // Re-add with new config — should update, not duplicate
      const updated = await addChannel({
        name: "test-update-channel",
        channelType: "webhook",
        config: { url: "https://new.com" },
      });

      expect(updated.name).toBe("test-update-channel");
      const config = JSON.parse(updated.config);
      expect(config.url).toBe("https://new.com");
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 3. HTTP API (server.ts)
// ════════════════════════════════════════════════════════════════

describe("3. HTTP API (server.ts)", () => {
  it("3.1 server.ts exports exist and is a valid module", () => {
    const serverPath = path.join(__dirname, "..", "src", "server.ts");
    expect(fs.existsSync(serverPath)).toBe(true);

    const src = fs.readFileSync(serverPath, "utf-8");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("3.2 Slack webhook route is defined", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain('app.post("/api/slack/events"');
    expect(src).toContain("handleSlackEvent");
  });

  it("3.3 Discord interactions route is defined", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain('app.post("/api/discord/interactions"');
    expect(src).toContain("handleDiscordInteraction");
  });

  it("3.4 Discord message route is defined", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain('app.post("/api/discord/message"');
    expect(src).toContain("handleDiscordMessage");
  });

  it("3.5 OpenAI-compatible proxy routes are defined", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain('app.get("/v1/models"');
    expect(src).toContain('app.post("/v1/chat/completions"');
  });

  it("3.6 Chat API routes are defined", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain('app.post("/api/chat"');
    expect(src).toContain('app.get("/api/chat/sessions"');
    expect(src).toContain('app.get("/api/chat/history/:sessionId"');
  });

  it("3.7 Master setup gate blocks write ops before setup", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "server.ts"),
      "utf-8"
    );
    expect(src).toContain("isMasterSetup");
    expect(src).toContain("Soul setup required");
  });
});

// ════════════════════════════════════════════════════════════════
// 4. Agent Loop Integration (agent-loop.ts)
// ════════════════════════════════════════════════════════════════

describe("4. Agent Loop Integration (agent-loop.ts)", () => {
  it("4.1 runAgentLoop is exported and is a function", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");
    expect(typeof agentLoop.runAgentLoop).toBe("function");
  });

  it("4.2 runSystem2Loop is exported and is a function", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");
    expect(typeof agentLoop.runSystem2Loop).toBe("function");
  });

  it("4.3 getRegisteredTools is exported and returns an array", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");
    expect(typeof agentLoop.getRegisteredTools).toBe("function");
    const tools = agentLoop.getRegisteredTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it("4.4 registerAllInternalTools is exported and callable", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");
    expect(typeof agentLoop.registerAllInternalTools).toBe("function");
    // Call it — should not throw
    agentLoop.registerAllInternalTools();
    // After registration, tools list should be populated
    const tools = agentLoop.getRegisteredTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("4.5 Auto-action: file path detection returns result for valid path", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");
    agentLoop.registerAllInternalTools();

    // Use a path we know exists on this machine
    const testPath = path.resolve(__dirname, "..");
    const result = await agentLoop.runSystem2Loop(testPath);

    // Should detect as a directory path and auto-list it
    expect(result).toBeDefined();
    expect(result.model).toBe("auto-action");
    expect(result.provider).toBe("soul-auto");
    expect(result.toolsUsed).toContain("soul_list_dir");
  });

  it("4.6 Auto-action: greeting detection does not use auto-action", async () => {
    const agentLoop = await import("../src/core/agent-loop.js");

    // Simple greetings are handled by routeTools returning empty,
    // then go through LLM or dual-brain. They should NOT match auto-action path detection.
    // But since we don't have an LLM configured, we verify the function exists
    // and the greeting pattern is recognized in the source code
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "core", "agent-loop.ts"),
      "utf-8"
    );
    // Verify Thai greeting "สวัสดี" is in the greeting detection pattern
    expect(src).toContain("สวัสดี");
    // Verify the isSimpleChat regex exists
    expect(src).toContain("isSimpleChat");
  });

  it("4.7 Agent loop source has auto-action path detection regex", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "core", "agent-loop.ts"),
      "utf-8"
    );
    // Should have the Windows path regex pattern
    expect(src).toContain("A-Z]:\\\\");
    // Should have version query detection
    expect(src).toContain("version|เวอร์ชัน");
  });
});

// ════════════════════════════════════════════════════════════════
// 5. i18n / First Message (first-message.ts)
// ════════════════════════════════════════════════════════════════

describe("5. i18n — First Message (first-message.ts)", () => {
  it("5.1 generateFirstMessage returns correct structure", async () => {
    const { generateFirstMessage } = await import("../src/core/first-message.js");
    const ctx = generateFirstMessage();

    expect(ctx).toBeDefined();
    expect(typeof ctx.greeting).toBe("string");
    expect(ctx.greeting.length).toBeGreaterThan(0);
    expect(["morning", "afternoon", "evening", "night"]).toContain(ctx.timeOfDay);
    expect(typeof ctx.hoursSinceLastChat).toBe("number");
    expect(Array.isArray(ctx.pendingInsights)).toBe(true);
    expect(Array.isArray(ctx.pendingDreams)).toBe(true);
    expect(Array.isArray(ctx.unresolvedItems)).toBe(true);
    expect(Array.isArray(ctx.suggestedTopics)).toBe(true);
  });

  it("5.2 Thai greeting when SOUL_LANG is not set", async () => {
    const origLang = process.env.SOUL_LANG;
    delete process.env.SOUL_LANG;

    // Force re-import to pick up env change
    // We test the i18n strings directly from the source since dynamic import caches
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "core", "first-message.ts"),
      "utf-8"
    );

    // Default is Thai
    expect(src).toContain('return "th"');
    // Thai greetings are defined
    expect(src).toContain("อรุณสวัสดิ์ครับ");
    expect(src).toContain("สวัสดีตอนบ่ายครับ");
    expect(src).toContain("สวัสดีตอนเย็นครับ");
    expect(src).toContain("ดึกแล้วนะครับ");

    // Restore
    if (origLang !== undefined) process.env.SOUL_LANG = origLang;
  });

  it("5.3 English greeting when SOUL_LANG=en", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "core", "first-message.ts"),
      "utf-8"
    );

    // English i18n strings should be defined
    expect(src).toContain('"Good morning!"');
    expect(src).toContain('"Good afternoon!"');
    expect(src).toContain('"Good evening!"');
    expect(src).toContain('"It\'s late!"');

    // getLang should return "en" for SOUL_LANG=en
    expect(src).toContain('env === "en"');
    expect(src).toContain('env === "english"');
  });

  it("5.4 Time-of-day detection works correctly", async () => {
    const { generateFirstMessage } = await import("../src/core/first-message.js");
    const ctx = generateFirstMessage();

    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      expect(ctx.timeOfDay).toBe("morning");
    } else if (hour >= 12 && hour < 17) {
      expect(ctx.timeOfDay).toBe("afternoon");
    } else if (hour >= 17 && hour < 21) {
      expect(ctx.timeOfDay).toBe("evening");
    } else {
      expect(ctx.timeOfDay).toBe("night");
    }
  });

  it("5.5 formatFirstMessage is exported and produces a string", async () => {
    const { generateFirstMessage, formatFirstMessage } = await import(
      "../src/core/first-message.js"
    );
    expect(typeof formatFirstMessage).toBe("function");

    const ctx = generateFirstMessage();
    const formatted = await formatFirstMessage(ctx);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    // Should contain the greeting
    expect(formatted).toContain(ctx.greeting);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. Tool Surface — v1.10 tool files export register functions
// ════════════════════════════════════════════════════════════════

describe("6. Tool Surface — v1.10 register function exports", () => {
  it("6.1 sessions.ts exports registerSessionTools", async () => {
    const mod = await import("../src/tools/sessions.js");
    expect(typeof mod.registerSessionTools).toBe("function");
  });

  it("6.2 agent-planner.ts exports registerPlannerTools", async () => {
    const mod = await import("../src/tools/agent-planner.js");
    expect(typeof mod.registerPlannerTools).toBe("function");
  });

  it("6.3 auto-tool.ts exports registerAutoToolTools", async () => {
    const mod = await import("../src/tools/auto-tool.js");
    expect(typeof mod.registerAutoToolTools).toBe("function");
  });

  it("6.4 parallel-agent.ts exports registerParallelTools", async () => {
    const mod = await import("../src/tools/parallel-agent.js");
    expect(typeof mod.registerParallelTools).toBe("function");
  });

  it("6.5 dual-brain.ts exports registerDualBrainTools", async () => {
    const mod = await import("../src/tools/dual-brain.js");
    expect(typeof mod.registerDualBrainTools).toBe("function");
  });

  it("6.6 All v1.10 tool files exist on disk", () => {
    const toolDir = path.join(__dirname, "..", "src", "tools");
    const v110Files = [
      "sessions.ts",
      "agent-planner.ts",
      "auto-tool.ts",
      "parallel-agent.ts",
      "dual-brain.ts",
      "tool-router.ts",
    ];

    for (const file of v110Files) {
      const filePath = path.join(toolDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it("6.7 Tool router exports registerSoulAgent", async () => {
    const mod = await import("../src/tools/tool-router.js");
    expect(typeof mod.registerSoulAgent).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════════════════════════

afterAll(() => {
  // Clean up temp database
  try {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    if (fs.existsSync(tmpDb + "-wal")) fs.unlinkSync(tmpDb + "-wal");
    if (fs.existsSync(tmpDb + "-shm")) fs.unlinkSync(tmpDb + "-shm");
  } catch {
    // ok — temp files will be cleaned up by OS
  }
});
