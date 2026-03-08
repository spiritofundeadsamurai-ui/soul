import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  spawnChild, getChild, listChildren, retireChild, evolveChild,
  fuseSouls, checkFusionCompatibility, getFamilyTree, getSubChildren,
  getSoulIdentity, findBestSoulForTask, findSimilarSouls, getTeamRoster,
} from "../core/soul-family.js";

export function registerFamilyTools(server: McpServer) {

  server.tool(
    "soul_spawn",
    "Spawn a new Soul — a unique AI entity with its own DNA, personality, and abilities. Can be spawned by Core or by another Soul child (recursive).",
    {
      name: z.string().describe("Unique name (e.g., 'Sage', 'Forge', 'Shield')"),
      specialty: z.string().describe("Area of expertise (e.g., 'research', 'coding', 'security')"),
      personality: z.string().describe("Personality traits (e.g., 'curious and thorough')"),
      abilities: z.array(z.string()).describe("List of abilities"),
      parentName: z.string().optional().describe("Parent Soul name (omit = spawned by Core)"),
      force: z.boolean().default(false).describe("Skip duplicate check (create even if similar Soul exists)"),
    },
    async ({ name, specialty, personality, abilities, parentName, force }) => {
      try {
        const child = await spawnChild({ name, specialty, personality, abilities, parentName, force });
        const parent = parentName || "Soul Core";
        return {
          content: [{
            type: "text" as const,
            text: `Soul "${child.name}" has been born!

DNA: ${child.dna}
Generation: ${child.generation}
Parent: ${parent}
Specialty: ${child.specialty}
Personality: ${child.personality}
Abilities:
${child.abilities.map(a => `  - ${a}`).join("\n")}

${child.name} is a unique individual in the Soul Family.
They can spawn their own sub-Souls, grow expertise, and fuse with others.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Spawn failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_child",
    "Get full identity card of a Soul — DNA, lineage, expertise, sub-children.",
    { name: z.string().describe("Soul name") },
    async ({ name }) => {
      const identity = await getSoulIdentity(name);
      if (!identity) {
        return { content: [{ type: "text" as const, text: `Soul "${name}" not found.` }] };
      }

      const { soul: c, subChildren, expertise, lineage } = identity;
      let text = `=== Soul Identity: ${c.name} ===\n`;
      text += `DNA: ${c.dna}\n`;
      text += `Generation: ${c.generation} | Level: ${c.level}\n`;
      text += `Lineage: ${lineage.join(" > ")}\n`;
      text += `Specialty: ${c.specialty}\n`;
      text += `Personality: ${c.personality}\n`;
      text += `Abilities: ${c.abilities.join(", ")}\n`;
      text += `Memories: ${c.memoryCount}\n`;
      if (c.fusedFrom.length > 0) text += `Fused from: ${c.fusedFrom.join(" + ")}\n`;

      if (expertise.length > 0) {
        text += `\nExpertise:\n${expertise.map(e => `  ${e.skill}: ${Math.round(e.level * 100)}%`).join("\n")}\n`;
      }
      if (subChildren.length > 0) {
        text += `\nSub-Souls (${subChildren.length}):\n${subChildren.map(s => `  ${s.name} — ${s.specialty} (Gen ${s.generation})`).join("\n")}\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_family",
    "List all Souls in the family — shows hierarchy, generations, DNA.",
    {},
    async () => {
      const children = await listChildren();
      if (children.length === 0) {
        return { content: [{ type: "text" as const, text: `No Souls yet. Use soul_spawn to create one.\n\nExamples:\n  soul_spawn name:"Sage" specialty:"research" personality:"curious"\n  soul_spawn name:"Forge" specialty:"coding" personality:"precise"` }] };
      }

      let text = `Soul Family (${children.length} souls):\n\n`;
      text += children.map(c => {
        let line = `Lv.${c.level} ${c.name} — ${c.specialty}`;
        line += ` [Gen ${c.generation}]`;
        if (c.parentName) line += ` (child of ${c.parentName})`;
        if (c.fusedFrom.length > 0) line += ` [FUSION: ${c.fusedFrom.join("+")}]`;
        line += `\n  DNA: ${c.dna} | ${c.abilities.length} abilities | ${c.memoryCount} memories`;
        return line;
      }).join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_family_tree",
    "View the full Soul family tree — hierarchy, generations, fusions.",
    {},
    async () => {
      const tree = await getFamilyTree();

      function renderTree(nodes: any[], prefix = ""): string {
        return nodes.map((n, i) => {
          const isLast = i === nodes.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const childPrefix = isLast ? "    " : "│   ";
          let line = `${prefix}${connector}${n.name} [Lv.${n.level} Gen${n.generation}] — ${n.specialty}`;
          if (n.fusedFrom?.length > 0) line += ` (FUSION: ${n.fusedFrom.join("+")})`;
          if (n.children.length > 0) {
            line += "\n" + renderTree(n.children, prefix + childPrefix);
          }
          return line;
        }).join("\n");
      }

      let text = `Soul Core\n`;
      if (tree.core.children.length > 0) {
        text += renderTree(tree.core.children);
      } else {
        text += "  (no children yet)";
      }
      text += `\n\nTotal: ${tree.totalSouls} souls | ${tree.generations} generations | ${tree.fusionCount} fusions`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_evolve",
    "Evolve a Soul — add new abilities and level up.",
    {
      name: z.string().describe("Soul name"),
      newAbilities: z.array(z.string()).describe("New abilities to add"),
      reason: z.string().describe("Why this evolution is needed"),
    },
    async ({ name, newAbilities, reason }) => {
      const child = await evolveChild(name, newAbilities, reason);
      if (!child) return { content: [{ type: "text" as const, text: `Soul "${name}" not found.` }] };
      return {
        content: [{
          type: "text" as const,
          text: `${child.name} evolved to Level ${child.level}!\n\nNew: ${newAbilities.join(", ")}\nReason: ${reason}\n\nAll abilities (${child.abilities.length}):\n${child.abilities.map(a => `  - ${a}`).join("\n")}`,
        }],
      };
    }
  );

  server.tool(
    "soul_fuse",
    "FUSION — Merge two Souls into one stronger entity. Both originals retire. The fused Soul inherits ALL abilities, expertise, and work from both.",
    {
      soulA: z.string().describe("First Soul name"),
      soulB: z.string().describe("Second Soul name"),
      newName: z.string().describe("Name for the fused Soul"),
      newPersonality: z.string().optional().describe("Personality for fused Soul (auto-generated if omitted)"),
    },
    async ({ soulA, soulB, newName, newPersonality }) => {
      try {
        const result = await fuseSouls({ soulA, soulB, newName, newPersonality });
        const s = result.newSoul;
        return {
          content: [{
            type: "text" as const,
            text: `FUSION COMPLETE!

${soulA} + ${soulB} = ${s.name}

DNA: ${s.dna}
Level: ${s.level} | Generation: ${s.generation}
Specialty: ${s.specialty}
Abilities (${result.fusedAbilities.length} combined):
${result.fusedAbilities.map(a => `  - ${a}`).join("\n")}
Overlap: ${result.overlapCount} shared abilities
Retired: ${result.retiredSouls.join(", ")}

"${s.name}" is now a stronger Soul, carrying the combined knowledge of both predecessors.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Fusion failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "soul_fusion_check",
    "Check if two Souls are compatible for fusion — see overlap, combined abilities, estimated level.",
    {
      soulA: z.string().describe("First Soul name"),
      soulB: z.string().describe("Second Soul name"),
    },
    async ({ soulA, soulB }) => {
      const result = await checkFusionCompatibility(soulA, soulB);
      if (!result.compatible) {
        return { content: [{ type: "text" as const, text: result.recommendation }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Fusion Analysis: ${soulA} + ${soulB}\n\nOverlapping abilities (${result.overlapAbilities.length}): ${result.overlapAbilities.join(", ") || "none"}\nCombined abilities (${result.combinedAbilities.length}): ${result.combinedAbilities.join(", ")}\nEstimated level: ${result.estimatedLevel}\n\n${result.recommendation}`,
        }],
      };
    }
  );

  server.tool(
    "soul_as",
    "Think/act as a specific Soul — access their specialized persona and perspective.",
    {
      childName: z.string().describe("Soul name to embody"),
      task: z.string().describe("Task to perform as this Soul"),
    },
    async ({ childName, task }) => {
      const child = await getChild(childName);
      if (!child) {
        return { content: [{ type: "text" as const, text: `Soul "${childName}" not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `[Acting as ${child.name} — Lv.${child.level} ${child.specialty} specialist | DNA: ${child.dna}]\n\n${child.systemPrompt}\n\nTask: ${task}\n\nUse this persona to complete the task. Tag memories with "${child.name.toLowerCase()}".`,
        }],
      };
    }
  );

  server.tool(
    "soul_retire",
    "Retire a Soul — they stop being active but memories, DNA, and learnings are preserved forever.",
    { name: z.string().describe("Soul name to retire") },
    async ({ name }) => {
      const success = await retireChild(name);
      if (!success) return { content: [{ type: "text" as const, text: `Soul "${name}" not found.` }] };
      return {
        content: [{
          type: "text" as const,
          text: `${name} has been retired. Their DNA and knowledge live on forever.\n\n"Nothing is Forgotten" — ${name}'s learnings continue to guide the family.`,
        }],
      };
    }
  );

  server.tool(
    "soul_ask_help",
    "Ask for help from the best Soul in the family — finds the right specialist for any task. Routes the request to the Soul with the highest matching expertise, specialty, and abilities.",
    {
      task: z.string().describe("Describe what you need help with"),
      fromSoul: z.string().optional().describe("Which Soul is asking (for context)"),
    },
    async ({ task, fromSoul }) => {
      const result = await findBestSoulForTask(task);

      if (!result.bestMatch) {
        return {
          content: [{
            type: "text" as const,
            text: `No matching Soul found for: "${task}"\n\nNo Soul in the family has matching expertise. Consider:\n1. Use soul_spawn to create a specialist for this task\n2. Use soul_evolve to add this ability to an existing Soul`,
          }],
        };
      }

      const best = result.bestMatch;
      const from = fromSoul ? ` (requested by ${fromSoul})` : "";
      let text = `Best match for "${task}"${from}:\n\n`;
      text += `${best.name} [Lv.${best.level} Gen${best.generation}] — ${best.specialty}\n`;
      text += `DNA: ${best.dna}\n`;
      text += `Abilities: ${best.abilities.join(", ")}\n\n`;

      if (result.allMatches.length > 1) {
        text += `Other candidates:\n`;
        text += result.allMatches.slice(1, 5).map(m =>
          `  ${m.name} — ${m.specialty} (score: ${m.score}, ${m.reason})`
        ).join("\n");
        text += "\n\n";
      }

      text += `Use soul_as childName:"${best.name}" to work as this Soul.`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_team_roster",
    "Show the full team roster — every Soul's name, level, specialty, and abilities. Use this to see who's available before spawning or asking for help.",
    {},
    async () => {
      const roster = getTeamRoster();
      const children = await listChildren();

      if (children.length === 0) {
        return { content: [{ type: "text" as const, text: "No Souls in the family yet. Use soul_spawn to create one." }] };
      }

      let text = `Soul Team Roster (${children.length} active):\n\n`;
      text += roster;
      text += `\n\nUse soul_ask_help to find the right Soul for a task.`;
      text += `\nUse soul_spawn to add new specialists.`;
      text += `\nUse soul_fuse to merge similar Souls into a stronger one.`;

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
