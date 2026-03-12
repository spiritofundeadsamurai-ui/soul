#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { soul } from "./core/soul-engine.js";
import { createToolCollector, registerSoulAgent } from "./tools/tool-router.js";

// ─── All tool modules (unchanged) ───
import { registerTools } from "./tools/index.js";
import { registerResearchTools } from "./tools/research.js";
import { registerSelfImproveTools } from "./tools/self-improve.js";
import { registerFamilyTools } from "./tools/family.js";
import { registerCollabTools } from "./tools/collab.js";
import { registerAutonomyTools } from "./tools/autonomy.js";
import { registerThinkingTools } from "./tools/thinking.js";
import { registerLifeTools } from "./tools/life.js";
import { registerCreativeTools } from "./tools/creative.js";
import { registerAwarenessTools } from "./tools/awareness.js";
import { registerNotificationTools } from "./tools/notification.js";
import { registerMultimodalTools } from "./tools/multimodal.js";
import { registerSkillExecutorTools } from "./tools/skill-executor.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerSchedulerTools } from "./tools/scheduler.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerWebSafetyTools } from "./tools/web-safety.js";
import { registerResearchEngineTools } from "./tools/research-engine.js";
import { registerEmotionalTools } from "./tools/emotional.js";
import { registerTimeTools } from "./tools/time-tracking.js";
import { registerCodeIntelligenceTools } from "./tools/code-intelligence.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerLearningPathTools } from "./tools/learning-paths.js";
import { registerQuickCaptureTools } from "./tools/quick-capture.js";
import { registerDailyDigestTools } from "./tools/daily-digest.js";
import { registerConversationTools } from "./tools/conversation.js";
import { registerBrainHubTools } from "./tools/brain-hub.js";
import { registerCoworkerTools } from "./tools/coworker.js";
import { registerMetaIntelligenceTools } from "./tools/meta-intelligence.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerDeepResearchTools } from "./tools/deep-research.js";
import { registerGoalAutopilotTools } from "./tools/goal-autopilot.js";
import { registerPromptLibraryTools } from "./tools/prompt-library.js";
import { registerFeedbackLoopTools } from "./tools/feedback-loop.js";
import { registerLLMTools } from "./tools/llm.js";
import { registerDistillationTools } from "./tools/distillation.js";
import { registerGeniusTools } from "./tools/genius.js";
import { registerHardwareTools } from "./tools/hardware.js";
import { registerClassificationTools } from "./tools/classification.js";
import { registerFileSystemTools } from "./tools/file-system.js";
import { registerMediaCreatorTools } from "./tools/media-creator.js";
import { registerWebSearchTools } from "./tools/web-search.js";
import { registerVideoCreatorTools } from "./tools/video-creator.js";
import { registerWsNotificationTools } from "./tools/ws-notifications.js";
import { registerMasterProfileTools } from "./tools/master-profile.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerPlannerTools } from "./tools/agent-planner.js";
import { registerAutoToolTools } from "./tools/auto-tool.js";
import { registerParallelTools } from "./tools/parallel-agent.js";
import { registerDualBrainTools } from "./tools/dual-brain.js";

async function main() {
  // Initialize Soul
  const { needsSetup } = await soul.initialize();

  // Create MCP server
  const server = new McpServer({
    name: "soul",
    version: "1.10.1",
  });

  // ─── MINIMAL TOOL SURFACE ───
  // Create a collector that intercepts server.tool() calls.
  // Core tools (14) → registered directly with MCP (always in context)
  // Everything else (300+) → stored internally, accessible via soul_agent
  const collector = createToolCollector(server);

  // Pass collector to ALL tool modules — they call collector.tool() instead of server.tool()
  // Only core tools actually reach the MCP server; the rest are stored for soul_agent routing
  registerTools(collector as any);
  registerResearchTools(collector as any);
  registerSelfImproveTools(collector as any);
  registerFamilyTools(collector as any);
  registerCollabTools(collector as any);
  registerAutonomyTools(collector as any);
  registerThinkingTools(collector as any);
  registerLifeTools(collector as any);
  registerCreativeTools(collector as any);
  registerAwarenessTools(collector as any);
  registerNotificationTools(collector as any);
  registerMultimodalTools(collector as any);
  registerSkillExecutorTools(collector as any);
  registerSyncTools(collector as any);
  registerNetworkTools(collector as any);
  registerSchedulerTools(collector as any);
  registerChannelTools(collector as any);
  registerKnowledgeTools(collector as any);
  registerWebSafetyTools(collector as any);
  registerResearchEngineTools(collector as any);
  registerEmotionalTools(collector as any);
  registerTimeTools(collector as any);
  registerCodeIntelligenceTools(collector as any);
  registerPeopleTools(collector as any);
  registerLearningPathTools(collector as any);
  registerQuickCaptureTools(collector as any);
  registerDailyDigestTools(collector as any);
  registerConversationTools(collector as any);
  registerBrainHubTools(collector as any);
  registerCoworkerTools(collector as any);
  registerMetaIntelligenceTools(collector as any);
  registerWorkflowTools(collector as any);
  registerDeepResearchTools(collector as any);
  registerGoalAutopilotTools(collector as any);
  registerPromptLibraryTools(collector as any);
  registerFeedbackLoopTools(collector as any);
  registerLLMTools(collector as any);
  registerDistillationTools(collector as any);
  registerGeniusTools(collector as any);
  registerHardwareTools(collector as any);
  registerClassificationTools(collector as any);
  registerFileSystemTools(collector as any);
  registerMediaCreatorTools(collector as any);
  registerWebSearchTools(collector as any);
  registerVideoCreatorTools(collector as any);
  registerWsNotificationTools(collector as any);
  registerMasterProfileTools(collector as any);
  registerSessionTools(collector as any);
  registerPlannerTools(collector as any);
  registerAutoToolTools(collector as any);
  registerParallelTools(collector as any);
  registerDualBrainTools(collector as any);

  // Register soul_agent meta-tool — gateway to ALL 300+ tools
  registerSoulAgent(server);

  // Auto-start Telegram polling if previously connected
  try {
    const { listChannels, startTelegramPolling } = await import("./core/channels.js");
    const channels = await listChannels();
    const tgChannel = channels.find((c: any) => c.channelType === "telegram" && c.isActive);
    if (tgChannel) {
      const result = await startTelegramPolling(tgChannel.name);
      if (result.success) console.error(`[Soul] Telegram auto-connected: ${tgChannel.name}`);
    }
  } catch (e: any) {
    console.error(`[Soul] Telegram auto-start failed: ${e.message}`);
  }

  // Log startup
  if (needsSetup) {
    console.error(
      "[Soul] First run — use soul_setup to bind to your master."
    );
  } else {
    const master = soul.getMaster();
    console.error(
      `[Soul] Awakened. Bound to ${master?.name}. 15 core tools + soul_agent (300+ capabilities). Ready.`
    );
  }

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[Soul] Fatal error:", err);
  process.exit(1);
});
