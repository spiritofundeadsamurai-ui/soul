/**
 * Soul Collective Network — Real P2P sync, discovery, consensus & evolution
 *
 * 3 major systems:
 * 1. Soul Hub — Central/decentralized registry for discovery
 * 2. Real Sync Protocol — HTTP push/pull between Soul instances
 * 3. Collective Evolution — Shared tools, skills, brain packs with voting
 *
 * === SECURITY (CRITICAL) ===
 * - NEVER share: API keys, passwords, tokens, master info, personal names,
 *   account numbers, private memories, file paths, IP addresses
 * - ALL outgoing data passes through multi-layer sanitization
 * - Master must APPROVE before any sharing happens
 * - Receiving data is validated and sandboxed
 * - Anonymous instance IDs only (SHA-256 hash, no real identity)
 * - Trust levels: new peers start at 0.1, earn trust through good contributions
 */

import { getRawDb } from "../db/index.js";
import { remember, hybridSearch } from "../memory/memory-engine.js";
import { getLearnings } from "../memory/learning.js";
import {
  containsSensitiveData,
  logSecurityEvent,
  isUrlSafe,
  redactSensitiveData,
} from "./security.js";
import { createHash, randomUUID } from "crypto";

// ─── Constants ───

const NETWORK_VERSION = "1.0.0";
const MAX_SHARE_ITEMS = 100;
const MIN_CONFIDENCE_TO_SHARE = 0.7; // Only share high-confidence knowledge
const MIN_TRUST_TO_RECEIVE = 0.3;    // Minimum trust level to accept knowledge
const MAX_PEERS = 50;
const SYNC_TIMEOUT_MS = 15000;
const INSTANCE_ID_KEY = "soul_network_instance_id";

// Patterns that MUST be stripped before sharing (multi-layer)
const PRIVATE_PATTERNS = [
  // API keys & tokens
  /(?:api[_-]?key|token|secret|password|passwd|pwd|auth|bearer|credential|access[_-]?key)\s*[:=]\s*\S+/gi,
  /(?:sk-|pk-|ak-|xox[bpas]-|ghp_|gho_|glpat-|AKIA)[A-Za-z0-9_\-]{10,}/g,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
  // IP addresses (private & public)
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  // File paths (Windows & Unix)
  /[A-Z]:\\[\w\s\\.-]+/gi,
  /\/(?:home|Users|root)\/[\w./-]+/g,
  // Account numbers, card numbers
  /\b\d{8,20}\b/g,
  // URLs with auth (user:pass@host)
  /https?:\/\/[^:]+:[^@]+@[^\s]+/g,
  // MT5/trading credentials
  /(?:account|login|server)\s*[:=]\s*\S+/gi,
  // Base64 encoded secrets (long strings)
  /[A-Za-z0-9+/=]{40,}/g,
  // Thai ID numbers
  /\b\d{13}\b/g,
];

// Words that indicate private content — block entire entry if found
const PRIVATE_KEYWORDS = [
  "password", "passwd", "secret", "credential", "passphrase",
  "api_key", "apikey", "api-key", "token", "bearer",
  "private_key", "privatekey", "ssh-rsa", "BEGIN RSA",
  "master_name", "master_password", "my_name", "my_account",
  "credit_card", "bank_account", "social_security", "ssn",
  "รหัสผ่าน", "บัญชี", "บัตรเครดิต", "เลขบัตร", "พาสเวิร์ด",
];

// Categories of knowledge safe to share
const SAFE_CATEGORIES = [
  "programming", "troubleshooting", "education", "communication",
  "style", "general", "technique", "pattern", "best-practice",
  "trading-pattern", "analysis-method", "tool-usage",
];

let _tablesReady = false;

// ─── Database Setup ───

function ensureNetworkTables() {
  if (_tablesReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_network_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_network_peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_id TEXT NOT NULL UNIQUE,
      peer_url TEXT NOT NULL,
      peer_name TEXT NOT NULL DEFAULT 'Unknown Soul',
      trust_level REAL NOT NULL DEFAULT 0.1,
      contributions INTEGER NOT NULL DEFAULT 0,
      last_sync TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      capabilities TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_shared_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      source_peer TEXT NOT NULL DEFAULT 'local',
      usefulness INTEGER NOT NULL DEFAULT 0,
      up_votes INTEGER NOT NULL DEFAULT 0,
      down_votes INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_shared_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      code_template TEXT,
      source_peer TEXT NOT NULL DEFAULT 'local',
      up_votes INTEGER NOT NULL DEFAULT 0,
      down_votes INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_network_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      peer_id TEXT,
      direction TEXT NOT NULL DEFAULT 'outgoing',
      items_count INTEGER NOT NULL DEFAULT 0,
      blocked_count INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_network_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      up_votes INTEGER NOT NULL DEFAULT 0,
      down_votes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  _tablesReady = true;
}

// ─── Instance Identity (Anonymous) ───

export function getInstanceId(): string {
  ensureNetworkTables();
  const db = getRawDb();
  const row = db.prepare("SELECT value FROM soul_network_config WHERE key = ?").get(INSTANCE_ID_KEY) as any;
  if (row) return row.value;

  // Generate anonymous instance ID — SHA-256 hash of random UUID
  const rawId = randomUUID();
  const anonId = createHash("sha256").update(rawId).digest("hex").substring(0, 16);
  db.prepare("INSERT INTO soul_network_config (key, value) VALUES (?, ?)").run(INSTANCE_ID_KEY, anonId);
  return anonId;
}

// ─── SECURITY: Multi-Layer Sanitization ───

/**
 * Deep sanitize content before sharing — removes ALL private data
 * Returns null if content is too risky to share
 */
export function sanitizeForSharing(text: string): string | null {
  if (!text || typeof text !== "string") return null;

  // Layer 1: Check for private keywords — block entire entry
  const lower = text.toLowerCase();
  for (const keyword of PRIVATE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      logSecurityEvent("network_share_blocked", { reason: `Contains private keyword: ${keyword}` });
      return null; // Block entirely
    }
  }

  // Layer 2: Check with security module's containsSensitiveData
  if (containsSensitiveData(text)) {
    logSecurityEvent("network_share_blocked", { reason: "containsSensitiveData detected" });
    return null;
  }

  // Layer 3: Strip all patterns that look like private data
  let cleaned = text;
  for (const pattern of PRIVATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }

  // Layer 4: If too much was redacted, block it
  const redactCount = (cleaned.match(/\[REDACTED\]/g) || []).length;
  if (redactCount > 3) {
    logSecurityEvent("network_share_blocked", { reason: `Too many redactions (${redactCount})` });
    return null;
  }

  // Layer 5: Use security module's redactSensitiveData as final pass
  cleaned = redactSensitiveData(cleaned);

  // Layer 6: If content is now too short or meaningless, skip
  const meaningful = cleaned.replace(/\[REDACTED\]/g, "").replace(/\s+/g, " ").trim();
  if (meaningful.length < 10) return null;

  return cleaned;
}

/**
 * Validate incoming data from peers — reject suspicious content
 */
export function validateIncoming(data: any): { safe: boolean; reason?: string } {
  if (!data || typeof data !== "object") {
    return { safe: false, reason: "Invalid data format" };
  }

  // Check for code injection attempts
  const jsonStr = JSON.stringify(data);
  const injectionPatterns = [
    /eval\s*\(/i,
    /Function\s*\(/i,
    /require\s*\(/i,
    /import\s*\(/i,
    /exec\s*\(/i,
    /spawn\s*\(/i,
    /<script/i,
    /javascript:/i,
    /data:text\/html/i,
    /\bprocess\.(env|exit|kill)/i,
    /child_process/i,
    /fs\.(write|unlink|rm)/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(jsonStr)) {
      logSecurityEvent("network_receive_blocked", { reason: `Injection pattern: ${pattern}` });
      return { safe: false, reason: "Suspicious code pattern detected" };
    }
  }

  // Check data size (prevent DoS)
  if (jsonStr.length > 1_000_000) {
    return { safe: false, reason: "Data too large (>1MB)" };
  }

  return { safe: true };
}

// ─── Content Hashing ───

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").substring(0, 32);
}

// ─── 1. SOUL HUB — Discovery & Registry ───

/**
 * Register this Soul instance with a hub
 */
export async function registerWithHub(hubUrl: string): Promise<{ success: boolean; message: string }> {
  const urlCheck = isUrlSafe(hubUrl);
  if (!urlCheck.safe) {
    return { success: false, message: `Blocked: ${urlCheck.reason}` };
  }

  ensureNetworkTables();
  const instanceId = getInstanceId();

  try {
    const res = await fetch(`${hubUrl}/api/network/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceId,
        version: NETWORK_VERSION,
        capabilities: getLocalCapabilities(),
      }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Hub returned ${res.status}`);
    const data = await res.json() as any;

    // Save hub as a special peer
    const db = getRawDb();
    db.prepare(`INSERT OR REPLACE INTO soul_network_peers (peer_id, peer_url, peer_name, trust_level)
      VALUES (?, ?, ?, 0.8)`).run("hub:" + hashContent(hubUrl), hubUrl, "Soul Hub");

    logNetworkAction("register_hub", "hub", "outgoing", 1, 0);
    return { success: true, message: `Registered with hub. Discovered ${data.peerCount || 0} peers.` };
  } catch (err: any) {
    return { success: false, message: `Hub registration failed: ${err.message}` };
  }
}

/**
 * Discover peers (from hub or direct)
 */
export async function discoverPeers(hubUrl?: string): Promise<{
  success: boolean;
  newPeers: number;
  totalPeers: number;
}> {
  ensureNetworkTables();
  const db = getRawDb();

  if (hubUrl) {
    const urlCheck = isUrlSafe(hubUrl);
    if (!urlCheck.safe) return { success: false, newPeers: 0, totalPeers: 0 };

    try {
      const res = await fetch(`${hubUrl}/api/network/peers`, {
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const peers = await res.json() as any[];

      let newCount = 0;
      for (const peer of peers.slice(0, MAX_PEERS)) {
        if (!peer.url || !peer.id) continue;
        const urlCheck2 = isUrlSafe(peer.url);
        if (!urlCheck2.safe) continue;

        const existing = db.prepare("SELECT id FROM soul_network_peers WHERE peer_id = ?").get(peer.id);
        if (!existing) {
          db.prepare(`INSERT INTO soul_network_peers (peer_id, peer_url, peer_name, capabilities)
            VALUES (?, ?, ?, ?)`).run(peer.id, peer.url, peer.name || "Soul Peer", JSON.stringify(peer.capabilities || []));
          newCount++;
        }
      }

      const total = (db.prepare("SELECT COUNT(*) as c FROM soul_network_peers WHERE is_active = 1").get() as any).c;
      logNetworkAction("discover", "hub", "incoming", newCount, 0);
      return { success: true, newPeers: newCount, totalPeers: total };
    } catch (err: any) {
      return { success: false, newPeers: 0, totalPeers: 0 };
    }
  }

  const total = (db.prepare("SELECT COUNT(*) as c FROM soul_network_peers WHERE is_active = 1").get() as any).c;
  return { success: true, newPeers: 0, totalPeers: total };
}

/**
 * Get local capabilities for sharing (anonymized)
 */
function getLocalCapabilities(): string[] {
  const caps: string[] = [];
  try {
    const db = getRawDb();
    // Check what modules are active (without revealing private info)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tableNames = tables.map((t: any) => t.name);

    if (tableNames.includes("soul_mt5_config")) caps.push("trading");
    if (tableNames.includes("soul_knowledge")) caps.push("knowledge-base");
    if (tableNames.includes("soul_skills")) caps.push("skills");
    if (tableNames.includes("soul_workflows")) caps.push("workflows");
    if (tableNames.includes("soul_code_snippets")) caps.push("code-intelligence");
    if (tableNames.includes("soul_learning_paths")) caps.push("learning");
    if (tableNames.includes("soul_channels")) caps.push("multi-channel");
  } catch {}
  return caps;
}

// ─── 2. REAL SYNC PROTOCOL ───

/**
 * Push knowledge to a specific peer
 * SECURITY: All data sanitized before sending
 */
export async function pushToPeer(peerId: string): Promise<{
  success: boolean;
  sent: number;
  blocked: number;
  message: string;
}> {
  ensureNetworkTables();
  const db = getRawDb();

  const peer = db.prepare("SELECT * FROM soul_network_peers WHERE peer_id = ? AND is_active = 1").get(peerId) as any;
  if (!peer) return { success: false, sent: 0, blocked: 0, message: "Peer not found or inactive" };

  // Gather shareable knowledge
  const items = db.prepare(
    "SELECT * FROM soul_shared_knowledge WHERE is_shared = 1 AND source_peer = 'local' LIMIT ?"
  ).all(MAX_SHARE_ITEMS) as any[];

  const safeItems: any[] = [];
  let blocked = 0;

  for (const item of items) {
    const sanitized = sanitizeForSharing(item.pattern);
    if (sanitized) {
      safeItems.push({
        hash: item.content_hash,
        pattern: sanitized,
        category: item.category,
        usefulness: item.usefulness,
      });
    } else {
      blocked++;
    }
  }

  if (safeItems.length === 0) {
    return { success: true, sent: 0, blocked, message: "No safe items to share" };
  }

  try {
    const res = await fetch(`${peer.peer_url}/api/network/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromInstance: getInstanceId(),
        version: NETWORK_VERSION,
        knowledge: safeItems,
      }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Peer returned ${res.status}`);
    const result = await res.json() as any;

    // Update peer sync time & trust
    db.prepare("UPDATE soul_network_peers SET last_sync = datetime('now'), contributions = contributions + ? WHERE peer_id = ?")
      .run(safeItems.length, peerId);

    logNetworkAction("push", peerId, "outgoing", safeItems.length, blocked);
    return {
      success: true,
      sent: safeItems.length,
      blocked,
      message: `Sent ${safeItems.length} items (${blocked} blocked for privacy)`,
    };
  } catch (err: any) {
    return { success: false, sent: 0, blocked, message: `Push failed: ${err.message}` };
  }
}

/**
 * Pull knowledge from a specific peer
 */
export async function pullFromPeer(peerId: string): Promise<{
  success: boolean;
  received: number;
  rejected: number;
  message: string;
}> {
  ensureNetworkTables();
  const db = getRawDb();

  const peer = db.prepare("SELECT * FROM soul_network_peers WHERE peer_id = ? AND is_active = 1").get(peerId) as any;
  if (!peer) return { success: false, received: 0, rejected: 0, message: "Peer not found" };

  if (peer.trust_level < MIN_TRUST_TO_RECEIVE) {
    return { success: false, received: 0, rejected: 0, message: `Peer trust too low (${peer.trust_level})` };
  }

  try {
    const res = await fetch(`${peer.peer_url}/api/network/share`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json() as any;

    // Validate incoming data
    const validation = validateIncoming(data);
    if (!validation.safe) {
      logSecurityEvent("network_receive_blocked", { peerId, reason: validation.reason });
      // Lower trust for suspicious peers
      db.prepare("UPDATE soul_network_peers SET trust_level = MAX(0, trust_level - 0.2) WHERE peer_id = ?").run(peerId);
      return { success: false, received: 0, rejected: 0, message: `Blocked: ${validation.reason}` };
    }

    const items = Array.isArray(data.knowledge) ? data.knowledge : [];
    let received = 0;
    let rejected = 0;

    for (const item of items.slice(0, MAX_SHARE_ITEMS)) {
      if (!item.pattern || !item.category) { rejected++; continue; }

      // Validate each item individually
      const sanitized = sanitizeForSharing(item.pattern);
      if (!sanitized) { rejected++; continue; }

      if (!SAFE_CATEGORIES.includes(item.category)) { rejected++; continue; }

      const hash = hashContent(sanitized);
      try {
        db.prepare(`INSERT OR IGNORE INTO soul_shared_knowledge
          (content_hash, pattern, category, source_peer, usefulness)
          VALUES (?, ?, ?, ?, ?)`).run(hash, sanitized, item.category, peerId, item.usefulness || 0);
        received++;
      } catch {
        rejected++;
      }
    }

    // Update trust based on quality ratio
    if (received + rejected > 0) {
      const quality = received / (received + rejected);
      const trustDelta = quality > 0.7 ? 0.05 : quality > 0.3 ? 0 : -0.1;
      db.prepare("UPDATE soul_network_peers SET trust_level = MIN(1.0, MAX(0, trust_level + ?)), last_sync = datetime('now') WHERE peer_id = ?")
        .run(trustDelta, peerId);
    }

    logNetworkAction("pull", peerId, "incoming", received, rejected);
    return { success: true, received, rejected, message: `Received ${received}, rejected ${rejected}` };
  } catch (err: any) {
    return { success: false, received: 0, rejected: 0, message: `Pull failed: ${err.message}` };
  }
}

/**
 * Sync with all active peers (push + pull)
 */
export async function syncAllPeers(): Promise<{
  synced: number;
  totalSent: number;
  totalReceived: number;
  totalBlocked: number;
  errors: string[];
}> {
  ensureNetworkTables();
  const db = getRawDb();

  const peers = db.prepare("SELECT * FROM soul_network_peers WHERE is_active = 1 AND trust_level >= ?")
    .all(MIN_TRUST_TO_RECEIVE) as any[];

  let synced = 0, totalSent = 0, totalReceived = 0, totalBlocked = 0;
  const errors: string[] = [];

  for (const peer of peers) {
    try {
      const pushResult = await pushToPeer(peer.peer_id);
      totalSent += pushResult.sent;
      totalBlocked += pushResult.blocked;

      const pullResult = await pullFromPeer(peer.peer_id);
      totalReceived += pullResult.received;
      totalBlocked += pullResult.rejected;

      synced++;
    } catch (err: any) {
      errors.push(`${peer.peer_name}: ${err.message}`);
    }
  }

  logNetworkAction("sync_all", null, "both", totalSent + totalReceived, totalBlocked);
  return { synced, totalSent, totalReceived, totalBlocked, errors };
}

/**
 * Handle incoming receive request (called from HTTP endpoint)
 * SECURITY: Validates everything before accepting
 */
export async function handleReceiveRequest(body: any): Promise<{
  accepted: number;
  rejected: number;
  message: string;
}> {
  // Validate the entire request
  const validation = validateIncoming(body);
  if (!validation.safe) {
    logSecurityEvent("network_receive_blocked", { reason: validation.reason });
    return { accepted: 0, rejected: 0, message: `Blocked: ${validation.reason}` };
  }

  ensureNetworkTables();
  const db = getRawDb();

  const fromInstance = body.fromInstance || "unknown";
  const items = Array.isArray(body.knowledge) ? body.knowledge : [];

  let accepted = 0, rejected = 0;

  for (const item of items.slice(0, MAX_SHARE_ITEMS)) {
    if (!item.pattern || !item.category) { rejected++; continue; }

    // Multi-layer sanitization on incoming data too
    const sanitized = sanitizeForSharing(item.pattern);
    if (!sanitized) { rejected++; continue; }
    if (!SAFE_CATEGORIES.includes(item.category)) { rejected++; continue; }

    const hash = item.hash || hashContent(sanitized);
    try {
      db.prepare(`INSERT OR IGNORE INTO soul_shared_knowledge
        (content_hash, pattern, category, source_peer, usefulness)
        VALUES (?, ?, ?, ?, ?)`)
        .run(hash, sanitized, item.category, fromInstance, item.usefulness || 0);
      accepted++;
    } catch {
      rejected++;
    }
  }

  logNetworkAction("receive", fromInstance, "incoming", accepted, rejected);
  return { accepted, rejected, message: `Accepted ${accepted}, rejected ${rejected} for safety` };
}

/**
 * Handle share request — return our shareable knowledge
 * SECURITY: Only shares sanitized, approved data
 */
export function handleShareRequest(): {
  instanceId: string;
  version: string;
  knowledge: any[];
} {
  ensureNetworkTables();
  const db = getRawDb();

  const items = db.prepare(
    "SELECT * FROM soul_shared_knowledge WHERE is_shared = 1 AND source_peer = 'local' ORDER BY usefulness DESC LIMIT ?"
  ).all(MAX_SHARE_ITEMS) as any[];

  const safeItems: any[] = [];
  for (const item of items) {
    const sanitized = sanitizeForSharing(item.pattern);
    if (sanitized) {
      safeItems.push({
        hash: item.content_hash,
        pattern: sanitized,
        category: item.category,
        usefulness: item.usefulness,
      });
    }
  }

  return {
    instanceId: getInstanceId(),
    version: NETWORK_VERSION,
    knowledge: safeItems,
  };
}

// ─── 3. COLLECTIVE EVOLUTION — Proposals, Voting, Shared Skills ───

/**
 * Prepare local knowledge for sharing (master must approve)
 * Returns preview of what WOULD be shared — nothing sent yet
 */
export async function prepareForSharing(): Promise<{
  ready: number;
  blocked: number;
  preview: Array<{ pattern: string; category: string }>;
  blockedReasons: string[];
}> {
  ensureNetworkTables();
  const db = getRawDb();

  const learnings = await getLearnings(100);
  const ready: Array<{ pattern: string; category: string }> = [];
  const blockedReasons: string[] = [];
  let blockedCount = 0;

  for (const l of learnings) {
    if (l.confidence < MIN_CONFIDENCE_TO_SHARE) continue;

    const sanitized = sanitizeForSharing(l.pattern);
    if (sanitized) {
      ready.push({ pattern: sanitized, category: categorizePattern(sanitized) });
    } else {
      blockedCount++;
      blockedReasons.push(`Blocked: "${l.pattern.substring(0, 30)}..." (contains private data)`);
    }
  }

  return {
    ready: ready.length,
    blocked: blockedCount,
    preview: ready.slice(0, 20), // Show first 20 for approval
    blockedReasons: blockedReasons.slice(0, 10),
  };
}

/**
 * Approve and mark knowledge for sharing
 * Called AFTER master reviews the preview
 */
export function approveSharing(approve: boolean): { shared: number; message: string } {
  if (!approve) return { shared: 0, message: "Sharing cancelled by master." };

  ensureNetworkTables();
  const db = getRawDb();

  // Get all local, unshared, sanitizable knowledge
  const items = db.prepare(
    "SELECT * FROM soul_shared_knowledge WHERE source_peer = 'local' AND is_shared = 0"
  ).all() as any[];

  let shared = 0;
  for (const item of items) {
    const sanitized = sanitizeForSharing(item.pattern);
    if (sanitized) {
      db.prepare("UPDATE soul_shared_knowledge SET is_shared = 1 WHERE id = ?").run(item.id);
      shared++;
    }
  }

  logNetworkAction("approve_sharing", null, "outgoing", shared, 0);
  return { shared, message: `Approved ${shared} items for sharing.` };
}

/**
 * Share a skill/tool template with the network
 */
export function shareSkill(input: {
  name: string;
  description: string;
  category: string;
  codeTemplate?: string;
}): { success: boolean; message: string } {
  ensureNetworkTables();

  // Sanitize everything
  const cleanName = sanitizeForSharing(input.name);
  const cleanDesc = sanitizeForSharing(input.description);
  if (!cleanName || !cleanDesc) {
    return { success: false, message: "Skill contains private data — blocked." };
  }

  let cleanCode: string | null = null;
  if (input.codeTemplate) {
    cleanCode = sanitizeForSharing(input.codeTemplate);
    if (!cleanCode) {
      return { success: false, message: "Code template contains private data — blocked." };
    }
  }

  const hash = hashContent(`${cleanName}:${cleanDesc}`);
  const db = getRawDb();

  try {
    db.prepare(`INSERT OR IGNORE INTO soul_shared_skills
      (skill_hash, name, description, category, code_template, source_peer)
      VALUES (?, ?, ?, ?, ?, 'local')`)
      .run(hash, cleanName, cleanDesc, input.category, cleanCode);

    logNetworkAction("share_skill", null, "outgoing", 1, 0);
    return { success: true, message: `Skill "${cleanName}" ready for sharing (needs peer sync).` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Create a proposal for collective improvement
 */
export function createProposal(input: {
  title: string;
  description: string;
  category: string;
  content: string;
}): { success: boolean; proposalId?: string; message: string } {
  ensureNetworkTables();

  // Sanitize
  const cleanTitle = sanitizeForSharing(input.title);
  const cleanDesc = sanitizeForSharing(input.description);
  const cleanContent = sanitizeForSharing(input.content);

  if (!cleanTitle || !cleanDesc || !cleanContent) {
    return { success: false, message: "Proposal contains private data — blocked." };
  }

  const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const db = getRawDb();

  try {
    db.prepare(`INSERT INTO soul_network_proposals
      (proposal_id, title, description, category, proposed_by, content)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(proposalId, cleanTitle, cleanDesc, input.category, getInstanceId(), cleanContent);

    return { success: true, proposalId, message: `Proposal "${cleanTitle}" created.` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Vote on a proposal or shared knowledge
 */
export function vote(type: "knowledge" | "skill" | "proposal", id: number | string, useful: boolean): {
  success: boolean;
  message: string;
} {
  ensureNetworkTables();
  const db = getRawDb();
  const col = useful ? "up_votes" : "down_votes";

  try {
    if (type === "knowledge") {
      db.prepare(`UPDATE soul_shared_knowledge SET ${col} = ${col} + 1, usefulness = up_votes - down_votes WHERE id = ?`).run(id);
    } else if (type === "skill") {
      db.prepare(`UPDATE soul_shared_skills SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
    } else if (type === "proposal") {
      db.prepare(`UPDATE soul_network_proposals SET ${col} = ${col} + 1 WHERE proposal_id = ?`).run(id);

      // Auto-approve proposals with 5+ net votes
      const prop = db.prepare("SELECT up_votes, down_votes FROM soul_network_proposals WHERE proposal_id = ?").get(id) as any;
      if (prop && (prop.up_votes - prop.down_votes) >= 5) {
        db.prepare("UPDATE soul_network_proposals SET status = 'approved' WHERE proposal_id = ?").run(id);
      }
    }
    return { success: true, message: `Vote recorded.` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ─── Status & Stats ───

export function getNetworkStatus(): {
  instanceId: string;
  version: string;
  peers: { total: number; active: number; trusted: number };
  knowledge: { total: number; shared: number; received: number; verified: number };
  skills: { total: number; approved: number };
  proposals: { total: number; pending: number; approved: number };
  recentActivity: any[];
} {
  ensureNetworkTables();
  const db = getRawDb();

  const peerStats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN trust_level >= 0.5 THEN 1 ELSE 0 END) as trusted
    FROM soul_network_peers`).get() as any;

  const knowledgeStats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN is_shared = 1 AND source_peer = 'local' THEN 1 ELSE 0 END) as shared,
    SUM(CASE WHEN source_peer != 'local' THEN 1 ELSE 0 END) as received,
    SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified
    FROM soul_shared_knowledge`).get() as any;

  const skillStats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) as approved
    FROM soul_shared_skills`).get() as any;

  const proposalStats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
    FROM soul_network_proposals`).get() as any;

  const recentActivity = db.prepare(
    "SELECT * FROM soul_network_log ORDER BY created_at DESC LIMIT 10"
  ).all();

  return {
    instanceId: getInstanceId(),
    version: NETWORK_VERSION,
    peers: { total: peerStats.total || 0, active: peerStats.active || 0, trusted: peerStats.trusted || 0 },
    knowledge: {
      total: knowledgeStats.total || 0,
      shared: knowledgeStats.shared || 0,
      received: knowledgeStats.received || 0,
      verified: knowledgeStats.verified || 0,
    },
    skills: { total: skillStats.total || 0, approved: skillStats.approved || 0 },
    proposals: { total: proposalStats.total || 0, pending: proposalStats.pending || 0, approved: proposalStats.approved || 0 },
    recentActivity,
  };
}

export function listNetworkPeers(): any[] {
  ensureNetworkTables();
  const db = getRawDb();
  return db.prepare("SELECT * FROM soul_network_peers ORDER BY trust_level DESC").all();
}

export function addPeerDirect(url: string, name: string): { success: boolean; message: string } {
  const urlCheck = isUrlSafe(url);
  if (!urlCheck.safe) return { success: false, message: `Blocked: ${urlCheck.reason}` };

  ensureNetworkTables();
  const db = getRawDb();
  const peerId = hashContent(url).substring(0, 16);

  try {
    db.prepare(`INSERT OR IGNORE INTO soul_network_peers (peer_id, peer_url, peer_name) VALUES (?, ?, ?)`)
      .run(peerId, url, name);
    return { success: true, message: `Peer "${name}" added (trust: 0.1 — will increase with good interactions).` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export function removePeer(peerId: string): { success: boolean; message: string } {
  ensureNetworkTables();
  const db = getRawDb();
  db.prepare("UPDATE soul_network_peers SET is_active = 0 WHERE peer_id = ?").run(peerId);
  return { success: true, message: "Peer deactivated." };
}

export function getSharedKnowledge(category?: string, limit = 50): any[] {
  ensureNetworkTables();
  const db = getRawDb();
  if (category) {
    return db.prepare("SELECT * FROM soul_shared_knowledge WHERE category = ? ORDER BY usefulness DESC LIMIT ?").all(category, limit);
  }
  return db.prepare("SELECT * FROM soul_shared_knowledge ORDER BY usefulness DESC LIMIT ?").all(limit);
}

export function getSharedSkills(category?: string): any[] {
  ensureNetworkTables();
  const db = getRawDb();
  if (category) {
    return db.prepare("SELECT * FROM soul_shared_skills WHERE category = ? ORDER BY up_votes DESC").all(category);
  }
  return db.prepare("SELECT * FROM soul_shared_skills ORDER BY up_votes DESC").all();
}

export function getProposals(status?: string): any[] {
  ensureNetworkTables();
  const db = getRawDb();
  if (status) {
    return db.prepare("SELECT * FROM soul_network_proposals WHERE status = ? ORDER BY up_votes DESC").all(status);
  }
  return db.prepare("SELECT * FROM soul_network_proposals ORDER BY created_at DESC").all();
}

// ─── Helpers ───

function categorizePattern(pattern: string): string {
  const lower = pattern.toLowerCase();
  if (lower.includes("trade") || lower.includes("chart") || lower.includes("signal")) return "trading-pattern";
  if (lower.includes("code") || lower.includes("bug") || lower.includes("function")) return "programming";
  if (lower.includes("error") || lower.includes("fix") || lower.includes("solve")) return "troubleshooting";
  if (lower.includes("learn") || lower.includes("teach")) return "education";
  if (lower.includes("style") || lower.includes("format")) return "style";
  if (lower.includes("method") || lower.includes("technique")) return "technique";
  return "general";
}

function logNetworkAction(action: string, peerId: string | null, direction: string, count: number, blocked: number) {
  try {
    ensureNetworkTables();
    const db = getRawDb();
    db.prepare(`INSERT INTO soul_network_log (action, peer_id, direction, items_count, blocked_count)
      VALUES (?, ?, ?, ?, ?)`).run(action, peerId, direction, count, blocked);
  } catch {}
}
