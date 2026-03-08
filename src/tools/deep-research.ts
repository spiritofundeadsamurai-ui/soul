import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  planResearch,
  addFinding,
  synthesizeResearch,
  getResearchProject,
  listResearchProjects,
} from "../core/deep-research.js";

export function registerDeepResearchTools(server: McpServer) {

  server.tool(
    "soul_deep_research",
    "Start a deep research project — breaks a topic into sub-questions, creates a research plan, and guides you through multi-step investigation with source verification. Like Gemini Deep Research.",
    {
      topic: z.string().describe("Topic to research deeply"),
      subQuestions: z.array(z.string()).optional().describe("Custom sub-questions (auto-generated if omitted)"),
    },
    async ({ topic, subQuestions }) => {
      const { project, researchPlan } = await planResearch(topic, subQuestions);
      return {
        content: [{
          type: "text" as const,
          text: `Research project #${project.id} created.\n\n${researchPlan}`,
        }],
      };
    }
  );

  server.tool(
    "soul_research_finding",
    "Add a finding to an active research project — record what you learned from a source.",
    {
      projectId: z.number().describe("Research project ID"),
      question: z.string().describe("Which sub-question this answers"),
      answer: z.string().describe("What was found"),
      source: z.string().describe("Source URL or reference"),
      confidence: z.number().min(0).max(1).default(0.7).describe("Confidence in this finding (0-1)"),
    },
    async ({ projectId, question, answer, source, confidence }) => {
      const project = addFinding(projectId, { question, answer, source, confidence });
      if (!project) {
        return { content: [{ type: "text" as const, text: `Project #${projectId} not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Finding added to project #${projectId} "${project.topic}".\nTotal findings: ${project.findings.length}\nSources: ${project.sources.length}\n\nContinue investigating remaining sub-questions.`,
        }],
      };
    }
  );

  server.tool(
    "soul_research_synthesize",
    "Synthesize all research findings into a final report — cross-checks for contradictions, calculates confidence, stores as permanent knowledge.",
    {
      projectId: z.number().describe("Research project ID"),
      synthesis: z.string().describe("Your synthesized summary of all findings"),
    },
    async ({ projectId, synthesis }) => {
      const result = await synthesizeResearch(projectId, synthesis);
      if (!result) {
        return { content: [{ type: "text" as const, text: `Project #${projectId} not found.` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: result.report,
        }],
      };
    }
  );

  server.tool(
    "soul_research_status",
    "Check the status of a research project — see findings, sources, and progress.",
    {
      projectId: z.number().describe("Research project ID"),
    },
    async ({ projectId }) => {
      const project = getResearchProject(projectId);
      if (!project) {
        return { content: [{ type: "text" as const, text: `Project #${projectId} not found.` }] };
      }

      let text = `=== Research: "${project.topic}" ===\n`;
      text += `Status: ${project.status}\n`;
      text += `Confidence: ${Math.round(project.confidence * 100)}%\n\n`;

      text += `Sub-questions (${project.subQuestions.length}):\n`;
      for (const q of project.subQuestions) {
        const answered = project.findings.some(f =>
          f.question.toLowerCase().includes(q.toLowerCase().substring(0, 20))
        );
        text += `  ${answered ? "[x]" : "[ ]"} ${q}\n`;
      }

      text += `\nFindings (${project.findings.length}):\n`;
      for (const f of project.findings.slice(-5)) {
        text += `  - Q: ${f.question.substring(0, 60)}\n`;
        text += `    A: ${f.answer.substring(0, 100)}\n`;
        text += `    Source: ${f.source} (${Math.round(f.confidence * 100)}%)\n`;
      }

      text += `\nSources (${project.sources.length}): ${project.sources.join(", ")}`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "soul_research_list",
    "List all research projects — shows topic, status, findings count.",
    {},
    async () => {
      const projects = listResearchProjects();
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No research projects yet. Use soul_deep_research to start one." }] };
      }

      let text = `Research Projects (${projects.length}):\n\n`;
      text += projects.map(p =>
        `#${p.id} "${p.topic}" [${p.status}] — ${p.findings.length} findings, ${p.sources.length} sources, ${Math.round(p.confidence * 100)}% confidence`
      ).join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
