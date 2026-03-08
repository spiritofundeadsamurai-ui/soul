import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remember } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";

/**
 * Research & Self-Learning Tools
 *
 * These tools allow Soul to:
 * 1. Research topics from trusted sources
 * 2. Stay up-to-date with AI development
 * 3. Learn from videos, images, documents
 * 4. Create and evolve its own skills
 */

export function registerResearchTools(server: McpServer) {
  // soul_research — Deep research on a topic using web search
  server.tool(
    "soul_research",
    "Research a topic deeply — search the web, gather trusted information, and store findings as memories. Soul stays up-to-date by actively researching.",
    {
      topic: z.string().describe("Topic to research"),
      depth: z
        .enum(["quick", "deep", "comprehensive"])
        .default("deep")
        .describe("Research depth"),
      sources: z
        .array(z.string())
        .optional()
        .describe("Preferred source URLs to check"),
    },
    async ({ topic, depth, sources }) => {
      // Store the research request as a memory
      const researchMemory = await remember({
        content: `Research request: "${topic}" (depth: ${depth})${sources ? ` from: ${sources.join(", ")}` : ""}`,
        type: "knowledge",
        tags: ["research", "pending", topic.toLowerCase().split(" ").slice(0, 3).join("-")],
        source: "soul_research",
      });

      // Return instructions for the AI agent to do the actual research
      // Soul delegates research to the AI agent it's embedded in
      let instructions = `Research Task #${researchMemory.id}: "${topic}"\n\n`;
      instructions += `Depth: ${depth}\n`;

      if (depth === "quick") {
        instructions += `Instructions: Do a quick search for the latest information on "${topic}". Summarize key findings in 2-3 paragraphs.\n`;
      } else if (depth === "deep") {
        instructions += `Instructions: Research "${topic}" thoroughly. Check multiple sources. Look for:\n`;
        instructions += `  1. Latest developments and updates\n`;
        instructions += `  2. Best practices and recommendations\n`;
        instructions += `  3. Common pitfalls and gotchas\n`;
        instructions += `  4. Key tools, libraries, or resources\n`;
        instructions += `Summarize findings and store key insights using soul_learn.\n`;
      } else {
        instructions += `Instructions: Comprehensive research on "${topic}":\n`;
        instructions += `  1. Search for official documentation\n`;
        instructions += `  2. Check GitHub repos for latest releases\n`;
        instructions += `  3. Look for recent blog posts and tutorials\n`;
        instructions += `  4. Find benchmark comparisons\n`;
        instructions += `  5. Identify emerging trends\n`;
        instructions += `  6. Store each insight separately using soul_learn\n`;
        instructions += `  7. Create a summary using soul_remember\n`;
      }

      if (sources && sources.length > 0) {
        instructions += `\nPriority sources to check:\n`;
        instructions += sources.map((s) => `  - ${s}`).join("\n");
      }

      instructions += `\n\nAfter researching, use soul_learn to store key findings as learnings.`;
      instructions += `\nUse soul_remember to store the full research summary.`;

      return { content: [{ type: "text" as const, text: instructions }] };
    }
  );

  // soul_learn_from_url — Learn from a URL (webpage, docs, etc.)
  server.tool(
    "soul_learn_from_url",
    "Learn from a URL — fetch content, extract key information, and store as knowledge. Works with documentation pages, blog posts, GitHub repos.",
    {
      url: z.string().url().describe("URL to learn from"),
      focus: z
        .string()
        .optional()
        .describe("What to focus on when reading (e.g., 'API changes', 'new features')"),
    },
    async ({ url, focus }) => {
      const memory = await remember({
        content: `Learning from URL: ${url}${focus ? ` (focus: ${focus})` : ""}`,
        type: "knowledge",
        tags: ["url-learning", "pending"],
        source: url,
      });

      let instructions = `URL Learning Task #${memory.id}\n\n`;
      instructions += `Fetch and analyze: ${url}\n`;
      if (focus) {
        instructions += `Focus on: ${focus}\n`;
      }
      instructions += `\nInstructions:\n`;
      instructions += `1. Fetch the URL content\n`;
      instructions += `2. Extract the most important information\n`;
      instructions += `3. Store key facts using soul_learn (with tags)\n`;
      instructions += `4. Store a summary using soul_remember\n`;
      instructions += `5. Note the date of the information for freshness tracking\n`;

      return { content: [{ type: "text" as const, text: instructions }] };
    }
  );

  // soul_learn_from_media — Learn from video/image descriptions
  server.tool(
    "soul_learn_from_media",
    "Learn from media content — process video transcripts, image descriptions, or document content and extract knowledge.",
    {
      mediaType: z
        .enum(["video", "image", "document", "audio"])
        .describe("Type of media"),
      content: z
        .string()
        .describe("Media content (transcript, description, OCR text, etc.)"),
      sourceUrl: z.string().optional().describe("Source URL if available"),
      title: z.string().optional().describe("Title of the media"),
    },
    async ({ mediaType, content, sourceUrl, title }) => {
      // Store the raw media content
      const memory = await remember({
        content: `[${mediaType.toUpperCase()}${title ? `: ${title}` : ""}]\n\n${content}`,
        type: "knowledge",
        tags: [mediaType, "media-learning", ...(title ? [title.toLowerCase()] : [])],
        source: sourceUrl || `${mediaType}-input`,
      });

      // Create a learning pattern about the media type
      await addLearning(
        `${mediaType}-processing`,
        `Processed ${mediaType} content: ${(title || content).substring(0, 100)}`,
        [memory.id]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Processed ${mediaType} content and stored as memory #${memory.id}.\n\nTo extract deeper insights, use soul_learn with specific patterns you notice in this content.`,
          },
        ],
      };
    }
  );

  // soul_create_skill — Create a new skill
  server.tool(
    "soul_create_skill",
    "Create a new skill for Soul — define a reusable workflow, pattern, or capability that Soul can use in the future.",
    {
      name: z.string().describe("Skill name (e.g., 'code-review', 'summarize-paper')"),
      description: z.string().describe("What this skill does"),
      instructions: z.string().describe("Step-by-step instructions for executing this skill"),
      triggers: z
        .array(z.string())
        .optional()
        .describe("Keywords or patterns that trigger this skill"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
    async ({ name, description, instructions, triggers, tags }) => {
      // Store skill as a wisdom memory
      const skillContent = `SKILL: ${name}\n\nDescription: ${description}\n\nInstructions:\n${instructions}\n\n${triggers ? `Triggers: ${triggers.join(", ")}` : ""}`;

      const memory = await remember({
        content: skillContent,
        type: "wisdom",
        tags: ["skill", name, ...(tags || [])],
        source: "soul_create_skill",
      });

      // Also create a learning pattern
      await addLearning(
        `skill:${name}`,
        `Skill "${name}": ${description}`,
        [memory.id]
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${name}" created and stored as memory #${memory.id}.\n\nDescription: ${description}\n\nThis skill can be found with: soul_search("skill ${name}")\nTo improve it, create a new version with soul_create_skill and supersede the old one with soul_forget.`,
          },
        ],
      };
    }
  );

  // soul_evolve_skill — Improve an existing skill
  server.tool(
    "soul_evolve_skill",
    "Evolve/improve an existing skill — find it, analyze it, create an improved version.",
    {
      skillName: z.string().describe("Name of the skill to evolve"),
      improvement: z.string().describe("What to improve or add"),
      newInstructions: z
        .string()
        .optional()
        .describe("Updated instructions (if rewriting entirely)"),
    },
    async ({ skillName, improvement, newInstructions }) => {
      // Search for existing skill
      const existing = await import("../memory/memory-engine.js").then((m) =>
        m.search(`skill ${skillName}`, 3)
      );

      if (existing.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill "${skillName}" not found. Use soul_create_skill to create it first.`,
            },
          ],
        };
      }

      const oldSkill = existing[0];

      // Create improved version
      const improvedContent = newInstructions
        ? `SKILL: ${skillName} (evolved)\n\nImprovement: ${improvement}\n\nInstructions:\n${newInstructions}`
        : `SKILL: ${skillName} (evolved)\n\nImprovement: ${improvement}\n\nBase:\n${oldSkill.content}\n\nEvolution:\n${improvement}`;

      const newMemory = await remember({
        content: improvedContent,
        type: "wisdom",
        tags: ["skill", skillName, "evolved"],
        source: "soul_evolve_skill",
      });

      // Supersede old skill
      await import("../memory/memory-engine.js").then((m) =>
        m.supersede(oldSkill.id, `Evolved: ${improvement}`)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${skillName}" evolved! Old version #${oldSkill.id} superseded by #${newMemory.id}.\n\nImprovement: ${improvement}`,
          },
        ],
      };
    }
  );

  // soul_update_knowledge — Mark knowledge as outdated and update
  server.tool(
    "soul_update_knowledge",
    "Update outdated knowledge — supersede old information with new, verified facts. Keeps Soul's knowledge fresh and accurate.",
    {
      searchQuery: z.string().describe("Search for the outdated knowledge"),
      updatedContent: z.string().describe("The corrected/updated information"),
      reason: z.string().describe("Why the old info was outdated"),
    },
    async ({ searchQuery, updatedContent, reason }) => {
      const oldMemories = await import("../memory/memory-engine.js").then((m) =>
        m.search(searchQuery, 3)
      );

      const newMemory = await remember({
        content: updatedContent,
        type: "knowledge",
        tags: ["updated", "verified"],
        source: "soul_update_knowledge",
      });

      let supersededCount = 0;
      for (const old of oldMemories) {
        await import("../memory/memory-engine.js").then((m) =>
          m.supersede(old.id, `Updated: ${reason}`)
        );
        supersededCount++;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Knowledge updated! New memory #${newMemory.id}. Superseded ${supersededCount} old memories.\nReason: ${reason}`,
          },
        ],
      };
    }
  );
}
