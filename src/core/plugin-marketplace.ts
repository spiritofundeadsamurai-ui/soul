/**
 * Plugin Marketplace — Load external MCP skill packages
 *
 * Inspired by OpenClaw's ClawHub (800+ skills). Soul can now load
 * third-party plugins from npm or local directories.
 *
 * Plugin structure:
 *   my-soul-plugin/
 *     package.json   { "soul": { "name": "...", "tools": [...] } }
 *     index.js       exports registerTools(registerFn)
 *
 * Soul auto-discovers plugins from:
 *   1. ~/.soul/plugins/ directory (local plugins)
 *   2. npm packages with "soul-plugin" keyword
 */

import { getRawDb } from "../db/index.js";
import { registerInternalTool, type InternalTool } from "./agent-loop.js";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// ─── Types ───

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  tools: string[];  // tool names this plugin provides
  homepage?: string;
}

export interface InstalledPlugin {
  id: number;
  name: string;
  version: string;
  description: string;
  author: string;
  source: string;       // "npm" | "local" | "git"
  packagePath: string;  // resolved path to plugin dir
  toolCount: number;
  isActive: boolean;
  installedAt: string;
}

// ─── State ───

let _tableReady = false;
const PLUGINS_DIR = join(homedir(), ".soul", "plugins");

function ensurePluginTable() {
  if (_tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL DEFAULT '0.0.0',
      description TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'npm',
      package_path TEXT NOT NULL,
      tool_count INTEGER NOT NULL DEFAULT 0,
      tool_names TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _tableReady = true;
}

function ensurePluginsDir() {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

// ─── Install Plugin ───

/**
 * Install a plugin from npm
 */
export async function installPlugin(packageName: string): Promise<{
  success: boolean;
  plugin?: InstalledPlugin;
  message: string;
}> {
  ensurePluginTable();
  ensurePluginsDir();

  // Check if already installed
  const db = getRawDb();
  const existing = db.prepare("SELECT * FROM soul_plugins WHERE name = ?").get(packageName) as any;
  if (existing && existing.is_active) {
    return { success: false, message: `Plugin "${packageName}" is already installed.` };
  }

  try {
    // Install from npm to plugins dir
    console.log(`[Plugin] Installing ${packageName}...`);
    execSync(`npm install --prefix "${PLUGINS_DIR}" ${packageName}`, {
      encoding: "utf-8",
      timeout: 120000,
      stdio: "pipe",
    });

    // Find the installed package
    const modulePath = join(PLUGINS_DIR, "node_modules", packageName);
    if (!existsSync(modulePath)) {
      return { success: false, message: `Package installed but not found at ${modulePath}` };
    }

    // Read manifest
    const manifest = readPluginManifest(modulePath, packageName);

    // Load and register tools
    const toolCount = await loadPluginTools(modulePath, manifest.name);

    // Save to DB
    const row = db.prepare(`
      INSERT OR REPLACE INTO soul_plugins (name, version, description, author, source, package_path, tool_count, tool_names, is_active)
      VALUES (?, ?, ?, ?, 'npm', ?, ?, ?, 1)
      RETURNING *
    `).get(
      manifest.name,
      manifest.version,
      manifest.description,
      manifest.author,
      modulePath,
      toolCount,
      JSON.stringify(manifest.tools),
    ) as any;

    const plugin = mapPlugin(row);
    console.log(`[Plugin] Installed "${manifest.name}" with ${toolCount} tools`);
    return { success: true, plugin, message: `Plugin "${manifest.name}" v${manifest.version} installed with ${toolCount} tools.` };
  } catch (e: any) {
    return { success: false, message: `Install failed: ${e.message}` };
  }
}

/**
 * Install a plugin from a local directory
 */
export async function installLocalPlugin(dirPath: string): Promise<{
  success: boolean;
  plugin?: InstalledPlugin;
  message: string;
}> {
  ensurePluginTable();

  if (!existsSync(dirPath)) {
    return { success: false, message: `Directory not found: ${dirPath}` };
  }

  try {
    const manifest = readPluginManifest(dirPath, dirPath);
    const toolCount = await loadPluginTools(dirPath, manifest.name);

    const db = getRawDb();
    const row = db.prepare(`
      INSERT OR REPLACE INTO soul_plugins (name, version, description, author, source, package_path, tool_count, tool_names, is_active)
      VALUES (?, ?, ?, ?, 'local', ?, ?, ?, 1)
      RETURNING *
    `).get(
      manifest.name,
      manifest.version,
      manifest.description,
      manifest.author,
      dirPath,
      toolCount,
      JSON.stringify(manifest.tools),
    ) as any;

    const plugin = mapPlugin(row);
    return { success: true, plugin, message: `Local plugin "${manifest.name}" loaded with ${toolCount} tools.` };
  } catch (e: any) {
    return { success: false, message: `Load failed: ${e.message}` };
  }
}

// ─── Plugin Loading ───

function readPluginManifest(pluginPath: string, fallbackName: string): PluginManifest {
  const pkgPath = join(pluginPath, "package.json");
  if (!existsSync(pkgPath)) {
    return { name: fallbackName, version: "0.0.0", description: "", author: "", tools: [] };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const soulMeta = pkg.soul || {};

  return {
    name: soulMeta.name || pkg.name || fallbackName,
    version: pkg.version || "0.0.0",
    description: soulMeta.description || pkg.description || "",
    author: soulMeta.author || pkg.author || "",
    tools: soulMeta.tools || [],
  };
}

/**
 * Load tools from a plugin module
 * Plugin must export: registerTools(registerFn) or default export with tools array
 */
async function loadPluginTools(pluginPath: string, pluginName: string): Promise<number> {
  let toolCount = 0;

  try {
    // Try loading the main entry point
    const mainPath = join(pluginPath, "index.js");
    const altPath = join(pluginPath, "dist", "index.js");
    const loadPath = existsSync(mainPath) ? mainPath : existsSync(altPath) ? altPath : null;

    if (!loadPath) {
      console.log(`[Plugin] No index.js found in ${pluginPath}`);
      return 0;
    }

    const pluginModule = await import(`file://${loadPath.replace(/\\/g, "/")}`);

    // Pattern 1: registerTools(registerFn) — most common
    if (typeof pluginModule.registerTools === "function") {
      const registerFn = (tool: InternalTool) => {
        // Prefix plugin tools with plugin name to avoid collisions
        const prefixedTool = {
          ...tool,
          name: tool.name.startsWith("soul_") ? tool.name : `soul_${tool.name}`,
          category: `plugin:${pluginName}`,
        };
        registerInternalTool(prefixedTool);
        toolCount++;
      };
      await pluginModule.registerTools(registerFn);
    }

    // Pattern 2: tools array export
    else if (Array.isArray(pluginModule.tools)) {
      for (const tool of pluginModule.tools) {
        if (tool.name && tool.execute) {
          registerInternalTool({
            ...tool,
            name: tool.name.startsWith("soul_") ? tool.name : `soul_${tool.name}`,
            category: `plugin:${pluginName}`,
          });
          toolCount++;
        }
      }
    }

    // Pattern 3: default export with registerTools
    else if (pluginModule.default?.registerTools) {
      const registerFn = (tool: InternalTool) => {
        registerInternalTool({
          ...tool,
          name: tool.name.startsWith("soul_") ? tool.name : `soul_${tool.name}`,
          category: `plugin:${pluginName}`,
        });
        toolCount++;
      };
      await pluginModule.default.registerTools(registerFn);
    }
  } catch (e: any) {
    console.error(`[Plugin] Failed to load tools from ${pluginName}: ${e.message}`);
  }

  return toolCount;
}

// ─── Plugin Management ───

export function listPlugins(): InstalledPlugin[] {
  ensurePluginTable();
  const db = getRawDb();
  const rows = db.prepare("SELECT * FROM soul_plugins ORDER BY name").all() as any[];
  return rows.map(mapPlugin);
}

export function getPlugin(name: string): InstalledPlugin | null {
  ensurePluginTable();
  const db = getRawDb();
  const row = db.prepare("SELECT * FROM soul_plugins WHERE name = ?").get(name) as any;
  return row ? mapPlugin(row) : null;
}

export function disablePlugin(name: string): { success: boolean; message: string } {
  ensurePluginTable();
  const db = getRawDb();
  const result = db.prepare("UPDATE soul_plugins SET is_active = 0 WHERE name = ?").run(name);
  if (result.changes === 0) return { success: false, message: `Plugin "${name}" not found.` };
  return { success: true, message: `Plugin "${name}" disabled. Restart Soul to take effect.` };
}

export function enablePlugin(name: string): { success: boolean; message: string } {
  ensurePluginTable();
  const db = getRawDb();
  const result = db.prepare("UPDATE soul_plugins SET is_active = 1 WHERE name = ?").run(name);
  if (result.changes === 0) return { success: false, message: `Plugin "${name}" not found.` };
  return { success: true, message: `Plugin "${name}" enabled. Restart Soul to take effect.` };
}

export async function uninstallPlugin(name: string): Promise<{ success: boolean; message: string }> {
  ensurePluginTable();
  const db = getRawDb();
  const plugin = db.prepare("SELECT * FROM soul_plugins WHERE name = ?").get(name) as any;
  if (!plugin) return { success: false, message: `Plugin "${name}" not found.` };

  // Remove from npm if it was installed via npm
  if (plugin.source === "npm") {
    try {
      execSync(`npm uninstall --prefix "${PLUGINS_DIR}" ${name}`, {
        encoding: "utf-8",
        timeout: 60000,
        stdio: "pipe",
      });
    } catch { /* ok — might not be in npm */ }
  }

  db.prepare("DELETE FROM soul_plugins WHERE name = ?").run(name);
  return { success: true, message: `Plugin "${name}" uninstalled. Restart Soul to remove tools.` };
}

/**
 * Load all active plugins at startup
 */
export async function loadAllPlugins(): Promise<number> {
  ensurePluginTable();
  const db = getRawDb();
  const plugins = db.prepare("SELECT * FROM soul_plugins WHERE is_active = 1").all() as any[];

  let totalTools = 0;
  for (const plugin of plugins) {
    if (!existsSync(plugin.package_path)) {
      console.log(`[Plugin] Skipping "${plugin.name}" — path not found: ${plugin.package_path}`);
      continue;
    }
    try {
      const count = await loadPluginTools(plugin.package_path, plugin.name);
      totalTools += count;
    } catch (e: any) {
      console.error(`[Plugin] Failed to load "${plugin.name}": ${e.message}`);
    }
  }

  return totalTools;
}

/**
 * Get plugin statistics
 */
export function getPluginStats(): {
  total: number;
  active: number;
  totalTools: number;
  pluginsDir: string;
} {
  ensurePluginTable();
  const db = getRawDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM soul_plugins").get() as any)?.c || 0;
  const active = (db.prepare("SELECT COUNT(*) as c FROM soul_plugins WHERE is_active = 1").get() as any)?.c || 0;
  const totalTools = (db.prepare("SELECT SUM(tool_count) as c FROM soul_plugins WHERE is_active = 1").get() as any)?.c || 0;
  return { total, active, totalTools, pluginsDir: PLUGINS_DIR };
}

/**
 * Generate a plugin scaffold for development
 */
export function scaffoldPlugin(name: string, outputDir?: string): {
  success: boolean;
  path: string;
  message: string;
} {
  const dir = outputDir || join(PLUGINS_DIR, name);
  if (existsSync(dir)) {
    return { success: false, path: dir, message: `Directory already exists: ${dir}` };
  }

  mkdirSync(dir, { recursive: true });

  // package.json
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    description: `Soul plugin: ${name}`,
    main: "index.js",
    type: "module",
    keywords: ["soul-plugin"],
    soul: {
      name,
      description: `${name} plugin for Soul AI`,
      tools: [`soul_${name.replace(/-/g, "_")}_example`],
    },
  }, null, 2));

  // index.js
  writeFileSync(join(dir, "index.js"), `/**
 * ${name} — Soul Plugin
 *
 * Export a registerTools function that receives a register callback.
 * Each tool needs: name, description, category, parameters (JSON Schema), execute (async fn → string)
 */

export function registerTools(register) {
  register({
    name: "soul_${name.replace(/-/g, "_")}_example",
    description: "Example tool from ${name} plugin",
    category: "plugin:${name}",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input text" },
      },
      required: ["input"],
    },
    execute: async (args) => {
      return \`Hello from ${name}! Input: \${args.input}\`;
    },
  });
}
`);

  // README
  writeFileSync(join(dir, "README.md"), `# ${name}

Soul AI plugin.

## Install

\`\`\`
# From Soul:
soul_plugin_install("${dir}")

# Or via npm:
npm publish
soul_plugin_install("${name}")
\`\`\`

## Tools

- \`soul_${name.replace(/-/g, "_")}_example\` — Example tool
`);

  return {
    success: true,
    path: dir,
    message: `Plugin scaffold created at ${dir}. Edit index.js to add your tools, then install with soul_plugin_install.`,
  };
}

// ─── Helpers ───

/**
 * Curated plugin registry — recommended plugins for Soul
 */
export function getPluginRegistry(): Array<{
  name: string;
  description: string;
  npm: string;
  category: string;
  stars: string;
}> {
  return [
    { name: "Weather", description: "Get weather forecasts for any location", npm: "soul-plugin-weather", category: "life", stars: "recommended" },
    { name: "Calculator", description: "Advanced math, unit conversion, currency", npm: "soul-plugin-calc", category: "tools", stars: "recommended" },
    { name: "RSS Reader", description: "Subscribe and read RSS/Atom feeds", npm: "soul-plugin-rss", category: "research", stars: "recommended" },
    { name: "Pomodoro", description: "Pomodoro timer with focus tracking", npm: "soul-plugin-pomodoro", category: "productivity", stars: "popular" },
    { name: "Translator", description: "Multi-language translation via LibreTranslate", npm: "soul-plugin-translate", category: "language", stars: "popular" },
    { name: "Notion Sync", description: "Sync Soul memories to Notion pages", npm: "soul-plugin-notion", category: "sync", stars: "new" },
    { name: "Calendar", description: "Local calendar with events and reminders", npm: "soul-plugin-calendar", category: "life", stars: "new" },
    { name: "Fitness", description: "Track workouts, steps, and health metrics", npm: "soul-plugin-fitness", category: "life", stars: "new" },
  ];
}

function mapPlugin(row: any): InstalledPlugin {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    source: row.source,
    packagePath: row.package_path,
    toolCount: row.tool_count,
    isActive: row.is_active === 1,
    installedAt: row.installed_at,
  };
}
