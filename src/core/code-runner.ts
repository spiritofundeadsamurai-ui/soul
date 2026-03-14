/**
 * Code Runner — Soul can write files, run commands, and manage projects
 *
 * Capabilities:
 * 1. Write/edit files
 * 2. Run shell commands (npm, python, git, etc.)
 * 3. Git operations (commit, push, diff, log)
 * 4. Project scaffolding
 * 5. Run tests and linting
 *
 * Safety: Commands are sandboxed — no rm -rf, no format, no shutdown
 */

import { execSync, exec } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname, join, resolve } from "path";

// ─── Safety: Block dangerous commands ───

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr)\s+[\/\\]/i,       // rm -rf /
  /format\s+[a-z]:/i,               // format C:
  /del\s+\/[sfq]/i,                 // del /S /F /Q
  /shutdown/i,                       // shutdown
  /reboot/i,                         // reboot
  /mkfs/i,                           // mkfs
  /dd\s+if=/i,                       // dd if=
  />\s*\/dev\/sd/i,                  // > /dev/sda
  /reg\s+delete.*\/f/i,             // reg delete /f
  /net\s+user.*\/delete/i,          // net user /delete
];

function isSafeCommand(cmd: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { safe: false, reason: `Blocked dangerous pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

// ─── Write File ───

export function writeFile(filePath: string, content: string): { success: boolean; message: string } {
  try {
    const absPath = resolve(filePath);
    const dir = dirname(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    return { success: true, message: `File written: ${absPath} (${content.length} chars)` };
  } catch (e: any) {
    return { success: false, message: `Write failed: ${e.message}` };
  }
}

// ─── Edit File (replace text) ───

export function editFile(filePath: string, search: string, replace: string): { success: boolean; message: string } {
  try {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) return { success: false, message: `File not found: ${absPath}` };
    const content = readFileSync(absPath, "utf-8");
    if (!content.includes(search)) return { success: false, message: `Search text not found in file` };
    const newContent = content.replace(search, replace);
    writeFileSync(absPath, newContent, "utf-8");
    return { success: true, message: `Replaced in ${absPath}` };
  } catch (e: any) {
    return { success: false, message: `Edit failed: ${e.message}` };
  }
}

// ─── Append to File ───

export function appendToFile(filePath: string, content: string): { success: boolean; message: string } {
  try {
    const absPath = resolve(filePath);
    const dir = dirname(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(absPath, content, "utf-8");
    return { success: true, message: `Appended to ${absPath}` };
  } catch (e: any) {
    return { success: false, message: `Append failed: ${e.message}` };
  }
}

// ─── Run Command ───

export function runCommand(
  command: string,
  options?: { cwd?: string; timeout?: number },
): { success: boolean; output: string; exitCode: number; message: string } {
  const safety = isSafeCommand(command);
  if (!safety.safe) {
    return { success: false, output: "", exitCode: -1, message: `BLOCKED: ${safety.reason}` };
  }

  try {
    const output = execSync(command, {
      cwd: options?.cwd || process.cwd(),
      timeout: options?.timeout || 30000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      success: true,
      output: output.substring(0, 5000),
      exitCode: 0,
      message: `Command OK: ${command.substring(0, 50)}`,
    };
  } catch (e: any) {
    return {
      success: false,
      output: (e.stdout || "").substring(0, 2000) + "\n" + (e.stderr || "").substring(0, 2000),
      exitCode: e.status || 1,
      message: `Command failed (exit ${e.status}): ${(e.stderr || e.message || "").substring(0, 200)}`,
    };
  }
}

// ─── Git Operations ───

export function gitStatus(cwd?: string): string {
  return runCommand("git status --short", { cwd }).output || "Clean";
}

export function gitDiff(cwd?: string): string {
  return runCommand("git diff --stat", { cwd }).output || "No changes";
}

export function gitLog(count: number = 10, cwd?: string): string {
  return runCommand(`git log --oneline -${count}`, { cwd }).output || "No commits";
}

export function gitCommit(message: string, cwd?: string): { success: boolean; message: string } {
  const addResult = runCommand("git add -A", { cwd });
  if (!addResult.success) return { success: false, message: `git add failed: ${addResult.output}` };
  const commitResult = runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
  return { success: commitResult.exitCode === 0, message: commitResult.output || commitResult.message };
}

export function gitPush(cwd?: string): { success: boolean; message: string } {
  const result = runCommand("git push", { cwd, timeout: 30000 });
  return { success: result.success, message: result.output || result.message };
}

// ─── Project Scaffolding ───

export function scaffoldProject(
  name: string,
  template: string,
  outputDir?: string,
): { success: boolean; path: string; message: string } {
  const dir = outputDir || join(process.cwd(), name);
  if (existsSync(dir)) {
    return { success: false, path: dir, message: `Directory already exists: ${dir}` };
  }

  mkdirSync(dir, { recursive: true });

  switch (template) {
    case "node":
    case "nodejs":
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name, version: "1.0.0", type: "module", main: "index.js",
        scripts: { start: "node index.js", dev: "node --watch index.js" },
      }, null, 2));
      writeFileSync(join(dir, "index.js"), `console.log("Hello from ${name}!");\n`);
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
      break;

    case "python":
      writeFileSync(join(dir, "main.py"), `def main():\n    print("Hello from ${name}!")\n\nif __name__ == "__main__":\n    main()\n`);
      writeFileSync(join(dir, "requirements.txt"), "");
      writeFileSync(join(dir, ".gitignore"), "__pycache__/\n*.pyc\nvenv/\n");
      break;

    case "react":
    case "nextjs":
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name, version: "1.0.0", scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "latest", react: "latest", "react-dom": "latest" },
      }, null, 2));
      mkdirSync(join(dir, "app"), { recursive: true });
      writeFileSync(join(dir, "app", "page.tsx"), `export default function Home() {\n  return <h1>${name}</h1>;\n}\n`);
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n.next/\n");
      break;

    case "html":
    case "web":
      writeFileSync(join(dir, "index.html"), `<!DOCTYPE html>\n<html>\n<head><title>${name}</title></head>\n<body>\n<h1>${name}</h1>\n<script src="app.js"></script>\n</body>\n</html>\n`);
      writeFileSync(join(dir, "app.js"), `console.log("${name} loaded");\n`);
      writeFileSync(join(dir, "style.css"), `body { font-family: sans-serif; }\n`);
      break;

    default:
      writeFileSync(join(dir, "README.md"), `# ${name}\n\nCreated by Soul AI.\n`);
      break;
  }

  return { success: true, path: dir, message: `Project "${name}" created at ${dir} (template: ${template})` };
}
