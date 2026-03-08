/**
 * Soul File System Tools — MCP tools for safe file reading and analysis
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readFile,
  listDir,
  searchFiles,
  getFileInfo,
  readCsvFile,
  analyzeProject,
} from "../core/file-system.js";

export function registerFileSystemTools(server: McpServer) {
  // 1. soul_read_file — Read a text file
  server.tool(
    "soul_read_file",
    "Read a text file safely — supports .txt, .md, .json, .csv, .ts, .js, .py, .html, .css, .yaml, .xml, .log, .sql, .sh and more. " +
    "Blocks sensitive files (.env, private keys, credentials). Max 10MB.",
    {
      path: z.string().describe("Absolute or relative path to the file"),
      maxLines: z
        .number()
        .optional()
        .describe("Maximum number of lines to read (default: 500)"),
      encoding: z
        .string()
        .optional()
        .describe("File encoding (default: utf-8)"),
    },
    async ({ path: filePath, maxLines, encoding }) => {
      try {
        const result = readFile(filePath, {
          maxLines,
          encoding: encoding as BufferEncoding | undefined,
        });

        const header = `File: ${result.path}\nSize: ${formatSize(result.size)} | Lines: ${result.lines}\n${"─".repeat(60)}\n`;

        return {
          content: [
            {
              type: "text" as const,
              text: header + result.content,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error reading file: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. soul_list_dir — List directory contents
  server.tool(
    "soul_list_dir",
    "List directory contents — shows files and subdirectories with size and modification date. " +
    "Can recurse into subdirectories. Skips node_modules, .git, etc. Max 1000 entries.",
    {
      path: z.string().describe("Directory path to list"),
      recursive: z
        .boolean()
        .optional()
        .describe("Recurse into subdirectories (default: false)"),
      maxDepth: z
        .number()
        .optional()
        .describe("Max recursion depth (default: 3)"),
    },
    async ({ path: dirPath, recursive, maxDepth }) => {
      try {
        const entries = listDir(dirPath, { recursive, maxDepth });

        if (entries.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `Directory is empty: ${dirPath}` },
            ],
          };
        }

        const lines = entries.map((e) => {
          const icon = e.type === "directory" ? "[dir] " : "      ";
          const size = e.type === "file" ? formatSize(e.size) : "";
          const modified = e.modified.split("T")[0];
          return `${icon}${e.name.padEnd(40)} ${size.padStart(10)} ${modified}`;
        });

        const header = `Directory: ${dirPath}\nEntries: ${entries.length}\n${"─".repeat(70)}\n`;

        return {
          content: [
            {
              type: "text" as const,
              text: header + lines.join("\n"),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error listing directory: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. soul_search_files — Search for files by name or content
  server.tool(
    "soul_search_files",
    "Search for files by name or content within a directory. " +
    "Name search matches file names containing the pattern. " +
    "Content search finds lines matching the pattern inside text files.",
    {
      basePath: z.string().describe("Directory to search in"),
      pattern: z.string().describe("Search pattern (file name or content text)"),
      contentSearch: z
        .boolean()
        .optional()
        .describe("Search inside file contents, not just names (default: false)"),
      maxResults: z
        .number()
        .optional()
        .describe("Maximum results to return (default: 50)"),
      fileTypes: z
        .array(z.string())
        .optional()
        .describe("Filter by file extensions, e.g. ['.ts', '.js']"),
    },
    async ({ basePath, pattern, contentSearch, maxResults, fileTypes }) => {
      try {
        const results = searchFiles(basePath, pattern, {
          contentSearch,
          maxResults,
          fileTypes,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No files found matching "${pattern}" in ${basePath}`,
              },
            ],
          };
        }

        const lines = results.map((r) => {
          if (r.type === "content_match") {
            return `${r.path}:${r.line}\n  ${r.matchedLine}`;
          }
          return `${r.path} (${formatSize(r.size)})`;
        });

        const header = `Search: "${pattern}" in ${basePath}\nResults: ${results.length}\nType: ${contentSearch ? "content" : "name"} search\n${"─".repeat(60)}\n`;

        return {
          content: [
            {
              type: "text" as const,
              text: header + lines.join("\n"),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error searching files: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // 4. soul_file_info — Get file metadata
  server.tool(
    "soul_file_info",
    "Get detailed file information — size, modification date, type, line count, and a preview of the first 10 lines.",
    {
      path: z.string().describe("Path to the file"),
    },
    async ({ path: filePath }) => {
      try {
        const info = getFileInfo(filePath);

        let text = `File: ${info.name}\n`;
        text += `Path: ${info.path}\n`;
        text += `Size: ${info.sizeHuman} (${info.size} bytes)\n`;
        text += `Type: ${info.mimeGuess}\n`;
        text += `Extension: ${info.extension || "(none)"}\n`;
        text += `Modified: ${info.modified}\n`;
        text += `Created: ${info.created}\n`;

        if (info.lines !== undefined) {
          text += `Lines: ${info.lines}\n`;
        }

        if (info.preview) {
          text += `\n${"─".repeat(40)} Preview ${"─".repeat(40)}\n`;
          text += info.preview;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error getting file info: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // 5. soul_read_csv — Read and parse CSV files
  server.tool(
    "soul_read_csv",
    "Read and parse a CSV/TSV file — returns headers and rows in a structured format. " +
    "Auto-detects delimiter (comma, tab, semicolon, pipe). Max 10MB, default 500 rows.",
    {
      path: z.string().describe("Path to the CSV file"),
      delimiter: z
        .string()
        .optional()
        .describe("Column delimiter (auto-detected if omitted)"),
      maxRows: z
        .number()
        .optional()
        .describe("Maximum rows to read (default: 500)"),
    },
    async ({ path: filePath, delimiter, maxRows }) => {
      try {
        const result = readCsvFile(filePath, { delimiter, maxRows });

        if (result.headers.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `CSV file is empty: ${filePath}` },
            ],
          };
        }

        let text = `CSV File: ${filePath}\n`;
        text += `Delimiter: "${result.delimiter === "\t" ? "TAB" : result.delimiter}"\n`;
        text += `Columns: ${result.headers.length}\n`;
        text += `Total rows: ${result.totalRows}`;
        if (result.rows.length < result.totalRows) {
          text += ` (showing ${result.rows.length})`;
        }
        text += `\n\n`;

        // Headers
        text += `Headers: ${result.headers.join(" | ")}\n`;
        text += `${"─".repeat(60)}\n`;

        // Rows (formatted as table)
        for (const row of result.rows.slice(0, 20)) {
          text += row.join(" | ") + "\n";
        }

        if (result.rows.length > 20) {
          text += `\n... and ${result.rows.length - 20} more rows`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error reading CSV: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // 6. soul_analyze_project — Analyze a project directory
  server.tool(
    "soul_analyze_project",
    "Analyze a project directory — detects languages, counts files, shows structure, " +
    "reads dependencies from package.json. Skips node_modules, .git, dist, build.",
    {
      path: z.string().describe("Path to the project directory"),
    },
    async ({ path: dirPath }) => {
      try {
        const analysis = analyzeProject(dirPath);

        let text = `Project: ${analysis.name}\n`;
        text += `Path: ${analysis.path}\n`;
        text += `${"─".repeat(60)}\n`;
        text += `Files: ${analysis.totalFiles} | Directories: ${analysis.totalDirectories}\n`;
        text += `Total size: ${analysis.totalSizeHuman}\n`;
        text += `Git: ${analysis.hasGit ? "yes" : "no"} | package.json: ${analysis.hasPackageJson ? "yes" : "no"} | tsconfig: ${analysis.hasTsConfig ? "yes" : "no"}\n`;

        if (analysis.languages.length > 0) {
          text += `\nLanguages:\n`;
          for (const lang of analysis.languages.slice(0, 15)) {
            const bar = "█".repeat(Math.max(1, Math.round(lang.percentage / 5)));
            text += `  ${lang.language.padEnd(15)} ${String(lang.files).padStart(5)} files  ${bar} ${lang.percentage}%\n`;
          }
        }

        text += `\nStructure:\n`;
        for (const item of analysis.structure) {
          text += `  ${item}\n`;
        }

        if (analysis.scripts && Object.keys(analysis.scripts).length > 0) {
          text += `\nScripts:\n`;
          for (const [name, cmd] of Object.entries(analysis.scripts)) {
            text += `  ${name}: ${cmd}\n`;
          }
        }

        if (analysis.dependencies && Object.keys(analysis.dependencies).length > 0) {
          text += `\nDependencies (${Object.keys(analysis.dependencies).length}):\n`;
          for (const [name, version] of Object.entries(analysis.dependencies).slice(0, 20)) {
            text += `  ${name}: ${version}\n`;
          }
          if (Object.keys(analysis.dependencies).length > 20) {
            text += `  ... and ${Object.keys(analysis.dependencies).length - 20} more\n`;
          }
        }

        if (analysis.devDependencies && Object.keys(analysis.devDependencies).length > 0) {
          text += `\nDev Dependencies (${Object.keys(analysis.devDependencies).length}):\n`;
          for (const [name, version] of Object.entries(analysis.devDependencies).slice(0, 10)) {
            text += `  ${name}: ${version}\n`;
          }
          if (Object.keys(analysis.devDependencies).length > 10) {
            text += `  ... and ${Object.keys(analysis.devDependencies).length - 10} more\n`;
          }
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Error analyzing project: ${e.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

// ─── Helpers ───

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
