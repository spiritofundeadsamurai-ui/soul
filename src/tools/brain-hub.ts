import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSoulMode, setSoulMode, getConfig, setConfig,
  createBrainPack, importBrainPack, importBrainPackFromFile,
  listBrainPacks, toggleBrainPack, uninstallBrainPack,
  getAvailableBrainFiles, getBrainHubStats, generateStarterPack,
} from "../core/brain-hub.js";

export function registerBrainHubTools(server: McpServer) {

  // ─── Mode Management ───

  server.tool(
    "soul_mode",
    "Get or set Soul's operating mode — 'private' (all data local) or 'open' (can import/export brain packs).",
    {
      mode: z.enum(["private", "open"]).optional().describe("Set mode (omit to just check current mode)"),
    },
    async ({ mode }) => {
      if (mode) {
        setSoulMode(mode);
        return {
          content: [{
            type: "text" as const,
            text: `Soul mode set to: ${mode.toUpperCase()}\n\n${mode === "private"
              ? "All data stays local. Brain pack import/export disabled."
              : "Brain Hub enabled. You can now create, import, and share brain packs."}`,
          }],
        };
      }
      const current = getSoulMode();
      const stats = getBrainHubStats();
      return {
        content: [{
          type: "text" as const,
          text: `Current mode: ${current.toUpperCase()}\n\nInstalled packs: ${stats.installedPacks}\nActive packs: ${stats.activePacks}\nTotal imported items: ${stats.totalImportedItems}\nAvailable brain files: ${stats.availableFiles}\nBrains directory: ${stats.brainsDir}`,
        }],
      };
    }
  );

  server.tool(
    "soul_config_set",
    "Set a Soul configuration value (e.g., sharing preferences, display options).",
    {
      key: z.string().describe("Config key"),
      value: z.string().describe("Config value"),
    },
    async ({ key, value }) => {
      setConfig(key, value);
      return { content: [{ type: "text" as const, text: `Config set: ${key} = ${value}` }] };
    }
  );

  // ─── Brain Pack Creation ───

  server.tool(
    "soul_brain_create",
    "Create a Brain Pack from Soul's knowledge — selective export. Packages knowledge, patterns, code snippets, and templates into a shareable .brain.json file.",
    {
      name: z.string().describe("Pack name (e.g., 'My TypeScript Patterns')"),
      description: z.string().describe("What this brain pack contains"),
      author: z.string().describe("Author name"),
      categories: z.array(z.string()).optional().describe("Categories to include"),
      tags: z.array(z.string()).optional().describe("Tags for discoverability"),
      includeKnowledge: z.boolean().default(true).describe("Include knowledge entries"),
      includePatterns: z.boolean().default(true).describe("Include learned patterns"),
      includeSnippets: z.boolean().default(true).describe("Include code snippets"),
      includeTemplates: z.boolean().default(true).describe("Include project templates"),
      knowledgeCategories: z.array(z.string()).optional().describe("Filter knowledge by these categories only"),
      minConfidence: z.number().min(0).max(1).default(0.5).describe("Minimum confidence threshold"),
      license: z.string().default("MIT").describe("License for the brain pack"),
    },
    async (opts) => {
      const mode = getSoulMode();
      if (mode === "private") {
        return { content: [{ type: "text" as const, text: "Soul is in PRIVATE mode. Switch to OPEN mode first:\n  soul_mode mode:open" }] };
      }

      const { pack, filePath } = await createBrainPack(opts);
      const m = pack.manifest;
      return {
        content: [{
          type: "text" as const,
          text: `Brain Pack Created!\n\nName: ${m.name}\nID: ${m.id}\nAuthor: ${m.author}\nItems: ${m.itemCount} (${pack.knowledge.length} knowledge, ${pack.patterns.length} patterns, ${pack.snippets.length} snippets, ${pack.templates.length} templates)\nFile: ${filePath}\nChecksum: ${m.checksum.substring(0, 16)}...\n\nShare this .brain.json file with other Soul instances!`,
        }],
      };
    }
  );

  // ─── Brain Pack Import ───

  server.tool(
    "soul_brain_import",
    "Import a Brain Pack from a file path — adds knowledge, patterns, snippets, templates to Soul's brain. Safety-scanned before import.",
    {
      filePath: z.string().describe("Path to .brain.json file"),
    },
    async ({ filePath }) => {
      const mode = getSoulMode();
      if (mode === "private") {
        return { content: [{ type: "text" as const, text: "Soul is in PRIVATE mode. Switch to OPEN mode first:\n  soul_mode mode:open" }] };
      }

      try {
        const result = await importBrainPackFromFile(filePath);
        const imp = result.imported;
        let text = `Brain Pack Imported: "${result.name}"\n\n`;
        text += `Knowledge: +${imp.knowledge}\nPatterns: +${imp.patterns}\nSnippets: +${imp.snippets}\nTemplates: +${imp.templates}\n`;
        if (result.rejected > 0) text += `\nRejected (safety): ${result.rejected}`;
        if (result.warnings.length > 0) text += `\nWarnings:\n${result.warnings.map(w => `  - ${w}`).join("\n")}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Import failed: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "soul_brain_import_json",
    "Import a Brain Pack from raw JSON string — for receiving packs from peers or APIs.",
    {
      json: z.string().describe("Brain pack JSON string"),
      source: z.enum(["file", "url", "peer"]).default("peer").describe("Source type"),
    },
    async ({ json, source }) => {
      const mode = getSoulMode();
      if (mode === "private") {
        return { content: [{ type: "text" as const, text: "Soul is in PRIVATE mode. Switch to OPEN mode first." }] };
      }

      try {
        const result = await importBrainPack(json, source);
        const imp = result.imported;
        return {
          content: [{
            type: "text" as const,
            text: `Imported "${result.name}": +${imp.knowledge} knowledge, +${imp.patterns} patterns, +${imp.snippets} snippets, +${imp.templates} templates${result.rejected > 0 ? ` (${result.rejected} rejected)` : ""}`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Import failed: ${err.message}` }] };
      }
    }
  );

  // ─── Starter Packs ───

  server.tool(
    "soul_brain_starter",
    "Install a pre-built starter brain pack — instant knowledge boost. Topics: web-dev, python, devops, security.",
    {
      topic: z.enum(["web-dev", "python", "devops", "security"]).describe("Starter pack topic"),
    },
    async ({ topic }) => {
      const mode = getSoulMode();
      if (mode === "private") {
        return { content: [{ type: "text" as const, text: "Soul is in PRIVATE mode. Switch to OPEN mode first." }] };
      }

      try {
        const pack = generateStarterPack(topic);
        const result = await importBrainPack(pack, "file", "starter");
        const imp = result.imported;
        return {
          content: [{
            type: "text" as const,
            text: `Starter Pack "${result.name}" installed!\n\n+${imp.knowledge} knowledge entries\n+${imp.patterns} patterns\n+${imp.snippets} code snippets\n+${imp.templates} templates\n\nSoul's brain is now enhanced with ${topic} knowledge!`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${err.message}` }] };
      }
    }
  );

  // ─── Management ───

  server.tool(
    "soul_brain_list",
    "List all installed brain packs — see what knowledge has been imported.",
    {},
    async () => {
      const packs = listBrainPacks();
      if (packs.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No brain packs installed.\n\nGet started:\n  soul_brain_starter topic:web-dev    — Install web dev knowledge\n  soul_brain_starter topic:security   — Install security patterns\n  soul_brain_import filePath:...      — Import from file\n  soul_brain_create ...               — Export your knowledge",
          }],
        };
      }

      const text = packs.map(p =>
        `${p.isActive ? "[ON]" : "[OFF]"} ${p.name} v${p.version}\n  by ${p.author} | ${p.itemCount} items | ${p.source}\n  ID: ${p.packId}\n  Installed: ${p.installedAt}`
      ).join("\n\n");

      return { content: [{ type: "text" as const, text: `Brain Packs (${packs.length}):\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_brain_toggle",
    "Enable or disable a brain pack without removing it.",
    {
      packId: z.string().describe("Brain pack ID"),
      active: z.boolean().describe("true to enable, false to disable"),
    },
    async ({ packId, active }) => {
      const result = toggleBrainPack(packId, active);
      return {
        content: [{
          type: "text" as const,
          text: result ? `Brain pack ${active ? "enabled" : "disabled"}.` : "Brain pack not found.",
        }],
      };
    }
  );

  server.tool(
    "soul_brain_uninstall",
    "Remove a brain pack (metadata only — imported knowledge stays in Soul's memory).",
    {
      packId: z.string().describe("Brain pack ID to remove"),
    },
    async ({ packId }) => {
      const result = uninstallBrainPack(packId);
      return {
        content: [{
          type: "text" as const,
          text: result.removed
            ? `Brain pack "${result.name}" removed. Knowledge it imported remains in Soul's memory.`
            : "Brain pack not found.",
        }],
      };
    }
  );

  server.tool(
    "soul_brain_files",
    "List available .brain.json files in the brain-packs directory — files that can be imported.",
    {},
    async () => {
      const files = getAvailableBrainFiles();
      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: "No .brain.json files found.\n\nCreate one with soul_brain_create or download from a peer." }] };
      }

      const text = files.map(f =>
        `${f.fileName}\n  Size: ${(f.size / 1024).toFixed(1)} KB | Modified: ${f.modified}`
      ).join("\n\n");

      return { content: [{ type: "text" as const, text: `Available brain files:\n\n${text}` }] };
    }
  );

  server.tool(
    "soul_brain_hub_stats",
    "Brain Hub overview — mode, installed packs, stats.",
    {},
    async () => {
      const stats = getBrainHubStats();
      return {
        content: [{
          type: "text" as const,
          text: `=== Brain Hub ===\n\nMode: ${stats.mode.toUpperCase()}\nInstalled packs: ${stats.installedPacks}\nActive packs: ${stats.activePacks}\nTotal imported items: ${stats.totalImportedItems}\nAvailable brain files: ${stats.availableFiles}\nDirectory: ${stats.brainsDir}`,
        }],
      };
    }
  );
}
