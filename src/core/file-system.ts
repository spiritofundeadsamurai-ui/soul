/**
 * Soul File System Module — Safe file reading and analysis
 *
 * Gives Soul the ability to read and analyze files on the local machine
 * with strict safety guards to protect sensitive data and system files.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { safePath } from "./security.js";

// ─── Constants ───

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DIR_ENTRIES = 1000;
const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_ROWS = 500;

/** File extensions Soul is allowed to read */
const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".ts", ".js", ".py", ".html", ".css",
  ".yaml", ".yml", ".xml", ".log", ".sql", ".sh", ".bat", ".ps1",
  ".toml", ".ini", ".cfg", ".conf", ".jsx", ".tsx", ".vue", ".svelte",
  ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".r", ".m", ".swift", ".dart",
  ".gitignore", ".dockerignore", ".editorconfig",
]);

/** File names that are allowed even without standard extensions */
const ALLOWED_FILENAMES = new Set([
  "Makefile", "Dockerfile", "Jenkinsfile", "Procfile",
  "LICENSE", "COPYING", "AUTHORS", "CONTRIBUTORS",
  ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc",
  ".eslintrc", ".babelrc", ".npmrc",
]);

/** Directories that must never be accessed */
const BLOCKED_PATHS = [
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".gcloud",
  ".config/gcloud",
  ".kube",
  ".docker/config.json",
  "AppData/Roaming/Mozilla/Firefox/Profiles",
  "AppData/Local/Google/Chrome/User Data",
  "AppData/Roaming/Microsoft/Credentials",
  "AppData/Roaming/Microsoft/Protect",
  "Library/Keychains",
  ".password-store",
  ".local/share/keyrings",
];

/** File name patterns that must never be read */
const BLOCKED_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\..+$/,
  /^credentials\.json$/,
  /^service[_-]?account.*\.json$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_dsa$/,
  /^id_ecdsa$/,
  /.*\.pem$/,
  /.*\.key$/,
  /.*\.pfx$/,
  /.*\.p12$/,
  /.*\.keystore$/,
  /.*\.jks$/,
  /^known_hosts$/,
  /^authorized_keys$/,
  /^\.netrc$/,
  /^\.npmrc$/,         // may contain auth tokens
  /^\.pypirc$/,
  /^token\.json$/,
  /^secrets\.json$/,
  /^master\.key$/,
  /^Login Data$/,
  /^Cookies$/,
  /^Web Data$/,
];

// ─── Types ───

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modified: string;
  extension: string;
}

export interface SearchResult {
  path: string;
  name: string;
  type: "name_match" | "content_match";
  /** Line number for content matches */
  line?: number;
  /** Matching line content for content matches */
  matchedLine?: string;
  size: number;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  sizeHuman: string;
  modified: string;
  created: string;
  extension: string;
  mimeGuess: string;
  lines?: number;
  preview?: string;
}

export interface CsvResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
  delimiter: string;
}

export interface ProjectAnalysis {
  name: string;
  path: string;
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  totalSizeHuman: string;
  languages: { language: string; files: number; percentage: number }[];
  structure: string[];
  hasPackageJson: boolean;
  hasGit: boolean;
  hasTsConfig: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

// ─── Configuration ───

let allowedBaseDirs: string[] = [os.homedir(), process.cwd()];

/**
 * Configure which base directories Soul is allowed to access.
 * All file operations must resolve within one of these directories.
 */
export function setAllowedBaseDirs(dirs: string[]): void {
  allowedBaseDirs = dirs.map(d => path.resolve(d));
}

export function getAllowedBaseDirs(): string[] {
  return [...allowedBaseDirs];
}

export function addAllowedBaseDir(dir: string): void {
  const resolved = path.resolve(dir);
  if (!allowedBaseDirs.includes(resolved)) {
    allowedBaseDirs.push(resolved);
  }
}

// ─── Safety Checks ───

/**
 * Validate that a path is safe to access.
 * Checks: within allowed base dirs, not in blocked paths, not a blocked file.
 */
function validatePath(filePath: string): string {
  const resolved = path.resolve(filePath);

  // Must be within at least one allowed base directory
  const isInAllowedBase = allowedBaseDirs.some(base => {
    const normalizedBase = path.resolve(base);
    return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
  });

  if (!isInAllowedBase) {
    // Also use safePath from security module for each base
    let safe = false;
    for (const base of allowedBaseDirs) {
      try {
        safePath(resolved, base);
        safe = true;
        break;
      } catch {
        // try next base
      }
    }
    if (!safe) {
      throw new Error(
        `Access denied: path is outside allowed directories. ` +
        `Allowed: ${allowedBaseDirs.join(", ")}`
      );
    }
  }

  // Check blocked path segments
  const normalizedForCheck = resolved.replace(/\\/g, "/");
  for (const blocked of BLOCKED_PATHS) {
    const blockedNorm = blocked.replace(/\\/g, "/");
    if (normalizedForCheck.includes(`/${blockedNorm}`) || normalizedForCheck.includes(`/${blockedNorm}/`)) {
      throw new Error(`Access denied: blocked path segment "${blocked}"`);
    }
  }

  return resolved;
}

/**
 * Check if a specific file name is blocked (secrets, keys, etc.)
 */
function isFileBlocked(fileName: string): boolean {
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file extension is in the allowed set
 */
function isExtensionAllowed(filePath: string): boolean {
  const baseName = path.basename(filePath);
  if (ALLOWED_FILENAMES.has(baseName)) return true;

  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    // Files without extension — only allow known filenames
    return ALLOWED_FILENAMES.has(baseName);
  }
  return ALLOWED_EXTENSIONS.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function guessMimeType(ext: string): string {
  const mimes: Record<string, string> = {
    ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
    ".csv": "text/csv", ".xml": "text/xml", ".html": "text/html",
    ".css": "text/css", ".yaml": "text/yaml", ".yml": "text/yaml",
    ".ts": "text/typescript", ".js": "text/javascript", ".py": "text/x-python",
    ".sh": "text/x-shellscript", ".sql": "text/x-sql", ".log": "text/plain",
    ".go": "text/x-go", ".rs": "text/x-rust", ".java": "text/x-java",
    ".rb": "text/x-ruby", ".php": "text/x-php", ".c": "text/x-c",
    ".cpp": "text/x-c++", ".h": "text/x-c", ".hpp": "text/x-c++",
  };
  return mimes[ext.toLowerCase()] || "text/plain";
}

// ─── Core Functions ───

/**
 * Read a text file safely.
 */
export function readFile(
  filePath: string,
  options: { maxLines?: number; encoding?: BufferEncoding } = {}
): { content: string; lines: number; size: number; path: string } {
  const resolved = validatePath(filePath);
  const baseName = path.basename(resolved);

  if (isFileBlocked(baseName)) {
    throw new Error(`Access denied: "${baseName}" is a blocked file (may contain secrets)`);
  }

  if (!isExtensionAllowed(resolved)) {
    throw new Error(
      `Access denied: file type "${path.extname(resolved) || "(no extension)"}" is not in the allowed list. ` +
      `Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`
    );
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${resolved}`);
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${formatSize(stat.size)} exceeds ${formatSize(MAX_FILE_SIZE)} limit`
    );
  }

  const encoding = options.encoding || "utf-8";
  const raw = fs.readFileSync(resolved, { encoding });
  const allLines = raw.split(/\r?\n/);
  const maxLines = options.maxLines || DEFAULT_MAX_LINES;
  const truncated = allLines.length > maxLines;
  const lines = truncated ? allLines.slice(0, maxLines) : allLines;
  const content = lines.join("\n") + (truncated ? `\n\n... (truncated, showing ${maxLines} of ${allLines.length} lines)` : "");

  return {
    content,
    lines: allLines.length,
    size: stat.size,
    path: resolved,
  };
}

/**
 * List directory contents safely.
 */
export function listDir(
  dirPath: string,
  options: { recursive?: boolean; maxDepth?: number } = {}
): FileEntry[] {
  const resolved = validatePath(dirPath);
  const stat = fs.statSync(resolved);

  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  const recursive = options.recursive || false;
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const entries: FileEntry[] = [];

  function walk(dir: string, depth: number): void {
    if (entries.length >= MAX_DIR_ENTRIES) return;
    if (depth > maxDepth) return;

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable directories
    }

    for (const item of items) {
      if (entries.length >= MAX_DIR_ENTRIES) break;

      const fullPath = path.join(dir, item.name);

      // Skip blocked paths
      try {
        validatePath(fullPath);
      } catch {
        continue;
      }

      // Skip hidden directories in recursive walk (except top level)
      if (recursive && depth > 0 && item.name.startsWith(".") && item.isDirectory()) {
        continue;
      }

      // Skip node_modules, .git, etc. in recursive walk
      if (recursive && ["node_modules", ".git", "__pycache__", ".next", "dist", "build"].includes(item.name) && item.isDirectory()) {
        continue;
      }

      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const type: FileEntry["type"] = item.isFile()
        ? "file"
        : item.isDirectory()
          ? "directory"
          : item.isSymbolicLink()
            ? "symlink"
            : "other";

      entries.push({
        name: item.name,
        path: fullPath,
        type,
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
        extension: item.isFile() ? path.extname(item.name).toLowerCase() : "",
      });

      if (recursive && item.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(resolved, 0);

  // Sort: directories first, then files alphabetically
  entries.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Search for files by name or content.
 */
export function searchFiles(
  basePath: string,
  pattern: string,
  options: { contentSearch?: boolean; maxResults?: number; fileTypes?: string[] } = {}
): SearchResult[] {
  const resolved = validatePath(basePath);
  const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
  const contentSearch = options.contentSearch || false;
  const fileTypes = options.fileTypes
    ? new Set(options.fileTypes.map(t => t.startsWith(".") ? t : `.${t}`))
    : null;

  const results: SearchResult[] = [];
  const patternLower = pattern.toLowerCase();
  const patternRegex = contentSearch ? new RegExp(escapeRegex(pattern), "i") : null;

  function walk(dir: string, depth: number): void {
    if (results.length >= maxResults || depth > 10) return;

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dir, item.name);

      try {
        validatePath(fullPath);
      } catch {
        continue;
      }

      // Skip heavy directories
      if (item.isDirectory()) {
        if (["node_modules", ".git", "__pycache__", ".next", "dist", "build", ".cache"].includes(item.name)) {
          continue;
        }
        walk(fullPath, depth + 1);
        continue;
      }

      if (!item.isFile()) continue;

      // Check file type filter
      const ext = path.extname(item.name).toLowerCase();
      if (fileTypes && !fileTypes.has(ext)) continue;

      // Name match
      if (item.name.toLowerCase().includes(patternLower)) {
        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        results.push({
          path: fullPath,
          name: item.name,
          type: "name_match",
          size: fileStat.size,
        });
      }

      // Content match
      if (contentSearch && patternRegex && isExtensionAllowed(fullPath) && !isFileBlocked(item.name)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (patternRegex.test(lines[i])) {
              results.push({
                path: fullPath,
                name: item.name,
                type: "content_match",
                line: i + 1,
                matchedLine: lines[i].trim().substring(0, 200),
                size: stat.size,
              });
              break; // one match per file for content search
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(resolved, 0);
  return results;
}

/**
 * Get detailed file information.
 */
export function getFileInfo(filePath: string): FileInfo {
  const resolved = validatePath(filePath);
  const stat = fs.statSync(resolved);
  const baseName = path.basename(resolved);
  const ext = path.extname(resolved).toLowerCase();

  const info: FileInfo = {
    path: resolved,
    name: baseName,
    size: stat.size,
    sizeHuman: formatSize(stat.size),
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
    extension: ext,
    mimeGuess: guessMimeType(ext),
  };

  // Add line count and preview for readable text files
  if (
    stat.isFile() &&
    stat.size <= MAX_FILE_SIZE &&
    isExtensionAllowed(resolved) &&
    !isFileBlocked(baseName)
  ) {
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const lines = content.split(/\r?\n/);
      info.lines = lines.length;
      info.preview = lines.slice(0, 10).join("\n");
      if (lines.length > 10) {
        info.preview += "\n...";
      }
    } catch {
      // not readable as text
    }
  }

  return info;
}

/**
 * Read and parse a CSV file.
 */
export function readCsvFile(
  filePath: string,
  options: { delimiter?: string; maxRows?: number } = {}
): CsvResult {
  const resolved = validatePath(filePath);
  const baseName = path.basename(resolved);

  if (isFileBlocked(baseName)) {
    throw new Error(`Access denied: "${baseName}" is a blocked file`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".csv" && ext !== ".tsv" && ext !== ".txt") {
    throw new Error(`Not a CSV/TSV file: ${ext}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${formatSize(stat.size)} exceeds ${formatSize(MAX_FILE_SIZE)} limit`);
  }

  const content = fs.readFileSync(resolved, "utf-8");
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [], totalRows: 0, delimiter: options.delimiter || "," };
  }

  // Auto-detect delimiter if not specified
  const delimiter = options.delimiter || detectDelimiter(lines[0]);
  const maxRows = options.maxRows || DEFAULT_MAX_ROWS;

  const headers = parseCsvLine(lines[0], delimiter);
  const totalRows = lines.length - 1;
  const rows: string[][] = [];

  for (let i = 1; i < lines.length && rows.length < maxRows; i++) {
    rows.push(parseCsvLine(lines[i], delimiter));
  }

  return { headers, rows, totalRows, delimiter };
}

/**
 * Analyze a project directory — languages, structure, dependencies.
 */
export function analyzeProject(dirPath: string): ProjectAnalysis {
  const resolved = validatePath(dirPath);
  const stat = fs.statSync(resolved);

  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  const projectName = path.basename(resolved);
  const langCounts = new Map<string, number>();
  let totalFiles = 0;
  let totalDirs = 0;
  let totalSize = 0;
  const topLevelStructure: string[] = [];

  // Scan top-level for structure
  try {
    const topItems = fs.readdirSync(resolved, { withFileTypes: true });
    for (const item of topItems) {
      const prefix = item.isDirectory() ? "[dir]  " : "[file] ";
      topLevelStructure.push(`${prefix}${item.name}`);
    }
  } catch {
    // skip
  }

  // Deep scan for language stats
  function scan(dir: string, depth: number): void {
    if (depth > 8) return;

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        if (["node_modules", ".git", "__pycache__", ".next", "dist", "build", ".cache", "vendor", "target"].includes(item.name)) {
          continue;
        }
        totalDirs++;
        scan(fullPath, depth + 1);
      } else if (item.isFile()) {
        totalFiles++;
        try {
          const s = fs.statSync(fullPath);
          totalSize += s.size;
        } catch {
          // skip
        }

        const ext = path.extname(item.name).toLowerCase();
        const lang = extToLanguage(ext);
        if (lang) {
          langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
        }
      }
    }
  }

  scan(resolved, 0);

  // Sort languages by file count
  const languages = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, files]) => ({
      language,
      files,
      percentage: totalFiles > 0 ? Math.round((files / totalFiles) * 100) : 0,
    }));

  // Check for common project indicators
  const hasPackageJson = fs.existsSync(path.join(resolved, "package.json"));
  const hasGit = fs.existsSync(path.join(resolved, ".git"));
  const hasTsConfig = fs.existsSync(path.join(resolved, "tsconfig.json"));

  const analysis: ProjectAnalysis = {
    name: projectName,
    path: resolved,
    totalFiles,
    totalDirectories: totalDirs,
    totalSize,
    totalSizeHuman: formatSize(totalSize),
    languages,
    structure: topLevelStructure,
    hasPackageJson,
    hasGit,
    hasTsConfig,
  };

  // Parse package.json for dependencies
  if (hasPackageJson) {
    try {
      const pkgContent = fs.readFileSync(path.join(resolved, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgContent);
      if (pkg.dependencies) analysis.dependencies = pkg.dependencies;
      if (pkg.devDependencies) analysis.devDependencies = pkg.devDependencies;
      if (pkg.scripts) analysis.scripts = pkg.scripts;
    } catch {
      // skip
    }
  }

  return analysis;
}

// ─── Helpers ───

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  const pipes = (line.match(/\|/g) || []).length;

  const max = Math.max(commas, tabs, semis, pipes);
  if (max === 0) return ",";
  if (tabs === max) return "\t";
  if (semis === max) return ";";
  if (pipes === max) return "|";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter || (delimiter === "\t" && char === "\t")) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

function extToLanguage(ext: string): string | null {
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java", ".kt": "Kotlin",
    ".c": "C", ".h": "C",
    ".cpp": "C++", ".hpp": "C++", ".cc": "C++",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".dart": "Dart",
    ".r": "R",
    ".m": "Objective-C",
    ".cs": "C#",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".html": "HTML",
    ".css": "CSS", ".scss": "SCSS", ".sass": "Sass", ".less": "Less",
    ".sql": "SQL",
    ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell",
    ".yaml": "YAML", ".yml": "YAML",
    ".json": "JSON",
    ".xml": "XML",
    ".md": "Markdown",
    ".toml": "TOML",
  };
  return map[ext] || null;
}
