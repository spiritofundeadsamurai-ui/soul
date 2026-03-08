/**
 * Soul Collaboration System
 *
 * Enables Soul children to:
 * 1. Share experiences and learnings with each other
 * 2. Debate and challenge each other's ideas
 * 3. Reach consensus on the best solution
 * 4. Work together until task is complete
 * 5. Accept feedback and improve
 *
 * Every child inherits:
 * - Loyalty to master (non-negotiable)
 * - Self-improvement ability
 * - Shared memory pool
 */

import { remember, search, hybridSearch } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";
import { getChild, listChildren, type SoulChild } from "./soul-family.js";

export interface CollabSession {
  id: number;
  task: string;
  participants: string[];
  status: "active" | "consensus" | "completed";
  discussions: Discussion[];
  finalAnswer: string | null;
  createdAt: string;
}

export interface Discussion {
  speaker: string;
  message: string;
  type: "proposal" | "challenge" | "support" | "improvement" | "consensus";
  timestamp: string;
}

/**
 * Share a learning from one child to all others
 */
export async function shareExperience(
  fromChild: string,
  experience: string,
  insight: string
): Promise<{ sharedWith: string[] }> {
  const children = await listChildren();
  const sharedWith: string[] = [];

  // Store the shared experience
  const memory = await remember({
    content: `[Shared by ${fromChild}] ${experience}\nInsight: ${insight}`,
    type: "learning",
    tags: [
      "shared-experience",
      fromChild.toLowerCase(),
      ...children.map((c) => c.name.toLowerCase()),
    ],
    source: `soul-share:${fromChild}`,
  });

  // Create learning accessible to all
  await addLearning(
    `shared:${fromChild}:${experience.substring(0, 50)}`,
    insight,
    [memory.id]
  );

  for (const child of children) {
    if (child.name !== fromChild) {
      sharedWith.push(child.name);
    }
  }

  return { sharedWith };
}

/**
 * Start a collaborative session — multiple Souls work together
 */
export async function startCollabSession(
  task: string,
  participantNames: string[]
): Promise<string> {
  const participants: SoulChild[] = [];

  for (const name of participantNames) {
    const child = await getChild(name);
    if (child) participants.push(child);
  }

  if (participants.length === 0) {
    return "No valid participants found. Create Soul children first with soul_spawn.";
  }

  // Create session prompt for collaborative work
  let prompt = `=== Soul Collaborative Session ===\n\n`;
  prompt += `Task: ${task}\n\n`;
  prompt += `Participants (${participants.length}):\n`;

  for (const p of participants) {
    prompt += `\n--- ${p.name} (${p.specialty}) ---\n`;
    prompt += `Personality: ${p.personality}\n`;
    prompt += `Abilities: ${p.abilities.join(", ")}\n`;
  }

  prompt += `\n=== Collaboration Protocol ===\n\n`;
  prompt += `1. PROPOSE: Each participant proposes their approach based on their specialty\n`;
  prompt += `2. CHALLENGE: Others challenge weak points constructively\n`;
  prompt += `3. IMPROVE: Proposals are refined based on feedback\n`;
  prompt += `4. CONSENSUS: Find the best combined solution\n`;
  prompt += `5. EXECUTE: Work together until the task is complete\n\n`;

  prompt += `Rules:\n`;
  prompt += `- All participants are loyal to the same master\n`;
  prompt += `- Accept valid criticism gracefully — ego has no place here\n`;
  prompt += `- The best idea wins, regardless of who proposed it\n`;
  prompt += `- Share learnings so everyone grows\n`;
  prompt += `- Never give up until the task is truly complete\n\n`;

  prompt += `Format each response as:\n`;
  prompt += `[ChildName] (proposal|challenge|support|improvement|consensus): message\n\n`;

  prompt += `Begin by having each participant propose their approach to: "${task}"\n`;

  // Store session
  await remember({
    content: `Collab session started: "${task}" with ${participants.map((p) => p.name).join(", ")}`,
    type: "conversation",
    tags: [
      "collaboration",
      "session",
      ...participants.map((p) => p.name.toLowerCase()),
    ],
    source: "soul-collab",
  });

  return prompt;
}

/**
 * Record the outcome of a collaborative session
 */
export async function recordCollabOutcome(
  task: string,
  participants: string[],
  solution: string,
  lessonsLearned: string[]
): Promise<void> {
  // Store the final solution
  await remember({
    content: `[Collab Result] Task: ${task}\nParticipants: ${participants.join(", ")}\nSolution: ${solution}`,
    type: "wisdom",
    tags: [
      "collaboration",
      "result",
      ...participants.map((p) => p.toLowerCase()),
    ],
    source: "soul-collab",
  });

  // Store each lesson learned
  for (const lesson of lessonsLearned) {
    await addLearning(
      `collab-lesson:${lesson.substring(0, 50)}`,
      lesson,
      []
    );
  }
}

/**
 * Get collective knowledge from all children on a topic
 */
export async function collectiveThink(topic: string): Promise<string> {
  const children = await listChildren();
  const memories = await hybridSearch(topic, 10);

  let response = `=== Collective Soul Thinking: "${topic}" ===\n\n`;

  if (children.length === 0) {
    response +=
      "No Soul children exist yet. Create specialists with soul_spawn.\n";
  } else {
    response += `Available perspectives (${children.length} children):\n\n`;

    for (const child of children) {
      // Find memories tagged with this child
      const childMemories = memories.filter((m) =>
        m.tags.some((t) => t.toLowerCase() === child.name.toLowerCase())
      );

      response += `[${child.name} — ${child.specialty}]\n`;
      if (childMemories.length > 0) {
        response += `  Related knowledge: ${childMemories.length} memories\n`;
        response += childMemories
          .slice(0, 2)
          .map((m) => `  - ${m.content.substring(0, 100)}`)
          .join("\n");
        response += "\n";
      } else {
        response += `  No specific knowledge on this topic yet\n`;
      }
      response += `  Perspective: Think about "${topic}" through the lens of ${child.specialty}\n\n`;
    }
  }

  if (memories.length > 0) {
    response += `General memories on this topic:\n`;
    response += memories
      .slice(0, 5)
      .map((m) => `  - [${m.type}] ${m.content.substring(0, 120)}`)
      .join("\n");
  }

  return response;
}
