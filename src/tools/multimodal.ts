import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  extractFromUrl,
  analyzeImage,
  processMedia,
  processDocument,
} from "../core/multimodal.js";

export function registerMultimodalTools(server: McpServer) {
  server.tool(
    "soul_read_url",
    "Fetch and learn from any URL — web pages, APIs, documentation. Soul extracts content and stores it in memory.",
    {
      url: z.string().describe("URL to fetch and learn from"),
    },
    async ({ url }) => {
      const analysis = await extractFromUrl(url);

      if (!analysis.extractedText) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch ${url}: ${analysis.summary}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Learned from ${url}\n\nExtracted ${analysis.metadata.length} chars\nTags: ${analysis.tags.join(", ")}\n\nSummary:\n${analysis.summary}\n\nFull content stored in Soul's memory.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_see",
    "Analyze an image — describe what you see and Soul remembers it. When vision API is available, Soul will auto-analyze.",
    {
      source: z
        .string()
        .describe("Image source (file path or URL)"),
      description: z
        .string()
        .optional()
        .describe("What's in the image (until vision API is integrated)"),
    },
    async ({ source, description }) => {
      const analysis = await analyzeImage(source, description);
      return {
        content: [
          {
            type: "text" as const,
            text: description
              ? `Image analyzed and stored: ${source}\nDescription: ${description}\n\nStored in Soul's visual memory.`
              : `Image registered: ${source}\nProvide a description with the 'description' parameter, or wait for vision API integration.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_listen",
    "Process audio or video — provide a transcript or description and Soul learns from it.",
    {
      source: z
        .string()
        .describe("Media source (file path or URL)"),
      mediaType: z
        .enum(["audio", "video"])
        .describe("Type of media"),
      transcript: z
        .string()
        .optional()
        .describe("Transcript of the audio/video"),
      description: z
        .string()
        .optional()
        .describe("Description of the content"),
    },
    async ({ source, mediaType, transcript, description }) => {
      const analysis = await processMedia(
        source,
        mediaType,
        transcript,
        description
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `${mediaType === "audio" ? "Audio" : "Video"} processed: ${source}\n${transcript ? `Transcript stored (${transcript.length} chars)` : description ? `Description stored` : "Provide transcript or description for Soul to learn from."}\n\nStored in Soul's memory.`,
          },
        ],
      };
    }
  );

  server.tool(
    "soul_read_doc",
    "Process a document — PDF, Word, or any text document. Soul extracts and remembers the content.",
    {
      source: z
        .string()
        .describe("Document source (file path)"),
      content: z
        .string()
        .describe("Document content (text)"),
      docType: z
        .string()
        .default("text")
        .describe("Document type (pdf, word, text, markdown, etc.)"),
    },
    async ({ source, content, docType }) => {
      const analysis = await processDocument(source, content, docType);
      return {
        content: [
          {
            type: "text" as const,
            text: `Document processed: ${source} (${docType})\nExtracted: ${analysis.metadata.length} chars\n\nSummary:\n${analysis.summary}\n\nFull content stored in Soul's memory.`,
          },
        ],
      };
    }
  );
}
