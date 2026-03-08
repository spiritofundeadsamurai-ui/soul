import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  saveSnapshotToFile,
  loadSnapshotFromFile,
  getSyncStatus,
} from "../core/sync.js";

export function registerSyncTools(server: McpServer) {
  server.tool(
    "soul_export",
    "Export Soul's entire memory and state as a snapshot file — for backup or cross-device sync.",
    {
      filePath: z
        .string()
        .optional()
        .describe(
          "Output file path (defaults to ~/.soul/snapshot-{timestamp}.json)"
        ),
    },
    async ({ filePath }) => {
      const outputPath = await saveSnapshotToFile(filePath);
      return {
        content: [
          {
            type: "text" as const,
            text: `Snapshot exported to: ${outputPath}\n\nThis file contains all of Soul's memories, learnings, goals, habits, skills, and more.\nUse soul_import on another device to sync.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_import",
    "Import a Soul snapshot — merge memories and data from another device or backup.",
    {
      filePath: z
        .string()
        .describe("Path to the snapshot file"),
    },
    async ({ filePath }) => {
      try {
        const result = await loadSnapshotFromFile(filePath);

        const importedText = Object.entries(result.imported)
          .filter(([, count]) => count > 0)
          .map(([key, count]) => `  ${key}: ${count} new`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Snapshot imported!\n\nNew data merged:\n${importedText || "  (no new data)"}\nConflicts (skipped duplicates): ${result.conflicts}\n\nSoul's memory is now synchronized.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Import failed: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "soul_sync_status",
    "Check sync status — device ID, last export, available snapshots.",
    {},
    async () => {
      const status = await getSyncStatus();
      return {
        content: [
          {
            type: "text" as const,
            text: `Sync Status:\n\nDevice ID: ${status.deviceId}\nSnapshot directory: ${status.snapshotDir}\nSnapshots available: ${status.snapshotCount}\nLast export: ${status.lastExport || "never"}`,
          },
        ],
      };
    }
  );
}
