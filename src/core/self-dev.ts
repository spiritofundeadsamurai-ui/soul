/**
 * Self-Development Engine — Soul can modify and extend itself
 *
 * Gives Soul the ability to:
 * - Read/write/edit its own source files
 * - Create new engines and tools
 * - Build and test the project
 * - Auto-register new capabilities
 *
 * Safety: Cannot modify core philosophy, master binding, or this file itself.
 * All changes are backed up before modification.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { getRawDb } from "../db/index.js";

// ─── Constants ───

const thisDir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(thisDir, "..", "..");
const SRC_DIR = join(PROJECT_ROOT, "src");
const BACKUP_DIR = join(PROJECT_ROOT, ".soul-backups");

// Files that CANNOT be modified (safety guard)
const PROTECTED_FILES = [
  "src/core/philosophy.ts",
  "src/core/master.ts",
  "src/core/security.ts",
  "src/core/self-dev.ts", // can't modify itself
];

let tableReady = false;
function ensureDevTable() {
  if (tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_dev_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      file_path TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      backup_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  tableReady = true;
}

function logAction(action: string, filePath: string | null, description: string, status: string, error?: string, backupPath?: string) {
  ensureDevTable();
  const db = getRawDb();
  db.prepare("INSERT INTO soul_dev_log (action, file_path, description, status, error, backup_path) VALUES (?, ?, ?, ?, ?, ?)")
    .run(action, filePath, description, status, error || null, backupPath || null);
}

// ─── File Operations ───

function isProtected(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return PROTECTED_FILES.some(p => normalized.includes(p));
}

function resolveSrcPath(relativePath: string): string {
  // Accept both "src/core/foo.ts" and "core/foo.ts"
  const cleaned = relativePath.replace(/\\/g, "/");
  if (cleaned.startsWith("src/")) return join(PROJECT_ROOT, cleaned);
  return join(SRC_DIR, cleaned);
}

function backupFile(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) return null;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = absolutePath.replace(PROJECT_ROOT, "").replace(/[/\\]/g, "_") + "." + timestamp;
  const backupPath = join(BACKUP_DIR, backupName);
  copyFileSync(absolutePath, backupPath);
  return backupPath;
}

/**
 * Read a source file
 */
export function readSource(relativePath: string): { success: boolean; content?: string; error?: string } {
  try {
    const fullPath = resolveSrcPath(relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: `File not found: ${relativePath}` };
    }
    const content = readFileSync(fullPath, "utf-8");
    return { success: true, content };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Write/create a source file
 */
export function writeSource(relativePath: string, content: string, description: string): { success: boolean; message: string } {
  if (isProtected(relativePath)) {
    return { success: false, message: `BLOCKED: ${relativePath} is a protected core file and cannot be modified.` };
  }

  try {
    const fullPath = resolveSrcPath(relativePath);
    const backupPath = backupFile(fullPath);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");

    logAction("write", relativePath, description, "success", undefined, backupPath || undefined);
    return { success: true, message: `Written: ${relativePath}${backupPath ? " (backup saved)" : ""}` };
  } catch (e: any) {
    logAction("write", relativePath, description, "error", e.message);
    return { success: false, message: `Write failed: ${e.message}` };
  }
}

/**
 * Edit a source file (search & replace)
 */
export function editSource(relativePath: string, search: string, replace: string, description: string): { success: boolean; message: string } {
  if (isProtected(relativePath)) {
    return { success: false, message: `BLOCKED: ${relativePath} is a protected core file.` };
  }

  try {
    const fullPath = resolveSrcPath(relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, message: `File not found: ${relativePath}` };
    }

    const content = readFileSync(fullPath, "utf-8");
    if (!content.includes(search)) {
      return { success: false, message: `Search string not found in ${relativePath}` };
    }

    const backupPath = backupFile(fullPath);
    const newContent = content.replace(search, replace);
    writeFileSync(fullPath, newContent, "utf-8");

    logAction("edit", relativePath, description, "success", undefined, backupPath || undefined);
    return { success: true, message: `Edited: ${relativePath} (backup saved)` };
  } catch (e: any) {
    logAction("edit", relativePath, description, "error", e.message);
    return { success: false, message: `Edit failed: ${e.message}` };
  }
}

/**
 * List source files in a directory
 */
export function listSource(relativePath?: string): { files: string[]; dirs: string[] } {
  const fullPath = relativePath ? resolveSrcPath(relativePath) : SRC_DIR;
  if (!existsSync(fullPath)) return { files: [], dirs: [] };

  const entries = readdirSync(fullPath, { withFileTypes: true });
  return {
    files: entries.filter(e => e.isFile()).map(e => e.name),
    dirs: entries.filter(e => e.isDirectory()).map(e => e.name),
  };
}

// ─── Build & Test ───

/**
 * Build the project (npm run build)
 */
export function buildProject(): { success: boolean; output: string } {
  try {
    const output = execSync("npm run build", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    logAction("build", null, "npm run build", "success");
    return { success: true, output: output.trim() || "Build successful" };
  } catch (e: any) {
    const errOutput = (e.stderr || e.stdout || e.message || "").toString().substring(0, 2000);
    logAction("build", null, "npm run build", "error", errOutput);
    return { success: false, output: `Build failed:\n${errOutput}` };
  }
}

/**
 * Run tests (npx vitest run)
 */
export function runTests(): { success: boolean; output: string; passed?: number; total?: number } {
  try {
    const output = execSync("npx vitest run 2>&1", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse test results
    const passMatch = output.match(/(\d+) passed/);
    const totalMatch = output.match(/Tests\s+(\d+) passed\s+\((\d+)\)/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const total = totalMatch ? parseInt(totalMatch[2]) : passed;

    logAction("test", null, `vitest: ${passed}/${total} passed`, "success");
    return { success: true, output: output.trim().split("\n").slice(-10).join("\n"), passed, total };
  } catch (e: any) {
    const errOutput = (e.stderr || e.stdout || e.message || "").toString().substring(0, 2000);
    logAction("test", null, "vitest run", "error", errOutput);
    return { success: false, output: `Tests failed:\n${errOutput}` };
  }
}

// ─── High-Level Operations ───

/**
 * Create a new engine module (src/core/xxx.ts) + register it
 */
export function createEngine(input: {
  name: string;
  description: string;
  code: string;
}): { success: boolean; message: string } {
  const fileName = `src/core/${input.name}.ts`;

  // Add header comment
  const fullCode = `/**\n * ${input.description}\n * Auto-generated by Soul Self-Dev Engine\n */\n\n${input.code}`;

  const result = writeSource(fileName, fullCode, `Create engine: ${input.description}`);
  return result;
}

/**
 * Create a new tool module (src/tools/xxx.ts) + wire it up
 */
export function createToolModule(input: {
  name: string;
  description: string;
  code: string;
  registerFunctionName: string;
}): { success: boolean; message: string; steps: string[] } {
  const steps: string[] = [];

  // 1. Write tool file
  const fileName = `src/tools/${input.name}.ts`;
  const fullCode = `/**\n * ${input.description}\n * Auto-generated by Soul Self-Dev Engine\n */\n\n${input.code}`;
  const writeResult = writeSource(fileName, fullCode, `Create tool: ${input.description}`);
  if (!writeResult.success) return { ...writeResult, steps };
  steps.push(`Created ${fileName}`);

  // 2. Add import to index.ts
  const indexResult = editSource(
    "src/index.ts",
    'import { registerMt5Tools } from "./tools/mt5.js";',
    `import { registerMt5Tools } from "./tools/mt5.js";\nimport { ${input.registerFunctionName} } from "./tools/${input.name}.js";`,
    `Import ${input.registerFunctionName} in index.ts`
  );
  if (indexResult.success) steps.push("Added import to index.ts");

  // 3. Add registration call
  const regResult = editSource(
    "src/index.ts",
    "registerMt5Tools(collector as any);",
    `registerMt5Tools(collector as any);\n  ${input.registerFunctionName}(collector as any);`,
    `Register ${input.registerFunctionName} in index.ts`
  );
  if (regResult.success) steps.push("Added registration to index.ts");

  return { success: true, message: `Tool module created: ${fileName}`, steps };
}

/**
 * Full development cycle: write → build → test → report
 */
export async function developAndDeploy(input: {
  description: string;
  files: Array<{ path: string; content: string }>;
  edits?: Array<{ path: string; search: string; replace: string }>;
}): Promise<{ success: boolean; message: string; steps: string[] }> {
  const steps: string[] = [];

  // 1. Write files
  for (const f of input.files) {
    const r = writeSource(f.path, f.content, input.description);
    steps.push(r.success ? `✅ Wrote ${f.path}` : `❌ ${r.message}`);
    if (!r.success) return { success: false, message: r.message, steps };
  }

  // 2. Apply edits
  if (input.edits) {
    for (const e of input.edits) {
      const r = editSource(e.path, e.search, e.replace, input.description);
      steps.push(r.success ? `✅ Edited ${e.path}` : `❌ ${r.message}`);
      if (!r.success) return { success: false, message: r.message, steps };
    }
  }

  // 3. Build
  const buildResult = buildProject();
  steps.push(buildResult.success ? "✅ Build passed" : `❌ Build failed`);
  if (!buildResult.success) {
    // Rollback: restore backups
    steps.push("⚠️ Build failed — code saved but not deployed. Fix errors and rebuild.");
    return { success: false, message: `Build failed:\n${buildResult.output}`, steps };
  }

  // 4. Test
  const testResult = runTests();
  steps.push(testResult.success ? `✅ Tests passed (${testResult.passed}/${testResult.total})` : "⚠️ Some tests failed");

  return {
    success: true,
    message: `Development complete: ${input.description}\n${steps.join("\n")}`,
    steps,
  };
}

/**
 * Get development history
 */
export function getDevHistory(limit: number = 20): any[] {
  ensureDevTable();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_dev_log ORDER BY created_at DESC LIMIT ?").all(limit);
}

/**
 * Restore a file from backup
 */
export function restoreBackup(backupPath: string, targetPath: string): { success: boolean; message: string } {
  try {
    const fullBackup = backupPath.startsWith(BACKUP_DIR) ? backupPath : join(BACKUP_DIR, backupPath);
    if (!existsSync(fullBackup)) return { success: false, message: "Backup not found" };

    const fullTarget = resolveSrcPath(targetPath);
    copyFileSync(fullBackup, fullTarget);
    logAction("restore", targetPath, `Restored from ${backupPath}`, "success");
    return { success: true, message: `Restored ${targetPath} from backup` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get project structure overview
 */
export function getProjectStructure(): string {
  const lines: string[] = ["Soul Project Structure:", ""];

  function listDir(dir: string, prefix: string, depth: number) {
    if (depth > 3) return;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
      if (e.isDirectory()) {
        lines.push(`${prefix}📁 ${e.name}/`);
        listDir(join(dir, e.name), prefix + "  ", depth + 1);
      } else if (e.name.endsWith(".ts") || e.name.endsWith(".json") || e.name.endsWith(".py")) {
        lines.push(`${prefix}📄 ${e.name}`);
      }
    }
  }

  listDir(SRC_DIR, "  ", 0);
  return lines.join("\n");
}
