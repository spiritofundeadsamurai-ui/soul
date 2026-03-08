/**
 * Classification Engine — Security classification for sensitive data
 *
 * Designed for law enforcement / investigation teams:
 * 1. Classification Levels: ปกติ → ลับ → ลับมาก → ลับที่สุด
 * 2. Role-based access: admin, analyst, viewer
 * 3. Data compartmentalization: tag memories/knowledge with classification
 * 4. Full audit trail: who accessed what, when
 * 5. Multi-language sensitive data detection (Thai, English, Chinese, etc.)
 * 6. Team mode: multiple users, each with role + clearance level
 * 7. Auto-classification: detect sensitivity and tag automatically
 */

import { getRawDb } from "../db/index.js";
import { createHash, randomBytes } from "crypto";
import { logSecurityEvent } from "./security.js";

// ─── Types ───

export type ClassificationLevel = "unclassified" | "confidential" | "secret" | "top_secret";

export type UserRole = "admin" | "analyst" | "viewer";

export interface TeamMember {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  clearanceLevel: ClassificationLevel;
  department: string;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  userId: number;
  username: string;
  action: string;
  resource: string;
  resourceId: string;
  classification: ClassificationLevel;
  details: string;
  ip: string;
  timestamp: string;
}

export interface ClassifiedData {
  id: number;
  resourceType: string; // memory, knowledge, note, case, person
  resourceId: number;
  classification: ClassificationLevel;
  compartment: string | null; // case-specific compartment
  classifiedBy: number;
  reason: string;
  createdAt: string;
}

// ─── Classification Labels (Multi-language) ───

export const CLASSIFICATION_LABELS: Record<ClassificationLevel, { en: string; th: string; color: string; icon: string }> = {
  unclassified: { en: "Unclassified", th: "ปกติ", color: "#22c55e", icon: "🟢" },
  confidential: { en: "Confidential", th: "ลับ", color: "#f59e0b", icon: "🟡" },
  secret: { en: "Secret", th: "ลับมาก", color: "#f97316", icon: "🟠" },
  top_secret: { en: "Top Secret", th: "ลับที่สุด", color: "#ef4444", icon: "🔴" },
};

// Clearance hierarchy — higher number = more access
const CLEARANCE_RANK: Record<ClassificationLevel, number> = {
  unclassified: 0,
  confidential: 1,
  secret: 2,
  top_secret: 3,
};

// Role permissions
const ROLE_PERMISSIONS: Record<UserRole, {
  canClassify: boolean;
  canDeclassify: boolean;
  canManageUsers: boolean;
  canViewAudit: boolean;
  canExport: boolean;
  canDelete: boolean;
  maxClearance: ClassificationLevel;
}> = {
  admin: { canClassify: true, canDeclassify: true, canManageUsers: true, canViewAudit: true, canExport: true, canDelete: true, maxClearance: "top_secret" },
  analyst: { canClassify: true, canDeclassify: false, canManageUsers: false, canViewAudit: false, canExport: false, canDelete: false, maxClearance: "secret" },
  viewer: { canClassify: false, canDeclassify: false, canManageUsers: false, canViewAudit: false, canExport: false, canDelete: false, maxClearance: "confidential" },
};

// ─── Database ───

function ensureClassificationTables() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      clearance_level TEXT NOT NULL DEFAULT 'unclassified',
      department TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_classification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      classification TEXT NOT NULL DEFAULT 'unclassified',
      compartment TEXT,
      classified_by INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS soul_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT 'unclassified',
      details TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT 'local',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soul_compartments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      owner_id INTEGER NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ─── Team Management ───

export function addTeamMember(input: {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  clearanceLevel: ClassificationLevel;
  department?: string;
}): TeamMember {
  ensureClassificationTables();
  const rawDb = getRawDb();

  // Validate role
  if (!ROLE_PERMISSIONS[input.role]) {
    throw new Error(`Invalid role: ${input.role}. Must be: admin, analyst, viewer`);
  }

  // Hash password
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(input.password + salt).digest("hex");
  const passwordHash = `${salt}:${hash}`;

  const row = rawDb.prepare(
    `INSERT INTO soul_team_members (username, display_name, password_hash, role, clearance_level, department)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(input.username, input.displayName, passwordHash, input.role, input.clearanceLevel, input.department || "") as any;

  logSecurityEvent("team_member_added", { username: input.username, role: input.role, clearance: input.clearanceLevel });

  return mapTeamMember(row);
}

export function authenticateTeamMember(username: string, password: string): TeamMember | null {
  ensureClassificationTables();
  const rawDb = getRawDb();

  const row = rawDb.prepare(
    "SELECT * FROM soul_team_members WHERE username = ? AND is_active = 1"
  ).get(username) as any;

  if (!row) return null;

  const [salt, hash] = row.password_hash.split(":");
  const computed = createHash("sha256").update(password + salt).digest("hex");

  if (computed !== hash) {
    logSecurityEvent("team_auth_failed", { username });
    return null;
  }

  // Update last login
  rawDb.prepare("UPDATE soul_team_members SET last_login = datetime('now') WHERE id = ?").run(row.id);
  logSecurityEvent("team_auth_success", { username, role: row.role });

  return mapTeamMember(row);
}

export function listTeamMembers(): TeamMember[] {
  ensureClassificationTables();
  const rawDb = getRawDb();
  return (rawDb.prepare("SELECT * FROM soul_team_members ORDER BY role, display_name").all() as any[]).map(mapTeamMember);
}

export function updateTeamMember(id: number, updates: {
  role?: UserRole;
  clearanceLevel?: ClassificationLevel;
  department?: string;
  isActive?: boolean;
}): boolean {
  ensureClassificationTables();
  const rawDb = getRawDb();

  const sets: string[] = [];
  const params: any[] = [];

  if (updates.role) { sets.push("role = ?"); params.push(updates.role); }
  if (updates.clearanceLevel) { sets.push("clearance_level = ?"); params.push(updates.clearanceLevel); }
  if (updates.department !== undefined) { sets.push("department = ?"); params.push(updates.department); }
  if (updates.isActive !== undefined) { sets.push("is_active = ?"); params.push(updates.isActive ? 1 : 0); }

  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  params.push(id);

  const result = rawDb.prepare(`UPDATE soul_team_members SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return result.changes > 0;
}

// ─── Classification ───

export function classifyResource(input: {
  resourceType: string;
  resourceId: number;
  classification: ClassificationLevel;
  compartment?: string;
  classifiedBy: number;
  reason: string;
}): ClassifiedData {
  ensureClassificationTables();
  const rawDb = getRawDb();

  // Check classifier has permission
  const user = rawDb.prepare("SELECT * FROM soul_team_members WHERE id = ?").get(input.classifiedBy) as any;
  if (!user) throw new Error("Classifier not found");

  const perms = ROLE_PERMISSIONS[user.role as UserRole];
  if (!perms.canClassify) throw new Error(`Role ${user.role} cannot classify data`);

  // Cannot classify above own clearance
  if (CLEARANCE_RANK[input.classification] > CLEARANCE_RANK[user.clearance_level as ClassificationLevel]) {
    throw new Error(`Cannot classify above your clearance level (${user.clearance_level})`);
  }

  const row = rawDb.prepare(
    `INSERT INTO soul_classification (resource_type, resource_id, classification, compartment, classified_by, reason)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET
       classification = excluded.classification,
       compartment = excluded.compartment,
       classified_by = excluded.classified_by,
       reason = excluded.reason
     RETURNING *`
  ).get(input.resourceType, input.resourceId, input.classification, input.compartment || null, input.classifiedBy, input.reason) as any;

  // Audit
  auditLog(input.classifiedBy, user.username, "classify", input.resourceType, String(input.resourceId), input.classification,
    `Classified as ${CLASSIFICATION_LABELS[input.classification].th} (${input.reason})`);

  return mapClassification(row);
}

export function getClassification(resourceType: string, resourceId: number): ClassifiedData | null {
  ensureClassificationTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare(
    "SELECT * FROM soul_classification WHERE resource_type = ? AND resource_id = ?"
  ).get(resourceType, resourceId) as any;
  return row ? mapClassification(row) : null;
}

export function canAccess(userId: number, resourceType: string, resourceId: number): { allowed: boolean; reason: string } {
  ensureClassificationTables();
  const rawDb = getRawDb();

  const user = rawDb.prepare("SELECT * FROM soul_team_members WHERE id = ? AND is_active = 1").get(userId) as any;
  if (!user) return { allowed: false, reason: "User not found or inactive" };

  const classification = getClassification(resourceType, resourceId);
  if (!classification) return { allowed: true, reason: "Unclassified resource" };

  // Check clearance level
  const userRank = CLEARANCE_RANK[user.clearance_level as ClassificationLevel];
  const dataRank = CLEARANCE_RANK[classification.classification];

  if (userRank < dataRank) {
    logSecurityEvent("access_denied", {
      userId, username: user.username,
      resource: `${resourceType}:${resourceId}`,
      classification: classification.classification,
      userClearance: user.clearance_level,
    });
    return {
      allowed: false,
      reason: `Clearance ${CLASSIFICATION_LABELS[user.clearance_level as ClassificationLevel].th} ไม่เพียงพอ — ต้องการ ${CLASSIFICATION_LABELS[classification.classification].th}`,
    };
  }

  // Check compartment access
  if (classification.compartment) {
    const compartment = rawDb.prepare("SELECT * FROM soul_compartments WHERE name = ?").get(classification.compartment) as any;
    if (compartment) {
      const members: number[] = JSON.parse(compartment.members || "[]");
      if (!members.includes(userId) && compartment.owner_id !== userId && user.role !== "admin") {
        return { allowed: false, reason: `ไม่มีสิทธิ์เข้าถึงข้อมูลในส่วน "${classification.compartment}"` };
      }
    }
  }

  return { allowed: true, reason: "Access granted" };
}

// ─── Compartments (Case-specific access groups) ───

export function createCompartment(name: string, description: string, ownerId: number, memberIds: number[]): void {
  ensureClassificationTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    "INSERT OR REPLACE INTO soul_compartments (name, description, owner_id, members) VALUES (?, ?, ?, ?)"
  ).run(name, description, ownerId, JSON.stringify(memberIds));
  logSecurityEvent("compartment_created", { name, ownerId, members: memberIds });
}

export function addToCompartment(compartmentName: string, userId: number): void {
  ensureClassificationTables();
  const rawDb = getRawDb();
  const row = rawDb.prepare("SELECT * FROM soul_compartments WHERE name = ?").get(compartmentName) as any;
  if (!row) throw new Error(`Compartment "${compartmentName}" not found`);
  const members: number[] = JSON.parse(row.members || "[]");
  if (!members.includes(userId)) {
    members.push(userId);
    rawDb.prepare("UPDATE soul_compartments SET members = ? WHERE name = ?").run(JSON.stringify(members), compartmentName);
  }
}

export function listCompartments(): Array<{ name: string; description: string; ownerName: string; memberCount: number }> {
  ensureClassificationTables();
  const rawDb = getRawDb();
  const rows = rawDb.prepare(`
    SELECT c.*, t.display_name as owner_name FROM soul_compartments c
    LEFT JOIN soul_team_members t ON t.id = c.owner_id ORDER BY c.name
  `).all() as any[];
  return rows.map(r => ({
    name: r.name,
    description: r.description,
    ownerName: r.owner_name || "Unknown",
    memberCount: JSON.parse(r.members || "[]").length,
  }));
}

// ─── Audit Trail ───

export function auditLog(
  userId: number, username: string, action: string,
  resource: string, resourceId: string, classification: ClassificationLevel,
  details: string, ip: string = "local"
): void {
  ensureClassificationTables();
  const rawDb = getRawDb();
  rawDb.prepare(
    `INSERT INTO soul_audit_log (user_id, username, action, resource, resource_id, classification, details, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, username, action, resource, resourceId, classification, details, ip);
}

export function getAuditLog(options?: {
  userId?: number;
  resource?: string;
  classification?: ClassificationLevel;
  limit?: number;
  since?: string;
}): AuditEntry[] {
  ensureClassificationTables();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_audit_log WHERE 1=1";
  const params: any[] = [];

  if (options?.userId) { query += " AND user_id = ?"; params.push(options.userId); }
  if (options?.resource) { query += " AND resource = ?"; params.push(options.resource); }
  if (options?.classification) { query += " AND classification = ?"; params.push(options.classification); }
  if (options?.since) { query += " AND timestamp >= ?"; params.push(options.since); }

  query += " ORDER BY timestamp DESC LIMIT ?";
  params.push(options?.limit || 100);

  return (rawDb.prepare(query).all(...params) as any[]).map(mapAudit);
}

// ─── Auto-Classification ───

// Patterns that indicate sensitive data (multi-language)
const SENSITIVITY_PATTERNS: Array<{ pattern: RegExp; level: ClassificationLevel; category: string }> = [
  // ─── Top Secret (ลับที่สุด) ───
  { pattern: /informant|สายลับ|ผู้ให้ข่าว|แหล่งข่าว|undercover|สายสืบ/i, level: "top_secret", category: "informant" },
  { pattern: /witness\s*protect|คุ้มครองพยาน|พยานคดี|witness\s*identity/i, level: "top_secret", category: "witness" },
  { pattern: /classified\s*operation|ปฏิบัติการลับ|covert/i, level: "top_secret", category: "operation" },
  { pattern: /national\s*security|ความมั่นคง/i, level: "top_secret", category: "national_security" },
  { pattern: /top\s*secret|ลับที่สุด|极密|極機密/i, level: "top_secret", category: "classification_marker" },
  { pattern: /intelligence|ข่าวกรอง|情报|インテリジェンス/i, level: "top_secret", category: "intelligence" },
  { pattern: /ปฏิบัติการจับกุม|raid\s*operation|tactical\s*operation/i, level: "top_secret", category: "operation" },
  { pattern: /drug\s*lord|เจ้าพ่อ|kingpin|cartel|เครือข่ายยาเสพติด/i, level: "top_secret", category: "organized_crime" },

  // ─── Secret (ลับมาก) ───
  { pattern: /suspect|ผู้ต้องสงสัย|ผู้ต้องหา|accused|defendant/i, level: "secret", category: "suspect" },
  { pattern: /bank\s*account|เลขบัญชี|account\s*number|เลขที่บัญชี/i, level: "secret", category: "financial" },
  { pattern: /money\s*trail|เส้นทางการเงิน|transaction|โอนเงิน|ถอนเงิน/i, level: "secret", category: "financial" },
  { pattern: /mule\s*account|ม้า|บัญชีม้า|nominee/i, level: "secret", category: "mule" },
  { pattern: /phone\s*tap|ดักฟัง|wiretap|intercept/i, level: "secret", category: "surveillance" },
  { pattern: /ip\s*address|หมายเลข\s*ip|ไอพี/i, level: "secret", category: "digital_evidence" },
  { pattern: /arrest\s*warrant|หมายจับ|หมายค้น|search\s*warrant/i, level: "secret", category: "legal" },
  { pattern: /evidence|หลักฐาน|พยานหลักฐาน|ของกลาง/i, level: "secret", category: "evidence" },

  // ─── Secret (more patterns) ───
  { pattern: /ฟอกเงิน|money\s*launder|launder/i, level: "secret", category: "money_laundering" },
  { pattern: /ยาเสพติด|narcotics|drug\s*trafficking|methamphetamine|ยาบ้า|ไอซ์|เฮโรอีน/i, level: "secret", category: "narcotics" },
  { pattern: /gambling|การพนัน|บ่อน|casino\s*online/i, level: "secret", category: "gambling" },
  { pattern: /human\s*trafficking|ค้ามนุษย์|trafficking/i, level: "secret", category: "trafficking" },
  { pattern: /CCTV|กล้องวงจรปิด|surveillance\s*footage/i, level: "secret", category: "surveillance" },

  // ─── Confidential (ลับ) ───
  { pattern: /victim|ผู้เสียหาย|เหยื่อ|complainant|ผู้ร้อง/i, level: "confidential", category: "victim" },
  { pattern: /case\s*number|เลขคดี|tracking\s*code|หมายเลขคดี/i, level: "confidential", category: "case" },
  { pattern: /personal\s*id|บัตรประชาชน|เลขประจำตัว|id\s*card/i, level: "confidential", category: "pii" },
  { pattern: /address|ที่อยู่|บ้านเลขที่/i, level: "confidential", category: "pii" },
  { pattern: /phone|โทรศัพท์|เบอร์โทร|หมายเลขโทรศัพท์/i, level: "confidential", category: "pii" },
  { pattern: /passport|หนังสือเดินทาง/i, level: "confidential", category: "pii" },
  { pattern: /investigation|สืบสวน|สอบสวน/i, level: "confidential", category: "investigation" },
];

export function autoClassify(text: string): {
  suggestedLevel: ClassificationLevel;
  matches: Array<{ category: string; level: ClassificationLevel; matched: string }>;
} {
  const matches: Array<{ category: string; level: ClassificationLevel; matched: string }> = [];
  let highest: ClassificationLevel = "unclassified";

  for (const { pattern, level, category } of SENSITIVITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push({ category, level, matched: match[0] });
      if (CLEARANCE_RANK[level] > CLEARANCE_RANK[highest]) {
        highest = level;
      }
    }
  }

  return { suggestedLevel: highest, matches };
}

// ─── Learning-Based Classification ───
// Soul learns from team's manual classifications to improve auto-detection

function ensureLearningTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_classification_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      classification TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'learned',
      weight REAL NOT NULL DEFAULT 1.0,
      taught_by INTEGER NOT NULL,
      examples TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(keyword, classification)
    );

    CREATE TABLE IF NOT EXISTS soul_classification_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text_hash TEXT NOT NULL,
      original_level TEXT NOT NULL,
      corrected_level TEXT NOT NULL,
      corrected_by INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      keywords_extracted TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Teach Soul a new keyword/phrase → classification mapping
 * ทีมสอน Soul ว่าคำไหนควรจัดเป็นระดับไหน
 */
export function teachClassification(input: {
  keyword: string;
  classification: ClassificationLevel;
  category?: string;
  example?: string;
  taughtBy: number;
}): { keyword: string; classification: ClassificationLevel; isNew: boolean } {
  ensureLearningTable();
  const rawDb = getRawDb();

  const keyword = input.keyword.toLowerCase().trim();
  if (keyword.length < 2) throw new Error("Keyword too short (min 2 chars)");

  // Check if exists → update weight
  const existing = rawDb.prepare(
    "SELECT * FROM soul_classification_patterns WHERE keyword = ? AND classification = ?"
  ).get(keyword, input.classification) as any;

  if (existing) {
    // Increase weight (reinforcement) and add example
    const examples: string[] = JSON.parse(existing.examples || "[]");
    if (input.example && !examples.includes(input.example)) {
      examples.push(input.example);
      if (examples.length > 5) examples.shift(); // Keep last 5 examples
    }
    rawDb.prepare(
      `UPDATE soul_classification_patterns
       SET weight = MIN(weight + 0.5, 5.0), examples = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(JSON.stringify(examples), existing.id);

    auditLog(input.taughtBy, "", "teach_reinforce", "pattern", keyword, input.classification,
      `Reinforced: "${keyword}" → ${CLASSIFICATION_LABELS[input.classification].th} (weight: ${Math.min(existing.weight + 0.5, 5).toFixed(1)})`);

    return { keyword, classification: input.classification, isNew: false };
  }

  // New pattern
  const examples = input.example ? [input.example] : [];
  rawDb.prepare(
    `INSERT INTO soul_classification_patterns (keyword, classification, category, weight, taught_by, examples)
     VALUES (?, ?, ?, 1.0, ?, ?)`
  ).run(keyword, input.classification, input.category || "learned", input.taughtBy, JSON.stringify(examples));

  auditLog(input.taughtBy, "", "teach_new", "pattern", keyword, input.classification,
    `New pattern: "${keyword}" → ${CLASSIFICATION_LABELS[input.classification].th}`);

  return { keyword, classification: input.classification, isNew: true };
}

/**
 * Give feedback on auto-classify result — correct it and Soul learns
 * ทีมบอก Soul ว่า classify ผิด → Soul จำและปรับปรุง
 */
export function feedbackClassification(input: {
  text: string;
  originalLevel: ClassificationLevel;
  correctedLevel: ClassificationLevel;
  correctedBy: number;
  reason?: string;
}): { learned: string[]; message: string } {
  ensureLearningTable();
  const rawDb = getRawDb();

  const textHash = createHash("sha256").update(input.text).digest("hex").slice(0, 16);

  // Extract potential keywords (words 3+ chars, both Thai and English)
  const words = input.text.match(/[\u0E00-\u0E7F]{2,}|[a-zA-Z]{3,}/g) || [];
  const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))];

  // Save feedback
  rawDb.prepare(
    `INSERT INTO soul_classification_feedback (text_hash, original_level, corrected_level, corrected_by, reason, keywords_extracted)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(textHash, input.originalLevel, input.correctedLevel, input.correctedBy, input.reason || "", JSON.stringify(uniqueWords));

  // Auto-learn keywords from the text that aren't in existing patterns
  const learned: string[] = [];
  const existingKeywords = new Set(
    (rawDb.prepare("SELECT keyword FROM soul_classification_patterns").all() as any[]).map(r => r.keyword)
  );
  const builtinKeywords = new Set(
    SENSITIVITY_PATTERNS.flatMap(p => {
      // Extract words from regex source
      return p.pattern.source.split(/[|\\s*+?()]/g).filter(w => w.length >= 3);
    })
  );

  // Find words that might be important (not common words, not already known)
  for (const word of uniqueWords) {
    if (word.length < 3) continue;
    if (existingKeywords.has(word)) continue;
    if (builtinKeywords.has(word)) continue;
    // Skip very common words
    if (/^(the|and|for|that|with|this|from|have|are|was|were|been|being|การ|ของ|ใน|ที่|และ|ได้|มี|จะ|เป็น|ไม่)$/i.test(word)) continue;

    // If the correction was UP (more secret), these words indicate sensitivity
    if (CLEARANCE_RANK[input.correctedLevel] > CLEARANCE_RANK[input.originalLevel]) {
      teachClassification({
        keyword: word,
        classification: input.correctedLevel,
        category: "feedback_learned",
        example: input.text.substring(0, 100),
        taughtBy: input.correctedBy,
      });
      learned.push(word);
    }
  }

  const label = CLASSIFICATION_LABELS[input.correctedLevel];
  return {
    learned,
    message: learned.length > 0
      ? `เรียนรู้ ${learned.length} คำใหม่ → ${label.icon} ${label.th}: ${learned.join(", ")}`
      : `บันทึก feedback แล้ว (ไม่มีคำใหม่ที่ต้องเรียนรู้)`,
  };
}

/**
 * Enhanced auto-classify that uses BOTH built-in patterns AND learned patterns
 * ใช้ทั้ง regex ที่มีอยู่ + คำที่ทีมสอนไว้
 */
export function smartClassify(text: string): {
  suggestedLevel: ClassificationLevel;
  confidence: number;
  matches: Array<{ category: string; level: ClassificationLevel; matched: string; source: "builtin" | "learned" }>;
} {
  ensureLearningTable();
  const rawDb = getRawDb();

  const matches: Array<{ category: string; level: ClassificationLevel; matched: string; source: "builtin" | "learned" }> = [];
  let highest: ClassificationLevel = "unclassified";
  let totalWeight = 0;

  // Step 1: Built-in patterns (same as autoClassify)
  for (const { pattern, level, category } of SENSITIVITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push({ category, level, matched: match[0], source: "builtin" });
      totalWeight += 2; // Built-in patterns have high weight
      if (CLEARANCE_RANK[level] > CLEARANCE_RANK[highest]) {
        highest = level;
      }
    }
  }

  // Step 2: Learned patterns from database
  const learnedPatterns = rawDb.prepare(
    "SELECT * FROM soul_classification_patterns WHERE weight >= 0.5 ORDER BY weight DESC"
  ).all() as any[];

  const lowerText = text.toLowerCase();
  for (const p of learnedPatterns) {
    if (lowerText.includes(p.keyword)) {
      matches.push({
        category: p.category,
        level: p.classification,
        matched: p.keyword,
        source: "learned",
      });
      totalWeight += p.weight;
      if (CLEARANCE_RANK[p.classification as ClassificationLevel] > CLEARANCE_RANK[highest]) {
        highest = p.classification;
      }
    }
  }

  // Confidence: higher when more matches agree on the level
  const levelMatches = matches.filter(m => m.level === highest).length;
  const confidence = matches.length === 0 ? 1.0 : Math.min(levelMatches / Math.max(matches.length, 1) + (totalWeight * 0.1), 1.0);

  return { suggestedLevel: highest, confidence, matches };
}

/**
 * List all learned patterns (for review/management)
 */
export function listLearnedPatterns(options?: {
  classification?: ClassificationLevel;
  minWeight?: number;
  limit?: number;
}): Array<{ keyword: string; classification: ClassificationLevel; category: string; weight: number; examples: string[] }> {
  ensureLearningTable();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_classification_patterns WHERE 1=1";
  const params: any[] = [];

  if (options?.classification) { query += " AND classification = ?"; params.push(options.classification); }
  if (options?.minWeight) { query += " AND weight >= ?"; params.push(options.minWeight); }

  query += " ORDER BY weight DESC LIMIT ?";
  params.push(options?.limit || 100);

  return (rawDb.prepare(query).all(...params) as any[]).map(r => ({
    keyword: r.keyword,
    classification: r.classification,
    category: r.category,
    weight: r.weight,
    examples: JSON.parse(r.examples || "[]"),
  }));
}

/**
 * Remove or reduce weight of a learned pattern
 */
export function forgetPattern(keyword: string, removedBy: number): boolean {
  ensureLearningTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare("DELETE FROM soul_classification_patterns WHERE keyword = ?").run(keyword.toLowerCase().trim());
  if (result.changes > 0) {
    auditLog(removedBy, "", "forget_pattern", "pattern", keyword, "unclassified", `Removed pattern: "${keyword}"`);
  }
  return result.changes > 0;
}

/**
 * Get classification learning stats
 */
export function getClassificationLearningStats(): {
  totalPatterns: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  totalFeedback: number;
  recentFeedback: number;
  topPatterns: Array<{ keyword: string; classification: string; weight: number }>;
} {
  ensureLearningTable();
  const rawDb = getRawDb();

  const total = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_classification_patterns").get() as any).c;
  const byLevel = rawDb.prepare("SELECT classification, COUNT(*) as c FROM soul_classification_patterns GROUP BY classification").all() as any[];
  const bySource = rawDb.prepare("SELECT category, COUNT(*) as c FROM soul_classification_patterns GROUP BY category").all() as any[];
  const totalFeedback = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_classification_feedback").get() as any).c;
  const recentFeedback = (rawDb.prepare("SELECT COUNT(*) as c FROM soul_classification_feedback WHERE created_at >= datetime('now', '-7 days')").get() as any).c;
  const topPatterns = rawDb.prepare(
    "SELECT keyword, classification, weight FROM soul_classification_patterns ORDER BY weight DESC LIMIT 10"
  ).all() as any[];

  return {
    totalPatterns: total,
    byLevel: Object.fromEntries(byLevel.map(r => [r.classification, r.c])),
    bySource: Object.fromEntries(bySource.map(r => [r.category, r.c])),
    totalFeedback,
    recentFeedback,
    topPatterns,
  };
}

// ─── Dashboard ───

export function getClassificationDashboard(): {
  teamSize: number;
  byRole: Record<string, number>;
  byClearance: Record<string, number>;
  classifiedItems: Record<string, number>;
  recentAudit: AuditEntry[];
  compartments: number;
} {
  ensureClassificationTables();
  const rawDb = getRawDb();

  const members = rawDb.prepare("SELECT COUNT(*) as c FROM soul_team_members WHERE is_active = 1").get() as any;
  const byRole = rawDb.prepare("SELECT role, COUNT(*) as c FROM soul_team_members WHERE is_active = 1 GROUP BY role").all() as any[];
  const byClearance = rawDb.prepare("SELECT clearance_level, COUNT(*) as c FROM soul_team_members WHERE is_active = 1 GROUP BY clearance_level").all() as any[];
  const classifiedItems = rawDb.prepare("SELECT classification, COUNT(*) as c FROM soul_classification GROUP BY classification").all() as any[];
  const compartments = rawDb.prepare("SELECT COUNT(*) as c FROM soul_compartments").get() as any;
  const recentAudit = getAuditLog({ limit: 10 });

  return {
    teamSize: members.c || 0,
    byRole: Object.fromEntries(byRole.map(r => [r.role, r.c])),
    byClearance: Object.fromEntries(byClearance.map(r => [r.clearance_level, r.c])),
    classifiedItems: Object.fromEntries(classifiedItems.map(r => [r.classification, r.c])),
    recentAudit,
    compartments: compartments.c || 0,
  };
}

// ─── Helpers ───

function mapTeamMember(row: any): TeamMember {
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, clearanceLevel: row.clearance_level,
    department: row.department, isActive: row.is_active === 1,
    lastLogin: row.last_login, createdAt: row.created_at,
  };
}

function mapClassification(row: any): ClassifiedData {
  return {
    id: row.id, resourceType: row.resource_type, resourceId: row.resource_id,
    classification: row.classification, compartment: row.compartment,
    classifiedBy: row.classified_by, reason: row.reason, createdAt: row.created_at,
  };
}

function mapAudit(row: any): AuditEntry {
  return {
    id: row.id, userId: row.user_id, username: row.username,
    action: row.action, resource: row.resource, resourceId: row.resource_id,
    classification: row.classification, details: row.details,
    ip: row.ip, timestamp: row.timestamp,
  };
}
