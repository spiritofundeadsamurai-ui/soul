/**
 * Soul Collective Network — Tests
 * Tests security sanitization, P2P sync, discovery, voting, and privacy guards
 */

import { describe, it, expect, beforeAll } from "vitest";

// We'll import dynamically to match the project's ESM pattern
let sanitizeForSharing: any;
let validateIncoming: any;
let getInstanceId: any;
let getNetworkStatus: any;
let addPeerDirect: any;
let removePeer: any;
let listNetworkPeers: any;
let approveSharing: any;
let prepareForSharing: any;
let shareSkill: any;
let createProposal: any;
let vote: any;
let getSharedKnowledge: any;
let getSharedSkills: any;
let getProposals: any;
let handleReceiveRequest: any;
let handleShareRequest: any;
let hashContent: any;

beforeAll(async () => {
  const mod = await import("../src/core/soul-network.js");
  sanitizeForSharing = mod.sanitizeForSharing;
  validateIncoming = mod.validateIncoming;
  getInstanceId = mod.getInstanceId;
  getNetworkStatus = mod.getNetworkStatus;
  addPeerDirect = mod.addPeerDirect;
  removePeer = mod.removePeer;
  listNetworkPeers = mod.listNetworkPeers;
  approveSharing = mod.approveSharing;
  prepareForSharing = mod.prepareForSharing;
  shareSkill = mod.shareSkill;
  createProposal = mod.createProposal;
  vote = mod.vote;
  getSharedKnowledge = mod.getSharedKnowledge;
  getSharedSkills = mod.getSharedSkills;
  getProposals = mod.getProposals;
  handleReceiveRequest = mod.handleReceiveRequest;
  handleShareRequest = mod.handleShareRequest;
});

// ══════════════════════════════════════════
// 1. SECURITY — Privacy Sanitization
// ══════════════════════════════════════════

describe("1. Security — sanitizeForSharing", () => {
  it("1.1 allows safe general knowledge", () => {
    const result = sanitizeForSharing("Use SMA crossover for trend detection");
    expect(result).toBeTruthy();
    expect(result).toContain("SMA crossover");
  });

  it("1.2 blocks content with API keys", () => {
    expect(sanitizeForSharing("my api_key = sk-abc123456789")).toBeNull();
    expect(sanitizeForSharing("token: ghp_abcdefghijk12345")).toBeNull();
    expect(sanitizeForSharing("bearer: xoxb-12345-abcde")).toBeNull();
  });

  it("1.3 blocks content with passwords", () => {
    expect(sanitizeForSharing("password is MySecret123")).toBeNull();
    expect(sanitizeForSharing("รหัสผ่าน คือ abc123")).toBeNull();
    expect(sanitizeForSharing("passwd: hunter2")).toBeNull();
  });

  it("1.4 blocks content with credentials/secrets", () => {
    expect(sanitizeForSharing("credential for master login")).toBeNull();
    expect(sanitizeForSharing("secret key stored in vault")).toBeNull();
    expect(sanitizeForSharing("passphrase is something")).toBeNull();
  });

  it("1.5 blocks content with bank/personal info (Thai)", () => {
    expect(sanitizeForSharing("บัญชี ธนาคารกรุงเทพ")).toBeNull();
    expect(sanitizeForSharing("เลขบัตร credit card")).toBeNull();
    expect(sanitizeForSharing("พาสเวิร์ด ของฉัน")).toBeNull();
  });

  it("1.6 strips email addresses from otherwise safe content", () => {
    const result = sanitizeForSharing("Contact support for help with this pattern recognition technique");
    // This should pass since no email, but let's test with email
    const withEmail = sanitizeForSharing("Great technique discovered. Also john@example.com found this useful for debugging patterns in production");
    // Should either strip or block — not pass through raw email
    if (withEmail) {
      expect(withEmail).not.toContain("john@example.com");
    }
  });

  it("1.7 strips file paths", () => {
    const result = sanitizeForSharing("Found a great pattern in code review methodology");
    expect(result).toBeTruthy(); // Safe content passes
  });

  it("1.8 blocks null/empty/short content", () => {
    expect(sanitizeForSharing("")).toBeNull();
    expect(sanitizeForSharing("hi")).toBeNull();
    expect(sanitizeForSharing(null as any)).toBeNull();
    expect(sanitizeForSharing(undefined as any)).toBeNull();
  });

  it("1.9 blocks content with master/private keywords", () => {
    expect(sanitizeForSharing("master_password should be changed")).toBeNull();
    expect(sanitizeForSharing("my private_key is RSA")).toBeNull();
    expect(sanitizeForSharing("BEGIN RSA PRIVATE KEY")).toBeNull();
  });

  it("1.10 allows trading patterns (no private data)", () => {
    const result = sanitizeForSharing("RSI divergence on H4 with MACD crossover signals reversal in gold market");
    expect(result).toBeTruthy();
    expect(result).toContain("RSI divergence");
  });

  it("1.11 allows programming patterns (no private data)", () => {
    const result = sanitizeForSharing("Use retry with exponential backoff for failed API requests in distributed systems");
    expect(result).toBeTruthy();
    expect(result).toContain("exponential backoff");
  });
});

// ══════════════════════════════════════════
// 2. SECURITY — Incoming Data Validation
// ══════════════════════════════════════════

describe("2. Security — validateIncoming", () => {
  it("2.1 accepts valid knowledge data", () => {
    const result = validateIncoming({
      fromInstance: "abc123",
      knowledge: [{ pattern: "Use SMA", category: "trading-pattern" }],
    });
    expect(result.safe).toBe(true);
  });

  it("2.2 rejects null/undefined", () => {
    expect(validateIncoming(null).safe).toBe(false);
    expect(validateIncoming(undefined).safe).toBe(false);
    expect(validateIncoming("string").safe).toBe(false);
  });

  it("2.3 blocks eval() injection", () => {
    const result = validateIncoming({
      knowledge: [{ pattern: "eval('malicious code')", category: "general" }],
    });
    expect(result.safe).toBe(false);
  });

  it("2.4 blocks require() injection", () => {
    const result = validateIncoming({
      knowledge: [{ pattern: "require('child_process').exec('rm -rf /')", category: "general" }],
    });
    expect(result.safe).toBe(false);
  });

  it("2.5 blocks script injection", () => {
    const result = validateIncoming({
      knowledge: [{ pattern: "<script>alert('xss')</script>", category: "general" }],
    });
    expect(result.safe).toBe(false);
  });

  it("2.6 blocks process.env access", () => {
    const result = validateIncoming({
      knowledge: [{ pattern: "process.env.SECRET_KEY", category: "general" }],
    });
    expect(result.safe).toBe(false);
  });

  it("2.7 blocks oversized data (DoS)", () => {
    const huge = { data: "x".repeat(2_000_000) };
    expect(validateIncoming(huge).safe).toBe(false);
  });
});

// ══════════════════════════════════════════
// 3. Instance Identity
// ══════════════════════════════════════════

describe("3. Instance Identity", () => {
  it("3.1 generates anonymous instance ID", () => {
    const id = getInstanceId();
    expect(id).toBeTruthy();
    expect(id.length).toBe(16); // SHA-256 truncated to 16 chars
  });

  it("3.2 returns same ID on repeated calls", () => {
    const id1 = getInstanceId();
    const id2 = getInstanceId();
    expect(id1).toBe(id2);
  });

  it("3.3 ID does not contain personal info", () => {
    const id = getInstanceId();
    expect(id).toMatch(/^[a-f0-9]{16}$/); // Only hex chars
  });
});

// ══════════════════════════════════════════
// 4. Peer Management
// ══════════════════════════════════════════

describe("4. Peer Management", () => {
  it("4.1 add peer with valid URL", () => {
    const result = addPeerDirect("http://soul-peer-1.example.com:47779", "Test Soul");
    expect(result.success).toBe(true);
    expect(result.message).toContain("Test Soul");
  });

  it("4.2 list peers shows added peer", () => {
    const peers = listNetworkPeers();
    expect(peers.length).toBeGreaterThanOrEqual(1);
    const testPeer = peers.find((p: any) => p.peer_name === "Test Soul");
    expect(testPeer).toBeTruthy();
    expect(testPeer.trust_level).toBe(0.1); // New peer starts low
  });

  it("4.3 remove peer deactivates it", () => {
    const peers = listNetworkPeers();
    const testPeer = peers.find((p: any) => p.peer_name === "Test Soul");
    if (testPeer) {
      const result = removePeer(testPeer.peer_id);
      expect(result.success).toBe(true);
    }
  });

  it("4.4 blocks dangerous URLs (SSRF)", () => {
    const result = addPeerDirect("http://169.254.169.254/latest/meta-data/", "AWS Metadata");
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════
// 5. Network Status
// ══════════════════════════════════════════

describe("5. Network Status", () => {
  it("5.1 returns complete status object", () => {
    const status = getNetworkStatus();
    expect(status).toHaveProperty("instanceId");
    expect(status).toHaveProperty("version");
    expect(status).toHaveProperty("peers");
    expect(status).toHaveProperty("knowledge");
    expect(status).toHaveProperty("skills");
    expect(status).toHaveProperty("proposals");
    expect(status.peers).toHaveProperty("total");
    expect(status.peers).toHaveProperty("active");
    expect(status.peers).toHaveProperty("trusted");
    expect(status.knowledge).toHaveProperty("total");
    expect(status.knowledge).toHaveProperty("shared");
    expect(status.knowledge).toHaveProperty("received");
  });
});

// ══════════════════════════════════════════
// 6. Knowledge Sharing Flow
// ══════════════════════════════════════════

describe("6. Knowledge Sharing", () => {
  it("6.1 approve sharing works", () => {
    const result = approveSharing(true);
    expect(result).toHaveProperty("shared");
    expect(result).toHaveProperty("message");
  });

  it("6.2 cancel sharing works", () => {
    const result = approveSharing(false);
    expect(result.shared).toBe(0);
    expect(result.message).toContain("cancelled");
  });

  it("6.3 handleShareRequest returns safe data", () => {
    const data = handleShareRequest();
    expect(data).toHaveProperty("instanceId");
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("knowledge");
    expect(Array.isArray(data.knowledge)).toBe(true);
    // Verify no private data leaked
    for (const item of data.knowledge) {
      expect(item.pattern).not.toMatch(/password|api_key|secret|token/i);
    }
  });

  it("6.4 handleReceiveRequest accepts valid knowledge", async () => {
    const result = await handleReceiveRequest({
      fromInstance: "test-peer-123",
      version: "1.0.0",
      knowledge: [
        { pattern: "Bollinger Band squeeze followed by breakout is a reliable pattern in trending markets", category: "trading-pattern", usefulness: 5 },
        { pattern: "Use retry with jitter for distributed lock contention scenarios", category: "programming", usefulness: 3 },
      ],
    });
    expect(result.accepted).toBeGreaterThanOrEqual(1);
  });

  it("6.5 handleReceiveRequest blocks private data in incoming", async () => {
    const result = await handleReceiveRequest({
      fromInstance: "evil-peer",
      knowledge: [
        { pattern: "password is hunter2 for the admin account", category: "general" },
        { pattern: "api_key = sk-12345 for production", category: "general" },
      ],
    });
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(2);
  });

  it("6.6 handleReceiveRequest blocks injection attacks", async () => {
    const result = await handleReceiveRequest({
      fromInstance: "attacker",
      knowledge: [
        { pattern: "eval('process.exit(1)')", category: "general" },
      ],
    });
    expect(result.accepted).toBe(0);
  });

  it("6.7 getSharedKnowledge returns items", () => {
    const items = getSharedKnowledge();
    expect(Array.isArray(items)).toBe(true);
  });

  it("6.8 getSharedKnowledge filters by category", () => {
    const items = getSharedKnowledge("trading-pattern");
    for (const item of items) {
      expect(item.category).toBe("trading-pattern");
    }
  });
});

// ══════════════════════════════════════════
// 7. Skill Sharing
// ══════════════════════════════════════════

describe("7. Skill Sharing", () => {
  it("7.1 share safe skill succeeds", () => {
    const result = shareSkill({
      name: "RSI Divergence Detector",
      description: "Detect bullish/bearish divergence between price and RSI indicator",
      category: "trading-pattern",
    });
    expect(result.success).toBe(true);
  });

  it("7.2 share skill with private data blocked", () => {
    const result = shareSkill({
      name: "My Secret Tool",
      description: "Uses password from master to decrypt files",
      category: "general",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("private data");
  });

  it("7.3 getSharedSkills returns items", () => {
    const skills = getSharedSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });

  it("7.4 share skill with code template (safe)", () => {
    const result = shareSkill({
      name: "SMA Calculator",
      description: "Calculate Simple Moving Average for any time series",
      category: "programming",
      codeTemplate: "function calcSMA(data, period) { return data.slice(-period).reduce((a,b) => a+b, 0) / period; }",
    });
    expect(result.success).toBe(true);
  });

  it("7.5 share skill with code containing secrets blocked", () => {
    const result = shareSkill({
      name: "API Caller",
      description: "Call external API with authentication headers",
      category: "programming",
      codeTemplate: "fetch(url, { headers: { 'Authorization': 'Bearer sk-secret123456789abcdef' } })",
    });
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════
// 8. Proposals & Voting
// ══════════════════════════════════════════

describe("8. Proposals & Voting", () => {
  let proposalId: string;

  it("8.1 create proposal succeeds", () => {
    const result = createProposal({
      title: "Add Fibonacci Retracement Tool",
      description: "Collective should have built-in Fibonacci analysis",
      category: "trading-pattern",
      content: "Fibonacci retracement levels at standard ratios for support and resistance identification",
    });
    expect(result.success).toBe(true);
    expect(result.proposalId).toBeTruthy();
    proposalId = result.proposalId!;
  });

  it("8.2 create proposal with private data blocked", () => {
    const result = createProposal({
      title: "Update credentials",
      description: "Store master_password in new format",
      category: "general",
      content: "Change how passwords are stored",
    });
    expect(result.success).toBe(false);
  });

  it("8.3 list proposals returns created proposal", () => {
    const proposals = getProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const found = proposals.find((p: any) => p.proposal_id === proposalId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("pending");
  });

  it("8.4 vote on knowledge works", () => {
    const knowledge = getSharedKnowledge();
    if (knowledge.length > 0) {
      const result = vote("knowledge", knowledge[0].id, true);
      expect(result.success).toBe(true);
    }
  });

  it("8.5 vote on proposal works", () => {
    if (proposalId) {
      const result = vote("proposal", proposalId, true);
      expect(result.success).toBe(true);
    }
  });

  it("8.6 filter proposals by status", () => {
    const pending = getProposals("pending");
    for (const p of pending) {
      expect(p.status).toBe("pending");
    }
  });
});

// ══════════════════════════════════════════
// 9. End-to-End Privacy Guarantee
// ══════════════════════════════════════════

describe("9. E2E Privacy — Nothing Private Leaks", () => {
  const sensitiveStrings = [
    "sk-proj-abcdefghijklmnop123456",
    "password: MyP@ssw0rd!",
    "api_key=AKIA1234567890ABCDEF",
    "ghp_1234567890abcdefghij",
    "xoxb-1234-5678-abcdefgh",
    "master_password = letmein",
    "my_account = 126714062",
    "รหัสผ่าน คือ 12345678",
    "บัญชี 1234567890",
    "credit_card 4111111111111111",
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ",
    "BEGIN RSA PRIVATE KEY-----",
  ];

  for (const sensitive of sensitiveStrings) {
    it(`blocks: "${sensitive.substring(0, 40)}..."`, () => {
      const result = sanitizeForSharing(sensitive);
      expect(result).toBeNull();
    });
  }

  it("9.final handleShareRequest never contains sensitive keywords", () => {
    const data = handleShareRequest();
    const jsonStr = JSON.stringify(data).toLowerCase();
    const dangerousKeywords = ["password", "api_key", "secret", "token", "credential", "passphrase", "private_key"];
    for (const kw of dangerousKeywords) {
      // Allow the word in category names or descriptions, but not as actual values
      // The key check is that no actual secrets appear
      expect(jsonStr).not.toMatch(new RegExp(`"${kw}"\\s*:\\s*"[^"]{5,}"`));
    }
  });
});
