import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMasterProfile,
  setProfileEntry,
  getProfileEntries,
} from "../core/master-profile.js";

export function registerMasterProfileTools(server: McpServer) {
  server.tool(
    "soul_master_profile",
    "View Soul's understanding of its master — language preferences, communication style, expertise, interests. Soul builds this automatically from every interaction.",
    {},
    async () => {
      const profile = getMasterProfile();
      const entries = getProfileEntries();

      if (!profile || entries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "Master profile is still being built. Soul learns from every interaction — language, style, interests, expertise. The more we talk, the better Soul understands you.",
          }],
        };
      }

      let text = `=== Master Profile ===\n\n${profile}\n\n`;
      text += `Raw entries (${entries.length}):\n`;
      for (const e of entries) {
        text += `  ${e.key}: ${e.value} (${Math.round(e.confidence * 100)}% confident)\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_master_set",
    "Manually set a master profile entry — tell Soul about master's preferences, expertise, or interests.",
    {
      key: z.string().describe("Profile key (e.g. expertise, interests, personality, preferred_tools)"),
      value: z.string().describe("Profile value"),
      confidence: z.number().min(0).max(1).default(0.8).describe("How confident (0-1)"),
    },
    async ({ key, value, confidence }) => {
      setProfileEntry(key, value, confidence);
      return {
        content: [{
          type: "text" as const,
          text: `Master profile updated: ${key} = "${value}" (${Math.round(confidence * 100)}% confidence)`,
        }],
      };
    }
  );
}
