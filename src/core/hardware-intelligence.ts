/**
 * Hardware Intelligence — Detect specs, recommend models, auto-update
 *
 * Features:
 * 1. Detect CPU, RAM, GPU on any machine
 * 2. Recommend best Ollama model for that hardware
 * 3. Model catalog with benchmarks + RAM requirements
 * 4. Auto-check for newer/better models
 * 5. Install recommendations for other machines
 */

import { execSync } from "child_process";
import { getRawDb } from "../db/index.js";

// ─── Types ───

export interface HardwareSpec {
  os: string;
  cpu: { name: string; cores: number; threads: number };
  ram: { totalGB: number; availableGB: number };
  gpu: { name: string; vramGB: number; type: "nvidia" | "amd" | "intel" | "apple" | "none" } | null;
  ollamaInstalled: boolean;
  ollamaVersion: string | null;
  installedModels: Array<{ name: string; sizeGB: number; modified: string }>;
}

export interface ModelRecommendation {
  id: string;
  displayName: string;
  sizeGB: number;
  ramRequired: number;
  strengths: string[];
  weaknesses: string[];
  score: number; // 1-100 fit score for this hardware
  category: "general" | "code" | "reasoning" | "vision" | "multilingual" | "lightweight";
  supportsTools: boolean;
  supportsVision: boolean;
  contextWindow: number;
  speed: "fast" | "medium" | "slow";
  quality: "basic" | "good" | "great" | "excellent";
  recommended: boolean;
  installCmd: string;
}

// ─── Model Catalog ───
// Updated: 2025-06 — Keep this list current!

const MODEL_CATALOG: Array<Omit<ModelRecommendation, "score" | "recommended" | "installCmd">> = [
  // ─── Lightweight (4-8GB RAM) ───
  {
    id: "qwen3:1.7b", displayName: "Qwen3 1.7B", sizeGB: 1.4, ramRequired: 4,
    strengths: ["Ultra-fast", "Low RAM", "Tool calling", "Thai OK"],
    weaknesses: ["Simple tasks only", "Limited reasoning"],
    category: "lightweight", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "fast", quality: "basic",
  },
  {
    id: "qwen3:4b", displayName: "Qwen3 4B", sizeGB: 2.7, ramRequired: 6,
    strengths: ["Fast", "Good for chat", "Tool calling", "Multilingual"],
    weaknesses: ["Limited code", "Basic reasoning"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "fast", quality: "good",
  },
  {
    id: "gemma3:4b", displayName: "Gemma 3 4B", sizeGB: 3.0, ramRequired: 6,
    strengths: ["Vision support", "Fast", "Good quality/size ratio"],
    weaknesses: ["No tool calling", "English-focused"],
    category: "vision", supportsTools: false, supportsVision: true,
    contextWindow: 131072, speed: "fast", quality: "good",
  },
  {
    id: "phi4-mini", displayName: "Phi-4 Mini 3.8B", sizeGB: 2.5, ramRequired: 6,
    strengths: ["Great reasoning for size", "Math", "Code"],
    weaknesses: ["English only", "Short context"],
    category: "reasoning", supportsTools: true, supportsVision: false,
    contextWindow: 16384, speed: "fast", quality: "good",
  },
  {
    id: "glm-4.7-flash", displayName: "GLM 4.7 Flash 4B", sizeGB: 2.8, ramRequired: 6,
    strengths: ["Ultra-fast", "Tool calling", "Chinese/English"],
    weaknesses: ["Limited Thai", "Basic reasoning"],
    category: "lightweight", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "fast", quality: "good",
  },

  // ─── Medium (8-16GB RAM) ───
  {
    id: "qwen3:8b", displayName: "Qwen3 8B", sizeGB: 5.2, ramRequired: 10,
    strengths: ["Great balance", "Tool calling", "Multilingual", "Thai good"],
    weaknesses: ["Not great for complex code"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "medium", quality: "good",
  },
  {
    id: "devstral", displayName: "Devstral 14B (Mistral)", sizeGB: 8.0, ramRequired: 12,
    strengths: ["Agentic coding", "Tool use", "Code generation", "Fast"],
    weaknesses: ["English-focused", "No vision"],
    category: "code", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "medium", quality: "great",
  },
  {
    id: "qwen3-coder:14b", displayName: "Qwen3 Coder 14B", sizeGB: 9.0, ramRequired: 14,
    strengths: ["Excellent code", "Tool calling", "Agentic", "Multilingual"],
    weaknesses: ["Needs 14GB RAM", "No vision"],
    category: "code", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "medium", quality: "great",
  },
  {
    id: "phi4", displayName: "Phi-4 14B", sizeGB: 9.1, ramRequired: 14,
    strengths: ["Strong reasoning", "Math", "Code", "Compact"],
    weaknesses: ["Short context 16K", "English only"],
    category: "reasoning", supportsTools: true, supportsVision: false,
    contextWindow: 16384, speed: "medium", quality: "great",
  },
  {
    id: "mistral-small3.2", displayName: "Mistral Small 3.2 24B", sizeGB: 14.0, ramRequired: 18,
    strengths: ["Vision", "Tool calling", "Fast for size", "Good quality"],
    weaknesses: ["Needs 18GB", "English-focused"],
    category: "vision", supportsTools: true, supportsVision: true,
    contextWindow: 131072, speed: "medium", quality: "great",
  },
  {
    id: "gemma3:12b", displayName: "Gemma 3 12B", sizeGB: 8.1, ramRequired: 12,
    strengths: ["Vision", "Good reasoning", "Multilingual"],
    weaknesses: ["Limited tool calling"],
    category: "vision", supportsTools: false, supportsVision: true,
    contextWindow: 131072, speed: "medium", quality: "great",
  },

  // ─── Large (16-32GB RAM) ───
  {
    id: "qwen3:32b", displayName: "Qwen3 32B", sizeGB: 20.0, ramRequired: 24,
    strengths: ["Excellent all-round", "Tool calling", "Thai great", "Deep reasoning"],
    weaknesses: ["Needs 24GB RAM", "Slow on CPU"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },
  {
    id: "qwen3-coder:32b", displayName: "Qwen3 Coder 32B", sizeGB: 20.0, ramRequired: 24,
    strengths: ["Best open-source coder", "Tool calling", "Agentic", "Thai"],
    weaknesses: ["Needs 24GB RAM", "Slow on CPU"],
    category: "code", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },
  {
    id: "gemma3:27b", displayName: "Gemma 3 27B", sizeGB: 17.0, ramRequired: 22,
    strengths: ["Vision", "Strong reasoning", "Multilingual", "Google quality"],
    weaknesses: ["Limited tool calling", "Needs 22GB"],
    category: "vision", supportsTools: false, supportsVision: true,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },
  {
    id: "deepseek-r1:32b", displayName: "DeepSeek R1 32B", sizeGB: 20.0, ramRequired: 24,
    strengths: ["Deep reasoning", "Chain of thought", "Math", "Code"],
    weaknesses: ["Slow (thinks long)", "Needs 24GB"],
    category: "reasoning", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },

  // ─── XL (32-64GB RAM) ───
  {
    id: "qwen3:30b-a3b", displayName: "Qwen3 30B-A3B (MoE)", sizeGB: 18.0, ramRequired: 22,
    strengths: ["MoE = fast like 3B, smart like 30B", "Tool calling", "Efficient"],
    weaknesses: ["MoE can be inconsistent"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "fast", quality: "great",
  },
  {
    id: "llama3.3", displayName: "Llama 3.3 70B", sizeGB: 43.0, ramRequired: 48,
    strengths: ["Top-tier quality", "Great reasoning", "Multilingual"],
    weaknesses: ["Needs 48GB+", "Very slow on CPU"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },
  {
    id: "qwen3:235b-a22b", displayName: "Qwen3 235B-A22B (MoE)", sizeGB: 130.0, ramRequired: 140,
    strengths: ["Near-GPT4 quality", "MoE efficient", "Massive knowledge"],
    weaknesses: ["Needs 140GB RAM", "Multi-GPU"],
    category: "general", supportsTools: true, supportsVision: false,
    contextWindow: 131072, speed: "slow", quality: "excellent",
  },
];

// ─── Hardware Detection ───

export function detectHardware(): HardwareSpec {
  const os = detectOS();
  const cpu = detectCPU();
  const ram = detectRAM();
  const gpu = detectGPU();
  const ollama = detectOllama();

  return {
    os,
    cpu,
    ram,
    gpu,
    ollamaInstalled: ollama.installed,
    ollamaVersion: ollama.version,
    installedModels: ollama.models,
  };
}

function detectOS(): string {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      const ver = powershell("(Get-CimInstance Win32_OperatingSystem).Caption")?.trim()
        || safeExec("wmic os get Caption /value")?.match(/Caption=(.+)/)?.[1]?.trim();
      return ver || "Windows";
    } else if (platform === "darwin") {
      const ver = safeExec("sw_vers -productVersion")?.trim();
      return `macOS ${ver || ""}`.trim();
    } else {
      const distro = safeExec("cat /etc/os-release 2>/dev/null")?.match(/PRETTY_NAME="(.+)"/)?.[1];
      return distro || "Linux";
    }
  } catch { return process.platform; }
}

function detectCPU(): HardwareSpec["cpu"] {
  try {
    if (process.platform === "win32") {
      // Try PowerShell first (more reliable), fallback to wmic
      const psResult = powershell("Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json");
      if (psResult) {
        const data = JSON.parse(psResult.trim());
        return {
          name: data.Name?.trim() || "Unknown",
          cores: data.NumberOfCores || 1,
          threads: data.NumberOfLogicalProcessors || data.NumberOfCores || 1,
        };
      }
      const name = safeExec('wmic cpu get Name /value')?.match(/Name=(.+)/)?.[1]?.trim() || "Unknown";
      const cores = parseInt(safeExec('wmic cpu get NumberOfCores /value')?.match(/NumberOfCores=(\d+)/)?.[1] || "0");
      const threads = parseInt(safeExec('wmic cpu get NumberOfLogicalProcessors /value')?.match(/NumberOfLogicalProcessors=(\d+)/)?.[1] || "0");
      return { name, cores: cores || 1, threads: threads || cores || 1 };
    } else if (process.platform === "darwin") {
      const name = safeExec("sysctl -n machdep.cpu.brand_string")?.trim() || "Apple Silicon";
      const cores = parseInt(safeExec("sysctl -n hw.physicalcpu")?.trim() || "0");
      const threads = parseInt(safeExec("sysctl -n hw.logicalcpu")?.trim() || "0");
      return { name, cores: cores || 1, threads: threads || cores || 1 };
    } else {
      const info = safeExec("cat /proc/cpuinfo") || "";
      const name = info.match(/model name\s*:\s*(.+)/)?.[1]?.trim() || "Unknown";
      const cores = parseInt(safeExec("nproc")?.trim() || "1");
      return { name, cores, threads: cores };
    }
  } catch { return { name: "Unknown", cores: 1, threads: 1 }; }
}

function detectRAM(): HardwareSpec["ram"] {
  try {
    if (process.platform === "win32") {
      // PowerShell first
      const psResult = powershell("$os = Get-CimInstance Win32_OperatingSystem; @{Total=$os.TotalVisibleMemorySize;Free=$os.FreePhysicalMemory} | ConvertTo-Json");
      if (psResult) {
        const data = JSON.parse(psResult.trim());
        const totalKB = data.Total || 0;
        const freeKB = data.Free || 0;
        return { totalGB: Math.round(totalKB / 1024 / 1024), availableGB: Math.round(freeKB / 1024 / 1024) };
      }
      const total = parseInt(safeExec('wmic OS get TotalVisibleMemorySize /value')?.match(/TotalVisibleMemorySize=(\d+)/)?.[1] || "0");
      const free = parseInt(safeExec('wmic OS get FreePhysicalMemory /value')?.match(/FreePhysicalMemory=(\d+)/)?.[1] || "0");
      return { totalGB: Math.round(total / 1024 / 1024), availableGB: Math.round(free / 1024 / 1024) };
    } else if (process.platform === "darwin") {
      const total = parseInt(safeExec("sysctl -n hw.memsize")?.trim() || "0");
      return { totalGB: Math.round(total / 1024 / 1024 / 1024), availableGB: Math.round(total / 1024 / 1024 / 1024 * 0.7) };
    } else {
      const meminfo = safeExec("cat /proc/meminfo") || "";
      const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || "0");
      const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || "0");
      return { totalGB: Math.round(total / 1024 / 1024), availableGB: Math.round(avail / 1024 / 1024) };
    }
  } catch { return { totalGB: 0, availableGB: 0 }; }
}

function detectGPU(): HardwareSpec["gpu"] {
  try {
    if (process.platform === "win32") {
      // Try PowerShell first
      const psResult = powershell("Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json");
      let name: string | undefined;
      let ram = 0;
      if (psResult) {
        try {
          const data = JSON.parse(psResult.trim());
          name = data.Name?.trim();
          ram = data.AdapterRAM || 0;
        } catch { /* fall through to wmic */ }
      }
      if (!name) {
        const info = safeExec('wmic path win32_VideoController get Name,AdapterRAM /value') || "";
        name = info.match(/Name=(.+)/)?.[1]?.trim();
        ram = parseInt(info.match(/AdapterRAM=(\d+)/)?.[1] || "0");
      }
      if (!name) return null;
      const type = name.toLowerCase().includes("nvidia") ? "nvidia" as const
        : name.toLowerCase().includes("amd") || name.toLowerCase().includes("radeon") ? "amd" as const
        : name.toLowerCase().includes("intel") || name.toLowerCase().includes("arc") ? "intel" as const
        : "none" as const;
      return { name, vramGB: Math.round(ram / 1024 / 1024 / 1024) || estimateVRAM(name), type };
    } else if (process.platform === "darwin") {
      // Apple Silicon — unified memory
      const chip = safeExec("sysctl -n machdep.cpu.brand_string")?.trim() || "";
      if (chip.includes("Apple")) {
        const totalMem = parseInt(safeExec("sysctl -n hw.memsize")?.trim() || "0");
        const gpuMem = Math.round(totalMem / 1024 / 1024 / 1024 * 0.75); // Apple shares ~75% with GPU
        return { name: chip, vramGB: gpuMem, type: "apple" };
      }
      return null;
    } else {
      // Check nvidia-smi
      const nvidiaSmi = safeExec("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null");
      if (nvidiaSmi) {
        const parts = nvidiaSmi.trim().split(",");
        const name = parts[0]?.trim() || "NVIDIA GPU";
        const mem = parseInt(parts[1]?.trim() || "0");
        return { name, vramGB: Math.round(mem / 1024), type: "nvidia" };
      }
      // Check AMD
      const amdGpu = safeExec("rocm-smi --showmeminfo vram 2>/dev/null");
      if (amdGpu) {
        return { name: "AMD GPU", vramGB: 8, type: "amd" };
      }
      return null;
    }
  } catch { return null; }
}

function estimateVRAM(gpuName: string): number {
  // WMI sometimes reports wrong VRAM for modern GPUs — estimate from name
  const name = gpuName.toLowerCase();
  if (name.includes("a770")) return 16;
  if (name.includes("a750")) return 8;
  if (name.includes("a580")) return 8;
  if (name.includes("a380")) return 6;
  if (name.includes("4090")) return 24;
  if (name.includes("4080")) return 16;
  if (name.includes("4070 ti super")) return 16;
  if (name.includes("4070 ti")) return 12;
  if (name.includes("4070 super")) return 12;
  if (name.includes("4070")) return 12;
  if (name.includes("4060 ti")) return 16;
  if (name.includes("4060")) return 8;
  if (name.includes("3090")) return 24;
  if (name.includes("3080")) return 12;
  if (name.includes("3070")) return 8;
  if (name.includes("3060")) return 12;
  if (name.includes("7900 xtx")) return 24;
  if (name.includes("7900 xt")) return 20;
  if (name.includes("7800 xt")) return 16;
  if (name.includes("7700 xt")) return 12;
  if (name.includes("7600")) return 8;
  return 4; // default guess
}

function detectOllama(): { installed: boolean; version: string | null; models: HardwareSpec["installedModels"] } {
  try {
    const versionOutput = safeExec("ollama --version") || safeExec("ollama version") || "";
    const version = versionOutput.match(/(\d+\.\d+\.\d+)/)?.[1] || null;
    if (!version) return { installed: false, version: null, models: [] };

    const list = safeExec("ollama list") || "";
    const models: HardwareSpec["installedModels"] = [];
    for (const line of list.split("\n").slice(1)) {
      const match = line.match(/^(\S+)\s+\S+\s+([\d.]+\s+\S+)\s+(.+)/);
      if (match) {
        const sizeStr = match[2].trim();
        const sizeGB = parseSize(sizeStr);
        models.push({ name: match[1], sizeGB, modified: match[3].trim() });
      }
    }
    return { installed: true, version, models };
  } catch { return { installed: false, version: null, models: [] }; }
}

function parseSize(s: string): number {
  const match = s.match(/([\d.]+)\s*(GB|MB|TB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "TB") return val * 1024;
  if (unit === "GB") return val;
  if (unit === "MB") return val / 1024;
  return 0;
}

function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
  } catch { return null; }
}

function powershell(cmd: string): string | null {
  try {
    return execSync(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? "cmd.exe" : undefined,
    });
  } catch { return null; }
}

// ─── Model Recommendation ───

export function recommendModels(hardware?: HardwareSpec): ModelRecommendation[] {
  const hw = hardware || detectHardware();
  const availableRAM = hw.ram.totalGB;
  const hasGPU = hw.gpu !== null && hw.gpu.type !== "none";
  const gpuVRAM = hw.gpu?.vramGB || 0;

  const recommendations: ModelRecommendation[] = [];

  for (const model of MODEL_CATALOG) {
    // Can this machine run it?
    if (model.ramRequired > availableRAM) continue;

    // Score calculation — prioritize quality while ensuring machine safety
    let score = 0;

    const ramLeft = availableRAM - model.ramRequired;

    // Safety first: must leave enough RAM for other apps
    if (ramLeft < 4) { score -= 50; } // dangerous
    else if (ramLeft < 8) { score += 5; } // tight
    else if (ramLeft < 12) { score += 15; } // comfortable
    else { score += 10; } // lots of headroom but maybe wasting potential

    // Quality is the most important factor (0-40 points)
    if (model.quality === "excellent") score += 40;
    else if (model.quality === "great") score += 28;
    else if (model.quality === "good") score += 16;
    else score += 5;

    // RAM utilization — prefer models that use the machine's potential (0-20 points)
    const ramRatio = model.ramRequired / availableRAM;
    if (ramRatio >= 0.4 && ramRatio <= 0.75) score += 20; // sweet spot: strong model + safe
    else if (ramRatio >= 0.25 && ramRatio < 0.4) score += 12;
    else if (ramRatio > 0.75 && ramRatio <= 0.85) score += 15; // pushing it but OK
    else if (ramRatio < 0.25) score += 3; // too small = wasting capacity
    else score += 5; // too tight

    // Tool calling is essential for Soul (0-15 points)
    if (model.supportsTools) score += 15;

    // Speed bonus (0-8 points)
    if (model.speed === "fast") score += 8;
    else if (model.speed === "medium") score += 5;
    else score += 2;

    // GPU acceleration bonus (0-10 points)
    if (hasGPU && model.sizeGB <= gpuVRAM) score += 10; // fits entirely in VRAM
    else if (hasGPU && model.sizeGB <= gpuVRAM * 1.5) score += 5; // partial offload

    // Category bonus for Soul (0-5 points)
    if (model.category === "code") score += 5;
    else if (model.category === "general") score += 4;
    else if (model.category === "reasoning") score += 3;

    // Cap score
    score = Math.min(100, Math.max(0, score));

    recommendations.push({
      ...model,
      score,
      recommended: score >= 70,
      installCmd: `ollama pull ${model.id}`,
    });
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  return recommendations;
}

// ─── Recommend for Specific Specs ───

export function recommendForSpecs(ramGB: number, gpuVRAM: number = 0, gpuType: string = "none"): ModelRecommendation[] {
  const fakeHW: HardwareSpec = {
    os: "unknown",
    cpu: { name: "Unknown", cores: 4, threads: 8 },
    ram: { totalGB: ramGB, availableGB: Math.round(ramGB * 0.7) },
    gpu: gpuVRAM > 0 ? { name: "GPU", vramGB: gpuVRAM, type: gpuType as any } : null,
    ollamaInstalled: true,
    ollamaVersion: null,
    installedModels: [],
  };
  return recommendModels(fakeHW);
}

// ─── Quick Recommend — Top 3 for this machine ───

export function quickRecommend(hardware?: HardwareSpec): {
  topPick: ModelRecommendation;
  alternatives: ModelRecommendation[];
  hardware: HardwareSpec;
  summary: string;
} {
  const hw = hardware || detectHardware();
  const all = recommendModels(hw);

  // Best overall (must support tools)
  const toolModels = all.filter(m => m.supportsTools);
  if (toolModels.length === 0) {
    // No models fit — RAM too low or detection failed
    const fallback: ModelRecommendation = {
      id: "qwen3:1.7b", displayName: "Qwen3 1.7B (fallback)", sizeGB: 1.4, ramRequired: 4,
      strengths: ["Ultra lightweight"], weaknesses: ["Basic"], score: 50,
      category: "lightweight", supportsTools: true, supportsVision: false,
      contextWindow: 131072, speed: "fast", quality: "basic", recommended: true,
      installCmd: "ollama pull qwen3:1.7b",
    };
    return { topPick: fallback, alternatives: [], hardware: hw, summary: `Could not detect RAM. Try: ollama pull qwen3:1.7b` };
  }
  const topPick = toolModels[0];
  const alternatives = toolModels.slice(1, 4);

  let summary = `เครื่องนี้: ${hw.cpu.name}, RAM ${hw.ram.totalGB}GB`;
  if (hw.gpu) summary += `, ${hw.gpu.name} ${hw.gpu.vramGB}GB`;
  summary += `\n\nแนะนำ: ${topPick.displayName} (${topPick.sizeGB}GB)`;
  summary += `\nติดตั้ง: ${topPick.installCmd}`;

  if (hw.installedModels.length > 0) {
    summary += `\n\nติดตั้งแล้ว: ${hw.installedModels.map(m => m.name).join(", ")}`;
    // Check if installed model is optimal
    const installedIds = new Set(hw.installedModels.map(m => m.name));
    if (!installedIds.has(topPick.id)) {
      summary += `\n⚡ แนะนำอัพเกรดเป็น ${topPick.displayName} — ดีกว่าตัวที่มีอยู่`;
    }
  }

  return { topPick, alternatives, hardware: hw, summary };
}

// ─── Check for Updates ───

export function checkModelUpdates(hardware?: HardwareSpec): {
  installed: HardwareSpec["installedModels"];
  upgrades: Array<{ current: string; upgrade: ModelRecommendation; reason: string }>;
  missing: ModelRecommendation[];
} {
  const hw = hardware || detectHardware();
  const recommended = recommendModels(hw).filter(m => m.recommended);
  const installedNames = new Set(hw.installedModels.map(m => m.name));

  const upgrades: Array<{ current: string; upgrade: ModelRecommendation; reason: string }> = [];
  const missing: ModelRecommendation[] = [];

  // Check each installed model — is there a better one?
  for (const installed of hw.installedModels) {
    const name = installed.name.replace(/:latest$/, "");
    const currentInCatalog = MODEL_CATALOG.find(m => m.id === name || m.id.startsWith(name));

    if (currentInCatalog) {
      // Find better model in same category
      const better = recommended.find(r =>
        r.category === currentInCatalog.category &&
        r.score > 70 &&
        r.id !== currentInCatalog.id &&
        (r.quality === "excellent" && currentInCatalog.quality !== "excellent" ||
         r.quality === "great" && currentInCatalog.quality === "good")
      );
      if (better) {
        upgrades.push({
          current: installed.name,
          upgrade: better,
          reason: `${better.displayName} มีคุณภาพ ${better.quality} vs ${currentInCatalog.quality} ของ ${installed.name}`,
        });
      }
    }
  }

  // Find recommended models not yet installed
  for (const rec of recommended.slice(0, 5)) {
    const id = rec.id;
    if (!installedNames.has(id) && !installedNames.has(id + ":latest")) {
      missing.push(rec);
    }
  }

  return { installed: hw.installedModels, upgrades, missing };
}

// ─── Persistence — Store hardware profile + recommendations ───

function ensureHWTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_hardware_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_name TEXT NOT NULL DEFAULT 'local',
      hardware_json TEXT NOT NULL,
      recommendations_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function saveHardwareProfile(machineName: string, hw: HardwareSpec, recs: ModelRecommendation[]) {
  ensureHWTable();
  const rawDb = getRawDb();
  const existing = rawDb.prepare(
    "SELECT id FROM soul_hardware_profiles WHERE machine_name = ?"
  ).get(machineName) as any;

  const hwJson = JSON.stringify(hw);
  const recsJson = JSON.stringify(recs.slice(0, 10)); // top 10

  if (existing) {
    rawDb.prepare(
      "UPDATE soul_hardware_profiles SET hardware_json = ?, recommendations_json = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(hwJson, recsJson, existing.id);
  } else {
    rawDb.prepare(
      "INSERT INTO soul_hardware_profiles (machine_name, hardware_json, recommendations_json) VALUES (?, ?, ?)"
    ).run(machineName, hwJson, recsJson);
  }
}

export function getHardwareProfiles(): Array<{
  machineName: string;
  hardware: HardwareSpec;
  recommendations: ModelRecommendation[];
  updatedAt: string;
}> {
  ensureHWTable();
  const rawDb = getRawDb();
  const rows = rawDb.prepare("SELECT * FROM soul_hardware_profiles ORDER BY updated_at DESC").all() as any[];
  return rows.map(r => ({
    machineName: r.machine_name,
    hardware: JSON.parse(r.hardware_json),
    recommendations: JSON.parse(r.recommendations_json),
    updatedAt: r.updated_at,
  }));
}

// ─── Get Full Model Catalog ───

export function getModelCatalog(): typeof MODEL_CATALOG {
  return MODEL_CATALOG;
}

// ─── GPU Setup & Ollama Optimization ───

export function configureOllamaGpu(): {
  gpuDetected: boolean;
  gpuType: string;
  gpuName: string;
  vramGB: number;
  ollamaGpuStatus: string;
  envVars: Record<string, string>;
  instructions: string[];
} {
  const hw = detectHardware();
  const gpu = hw.gpu;
  const instructions: string[] = [];
  const envVars: Record<string, string> = {};
  let ollamaGpuStatus = "unknown";

  if (!gpu || gpu.type === "none") {
    return {
      gpuDetected: false, gpuType: "none", gpuName: "None", vramGB: 0,
      ollamaGpuStatus: "cpu_only", envVars, instructions: ["No GPU detected. Ollama will use CPU only."],
    };
  }

  // Check if Ollama is using GPU
  try {
    const psOutput = safeExec("ollama ps");
    if (psOutput && psOutput.includes("GPU")) {
      ollamaGpuStatus = "active";
    } else if (psOutput) {
      ollamaGpuStatus = "cpu_fallback";
    }
  } catch { /* ok */ }

  if (gpu.type === "nvidia") {
    instructions.push("NVIDIA GPU detected — Ollama supports CUDA natively.");
    instructions.push("Ensure NVIDIA drivers are up to date (nvidia-smi to check).");
    envVars["OLLAMA_NUM_GPU"] = "999";
  } else if (gpu.type === "intel") {
    instructions.push("Intel Arc GPU detected — Ollama supports Intel GPUs via IPEX-LLM / oneAPI.");
    envVars["OLLAMA_INTEL_GPU"] = "true";
    // Check for oneAPI
    const oneapiRoot = process.env.ONEAPI_ROOT;
    if (oneapiRoot) {
      instructions.push(`oneAPI found at: ${oneapiRoot}`);
    } else {
      instructions.push("Install Intel oneAPI Base Toolkit for GPU acceleration.");
      instructions.push("Download: https://www.intel.com/content/www/us/en/developer/tools/oneapi/base-toolkit.html");
    }
    envVars["OLLAMA_NUM_GPU"] = "999";
  } else if (gpu.type === "amd") {
    instructions.push("AMD GPU detected — Ollama supports ROCm on Linux.");
    if (process.platform === "linux") {
      envVars["HSA_OVERRIDE_GFX_VERSION"] = "11.0.0";
      instructions.push("Ensure ROCm drivers are installed.");
    } else {
      instructions.push("AMD GPU acceleration is best supported on Linux with ROCm.");
    }
  } else if (gpu.type === "apple") {
    instructions.push("Apple Silicon detected — Ollama uses Metal GPU acceleration automatically.");
    ollamaGpuStatus = "active";
  }

  if (gpu.vramGB > 0) {
    instructions.push(`VRAM: ${gpu.vramGB} GB — ` +
      (gpu.vramGB >= 8 ? "can run 7B-14B models on GPU" :
       gpu.vramGB >= 4 ? "can run small models (3B-7B) on GPU" :
       "limited VRAM, most work will be on CPU"));
  }

  return {
    gpuDetected: true, gpuType: gpu.type, gpuName: gpu.name, vramGB: gpu.vramGB,
    ollamaGpuStatus, envVars, instructions,
  };
}

export async function getOllamaPerformance(): Promise<{
  running: boolean;
  models: Array<{ name: string; size: string; gpu: string }>;
  summary: string;
}> {
  // Try CLI first
  const psOutput = safeExec("ollama ps");
  if (!psOutput || psOutput.includes("could not connect")) {
    return { running: false, models: [], summary: "Ollama is not running. Start with: ollama serve" };
  }

  const models: Array<{ name: string; size: string; gpu: string }> = [];
  const lines = psOutput.split("\n").filter(l => l.trim() && !l.startsWith("NAME"));
  for (const line of lines) {
    const parts = line.split(/\s{2,}/).filter(Boolean);
    if (parts.length >= 3) {
      models.push({ name: parts[0], size: parts[1], gpu: parts[parts.length - 1] || "unknown" });
    }
  }

  // Try API for more detail
  try {
    const resp = await fetch("http://localhost:11434/api/ps");
    if (resp.ok) {
      const data = await resp.json() as any;
      if (data.models && models.length === 0) {
        for (const m of data.models) {
          models.push({
            name: m.name || m.model,
            size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : "?",
            gpu: m.details?.gpu ? "GPU" : "CPU",
          });
        }
      }
    }
  } catch { /* ok — API not available */ }

  const summary = models.length === 0
    ? "Ollama running but no models loaded."
    : `${models.length} model(s) loaded:\n` + models.map(m => `  ${m.name} (${m.size}) — ${m.gpu}`).join("\n");

  return { running: true, models, summary };
}

export function optimizeOllamaConfig(modelId?: string): {
  recommendations: string[];
  modelfile: string;
  envVars: Record<string, string>;
} {
  const hw = detectHardware();
  const gpu = hw.gpu;
  const ramGB = hw.ram.totalGB;
  const vramGB = gpu?.vramGB || 0;
  const threads = hw.cpu.threads;
  const recs: string[] = [];
  const envVars: Record<string, string> = {};

  // Context length
  let ctxLen = 4096;
  if (ramGB >= 32 && vramGB >= 8) ctxLen = 8192;
  else if (ramGB >= 16) ctxLen = 4096;
  else ctxLen = 2048;
  recs.push(`Context length: ${ctxLen} (based on ${ramGB}GB RAM, ${vramGB}GB VRAM)`);

  // Threads
  const optimalThreads = Math.max(4, Math.min(threads - 2, 16));
  envVars["OLLAMA_NUM_THREADS"] = String(optimalThreads);
  recs.push(`Threads: ${optimalThreads} (of ${threads} available, leaving 2 for system)`);

  // GPU layers
  if (vramGB >= 8) {
    envVars["OLLAMA_NUM_GPU"] = "999";
    recs.push("GPU layers: all (8GB+ VRAM — offload everything to GPU)");
  } else if (vramGB >= 4) {
    envVars["OLLAMA_NUM_GPU"] = "20";
    recs.push("GPU layers: 20 (4GB VRAM — partial offload)");
  } else {
    recs.push("GPU layers: 0 (no GPU or <4GB VRAM — CPU only)");
  }

  // Flash attention
  if (gpu && gpu.type !== "none") {
    envVars["OLLAMA_FLASH_ATTENTION"] = "1";
    recs.push("Flash attention: enabled (GPU available)");
  }

  // Keep alive
  envVars["OLLAMA_KEEP_ALIVE"] = "10m";
  recs.push("Keep alive: 10 minutes (keeps model in memory between requests)");

  // mmap
  if (ramGB >= 16) {
    recs.push("Memory mapping: enabled (16GB+ RAM)");
  }

  // Batch size
  const batchSize = vramGB >= 8 ? 512 : vramGB >= 4 ? 256 : 128;
  recs.push(`Batch size: ${batchSize}`);

  // Generate Modelfile snippet
  const model = modelId || "qwen3:14b";
  const modelfile = `# Optimized Modelfile for ${hw.cpu.name} / ${gpu?.name || "CPU"}\nFROM ${model}\nPARAMETER num_ctx ${ctxLen}\nPARAMETER num_batch ${batchSize}\nPARAMETER num_thread ${optimalThreads}`;

  return { recommendations: recs, modelfile, envVars };
}
