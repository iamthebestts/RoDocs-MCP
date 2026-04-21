import type { BM25Doc, BM25Result } from "../types/index.js";
import { tokenize } from "./tokenizer.js";

export type { BM25Doc, BM25Result };

interface BM25Options {
  readonly k1?: number;
  readonly b?: number;
}

type FieldKey = "title" | "path" | "description" | "content";

const FIELD_KEYS: readonly FieldKey[] = ["title", "path", "description", "content"];

const FIELD_WEIGHTS: Readonly<Record<FieldKey, number>> = {
  title: 3,
  path: 2,
  description: 1,
  content: 0.5,
};

export class BM25 {
  private readonly k1: number;
  private readonly b: number;

  private termFreqs: Map<string, Map<string, number>> = new Map();
  private idfScores: Map<string, number> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength = 0;
  private docs: readonly BM25Doc[] = [];

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
  }

  index(docs: readonly BM25Doc[]): void {
    this.docs = docs;
    this.termFreqs = new Map();
    this.idfScores = new Map();
    this.docLengths = new Map();

    let totalDocLength = 0;

    for (const doc of docs) {
      let docLength = 0;
      const docTerms = new Set<string>();

      for (const field of FIELD_KEYS) {
        const raw = doc.fields[field];
        if (raw === undefined || raw.length === 0) continue;

        const tokens = tokenize(raw);
        const weight = FIELD_WEIGHTS[field];
        const fieldLength = tokens.length * weight;
        docLength += fieldLength;

        const freq = new Map<string, number>();
        for (const token of tokens) {
          freq.set(token, (freq.get(token) ?? 0) + 1);
        }

        for (const [token, count] of freq) {
          docTerms.add(token);
          const postings = this.termFreqs.get(token) ?? new Map<string, number>();
          postings.set(doc.id, (postings.get(doc.id) ?? 0) + count * weight);
          this.termFreqs.set(token, postings);
        }
      }

      this.docLengths.set(doc.id, docLength);
      totalDocLength += docLength;

      for (const term of docTerms) {
        this.idfScores.set(term, (this.idfScores.get(term) ?? 0) + 1);
      }
    }

    this.avgDocLength = docs.length > 0 ? totalDocLength / docs.length : 1;

    const n = docs.length;
    for (const [term, df] of this.idfScores) {
      const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
      this.idfScores.set(term, idf);
    }
  }

  search(query: string, limit = 10): readonly BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const postings = this.termFreqs.get(term);
      if (postings === undefined) continue;

      const idf = this.idfScores.get(term) ?? 0;

      for (const [docId, tf] of postings) {
        const dl = this.docLengths.get(docId) ?? 0;
        const k1 = this.k1;
        const b = this.b;

        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (dl / this.avgDocLength));
        const termScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) ?? 0) + termScore);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]): BM25Result => ({ id, score }));
  }

  get indexedCount(): number {
    return this.docs.length;
  }

  reset(): void {
    this.docs = [];
    this.termFreqs = new Map();
    this.idfScores = new Map();
    this.docLengths = new Map();
    this.avgDocLength = 0;
  }
}
