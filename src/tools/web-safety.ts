import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  checkUrlSafety,
  blockDomain,
  getSafetyStats,
} from "../core/web-safety.js";

export function registerWebSafetyTools(server: McpServer) {
  server.tool(
    "soul_url_check",
    "Check if a URL is safe before visiting — detects phishing, malware, scam sites, suspicious domains. Soul protects itself from dangerous websites.",
    {
      url: z.string().describe("URL to check for safety"),
    },
    async ({ url }) => {
      const check = await checkUrlSafety(url);

      let statusIcon = "";
      if (check.risk === "none") statusIcon = "SAFE";
      else if (check.risk === "low") statusIcon = "LOW RISK";
      else if (check.risk === "medium") statusIcon = "CAUTION";
      else if (check.risk === "high") statusIcon = "DANGEROUS";
      else statusIcon = "BLOCKED";

      let text = `[${statusIcon}] ${url}\n`;
      text += `Domain: ${check.domain}\n`;
      text += `Category: ${check.category}\n`;
      text += `Risk: ${check.risk}\n`;

      if (check.reasons.length > 0) {
        text += `\nWarnings:\n`;
        text += check.reasons.map(r => `  - ${r}`).join("\n");
      }

      if (!check.safe) {
        text += `\n\nSoul recommends NOT visiting this URL.`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_block_domain",
    "Block a dangerous domain permanently — Soul will never fetch from this domain again.",
    {
      domain: z.string().describe("Domain to block (e.g., 'malware-site.tk')"),
      reason: z.string().describe("Why this domain should be blocked"),
    },
    async ({ domain, reason }) => {
      await blockDomain(domain, reason);
      return {
        content: [{
          type: "text" as const,
          text: `Domain "${domain}" blocked permanently.\nReason: ${reason}\n\nSoul will refuse to fetch any URL from this domain.`,
        }],
      };
    }
  );

  server.tool(
    "soul_safety_stats",
    "View Soul's web safety statistics — how many URLs checked, risk breakdown, blocked domains.",
    {},
    async () => {
      const stats = getSafetyStats();

      let text = `=== Web Safety Stats ===\n\n`;
      text += `Total URL checks: ${stats.totalChecks}\n`;
      text += `Blocked domains: ${stats.blockedDomains}\n\n`;

      text += `Risk Breakdown:\n`;
      for (const [risk, count] of Object.entries(stats.riskBreakdown)) {
        text += `  ${risk}: ${count}\n`;
      }

      if (stats.recentBlocks.length > 0) {
        text += `\nRecently Blocked:\n`;
        for (const b of stats.recentBlocks) {
          text += `  ${b.domain} — ${b.reason}\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
