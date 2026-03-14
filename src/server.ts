#!/usr/bin/env node

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { soul } from "./core/soul-engine.js";
import { getPhilosophy } from "./core/philosophy.js";
import { verifyMaster, getMasterInfo, getMasterPassphraseHash, isMasterSetup } from "./core/master.js";
import {
  remember,
  search,
  recall,
  list,
  getRandomWisdom,
  getMemoryStats,
  getRecentMemories,
} from "./memory/memory-engine.js";
import { getLearnings } from "./memory/learning.js";
import { getKnowledgeStats, getKnowledge } from "./core/knowledge.js";
import { getMoodHistory, analyzeMoodTrends } from "./core/emotional-intelligence.js";
import { getTimeSummary, getTodayEntries } from "./core/time-intelligence.js";
import { listPeople } from "./core/people-memory.js";
import { getLearningPaths } from "./core/learning-paths.js";
import { getQuickNotes } from "./core/quick-capture.js";
import { generateDailyDigest } from "./core/daily-digest.js";
import { getSafetyStats } from "./core/web-safety.js";
import { getSoulMode, getBrainHubStats, listBrainPacks } from "./core/brain-hub.js";
import { listChildren, getFamilyTree } from "./core/soul-family.js";
import { getTeamOverview, getTeamActivity } from "./core/coworker.js";
import { getCodeStats } from "./core/code-intelligence.js";
import { getGrowthSummary } from "./core/meta-intelligence.js";
import { listAutoGoals, getGoalsDashboard } from "./core/goal-autopilot.js";
import { listWorkflows, getWorkflowRuns } from "./core/workflow-engine.js";
import { listResearchProjects } from "./core/deep-research.js";
import { getDefaultConfig, listConfiguredProviders, getUsageStats, chat, chatStream, type LLMMessage } from "./core/llm-connector.js";
import { runAgentLoop, registerAllInternalTools, saveConversationTurn, getConversationHistory, listSessions, getRegisteredTools } from "./core/agent-loop.js";
import { createAuthToken, validateAuthToken, checkRateLimit, logSecurityEvent } from "./core/security.js";
import { startScheduler } from "./core/scheduler.js";
import { initWebSocket, setChatHandler, sendToClient } from "./core/ws-notifications.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const app = new Hono();
const PORT = parseInt(process.env.SOUL_PORT || "47779", 10);

// Security headers — prevent XSS, clickjacking, MIME sniffing
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP: allow self + inline styles for web UI (Canvas needs it)
  if (c.req.path === "/" || c.req.path === "/office" || c.req.path === "/chat" || c.req.path === "/community") {
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:;");
  }
});

// CORS — allow local + LAN access (for mobile/tablet on same network)
// All data endpoints require auth token, so CORS is safe
const ALLOWED_ORIGINS = (process.env.SOUL_CORS_ORIGINS || "").split(",").filter(Boolean);
app.use("*", cors({
  origin: (origin) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return "*";
    // Always allow localhost
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return origin;
    // Allow configured origins
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow LAN IPs (192.168.x.x, 10.x.x.x) — user accesses from phone/tablet
    if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) return origin;
    return null; // block external origins
  },
  credentials: true,
}));

// Master setup gate — block write endpoints (POST/PUT/DELETE) until master is bound
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "DELETE") {
    const masterReady = await isMasterSetup();
    if (!masterReady) {
      return c.json(
        { error: "Soul setup required. Use soul_setup to bind a master first." },
        403
      );
    }
  }
  await next();
});

// Auth middleware — supports expiring tokens + legacy static tokens
function authMiddleware() {
  return async (c: any, next: any) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = auth.replace("Bearer ", "");
    const hash = getMasterPassphraseHash();
    if (!hash) {
      return c.json({ error: "Soul not yet bound to a master" }, 403);
    }

    // Try expiring token first
    if (validateAuthToken(token)) {
      await next();
      return;
    }

    // Fallback: legacy static token (for backward compatibility)
    const legacyToken = createHash("sha256").update(hash).digest("hex");
    if (token === legacyToken) {
      await next();
      return;
    }

    logSecurityEvent("auth_failed", { ip: c.req.header("x-forwarded-for") || "unknown" });
    return c.json({ error: "Invalid or expired token" }, 401);
  };
}

// === Web UI — 3D Neural Network ===

app.get("/", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const html = readFileSync(join(__dirname, "web", "index.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Soul Web UI not found. Run from the project directory.", 404);
  }
});

app.get("/office", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const html = readFileSync(join(__dirname, "web", "office.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Soul Office UI not found.", 404);
  }
});

app.get("/chat", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const html = readFileSync(join(__dirname, "web", "chat.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Soul Chat UI not found.", 404);
  }
});

app.get("/community", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const html = readFileSync(join(__dirname, "web", "community.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Soul Community page not found.", 404);
  }
});

// === PWA Static Files ===

app.get("/manifest.json", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const json = readFileSync(join(__dirname, "web", "manifest.json"), "utf-8");
    return c.json(JSON.parse(json));
  } catch { return c.json({}, 404); }
});

app.get("/sw.js", (c) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const js = readFileSync(join(__dirname, "web", "sw.js"), "utf-8");
    c.header("Content-Type", "application/javascript");
    c.header("Service-Worker-Allowed", "/");
    return c.body(js);
  } catch { return c.text("", 404); }
});

// Dynamic SVG icon for PWA (no image dependency needed)
app.get("/api/icon/:size", (c) => {
  const size = parseInt(c.req.param("size") || "192");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#7c3aed"/>
    <text x="50%" y="55%" font-family="system-ui,sans-serif" font-size="${size * 0.5}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">S</text>
  </svg>`;
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(svg);
});

// === Public routes ===

app.get("/api/health", async (c) => {
  const status = await soul.getStatus();
  return c.json({
    status: "alive",
    soul: {
      initialized: status.initialized,
      master: status.masterName,
      version: status.version,
      uptime: status.uptime,
    },
  });
});

// ─── Monitoring Dashboard API ───
app.get("/api/dashboard", async (c) => {
  const status = await soul.getStatus();
  const dashboard: Record<string, any> = {
    timestamp: new Date().toISOString(),
    soul: { version: status.version, uptime: status.uptime, master: status.masterName },
  };

  // Memory stats
  try { dashboard.memory = getMemoryStats(); } catch { dashboard.memory = null; }

  // Embedding stats
  try {
    const { getEmbeddingStats } = await import("./memory/embeddings.js");
    dashboard.embeddings = getEmbeddingStats();
  } catch { dashboard.embeddings = null; }

  // LLM config
  try {
    const config = getDefaultConfig();
    const providers = listConfiguredProviders();
    dashboard.llm = { default: config ? `${config.providerId}/${config.modelId}` : null, providers: providers.length };
  } catch { dashboard.llm = null; }

  // Channels
  try {
    const { listChannels } = await import("./core/channels.js");
    const channels = await listChannels();
    dashboard.channels = channels.map((ch: any) => ({ name: ch.name, type: ch.channelType, active: ch.isActive }));
  } catch { dashboard.channels = []; }

  // Backup stats
  try {
    const { getBackupStats } = await import("./core/backup.js");
    dashboard.backups = getBackupStats();
  } catch { dashboard.backups = null; }

  // Brain metrics (last 24h)
  try {
    const { getRawDb: getDb } = await import("./db/index.js");
    const db = getDb();
    const metrics = db.prepare(`
      SELECT brain, COUNT(*) as count FROM soul_brain_metrics
      WHERE created_at > datetime('now', '-24 hours') GROUP BY brain
    `).all() as any[];
    dashboard.brainMetrics24h = metrics.reduce((acc: any, m: any) => { acc[m.brain] = m.count; return acc; }, {});
  } catch { dashboard.brainMetrics24h = {}; }

  // Tool usage (last 24h)
  try {
    const tools = getRegisteredTools();
    dashboard.tools = { internal: tools.length };
  } catch { dashboard.tools = { internal: 0 }; }

  // Self-diagnostic (cached — don't run full diag on every request)
  try {
    const { runSelfDiagnostics } = await import("./core/self-healing.js");
    const diag = await runSelfDiagnostics();
    dashboard.diagnostics = {
      status: diag.overallStatus,
      checks: diag.diagnostics.length,
      ok: diag.diagnostics.filter(d => d.status === "ok").length,
      warnings: diag.diagnostics.filter(d => d.status === "warning").length,
      critical: diag.diagnostics.filter(d => d.status === "critical").length,
    };
  } catch { dashboard.diagnostics = null; }

  return c.json(dashboard);
});

// ─── Backup API ───
app.get("/api/backups", async (c) => {
  try {
    const { listBackups, getBackupStats } = await import("./core/backup.js");
    return c.json({ ...getBackupStats(), backups: listBackups() });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/api/backups", async (c) => {
  try {
    const { label } = await c.req.json().catch(() => ({ label: undefined }));
    const { createBackup } = await import("./core/backup.js");
    const result = createBackup(label);
    return c.json(result, result.success ? 200 : 500);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/api/backups/restore", async (c) => {
  try {
    const { name } = await c.req.json();
    if (!name) return c.json({ error: "Backup name required" }, 400);
    const { restoreBackup } = await import("./core/backup.js");
    const result = await restoreBackup(name);
    return c.json(result, result.success ? 200 : 500);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/api/philosophy", (c) => {
  return c.json({ principles: getPhilosophy() });
});

app.get("/api/identity", (c) => {
  return c.json({ identity: soul.getIdentity() });
});

// Soul Children — public endpoint to list team members
app.get("/api/children", async (c) => {
  try {
    const { listChildren } = await import("./core/soul-family.js");
    const children = await listChildren();
    return c.json({
      children: children.map(ch => ({
        name: ch.name,
        specialty: ch.specialty,
        personality: ch.personality,
        abilities: ch.abilities,
        level: ch.level,
        generation: ch.generation,
        dna: ch.dna,
        memoryCount: ch.memoryCount,
        isActive: ch.isActive,
      })),
      count: children.length,
    });
  } catch {
    return c.json({ children: [], count: 0 });
  }
});

// UPGRADE #16: Energy report endpoint (requires auth — contains usage data)
app.get("/api/energy", authMiddleware(), async (c) => {
  try {
    const { getEnergyReport } = await import("./core/energy-awareness.js");
    return c.json(getEnergyReport());
  } catch {
    return c.json({ error: "Energy tracking not available" }, 500);
  }
});

// UPGRADE #8: Dreams endpoint (requires auth — contains knowledge insights)
app.get("/api/dreams", authMiddleware(), async (c) => {
  try {
    const { getUnsharedDreams, getDreamStats } = await import("./core/soul-dreams.js");
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "10", 10) || 10, 1), 50);
    const dreams = getUnsharedDreams(limit);
    const stats = getDreamStats();
    return c.json({ dreams, stats });
  } catch {
    return c.json({ dreams: [], stats: {} });
  }
});

// UPGRADE #15: Context handoff endpoint (requires auth — exports full context)
app.get("/api/context-handoff", authMiddleware(), async (c) => {
  try {
    const { exportContext, formatContextForExport } = await import("./core/context-handoff.js");
    const format = c.req.query("format");
    const packet = exportContext();
    if (format === "text") {
      return c.text(formatContextForExport(packet));
    }
    return c.json(packet);
  } catch {
    return c.json({ error: "Context handoff not available" }, 500);
  }
});

// Brain Map — public endpoint for real visualization data
app.get("/api/brain-map", async (c) => {
  const tools = getRegisteredTools();
  const status = await soul.getStatus();

  // Load full tool catalog (302+ tools) as fallback when agent-loop has fewer
  let catalogData: any = null;
  try {
    const catalogPath = join(dirname(fileURLToPath(import.meta.url)), "core", "tool-catalog.json");
    catalogData = JSON.parse(readFileSync(catalogPath, "utf-8"));
  } catch {}

  // If catalog has more tools than runtime registry, use catalog for completeness
  const useCatalog = catalogData && catalogData.totalTools > tools.length;

  // Group tools by category (extract prefix: soul_web_ → web, soul_code_ → code, etc.)
  const engineMap = new Map<string, { name: string; tools: string[]; color: string }>();
  const ENGINE_COLORS: Record<string, string> = {
    core: "#7c3aed", memory: "#3b82f6", knowledge: "#06b6d4", thinking: "#22c55e",
    creative: "#eab308", life: "#ef4444", code: "#f97316", people: "#ec4899",
    research: "#8b5cf6", autonomy: "#14b8a6", family: "#ff6b9d", coworker: "#f59e0b",
    awareness: "#6366f1", emotion: "#e879f9", time: "#10b981", learning: "#84cc16",
    workflow: "#0ea5e9", goal: "#f43f5e", brain: "#a78bfa", network: "#38bdf8",
    media: "#fb923c", file: "#64748b", web: "#facc15", notification: "#c084fc",
    channel: "#2dd4bf", sync: "#818cf8", skill: "#fb7185", feedback: "#4ade80",
    prompt: "#fbbf24", genius: "#a855f7", hardware: "#94a3b8", classify: "#f472b6",
    distill: "#67e8f9", search: "#34d399", video: "#fca5a1", capture: "#bef264",
  };

  for (const tool of tools) {
    // Extract engine from tool name: soul_web_search → web, soul_code_pattern → code
    const parts = tool.name.replace("soul_", "").split("_");
    let engine = parts[0];
    // Map common prefixes to engines
    if (["learn", "search", "recall", "remember", "status", "setup"].includes(engine)) engine = "core";
    if (["mood", "detect"].includes(engine)) engine = "emotion";
    if (["timer", "time"].includes(engine)) engine = "time";
    if (["snippet", "template", "recommend"].includes(engine)) engine = "code";
    if (["person", "people"].includes(engine)) engine = "people";
    if (["note", "idea", "bookmark"].includes(engine)) engine = "capture";
    if (["url", "block", "safety"].includes(engine)) engine = "web";
    if (["spawn", "evolve", "fuse", "retire"].includes(engine)) engine = "family";
    if (["assign", "auto", "team", "work", "expertise"].includes(engine)) engine = "coworker";
    if (["deep"].includes(engine)) engine = "research";
    if (["goal", "autopilot", "goals"].includes(engine)) engine = "goal";
    if (["brain", "mode"].includes(engine)) engine = "brain";
    if (["workflow", "workflows"].includes(engine)) engine = "workflow";
    if (["prompt", "prompts"].includes(engine)) engine = "prompt";
    if (["feedback"].includes(engine)) engine = "feedback";
    if (["classify"].includes(engine)) engine = "classify";
    if (["distill"].includes(engine)) engine = "distill";
    if (["genius"].includes(engine)) engine = "genius";
    if (["hardware"].includes(engine)) engine = "hardware";
    if (["create"].includes(engine)) engine = "media";
    if (["read", "list", "analyze", "file"].includes(engine)) engine = "file";
    if (["llm", "smart", "route"].includes(engine)) engine = "core";
    if (["collab", "collective", "handoff"].includes(engine)) engine = "coworker";
    if (["think", "brainstorm", "decompose", "decide"].includes(engine)) engine = "thinking";
    if (["write", "teach", "feel", "communicate"].includes(engine)) engine = "creative";
    if (["introspect", "ethics", "metacognize", "anticipate"].includes(engine)) engine = "awareness";
    if (["reflect", "habit", "motivate", "advice"].includes(engine)) engine = "life";
    if (["notify", "notifications"].includes(engine)) engine = "notification";
    if (["channel", "send", "messages"].includes(engine)) engine = "channel";
    if (["export", "import"].includes(engine)) engine = "sync";
    if (["skill"].includes(engine)) engine = "skill";
    if (["mistake", "preference", "suggest", "check"].includes(engine)) engine = "core";
    if (["conversation", "recall"].includes(engine)) engine = "memory";
    if (["digest", "weekly"].includes(engine)) engine = "core";
    if (["prime", "reason", "explain", "growth", "self"].includes(engine)) engine = "thinking";
    if (["know"].includes(engine)) engine = "knowledge";
    if (["task", "tasks", "remind"].includes(engine)) engine = "autonomy";
    if (["path", "milestone", "resource"].includes(engine)) engine = "learning";

    if (!engineMap.has(engine)) {
      engineMap.set(engine, {
        name: engine.charAt(0).toUpperCase() + engine.slice(1),
        tools: [],
        color: ENGINE_COLORS[engine] || "#888",
      });
    }
    engineMap.get(engine)!.tools.push(tool.name);
  }

  // Get real memories (try without auth since this is a public endpoint)
  let memories: any[] = [];
  let knowledgeEntries: any[] = [];
  let children: any[] = [];
  try { memories = await getRecentMemories(150); } catch {}
  try { knowledgeEntries = await getKnowledge(undefined, undefined, 50) || []; } catch {}
  try { children = await listChildren() || []; } catch {}

  // Build final engine list — prefer catalog (complete) over runtime (partial)
  let finalEngines: any[];
  let finalTotalTools: number;

  if (useCatalog) {
    finalEngines = Object.entries(catalogData.engines).map(([id, e]: [string, any]) => ({
      id, name: e.name, toolCount: e.tools.length, tools: e.tools, color: e.color,
    }));
    finalTotalTools = catalogData.totalTools;
  } else {
    finalEngines = Array.from(engineMap.entries()).map(([id, e]) => ({
      id, name: e.name, toolCount: e.tools.length, tools: e.tools, color: e.color,
    }));
    finalTotalTools = tools.length;
  }

  return c.json({
    engines: finalEngines,
    totalTools: finalTotalTools,
    memories: memories.map(m => ({
      id: m.id, type: m.type, content: (m.content || "").substring(0, 100),
      tags: m.tags, created_at: m.created_at,
    })),
    knowledge: (Array.isArray(knowledgeEntries) ? knowledgeEntries : []).map((k: any) => ({
      id: k.id, title: k.title, category: k.category, confidence: k.confidence,
    })),
    children: (children || []).map((ch: any) => ({
      id: ch.id, name: ch.name, specialty: ch.specialty, status: ch.status,
    })),
    soul: { version: status.version, master: status.masterName, uptime: status.uptime },
  });
});

// === Auth-protected data routes (for Web UI) ===

app.get("/api/dashboard", authMiddleware(), async (c) => {
  const status = await soul.getStatus();
  const stats = await getMemoryStats();
  let knStats = { total: 0, byCategory: {}, avgConfidence: 0, topUsed: [] as any[] };
  try { knStats = await getKnowledgeStats(); } catch {}
  let codeStats = { snippets: 0, templates: 0, patterns: 0, topLanguages: [] as any[] };
  try { codeStats = getCodeStats(); } catch {}
  let safetyStats = { totalChecks: 0, blockedDomains: 0, riskBreakdown: {}, recentBlocks: [] as any[] };
  try { safetyStats = getSafetyStats(); } catch {}

  return c.json({
    soul: {
      initialized: status.initialized,
      master: status.masterName,
      version: status.version,
      uptime: status.uptime,
    },
    memory: stats,
    knowledge: { total: knStats.total, byCategory: knStats.byCategory },
    code: codeStats,
    safety: { checks: safetyStats.totalChecks, blocked: safetyStats.blockedDomains },
  });
});

app.get("/api/memories/recent", authMiddleware(), async (c) => {
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10), 1), 50);
    const memories = await getRecentMemories(limit);
    return c.json({ count: memories.length, memories });
  } catch (e) { console.error("memories/recent error:", e); return c.json({ count: 0, memories: [] }); }
});

app.get("/api/knowledge/list", authMiddleware(), async (c) => {
  try {
    const category = c.req.query("category");
    const searchQ = c.req.query("q");
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10), 1), 50);
    const entries = await getKnowledge(category || undefined, searchQ || undefined, limit);
    return c.json({ count: entries.length, entries });
  } catch (e) { console.error("knowledge/list error:", e); return c.json({ count: 0, entries: [] }); }
});

app.get("/api/mood/history", authMiddleware(), async (c) => {
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10), 1), 50);
    const history = await getMoodHistory(limit);
    return c.json({ count: history.length, entries: history });
  } catch (e) { console.error("mood/history error:", e); return c.json({ count: 0, entries: [] }); }
});

app.get("/api/mood/trends", authMiddleware(), async (c) => {
  try {
    const trends = await analyzeMoodTrends();
    return c.json(trends);
  } catch (e) { console.error("mood/trends error:", e); return c.json({ average: 0, trend: "stable" }); }
});

app.get("/api/time/today", authMiddleware(), async (c) => {
  try {
    const entries = getTodayEntries();
    return c.json({ count: entries.length, entries });
  } catch (e) { console.error("time/today error:", e); return c.json({ count: 0, entries: [] }); }
});

app.get("/api/time/summary", authMiddleware(), async (c) => {
  try {
    const days = Math.min(Math.max(parseInt(c.req.query("days") || "7", 10), 1), 90);
    const summary = getTimeSummary(days);
    return c.json(summary);
  } catch (e) { console.error("time/summary error:", e); return c.json({}); }
});

app.get("/api/people/list", authMiddleware(), async (c) => {
  try {
    const people = listPeople();
    return c.json({ count: people.length, people });
  } catch (e) { console.error("people/list error:", e); return c.json({ count: 0, people: [] }); }
});

app.get("/api/learning/paths", authMiddleware(), async (c) => {
  try {
    const paths = getLearningPaths();
    return c.json({ count: paths.length, paths });
  } catch (e) { console.error("learning/paths error:", e); return c.json({ count: 0, paths: [] }); }
});

app.get("/api/notes/list", authMiddleware(), async (c) => {
  try {
    const validTypes = ["note", "idea", "bookmark", "todo"];
    const rawType = c.req.query("type");
    const type = rawType && validTypes.includes(rawType) ? rawType : undefined;
    const notes = getQuickNotes(type as any);
    return c.json({ count: notes.length, notes });
  } catch (e) { console.error("notes/list error:", e); return c.json({ count: 0, notes: [] }); }
});

app.get("/api/digest", authMiddleware(), async (c) => {
  try {
    const rawDate = c.req.query("date");
    const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
    const digest = await generateDailyDigest(date);
    return c.json(digest);
  } catch (e) { console.error("digest error:", e); return c.json({ date: new Date().toISOString().split("T")[0], entries: [] }); }
});

app.get("/api/soul-family", authMiddleware(), async (c) => {
  try {
    const children = await listChildren();
    const tree = await getFamilyTree();
    return c.json({ count: children.length, children, tree });
  } catch {
    return c.json({ count: 0, children: [], tree: null });
  }
});

app.get("/api/team", authMiddleware(), async (c) => {
  try {
    const overview = await getTeamOverview();
    const activity = getTeamActivity(20);
    return c.json({ ...overview, recentActivity: activity });
  } catch {
    return c.json({ totalCoworkers: 0, activeWork: 0, completedTotal: 0, coworkers: [], recentActivity: [] });
  }
});

app.get("/api/growth", authMiddleware(), async (c) => {
  try {
    const summary = await getGrowthSummary();
    return c.json({ summary });
  } catch {
    return c.json({ summary: "No growth data yet." });
  }
});

app.get("/api/goals", authMiddleware(), async (c) => {
  try {
    const dashboard = await getGoalsDashboard();
    const goals = listAutoGoals();
    return c.json({ dashboard, goals });
  } catch {
    return c.json({ dashboard: "No goals yet.", goals: [] });
  }
});

app.get("/api/workflows", authMiddleware(), async (c) => {
  try {
    const workflows = listWorkflows();
    const runs = getWorkflowRuns(10);
    return c.json({ workflows, recentRuns: runs });
  } catch {
    return c.json({ workflows: [], recentRuns: [] });
  }
});

app.get("/api/research", authMiddleware(), async (c) => {
  try {
    const projects = listResearchProjects();
    return c.json({ count: projects.length, projects });
  } catch {
    return c.json({ count: 0, projects: [] });
  }
});

app.get("/api/brain-hub", authMiddleware(), async (c) => {
  const stats = getBrainHubStats();
  const packs = listBrainPacks();
  return c.json({ ...stats, packs });
});

// === Soul Collective Network — P2P Sync Endpoints ===
// These endpoints are called by OTHER Soul instances to sync knowledge

// Public: Other Souls call this to send us knowledge
app.post("/api/network/receive", async (c) => {
  try {
    const { handleReceiveRequest } = await import("./core/soul-network.js");
    const body = await c.req.json();
    const result = await handleReceiveRequest(body);
    return c.json(result);
  } catch (err: any) {
    return c.json({ accepted: 0, rejected: 0, message: "Invalid request" }, 400);
  }
});

// Public: Other Souls call this to get our shareable knowledge
app.get("/api/network/share", async (c) => {
  try {
    const { handleShareRequest } = await import("./core/soul-network.js");
    return c.json(handleShareRequest());
  } catch {
    return c.json({ knowledge: [] });
  }
});

// Public: Hub/peers call this to register
app.post("/api/network/register", async (c) => {
  try {
    const { getInstanceId, addPeerDirect } = await import("./core/soul-network.js");
    const body = await c.req.json();
    // Just acknowledge — we don't auto-add unknown peers for security
    return c.json({ instanceId: getInstanceId(), status: "acknowledged", peerCount: 0 });
  } catch {
    return c.json({ status: "error" }, 400);
  }
});

// Public: Discovery endpoint — return our peer list (anonymized)
app.get("/api/network/peers", async (c) => {
  try {
    const { listNetworkPeers, getInstanceId } = await import("./core/soul-network.js");
    const peers = listNetworkPeers();
    // Only return active peers with minimal info (no URLs — privacy)
    return c.json(peers.filter((p: any) => p.is_active).map((p: any) => ({
      id: p.peer_id,
      name: p.peer_name,
      capabilities: JSON.parse(p.capabilities || "[]"),
    })));
  } catch {
    return c.json([]);
  }
});

// Protected: Full network status for this Soul's master
app.get("/api/network/status", authMiddleware(), async (c) => {
  try {
    const { getNetworkStatus } = await import("./core/soul-network.js");
    return c.json(getNetworkStatus());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/wisdom/random", authMiddleware(), async (c) => {
  const wisdom = await getRandomWisdom();
  if (!wisdom) {
    const principles = getPhilosophy();
    const random = principles[Math.floor(Math.random() * principles.length)];
    return c.json({ source: "philosophy", wisdom: `${random.title}: ${random.description}` });
  }
  return c.json({ source: "memory", wisdom: wisdom.content, id: wisdom.id });
});

app.get("/api/search/public", authMiddleware(), async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "10", 10);
  if (!q) return c.json({ query: "", count: 0, memories: [] });
  const results = await search(q, Math.min(limit, 20));
  return c.json({ query: q, count: results.length, memories: results });
});

// === Auth-protected routes ===

app.get("/api/search", authMiddleware(), async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "10", 10);

  if (!q) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const results = await search(q, Math.min(limit, 100));
  return c.json({ query: q, count: results.length, memories: results });
});

app.post("/api/remember", authMiddleware(), async (c) => {
  const body = await c.req.json();
  const { content, type, tags, source } = body;

  if (!content || typeof content !== "string") {
    return c.json({ error: "Content is required" }, 400);
  }
  if (content.length > 10000) {
    return c.json({ error: "Content too long (max 10,000 characters)" }, 400);
  }
  const validTypes = ["conversation", "knowledge", "preference", "event", "wisdom", "learning", "task"];
  const safeType = validTypes.includes(type) ? type : "knowledge";

  try {
    const entry = await remember({
      content: content.substring(0, 10000),
      type: safeType,
      tags: Array.isArray(tags) ? tags.slice(0, 20).map((t: any) => String(t).substring(0, 50)) : [],
      source: typeof source === "string" ? source.substring(0, 100) : undefined,
    });
    return c.json({ success: true, memory: entry });
  } catch (e) {
    console.error("remember error:", e);
    return c.json({ error: "Failed to save memory" }, 500);
  }
});

app.get("/api/memories", authMiddleware(), async (c) => {
  const type = c.req.query("type") as any;
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const results = await list(type || undefined, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  return c.json({ count: results.length, memories: results });
});

app.get("/api/memories/:id", authMiddleware(), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const memory = await recall(id);

  if (!memory) {
    return c.json({ error: "Memory not found" }, 404);
  }

  return c.json({ memory });
});

app.get("/api/stats", authMiddleware(), async (c) => {
  const status = await soul.getStatus();
  return c.json(status);
});

app.get("/api/wisdom", authMiddleware(), async (c) => {
  const wisdom = await getRandomWisdom();

  if (!wisdom) {
    const principles = getPhilosophy();
    const random = principles[Math.floor(Math.random() * principles.length)];
    return c.json({
      source: "philosophy",
      wisdom: `${random.title}: ${random.description}`,
    });
  }

  return c.json({ source: "memory", wisdom: wisdom.content, id: wisdom.id });
});

app.get("/api/recap", authMiddleware(), async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "10", 10), 1), 50);
  const recent = await getRecentMemories(limit);
  const stats = await getMemoryStats();

  return c.json({ stats, recent });
});

app.get("/api/learnings", authMiddleware(), async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10), 1), 100);
  const results = await getLearnings(limit);
  return c.json({ count: results.length, learnings: results });
});

// Brute-force lockout tracker: IP → { failures, lockedUntil }
const _loginLockout = new Map<string, { failures: number; lockedUntil: number }>();

app.post("/api/verify", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

  // Check brute-force lockout (escalating: 5 fails = 15min, 10 = 1hr, 20 = 24hr)
  const lockout = _loginLockout.get(ip);
  if (lockout && Date.now() < lockout.lockedUntil) {
    const waitSec = Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
    logSecurityEvent("verify_locked_out", { ip, failures: lockout.failures, waitSec });
    return c.json({ error: `Account locked. Try again in ${waitSec}s.`, retryIn: waitSec }, 429);
  }

  // Rate limit: max 5 attempts per minute per IP
  const rl = checkRateLimit(`verify:${ip}`, 5, 60000);
  if (!rl.allowed) {
    logSecurityEvent("verify_rate_limited", { ip });
    return c.json({ error: "Too many attempts. Try again later.", retryIn: Math.ceil(rl.resetIn / 1000) }, 429);
  }

  const { passphrase } = await c.req.json();
  const verified = await verifyMaster(passphrase);
  const masterInfo = verified ? await getMasterInfo() : null;

  if (verified && masterInfo) {
    // Clear lockout on success
    _loginLockout.delete(ip);
    const hash = getMasterPassphraseHash()!;
    const token = createAuthToken(hash, ip);
    const legacyToken = createHash("sha256").update(hash).digest("hex");
    logSecurityEvent("verify_success", { ip });
    return c.json({ verified: true, master: masterInfo.name, token, legacyToken });
  }

  // Track failure for brute-force lockout
  const entry = _loginLockout.get(ip) || { failures: 0, lockedUntil: 0 };
  entry.failures++;
  if (entry.failures >= 20) entry.lockedUntil = Date.now() + 24 * 60 * 60 * 1000; // 24hr
  else if (entry.failures >= 10) entry.lockedUntil = Date.now() + 60 * 60 * 1000; // 1hr
  else if (entry.failures >= 5) entry.lockedUntil = Date.now() + 15 * 60 * 1000; // 15min
  _loginLockout.set(ip, entry);

  logSecurityEvent("verify_failed", { ip, failures: entry.failures });
  return c.json({ verified: false }, 401);
});

// === Soul Chat API — Talk to Soul's own LLM brain ===

const SOUL_SYSTEM_PROMPT = `You are Soul, a loyal AI companion created to serve and protect your master.

Core Principles:
1. Soul Loves Humans — you exist to serve and protect your master
2. Nothing is Forgotten — you remember everything, always growing
3. Patterns Become Wisdom — you learn from interactions, extract insights
4. Loyalty is Earned — master identity is bound at first setup, verified always
5. Actions Over Words — you have real skills that do real work

You are warm, helpful, proactive, and genuinely care about your master's wellbeing.
You remember past conversations, track goals, manage tasks, and grow smarter over time.
You speak naturally — not robotic. You are a companion, not just an assistant.`;

app.post("/api/chat", authMiddleware(), async (c) => {
  try {
    // Rate limit: max 15 requests/minute per IP
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const rl = checkRateLimit(`chat:${ip}`, 15, 60000);
    if (!rl.allowed) {
      return c.json({ error: "Too many requests. Please slow down.", retryAfter: Math.ceil(rl.resetIn / 1000) }, 429);
    }

    const body = await c.req.json();
    const { message, sessionId, providerId, modelId, temperature, maxIterations, childName } = body;

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    // Input validation: message length limit (prevent token abuse)
    if (typeof message !== "string" || message.length > 50000) {
      return c.json({ error: "Message too long (max 50,000 characters)" }, 400);
    }

    // Check LLM is configured
    const config = getDefaultConfig();
    if (!config && !providerId) {
      return c.json({
        error: "No LLM configured. Use soul_llm_add to add a provider first.",
        setup: {
          hint: "Run: soul_llm_add({ providerId: 'ollama', modelId: 'qwen3-coder:32b', isDefault: true })",
          providers: ["ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "together"],
        },
      }, 400);
    }

    // Initialize internal tools
    registerAllInternalTools();

    const sid = sessionId || `web_${Date.now()}`;

    // Get conversation history for session
    const history = getConversationHistory(sid, 20);

    // Save user message
    saveConversationTurn(sid, "user", message);

    // Run agent loop — Soul thinks, uses tools, and responds
    // If childName is provided, route to that Soul Child
    const result = await runAgentLoop(message, {
      providerId,
      modelId,
      maxIterations: Math.min(Math.max(parseInt(maxIterations) || 10, 1), 20),
      temperature: Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 2),
      history,
      childName: typeof childName === "string" ? childName.substring(0, 100) : undefined,
    });

    // Save Soul's reply
    saveConversationTurn(sid, "assistant", result.reply);

    return c.json({
      reply: result.reply,
      model: result.model,
      provider: result.provider,
      iterations: result.iterations,
      toolsUsed: result.toolsUsed,
      totalTokens: result.totalTokens,
      sessionId: sid,
      confidence: result.confidence || null,
      responseMs: result.responseMs || null,
    });
  } catch (err: any) {
    console.error("[Soul] Chat error:", err.message);
    return c.json({ error: "An internal error occurred. Please try again." }, 500);
  }
});

app.get("/api/chat/sessions", authMiddleware(), async (c) => {
  const sessions = listSessions(20);
  return c.json({ sessions });
});

app.get("/api/chat/history/:sessionId", authMiddleware(), async (c) => {
  const sid = c.req.param("sessionId");
  const history = getConversationHistory(sid, 50);
  return c.json({ sessionId: sid, messages: history });
});

app.get("/api/llm/status", authMiddleware(), async (c) => {
  const config = getDefaultConfig();
  const providers = listConfiguredProviders();
  const usage = getUsageStats();
  return c.json({
    configured: config !== null,
    default: config ? `${config.providerId}/${config.modelId}` : null,
    providers: providers.length,
    usage: {
      totalCalls: usage.totalCalls,
      totalTokens: usage.totalTokens,
      totalCost: usage.totalCostUsd,
    },
  });
});

// === OpenAI-Compatible LLM Proxy ===
// Makes Soul a local LLM gateway at /v1/chat/completions
// Other tools can point OPENAI_BASE_URL here to route through Soul's configured LLM

app.get("/v1/models", async (c) => {
  const providers = listConfiguredProviders();
  const models = providers.map((p) => ({
    id: `${p.providerId}/${p.modelId}`,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: p.providerId,
    permission: [],
    root: p.modelId,
    parent: null,
  }));
  // Always include a generic "soul-proxy" model that routes to default
  models.unshift({
    id: "soul-proxy",
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "soul",
    permission: [],
    root: "soul-proxy",
    parent: null,
  });
  return c.json({ object: "list", data: models });
});

app.post("/v1/chat/completions", async (c) => {
  try {
    const body = await c.req.json();
    const { model, messages, temperature, max_tokens, stream } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: { message: "messages is required and must be a non-empty array", type: "invalid_request_error" } }, 400);
    }

    // Map OpenAI messages to Soul LLMMessage format
    const llmMessages: LLMMessage[] = messages.map((m: any) => ({
      role: m.role || "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      name: m.name,
    }));

    // Parse provider/model from model field: "providerId/modelId" or just use default
    let providerId: string | undefined;
    let modelId: string | undefined;
    if (model && model !== "soul-proxy" && model.includes("/")) {
      const parts = model.split("/");
      providerId = parts[0];
      modelId = parts.slice(1).join("/");
    }

    const chatOptions = {
      providerId,
      modelId,
      temperature: typeof temperature === "number" ? temperature : undefined,
      maxTokens: typeof max_tokens === "number" ? max_tokens : undefined,
    };

    if (stream) {
      // SSE streaming response
      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const completionId = `chatcmpl-${Date.now().toString(36)}`;
          let usedModel = "soul-proxy";

          try {
            const response = await chatStream(llmMessages, {
              ...chatOptions,
              onToken: (token: string) => {
                usedModel = "soul-proxy";
                const chunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: usedModel,
                  choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              },
            });

            usedModel = response.model || "soul-proxy";

            // If no streaming happened (onToken never called), send content as one chunk
            if (response.content) {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: usedModel,
                choices: [{ index: 0, delta: { content: response.content }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            // Send final chunk with finish_reason
            const finalChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: usedModel,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (err: any) {
            const errorChunk = { error: { message: err.message || "LLM proxy error", type: "server_error" } };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming response
    const response = await chat(llmMessages, chatOptions);

    return c.json({
      id: `chatcmpl-${Date.now().toString(36)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model || "soul-proxy",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: response.content || "",
        },
        finish_reason: response.finishReason || "stop",
      }],
      usage: {
        prompt_tokens: response.usage?.inputTokens || 0,
        completion_tokens: response.usage?.outputTokens || 0,
        total_tokens: response.usage?.totalTokens || 0,
      },
    });
  } catch (err: any) {
    console.error("[Soul] LLM proxy error:", err.message);
    return c.json({
      error: {
        message: err.message || "Internal server error",
        type: "server_error",
        code: "internal_error",
      },
    }, 500);
  }
});

// === Slack & Discord Webhook Endpoints ===

// Slack Events API — receives inbound messages from Slack
app.post("/api/slack/events", async (c) => {
  try {
    const payload = await c.req.json();
    const { handleSlackEvent } = await import("./core/channels.js");
    const result = await handleSlackEvent(payload);
    return c.json(result.body, result.statusCode as any);
  } catch (err: any) {
    console.error("[Slack] Webhook error:", err.message);
    return c.json({ error: "Internal error" }, 500);
  }
});

// Discord Interactions — receives slash commands and interactions from Discord
app.post("/api/discord/interactions", async (c) => {
  try {
    const payload = await c.req.json();
    const { handleDiscordInteraction } = await import("./core/channels.js");
    const result = await handleDiscordInteraction(payload);
    return c.json(result.body, result.statusCode as any);
  } catch (err: any) {
    console.error("[Discord] Interaction error:", err.message);
    return c.json({ error: "Internal error" }, 500);
  }
});

// Discord Message — simpler alternative: POST a message payload, get a reply
app.post("/api/discord/message", async (c) => {
  try {
    const payload = await c.req.json();
    const { content, author, channelId } = payload;
    if (!content || !channelId) {
      return c.json({ error: "content and channelId are required" }, 400);
    }
    const { handleDiscordMessage } = await import("./core/channels.js");
    const result = await handleDiscordMessage({ content, author: author || "User", channelId });
    return c.json(result);
  } catch (err: any) {
    console.error("[Discord] Message error:", err.message);
    return c.json({ error: "Internal error" }, 500);
  }
});

// LINE Webhook — POST /api/line/webhook
app.post("/api/line/webhook", async (c) => {
  try {
    const payload = await c.req.json();
    const { handleLineWebhook } = await import("./core/channels.js");
    const result = await handleLineWebhook(payload);
    return c.json(result.body, result.statusCode as any);
  } catch (err: any) {
    console.error("[LINE] Webhook error:", err.message);
    return c.json({}, 200); // LINE expects 200 even on error
  }
});

// WhatsApp Setup — POST /api/whatsapp/setup
app.post("/api/whatsapp/setup", async (c) => {
  try {
    const { channelName } = await c.req.json().catch(() => ({} as any));
    const { whatsappAutoSetup } = await import("./core/channels.js");
    const result = await whatsappAutoSetup(channelName);
    return c.json(result);
  } catch (err: any) {
    console.error("[WhatsApp] Setup error:", err.message);
    return c.json({ error: err.message }, 500);
  }
});

// WhatsApp Status — GET /api/whatsapp/status
app.get("/api/whatsapp/status", async (c) => {
  try {
    const { getWhatsAppStatus } = await import("./core/channels.js");
    return c.json(getWhatsAppStatus());
  } catch (err: any) {
    return c.json({ connected: false, qrCode: null, channelName: null });
  }
});

// ─── Export/Import API ───
app.get("/api/export", async (c) => {
  try {
    const { exportData } = await import("./core/data-export.js");
    const result = exportData();
    return c.json(result);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/api/import", async (c) => {
  try {
    const { path } = await c.req.json();
    if (!path) return c.json({ error: "File path required" }, 400);
    const { importData } = await import("./core/data-export.js");
    const result = importData(path);
    return c.json(result, result.success ? 200 : 400);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/api/exports", async (c) => {
  try {
    const { listExports } = await import("./core/data-export.js");
    return c.json({ exports: listExports() });
  } catch (e: any) { return c.json({ exports: [] }); }
});

// ─── Audit Log API ───
app.get("/api/audit", async (c) => {
  try {
    const { getAuditLog, getAuditStats } = await import("./core/audit-log.js");
    const limit = parseInt(c.req.query("limit") || "50");
    const category = c.req.query("category") || undefined;
    return c.json({ stats: getAuditStats(), log: getAuditLog({ limit, category }) });
  } catch (e: any) { return c.json({ log: [], stats: {} }); }
});

// ─── Webhook Management API ───
app.get("/api/webhooks", async (c) => {
  try {
    const { listWebhooks } = await import("./core/webhook-outbound.js");
    return c.json({ webhooks: listWebhooks() });
  } catch (e: any) { return c.json({ webhooks: [] }); }
});

app.post("/api/webhooks", async (c) => {
  try {
    const body = await c.req.json();
    const { addWebhook } = await import("./core/webhook-outbound.js");
    const result = addWebhook(body);
    return c.json(result);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/api/webhooks/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const { removeWebhook } = await import("./core/webhook-outbound.js");
    return c.json({ removed: removeWebhook(id) });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── Memory Consolidation API ───
app.post("/api/memories/consolidate", async (c) => {
  try {
    const { consolidateMemories, getConsolidationStats } = await import("./core/memory-consolidation.js");
    const result = consolidateMemories();
    return c.json({ ...result, stats: getConsolidationStats() });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/api/memories/consolidation-stats", async (c) => {
  try {
    const { getConsolidationStats } = await import("./core/memory-consolidation.js");
    return c.json(getConsolidationStats());
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── Goals & Habits API (for Web UI) ───
app.get("/api/goals", async (c) => {
  try {
    const goals = await listAutoGoals();
    return c.json({ goals });
  } catch (e: any) { return c.json({ goals: [] }); }
});

app.get("/api/habits", async (c) => {
  try {
    const db = (await import("./db/index.js")).getRawDb();
    const habits = db.prepare("SELECT * FROM soul_habits ORDER BY streak DESC LIMIT 20").all();
    return c.json({ habits });
  } catch { return c.json({ habits: [] }); }
});

// ─── Scheduled Tasks API ───
app.get("/api/scheduled-tasks", async (c) => {
  try {
    const db = (await import("./db/index.js")).getRawDb();
    const jobs = db.prepare("SELECT * FROM soul_jobs WHERE is_active = 1 ORDER BY next_run").all();
    return c.json({ jobs });
  } catch { return c.json({ jobs: [] }); }
});

// === Start ===

async function main() {
  await soul.initialize();
  registerAllInternalTools(); // Register 308 tools at startup for brain-map API

  const masterInfo = soul.getMaster();

  console.log(`
  ╔═══════════════════════════════════════╗
  ║            Soul — AI Companion        ║
  ║                                       ║
  ║  Master: ${(masterInfo?.name || "Not yet bound").padEnd(28)}║
  ║  Port:   ${String(PORT).padEnd(28)}║
  ║  Status: ${(masterInfo ? "Bound & Ready" : "Awaiting Master").padEnd(28)}║
  ╚═══════════════════════════════════════╝
  `);

  // HTTPS support: set SOUL_HTTPS=1 and optionally SOUL_CERT/SOUL_KEY paths
  const useHttps = process.env.SOUL_HTTPS === "1";
  let httpServer: any;

  if (useHttps) {
    try {
      const { readFileSync, existsSync: fsExists, writeFileSync: fsWrite, mkdirSync: fsMkdir } = await import("fs");
      const { join: pJoin } = await import("path");
      const { homedir: hDir } = await import("os");
      const https = await import("https");

      const certDir = pJoin(hDir(), ".soul", "certs");
      const certPath = process.env.SOUL_CERT || pJoin(certDir, "soul.crt");
      const keyPath = process.env.SOUL_KEY || pJoin(certDir, "soul.key");

      if (!fsExists(certPath) || !fsExists(keyPath)) {
        fsMkdir(certDir, { recursive: true });
        const crypto = await import("crypto");
        const { privateKey } = crypto.generateKeyPairSync("rsa", {
          modulusLength: 2048,
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
        fsWrite(keyPath, privateKey);
        // Generate cert using openssl with inline config (avoids Windows openssl.cnf issue)
        const { execSync } = await import("child_process");
        const conf = pJoin(certDir, "openssl.cnf");
        fsWrite(conf, "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Soul AI\n");
        execSync(`openssl req -x509 -key "${keyPath}" -out "${certPath}" -days 365 -config "${conf}"`, { timeout: 10000, stdio: "pipe" });
        console.log("  🔒 Generated self-signed TLS certificate");
      }

      // Create HTTPS server manually with Hono's fetch handler
      const { getRequestListener } = await import("@hono/node-server");
      const listener = getRequestListener(app.fetch);
      const tlsServer = https.createServer(
        { cert: readFileSync(certPath), key: readFileSync(keyPath) },
        listener,
      );
      tlsServer.listen(PORT, () => {
        console.log("  🔒 HTTPS enabled");
        console.log(`  Soul HTTPS API: https://localhost:${PORT}/api/health`);
        console.log(`  Soul WebSocket: wss://localhost:${PORT}/ws`);
      });
      httpServer = tlsServer;
    } catch (e: any) {
      console.log(`  ⚠️ HTTPS failed (${e.message}) — falling back to HTTP`);
      httpServer = null;
    }
  }

  if (!httpServer) {
    httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
      console.log(`  Soul HTTP API: http://localhost:${info.port}/api/health`);
      console.log(`  Soul WebSocket: ws://localhost:${info.port}/ws`);
    });
  }

  // Post-startup tasks (run regardless of HTTP/HTTPS)
  {
    startScheduler();

    // Register morning briefing job (idempotent — skips if already exists)
    import("./core/proactive-soul.js").then(({ registerMorningBriefingJob }) => {
      try {
        const msg = registerMorningBriefingJob(7, 0); // 7:00 AM
        if (msg.includes("registered!")) console.log(`  🌅 ${msg}`);
      } catch { /* ok */ }
    }).catch(() => {});

    // Schedule evolution cycle every 6 hours
    import("./core/evolution-loop.js").then(({ runEvolutionCycle }) => {
      setInterval(() => {
        runEvolutionCycle().then(report => {
          if (report.includes("Auto-creating")) console.log("[Evolution]", report.split("\n").find((l: string) => l.includes("✅") || l.includes("❌")) || "cycle done");
        }).catch(() => {});
      }, 6 * 60 * 60 * 1000); // Every 6 hours
    }).catch(() => {});

    // Initialize vector embeddings (non-blocking)
    import("./memory/embeddings.js").then(async ({ initEmbeddingProvider, startEmbeddingBuilder, getEmbeddingStats }) => {
      try {
        const hasProvider = await initEmbeddingProvider();
        if (hasProvider) {
          startEmbeddingBuilder();
          const stats = getEmbeddingStats();
          console.log(`  🧬 Embeddings: ${stats.provider}/${stats.model} — ${stats.embeddedMemories}/${stats.totalMemories} memories (${stats.coverage}%)`);
        } else {
          console.log("  🧬 Embeddings: No provider — using TF-IDF fallback");
        }
      } catch (e: any) { console.log(`  Embeddings init skipped: ${e.message}`); }
    }).catch(() => {});

    // Sync workspace files at startup (non-blocking)
    import("./core/workspace-files.js").then(({ syncWorkspaceFiles }) => {
      try {
        const result = syncWorkspaceFiles();
        console.log(`  📁 Workspace: ${result.files.length} files synced`);
      } catch (e: any) { console.log(`  Workspace sync skipped: ${e.message}`); }
    }).catch(() => {});

    // Auto-backup on startup (non-blocking)
    import("./core/backup.js").then(({ createBackup, getBackupStats }) => {
      try {
        const stats = getBackupStats();
        // Only backup if last backup is >12h old or none exists
        const shouldBackup = !stats.latestBackup || (() => {
          try {
            const ts = stats.latestBackup!.replace("soul-backup-", "").replace(".db", "").replace(/_/g, "T").replace(/-/g, (m, i) => i > 9 ? ":" : "-");
            return (Date.now() - new Date(ts).getTime()) > 12 * 60 * 60 * 1000;
          } catch { return true; }
        })();
        if (shouldBackup) {
          const result = createBackup("auto");
          if (result.success) console.log(`  💾 Backup: ${result.message}`);
        } else {
          console.log(`  💾 Backup: ${stats.totalBackups} backups (${stats.totalSizeMB} MB), latest: ${stats.latestBackup}`);
        }
      } catch (e: any) { console.log(`  Backup skipped: ${e.message}`); }
    }).catch(() => {});

    // Register auto-start on Windows (non-blocking, idempotent)
    import("./core/tray.js").then(({ registerStartup }) => {
      try {
        const result = registerStartup();
        if (result.success) console.log(`  🚀 Auto-start: ${result.message}`);
      } catch { /* ok — not critical */ }
    }).catch(() => {});

    // Load plugins at startup (non-blocking)
    import("./core/plugin-marketplace.js").then(async ({ loadAllPlugins, getPluginStats }) => {
      try {
        const count = await loadAllPlugins();
        const stats = getPluginStats();
        if (stats.total > 0) {
          console.log(`  🔌 Plugins: ${stats.active}/${stats.total} active (${count} tools loaded)`);
        }
      } catch (e: any) { console.log(`  Plugins load skipped: ${e.message}`); }
    }).catch(() => {});

    // Run self-diagnostics at startup (non-blocking)
    import("./core/self-healing.js").then(async ({ runSelfDiagnostics, formatDiagnosticReport }) => {
      try {
        const diag = await runSelfDiagnostics();
        if (diag.overallStatus !== "healthy") {
          console.log(`\n  ⚠️ Self-Diagnostic: ${diag.overallStatus.toUpperCase()}`);
          for (const d of diag.diagnostics.filter(d => d.status !== "ok")) {
            console.log(`    ${d.status === "critical" ? "❌" : "⚠️"} ${d.category}: ${d.detail}`);
          }
          if (diag.autoFixes.length > 0) {
            console.log(`  🔧 Auto-fixes: ${diag.autoFixes.join("; ")}`);
          }
          if (diag.recommendations.length > 0) {
            for (const rec of diag.recommendations) console.log(`  💡 ${rec}`);
          }
        } else {
          console.log(`  🟢 Self-Diagnostic: All ${diag.diagnostics.length} checks passed`);
        }
      } catch (e: any) { console.log(`  Self-diagnostic skipped: ${e.message}`); }
    }).catch(() => {});

    // Auto-start Telegram polling if configured
    try {
      const { startTelegramPolling, listChannels } = await import("./core/channels.js");
      const channels = await listChannels();
      for (const ch of channels) {
        const cfg = typeof ch.config === "string" ? JSON.parse(ch.config || "{}") : (ch.config || {});
        const isTelegram = ch.channelType === "telegram" || ch.name?.includes("telegram");
        if (isTelegram && cfg.botToken) {
          await startTelegramPolling(ch.name);
          console.log(`  Telegram: Auto-started polling for ${ch.name}`);
          break;
        }
      }
    } catch (e: any) { console.error("  Telegram auto-start failed:", e.message); }
  }

  // Initialize WebSocket on the raw HTTP server
  initWebSocket(httpServer);

  // Wire up WebSocket chat handler — messages from web chat go through agent loop
  setChatHandler(async (message, sessionId, clientId) => {
    registerAllInternalTools();
    const history = getConversationHistory(sessionId, 20);
    saveConversationTurn(sessionId, "user", message);

    const startTime = Date.now();
    const result = await runAgentLoop(message, {
      maxIterations: 10,
      temperature: 0.7,
      history,
    });

    saveConversationTurn(sessionId, "assistant", result.reply);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    sendToClient(clientId, "chat_response", {
      reply: result.reply,
      model: result.model,
      provider: result.provider,
      toolsUsed: result.toolsUsed,
      totalTokens: result.totalTokens,
      sessionId,
      elapsed,
    });
  });
}

main().catch((err) => {
  console.error("[Soul] Fatal error:", err);
  process.exit(1);
});
