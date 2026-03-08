/**
 * Media Creator Engine — Soul's ability to create documents, images, and visualizations
 *
 * All output is generated with zero external dependencies:
 * 1. Documents — .txt, .md, .html, .csv, .json via Node.js fs
 * 2. SVG Images — charts, diagrams, badges via XML string generation
 * 3. Mermaid Diagrams — text-based syntax for any Mermaid renderer
 * 4. Dashboards — self-contained HTML with inline SVG charts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { safePath } from "./security.js";

// ─── Constants ───

const DEFAULT_EXPORT_DIR = path.join(os.homedir(), ".soul", "exports");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ─── Types ───

export interface HtmlSection {
  title: string;
  content: string;
  type?: "text" | "table" | "code" | "list" | "html";
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface SvgChartOptions {
  width?: number;
  height?: number;
  title?: string;
  showValues?: boolean;
  showGrid?: boolean;
  colors?: string[];
  backgroundColor?: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  shape?: "rect" | "rounded" | "circle" | "diamond" | "ellipse";
  color?: string;
}

export interface DiagramLink {
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "dotted";
}

export interface DashboardWidget {
  title: string;
  type: "bar" | "pie" | "line" | "stat" | "table" | "text";
  data: ChartDataPoint[] | { label: string; value: string | number } | string | string[][];
  options?: SvgChartOptions;
}

export type ChartType = "bar" | "pie" | "line";
export type DiagramType = "flowchart" | "mindmap" | "orgchart";
export type MermaidType = "flowchart" | "sequence" | "gantt" | "er" | "mindmap" | "classDiagram" | "stateDiagram";

// ─── Utilities ───

function ensureExportDir(dir?: string): string {
  const exportDir = dir || DEFAULT_EXPORT_DIR;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

function resolveOutputPath(filePath: string): string {
  // If absolute path, validate it's within safe bounds
  if (path.isAbsolute(filePath)) {
    return safePath(filePath, path.dirname(filePath));
  }
  // Relative paths go to exports dir
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

/** Default color palette */
const DEFAULT_COLORS = [
  "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01",
  "#46bdc6", "#7b61ff", "#f538a0", "#00bfa5", "#ff8a65",
  "#ab47bc", "#5c6bc0", "#26a69a", "#d4e157", "#ffa726",
];

function getColor(index: number, colors?: string[]): string {
  const palette = colors && colors.length > 0 ? colors : DEFAULT_COLORS;
  return palette[index % palette.length];
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── 1. Document Creation ───

export function createTextDocument(
  content: string,
  filePath: string,
  format: "txt" | "md" | "html" = "txt"
): { path: string; size: number; format: string } {
  let output: string;

  switch (format) {
    case "html":
      output = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Document</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}
pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto}</style>
</head>
<body>${escapeHtml(content)}</body>
</html>`;
      break;
    case "md":
    case "txt":
    default:
      output = content;
      break;
  }

  const resolved = writeOutputFile(filePath, output);
  return { path: resolved, size: Buffer.byteLength(output, "utf-8"), format };
}

export function createHtmlReport(
  title: string,
  sections: HtmlSection[],
  filePath: string
): { path: string; size: number; sectionCount: number } {
  const sectionHtml = sections.map((section) => {
    const sTitle = escapeHtml(section.title);
    let body: string;

    switch (section.type) {
      case "table": {
        // Content is expected as a string with rows separated by \n and cells by |
        const rows = section.content.split("\n").filter(Boolean);
        if (rows.length === 0) {
          body = "<p>(empty table)</p>";
        } else {
          const headerCells = rows[0].split("|").map((c) => `<th>${escapeHtml(c.trim())}</th>`).join("");
          const bodyRows = rows.slice(1).map((row) => {
            const cells = row.split("|").map((c) => `<td>${escapeHtml(c.trim())}</td>`).join("");
            return `<tr>${cells}</tr>`;
          }).join("\n");
          body = `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
        }
        break;
      }
      case "code":
        body = `<pre><code>${escapeHtml(section.content)}</code></pre>`;
        break;
      case "list": {
        const items = section.content.split("\n").filter(Boolean)
          .map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
        body = `<ul>${items}</ul>`;
        break;
      }
      case "html":
        // Trusted HTML — use as-is (caller responsible for safety)
        body = section.content;
        break;
      case "text":
      default:
        body = section.content.split("\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
        break;
    }

    return `<section><h2>${sTitle}</h2>${body}</section>`;
  }).join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:900px;margin:0 auto;padding:2rem 1rem;color:#1a1a1a;line-height:1.6;background:#fafafa}
h1{font-size:1.8rem;margin-bottom:1.5rem;padding-bottom:.5rem;border-bottom:3px solid #4285f4;color:#1a1a1a}
h2{font-size:1.3rem;margin:1.5rem 0 .8rem;color:#333}
section{background:#fff;padding:1.5rem;margin-bottom:1rem;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
table{width:100%;border-collapse:collapse;margin:.5rem 0}
th,td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid #e0e0e0}
th{background:#f5f5f5;font-weight:600}
tr:hover td{background:#f8f9fa}
pre{background:#263238;color:#eeffff;padding:1rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
ul{padding-left:1.5rem}
li{margin:.3rem 0}
p{margin:.5rem 0}
.footer{text-align:center;color:#999;font-size:.8rem;margin-top:2rem;padding-top:1rem;border-top:1px solid #e0e0e0}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${sectionHtml}
<div class="footer">Generated by Soul — ${new Date().toISOString().split("T")[0]}</div>
</body>
</html>`;

  const resolved = writeOutputFile(filePath, html);
  return { path: resolved, size: Buffer.byteLength(html, "utf-8"), sectionCount: sections.length };
}

export function createCsvFile(
  headers: string[],
  rows: string[][],
  filePath: string
): { path: string; size: number; rowCount: number } {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsv).join(","));
  const content = [headerLine, ...dataLines].join("\n") + "\n";
  const resolved = writeOutputFile(filePath, content);
  return { path: resolved, size: Buffer.byteLength(content, "utf-8"), rowCount: rows.length };
}

export function createJsonFile(
  data: unknown,
  filePath: string
): { path: string; size: number } {
  const content = JSON.stringify(data, null, 2) + "\n";
  const resolved = writeOutputFile(filePath, content);
  return { path: resolved, size: Buffer.byteLength(content, "utf-8") };
}

// ─── 2. SVG Image Creation ───

export function createSvgChart(
  type: ChartType,
  data: ChartDataPoint[],
  options: SvgChartOptions = {}
): string {
  const w = options.width || 600;
  const h = options.height || 400;
  const bg = options.backgroundColor || "#ffffff";
  const showValues = options.showValues !== false;

  switch (type) {
    case "bar":
      return createBarChart(data, w, h, bg, showValues, options);
    case "pie":
      return createPieChart(data, w, h, bg, showValues, options);
    case "line":
      return createLineChart(data, w, h, bg, showValues, options);
    default:
      throw new Error(`Unsupported chart type: ${type}`);
  }
}

function createBarChart(
  data: ChartDataPoint[],
  w: number, h: number, bg: string,
  showValues: boolean, options: SvgChartOptions
): string {
  const padding = { top: 50, right: 20, bottom: 60, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.min(60, (chartW / data.length) * 0.7);
  const barGap = (chartW - barWidth * data.length) / (data.length + 1);

  let bars = "";
  let labels = "";
  let values = "";

  data.forEach((d, i) => {
    const x = padding.left + barGap * (i + 1) + barWidth * i;
    const barH = (d.value / maxVal) * chartH;
    const y = padding.top + chartH - barH;
    const color = d.color || getColor(i, options.colors);

    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${color}" rx="3">
      <animate attributeName="height" from="0" to="${barH}" dur="0.5s" fill="freeze"/>
      <animate attributeName="y" from="${padding.top + chartH}" to="${y}" dur="0.5s" fill="freeze"/>
    </rect>\n`;

    const labelX = x + barWidth / 2;
    labels += `<text x="${labelX}" y="${padding.top + chartH + 20}" text-anchor="middle" font-size="11" fill="#666">${escapeHtml(d.label)}</text>\n`;

    if (showValues) {
      values += `<text x="${labelX}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">${d.value}</text>\n`;
    }
  });

  // Y-axis grid lines
  let gridLines = "";
  if (options.showGrid !== false) {
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = padding.top + (chartH / steps) * i;
      const val = Math.round(maxVal - (maxVal / steps) * i);
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#e0e0e0" stroke-dasharray="4,4"/>\n`;
      gridLines += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>\n`;
    }
  }

  const titleSvg = options.title
    ? `<text x="${w / 2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeHtml(options.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}" rx="8"/>
${titleSvg}
${gridLines}
<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>
<line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>
${bars}
${labels}
${values}
</svg>`;
}

function createPieChart(
  data: ChartDataPoint[],
  w: number, h: number, bg: string,
  showValues: boolean, options: SvgChartOptions
): string {
  const cx = w / 2;
  const cy = h / 2 + (options.title ? 15 : 0);
  const r = Math.min(w, h) / 2 - 60;
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  let slices = "";
  let legendItems = "";
  let startAngle = -Math.PI / 2; // Start from top

  data.forEach((d, i) => {
    const fraction = d.value / total;
    const angle = fraction * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const color = d.color || getColor(i, options.colors);

    // SVG arc path
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    if (data.length === 1) {
      // Full circle for single item
      slices += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>\n`;
    } else {
      slices += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="${bg}" stroke-width="2"/>\n`;
    }

    // Value label on slice
    if (showValues && fraction > 0.05) {
      const midAngle = startAngle + angle / 2;
      const labelR = r * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      slices += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="bold" fill="#fff">${(fraction * 100).toFixed(0)}%</text>\n`;
    }

    // Legend
    const legendY = 30 + i * 20;
    legendItems += `<rect x="${w - 140}" y="${legendY}" width="12" height="12" fill="${color}" rx="2"/>\n`;
    legendItems += `<text x="${w - 122}" y="${legendY + 10}" font-size="11" fill="#666">${escapeHtml(d.label)} (${d.value})</text>\n`;

    startAngle = endAngle;
  });

  const titleSvg = options.title
    ? `<text x="${w / 2}" y="24" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeHtml(options.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}" rx="8"/>
${titleSvg}
${slices}
${legendItems}
</svg>`;
}

function createLineChart(
  data: ChartDataPoint[],
  w: number, h: number, bg: string,
  showValues: boolean, options: SvgChartOptions
): string {
  const padding = { top: 50, right: 30, bottom: 60, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const minVal = Math.min(...data.map((d) => d.value), 0);
  const range = maxVal - minVal || 1;
  const color = options.colors?.[0] || "#4285f4";

  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padding.top + chartH - ((d.value - minVal) / range) * chartH;
    return { x, y, d };
  });

  // Build polyline
  const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Area fill
  const areaPath = `M${points[0].x},${padding.top + chartH} ` +
    points.map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${points[points.length - 1].x},${padding.top + chartH} Z`;

  // Dots and labels
  let dots = "";
  let labels = "";
  let valueTexts = "";
  points.forEach((p, i) => {
    dots += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>\n`;
    if (i % Math.max(1, Math.floor(data.length / 10)) === 0 || i === data.length - 1) {
      labels += `<text x="${p.x}" y="${padding.top + chartH + 20}" text-anchor="middle" font-size="10" fill="#666">${escapeHtml(p.d.label)}</text>\n`;
    }
    if (showValues) {
      valueTexts += `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10" font-weight="bold" fill="#333">${p.d.value}</text>\n`;
    }
  });

  // Grid
  let gridLines = "";
  if (options.showGrid !== false) {
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = padding.top + (chartH / steps) * i;
      const val = (maxVal - ((maxVal - minVal) / steps) * i).toFixed(0);
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#e0e0e0" stroke-dasharray="4,4"/>\n`;
      gridLines += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>\n`;
    }
  }

  const titleSvg = options.title
    ? `<text x="${w / 2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeHtml(options.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}" rx="8"/>
${titleSvg}
${gridLines}
<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#ccc"/>
<line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" stroke="#ccc"/>
<path d="${areaPath}" fill="${color}" opacity="0.1"/>
<polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${dots}
${labels}
${valueTexts}
</svg>`;
}

// ─── SVG Diagrams ───

export function createSvgDiagram(
  type: DiagramType,
  nodes: DiagramNode[],
  links: DiagramLink[]
): string {
  switch (type) {
    case "flowchart":
      return createFlowchartSvg(nodes, links);
    case "mindmap":
      return createMindmapSvg(nodes, links);
    case "orgchart":
      return createOrgchartSvg(nodes, links);
    default:
      throw new Error(`Unsupported diagram type: ${type}`);
  }
}

function createFlowchartSvg(nodes: DiagramNode[], links: DiagramLink[]): string {
  const nodeW = 160;
  const nodeH = 50;
  const gapX = 60;
  const gapY = 80;
  const cols = Math.min(4, Math.ceil(Math.sqrt(nodes.length)));

  // Position nodes in a grid
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(node.id, {
      x: 40 + col * (nodeW + gapX),
      y: 40 + row * (nodeH + gapY),
    });
  });

  const totalW = 40 * 2 + cols * (nodeW + gapX) - gapX;
  const totalH = 40 * 2 + Math.ceil(nodes.length / cols) * (nodeH + gapY) - gapY;

  // Draw links
  let linksSvg = "";
  links.forEach((link) => {
    const from = positions.get(link.from);
    const to = positions.get(link.to);
    if (!from || !to) return;

    const x1 = from.x + nodeW / 2;
    const y1 = from.y + nodeH;
    const x2 = to.x + nodeW / 2;
    const y2 = to.y;

    const strokeStyle = link.style === "dashed" ? "stroke-dasharray='8,4'" :
      link.style === "dotted" ? "stroke-dasharray='3,3'" : "";

    // Curved path
    const midY = (y1 + y2) / 2;
    linksSvg += `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="#999" stroke-width="1.5" ${strokeStyle} marker-end="url(#arrow)"/>\n`;

    if (link.label) {
      const lx = (x1 + x2) / 2;
      const ly = midY - 6;
      linksSvg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="#666">${escapeHtml(link.label)}</text>\n`;
    }
  });

  // Draw nodes
  let nodesSvg = "";
  nodes.forEach((node) => {
    const pos = positions.get(node.id)!;
    const color = node.color || "#4285f4";
    const x = pos.x;
    const y = pos.y;

    switch (node.shape) {
      case "circle":
        nodesSvg += `<circle cx="${x + nodeW / 2}" cy="${y + nodeH / 2}" r="${nodeH / 2}" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="2"/>\n`;
        break;
      case "diamond": {
        const cx = x + nodeW / 2;
        const cy = y + nodeH / 2;
        nodesSvg += `<polygon points="${cx},${y} ${x + nodeW},${cy} ${cx},${y + nodeH} ${x},${cy}" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="2"/>\n`;
        break;
      }
      case "rounded":
        nodesSvg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="25" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="2"/>\n`;
        break;
      case "ellipse":
        nodesSvg += `<ellipse cx="${x + nodeW / 2}" cy="${y + nodeH / 2}" rx="${nodeW / 2}" ry="${nodeH / 2}" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="2"/>\n`;
        break;
      case "rect":
      default:
        nodesSvg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="2"/>\n`;
        break;
    }

    nodesSvg += `<text x="${x + nodeW / 2}" y="${y + nodeH / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#333">${escapeHtml(node.label)}</text>\n`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#999"/>
  </marker>
</defs>
<rect width="${totalW}" height="${totalH}" fill="#fff" rx="8"/>
${linksSvg}
${nodesSvg}
</svg>`;
}

function createMindmapSvg(nodes: DiagramNode[], links: DiagramLink[]): string {
  if (nodes.length === 0) return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="100" y="50" text-anchor="middle">Empty mindmap</text></svg>`;

  const centerNode = nodes[0];
  const childNodes = nodes.slice(1);
  const cx = 400;
  const cy = 300;
  const radius = 200;

  let svg = "";

  // Draw links from center to children
  childNodes.forEach((child, i) => {
    const angle = (i / Math.max(childNodes.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const color = child.color || getColor(i);

    // Curved link
    const midX = (cx + x) / 2;
    const midY = (cy + y) / 2 - 20;
    svg += `<path d="M${cx},${cy} Q${midX},${midY} ${x},${y}" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>\n`;

    // Child node
    const labelWidth = Math.max(80, child.label.length * 8 + 20);
    svg += `<rect x="${x - labelWidth / 2}" y="${y - 18}" width="${labelWidth}" height="36" rx="18" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>\n`;
    svg += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="12" fill="#333">${escapeHtml(child.label)}</text>\n`;
  });

  // Center node
  const centerColor = centerNode.color || "#4285f4";
  const centerLabelW = Math.max(100, centerNode.label.length * 9 + 30);
  svg += `<ellipse cx="${cx}" cy="${cy}" rx="${centerLabelW / 2}" ry="30" fill="${centerColor}" opacity="0.2" stroke="${centerColor}" stroke-width="2.5"/>\n`;
  svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="bold" fill="#333">${escapeHtml(centerNode.label)}</text>\n`;

  const w = 800;
  const h = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="#fff" rx="8"/>
${svg}
</svg>`;
}

function createOrgchartSvg(nodes: DiagramNode[], links: DiagramLink[]): string {
  // Build hierarchy from links
  const childrenMap = new Map<string, string[]>();
  const hasParent = new Set<string>();
  links.forEach((link) => {
    const children = childrenMap.get(link.from) || [];
    children.push(link.to);
    childrenMap.set(link.from, children);
    hasParent.add(link.to);
  });

  const roots = nodes.filter((n) => !hasParent.has(n.id));
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

  // BFS to assign levels
  const levels = new Map<string, number>();
  const queue = roots.map((r) => ({ id: r.id, level: 0 }));
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (levels.has(id)) continue;
    levels.set(id, level);
    const children = childrenMap.get(id) || [];
    children.forEach((c) => queue.push({ id: c, level: level + 1 }));
  }
  // Assign level 0 to any unconnected nodes
  nodes.forEach((n) => { if (!levels.has(n.id)) levels.set(n.id, 0); });

  const nodeW = 150;
  const nodeH = 50;
  const gapX = 40;
  const gapY = 70;

  // Group by level
  const byLevel = new Map<number, DiagramNode[]>();
  nodes.forEach((n) => {
    const lvl = levels.get(n.id) || 0;
    const arr = byLevel.get(lvl) || [];
    arr.push(n);
    byLevel.set(lvl, arr);
  });

  const maxLevel = Math.max(...Array.from(byLevel.keys()), 0);
  const maxNodesInLevel = Math.max(...Array.from(byLevel.values()).map((a) => a.length), 1);
  const totalW = Math.max(600, maxNodesInLevel * (nodeW + gapX) + 80);
  const totalH = (maxLevel + 1) * (nodeH + gapY) + 80;

  const positions = new Map<string, { x: number; y: number }>();
  byLevel.forEach((levelNodes, level) => {
    const levelW = levelNodes.length * (nodeW + gapX) - gapX;
    const startX = (totalW - levelW) / 2;
    levelNodes.forEach((n, i) => {
      positions.set(n.id, {
        x: startX + i * (nodeW + gapX),
        y: 40 + level * (nodeH + gapY),
      });
    });
  });

  let linksSvg = "";
  links.forEach((link) => {
    const from = positions.get(link.from);
    const to = positions.get(link.to);
    if (!from || !to) return;
    const x1 = from.x + nodeW / 2;
    const y1 = from.y + nodeH;
    const x2 = to.x + nodeW / 2;
    const y2 = to.y;
    linksSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#bbb" stroke-width="1.5"/>\n`;
  });

  let nodesSvg = "";
  nodes.forEach((n) => {
    const pos = positions.get(n.id);
    if (!pos) return;
    const color = n.color || "#4285f4";
    nodesSvg += `<rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>\n`;
    nodesSvg += `<text x="${pos.x + nodeW / 2}" y="${pos.y + nodeH / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#333">${escapeHtml(n.label)}</text>\n`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
<rect width="${totalW}" height="${totalH}" fill="#fff" rx="8"/>
${linksSvg}
${nodesSvg}
</svg>`;
}

// ─── SVG Badge ───

export function createSvgBadge(label: string, value: string, color: string = "#4285f4"): string {
  const labelW = Math.max(40, label.length * 7 + 12);
  const valueW = Math.max(40, value.length * 7 + 12);
  const totalW = labelW + valueW;
  const h = 22;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}">
<rect width="${totalW}" height="${h}" rx="4" fill="#555"/>
<rect x="${labelW}" width="${valueW}" height="${h}" rx="4" fill="${color}"/>
<rect x="${labelW}" width="4" height="${h}" fill="${color}"/>
<text x="${labelW / 2}" y="15" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#fff">${escapeHtml(label)}</text>
<text x="${labelW + valueW / 2}" y="15" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#fff">${escapeHtml(value)}</text>
</svg>`;
}

// ─── SVG QR-like Code ───

export function createSvgQrCode(text: string, size: number = 200): string {
  // Generate a deterministic visual code from the text (NOT a real QR — a visual hash pattern)
  const gridSize = 21;
  const cellSize = size / gridSize;
  let cells = "";

  // Simple hash-based pattern
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  // Fixed corner patterns (like QR finder patterns)
  const finderPositions = [
    { x: 0, y: 0 }, { x: gridSize - 7, y: 0 }, { x: 0, y: gridSize - 7 },
  ];

  for (const fp of finderPositions) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isBorder = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const isCenter = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        if (isBorder || isCenter) {
          cells += `<rect x="${(fp.x + dx) * cellSize}" y="${(fp.y + dy) * cellSize}" width="${cellSize}" height="${cellSize}" fill="#000"/>\n`;
        }
      }
    }
  }

  // Data area — deterministic pattern from hash
  const finderArea = (x: number, y: number) => {
    for (const fp of finderPositions) {
      if (x >= fp.x && x < fp.x + 7 && y >= fp.y && y < fp.y + 7) return true;
    }
    return false;
  };

  let seed = Math.abs(hash);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (finderArea(x, y)) continue;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 3 !== 0) continue; // ~33% fill
      cells += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="#000"/>\n`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#fff"/>
${cells}
</svg>`;
}

// ─── 3. Mermaid Diagram Generation ───

export function createMermaidDiagram(type: MermaidType, content: MermaidContent): string {
  switch (type) {
    case "flowchart":
      return createMermaidFlowchart(content as MermaidFlowchart);
    case "sequence":
      return createMermaidSequence(content as MermaidSequence);
    case "gantt":
      return createMermaidGantt(content as MermaidGantt);
    case "er":
      return createMermaidER(content as MermaidER);
    case "mindmap":
      return createMermaidMindmap(content as MermaidMindmap);
    case "classDiagram":
      return createMermaidClass(content as MermaidClassDiagram);
    case "stateDiagram":
      return createMermaidState(content as MermaidStateDiagram);
    default:
      throw new Error(`Unsupported Mermaid type: ${type}`);
  }
}

// Mermaid content types
export interface MermaidFlowchart {
  direction?: "TB" | "TD" | "BT" | "LR" | "RL";
  nodes: { id: string; label: string; shape?: "rect" | "rounded" | "circle" | "diamond" | "stadium" }[];
  edges: { from: string; to: string; label?: string; style?: "arrow" | "dotted" | "thick" }[];
}

export interface MermaidSequence {
  participants: string[];
  messages: { from: string; to: string; text: string; type?: "solid" | "dashed" | "activate" | "deactivate" }[];
}

export interface MermaidGantt {
  title?: string;
  dateFormat?: string;
  sections: { name: string; tasks: { name: string; status?: string; start: string; duration: string }[] }[];
}

export interface MermaidER {
  entities: { name: string; attributes: { name: string; type: string; key?: boolean }[] }[];
  relationships: { from: string; to: string; label: string; fromCardinality: string; toCardinality: string }[];
}

export interface MermaidMindmap {
  root: string;
  children: MermaidMindmapNode[];
}

export interface MermaidMindmapNode {
  label: string;
  children?: MermaidMindmapNode[];
}

export interface MermaidClassDiagram {
  classes: { name: string; members: string[]; methods: string[] }[];
  relationships: { from: string; to: string; type: "inheritance" | "composition" | "aggregation" | "association" | "dependency"; label?: string }[];
}

export interface MermaidStateDiagram {
  states: { id: string; label?: string; type?: "normal" | "start" | "end" | "fork" | "join" }[];
  transitions: { from: string; to: string; label?: string }[];
}

export type MermaidContent =
  | MermaidFlowchart
  | MermaidSequence
  | MermaidGantt
  | MermaidER
  | MermaidMindmap
  | MermaidClassDiagram
  | MermaidStateDiagram;

function createMermaidFlowchart(content: MermaidFlowchart): string {
  const dir = content.direction || "TD";
  let mermaid = `flowchart ${dir}\n`;

  for (const node of content.nodes) {
    const label = node.label.replace(/"/g, "'");
    switch (node.shape) {
      case "rounded": mermaid += `    ${node.id}("${label}")\n`; break;
      case "circle": mermaid += `    ${node.id}(("${label}"))\n`; break;
      case "diamond": mermaid += `    ${node.id}{"${label}"}\n`; break;
      case "stadium": mermaid += `    ${node.id}(["${label}"])\n`; break;
      case "rect":
      default: mermaid += `    ${node.id}["${label}"]\n`; break;
    }
  }

  mermaid += "\n";

  for (const edge of content.edges) {
    const label = edge.label ? `|"${edge.label.replace(/"/g, "'")}"|` : "";
    switch (edge.style) {
      case "dotted": mermaid += `    ${edge.from} -.-> ${label} ${edge.to}\n`; break;
      case "thick": mermaid += `    ${edge.from} ==> ${label} ${edge.to}\n`; break;
      case "arrow":
      default: mermaid += `    ${edge.from} --> ${label} ${edge.to}\n`; break;
    }
  }

  return mermaid.trimEnd();
}

function createMermaidSequence(content: MermaidSequence): string {
  let mermaid = "sequenceDiagram\n";
  for (const p of content.participants) {
    mermaid += `    participant ${p}\n`;
  }
  mermaid += "\n";
  for (const msg of content.messages) {
    const arrow = msg.type === "dashed" ? "-->>" : "->>";
    mermaid += `    ${msg.from}${arrow}${msg.to}: ${msg.text}\n`;
    if (msg.type === "activate") mermaid += `    activate ${msg.to}\n`;
    if (msg.type === "deactivate") mermaid += `    deactivate ${msg.to}\n`;
  }
  return mermaid.trimEnd();
}

function createMermaidGantt(content: MermaidGantt): string {
  let mermaid = "gantt\n";
  if (content.title) mermaid += `    title ${content.title}\n`;
  mermaid += `    dateFormat ${content.dateFormat || "YYYY-MM-DD"}\n\n`;

  for (const section of content.sections) {
    mermaid += `    section ${section.name}\n`;
    for (const task of section.tasks) {
      const status = task.status ? `${task.status}, ` : "";
      mermaid += `    ${task.name} :${status}${task.start}, ${task.duration}\n`;
    }
  }
  return mermaid.trimEnd();
}

function createMermaidER(content: MermaidER): string {
  let mermaid = "erDiagram\n";

  for (const entity of content.entities) {
    mermaid += `    ${entity.name} {\n`;
    for (const attr of entity.attributes) {
      const keyMark = attr.key ? " PK" : "";
      mermaid += `        ${attr.type} ${attr.name}${keyMark}\n`;
    }
    mermaid += "    }\n";
  }

  mermaid += "\n";
  for (const rel of content.relationships) {
    mermaid += `    ${rel.from} ${rel.fromCardinality}--${rel.toCardinality} ${rel.to} : "${rel.label}"\n`;
  }
  return mermaid.trimEnd();
}

function createMermaidMindmap(content: MermaidMindmap): string {
  let mermaid = "mindmap\n";
  mermaid += `    root((${content.root}))\n`;

  function addChildren(children: MermaidMindmapNode[], indent: number): void {
    const prefix = "    ".repeat(indent);
    for (const child of children) {
      mermaid += `${prefix}${child.label}\n`;
      if (child.children) {
        addChildren(child.children, indent + 1);
      }
    }
  }

  addChildren(content.children, 2);
  return mermaid.trimEnd();
}

function createMermaidClass(content: MermaidClassDiagram): string {
  let mermaid = "classDiagram\n";

  for (const cls of content.classes) {
    mermaid += `    class ${cls.name} {\n`;
    for (const member of cls.members) {
      mermaid += `        ${member}\n`;
    }
    for (const method of cls.methods) {
      mermaid += `        ${method}\n`;
    }
    mermaid += "    }\n";
  }

  mermaid += "\n";
  for (const rel of content.relationships) {
    let arrow: string;
    switch (rel.type) {
      case "inheritance": arrow = "<|--"; break;
      case "composition": arrow = "*--"; break;
      case "aggregation": arrow = "o--"; break;
      case "dependency": arrow = "<.."; break;
      case "association":
      default: arrow = "-->"; break;
    }
    const label = rel.label ? ` : ${rel.label}` : "";
    mermaid += `    ${rel.from} ${arrow} ${rel.to}${label}\n`;
  }
  return mermaid.trimEnd();
}

function createMermaidState(content: MermaidStateDiagram): string {
  let mermaid = "stateDiagram-v2\n";

  for (const state of content.states) {
    if (state.type === "start") {
      mermaid += `    [*] --> ${state.id}\n`;
    } else if (state.type === "end") {
      mermaid += `    ${state.id} --> [*]\n`;
    }
    if (state.label && state.type !== "start" && state.type !== "end") {
      mermaid += `    ${state.id} : ${state.label}\n`;
    }
  }

  mermaid += "\n";
  for (const trans of content.transitions) {
    const label = trans.label ? ` : ${trans.label}` : "";
    mermaid += `    ${trans.from} --> ${trans.to}${label}\n`;
  }
  return mermaid.trimEnd();
}

// ─── 4. Dashboard HTML ───

export function createDashboardHtml(
  title: string,
  widgets: DashboardWidget[],
  filePath: string
): { path: string; size: number; widgetCount: number } {
  const widgetHtml = widgets.map((widget) => {
    const wTitle = escapeHtml(widget.title);
    let body: string;

    switch (widget.type) {
      case "bar":
      case "pie":
      case "line": {
        const chartData = widget.data as ChartDataPoint[];
        body = createSvgChart(widget.type, chartData, {
          ...widget.options,
          width: widget.options?.width || 500,
          height: widget.options?.height || 300,
          title: undefined, // Title shown in widget header
        });
        break;
      }
      case "stat": {
        const stat = widget.data as { label: string; value: string | number };
        body = `<div class="stat-widget">
          <div class="stat-value">${escapeHtml(String(stat.value))}</div>
          <div class="stat-label">${escapeHtml(stat.label)}</div>
        </div>`;
        break;
      }
      case "table": {
        const rows = widget.data as string[][];
        if (rows.length === 0) {
          body = "<p>(empty)</p>";
        } else {
          const headerCells = rows[0].map((c) => `<th>${escapeHtml(c)}</th>`).join("");
          const bodyRows = rows.slice(1).map((row) =>
            `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`
          ).join("\n");
          body = `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
        }
        break;
      }
      case "text":
      default: {
        const text = widget.data as string;
        body = `<div class="text-widget">${escapeHtml(text)}</div>`;
        break;
      }
    }

    return `<div class="widget"><h3>${wTitle}</h3><div class="widget-body">${body}</div></div>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh}
.header{background:linear-gradient(135deg,#1a73e8,#4285f4);color:#fff;padding:1.5rem 2rem;text-align:center}
.header h1{font-size:1.6rem;font-weight:600}
.header p{opacity:0.8;font-size:0.85rem;margin-top:0.3rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:1rem;padding:1.5rem;max-width:1400px;margin:0 auto}
.widget{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}
.widget h3{padding:1rem 1.2rem .5rem;font-size:1rem;color:#333;border-bottom:1px solid #f0f0f0;padding-bottom:.8rem}
.widget-body{padding:1rem 1.2rem 1.2rem;display:flex;justify-content:center;align-items:center;flex-direction:column}
.widget-body svg{max-width:100%;height:auto}
.stat-widget{text-align:center;padding:1.5rem 0}
.stat-value{font-size:2.8rem;font-weight:700;color:#1a73e8;line-height:1.1}
.stat-label{font-size:.9rem;color:#666;margin-top:.5rem}
.text-widget{font-size:.9rem;line-height:1.6;white-space:pre-wrap}
table{width:100%;border-collapse:collapse}
th,td{padding:.5rem .7rem;text-align:left;border-bottom:1px solid #eee;font-size:.85rem}
th{background:#f8f9fa;font-weight:600}
.footer{text-align:center;color:#999;font-size:.75rem;padding:1.5rem;border-top:1px solid #e0e0e0;margin-top:1rem}
@media(max-width:520px){.grid{grid-template-columns:1fr;padding:.8rem}}
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHtml(title)}</h1>
  <p>Generated by Soul &mdash; ${new Date().toISOString().split("T")[0]}</p>
</div>
<div class="grid">
${widgetHtml}
</div>
<div class="footer">Soul Media Creator &mdash; All data generated at ${new Date().toISOString()}</div>
</body>
</html>`;

  const resolved = writeOutputFile(filePath, html);
  return { path: resolved, size: Buffer.byteLength(html, "utf-8"), widgetCount: widgets.length };
}

// ─── Convenience: Save SVG to file ───

export function saveSvgToFile(svg: string, filePath: string): { path: string; size: number } {
  const resolved = writeOutputFile(filePath, svg);
  return { path: resolved, size: Buffer.byteLength(svg, "utf-8") };
}

// ─── 6. Animated SVG ───

export interface AnimatedSvgOptions {
  width?: number;
  height?: number;
  duration?: number; // seconds per animation cycle
  backgroundColor?: string;
  loop?: boolean;
}

export interface AnimatedElement {
  type: "circle" | "rect" | "text" | "path" | "line";
  props: Record<string, string | number>;
  animation: {
    attribute: string; // which attribute to animate
    from: string;
    to: string;
    duration?: number; // seconds
    delay?: number;
    repeatCount?: string; // "indefinite" or number
    type?: "linear" | "ease" | "ease-in" | "ease-out";
  }[];
}

/**
 * Create animated SVG with CSS/SMIL animations
 */
export function createAnimatedSvg(
  elements: AnimatedElement[],
  options: AnimatedSvgOptions = {}
): string {
  const w = options.width || 800;
  const h = options.height || 600;
  const bg = options.backgroundColor || "#1a1a2e";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
`;

  for (const el of elements) {
    const propsStr = Object.entries(el.props)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");

    const animStr = el.animation
      .map((a) => {
        const dur = a.duration || options.duration || 2;
        const delay = a.delay || 0;
        const repeat = a.repeatCount || "indefinite";
        const calcMode = a.type === "linear" ? "linear" : "spline";
        const keySplines =
          a.type === "ease-in"
            ? 'keySplines="0.42 0 1 1"'
            : a.type === "ease-out"
            ? 'keySplines="0 0 0.58 1"'
            : a.type === "ease"
            ? 'keySplines="0.42 0 0.58 1"'
            : "";

        return `<animate attributeName="${a.attribute}" from="${a.from}" to="${a.to}" dur="${dur}s" begin="${delay}s" repeatCount="${repeat}" calcMode="${calcMode}" ${keySplines}/>`;
      })
      .join("\n  ");

    svg += `<${el.type} ${propsStr}>\n  ${animStr}\n</${el.type}>\n`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Create a loading/progress animation SVG
 */
export function createLoadingAnimation(
  style: "spinner" | "pulse" | "dots" | "bars" | "wave" = "spinner",
  options: { size?: number; color?: string; backgroundColor?: string } = {}
): string {
  const size = options.size || 200;
  const color = options.color || "#4285f4";
  const bg = options.backgroundColor || "transparent";
  const cx = size / 2;
  const cy = size / 2;

  let inner = "";

  switch (style) {
    case "spinner":
      inner = `<circle cx="${cx}" cy="${cy}" r="${size * 0.35}" fill="none" stroke="${color}" stroke-width="${size * 0.06}" stroke-dasharray="${size * 0.7} ${size * 0.5}" stroke-linecap="round">
  <animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="1s" repeatCount="indefinite"/>
</circle>`;
      break;

    case "pulse":
      inner = `<circle cx="${cx}" cy="${cy}" r="${size * 0.2}" fill="${color}" opacity="0.8">
  <animate attributeName="r" values="${size * 0.15};${size * 0.4};${size * 0.15}" dur="1.5s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" repeatCount="indefinite"/>
</circle>`;
      break;

    case "dots":
      for (let i = 0; i < 3; i++) {
        const dx = cx - 30 + i * 30;
        inner += `<circle cx="${dx}" cy="${cy}" r="8" fill="${color}">
  <animate attributeName="cy" values="${cy};${cy - 20};${cy}" dur="0.6s" begin="${i * 0.15}s" repeatCount="indefinite"/>
</circle>\n`;
      }
      break;

    case "bars":
      for (let i = 0; i < 5; i++) {
        const bx = cx - 40 + i * 20;
        const barH = size * 0.4;
        inner += `<rect x="${bx}" y="${cy - barH / 2}" width="12" height="${barH}" rx="4" fill="${color}">
  <animate attributeName="height" values="${barH};${barH * 0.3};${barH}" dur="1s" begin="${i * 0.1}s" repeatCount="indefinite"/>
  <animate attributeName="y" values="${cy - barH / 2};${cy - barH * 0.15};${cy - barH / 2}" dur="1s" begin="${i * 0.1}s" repeatCount="indefinite"/>
</rect>\n`;
      }
      break;

    case "wave":
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const wx = cx + Math.cos(angle) * size * 0.25;
        const wy = cy + Math.sin(angle) * size * 0.25;
        inner += `<circle cx="${wx.toFixed(1)}" cy="${wy.toFixed(1)}" r="6" fill="${color}" opacity="0.3">
  <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" begin="${(i * 0.15).toFixed(2)}s" repeatCount="indefinite"/>
  <animate attributeName="r" values="4;8;4" dur="1.2s" begin="${(i * 0.15).toFixed(2)}s" repeatCount="indefinite"/>
</circle>\n`;
      }
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="${bg}"/>
${inner}
</svg>`;
}

/**
 * Create animated data visualization (bar chart with entrance animation)
 */
export function createAnimatedChart(
  data: ChartDataPoint[],
  chartType: "bar" | "line" = "bar",
  options: SvgChartOptions & { animationDuration?: number } = {}
): string {
  const w = options.width || 800;
  const h = options.height || 500;
  const title = options.title || "";
  const animDur = options.animationDuration || 0.8;
  const bg = options.backgroundColor || "#ffffff";

  const padding = { top: title ? 60 : 30, right: 30, bottom: 60, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => d.value), 1);

  let content = "";

  if (chartType === "bar") {
    const barW = Math.min(chartW / data.length - 8, 60);
    const gap = (chartW - barW * data.length) / (data.length + 1);

    for (let i = 0; i < data.length; i++) {
      const barH = (data[i].value / maxVal) * chartH;
      const x = padding.left + gap + i * (barW + gap);
      const y = padding.top + chartH;
      const color = data[i].color || getColor(i, options.colors);
      const delay = (i * 0.1).toFixed(2);

      // Bar grows from bottom
      content += `<rect x="${x}" y="${y}" width="${barW}" height="0" fill="${color}" rx="3">
  <animate attributeName="height" from="0" to="${barH}" dur="${animDur}s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
  <animate attributeName="y" from="${y}" to="${y - barH}" dur="${animDur}s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
</rect>
`;
      // Value label (appears after bar animation)
      if (options.showValues !== false) {
        content += `<text x="${x + barW / 2}" y="${y - barH - 8}" text-anchor="middle" font-size="12" fill="#333" opacity="0">
  <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${(parseFloat(delay) + animDur).toFixed(2)}s" fill="freeze"/>
  ${data[i].value.toLocaleString()}
</text>\n`;
      }

      // Label
      content += `<text x="${x + barW / 2}" y="${y + 20}" text-anchor="middle" font-size="11" fill="#666">${escapeHtml(data[i].label)}</text>\n`;
    }
  } else {
    // Animated line chart — line draws from left to right
    const points: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - (data[i].value / maxVal) * chartH;
      points.push(`${x},${y}`);
    }

    const pathD = points.reduce((acc, p, i) => {
      return acc + (i === 0 ? `M${p}` : ` L${p}`);
    }, "");

    const pathLen = chartW * 1.5; // approximation

    content += `<path d="${pathD}" fill="none" stroke="${options.colors?.[0] || "#4285f4"}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}">
  <animate attributeName="stroke-dashoffset" from="${pathLen}" to="0" dur="${animDur * data.length * 0.3}s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
</path>\n`;

    // Data points (appear with delay)
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - (data[i].value / maxVal) * chartH;
      const delay = (i * 0.15).toFixed(2);
      const color = data[i].color || options.colors?.[0] || "#4285f4";

      content += `<circle cx="${x}" cy="${y}" r="0" fill="${color}" stroke="#fff" stroke-width="2">
  <animate attributeName="r" from="0" to="5" dur="0.3s" begin="${delay}s" fill="freeze"/>
</circle>\n`;

      content += `<text x="${x}" y="${y + 25}" text-anchor="middle" font-size="11" fill="#666">${escapeHtml(data[i].label)}</text>\n`;
    }
  }

  // Grid lines
  if (options.showGrid !== false) {
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartH;
      const val = Math.round(maxVal * (1 - i / 4));
      content += `<line x1="${padding.left}" y1="${y}" x2="${w - padding.right}" y2="${y}" stroke="#e0e0e0" stroke-width="0.5"/>`;
      content += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val.toLocaleString()}</text>\n`;
    }
  }

  // Axes
  content += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>`;
  content += `<line x1="${padding.left}" y1="${padding.top + chartH}" x2="${w - padding.right}" y2="${padding.top + chartH}" stroke="#ccc" stroke-width="1"/>`;

  // Title
  let titleSvg = "";
  if (title) {
    titleSvg = `<text x="${w / 2}" y="30" text-anchor="middle" font-size="18" font-weight="600" fill="#333">${escapeHtml(title)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="${bg}" rx="8"/>
${titleSvg}
${content}
</svg>`;
}

// ─── 7. HTML5 Presentation / Slideshow ───

export interface Slide {
  title: string;
  content: string; // HTML content
  background?: string; // CSS background
  textColor?: string;
  layout?: "center" | "left" | "split" | "image";
  imageUrl?: string; // for image layout
  notes?: string; // speaker notes
}

/**
 * Create a self-contained HTML5 slideshow presentation
 * - Keyboard navigation (arrows, space)
 * - Progress bar
 * - Smooth transitions
 * - Responsive
 * - No external dependencies
 */
export function createPresentation(
  slides: Slide[],
  options: {
    title?: string;
    theme?: "dark" | "light" | "blue" | "green";
    transition?: "fade" | "slide" | "zoom";
    autoPlay?: number; // seconds between slides, 0 = manual
    filePath?: string;
  } = {}
): { path: string; size: number; slideCount: number } {
  const title = options.title || "Presentation";
  const theme = options.theme || "dark";
  const transition = options.transition || "fade";
  const autoPlay = options.autoPlay || 0;
  const filePath = options.filePath || `presentation-${Date.now()}.html`;

  const themes: Record<string, { bg: string; text: string; accent: string; slide: string }> = {
    dark: { bg: "#0d1117", text: "#e6edf3", accent: "#58a6ff", slide: "#161b22" },
    light: { bg: "#f6f8fa", text: "#24292f", accent: "#0969da", slide: "#ffffff" },
    blue: { bg: "#0a1628", text: "#e6edf3", accent: "#60a5fa", slide: "#1e293b" },
    green: { bg: "#0a1f0a", text: "#e6edf3", accent: "#4ade80", slide: "#1a2e1a" },
  };

  const t = themes[theme];

  const slidesHtml = slides
    .map((slide, i) => {
      const bg = slide.background || t.slide;
      const tc = slide.textColor || t.text;
      const layout = slide.layout || "center";

      let inner = "";
      if (layout === "split" && slide.imageUrl) {
        inner = `<div style="display:flex;align-items:center;gap:3rem;height:100%">
  <div style="flex:1">${slide.content}</div>
  <div style="flex:1"><img src="${escapeHtml(slide.imageUrl)}" style="max-width:100%;max-height:70vh;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.3)"/></div>
</div>`;
      } else if (layout === "image" && slide.imageUrl) {
        inner = `<div style="text-align:center"><img src="${escapeHtml(slide.imageUrl)}" style="max-width:90%;max-height:70vh;border-radius:12px"/></div>
<div style="margin-top:1.5rem">${slide.content}</div>`;
      } else if (layout === "left") {
        inner = `<div style="text-align:left;max-width:80%">${slide.content}</div>`;
      } else {
        inner = `<div style="text-align:center">${slide.content}</div>`;
      }

      return `<div class="slide" data-index="${i}" style="background:${bg};color:${tc}">
  <h1 style="color:${t.accent}">${escapeHtml(slide.title)}</h1>
  ${inner}
  <div class="slide-number">${i + 1} / ${slides.length}</div>
</div>`;
    })
    .join("\n");

  const transitionCss =
    transition === "slide"
      ? `transform: translateX(100%); .slide.active { transform: translateX(0); } .slide.prev { transform: translateX(-100%); }`
      : transition === "zoom"
      ? `transform: scale(0.8); opacity: 0;`
      : `opacity: 0;`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${t.bg};color:${t.text};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden;height:100vh}
.slide{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:4rem;${transitionCss}transition:all 0.6s cubic-bezier(0.4,0,0.2,1);pointer-events:none}
.slide.active{opacity:1;transform:translateX(0) scale(1);pointer-events:auto}
.slide h1{font-size:clamp(1.8rem,4vw,3.2rem);margin-bottom:2rem;font-weight:700;line-height:1.2}
.slide div{font-size:clamp(1rem,2vw,1.4rem);line-height:1.8;max-width:900px}
.slide ul,.slide ol{text-align:left;margin:1rem 0;padding-left:1.5rem}
.slide li{margin:0.5rem 0}
.slide code{background:rgba(255,255,255,0.1);padding:0.2rem 0.5rem;border-radius:4px;font-family:monospace;font-size:0.9em}
.slide pre{background:rgba(0,0,0,0.3);padding:1.5rem;border-radius:8px;overflow-x:auto;text-align:left;font-family:monospace;font-size:0.85em;max-width:100%}
.slide-number{position:absolute;bottom:1.5rem;right:2rem;font-size:0.85rem;opacity:0.5}
.progress{position:fixed;top:0;left:0;height:3px;background:${t.accent};transition:width 0.4s;z-index:10}
.controls{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);display:flex;gap:0.5rem;z-index:10;opacity:0.3;transition:opacity 0.3s}
.controls:hover{opacity:1}
.controls button{background:rgba(255,255,255,0.15);border:none;color:${t.text};padding:0.5rem 1rem;border-radius:6px;cursor:pointer;font-size:1.2rem;backdrop-filter:blur(10px)}
.controls button:hover{background:rgba(255,255,255,0.25)}
@media(max-width:768px){.slide{padding:2rem}}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
${slidesHtml}
<div class="controls">
  <button onclick="prev()">◀</button>
  <button onclick="next()">▶</button>
</div>
<script>
let current=0;const slides=document.querySelectorAll('.slide');const total=slides.length;
function show(n){slides.forEach((s,i)=>{s.classList.toggle('active',i===n);s.classList.toggle('prev',i<n)});document.getElementById('progress').style.width=((n+1)/total*100)+'%';current=n}
function next(){if(current<total-1)show(current+1)}
function prev(){if(current>0)show(current-1)}
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '||e.key==='Enter'){e.preventDefault();next()}else if(e.key==='ArrowLeft'||e.key==='Backspace'){e.preventDefault();prev()}else if(e.key==='Home')show(0);else if(e.key==='End')show(total-1)});
document.addEventListener('touchstart',e=>{const x=e.touches[0].clientX;if(x>window.innerWidth*0.7)next();else if(x<window.innerWidth*0.3)prev()});
show(0);
${autoPlay > 0 ? `setInterval(()=>{if(current<total-1)next();else show(0)},${autoPlay * 1000});` : ""}
</script>
</body>
</html>`;

  const resolved = writeOutputFile(filePath, html);
  return { path: resolved, size: Buffer.byteLength(html, "utf-8"), slideCount: slides.length };
}

// ─── 8. Infographic ───

export interface InfographicSection {
  title: string;
  value: string | number;
  icon?: string; // emoji or unicode char
  description?: string;
  color?: string;
}

/**
 * Create an infographic as self-contained HTML with animated counters
 */
export function createInfographic(
  title: string,
  sections: InfographicSection[],
  options: {
    theme?: "dark" | "light" | "gradient";
    columns?: number;
    filePath?: string;
  } = {}
): { path: string; size: number; sectionCount: number } {
  const theme = options.theme || "dark";
  const cols = options.columns || Math.min(sections.length, 3);
  const filePath = options.filePath || `infographic-${Date.now()}.html`;

  const themes = {
    dark: { bg: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)", text: "#fff", card: "rgba(255,255,255,0.08)" },
    light: { bg: "linear-gradient(135deg,#f5f7fa,#c3cfe2)", text: "#1a1a1a", card: "rgba(255,255,255,0.7)" },
    gradient: { bg: "linear-gradient(135deg,#667eea,#764ba2)", text: "#fff", card: "rgba(255,255,255,0.12)" },
  };

  const t = themes[theme];

  const sectionsHtml = sections
    .map((s, i) => {
      const color = s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      return `<div class="card" style="animation-delay:${i * 0.1}s">
  <div class="icon" style="color:${color}">${s.icon || "📊"}</div>
  <div class="val" style="color:${color}">${escapeHtml(String(s.value))}</div>
  <div class="title">${escapeHtml(s.title)}</div>
  ${s.description ? `<div class="desc">${escapeHtml(s.description)}</div>` : ""}
</div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${t.bg};color:${t.text};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:3rem 2rem}
h1{font-size:2.5rem;margin-bottom:0.5rem;text-align:center;font-weight:800}
.subtitle{opacity:0.6;margin-bottom:3rem;font-size:1rem}
.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:1.5rem;max-width:1200px;width:100%}
.card{background:${t.card};backdrop-filter:blur(10px);border-radius:16px;padding:2rem;text-align:center;animation:fadeUp 0.6s ease-out both;border:1px solid rgba(255,255,255,0.06)}
.card:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.2);transition:all 0.3s}
.icon{font-size:3rem;margin-bottom:1rem}
.val{font-size:2.2rem;font-weight:800;margin-bottom:0.5rem}
.title{font-size:1rem;font-weight:600;opacity:0.9}
.desc{font-size:0.85rem;opacity:0.6;margin-top:0.5rem;line-height:1.5}
.footer{margin-top:3rem;opacity:0.4;font-size:0.8rem}
@keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:768px){.grid{grid-template-columns:1fr}h1{font-size:1.8rem}}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="subtitle">Generated by Soul &mdash; ${new Date().toISOString().split("T")[0]}</p>
<div class="grid">
${sectionsHtml}
</div>
<div class="footer">Soul Media Creator</div>
</body>
</html>`;

  const resolved = writeOutputFile(filePath, html);
  return { path: resolved, size: Buffer.byteLength(html, "utf-8"), sectionCount: sections.length };
}

// ─── 9. Timeline / History Visualization ───

export interface TimelineEvent {
  date: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
}

/**
 * Create an interactive timeline visualization as HTML
 */
export function createTimeline(
  events: TimelineEvent[],
  options: {
    title?: string;
    theme?: "dark" | "light";
    filePath?: string;
  } = {}
): { path: string; size: number; eventCount: number } {
  const title = options.title || "Timeline";
  const theme = options.theme || "dark";
  const filePath = options.filePath || `timeline-${Date.now()}.html`;

  const isDark = theme === "dark";
  const bg = isDark ? "#0d1117" : "#f6f8fa";
  const text = isDark ? "#e6edf3" : "#24292f";
  const line = isDark ? "#30363d" : "#d0d7de";
  const card = isDark ? "#161b22" : "#ffffff";

  const eventsHtml = events
    .map((e, i) => {
      const color = e.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      const side = i % 2 === 0 ? "left" : "right";
      return `<div class="event ${side}" style="animation-delay:${i * 0.15}s">
  <div class="dot" style="background:${color}"></div>
  <div class="card">
    <div class="date" style="color:${color}">${e.icon || "📌"} ${escapeHtml(e.date)}</div>
    <div class="etitle">${escapeHtml(e.title)}</div>
    ${e.description ? `<div class="edesc">${escapeHtml(e.description)}</div>` : ""}
  </div>
</div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${bg};color:${text};font-family:system-ui,sans-serif;padding:3rem 1rem}
h1{text-align:center;font-size:2rem;margin-bottom:3rem}
.timeline{position:relative;max-width:900px;margin:0 auto}
.timeline::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;background:${line};transform:translateX(-50%)}
.event{position:relative;width:50%;padding:0 2.5rem 2rem;animation:fadeIn 0.5s ease-out both}
.event.left{left:0;text-align:right}
.event.right{left:50%;text-align:left}
.dot{position:absolute;top:0;width:14px;height:14px;border-radius:50%;border:3px solid ${bg};z-index:1}
.event.left .dot{right:-7px}
.event.right .dot{left:-7px}
.card{background:${card};border-radius:10px;padding:1.2rem;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.date{font-size:0.85rem;font-weight:700;margin-bottom:0.3rem}
.etitle{font-size:1.1rem;font-weight:600}
.edesc{font-size:0.9rem;opacity:0.7;margin-top:0.4rem;line-height:1.5}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){.timeline::before{left:20px}.event{width:100%;left:0!important;text-align:left!important;padding-left:45px;padding-right:0}.event .dot{left:14px!important;right:auto!important}}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="timeline">
${eventsHtml}
</div>
</body>
</html>`;

  const resolved = writeOutputFile(filePath, html);
  return { path: resolved, size: Buffer.byteLength(html, "utf-8"), eventCount: events.length };
}
