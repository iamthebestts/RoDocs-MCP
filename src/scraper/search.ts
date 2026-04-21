import type { BM25Doc, SearchOptions, SearchResult } from "../types/index.js";
import { resolveAliases } from "./aliases.js";
import { BM25 } from "./bm25.js";
import { fetchIndex } from "./fetch.js";
import type { GuideMetadata } from "./guides.js";
import { fetchGuideIndex } from "./guides.js";

const apiBM25 = new BM25();
const guideBM25 = new BM25();

const apiCategories = new Map<string, "class" | "enum">();
const guideMetaById = new Map<string, GuideMetadata>();

let apiIndexing: Promise<void> | null = null;
let guideIndexing: Promise<void> | null = null;

const GUIDE_SCORE_THRESHOLD = 10;
let guideScoreThreshold = GUIDE_SCORE_THRESHOLD;
const API_SCORE_THRESHOLD = 5;

function buildApiIndex(): Promise<void> {
  if (apiIndexing !== null) return apiIndexing;

  apiIndexing = (async (): Promise<void> => {
    const { classes, enums } = await fetchIndex();
    const docs: BM25Doc[] = [];

    for (const name of classes) {
      docs.push({ id: name, fields: { title: name, path: `classes/${name}` } });
      apiCategories.set(name, "class");
    }

    for (const name of enums) {
      docs.push({ id: name, fields: { title: name, path: `enums/${name}` } });
      apiCategories.set(name, "enum");
    }

    apiBM25.index(docs);
  })();

  return apiIndexing;
}

function buildGuideIndex(): Promise<void> {
  if (guideIndexing !== null) return guideIndexing;

  guideIndexing = (async (): Promise<void> => {
    const entries = await fetchGuideIndex();
    const docs: BM25Doc[] = [];

    for (const entry of entries) {
      docs.push({
        id: entry.path,
        fields: {
          title: entry.title,
          path: entry.path,
          description: entry.description,
        },
      });
      guideMetaById.set(entry.path, entry);
    }

    guideBM25.index(docs);
  })();

  return guideIndexing;
}

export async function searchApis(query: string, limit = 10): Promise<readonly SearchResult[]> {
  await buildApiIndex();

  return apiBM25
    .search(query, limit)
    .filter((r) => r.score >= API_SCORE_THRESHOLD)
    .map((r): SearchResult => {
      const category = apiCategories.get(r.id);

      return {
        type: "api",
        name: r.id,
        path: category === "enum" ? `enums/${r.id}` : `classes/${r.id}`,
        score: r.score,
        ...(category ? { category } : {}),
      };
    });
}

export async function searchGuides(query: string, limit = 10): Promise<readonly SearchResult[]> {
  await buildGuideIndex();

  return guideBM25
    .search(query, limit)
    .filter((r) => r.score >= guideScoreThreshold)
    .map((r): SearchResult => {
      const meta = guideMetaById.get(r.id);

      return {
        type: "guide",
        name: r.id,
        path: r.id,
        score: r.score,
        ...(meta?.category ? { category: meta.category } : {}),
        ...(meta?.title ? { title: meta.title } : {}),
        ...(meta?.description ? { description: meta.description } : {}),
      };
    });
}

export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<readonly SearchResult[]> {
  const limit = options.limit ?? 10;
  const types: ReadonlyArray<"api" | "guide"> = options.types ?? ["api", "guide"];

  const results: SearchResult[] = [];

  const aliases = resolveAliases(query);
  for (const name of aliases) {
    results.push({
      type: "api",
      name,
      path: `classes/${name}`,
      score: 100,
      category: "class",
    });
  }

  const perType = Math.ceil(limit / types.length);

  if (types.includes("api")) {
    const apiResults = await searchApis(query, perType + aliases.length);
    for (const r of apiResults) {
      if (results.some((x) => x.name === r.name)) continue;
      results.push(r);
    }
  }

  if (types.includes("guide")) {
    const guideResults = await searchGuides(query, perType);
    for (const r of guideResults) {
      results.push(r);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function warmUp(): void {
  void buildApiIndex();
  void buildGuideIndex();
}

export function _resetIndexesForTesting(opts?: { guideScoreThreshold?: number }): void {
  apiIndexing = null;
  guideIndexing = null;
  apiCategories.clear();
  guideMetaById.clear();
  apiBM25.reset();
  guideBM25.reset();
  guideScoreThreshold = opts?.guideScoreThreshold ?? GUIDE_SCORE_THRESHOLD;
}
