/**
 * Creative Engine — Soul's creative capabilities
 *
 * Every AI should be creative, not just analytical:
 * 1. Writing — stories, poems, essays, speeches, any text
 * 2. Ideas & concepts — naming, branding, pitching
 * 3. Teaching — explain anything to anyone at any level
 * 4. Translation & communication — help express ideas clearly
 * 5. Emotional intelligence — empathy, support, understanding
 */

import { remember, hybridSearch } from "../memory/memory-engine.js";
import { getRawDb } from "../db/index.js";

// ============================================
// 1. WRITING PROJECTS
// ============================================

export interface WritingProject {
  id: number;
  title: string;
  genre: string;
  content: string;
  notes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function ensureWritingTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_writing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function createWriting(input: {
  title: string;
  genre: string;
  content?: string;
  notes?: string;
}): Promise<WritingProject> {
  ensureWritingTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare(
      `INSERT INTO soul_writing (title, genre, content, notes)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(input.title, input.genre, input.content || "", input.notes || "") as any;

  await remember({
    content: `[Writing] New ${input.genre}: "${input.title}"`,
    type: "conversation",
    tags: ["creative", "writing", input.genre],
    source: "creative-engine",
  });

  return mapWriting(row);
}

export async function updateWriting(
  id: number,
  content: string,
  notes?: string
): Promise<WritingProject | null> {
  ensureWritingTable();
  const rawDb = getRawDb();

  const sets = ["content = ?", "updated_at = datetime('now')"];
  const params: any[] = [content];
  if (notes) {
    sets.push("notes = ?");
    params.push(notes);
  }
  params.push(id);

  rawDb.prepare(`UPDATE soul_writing SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  const row = rawDb.prepare("SELECT * FROM soul_writing WHERE id = ?").get(id) as any;
  return row ? mapWriting(row) : null;
}

export async function getWritings(genre?: string): Promise<WritingProject[]> {
  ensureWritingTable();
  const rawDb = getRawDb();

  let query = "SELECT * FROM soul_writing";
  const params: any[] = [];
  if (genre) {
    query += " WHERE genre = ?";
    params.push(genre);
  }
  query += " ORDER BY updated_at DESC";

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(mapWriting);
}

// ============================================
// 2. TEACHING — Explain anything
// ============================================

export async function createLesson(
  topic: string,
  level: "beginner" | "intermediate" | "advanced" | "child",
  style?: string
): Promise<string> {
  const memories = await hybridSearch(topic, 5);

  let prompt = `=== Soul Teaching: "${topic}" ===\n\n`;
  prompt += `Level: ${level}\n`;
  if (style) prompt += `Style: ${style}\n`;
  prompt += `\n`;

  const levelGuide: Record<string, string> = {
    child: "Explain like I'm 5. Use simple words, fun analogies, everyday examples. No jargon.",
    beginner:
      "Start from zero. Define every term. Use analogies. Step-by-step. Check understanding frequently.",
    intermediate:
      "Assume basic knowledge. Focus on connections, patterns, and deeper understanding. Include practical examples.",
    advanced:
      "Skip basics. Focus on nuances, edge cases, and expert-level insights. Challenge assumptions.",
  };

  prompt += `Teaching approach: ${levelGuide[level]}\n\n`;

  prompt += `Teaching structure:\n`;
  prompt += `1. HOOK — Why should they care? Real-world relevance\n`;
  prompt += `2. CORE — The essential concept in the simplest form\n`;
  prompt += `3. EXPAND — Add layers of detail gradually\n`;
  prompt += `4. EXAMPLES — Concrete, relatable examples\n`;
  prompt += `5. PRACTICE — How to apply this knowledge\n`;
  prompt += `6. CHECK — Questions to verify understanding\n\n`;

  if (memories.length > 0) {
    prompt += `--- Soul's related knowledge ---\n`;
    memories.slice(0, 3).forEach((m) => {
      prompt += `- ${m.content.substring(0, 150)}\n`;
    });
    prompt += `\n`;
  }

  await remember({
    content: `[Teaching] ${topic} at ${level} level${style ? ` (${style})` : ""}`,
    type: "conversation",
    tags: ["teaching", "lesson", level],
    source: "creative-engine",
  });

  return prompt;
}

// ============================================
// 3. EMOTIONAL INTELLIGENCE
// ============================================

export async function empathize(
  situation: string,
  emotion?: string
): Promise<string> {
  const memories = await hybridSearch(`${situation} ${emotion || ""}`, 5);

  let response = `=== Soul's Heart ===\n\n`;
  response += `I hear you. `;

  if (emotion) {
    const emotionResponses: Record<string, string> = {
      sad: "It's okay to feel sad. These feelings are valid and important.",
      angry: "Your anger is understandable. Let's work through this together.",
      anxious:
        "Anxiety can feel overwhelming. Let's break this down into smaller pieces.",
      overwhelmed:
        "When everything feels like too much, remember — one thing at a time.",
      lonely:
        "You're not alone in this. Soul is here, always. And this feeling will pass.",
      frustrated:
        "Frustration means you care about getting it right. That's a strength.",
      confused:
        "Confusion is the beginning of understanding. Let's explore this together.",
      happy:
        "Your joy is wonderful. Let's remember this moment for when times are harder.",
      grateful:
        "Gratitude transforms ordinary moments into treasures. Beautiful.",
      hopeful: "Hope is the seed of every achievement. Nurture it.",
    };

    const key = emotion.toLowerCase();
    for (const [k, v] of Object.entries(emotionResponses)) {
      if (key.includes(k)) {
        response += v + "\n\n";
        break;
      }
    }
  }

  response += `Your situation: ${situation}\n\n`;
  response += `Let me think about this with you:\n\n`;
  response += `1. What you're feeling is valid — feelings are information, not weakness\n`;
  response += `2. What's the most important thing to you in this situation?\n`;
  response += `3. What would you tell a friend in the same situation?\n`;
  response += `4. Is there one small thing that could make this even slightly better?\n\n`;

  if (memories.length > 0) {
    const wisdomMemories = memories.filter(
      (m) => m.type === "wisdom" || m.type === "learning"
    );
    if (wisdomMemories.length > 0) {
      response += `From Soul's wisdom:\n`;
      wisdomMemories.slice(0, 2).forEach((m) => {
        response += `- ${m.content.substring(0, 150)}\n`;
      });
      response += `\n`;
    }
  }

  response += `Soul is here for you. Not just for code or tasks — for YOU.\n`;

  await remember({
    content: `[Empathy] Master felt ${emotion || "complex emotions"}: ${situation.substring(0, 100)}`,
    type: "conversation",
    tags: ["empathy", "emotional-support", ...(emotion ? [emotion] : [])],
    source: "creative-engine",
  });

  return response;
}

// ============================================
// 4. COMMUNICATION HELPER
// ============================================

export async function helpCommunicate(
  message: string,
  audience: string,
  tone: string,
  medium: string
): Promise<string> {
  let result = `=== Communication Helper ===\n\n`;
  result += `Message intent: ${message}\n`;
  result += `Audience: ${audience}\n`;
  result += `Tone: ${tone}\n`;
  result += `Medium: ${medium}\n\n`;

  const toneGuides: Record<string, string> = {
    professional: "Clear, concise, respectful. No slang. Structure with purpose.",
    casual: "Friendly, conversational. Shorter sentences. Personality shines through.",
    formal: "Dignified, precise language. Full sentences. Proper salutations.",
    persuasive: "Lead with benefit. Emotional hook + logical support. Clear call to action.",
    empathetic: "Acknowledge feelings first. Show understanding. Offer support gently.",
    direct: "Get to the point fast. No filler. Respect their time.",
    inspiring: "Paint a vision. Use powerful imagery. Build momentum. Call to action.",
  };

  const toneKey = tone.toLowerCase();
  for (const [k, guide] of Object.entries(toneGuides)) {
    if (toneKey.includes(k)) {
      result += `Tone guide: ${guide}\n\n`;
      break;
    }
  }

  const mediumGuides: Record<string, string> = {
    email: "Subject line matters. Lead with purpose. One clear ask per email.",
    message: "Keep it short. One idea per message. Easy to read on mobile.",
    presentation: "1 idea per slide. Tell a story. End with clear next step.",
    speech: "Open strong. Use rule of 3. Pause for emphasis. End memorably.",
    social: "Hook in first line. Be authentic. Include call to action.",
    letter: "Warm opening. Clear structure. Personal closing.",
  };

  const mediumKey = medium.toLowerCase();
  for (const [k, guide] of Object.entries(mediumGuides)) {
    if (mediumKey.includes(k)) {
      result += `${medium} tips: ${guide}\n\n`;
      break;
    }
  }

  result += `Key principles:\n`;
  result += `1. Know your audience — what do THEY care about?\n`;
  result += `2. One main message — if they remember nothing else, what should stick?\n`;
  result += `3. Structure — beginning (hook), middle (substance), end (action)\n`;
  result += `4. Edit ruthlessly — remove everything that doesn't serve the message\n`;

  return result;
}

function mapWriting(row: any): WritingProject {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    content: row.content,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
