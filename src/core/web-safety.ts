/**
 * Web Safety Engine — Protect Soul from dangerous websites
 *
 * Soul can browse the web to learn, but must be cautious:
 * 1. Detect phishing, malware, scam sites
 * 2. Block known dangerous domains
 * 3. Analyze URL patterns for red flags
 * 4. Rate limit aggressive fetching
 * 5. Sanitize extracted content
 */

import { getRawDb } from "../db/index.js";
import { remember } from "../memory/memory-engine.js";

export interface SafetyCheck {
  url: string;
  safe: boolean;
  risk: "none" | "low" | "medium" | "high" | "blocked";
  reasons: string[];
  domain: string;
  category: string;
}

// Known dangerous TLD patterns
const SUSPICIOUS_TLDS = [
  ".tk", ".ml", ".ga", ".cf", ".gq", // Free TLDs commonly used for phishing
  ".buzz", ".top", ".xyz", ".click", ".link", // Often used for spam
  ".zip", ".mov", // Confusing TLDs that mimic file extensions
];

// Known safe domains (whitelist)
const TRUSTED_DOMAINS = new Set([
  "github.com", "stackoverflow.com", "wikipedia.org",
  "developer.mozilla.org", "docs.python.org", "nodejs.org",
  "npmjs.com", "pypi.org", "crates.io",
  "youtube.com", "www.youtube.com", "youtu.be",
  "reddit.com", "www.reddit.com", "old.reddit.com",
  "twitter.com", "x.com", "nitter.net",
  "medium.com", "dev.to", "hashnode.dev",
  "arxiv.org", "scholar.google.com",
  "news.ycombinator.com",
  "docs.google.com", "drive.google.com",
  "learn.microsoft.com", "docs.microsoft.com",
  "aws.amazon.com", "cloud.google.com",
  "reactjs.org", "vuejs.org", "angular.io", "svelte.dev",
  "tailwindcss.com", "nextjs.org",
]);

// URL patterns that indicate danger
const DANGER_PATTERNS = [
  /login.*\.(?!com|org|net|io|dev)/i, // Fake login pages
  /paypal.*(?!paypal\.com)/i, // PayPal phishing
  /bank.*(?!\.go\.th|\.com)/i, // Fake banking sites
  /free.*download.*\.exe/i, // Malware downloads
  /crack|keygen|serial/i, // Software piracy
  /casino|betting|gambling/i, // Gambling sites
  /adult|porn|xxx/i, // Adult content
  /@.*@/i, // Multiple @ signs (URL confusion)
  /[а-яА-Я]/i, // Cyrillic chars in URLs (homograph attacks)
  /data:/i, // Data URIs
  /javascript:/i, // JS injection
];

// Content patterns that indicate dangerous pages
const DANGEROUS_CONTENT_PATTERNS = [
  /password.*input.*type/i,
  /<form.*action=["'](?!https:\/\/)/i, // Forms posting to non-HTTPS
  /eval\s*\(/i,
  /document\.cookie/i,
  /window\.location\s*=/i,
  /\.exe["']|\.bat["']|\.cmd["']|\.scr["']/i, // Executable downloads
];

function ensureSafetyTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_url_safety (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      safe INTEGER NOT NULL DEFAULT 1,
      risk TEXT NOT NULL DEFAULT 'none',
      reasons TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'unknown',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_blocked_domains (
      domain TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Check if a URL is safe to visit
 */
export async function checkUrlSafety(url: string): Promise<SafetyCheck> {
  ensureSafetyTable();

  const reasons: string[] = [];
  let risk: SafetyCheck["risk"] = "none";
  let category = "unknown";

  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url, safe: false, risk: "blocked",
      reasons: ["Invalid URL format"],
      domain: "invalid", category: "invalid",
    };
  }

  const domain = parsed.hostname.toLowerCase();
  const fullUrl = url.toLowerCase();

  // Check blocked domains
  const rawDb = getRawDb();
  const blocked = rawDb
    .prepare("SELECT reason FROM soul_blocked_domains WHERE domain = ?")
    .get(domain) as any;

  if (blocked) {
    return {
      url, safe: false, risk: "blocked",
      reasons: [`Blocked domain: ${blocked.reason}`],
      domain, category: "blocked",
    };
  }

  // Check protocol
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      url, safe: false, risk: "blocked",
      reasons: [`Dangerous protocol: ${parsed.protocol}`],
      domain, category: "protocol",
    };
  }

  // Check trusted domains
  if (TRUSTED_DOMAINS.has(domain)) {
    category = "trusted";
    risk = "none";
  } else {
    // Check suspicious TLDs
    for (const tld of SUSPICIOUS_TLDS) {
      if (domain.endsWith(tld)) {
        reasons.push(`Suspicious TLD: ${tld}`);
        risk = "medium";
        category = "suspicious-tld";
      }
    }

    // Check danger patterns in URL
    for (const pattern of DANGER_PATTERNS) {
      if (pattern.test(fullUrl)) {
        reasons.push(`Dangerous URL pattern: ${pattern.source}`);
        risk = "high";
        category = "dangerous-pattern";
      }
    }

    // Check for IP addresses instead of domains
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
      reasons.push("URL uses IP address instead of domain name");
      risk = risk === "high" ? "high" : "medium";
    }

    // Check for very long subdomains (phishing technique)
    const parts = domain.split(".");
    if (parts.some(p => p.length > 40)) {
      reasons.push("Suspiciously long subdomain");
      risk = risk === "high" ? "high" : "medium";
    }

    // Check for lookalike domains
    const lookalikes: Record<string, string> = {
      "g00gle": "google", "faceb00k": "facebook", "amaz0n": "amazon",
      "micr0soft": "microsoft", "appl3": "apple", "netfl1x": "netflix",
      "paypai": "paypal", "linkedln": "linkedin",
    };
    for (const [fake, real] of Object.entries(lookalikes)) {
      if (domain.includes(fake)) {
        reasons.push(`Possible typosquat of ${real}`);
        risk = "high";
        category = "typosquat";
      }
    }

    // No HTTPS
    if (parsed.protocol === "http:" && !domain.endsWith(".localhost") && domain !== "localhost") {
      reasons.push("No HTTPS encryption");
      if (risk === "none") risk = "low";
    }

    // Determine category for unknown sites
    if (category === "unknown") {
      if (domain.endsWith(".edu") || domain.endsWith(".ac.th")) category = "education";
      else if (domain.endsWith(".gov") || domain.endsWith(".go.th")) category = "government";
      else if (domain.endsWith(".org")) category = "organization";
      else category = "general";
    }
  }

  const safe = risk !== "high";

  // Log the check
  rawDb.prepare(
    "INSERT INTO soul_url_safety (url, domain, safe, risk, reasons, category) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(url, domain, safe ? 1 : 0, risk, JSON.stringify(reasons), category);

  return { url, safe, risk, reasons, domain, category };
}

/**
 * Scan page content for dangerous elements
 */
export function scanContent(html: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  for (const pattern of DANGEROUS_CONTENT_PATTERNS) {
    if (pattern.test(html)) {
      warnings.push(`Suspicious content pattern: ${pattern.source}`);
    }
  }

  // Check for excessive redirects or scripts
  const scriptCount = (html.match(/<script/gi) || []).length;
  if (scriptCount > 20) {
    warnings.push(`Excessive scripts (${scriptCount})`);
  }

  // Check for hidden iframes
  const hiddenIframes = (html.match(/iframe.*style=["'].*display:\s*none|visibility:\s*hidden/gi) || []).length;
  if (hiddenIframes > 0) {
    warnings.push(`Hidden iframes detected (${hiddenIframes})`);
  }

  return { safe: warnings.length === 0, warnings };
}

/**
 * Block a domain permanently
 */
export async function blockDomain(domain: string, reason: string): Promise<void> {
  ensureSafetyTable();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT OR REPLACE INTO soul_blocked_domains (domain, reason) VALUES (?, ?)"
  ).run(domain.toLowerCase(), reason);

  await remember({
    content: `[Safety] Blocked domain: ${domain} — ${reason}`,
    type: "wisdom",
    tags: ["safety", "blocked-domain", domain],
    source: "web-safety",
  });
}

/**
 * Get safety stats
 */
export function getSafetyStats(): {
  totalChecks: number;
  blockedDomains: number;
  riskBreakdown: Record<string, number>;
  recentBlocks: Array<{ domain: string; reason: string }>;
} {
  ensureSafetyTable();
  const rawDb = getRawDb();

  const totalChecks = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_url_safety").get() as any)?.c || 0;
  const blockedDomains = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_blocked_domains").get() as any)?.c || 0;

  const riskBreakdown: Record<string, number> = {};
  const riskRows = rawDb.prepare("SELECT risk, COUNT(*) as c FROM soul_url_safety GROUP BY risk").all() as any[];
  for (const r of riskRows) {
    riskBreakdown[r.risk] = r.c;
  }

  const recentBlocks = rawDb.prepare(
    "SELECT domain, reason FROM soul_blocked_domains ORDER BY blocked_at DESC LIMIT 10"
  ).all() as any[];

  return { totalChecks, blockedDomains, riskBreakdown, recentBlocks };
}
