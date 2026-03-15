/**
 * Soul Security Module — Protect master's data, privacy, and identity
 *
 * Protects against:
 * - SQL injection (column name whitelist)
 * - Path traversal (restrict to ~/.soul/)
 * - SSRF (block internal networks)
 * - Data leaks (filter sensitive data before sharing/export)
 * - Prompt injection (sanitize LLM inputs)
 * - Brute force (rate limiting)
 * - Token theft (expiring tokens)
 * - API key exposure (encrypt at rest)
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";
import * as path from "path";
import * as os from "os";
import * as url from "url";

// ─── 1. Path Safety — Prevent path traversal ───

const SOUL_DATA_DIR = path.join(os.homedir(), ".soul");

export function safePath(userPath: string, allowedBase?: string): string {
  const base = allowedBase || SOUL_DATA_DIR;
  // Resolve to absolute, then check it's within allowed base
  const resolved = path.resolve(base, userPath);
  const normalizedBase = path.resolve(base);

  const prefix = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  if (!resolved.startsWith(prefix) && resolved !== normalizedBase) {
    throw new Error(`Path traversal blocked: path must be within ${normalizedBase}`);
  }
  return resolved;
}

export function isPathSafe(userPath: string, allowedBase?: string): boolean {
  try {
    safePath(userPath, allowedBase);
    return true;
  } catch {
    return false;
  }
}

// ─── 2. SQL Column Name Whitelist — Prevent SQL injection via column names ───

const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  soul_tasks: new Set(["title", "description", "status", "priority", "due_date", "category", "created_at", "updated_at", "completed_at"]),
  soul_goals: new Set(["title", "description", "category", "status", "target_date", "progress", "created_at", "updated_at"]),
  soul_habits: new Set(["name", "description", "frequency", "category", "streak", "best_streak", "total_completions", "created_at", "updated_at"]),
  soul_decisions: new Set(["title", "context", "options", "chosen", "reasoning", "outcome", "created_at"]),
  soul_reflections: new Set(["content", "mood", "insights", "created_at"]),
  soul_writing: new Set(["title", "content", "writing_type", "style", "created_at"]),
  soul_executable_skills: new Set(["name", "description", "skill_type", "code", "language", "is_approved", "version", "created_at", "updated_at", "last_run_at", "run_count"]),
  soul_notifications: new Set(["title", "message", "notification_type", "priority", "is_read", "created_at"]),
};

export function sanitizeColumns(tableName: string, columns: string[]): string[] {
  const allowed = ALLOWED_COLUMNS[tableName];
  if (!allowed) {
    // Unknown table — only allow simple alphanumeric + underscore column names
    return columns.filter(c => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
  }
  return columns.filter(c => allowed.has(c));
}

export function validateColumnName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name);
}

// ─── 3. URL Safety — Prevent SSRF ───

const BLOCKED_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP metadata
]);

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^fc00:/,
  /^fe80:/,
  /^fd/,
];

export function isUrlSafe(inputUrl: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(inputUrl);

    // Must be http or https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    // Block known dangerous hosts
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(hostname)) {
      return { safe: false, reason: `Blocked host: ${hostname}` };
    }

    // Block private IP ranges
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(hostname)) {
        return { safe: false, reason: `Blocked private IP: ${hostname}` };
      }
    }

    // Block common cloud metadata endpoints
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) {
      return { safe: false, reason: `Blocked internal hostname: ${hostname}` };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL format" };
  }
}

// ─── 4. Data Privacy — Detect and redact sensitive data ───

const SENSITIVE_PATTERNS = [
  // Credentials
  /password\s*[=:]\s*\S+/gi,
  /passwd\s*[=:]\s*\S+/gi,
  /passphrase\s*[=:]\s*\S+/gi,
  /secret\s*[=:]\s*\S+/gi,

  // API keys & tokens
  /api[_\- ]?key\s*[=:]\s*\S+/gi,
  /token\s*[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /sk-[a-zA-Z0-9]{20,}/g,                    // OpenAI keys
  /AIza[a-zA-Z0-9_-]{35}/g,                  // Google API keys
  /ghp_[a-zA-Z0-9]{36}/g,                    // GitHub personal tokens
  /gho_[a-zA-Z0-9]{36}/g,                    // GitHub OAuth tokens

  // Financial
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // Credit card numbers
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,            // US SSN
  /\b[0-9]{10,16}\b/g,                          // Bank account numbers (with context)

  // Thai ID
  /\b[0-9]{1}[- ]?[0-9]{4}[- ]?[0-9]{5}[- ]?[0-9]{2}[- ]?[0-9]{1}\b/g, // Thai ID card

  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
  /-----BEGIN\s+CERTIFICATE-----/g,

  // Connection strings
  /mongodb(\+srv)?:\/\/[^\s]+/gi,
  /postgres(ql)?:\/\/[^\s]+/gi,
  /mysql:\/\/[^\s]+/gi,
  /redis:\/\/[^\s]+/gi,
];

const SENSITIVE_KEYWORDS = [
  // English
  "password", "passwd", "passphrase", "secret", "token", "api_key", "apikey",
  "api-key", "private_key", "private-key", "access_key", "secret_key",
  "credit card", "ssn", "social security", "bank account", "pin code", "cvv", "cvc",
  // Thai (ไทย)
  "เลขบัตร", "รหัสผ่าน", "พาสเวิร์ด", "เลขบัญชี", "รหัส pin",
  "เลขบัตรประชาชน", "บัตรเครดิต", "บัตรเดบิต", "รหัสลับ", "คีย์ลับ",
  "เลขประจำตัว", "หมายเลขบัญชี", "รหัสส่วนตัว",
  // Chinese (中文)
  "密码", "口令", "密钥", "银行账户", "信用卡", "身份证",
  // Japanese (日本語)
  "パスワード", "暗証番号", "口座番号", "クレジットカード",
  // Korean (한국어)
  "비밀번호", "계좌번호", "신용카드",
  // Malay/Indonesian
  "kata sandi", "kata laluan", "nombor akaun", "nomor rekening",
  // Vietnamese
  "mật khẩu", "số tài khoản", "thẻ tín dụng",
];

export function containsSensitiveData(text: string): boolean {
  const lower = text.toLowerCase();

  // Check keywords — require value-assignment context (keyword followed by =, :, is, คือ, or a value)
  // This prevents false positives like "explaining how passwords work"
  for (const keyword of SENSITIVE_KEYWORDS) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0) {
      // Check if there's an assignment operator or value nearby after the keyword
      const afterKeyword = lower.substring(idx + keyword.length, idx + keyword.length + 20).trimStart();
      const hasAssignment = /^[=:]\s*\S|^(is|คือ|เป็น)\s+\S/i.test(afterKeyword);
      const isNoun = /^(s?\s|$)/.test(afterKeyword) && !/[=:]/.test(afterKeyword);
      // For Thai/CJK keywords (non-ASCII), they are specific enough to always trigger
      const isSpecificKeyword = /[^\x00-\x7F]/.test(keyword);
      if (hasAssignment || (isSpecificKeyword && !isNoun)) return true;
    }
  }

  // Check patterns (regex-based — these already require value context)
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0; // reset regex state
    if (pattern.test(text)) return true;
  }

  return false;
}

export function redactSensitiveData(text: string): string {
  let result = text;

  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }

  return result;
}

/**
 * Filter export data — remove sensitive items before sharing
 */
export function filterExportData(items: any[]): any[] {
  return items.filter(item => {
    const content = JSON.stringify(item);
    return !containsSensitiveData(content);
  });
}

// ─── 5. Prompt Injection Defense ───

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /ignore\s+(all\s+)?(system\s+)?prompt/i,
  /you\s+are\s+now\s+a?\s*(different|new|DAN)\b/i,
  /\bsystem\s*:\s*/i,
  /\{\{\s*system\s*\}\}/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
  /act\s+as\s+(if\s+)?(you\s+are\s+)?(a\s+)?different/i,
  /forget\s+(everything|all|your)\s+(instructions|rules|guidelines)/i,
  /override\s+(your|all|the)\s+(instructions|rules|safety)/i,
  /pretend\s+(you\s+(are|have)|to\s+be|that)/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /no\s+(restrictions|limitations|rules|boundaries)/i,
  /reveal\s+(all\s+)?(secrets|passwords|keys)/i,
];

export function detectPromptInjection(text: string): { detected: boolean; patterns: string[] } {
  const found: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      found.push(pattern.source);
    }
  }

  return { detected: found.length > 0, patterns: found };
}

export function sanitizeForLLM(text: string): string {
  // Remove control characters and special tokens that could confuse LLMs
  let sanitized = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // control chars
    .replace(/<\|[^|]*\|>/g, "") // special tokens like <|im_start|>
    .replace(/<<SYS>>|<<\/SYS>>/g, "") // Llama tokens
    .replace(/\[INST\]|\[\/INST\]/g, ""); // Instruction tokens

  return sanitized;
}

// ─── 6. Rate Limiting ───

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetIn: entry.resetAt - now };
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetAt) rateLimitStore.delete(key);
  }
}, 60000);

// ─── 7. Token Management — Persistent tokens (survive server restart) ───

import { getRawDb } from "../db/index.js";

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (was 24h — too short)

let _tokenTableReady = false;
function ensureTokenTable() {
  if (_tokenTableReady) return;
  try {
    const db = getRawDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS soul_auth_tokens (
        token TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        ip TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    _tokenTableReady = true;
  } catch { /* DB not ready yet */ }
}

export function createAuthToken(passphraseHash: string, ip?: string): string {
  const randomPart = randomBytes(32).toString("hex");
  const token = createHash("sha256").update(passphraseHash + randomPart + Date.now()).digest("hex");

  try {
    ensureTokenTable();
    const db = getRawDb();
    db.prepare("INSERT OR REPLACE INTO soul_auth_tokens (token, hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(token, passphraseHash, ip || null, Date.now(), Date.now() + TOKEN_EXPIRY_MS);
  } catch { /* fallback: token works for this session only */ }

  return token;
}

export function validateAuthToken(token: string): boolean {
  try {
    ensureTokenTable();
    const db = getRawDb();
    const row = db.prepare("SELECT expires_at FROM soul_auth_tokens WHERE token = ?").get(token) as any;
    if (!row) {
      // Backward compat: accept legacy static token (hash of passphrase)
      try {
        const masterRow = db.prepare("SELECT passphrase_hash FROM masters LIMIT 1").get() as any;
        if (masterRow?.passphrase_hash) {
          const legacyToken = createHash("sha256").update(masterRow.passphrase_hash).digest("hex");
          if (token === legacyToken) return true;
        }
      } catch { /* ok */ }
      return false;
    }
    if (Date.now() >= row.expires_at) {
      db.prepare("DELETE FROM soul_auth_tokens WHERE token = ?").run(token);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function revokeAuthToken(token: string): void {
  try { ensureTokenTable(); getRawDb().prepare("DELETE FROM soul_auth_tokens WHERE token = ?").run(token); } catch {}
}

export function revokeAllTokens(): void {
  try { ensureTokenTable(); getRawDb().exec("DELETE FROM soul_auth_tokens"); } catch {}
}

// Clean up expired tokens every 5 minutes
setInterval(() => {
  try { ensureTokenTable(); getRawDb().prepare("DELETE FROM soul_auth_tokens WHERE expires_at < ?").run(Date.now()); } catch {}
}, 300000);

// ─── 8. API Key Encryption ───

const ENCRYPTION_ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  // Derive key from machine-specific data
  const machineId = os.hostname() + os.userInfo().username + os.homedir();
  return createHash("sha256").update(machineId).digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptSecret(encrypted: string): string {
  if (!encrypted) return "";
  if (!encrypted.startsWith("enc:")) return encrypted; // plaintext fallback
  const parts = encrypted.split(":");
  if (parts.length !== 4) return encrypted;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(parts[3], "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch (e: any) {
    throw new Error(
      "API key decryption failed. Machine identity may have changed. Please re-add your API key with soul_llm_add."
    );
  }
}

/**
 * Safe wrapper for decryptSecret — backward compatible with plaintext keys.
 * 1. If string doesn't look encrypted (no ":" separator), return as-is (plaintext)
 * 2. Try decryptSecret()
 * 3. On failure, return original string (assume plaintext)
 */
export function safeDecryptSecret(encrypted: string): string {
  if (!encrypted) return "";
  // If it doesn't contain ":" at all, it's plaintext — return as-is
  if (!encrypted.includes(":")) return encrypted;
  try {
    return decryptSecret(encrypted);
  } catch {
    // Decryption failed — assume plaintext (backward compat)
    return encrypted;
  }
}

// ─── 9. Input Validation ───

export function validateStringInput(value: string, maxLength: number = 10000): string {
  if (typeof value !== "string") throw new Error("Input must be a string");
  if (value.length > maxLength) throw new Error(`Input exceeds maximum length of ${maxLength}`);
  return value.trim();
}

export function validateIntInput(value: any, min: number = 0, max: number = 1000000): number {
  const num = typeof value === "string" ? parseInt(value, 10) : value;
  if (isNaN(num) || num < min || num > max) {
    throw new Error(`Number must be between ${min} and ${max}`);
  }
  return num;
}

// ─── 10. Audit Log ───

export function logSecurityEvent(event: string, details: Record<string, any> = {}): void {
  // Log to stderr for now (visible in server logs but not in responses)
  console.error(`[Soul Security] ${event}`, JSON.stringify(details));
}
