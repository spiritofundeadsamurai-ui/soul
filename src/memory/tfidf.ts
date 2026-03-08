/**
 * Pure TF-IDF Cosine Similarity Search
 * No external ML libraries needed — runs anywhere offline.
 *
 * Used as a semantic fallback when FTS5 keyword search misses relevance.
 * Hybrid approach: FTS5 for candidates, TF-IDF for re-ranking.
 */

type DocId = string | number;

interface IndexedDoc {
  id: DocId;
  termFreq: Map<string, number>;
  termCount: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "in", "on", "at", "to", "of", "and", "or",
  "it", "its", "this", "that", "for", "with", "as", "by", "from", "be",
  "was", "were", "been", "are", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "not", "no",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\s]/g, " ") // keep Thai chars
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function normalize(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t));
}

export class TfIdfIndex {
  private docs: Map<DocId, IndexedDoc> = new Map();
  private docFreq: Map<string, number> = new Map();

  add(id: DocId, text: string): void {
    const tokens = normalize(tokenize(text));
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    // Remove old doc counts if updating
    if (this.docs.has(id)) {
      const old = this.docs.get(id)!;
      for (const term of old.termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 1) - 1);
      }
    }

    for (const term of termFreq.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.docs.set(id, { id, termFreq, termCount: tokens.length });
  }

  remove(id: DocId): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const term of doc.termFreq.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 1) - 1);
    }
    this.docs.delete(id);
  }

  private tf(doc: IndexedDoc, term: string): number {
    return (doc.termFreq.get(term) ?? 0) / (doc.termCount || 1);
  }

  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    const N = this.docs.size;
    if (df === 0 || N === 0) return 0;
    return Math.log((N + 1) / (df + 1)) + 1;
  }

  private tfidfVector(doc: IndexedDoc, terms: string[]): number[] {
    return terms.map((term) => this.tf(doc, term) * this.idf(term));
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  search(queryText: string, topK = 10): Array<{ id: DocId; score: number }> {
    const queryTerms = normalize(tokenize(queryText));
    if (queryTerms.length === 0 || this.docs.size === 0) return [];

    const queryDoc: IndexedDoc = {
      id: "__query__",
      termFreq: new Map(),
      termCount: queryTerms.length,
    };
    for (const term of queryTerms) {
      queryDoc.termFreq.set(term, (queryDoc.termFreq.get(term) ?? 0) + 1);
    }

    const terms = [...new Set(queryTerms)];
    const queryVec = this.tfidfVector(queryDoc, terms);
    const scores: Array<{ id: DocId; score: number }> = [];

    for (const doc of this.docs.values()) {
      const docVec = this.tfidfVector(doc, terms);
      const score = this.cosine(queryVec, docVec);
      if (score > 0) {
        scores.push({ id: doc.id, score });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  get size(): number {
    return this.docs.size;
  }

  clear(): void {
    this.docs.clear();
    this.docFreq.clear();
  }
}
