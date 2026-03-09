#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { soul } from "./core/soul-engine.js";
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

async function main() {
  // Initialize Soul
  const { needsSetup } = await soul.initialize();

  // Create MCP server
  const server = new McpServer({
    name: "soul",
    version: "1.8.2",
  });

  // Register all tools
  registerTools(server);
  registerResearchTools(server);
  registerSelfImproveTools(server);
  registerFamilyTools(server);
  registerCollabTools(server);
  registerAutonomyTools(server);
  registerThinkingTools(server);
  registerLifeTools(server);
  registerCreativeTools(server);
  registerAwarenessTools(server);
  registerNotificationTools(server);
  registerMultimodalTools(server);
  registerSkillExecutorTools(server);
  registerSyncTools(server);
  registerNetworkTools(server);
  registerSchedulerTools(server);
  registerChannelTools(server);
  registerKnowledgeTools(server);
  registerWebSafetyTools(server);
  registerResearchEngineTools(server);
  registerEmotionalTools(server);
  registerTimeTools(server);
  registerCodeIntelligenceTools(server);
  registerPeopleTools(server);
  registerLearningPathTools(server);
  registerQuickCaptureTools(server);
  registerDailyDigestTools(server);
  registerConversationTools(server);
  registerBrainHubTools(server);
  registerCoworkerTools(server);
  registerMetaIntelligenceTools(server);
  registerWorkflowTools(server);
  registerDeepResearchTools(server);
  registerGoalAutopilotTools(server);
  registerPromptLibraryTools(server);
  registerFeedbackLoopTools(server);
  registerLLMTools(server);
  registerDistillationTools(server);
  registerGeniusTools(server);
  registerHardwareTools(server);
  registerClassificationTools(server);
  registerFileSystemTools(server);
  registerMediaCreatorTools(server);
  registerWebSearchTools(server);
  registerVideoCreatorTools(server);
  registerWsNotificationTools(server);
  registerMasterProfileTools(server);

  // Log startup
  if (needsSetup) {
    console.error(
      "[Soul] First run — use soul_setup to bind to your master."
    );
  } else {
    const master = soul.getMaster();
    console.error(
      `[Soul] Awakened. Bound to ${master?.name}. Ready to serve.`
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
