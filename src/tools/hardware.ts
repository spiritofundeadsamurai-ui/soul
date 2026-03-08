import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  detectHardware,
  recommendModels,
  recommendForSpecs,
  quickRecommend,
  checkModelUpdates,
  saveHardwareProfile,
  getHardwareProfiles,
  getModelCatalog,
  configureOllamaGpu,
  getOllamaPerformance,
  optimizeOllamaConfig,
} from "../core/hardware-intelligence.js";

export function registerHardwareTools(server: McpServer) {

  // ─── 1. Detect & Recommend (Main Tool) ───

  server.tool(
    "soul_hw_scan",
    "Scan this machine's hardware and recommend the best AI models. Detects CPU, RAM, GPU, installed Ollama models — then recommends optimal models that won't overload your machine.",
    {},
    async () => {
      const { topPick, alternatives, hardware, summary } = quickRecommend();

      // Save profile
      const machineName = hardware.cpu.name.split(" ").slice(-2).join(" ") || "local";
      const recs = recommendModels(hardware);
      saveHardwareProfile(machineName, hardware, recs);

      let text = `╔════════════════════════════════════════════╗\n`;
      text += `║       HARDWARE INTELLIGENCE SCAN            ║\n`;
      text += `╠════════════════════════════════════════════╣\n`;
      text += `║  OS:   ${hardware.os.padEnd(35)}║\n`;
      text += `║  CPU:  ${hardware.cpu.name.substring(0, 35).padEnd(35)}║\n`;
      text += `║  Cores: ${String(hardware.cpu.cores + "C/" + hardware.cpu.threads + "T").padEnd(34)}║\n`;
      text += `║  RAM:  ${(hardware.ram.totalGB + " GB").padEnd(35)}║\n`;
      if (hardware.gpu) {
        text += `║  GPU:  ${hardware.gpu.name.substring(0, 35).padEnd(35)}║\n`;
        text += `║  VRAM: ${(hardware.gpu.vramGB + " GB (" + hardware.gpu.type + ")").padEnd(35)}║\n`;
      } else {
        text += `║  GPU:  ${"None detected".padEnd(35)}║\n`;
      }
      text += `║  Ollama: ${(hardware.ollamaInstalled ? "v" + hardware.ollamaVersion : "Not installed").padEnd(33)}║\n`;
      text += `╠════════════════════════════════════════════╣\n`;
      text += `║  INSTALLED MODELS:                          ║\n`;
      if (hardware.installedModels.length === 0) {
        text += `║  (none)                                     ║\n`;
      } else {
        for (const m of hardware.installedModels) {
          text += `║  • ${(m.name + " (" + m.sizeGB + "GB)").padEnd(38)}║\n`;
        }
      }
      text += `╠════════════════════════════════════════════╣\n`;
      text += `║  TOP RECOMMENDATION:                        ║\n`;
      text += `║  ★ ${topPick.displayName.padEnd(38)}║\n`;
      text += `║    Score: ${String(topPick.score + "/100").padEnd(32)}║\n`;
      text += `║    Size: ${(topPick.sizeGB + "GB, needs " + topPick.ramRequired + "GB RAM").padEnd(33)}║\n`;
      text += `║    Speed: ${topPick.speed.padEnd(31)}║\n`;
      text += `║    Quality: ${topPick.quality.padEnd(30)}║\n`;
      text += `║    Tools: ${(topPick.supportsTools ? "Yes" : "No").padEnd(32)}║\n`;
      text += `║    Install: ${topPick.installCmd.padEnd(30)}║\n`;
      text += `╠════════════════════════════════════════════╣\n`;
      text += `║  ALTERNATIVES:                              ║\n`;
      for (const alt of alternatives) {
        text += `║  • ${alt.displayName.padEnd(22)} ${String(alt.score).padStart(3)}/100  ${alt.installCmd.padEnd(10)}║\n`;
      }
      text += `╚════════════════════════════════════════════╝\n`;

      // RAM budget warning
      const ramUsedByModel = topPick.ramRequired;
      const ramLeftForSystem = hardware.ram.totalGB - ramUsedByModel;
      if (ramLeftForSystem < 4) {
        text += `\n⚠️ WARNING: Only ${ramLeftForSystem}GB left for other apps. Consider a smaller model.`;
      } else if (ramLeftForSystem < 8) {
        text += `\n💡 ${ramLeftForSystem}GB left for other apps — OK but may slow down.`;
      } else {
        text += `\n✅ ${ramLeftForSystem}GB free for other apps — comfortable.`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 2. Recommend for Another Machine ───

  server.tool(
    "soul_hw_recommend",
    "Recommend models for a specific machine (not this one). Tell me the RAM and GPU.",
    {
      ramGB: z.number().describe("Total RAM in GB"),
      gpuVRAM: z.number().default(0).describe("GPU VRAM in GB (0 if no GPU)"),
      gpuType: z.enum(["nvidia", "amd", "intel", "apple", "none"]).default("none").describe("GPU type"),
      machineName: z.string().optional().describe("Name for this machine (e.g. 'office-pc', 'macbook-m2')"),
    },
    async ({ ramGB, gpuVRAM, gpuType, machineName }) => {
      const recs = recommendForSpecs(ramGB, gpuVRAM, gpuType);
      const top = recs.filter(r => r.supportsTools).slice(0, 5);

      // Save profile if named
      if (machineName) {
        const fakeHW = {
          os: "unknown", cpu: { name: "Unknown", cores: 4, threads: 8 },
          ram: { totalGB: ramGB, availableGB: Math.round(ramGB * 0.7) },
          gpu: gpuVRAM > 0 ? { name: gpuType + " GPU", vramGB: gpuVRAM, type: gpuType as any } : null,
          ollamaInstalled: false, ollamaVersion: null, installedModels: [],
        };
        saveHardwareProfile(machineName, fakeHW, top);
      }

      let text = `=== Recommendations for ${ramGB}GB RAM`;
      if (gpuVRAM > 0) text += ` + ${gpuType} ${gpuVRAM}GB`;
      text += ` ===\n\n`;

      if (top.length === 0) {
        text += `Not enough RAM for any model with tool support. Need at least 4GB RAM.\n`;
        text += `Consider cloud options: Groq (free), Gemini (free), DeepSeek ($0.28/1M tokens).`;
        return { content: [{ type: "text" as const, text }] };
      }

      for (const r of top) {
        const ramLeft = ramGB - r.ramRequired;
        const safeIcon = ramLeft >= 8 ? "✅" : ramLeft >= 4 ? "⚠️" : "🔴";
        text += `${safeIcon} ${r.displayName} (${r.quality})\n`;
        text += `   Size: ${r.sizeGB}GB | RAM needed: ${r.ramRequired}GB | Left for apps: ${ramLeft}GB\n`;
        text += `   Speed: ${r.speed} | Score: ${r.score}/100\n`;
        text += `   Strengths: ${r.strengths.join(", ")}\n`;
        text += `   Install: ${r.installCmd}\n\n`;
      }

      // Safe recommendation
      const safe = top.find(r => (ramGB - r.ramRequired) >= 8);
      if (safe) {
        text += `\n★ แนะนำ: ${safe.displayName} — ใช้แล้วเหลือ RAM ${ramGB - safe.ramRequired}GB ให้ทำงานอื่นสบายๆ`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 3. Check for Upgrades ───

  server.tool(
    "soul_hw_updates",
    "Check if there are better models available for your installed ones. Auto-checks for upgrades.",
    {},
    async () => {
      const result = checkModelUpdates();

      let text = `=== Model Update Check ===\n\n`;
      text += `Installed: ${result.installed.length} models\n\n`;

      if (result.upgrades.length > 0) {
        text += `⚡ UPGRADES AVAILABLE:\n`;
        for (const u of result.upgrades) {
          text += `  ${u.current} → ${u.upgrade.displayName}\n`;
          text += `    ${u.reason}\n`;
          text += `    Install: ${u.upgrade.installCmd}\n\n`;
        }
      } else {
        text += `✅ No upgrades needed — your models are optimal for this hardware.\n\n`;
      }

      if (result.missing.length > 0) {
        text += `💡 RECOMMENDED (not installed):\n`;
        for (const m of result.missing.slice(0, 3)) {
          text += `  • ${m.displayName} — ${m.strengths.slice(0, 2).join(", ")}\n`;
          text += `    ${m.installCmd}\n`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 4. Full Model Catalog ───

  server.tool(
    "soul_hw_catalog",
    "Browse the full model catalog with RAM requirements, quality, speed for each model.",
    {
      category: z.enum(["all", "general", "code", "reasoning", "vision", "multilingual", "lightweight"]).default("all").describe("Filter by category"),
      maxRAM: z.number().optional().describe("Max RAM in GB — only show models that fit"),
    },
    async ({ category, maxRAM }) => {
      let catalog = getModelCatalog();
      if (category !== "all") catalog = catalog.filter(m => m.category === category);
      if (maxRAM) catalog = catalog.filter(m => m.ramRequired <= maxRAM);

      let text = `=== Model Catalog`;
      if (category !== "all") text += ` (${category})`;
      if (maxRAM) text += ` [max ${maxRAM}GB RAM]`;
      text += ` ===\n\n`;

      const groups: Record<string, typeof catalog> = {};
      for (const m of catalog) {
        const tier = m.ramRequired <= 8 ? "Lightweight (≤8GB)" :
                     m.ramRequired <= 16 ? "Medium (8-16GB)" :
                     m.ramRequired <= 32 ? "Large (16-32GB)" : "XL (32GB+)";
        if (!groups[tier]) groups[tier] = [];
        groups[tier].push(m);
      }

      for (const [tier, models] of Object.entries(groups)) {
        text += `── ${tier} ──\n`;
        for (const m of models) {
          const tools = m.supportsTools ? "🔧" : "  ";
          const vision = m.supportsVision ? "👁" : "  ";
          text += `  ${tools}${vision} ${m.displayName.padEnd(25)} ${(m.sizeGB + "GB").padEnd(8)} RAM:${(m.ramRequired + "GB").padEnd(6)} ${m.quality.padEnd(10)} ${m.speed}\n`;
        }
        text += `\n`;
      }

      text += `Legend: 🔧=Tool calling  👁=Vision\n`;
      text += `\nUse soul_hw_scan to see which models fit YOUR machine.`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 5. Saved Profiles ───

  server.tool(
    "soul_hw_profiles",
    "View saved hardware profiles for all machines you've scanned.",
    {},
    async () => {
      const profiles = getHardwareProfiles();

      if (profiles.length === 0) {
        return { content: [{ type: "text" as const, text: "No hardware profiles saved yet. Run soul_hw_scan first." }] };
      }

      let text = `=== Hardware Profiles (${profiles.length} machines) ===\n\n`;
      for (const p of profiles) {
        text += `📦 ${p.machineName} (updated: ${p.updatedAt})\n`;
        text += `   CPU: ${p.hardware.cpu.name}\n`;
        text += `   RAM: ${p.hardware.ram.totalGB}GB\n`;
        if (p.hardware.gpu) text += `   GPU: ${p.hardware.gpu.name} (${p.hardware.gpu.vramGB}GB)\n`;
        text += `   Top models: ${p.recommendations.slice(0, 3).map(r => r.displayName).join(", ")}\n\n`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 6. RAM Budget Calculator ───

  server.tool(
    "soul_hw_budget",
    "Calculate if a specific model will leave enough RAM for other work. Soul should NOT overload your machine.",
    {
      modelId: z.string().describe("Model ID to check (e.g. 'qwen3:8b', 'qwen3-coder:32b')"),
      otherAppsGB: z.number().default(4).describe("RAM needed for other apps (default: 4GB)"),
    },
    async ({ modelId, otherAppsGB }) => {
      const hw = detectHardware();
      const catalog = getModelCatalog();
      const model = catalog.find(m => m.id === modelId);

      if (!model) {
        return { content: [{ type: "text" as const, text: `Model "${modelId}" not found in catalog. Use soul_hw_catalog to see available models.` }] };
      }

      const totalRAM = hw.ram.totalGB;
      const modelRAM = model.ramRequired;
      const osRAM = 3; // OS overhead
      const remaining = totalRAM - modelRAM - osRAM;
      const canRunOtherApps = remaining >= otherAppsGB;

      let text = `=== RAM Budget: ${model.displayName} ===\n\n`;
      text += `Total RAM:     ${totalRAM} GB\n`;
      text += `OS overhead:  -${osRAM} GB\n`;
      text += `Model needs:  -${modelRAM} GB\n`;
      text += `─────────────────────\n`;
      text += `Remaining:     ${remaining} GB\n`;
      text += `You need:      ${otherAppsGB} GB for other apps\n\n`;

      if (canRunOtherApps && remaining >= otherAppsGB + 4) {
        text += `✅ SAFE — ${remaining}GB left, plenty for ${otherAppsGB}GB of other work.`;
      } else if (canRunOtherApps) {
        text += `⚠️ TIGHT — Only ${remaining}GB left. May slow down with heavy apps.`;
        // Suggest smaller alternative
        const smaller = catalog
          .filter(m => m.supportsTools && m.ramRequired < modelRAM && (totalRAM - m.ramRequired - osRAM) >= otherAppsGB + 4)
          .sort((a, b) => (b.quality === "excellent" ? 4 : b.quality === "great" ? 3 : b.quality === "good" ? 2 : 1) -
                          (a.quality === "excellent" ? 4 : a.quality === "great" ? 3 : a.quality === "good" ? 2 : 1));
        if (smaller.length > 0) {
          text += `\n💡 Safer option: ${smaller[0].displayName} (needs ${smaller[0].ramRequired}GB, leaves ${totalRAM - smaller[0].ramRequired - osRAM}GB)`;
        }
      } else {
        text += `🔴 NOT SAFE — Only ${remaining}GB left, not enough for ${otherAppsGB}GB of other work.`;
        text += `\nSoul should not overload your machine! `;
        const safe = catalog
          .filter(m => m.supportsTools && (totalRAM - m.ramRequired - osRAM) >= otherAppsGB + 4)
          .sort((a, b) => (b.quality === "excellent" ? 4 : b.quality === "great" ? 3 : b.quality === "good" ? 2 : 1) -
                          (a.quality === "excellent" ? 4 : a.quality === "great" ? 3 : a.quality === "good" ? 2 : 1));
        if (safe.length > 0) {
          text += `\n★ แนะนำ: ${safe[0].displayName} (needs ${safe[0].ramRequired}GB, leaves ${totalRAM - safe[0].ramRequired - osRAM}GB)`;
        }
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 7. GPU Setup ───

  server.tool(
    "soul_gpu_setup",
    "Detect GPU and configure Ollama for GPU acceleration. Shows env vars to set and setup instructions.",
    {},
    async () => {
      const result = configureOllamaGpu();
      let text = `=== GPU Setup ===\n\n`;
      text += `GPU: ${result.gpuDetected ? result.gpuName : "None"} (${result.gpuType})\n`;
      if (result.vramGB > 0) text += `VRAM: ${result.vramGB} GB\n`;
      text += `Ollama GPU status: ${result.ollamaGpuStatus}\n\n`;

      if (Object.keys(result.envVars).length > 0) {
        text += `Environment variables to set:\n`;
        for (const [k, v] of Object.entries(result.envVars)) {
          text += `  ${k}=${v}\n`;
        }
        text += `\n`;
      }

      text += result.instructions.join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ─── 8. Ollama Performance ───

  server.tool(
    "soul_ollama_perf",
    "Check Ollama performance — running models, GPU usage, VRAM allocation.",
    {},
    async () => {
      const result = await getOllamaPerformance();
      return { content: [{ type: "text" as const, text: result.summary }] };
    }
  );

  // ─── 9. Optimize Ollama ───

  server.tool(
    "soul_optimize_ollama",
    "Get optimized Ollama configuration based on your hardware. Generates Modelfile and env var recommendations.",
    {
      modelId: z.string().optional().describe("Model to optimize for (default: qwen3:14b)"),
    },
    async ({ modelId }) => {
      const result = optimizeOllamaConfig(modelId);
      let text = `=== Ollama Optimization ===\n\n`;
      text += `Recommendations:\n`;
      for (const r of result.recommendations) {
        text += `  • ${r}\n`;
      }
      text += `\nEnvironment variables:\n`;
      for (const [k, v] of Object.entries(result.envVars)) {
        text += `  export ${k}=${v}\n`;
      }
      text += `\nModelfile:\n${result.modelfile}\n`;
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
