/**
 * Video Creator Engine — Soul's ability to create animated HTML5 "videos" and animations
 *
 * All output is generated with zero external dependencies:
 * 1. Animated Videos — self-contained HTML with CSS keyframe scene transitions
 * 2. Text Animations — SVG with animated text effects
 * 3. Countdown Timers — SVG countdown animations
 * 4. Particle Effects — HTML with CSS particle systems
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { safePath } from "./security.js";

// ─── Constants ───

const DEFAULT_EXPORT_DIR = path.join(os.homedir(), ".soul", "exports");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ─── Types ───

export interface VideoScene {
  title: string;
  content: string;
  duration?: number;
  background?: string;
  transition?: "fade" | "slide" | "zoom";
}

export interface VideoOptions {
  title?: string;
  theme?: "dark" | "light" | "cinematic";
  loop?: boolean;
  filePath?: string;
}

export interface TextAnimationOptions {
  style?: "typewriter" | "fade-words" | "bounce" | "slide-up" | "glow";
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  width?: number;
  height?: number;
  duration?: number;
  fontFamily?: string;
  filePath?: string;
}

export interface CountdownOptions {
  size?: number;
  color?: string;
  backgroundColor?: string;
  ringColor?: string;
  fontSize?: number;
  label?: string;
  filePath?: string;
}

export interface ParticleOptions {
  effect?: "confetti" | "snow" | "rain" | "stars" | "bubbles";
  count?: number;
  backgroundColor?: string;
  duration?: number;
  filePath?: string;
}

// ─── Utilities ───

function ensureExportDir(dir?: string): string {
  const exportDir = dir || DEFAULT_EXPORT_DIR;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

function resolveOutputPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return safePath(filePath, path.dirname(filePath));
  }
  const exportDir = ensureExportDir();
  return safePath(filePath, exportDir);
}

function writeOutputFile(filePath: string, content: string): string {
  const resolved = resolveOutputPath(filePath);
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_FILE_SIZE) {
    throw new Error(`File size ${(bytes / 1024 / 1024).toFixed(1)}MB exceeds maximum of 50MB`);
  }
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, content, "utf-8");
  return resolved;
}

/** Sanitize user content to prevent XSS in HTML output */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── 1. Animated Video ───

/**
 * Creates a self-contained HTML5 "video" — animated scenes that auto-play with transitions.
 * Includes play/pause, progress bar, scene counter, keyboard & touch support.
 */
export function createAnimatedVideo(
  scenes: VideoScene[],
  options: VideoOptions = {}
): { path: string; size: number; sceneCount: number; totalDuration: number } {
  if (!scenes || scenes.length === 0) {
    throw new Error("At least one scene is required");
  }

  const title = options.title || "Soul Video";
  const theme = options.theme || "dark";
  const loop = options.loop ?? false;
  const filename = options.filePath || `video-${Date.now()}.html`;

  const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 5), 0);

  const themeColors: Record<string, { bg: string; text: string; accent: string; bar: string }> = {
    dark: { bg: "#0a0a0f", text: "#e8e8f0", accent: "#6c63ff", bar: "#1a1a2e" },
    light: { bg: "#f5f5f5", text: "#1a1a2e", accent: "#4285f4", bar: "#e0e0e0" },
    cinematic: { bg: "#0d0d0d", text: "#f0e6d3", accent: "#d4a853", bar: "#1a1510" },
  };
  const colors = themeColors[theme] || themeColors.dark;

  const scenesJson = JSON.stringify(
    scenes.map((s) => ({
      title: s.title,
      content: s.content,
      duration: s.duration || 5,
      background: s.background || "",
      transition: s.transition || "fade",
    }))
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  body { background: ${colors.bg}; color: ${colors.text}; display: flex; flex-direction: column; }

  .viewport { flex: 1; position: relative; overflow: hidden; cursor: pointer; }
  .scene {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 2rem; text-align: center;
    opacity: 0; pointer-events: none;
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .scene.active { opacity: 1; pointer-events: auto; }
  .scene.fade-active { opacity: 1; }
  .scene.slide-enter { opacity: 0; transform: translateX(100%); }
  .scene.slide-active { opacity: 1; transform: translateX(0); }
  .scene.slide-exit { opacity: 0; transform: translateX(-100%); }
  .scene.zoom-enter { opacity: 0; transform: scale(0.3); }
  .scene.zoom-active { opacity: 1; transform: scale(1); }
  .scene.zoom-exit { opacity: 0; transform: scale(1.5); }

  .scene-title {
    font-size: clamp(1.5rem, 4vw, 3rem); font-weight: 700;
    margin-bottom: 1.5rem; letter-spacing: -0.02em;
  }
  .scene-content {
    font-size: clamp(1rem, 2.5vw, 1.5rem); line-height: 1.7;
    max-width: 800px; width: 100%;
  }
  .scene-content ul, .scene-content ol { text-align: left; margin: 0.5rem auto; max-width: 600px; }
  .scene-content li { margin: 0.3rem 0; }
  .scene-content code { background: rgba(255,255,255,0.1); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }

  .controls {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.75rem 1.5rem; background: ${colors.bar};
    border-top: 1px solid rgba(255,255,255,0.08);
    user-select: none;
  }
  .btn {
    background: none; border: none; color: ${colors.text}; cursor: pointer;
    width: 36px; height: 36px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s; font-size: 1.1rem;
  }
  .btn:hover { background: rgba(255,255,255,0.1); }
  .btn svg { width: 18px; height: 18px; fill: currentColor; }

  .progress-wrap {
    flex: 1; height: 6px; background: rgba(255,255,255,0.12);
    border-radius: 3px; cursor: pointer; position: relative;
  }
  .progress-fill {
    height: 100%; background: ${colors.accent}; border-radius: 3px;
    width: 0%; transition: width 0.1s linear;
  }
  .progress-wrap:hover .progress-fill { height: 8px; margin-top: -1px; }

  .scene-counter {
    font-size: 0.85rem; min-width: 3.5rem; text-align: center;
    color: rgba(${colors.text === "#e8e8f0" ? "232,232,240" : "26,26,46"}, 0.7);
  }
  .time-display {
    font-size: 0.8rem; font-variant-numeric: tabular-nums; min-width: 5rem; text-align: center;
    color: rgba(${colors.text === "#e8e8f0" ? "232,232,240" : "26,26,46"}, 0.6);
  }

  .touch-hint {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    background: rgba(0,0,0,0.7); color: #fff; padding: 1rem 2rem;
    border-radius: 12px; font-size: 1.5rem; pointer-events: none;
    opacity: 0; transition: opacity 0.3s; z-index: 10;
  }
  .touch-hint.show { opacity: 1; }

  @media (max-width: 600px) {
    .controls { padding: 0.5rem 0.75rem; gap: 0.4rem; }
    .time-display { display: none; }
  }
</style>
</head>
<body>

<div class="viewport" id="viewport"></div>
<div class="touch-hint" id="hint"></div>

<div class="controls">
  <button class="btn" id="btnPrev" title="Previous (Left arrow)">
    <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
  </button>
  <button class="btn" id="btnPlay" title="Play/Pause (Space)">
    <svg id="iconPlay" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    <svg id="iconPause" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
  </button>
  <button class="btn" id="btnNext" title="Next (Right arrow)">
    <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
  </button>
  <span class="scene-counter" id="counter">1/1</span>
  <div class="progress-wrap" id="progressWrap">
    <div class="progress-fill" id="progressFill"></div>
  </div>
  <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
</div>

<script>
(function() {
  var scenes = ${scenesJson};
  var loopVideo = ${loop ? "true" : "false"};
  var viewport = document.getElementById("viewport");
  var progressFill = document.getElementById("progressFill");
  var counter = document.getElementById("counter");
  var timeDisplay = document.getElementById("timeDisplay");
  var btnPlay = document.getElementById("btnPlay");
  var btnPrev = document.getElementById("btnPrev");
  var btnNext = document.getElementById("btnNext");
  var iconPlay = document.getElementById("iconPlay");
  var iconPause = document.getElementById("iconPause");
  var hint = document.getElementById("hint");
  var progressWrap = document.getElementById("progressWrap");

  var currentScene = 0;
  var playing = true;
  var sceneStartTime = 0;
  var sceneElapsed = 0;
  var rafId = null;

  var totalDuration = 0;
  for (var i = 0; i < scenes.length; i++) totalDuration += scenes[i].duration;

  // Build scene DOM elements
  for (var i = 0; i < scenes.length; i++) {
    var sc = scenes[i];
    var div = document.createElement("div");
    div.className = "scene";
    div.setAttribute("data-idx", String(i));
    if (sc.background) div.style.background = sc.background;
    div.innerHTML =
      '<div class="scene-title">' + sc.title + '</div>' +
      '<div class="scene-content">' + sc.content + '</div>';
    viewport.appendChild(div);
  }

  var sceneEls = viewport.querySelectorAll(".scene");

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function getElapsedBefore(idx) {
    var t = 0;
    for (var j = 0; j < idx; j++) t += scenes[j].duration;
    return t;
  }

  function updateProgress() {
    if (!playing) return;
    var now = Date.now();
    sceneElapsed = (now - sceneStartTime) / 1000;
    var sceneDur = scenes[currentScene].duration;
    if (sceneElapsed >= sceneDur) {
      goNext();
      return;
    }
    var globalElapsed = getElapsedBefore(currentScene) + sceneElapsed;
    progressFill.style.width = ((globalElapsed / totalDuration) * 100) + "%";
    timeDisplay.textContent = formatTime(globalElapsed) + " / " + formatTime(totalDuration);
    rafId = requestAnimationFrame(updateProgress);
  }

  function showScene(idx) {
    var transition = scenes[idx].transition || "fade";
    for (var j = 0; j < sceneEls.length; j++) {
      sceneEls[j].className = "scene";
    }
    currentScene = idx;
    var el = sceneEls[idx];
    el.classList.add("active");
    el.classList.add(transition + "-active");
    counter.textContent = (idx + 1) + "/" + scenes.length;

    var globalElapsed = getElapsedBefore(idx);
    progressFill.style.width = ((globalElapsed / totalDuration) * 100) + "%";
    timeDisplay.textContent = formatTime(globalElapsed) + " / " + formatTime(totalDuration);

    sceneStartTime = Date.now();
    sceneElapsed = 0;

    if (playing) {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateProgress);
    }
  }

  function goNext() {
    cancelAnimationFrame(rafId);
    if (currentScene < scenes.length - 1) {
      showScene(currentScene + 1);
    } else if (loopVideo) {
      showScene(0);
    } else {
      setPlaying(false);
      progressFill.style.width = "100%";
      timeDisplay.textContent = formatTime(totalDuration) + " / " + formatTime(totalDuration);
    }
  }

  function goPrev() {
    cancelAnimationFrame(rafId);
    if (currentScene > 0) {
      showScene(currentScene - 1);
    } else if (loopVideo) {
      showScene(scenes.length - 1);
    }
  }

  function setPlaying(val) {
    playing = val;
    iconPlay.style.display = playing ? "none" : "";
    iconPause.style.display = playing ? "" : "none";
    if (playing) {
      sceneStartTime = Date.now() - sceneElapsed * 1000;
      rafId = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  function togglePlay() { setPlaying(!playing); }

  function flashHint(text) {
    hint.textContent = text;
    hint.classList.add("show");
    setTimeout(function(){ hint.classList.remove("show"); }, 600);
  }

  btnPlay.addEventListener("click", function(e) { e.stopPropagation(); togglePlay(); });
  btnNext.addEventListener("click", function(e) { e.stopPropagation(); goNext(); });
  btnPrev.addEventListener("click", function(e) { e.stopPropagation(); goPrev(); });

  progressWrap.addEventListener("click", function(e) {
    e.stopPropagation();
    var rect = progressWrap.getBoundingClientRect();
    var ratio = (e.clientX - rect.left) / rect.width;
    var targetTime = ratio * totalDuration;
    var acc = 0;
    for (var j = 0; j < scenes.length; j++) {
      if (acc + scenes[j].duration > targetTime) {
        cancelAnimationFrame(rafId);
        showScene(j);
        sceneElapsed = targetTime - acc;
        sceneStartTime = Date.now() - sceneElapsed * 1000;
        if (playing) { rafId = requestAnimationFrame(updateProgress); }
        return;
      }
      acc += scenes[j].duration;
    }
  });

  document.addEventListener("keydown", function(e) {
    if (e.code === "Space") {
      e.preventDefault(); togglePlay();
      flashHint(playing ? "\u25B6" : "\u23F8");
    } else if (e.code === "ArrowRight") {
      e.preventDefault(); goNext();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault(); goPrev();
    }
  });

  var touchStartX = 0;
  viewport.addEventListener("touchstart", function(e) {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  viewport.addEventListener("touchend", function(e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext(); else goPrev();
    } else {
      togglePlay();
    }
  }, { passive: true });

  viewport.addEventListener("click", function() { togglePlay(); });

  // Start playback
  showScene(0);
})();
</script>
</body>
</html>`;

  const resolvedPath = writeOutputFile(filename, html);
  const size = fs.statSync(resolvedPath).size;

  return { path: resolvedPath, size, sceneCount: scenes.length, totalDuration };
}

// ─── 2. Text Animation ───

/**
 * Creates an SVG with animated text effects.
 * Styles: typewriter, fade-words, bounce, slide-up, glow
 */
export function createTextAnimation(
  text: string,
  options: TextAnimationOptions = {}
): { path: string; size: number; style: string } {
  if (!text || text.trim().length === 0) {
    throw new Error("Text content is required");
  }

  const style = options.style || "typewriter";
  const fontSize = options.fontSize || 48;
  const color = options.color || "#e8e8f0";
  const bg = options.backgroundColor || "#0a0a1a";
  const width = options.width || 800;
  const height = options.height || 200;
  const duration = options.duration || 3;
  const fontFamily = options.fontFamily || "monospace, 'Courier New'";
  const filename = options.filePath || `text-anim-${Date.now()}.svg`;

  const escaped = escapeHtml(text);
  let svgContent = "";

  switch (style) {
    case "typewriter": {
      const charCount = text.length;
      const charDur = duration / charCount;
      let tspans = "";
      for (let i = 0; i < charCount; i++) {
        const ch = escapeHtml(text[i]);
        const begin = (charDur * i).toFixed(3);
        tspans += `<tspan style="opacity:0"><animate attributeName="opacity" from="0" to="1" dur="0.05s" begin="${begin}s" fill="freeze"/>${ch === " " ? "&#160;" : ch}</tspan>`;
      }
      svgContent = `
  <text x="40" y="${height / 2 + fontSize / 3}" font-family="${fontFamily}" font-size="${fontSize}" fill="${color}">
    ${tspans}
  </text>
  <rect x="40" y="${height / 2 - fontSize / 2}" width="3" height="${fontSize * 1.1}" fill="${color}">
    <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>
  </rect>`;
      break;
    }

    case "fade-words": {
      const words = text.split(/\s+/);
      const wordDur = duration / words.length;
      let xOffset = 40;
      let tspans = "";
      for (let i = 0; i < words.length; i++) {
        const word = escapeHtml(words[i]);
        const begin = (wordDur * i).toFixed(3);
        tspans += `<tspan x="${xOffset}" style="opacity:0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${begin}s" fill="freeze"/>${word} </tspan>`;
        xOffset += (words[i].length + 1) * fontSize * 0.55;
        if (xOffset > width - 80) xOffset = 40;
      }
      svgContent = `
  <text y="${height / 2 + fontSize / 3}" font-family="'Segoe UI', Arial, sans-serif" font-size="${fontSize}" fill="${color}">
    ${tspans}
  </text>`;
      break;
    }

    case "bounce": {
      let chars = "";
      const spacing = Math.min(fontSize * 0.7, (width - 80) / text.length);
      const startX = Math.max(40, (width - text.length * spacing) / 2);
      for (let i = 0; i < text.length; i++) {
        const ch = escapeHtml(text[i]);
        const x = startX + i * spacing;
        const delay = (i * 0.1).toFixed(2);
        chars += `
  <text x="${x}" y="${height / 2 + fontSize / 3}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${fontSize}" fill="${color}" text-anchor="middle" style="opacity:0">
    ${ch === " " ? "&#160;" : ch}
    <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${delay}s" fill="freeze"/>
    <animateTransform attributeName="transform" type="translate"
      values="0,${-fontSize};0,8;0,-4;0,0" dur="0.5s" begin="${delay}s" fill="freeze"/>
  </text>`;
      }
      svgContent = chars;
      break;
    }

    case "slide-up": {
      const words = text.split(/\s+/);
      const wordDur = duration / words.length;
      let chars = "";
      let xPos = 40;
      for (let i = 0; i < words.length; i++) {
        const word = escapeHtml(words[i]);
        const delay = (wordDur * i).toFixed(3);
        chars += `
  <text x="${xPos}" y="${height / 2 + fontSize / 3}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${fontSize}" fill="${color}" style="opacity:0">
    ${word}
    <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}s" fill="freeze"/>
    <animateTransform attributeName="transform" type="translate"
      values="0,30;0,0" dur="0.5s" begin="${delay}s" fill="freeze"/>
  </text>`;
        xPos += (words[i].length + 1) * fontSize * 0.55;
        if (xPos > width - 80) xPos = 40;
      }
      svgContent = chars;
      break;
    }

    case "glow": {
      svgContent = `
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <text x="${width / 2}" y="${height / 2 + fontSize / 3}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${fontSize}" fill="${color}" text-anchor="middle" filter="url(#glow)" style="opacity:0">
    ${escaped}
    <animate attributeName="opacity" values="0;1;0.7;1" dur="${duration}s" fill="freeze"/>
  </text>`;
      break;
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  ${svgContent}
</svg>`;

  const resolvedPath = writeOutputFile(filename, svg);
  const size = fs.statSync(resolvedPath).size;

  return { path: resolvedPath, size, style };
}

// ─── 3. Countdown Timer ───

/**
 * Creates an SVG countdown animation with a circular progress ring.
 */
export function createCountdownTimer(
  seconds: number,
  options: CountdownOptions = {}
): { path: string; size: number; seconds: number } {
  if (seconds <= 0 || seconds > 3600) {
    throw new Error("Countdown must be between 1 and 3600 seconds");
  }

  const svgSize = options.size || 300;
  const color = options.color || "#e8e8f0";
  const bg = options.backgroundColor || "#0a0a1a";
  const ringColor = options.ringColor || "#6c63ff";
  const fSize = options.fontSize || Math.floor(svgSize / 3);
  const label = options.label ? escapeHtml(options.label) : "";
  const filename = options.filePath || `countdown-${Date.now()}.svg`;

  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const radius = (svgSize / 2) - 20;
  const circumference = 2 * Math.PI * radius;

  const values: string[] = [];
  for (let i = seconds; i >= 0; i--) {
    values.push(String(i));
  }

  const ticks: string[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const x1 = cx + (radius - 12) * Math.cos(angle);
    const y1 = cy + (radius - 12) * Math.sin(angle);
    const x2 = cx + (radius - 4) * Math.cos(angle);
    const y2 = cy + (radius - 4) * Math.sin(angle);
    ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>`);
  }

  const labelSvg = label
    ? `<text x="${cx}" y="${cy + fSize / 3 + fSize * 0.6}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${Math.floor(fSize / 3)}" fill="rgba(232,232,240,0.6)"
    text-anchor="middle">${label}</text>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}">
  <rect width="${svgSize}" height="${svgSize}" fill="${bg}" rx="16"/>

  <!-- Background ring -->
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8"/>

  <!-- Progress ring -->
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${ringColor}"
    stroke-width="8" stroke-linecap="round"
    stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="0"
    transform="rotate(-90 ${cx} ${cy})">
    <animate attributeName="stroke-dashoffset"
      from="0" to="${circumference.toFixed(2)}" dur="${seconds}s" fill="freeze"/>
  </circle>

  <!-- Countdown number -->
  <text x="${cx}" y="${cy + fSize / 3}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${fSize}" fill="${color}" text-anchor="middle" font-weight="700">
    ${values[0]}
    <animate attributeName="textContent" values="${values.join(";")}"
      dur="${seconds}s" fill="freeze" calcMode="discrete"/>
  </text>

  <!-- Tick marks -->
  ${ticks.join("\n  ")}

  ${labelSvg}

  <!-- Final pulse -->
  <circle cx="${cx}" cy="${cy}" r="${(radius * 0.3).toFixed(1)}" fill="${ringColor}" opacity="0">
    <animate attributeName="opacity" values="0;0;0.4;0" dur="${seconds}s" fill="freeze"
      keyTimes="0;0.95;0.98;1"/>
    <animate attributeName="r" values="${(radius * 0.3).toFixed(1)};${(radius * 0.3).toFixed(1)};${(radius * 0.8).toFixed(1)};${radius.toFixed(1)}"
      dur="${seconds}s" fill="freeze" keyTimes="0;0.95;0.98;1"/>
  </circle>
</svg>`;

  const resolvedPath = writeOutputFile(filename, svg);
  const fileSize = fs.statSync(resolvedPath).size;

  return { path: resolvedPath, size: fileSize, seconds };
}

// ─── 4. Particle Animation ───

/**
 * Creates a self-contained HTML with CSS-only particle effects.
 * Effects: confetti, snow, rain, stars, bubbles
 */
export function createParticleAnimation(
  options: ParticleOptions = {}
): { path: string; size: number; effect: string; particleCount: number } {
  const effect = options.effect || "confetti";
  const count = Math.min(options.count || 60, 200);
  const bg = options.backgroundColor || "#0a0a1a";
  const duration = options.duration || 10;
  const filename = options.filePath || `particles-${Date.now()}.html`;

  // Seeded pseudo-random for deterministic output
  let seed = 42;
  function rand(min: number, max: number): number {
    seed = (seed * 16807 + 0) % 2147483647;
    return min + (seed / 2147483647) * (max - min);
  }
  function randInt(min: number, max: number): number {
    return Math.floor(rand(min, max));
  }

  const confettiColors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6eb4", "#a66cff", "#54e346"];
  const particles: string[] = [];
  const keyframes: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = `p${i}`;
    let css = "";
    let kf = "";

    switch (effect) {
      case "confetti": {
        const x = rand(0, 100);
        const sz = rand(6, 14);
        const dur = rand(2, 5);
        const delay = rand(0, duration * 0.8);
        const col = confettiColors[i % confettiColors.length];
        const rot = randInt(0, 360);
        const endRot = rot + randInt(180, 720);
        const drift = rand(-80, 80);
        css = `.${id}{position:absolute;left:${x.toFixed(1)}%;top:-20px;width:${sz.toFixed(1)}px;height:${(sz * 0.6).toFixed(1)}px;background:${col};border-radius:2px;animation:${id}f ${dur.toFixed(2)}s ${delay.toFixed(2)}s infinite ease-in;transform:rotate(${rot}deg)}`;
        kf = `@keyframes ${id}f{0%{top:-20px;opacity:1;transform:rotate(${rot}deg) translateX(0)}100%{top:110%;opacity:0.3;transform:rotate(${endRot}deg) translateX(${drift.toFixed(1)}px)}}`;
        break;
      }

      case "snow": {
        const x = rand(0, 100);
        const sz = rand(3, 10);
        const dur = rand(5, 15);
        const delay = rand(0, duration);
        const drift = rand(-40, 40);
        const op = rand(0.4, 0.9);
        css = `.${id}{position:absolute;left:${x.toFixed(1)}%;top:-20px;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;background:rgba(255,255,255,${op.toFixed(2)});border-radius:50%;animation:${id}f ${dur.toFixed(2)}s ${delay.toFixed(2)}s infinite linear}`;
        kf = `@keyframes ${id}f{0%{top:-20px;opacity:1;transform:translateX(0)}50%{transform:translateX(${drift.toFixed(1)}px)}100%{top:110%;opacity:0.2;transform:translateX(${(drift * 0.5).toFixed(1)}px)}}`;
        break;
      }

      case "rain": {
        const x = rand(0, 100);
        const len = rand(10, 30);
        const dur = rand(0.4, 1.2);
        const delay = rand(0, duration * 0.5);
        css = `.${id}{position:absolute;left:${x.toFixed(1)}%;top:-30px;width:2px;height:${len.toFixed(1)}px;background:linear-gradient(transparent,rgba(100,180,255,0.7));border-radius:1px;animation:${id}f ${dur.toFixed(2)}s ${delay.toFixed(2)}s infinite linear}`;
        kf = `@keyframes ${id}f{0%{top:-30px;opacity:1}100%{top:110%;opacity:0}}`;
        break;
      }

      case "stars": {
        const x = rand(5, 95);
        const y = rand(5, 95);
        const sz = rand(1, 4);
        const dur = rand(1, 4);
        const delay = rand(0, dur);
        css = `.${id}{position:absolute;left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;background:#fff;border-radius:50%;animation:${id}f ${dur.toFixed(2)}s ${delay.toFixed(2)}s infinite ease-in-out;box-shadow:0 0 ${(sz * 2).toFixed(1)}px rgba(255,255,255,0.5)}`;
        kf = `@keyframes ${id}f{0%,100%{opacity:0.2;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}`;
        break;
      }

      case "bubbles": {
        const x = rand(5, 95);
        const sz = rand(8, 40);
        const dur = rand(4, 12);
        const delay = rand(0, duration);
        const drift = rand(-30, 30);
        const op = rand(0.2, 0.5);
        css = `.${id}{position:absolute;left:${x.toFixed(1)}%;bottom:-${(sz + 10).toFixed(0)}px;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;border:2px solid rgba(100,180,255,${op.toFixed(2)});border-radius:50%;background:radial-gradient(ellipse at 30% 30%,rgba(255,255,255,0.15),transparent);animation:${id}f ${dur.toFixed(2)}s ${delay.toFixed(2)}s infinite ease-out}`;
        kf = `@keyframes ${id}f{0%{bottom:-${(sz + 10).toFixed(0)}px;opacity:1;transform:translateX(0) scale(1)}70%{opacity:0.7}100%{bottom:110%;opacity:0;transform:translateX(${drift.toFixed(1)}px) scale(0.6)}}`;
        break;
      }
    }

    particles.push(css);
    keyframes.push(kf);
  }

  const divs: string[] = [];
  for (let i = 0; i < count; i++) {
    divs.push(`<div class="p${i}"></div>`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Particle Effect - ${escapeHtml(effect)}</title>
<style>
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden}
  body{background:${bg}}
  .canvas{position:relative;width:100%;height:100%;overflow:hidden}
  ${particles.join("\n  ")}
  ${keyframes.join("\n  ")}
</style>
</head>
<body>
<div class="canvas">
  ${divs.join("\n  ")}
</div>
</body>
</html>`;

  const resolvedPath = writeOutputFile(filename, html);
  const fileSize = fs.statSync(resolvedPath).size;

  return { path: resolvedPath, size: fileSize, effect, particleCount: count };
}
