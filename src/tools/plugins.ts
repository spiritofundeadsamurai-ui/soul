import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  installPlugin,
  installLocalPlugin,
  uninstallPlugin,
  listPlugins,
  enablePlugin,
  disablePlugin,
  getPluginStats,
  scaffoldPlugin,
} from "../core/plugin-marketplace.js";

export function registerPluginTools(server: McpServer) {
  server.tool(
    "soul_plugin_install",
    "Install a Soul plugin — from npm package name or local directory path. Plugins add new tools to Soul. Example: soul_plugin_install('soul-plugin-weather')",
    {
      source: z.string().describe("npm package name (e.g. 'soul-plugin-weather') or local directory path"),
    },
    async ({ source }) => {
      // Detect if local path or npm package
      const isPath = source.includes("/") || source.includes("\\") || source.startsWith(".");
      const result = isPath
        ? await installLocalPlugin(source)
        : await installPlugin(source);
      return text(result.message);
    }
  );

  server.tool(
    "soul_plugin_uninstall",
    "Uninstall a Soul plugin by name.",
    {
      name: z.string().describe("Plugin name to uninstall"),
    },
    async ({ name }) => {
      const result = await uninstallPlugin(name);
      return text(result.message);
    }
  );

  server.tool(
    "soul_plugins",
    "List all installed Soul plugins — shows name, version, tool count, active status.",
    {},
    async () => {
      const plugins = listPlugins();
      const stats = getPluginStats();

      if (plugins.length === 0) {
        return text(
          "No plugins installed.\n\n" +
          "Install plugins:\n" +
          "  soul_plugin_install('package-name')  — from npm\n" +
          "  soul_plugin_install('/path/to/dir')   — local\n\n" +
          "Create your own:\n" +
          "  soul_plugin_scaffold('my-plugin')     — generates template"
        );
      }

      const lines = plugins.map(p =>
        `${p.isActive ? "✅" : "❌"} ${p.name} v${p.version} — ${p.toolCount} tools (${p.source})${p.description ? `\n   ${p.description}` : ""}`
      );

      return text(
        `Plugins (${stats.active}/${stats.total} active, ${stats.totalTools} tools):\n\n${lines.join("\n")}\n\nDir: ${stats.pluginsDir}`
      );
    }
  );

  server.tool(
    "soul_plugin_enable",
    "Enable a disabled plugin.",
    { name: z.string().describe("Plugin name") },
    async ({ name }) => {
      const result = enablePlugin(name);
      return text(result.message);
    }
  );

  server.tool(
    "soul_plugin_disable",
    "Disable a plugin without uninstalling it.",
    { name: z.string().describe("Plugin name") },
    async ({ name }) => {
      const result = disablePlugin(name);
      return text(result.message);
    }
  );

  server.tool(
    "soul_plugin_scaffold",
    "Create a new plugin template — generates a ready-to-code plugin directory with package.json, index.js, and README.",
    {
      name: z.string().describe("Plugin name (e.g. 'my-weather-plugin')"),
      outputDir: z.string().optional().describe("Output directory (default: ~/.soul/plugins/<name>)"),
    },
    async ({ name, outputDir }) => {
      const result = scaffoldPlugin(name, outputDir);
      return text(result.message);
    }
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
