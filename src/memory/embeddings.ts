/**
 * Vector Embeddings Engine — Semantic Memory for Soul
 *
 * Upgrades Soul's memory from keyword-only (FTS5+TF-IDF) to true semantic search.
 * Supports multiple embedding providers with automatic fallback:
 *   1. Ollama local (free, private) — nomic-embed-text, mxbai-embed-large
 *   2. OpenAI — text-embedding-3-small (1536d)
 *   3. Gemini — text-embedding-004 (768d)
 *   4. Groq/Together — when available
 *
 * Storage: embeddings stored as Float32Array BLOB in SQLite
 * Search: cosine similarity with optional recency decay
 *
 * Design: Inspired by OpenClaw's 70% vector + 30% BM25 hybrid approach,
 * but enhanced with recency decay and confidence-based filtering.
 */

import { getRawDb } from "../db/index.js";

// ─── Configuration ───

interface EmbeddingProvider {
  name: string;
  model: string;
  dimensions: number;
  embed: (texts: string[]) => Promise<number[][]>;
}

let _activeProvider: EmbeddingProvider | null = null;
let _tableReady = false;

// ─── Table Setup ───

function ensureEmbeddingTable() {
  if (_tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_embeddings (
      id INTEGER PRIMARY KEY,
      memory_id INTEGER NOT NULL UNIQUE,
      embedding BLOB NOT NULL,
      dimensions INTEGER NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON soul_embeddings(memory_id)`);
  _tableReady = true;
}

// ─── Embedding Providers ───

function createOllamaProvider(model: string = "nomic-embed-text"): EmbeddingProvider {
  return {
    name: "ollama",
    model,
    dimensions: model.includes("mxbai") ? 1024 : 768,
    embed: async (texts: string[]) => {
      const results: number[][] = [];
      for (const text of texts) {
        // Truncate to ~8000 chars to avoid overflows, skip empty
        const cleaned = (text || "").trim().substring(0, 8000);
        if (!cleaned) { results.push([]); continue; }
        try {
          const response = await fetch("http://localhost:11434/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: cleaned }),
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) { results.push([]); continue; }
          const data = await response.json() as any;
          results.push(data.embeddings?.[0] || data.embedding || []);
        } catch { results.push([]); }
      }
      return results;
    },
  };
}

function createOpenAIProvider(apiKey: string, model: string = "text-embedding-3-small"): EmbeddingProvider {
  return {
    name: "openai",
    model,
    dimensions: model.includes("3-small") ? 1536 : 3072,
    embed: async (texts: string[]) => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`OpenAI embed failed: ${response.status}`);
      const data = await response.json() as any;
      return data.data.map((d: any) => d.embedding);
    },
  };
}

function createGeminiProvider(apiKey: string): EmbeddingProvider {
  return {
    name: "gemini",
    model: "text-embedding-004",
    dimensions: 768,
    embed: async (texts: string[]) => {
      const results: number[][] = [];
      for (const text of texts) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: { parts: [{ text }] },
            }),
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok) throw new Error(`Gemini embed failed: ${response.status}`);
        const data = await response.json() as any;
        results.push(data.embedding?.values || []);
      }
      return results;
    },
  };
}

function createGroqProvider(apiKey: string): EmbeddingProvider {
  return {
    name: "groq",
    model: "llama3-embedding",
    dimensions: 1024,
    embed: async (texts: string[]) => {
      // Groq uses OpenAI-compatible embedding endpoint
      const response = await fetch("https://api.groq.com/openai/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: "llama3-embedding", input: texts }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Groq embed failed: ${response.status}`);
      const data = await response.json() as any;
      return data.data.map((d: any) => d.embedding);
    },
  };
}

// ─── Provider Initialization with Fallback Chain ───

/**
 * Initialize the best available embedding provider.
 * Tries in order: Ollama (free) → configured LLM providers → fallback to none
 */
export async function initEmbeddingProvider(): Promise<boolean> {
  // 1. Try Ollama local (free, private)
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json() as any;
      const models = (data.models || []).map((m: any) => m.name);
      // Prefer nomic-embed-text, then mxbai-embed-large
      const embedModels = ["nomic-embed-text", "mxbai-embed-large", "all-minilm"];
      const available = embedModels.find(m => models.some((om: string) => om.startsWith(m)));
      if (available) {
        _activeProvider = createOllamaProvider(available);
        console.log(`[Embeddings] Using Ollama: ${available}`);
        return true;
      }
      // Try pulling nomic-embed-text if Ollama is running but no embed model
      console.log("[Embeddings] Ollama running but no embed model. Pulling nomic-embed-text...");
      try {
        await fetch("http://localhost:11434/api/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "nomic-embed-text", stream: false }),
          signal: AbortSignal.timeout(120000), // 2 min timeout for model pull
        });
        _activeProvider = createOllamaProvider("nomic-embed-text");
        console.log("[Embeddings] Pulled and using Ollama: nomic-embed-text");
        return true;
      } catch { /* pull failed, try next */ }
    }
  } catch { /* Ollama not running */ }

  // 2. Try configured LLM providers that support embeddings
  try {
    const db = getRawDb();
    const providers = db.prepare(
      "SELECT provider_id, api_key FROM soul_llm_configs WHERE is_active = 1"
    ).all() as any[];

    for (const p of providers) {
      const apiKey = p.api_key;
      if (!apiKey) continue;

      // Decrypt if needed
      let key = apiKey;
      try {
        const { safeDecryptSecret } = await import("../core/security.js");
        const decrypted = safeDecryptSecret(apiKey);
        if (decrypted) key = decrypted;
      } catch { /* use raw */ }

      if (p.provider_id === "openai" && key) {
        _activeProvider = createOpenAIProvider(key);
        console.log("[Embeddings] Using OpenAI: text-embedding-3-small");
        return true;
      }
      if (p.provider_id === "gemini" && key) {
        _activeProvider = createGeminiProvider(key);
        console.log("[Embeddings] Using Gemini: text-embedding-004");
        return true;
      }
      if (p.provider_id === "groq" && key) {
        _activeProvider = createGroqProvider(key);
        console.log("[Embeddings] Using Groq: llama3-embedding");
        return true;
      }
    }
  } catch { /* no LLM configs */ }

  console.log("[Embeddings] No embedding provider available. Using TF-IDF fallback.");
  return false;
}

/**
 * Get the active embedding provider (or null)
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  return _activeProvider;
}

// ─── Core Embedding Operations ───

/**
 * Embed a single text string → returns float array
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!_activeProvider) return null;
  try {
    const results = await _activeProvider.embed([text]);
    return results[0] || null;
  } catch (e: any) {
    console.error(`[Embeddings] Embed failed: ${e.message}`);
    return null;
  }
}

/**
 * Embed multiple texts in batch (more efficient)
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!_activeProvider) return texts.map(() => null);
  try {
    const results = await _activeProvider.embed(texts);
    return results;
  } catch (e: any) {
    console.error(`[Embeddings] Batch embed failed: ${e.message}`);
    return texts.map(() => null);
  }
}

// ─── Embedding Storage ───

/**
 * Store embedding for a memory
 */
export function storeEmbedding(memoryId: number, embedding: number[]): void {
  ensureEmbeddingTable();
  const db = getRawDb();
  const blob = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare(`
    INSERT OR REPLACE INTO soul_embeddings (memory_id, embedding, dimensions, model)
    VALUES (?, ?, ?, ?)
  `).run(memoryId, blob, embedding.length, _activeProvider?.model || "unknown");
}

/**
 * Get embedding for a memory
 */
export function getEmbedding(memoryId: number): number[] | null {
  ensureEmbeddingTable();
  const db = getRawDb();
  const row = db.prepare("SELECT embedding, dimensions FROM soul_embeddings WHERE memory_id = ?").get(memoryId) as any;
  if (!row) return null;
  return Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dimensions));
}

// ─── Vector Search ───

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface VectorSearchResult {
  memoryId: number;
  similarity: number;
  content: string;
  createdAt: string;
}

/**
 * Search memories by vector similarity
 * @param queryEmbedding - The query vector
 * @param limit - Max results
 * @param recencyDecayDays - Half-life for recency decay (0 = no decay)
 * @param minSimilarity - Minimum cosine similarity threshold
 */
export function vectorSearch(
  queryEmbedding: number[],
  limit: number = 10,
  recencyDecayDays: number = 30,
  minSimilarity: number = 0.3,
): VectorSearchResult[] {
  ensureEmbeddingTable();
  const db = getRawDb();

  // Get all embeddings (for now — will optimize with approximate search later)
  const rows = db.prepare(`
    SELECT e.memory_id, e.embedding, e.dimensions, m.content, m.created_at
    FROM soul_embeddings e
    JOIN memories m ON m.id = e.memory_id
    WHERE m.is_active = 1
  `).all() as any[];

  const now = Date.now();
  const results: VectorSearchResult[] = [];

  for (const row of rows) {
    const embedding = Array.from(new Float32Array(
      row.embedding.buffer, row.embedding.byteOffset, row.dimensions
    ));
    let similarity = cosineSimilarity(queryEmbedding, embedding);

    // Apply recency decay (exponential, half-life = recencyDecayDays)
    if (recencyDecayDays > 0 && row.created_at) {
      const ageMs = now - new Date(row.created_at).getTime();
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const decay = Math.pow(0.5, ageDays / recencyDecayDays);
      similarity *= (0.7 + 0.3 * decay); // 70% base + 30% recency bonus
    }

    if (similarity >= minSimilarity) {
      results.push({
        memoryId: row.memory_id,
        similarity,
        content: row.content,
        createdAt: row.created_at,
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// ─── Hybrid Search (Vector + FTS5) ───

export interface HybridResult {
  memoryId: number;
  content: string;
  score: number;
  vectorScore: number;
  ftsScore: number;
  createdAt: string;
}

/**
 * Hybrid search: 70% vector similarity + 30% FTS5 keyword match
 * This is the primary search function — combines semantic understanding with keyword precision.
 * Falls back to FTS5-only if no embedding provider is available.
 */
export async function hybridVectorSearch(
  query: string,
  limit: number = 10,
  vectorWeight: number = 0.7,
): Promise<HybridResult[]> {
  const db = getRawDb();

  // Step 1: Vector search (semantic)
  let vectorResults: VectorSearchResult[] = [];
  const queryEmbed = await embedText(query);
  if (queryEmbed) {
    vectorResults = vectorSearch(queryEmbed, limit * 2);
  }

  // Step 2: FTS5 keyword search
  let ftsResults: Array<{ id: number; content: string; rank: number; created_at: string }> = [];
  try {
    ftsResults = db.prepare(`
      SELECT m.id, m.content, m.created_at, rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      AND m.is_active = 1
      ORDER BY rank
      LIMIT ?
    `).all(query, limit * 2) as any[];
  } catch { /* FTS might fail on special chars */ }

  // Step 3: Merge with weighted scoring
  const scoreMap = new Map<number, { vectorScore: number; ftsScore: number; content: string; createdAt: string }>();

  // Normalize vector scores to 0-1
  const maxVectorScore = vectorResults.length > 0 ? vectorResults[0].similarity : 1;
  for (const vr of vectorResults) {
    const normalizedScore = maxVectorScore > 0 ? vr.similarity / maxVectorScore : 0;
    scoreMap.set(vr.memoryId, {
      vectorScore: normalizedScore,
      ftsScore: 0,
      content: vr.content,
      createdAt: vr.createdAt,
    });
  }

  // Normalize FTS scores (position-based, 1.0 for first result)
  for (let i = 0; i < ftsResults.length; i++) {
    const ftsScore = 1 - (i / Math.max(ftsResults.length, 1));
    const existing = scoreMap.get(ftsResults[i].id);
    if (existing) {
      existing.ftsScore = ftsScore;
    } else {
      scoreMap.set(ftsResults[i].id, {
        vectorScore: 0,
        ftsScore,
        content: ftsResults[i].content,
        createdAt: ftsResults[i].created_at,
      });
    }
  }

  // Calculate final scores
  const ftsWeight = 1 - vectorWeight;
  const results: HybridResult[] = [];
  for (const [memoryId, scores] of scoreMap) {
    const finalScore = scores.vectorScore * vectorWeight + scores.ftsScore * ftsWeight;
    results.push({
      memoryId,
      content: scores.content,
      score: finalScore,
      vectorScore: scores.vectorScore,
      ftsScore: scores.ftsScore,
      createdAt: scores.createdAt,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ─── Background Embedding Builder ───

let _embeddingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start background embedding of unembedded memories
 * Runs every 60 seconds, embeds 10 memories per batch
 */
export function startEmbeddingBuilder() {
  if (_embeddingInterval || !_activeProvider) return;

  console.log("[Embeddings] Background builder started");
  _embeddingInterval = setInterval(async () => {
    try {
      await embedUnembeddedMemories(10);
    } catch (e: any) {
      console.error("[Embeddings] Builder error:", e.message);
    }
  }, 60_000);

  // Also run once immediately
  embedUnembeddedMemories(50).catch(() => {});
}

/**
 * Embed memories that don't have embeddings yet
 */
export async function embedUnembeddedMemories(batchSize: number = 10): Promise<number> {
  if (!_activeProvider) return 0;
  ensureEmbeddingTable();
  const db = getRawDb();

  const unembedded = db.prepare(`
    SELECT m.id, m.content, m.tags
    FROM memories m
    LEFT JOIN soul_embeddings e ON e.memory_id = m.id
    WHERE m.is_active = 1 AND e.id IS NULL
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(batchSize) as any[];

  if (unembedded.length === 0) return 0;

  const texts = unembedded.map((m: any) => `${m.content} ${m.tags || ""}`);
  const embeddings = await embedBatch(texts);

  let stored = 0;
  for (let i = 0; i < unembedded.length; i++) {
    if (embeddings[i] && embeddings[i]!.length > 0) {
      storeEmbedding(unembedded[i].id, embeddings[i]!);
      stored++;
    }
  }

  if (stored > 0) {
    console.log(`[Embeddings] Embedded ${stored}/${unembedded.length} memories`);
  }
  return stored;
}

/**
 * Get embedding stats
 */
export function getEmbeddingStats(): {
  totalMemories: number;
  embeddedMemories: number;
  coverage: number;
  provider: string | null;
  model: string | null;
} {
  ensureEmbeddingTable();
  const db = getRawDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any)?.c || 0;
  const embedded = (db.prepare("SELECT COUNT(*) as c FROM soul_embeddings").get() as any)?.c || 0;
  return {
    totalMemories: total,
    embeddedMemories: embedded,
    coverage: total > 0 ? Math.round((embedded / total) * 100) : 0,
    provider: _activeProvider?.name || null,
    model: _activeProvider?.model || null,
  };
}
