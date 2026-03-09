#!/usr/bin/env node

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { soul } from "./core/soul-engine.js";
import { getPhilosophy } from "./core/philosophy.js";
import { verifyMaster, getMasterInfo, getMasterPassphraseHash } from "./core/master.js";
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
import { getDefaultConfig, listConfiguredProviders, getUsageStats, type LLMMessage } from "./core/llm-connector.js";
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

app.post("/api/verify", async (c) => {
  // Rate limit: max 5 attempts per minute per IP
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const rl = checkRateLimit(`verify:${ip}`, 5, 60000);
  if (!rl.allowed) {
    logSecurityEvent("verify_rate_limited", { ip });
    return c.json({ error: "Too many attempts. Try again later.", retryIn: Math.ceil(rl.resetIn / 1000) }, 429);
  }

  const { passphrase } = await c.req.json();
  const verified = await verifyMaster(passphrase);
  const masterInfo = verified ? await getMasterInfo() : null;

  if (verified && masterInfo) {
    const hash = getMasterPassphraseHash()!;
    // Issue expiring token (24h)
    const token = createAuthToken(hash, ip);
    // Also return legacy token for backward compat
    const legacyToken = createHash("sha256").update(hash).digest("hex");
    logSecurityEvent("verify_success", { ip });
    return c.json({ verified: true, master: masterInfo.name, token, legacyToken });
  }

  logSecurityEvent("verify_failed", { ip });
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

  const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`  Soul HTTP API: http://localhost:${info.port}/api/health`);
    console.log(`  Soul WebSocket: ws://localhost:${info.port}/ws`);
    startScheduler();
  });

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
