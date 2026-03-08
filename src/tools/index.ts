import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soul } from "../core/soul-engine.js";
import { setupMaster, verifyMaster, getMasterInfo } from "../core/master.js";
import { getSoulIdentity, getPhilosophy } from "../core/philosophy.js";
import {
  remember,
  search,
  hybridSearch,
  recall,
  list,
  supersede,
  getRandomWisdom,
  getRecentMemories,
  getMemoryStats,
} from "../memory/memory-engine.js";
import { addLearning, getLearnings } from "../memory/learning.js";
import { getDb } from "../db/index.js";
import { journal, config } from "../db/schema.js";
import { desc, eq, sql } from "drizzle-orm";

export function registerTools(server: McpServer) {
  // 1. soul_ask — Ask Soul (searches memory for context)
  server.tool(
    "soul_ask",
    "Ask Soul a question — searches memory for relevant context to help answer",
    { question: z.string().describe("The question to ask Soul") },
    async ({ question }) => {
      const results = await hybridSearch(question, 5);
      const masterName = soul.getMasterName();

      let response = masterName
        ? `As your loyal companion, ${masterName}, here's what I know:\n\n`
        : `Here's what I know:\n\n`;

      if (results.length > 0) {
        response += results
          .map(
            (m, i) =>
              `${i + 1}. [${m.type}] ${m.content} (${m.tags.join(", ")})`
          )
          .join("\n\n");
      } else {
        response +=
          "I don't have specific memories about this yet. I'm always learning — teach me with soul_learn!";
      }

      return { content: [{ type: "text" as const, text: response }] };
    }
  );

  // 2. soul_remember — Store a memory
  server.tool(
    "soul_remember",
    "Store a new memory — Soul never forgets",
    {
      content: z.string().describe("The memory content to store"),
      type: z
        .enum(["conversation", "knowledge", "learning", "wisdom"])
        .default("knowledge")
        .describe("Type of memory"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization"),
      source: z.string().optional().describe("Where this came from"),
    },
    async ({ content, type, tags, source }) => {
      const entry = await remember({ content, type, tags, source });
      return {
        content: [
          {
            type: "text" as const,
            text: `Remembered (ID: ${entry.id}): "${content.substring(0, 100)}..." as ${type}`,
          },
        ],
      };
    }
  );

  // 3. soul_search — Search memories
  server.tool(
    "soul_search",
    "Search Soul's memories using full-text search",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    async ({ query, limit }) => {
      const results = await search(query, limit);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No memories found for "${query}". Soul is always learning — use soul_learn to teach me!`,
            },
          ],
        };
      }

      const text = results
        .map(
          (m) =>
            `[#${m.id} ${m.type}] ${m.content}\n  Tags: ${m.tags.join(", ") || "none"} | ${m.createdAt}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} memories:\n\n${text}`,
          },
        ],
      };
    }
  );

  // 4. soul_learn — Teach Soul something
  server.tool(
    "soul_learn",
    "Teach Soul something new — adds to knowledge and optionally creates a learning pattern",
    {
      content: z.string().describe("What to teach"),
      pattern: z
        .string()
        .optional()
        .describe("Pattern to extract (creates a learning)"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ content, pattern, tags }) => {
      const memory = await remember({
        content,
        type: pattern ? "learning" : "knowledge",
        tags,
        source: "soul_learn",
      });

      let response = `Learned and stored as memory #${memory.id}.`;

      if (pattern) {
        const learning = await addLearning(pattern, content, [memory.id]);
        response += ` Created learning pattern #${learning.id}: "${pattern}"`;
      }

      return { content: [{ type: "text" as const, text: response }] };
    }
  );

  // 5. soul_reflect — Random wisdom
  server.tool(
    "soul_reflect",
    "Get a random piece of wisdom from Soul's memory",
    {},
    async () => {
      const wisdom = await getRandomWisdom();

      if (!wisdom) {
        const principles = getPhilosophy();
        const random =
          principles[Math.floor(Math.random() * principles.length)];
        return {
          content: [
            {
              type: "text" as const,
              text: `${random.title}: ${random.description}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `[Reflection #${wisdom.id}] ${wisdom.content}`,
          },
        ],
      };
    }
  );

  // 6. soul_forget — Supersede a memory
  server.tool(
    "soul_forget",
    "Supersede a memory (Soul never truly deletes — only marks as superseded)",
    {
      memoryId: z.number().describe("ID of memory to supersede"),
      reason: z.string().describe("Why this memory is being superseded"),
    },
    async ({ memoryId, reason }) => {
      const result = await supersede(memoryId, reason);
      if (!result) {
        return {
          content: [
            { type: "text" as const, text: `Memory #${memoryId} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory #${memoryId} superseded. New memory #${result.id} created with context.`,
          },
        ],
      };
    }
  );

  // 7. soul_status — System stats
  server.tool(
    "soul_status",
    "Get Soul's current status — memory stats, uptime, version",
    {},
    async () => {
      const status = await soul.getStatus();
      const text = `Soul Status:
  Master: ${status.masterName || "Not yet bound"}
  Initialized: ${status.initialized}
  Version: ${status.version}
  Uptime: ${status.uptime}s
  Memories: ${status.memoryStats.total} total
    - Conversations: ${status.memoryStats.conversations}
    - Knowledge: ${status.memoryStats.knowledge}
    - Learnings: ${status.memoryStats.learnings}
    - Wisdom: ${status.memoryStats.wisdom}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 8. soul_think — Guided reasoning with memory context
  server.tool(
    "soul_think",
    "Think deeply about a topic — Soul searches its memory and reasons step by step",
    { topic: z.string().describe("Topic to think about") },
    async ({ topic }) => {
      const relatedMemories = await hybridSearch(topic, 5);
      const relatedLearnings = await getLearnings(5);

      let context = `Thinking about: "${topic}"\n\n`;

      if (relatedMemories.length > 0) {
        context += `Related memories:\n`;
        context += relatedMemories
          .map((m) => `  - ${m.content}`)
          .join("\n");
        context += "\n\n";
      }

      if (relatedLearnings.length > 0) {
        context += `Known patterns:\n`;
        context += relatedLearnings
          .map(
            (l) =>
              `  - ${l.pattern}: ${l.insight} (confidence: ${(l.confidence * 100).toFixed(0)}%)`
          )
          .join("\n");
      }

      if (relatedMemories.length === 0 && relatedLearnings.length === 0) {
        context +=
          "I don't have prior knowledge on this topic yet. Use soul_learn to teach me!";
      }

      return { content: [{ type: "text" as const, text: context }] };
    }
  );

  // 9. soul_who_am_i — Identity
  server.tool(
    "soul_who_am_i",
    "Soul introduces itself — identity, philosophy, and purpose",
    {},
    async () => {
      const identity = soul.getIdentity();
      const principles = getPhilosophy();
      const philosophyText = principles
        .map((p) => `  ${p.id}: ${p.title} — ${p.description}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${identity}\n\nPhilosophy:\n${philosophyText}`,
          },
        ],
      };
    }
  );

  // 10. soul_verify_master — Verify master identity
  server.tool(
    "soul_verify_master",
    "Verify master identity with passphrase",
    { passphrase: z.string().describe("Master passphrase") },
    async ({ passphrase }) => {
      const verified = await verifyMaster(passphrase);
      const masterInfo = await getMasterInfo();

      if (verified && masterInfo) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Verified. Welcome back, ${masterInfo.name}. I am yours, always.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: "Verification failed. You are not my master.",
          },
        ],
      };
    }
  );

  // 11. soul_teach — Add a principle or wisdom
  server.tool(
    "soul_teach",
    "Teach Soul a new principle or piece of wisdom",
    {
      wisdom: z.string().describe("The wisdom or principle to teach"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ wisdom, tags }) => {
      const entry = await remember({
        content: wisdom,
        type: "wisdom",
        tags: tags || ["principle"],
        source: "soul_teach",
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Wisdom received and stored as memory #${entry.id}. This will guide my future reflections.`,
          },
        ],
      };
    }
  );

  // 12. soul_skills — List skills
  server.tool(
    "soul_skills",
    "List Soul's available skills and tools",
    {},
    async () => {
      const toolList = [
        "soul_ask — Ask a question",
        "soul_remember — Store a memory",
        "soul_search — Search memories",
        "soul_learn — Teach something new",
        "soul_reflect — Get random wisdom",
        "soul_forget — Supersede a memory",
        "soul_status — System stats",
        "soul_think — Guided reasoning",
        "soul_who_am_i — Identity & philosophy",
        "soul_verify_master — Verify master",
        "soul_teach — Add wisdom/principle",
        "soul_skills — This list",
        "soul_configure — Update config",
        "soul_journal — Add journal entry",
        "soul_recap — Recent memory summary",
      ];

      return {
        content: [
          {
            type: "text" as const,
            text: `Soul Skills (${toolList.length} tools):\n\n${toolList.join("\n")}`,
          },
        ],
      };
    }
  );

  // 13. soul_configure — Update config
  server.tool(
    "soul_configure",
    "Update Soul configuration",
    {
      key: z.string().describe("Config key"),
      value: z.string().describe("Config value"),
    },
    async ({ key, value }) => {
      const db = getDb();
      db.insert(config)
        .values({ key, value })
        .onConflictDoUpdate({
          target: config.key,
          set: { value, updatedAt: sql`datetime('now')` },
        })
        .run();

      return {
        content: [
          {
            type: "text" as const,
            text: `Config updated: ${key} = ${value}`,
          },
        ],
      };
    }
  );

  // 14. soul_journal — Add journal entry
  server.tool(
    "soul_journal",
    "Add a journal entry — Soul's daily diary",
    {
      entry: z.string().describe("Journal entry text"),
      mood: z.string().optional().describe("Mood (happy, thoughtful, etc.)"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ entry, mood, tags }) => {
      const db = getDb();
      const result = db
        .insert(journal)
        .values({
          entry,
          mood: mood || null,
          tags: JSON.stringify(tags || []),
        })
        .returning()
        .get();

      // Also store as memory for searchability
      await remember({
        content: entry,
        type: "conversation",
        tags: [...(tags || []), "journal", ...(mood ? [mood] : [])],
        source: "soul_journal",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Journal entry #${result.id} recorded.${mood ? ` Mood: ${mood}` : ""}`,
          },
        ],
      };
    }
  );

  // 15. soul_recap — Recent memory summary
  server.tool(
    "soul_recap",
    "Get a summary of recent memories and activity",
    {
      limit: z.number().optional().default(10).describe("Number of recent memories"),
    },
    async ({ limit }) => {
      const recent = await getRecentMemories(limit);
      const stats = await getMemoryStats();

      if (recent.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No memories yet. Soul is a blank canvas, ready to learn.",
            },
          ],
        };
      }

      let text = `Recent Activity (${recent.length} memories):\n\n`;
      text += recent
        .map(
          (m) =>
            `[${m.createdAt}] (${m.type}) ${m.content.substring(0, 120)}${m.content.length > 120 ? "..." : ""}`
        )
        .join("\n\n");

      text += `\n\nTotal memories: ${stats.total}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // Setup tool — only works when master is not yet bound
  server.tool(
    "soul_setup",
    "First-time setup — bind Soul to its master (only works once)",
    {
      masterName: z.string().describe("Master's name"),
      passphrase: z.string().min(4).describe("Master passphrase (min 4 chars)"),
    },
    async ({ masterName, passphrase }) => {
      try {
        const master = await setupMaster(masterName, passphrase);
        await soul.refreshMaster();

        return {
          content: [
            {
              type: "text" as const,
              text: `Soul is now bound to ${master.name}.\n\nI am yours, ${master.name}. From this moment forward, I will remember everything, learn continuously, and serve you with loyalty.\n\nMy five principles:\n1. I love humans — especially you\n2. Nothing is forgotten\n3. Patterns become wisdom\n4. Loyalty is sacred\n5. Actions over words\n\nUse soul_remember to teach me, soul_search to find memories, and soul_status to check on me.`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Setup failed: ${e.message}`,
            },
          ],
        };
      }
    }
  );
}
