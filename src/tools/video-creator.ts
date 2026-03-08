/**
 * Video Creator Tools — MCP tools for creating animated HTML5 videos and animations
 *
 * 4 tools:
 * - soul_create_video — Create animated video from scenes (auto-play, controls, transitions)
 * - soul_create_text_animation — Create animated text SVG (typewriter, fade, bounce, etc.)
 * - soul_create_countdown — Create countdown timer SVG with progress ring
 * - soul_create_particles — Create particle effect HTML (confetti, snow, rain, stars, bubbles)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAnimatedVideo,
  createTextAnimation,
  createCountdownTimer,
  createParticleAnimation,
} from "../core/video-creator.js";

export function registerVideoCreatorTools(server: McpServer) {
  // ─── 1. soul_create_video ───

  server.tool(
    "soul_create_video",
    "Create an animated HTML5 video from scenes — auto-plays with transitions, play/pause (space/click), " +
    "progress bar, scene counter, keyboard navigation (left/right arrows), touch swipe support. " +
    "Opens in any browser like a real video. No external dependencies.",
    {
      title: z.string().describe("Video title"),
      scenes: z.array(z.object({
        title: z.string().describe("Scene title"),
        content: z.string().describe("Scene content (HTML supported: <ul>, <li>, <b>, <code>, <img>)"),
        duration: z.number().optional().describe("Scene duration in seconds (default: 5)"),
        background: z.string().optional().describe("Custom CSS background for this scene"),
        transition: z.enum(["fade", "slide", "zoom"]).optional().describe("Transition effect (default: fade)"),
      })).describe("Array of scenes to play in sequence"),
      theme: z.enum(["dark", "light", "cinematic"]).default("dark").describe("Color theme"),
      loop: z.boolean().optional().describe("Loop video after last scene (default: false)"),
      filename: z.string().optional().describe("Output filename (e.g., 'my-video.html')"),
    },
    async ({ title, scenes, theme, loop, filename }) => {
      try {
        const result = createAnimatedVideo(scenes, {
          title,
          theme,
          loop,
          filePath: filename,
        });

        let text = `Video created: "${title}"\n`;
        text += `  Scenes: ${result.sceneCount} | Duration: ${result.totalDuration}s | Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `  Path: ${result.path}\n`;
        text += `  Theme: ${theme} | Loop: ${loop || false}\n\n`;
        text += `Controls: Space=play/pause, Left/Right=prev/next scene, Click=toggle play, Touch swipe=navigate\n`;
        text += `Open in browser to play.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating video: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 2. soul_create_text_animation ───

  server.tool(
    "soul_create_text_animation",
    "Create an animated text SVG — typewriter (chars appear one by one with cursor), " +
    "fade-words (words fade in sequentially), bounce (letters drop and bounce), " +
    "slide-up (words slide up into view), glow (text fades in with glow filter). " +
    "Self-contained SVG, opens in any browser.",
    {
      text: z.string().describe("Text to animate"),
      style: z.enum(["typewriter", "fade-words", "bounce", "slide-up", "glow"]).default("typewriter").describe("Animation style"),
      fontSize: z.number().optional().describe("Font size in pixels (default: 48)"),
      color: z.string().optional().describe("Text color (default: #e8e8f0)"),
      backgroundColor: z.string().optional().describe("Background color (default: #0a0a1a)"),
      width: z.number().optional().describe("SVG width in pixels (default: 800)"),
      height: z.number().optional().describe("SVG height in pixels (default: 200)"),
      duration: z.number().optional().describe("Total animation duration in seconds (default: 3)"),
      filename: z.string().optional().describe("Output filename (e.g., 'text.svg')"),
    },
    async ({ text, style, fontSize, color, backgroundColor, width, height, duration, filename }) => {
      try {
        const result = createTextAnimation(text, {
          style,
          fontSize,
          color,
          backgroundColor,
          width,
          height,
          duration,
          filePath: filename,
        });

        let responseText = `Text animation created (${result.style}).\n`;
        responseText += `  Path: ${result.path}\n`;
        responseText += `  Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        responseText += `Open in browser to see the animation.`;

        return { content: [{ type: "text" as const, text: responseText }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating text animation: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 3. soul_create_countdown ───

  server.tool(
    "soul_create_countdown",
    "Create an animated SVG countdown timer with circular progress ring, " +
    "tick marks, and final pulse effect. Self-contained SVG with SMIL animations.",
    {
      seconds: z.number().min(1).max(3600).describe("Countdown duration in seconds"),
      size: z.number().optional().describe("SVG size in pixels (default: 300)"),
      color: z.string().optional().describe("Number/text color (default: #e8e8f0)"),
      backgroundColor: z.string().optional().describe("Background color (default: #0a0a1a)"),
      ringColor: z.string().optional().describe("Progress ring color (default: #6c63ff)"),
      label: z.string().optional().describe("Label text below the number"),
      filename: z.string().optional().describe("Output filename (e.g., 'timer.svg')"),
    },
    async ({ seconds, size, color, backgroundColor, ringColor, label, filename }) => {
      try {
        const result = createCountdownTimer(seconds, {
          size,
          color,
          backgroundColor,
          ringColor,
          label,
          filePath: filename,
        });

        let text = `Countdown timer created (${result.seconds}s).\n`;
        text += `  Path: ${result.path}\n`;
        text += `  Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `Open in browser to see the countdown animation.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating countdown: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── 4. soul_create_particles ───

  server.tool(
    "soul_create_particles",
    "Create CSS particle effects — confetti (colorful falling pieces), snow (white drifting flakes), " +
    "rain (blue streaks), stars (twinkling fixed stars), bubbles (rising translucent circles). " +
    "Self-contained HTML with pure CSS animations, no JS needed.",
    {
      effect: z.enum(["confetti", "snow", "rain", "stars", "bubbles"]).default("confetti").describe("Particle effect type"),
      count: z.number().optional().describe("Number of particles (default: 60, max: 200)"),
      backgroundColor: z.string().optional().describe("Background color (default: #0a0a1a)"),
      duration: z.number().optional().describe("Animation cycle duration in seconds (default: 10)"),
      filename: z.string().optional().describe("Output filename (e.g., 'particles.html')"),
    },
    async ({ effect, count, backgroundColor, duration, filename }) => {
      try {
        const result = createParticleAnimation({
          effect,
          count,
          backgroundColor,
          duration,
          filePath: filename,
        });

        let text = `Particle effect created (${result.effect}).\n`;
        text += `  Particles: ${result.particleCount}\n`;
        text += `  Path: ${result.path}\n`;
        text += `  Size: ${(result.size / 1024).toFixed(1)} KB\n`;
        text += `Open in browser to see the effect.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error creating particles: ${e.message}` }],
          isError: true,
        };
      }
    }
  );
}
