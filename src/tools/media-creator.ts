/**
 * Media Creator Tools — MCP tools for creating documents, charts, diagrams, and dashboards
 *
 * 7 tools:
 * - soul_create_document — Create text documents (txt, md, html, csv, json)
 * - soul_create_chart — Create SVG charts (bar, pie, line)
 * - soul_create_diagram — Create diagrams (flowchart, mind map, org chart)
 * - soul_create_report — Create styled HTML reports
 * - soul_create_dashboard — Create HTML dashboards with multiple widgets
 * - soul_create_mermaid — Generate Mermaid diagram syntax
 * - soul_create_badge — Create SVG status badges
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTextDocument,
  createHtmlReport,
  createCsvFile,
  createJsonFile,
  createSvgChart,
  createSvgDiagram,
  createSvgBadge,
  createSvgQrCode,
  createMermaidDiagram,
  createDashboardHtml,
  saveSvgToFile,
  createAnimatedSvg,
  createAnimatedChart,
  createLoadingAnimation,
  createPresentation,
  createInfographic,
  createTimeline,
} from "../core/media-creator.js";
import type {
  ChartDataPoint,
  HtmlSection,
  DiagramNode,
  DiagramLink,
  DashboardWidget,
  MermaidContent,
} from "../core/media-creator.js";

export function registerMediaCreatorTools(server: McpServer) {
  // ─── 1. soul_create_document ───

  server.tool(
    "soul_create_document",
    "Create a text document — supports .txt, .md, .html, .csv, .json formats. " +
    "For CSV, provide headers and rows as JSON arrays. For JSON, provide any data structure. " +
    "Files are saved to ~/.soul/exports/ by default.",
    {
      format: z.enum(["txt", "md", "html", "csv", "json"]).describe("Document format"),
      filename: z.string().describe("Output filename (e.g., 'report.md', 'data.csv')"),
      content: z.string().optional().describe("Text content for txt/md/html formats"),
      headers: z.array(z.string()).optional().describe("CSV column headers (for csv format)"),
      rows: z.array(z.array(z.string())).optional().describe("CSV data rows (for csv format)"),
      data: z.any().optional().describe("JSON data (for json format — any structure)"),
    },
    async ({ format, filename, content, headers, rows, data }) => {
      try {
        let result: { path: string; size: number; [key: string]: unknown };

        switch (format) {
          case "csv": {
            if (!headers || !rows) {
              return {
                content: [{ type: "text" as const, text: "Error: CSV format requires 'headers' and 'rows' parameters." }],
                isError: true,
              };
            }
            const csvResult = createCsvFile(headers, rows, filename);
            result = { ...csvResult, rowCount: csvResult.rowCount };
            break;
          }
          case "json": {
            if (data === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: JSON format requires 'data' parameter." }],
                isError: true,
              };
            }
            result = createJsonFile(data, filename);
            break;
          }
          case "txt":
          case "md":
          case "html":
          default: {
            if (!content) {
              return {
                content: [{ type: "text" as const, text: "Error: Text/MD/HTML format requires 'content' parameter." }],
                isError: true,
              };
            }
            result = createTextDocument(content, filename, format);
            break;
          }
        }

        const sizeKb = (result.size / 1024).toFixed(1);
        return {
          content: [{
            type: "text" as const,
            text: `Document created successfully.\n  Format: ${format}\n  Path: ${result.path}\n  Size: ${sizeKb} KB${result.rowCount !== undefined ? `\n  Rows: ${result.rowCount}` : ""}`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating document: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 2. soul_create_chart ───

  server.tool(
    "soul_create_chart",
    "Create an SVG chart — bar, pie, or line chart. Returns SVG content and optionally saves to file. " +
    "Data is an array of {label, value, color?} objects.",
    {
      type: z.enum(["bar", "pie", "line"]).describe("Chart type"),
      data: z.array(z.object({
        label: z.string(),
        value: z.number(),
        color: z.string().optional(),
      })).describe("Chart data points [{label, value, color?}]"),
      title: z.string().optional().describe("Chart title"),
      width: z.number().optional().describe("Width in pixels (default: 600)"),
      height: z.number().optional().describe("Height in pixels (default: 400)"),
      showValues: z.boolean().optional().describe("Show values on chart (default: true)"),
      showGrid: z.boolean().optional().describe("Show grid lines (default: true)"),
      filename: z.string().optional().describe("Save to file (e.g., 'chart.svg'). If omitted, returns SVG content only."),
    },
    async ({ type, data, title, width, height, showValues, showGrid, filename }) => {
      try {
        const svg = createSvgChart(type, data as ChartDataPoint[], {
          title,
          width,
          height,
          showValues,
          showGrid,
        });

        let text = `SVG ${type} chart created (${data.length} data points).\n`;

        if (filename) {
          const result = saveSvgToFile(svg, filename);
          text += `Saved to: ${result.path} (${(result.size / 1024).toFixed(1)} KB)\n`;
        }

        text += `\n--- SVG Content ---\n${svg}`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating chart: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 3. soul_create_diagram ───

  server.tool(
    "soul_create_diagram",
    "Create an SVG diagram — flowchart, mind map, or org chart. " +
    "Provide nodes [{id, label, shape?, color?}] and links [{from, to, label?, style?}].",
    {
      type: z.enum(["flowchart", "mindmap", "orgchart"]).describe("Diagram type"),
      nodes: z.array(z.object({
        id: z.string(),
        label: z.string(),
        shape: z.enum(["rect", "rounded", "circle", "diamond", "ellipse"]).optional(),
        color: z.string().optional(),
      })).describe("Diagram nodes"),
      links: z.array(z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        style: z.enum(["solid", "dashed", "dotted"]).optional(),
      })).optional().describe("Links between nodes"),
      filename: z.string().optional().describe("Save to file (e.g., 'diagram.svg')"),
    },
    async ({ type, nodes, links, filename }) => {
      try {
        const svg = createSvgDiagram(
          type,
          nodes as DiagramNode[],
          (links || []) as DiagramLink[]
        );

        let text = `SVG ${type} diagram created (${nodes.length} nodes, ${(links || []).length} links).\n`;

        if (filename) {
          const result = saveSvgToFile(svg, filename);
          text += `Saved to: ${result.path} (${(result.size / 1024).toFixed(1)} KB)\n`;
        }

        text += `\n--- SVG Content ---\n${svg}`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating diagram: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 4. soul_create_report ───

  server.tool(
    "soul_create_report",
    "Create a styled HTML report with multiple sections. Each section has a title, content, " +
    "and type (text, table, code, list, html). Tables use '|' as column separator and '\\n' for rows.",
    {
      title: z.string().describe("Report title"),
      sections: z.array(z.object({
        title: z.string(),
        content: z.string(),
        type: z.enum(["text", "table", "code", "list", "html"]).optional().describe("Section type (default: text)"),
      })).describe("Report sections"),
      filename: z.string().describe("Output filename (e.g., 'report.html')"),
    },
    async ({ title, sections, filename }) => {
      try {
        const result = createHtmlReport(title, sections as HtmlSection[], filename);

        return {
          content: [{
            type: "text" as const,
            text: `HTML report created successfully.\n  Title: ${title}\n  Sections: ${result.sectionCount}\n  Path: ${result.path}\n  Size: ${(result.size / 1024).toFixed(1)} KB`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating report: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 5. soul_create_dashboard ───

  server.tool(
    "soul_create_dashboard",
    "Create a self-contained HTML dashboard with multiple widgets. " +
    "Widget types: bar/pie/line (chart data), stat ({label, value}), table (2D array), text (string). " +
    "The dashboard is responsive and styled with a modern design.",
    {
      title: z.string().describe("Dashboard title"),
      widgets: z.array(z.object({
        title: z.string().describe("Widget title"),
        type: z.enum(["bar", "pie", "line", "stat", "table", "text"]).describe("Widget type"),
        data: z.any().describe("Widget data — depends on type: chart=[{label,value}], stat={label,value}, table=[[]], text=string"),
        options: z.object({
          width: z.number().optional(),
          height: z.number().optional(),
          showValues: z.boolean().optional(),
          showGrid: z.boolean().optional(),
        }).optional().describe("Chart options (for bar/pie/line types)"),
      })).describe("Dashboard widgets"),
      filename: z.string().describe("Output filename (e.g., 'dashboard.html')"),
    },
    async ({ title, widgets, filename }) => {
      try {
        const result = createDashboardHtml(title, widgets as DashboardWidget[], filename);

        return {
          content: [{
            type: "text" as const,
            text: `Dashboard created successfully.\n  Title: ${title}\n  Widgets: ${result.widgetCount}\n  Path: ${result.path}\n  Size: ${(result.size / 1024).toFixed(1)} KB\n\nOpen ${result.path} in a browser to view.`,
          }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating dashboard: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 6. soul_create_mermaid ───

  server.tool(
    "soul_create_mermaid",
    "Generate Mermaid diagram syntax — flowchart, sequence, gantt, ER, mindmap, class diagram, state diagram. " +
    "Returns text that can be rendered by any Mermaid viewer (GitHub, VS Code, etc.). " +
    "Optionally saves to a .mmd file.",
    {
      type: z.enum(["flowchart", "sequence", "gantt", "er", "mindmap", "classDiagram", "stateDiagram"]).describe("Mermaid diagram type"),
      content: z.any().describe(
        "Diagram content (structure depends on type):\n" +
        "- flowchart: {direction?, nodes: [{id, label, shape?}], edges: [{from, to, label?, style?}]}\n" +
        "- sequence: {participants: [string], messages: [{from, to, text, type?}]}\n" +
        "- gantt: {title?, sections: [{name, tasks: [{name, start, duration, status?}]}]}\n" +
        "- er: {entities: [{name, attributes: [{name, type, key?}]}], relationships: [{from, to, label, fromCardinality, toCardinality}]}\n" +
        "- mindmap: {root: string, children: [{label, children?}]}\n" +
        "- classDiagram: {classes: [{name, members, methods}], relationships: [{from, to, type, label?}]}\n" +
        "- stateDiagram: {states: [{id, label?, type?}], transitions: [{from, to, label?}]}"
      ),
      filename: z.string().optional().describe("Save to file (e.g., 'diagram.mmd')"),
    },
    async ({ type, content, filename }) => {
      try {
        const mermaid = createMermaidDiagram(type, content as MermaidContent);

        let text = `Mermaid ${type} diagram generated.\n`;

        if (filename) {
          // Use the core function to save
          const { createTextDocument: createDoc } = await import("../core/media-creator.js");
          const result = createDoc(mermaid, filename, "txt");
          text += `Saved to: ${result.path}\n`;
        }

        text += `\n\`\`\`mermaid\n${mermaid}\n\`\`\``;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating Mermaid diagram: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 7. soul_create_badge ───

  server.tool(
    "soul_create_badge",
    "Create an SVG status badge (like GitHub badges). " +
    "Returns SVG content and optionally saves to file.",
    {
      label: z.string().describe("Badge label (left side, e.g., 'build', 'version', 'status')"),
      value: z.string().describe("Badge value (right side, e.g., 'passing', 'v1.2.3', 'active')"),
      color: z.string().optional().describe("Badge color (default: #4285f4). Use hex like '#34a853' or named colors."),
      filename: z.string().optional().describe("Save to file (e.g., 'badge.svg')"),
    },
    async ({ label, value, color, filename }) => {
      try {
        const svg = createSvgBadge(label, value, color);

        let text = `SVG badge created: [${label} | ${value}]\n`;

        if (filename) {
          const result = saveSvgToFile(svg, filename);
          text += `Saved to: ${result.path}\n`;
        }

        text += `\n--- SVG Content ---\n${svg}`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating badge: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 8. soul_create_animated_chart ───

  server.tool(
    "soul_create_animated_chart",
    "Create an animated SVG chart with entrance animations — bars grow up, lines draw in. Self-contained SVG, opens in any browser.",
    {
      type: z.enum(["bar", "line"]).describe("Chart type"),
      data: z.array(z.object({
        label: z.string(),
        value: z.number(),
        color: z.string().optional(),
      })).describe("Data points"),
      title: z.string().optional().describe("Chart title"),
      filename: z.string().optional().describe("Save to file (e.g., 'chart.svg')"),
      animationDuration: z.number().optional().describe("Animation duration in seconds per bar/point (default: 0.8)"),
    },
    async ({ type, data, title, filename, animationDuration }) => {
      try {
        const svg = createAnimatedChart(data, type, {
          title: title || "",
          animationDuration,
          showValues: true,
          showGrid: true,
        });

        let text = `Animated ${type} chart created with ${data.length} data points.\n`;

        if (filename) {
          const result = saveSvgToFile(svg, filename);
          text += `Saved to: ${result.path} (${(result.size / 1024).toFixed(1)} KB)\n`;
          text += `Open in browser to see animations.\n`;
        }

        text += `\n--- SVG Content ---\n${svg}`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 9. soul_create_loading ───

  server.tool(
    "soul_create_loading",
    "Create an animated loading/spinner SVG — choose from spinner, pulse, dots, bars, or wave style.",
    {
      style: z.enum(["spinner", "pulse", "dots", "bars", "wave"]).default("spinner").describe("Animation style"),
      size: z.number().optional().describe("Size in pixels (default: 200)"),
      color: z.string().optional().describe("Primary color (default: #4285f4)"),
      filename: z.string().optional().describe("Save to file"),
    },
    async ({ style, size, color, filename }) => {
      try {
        const svg = createLoadingAnimation(style, { size, color });
        let text = `Loading animation created (${style}).\n`;

        if (filename) {
          const result = saveSvgToFile(svg, filename);
          text += `Saved to: ${result.path}\n`;
        }

        text += `\n--- SVG Content ---\n${svg}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 10. soul_create_presentation ───

  server.tool(
    "soul_create_presentation",
    "Create an HTML5 slideshow presentation — keyboard/touch navigation, smooth transitions, responsive. No dependencies needed, opens in any browser.",
    {
      title: z.string().describe("Presentation title"),
      slides: z.array(z.object({
        title: z.string().describe("Slide title"),
        content: z.string().describe("Slide content (HTML supported: <ul>, <li>, <b>, <code>, <pre>, <img>)"),
        layout: z.enum(["center", "left", "split", "image"]).optional().describe("Slide layout"),
        imageUrl: z.string().optional().describe("Image URL (for split/image layouts)"),
        background: z.string().optional().describe("Custom background CSS"),
      })).describe("Slides array"),
      theme: z.enum(["dark", "light", "blue", "green"]).default("dark").describe("Color theme"),
      transition: z.enum(["fade", "slide", "zoom"]).default("fade").describe("Transition effect"),
      autoPlay: z.number().optional().describe("Auto-advance seconds (0 = manual)"),
      filename: z.string().optional().describe("Output filename"),
    },
    async ({ title, slides, theme, transition, autoPlay, filename }) => {
      try {
        const result = createPresentation(slides, {
          title,
          theme,
          transition,
          autoPlay,
          filePath: filename,
        });

        let text = `Presentation created: "${title}"\n`;
        text += `Slides: ${result.slideCount} | Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `Saved to: ${result.path}\n`;
        text += `Theme: ${theme} | Transition: ${transition}\n\n`;
        text += `Open in browser to view. Use arrow keys or touch to navigate.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 11. soul_create_infographic ───

  server.tool(
    "soul_create_infographic",
    "Create an animated infographic HTML page — shows key stats/metrics with icons, animated entrance, and hover effects.",
    {
      title: z.string().describe("Infographic title"),
      sections: z.array(z.object({
        title: z.string().describe("Section title"),
        value: z.string().describe("Main value (e.g., '42%', '1,234', '$5.2M')"),
        icon: z.string().optional().describe("Emoji icon (e.g., '📊', '🚀', '💰')"),
        description: z.string().optional().describe("Description text"),
        color: z.string().optional().describe("Accent color"),
      })).describe("Info sections"),
      theme: z.enum(["dark", "light", "gradient"]).default("dark").describe("Visual theme"),
      columns: z.number().min(1).max(4).optional().describe("Grid columns (default: auto)"),
      filename: z.string().optional().describe("Output filename"),
    },
    async ({ title, sections, theme, columns, filename }) => {
      try {
        const result = createInfographic(title, sections, {
          theme,
          columns,
          filePath: filename,
        });

        let text = `Infographic created: "${title}"\n`;
        text += `Sections: ${result.sectionCount} | Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `Saved to: ${result.path}\n`;
        text += `Open in browser to view with animations.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 12. soul_create_timeline ───

  server.tool(
    "soul_create_timeline",
    "Create an interactive timeline visualization — events displayed on an alternating left/right timeline with animations.",
    {
      title: z.string().describe("Timeline title"),
      events: z.array(z.object({
        date: z.string().describe("Date or period label"),
        title: z.string().describe("Event title"),
        description: z.string().optional().describe("Event description"),
        icon: z.string().optional().describe("Emoji icon"),
        color: z.string().optional().describe("Accent color"),
      })).describe("Timeline events"),
      theme: z.enum(["dark", "light"]).default("dark").describe("Visual theme"),
      filename: z.string().optional().describe("Output filename"),
    },
    async ({ title, events, theme, filename }) => {
      try {
        const result = createTimeline(events, {
          title,
          theme,
          filePath: filename,
        });

        let text = `Timeline created: "${title}"\n`;
        text += `Events: ${result.eventCount} | Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `Saved to: ${result.path}\n`;
        text += `Open in browser to view with animations.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );
}
