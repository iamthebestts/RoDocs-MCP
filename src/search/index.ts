import { fetchIndex } from "../scraper/fetch.js";
import type { GuideMetadata } from "../scraper/guides.js";
import { fetchGuideIndex } from "../scraper/guides.js";
import type { LmdbStore, SyncStateManager } from "../store/index.js";
import { Indexer } from "../store/indexer.js";
import type { BM25Doc, SearchOptions, SearchResult } from "../types/index.js";
import { resolveAliases, resolveLuauSynonyms } from "./aliases.js";
import { BM25 } from "./bm25.js";

const apiBM25 = new BM25();
const guideBM25 = new BM25();

let indexer: Indexer | null = null;

const apiCategories = new Map<string, "class" | "enum">();
const guideMetaById = new Map<string, GuideMetadata>();

let apiIndexing: Promise<void> | null = null;
let guideIndexing: Promise<void> | null = null;

const GUIDE_SCORE_THRESHOLD = 5;
const API_SCORE_THRESHOLD = 5;
let guideScoreThreshold = GUIDE_SCORE_THRESHOLD;

/**
 * Initialize the indexer with the provided store and sync manager.
 */
export function initIndexer(store: LmdbStore, syncManager: SyncStateManager): void {
  indexer = new Indexer(store, syncManager);
}

function buildApiIndex(githubToken?: string): Promise<void> {
  if (apiIndexing !== null) return apiIndexing;

  apiIndexing = (async (): Promise<void> => {
    const build = async () => {
      const { classes, enums } = await fetchIndex(githubToken);
      const docs: BM25Doc[] = [];

      for (const name of classes) {
        docs.push({
          id: name,
          fields: { title: name, path: `classes/${name}` },
        });
        apiCategories.set(name, "class");
      }

      for (const name of enums) {
        docs.push({ id: name, fields: { title: name, path: `enums/${name}` } });
        apiCategories.set(name, "enum");
      }

      apiBM25.index(docs);
    };

    if (indexer) {
      await indexer.loadOrBuildIndex("api", apiBM25, build);
    } else {
      await build();
    }
  })().catch((error: unknown) => {
    apiIndexing = null;
    throw error;
  });

  return apiIndexing;
}

function buildGuideIndex(githubToken?: string): Promise<void> {
  if (guideIndexing !== null) return guideIndexing;

  guideIndexing = (async (): Promise<void> => {
    const build = async () => {
      const entries = await fetchGuideIndex(githubToken);
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
    };

    if (indexer) {
      await indexer.loadOrBuildIndex("guides", guideBM25, build);
    } else {
      await build();
    }
  })().catch((error: unknown) => {
    guideIndexing = null;
    throw error;
  });

  return guideIndexing;
}

export async function searchApis(
  query: string,
  limit = 10,
  githubToken?: string,
): Promise<readonly SearchResult[]> {
  await buildApiIndex(githubToken);

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

export async function searchApisLocal(query: string, limit = 10): Promise<readonly SearchResult[]> {
  if (apiBM25.indexedCount === 0 && indexer) {
    await indexer.load(apiBM25, "api");
  }
  if (apiBM25.indexedCount === 0) return [];

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

export async function searchGuides(
  query: string,
  limit = 10,
  githubToken?: string,
): Promise<readonly SearchResult[]> {
  await buildGuideIndex(githubToken);

  const resolvedQuery = resolveLuauSynonyms(query);

  return guideBM25
    .search(resolvedQuery, limit)
    .filter((r) => r.score >= guideScoreThreshold)
    .map((r): SearchResult => {
      const meta = guideMetaById.get(r.id);
      const category = meta?.category ?? r.id.split("/")[0] ?? "unknown";

      return {
        type: "guide",
        name: r.id,
        path: r.id,
        score: r.score,
        category,
        ...(meta?.title ? { title: meta.title } : {}),
        ...(meta?.description ? { description: meta.description } : {}),
      };
    });
}

export async function searchGuidesLocal(
  query: string,
  limit = 10,
): Promise<readonly SearchResult[]> {
  if (guideBM25.indexedCount === 0 && indexer) {
    await indexer.load(guideBM25, "guides");
  }
  if (guideBM25.indexedCount === 0) return [];

  const resolvedQuery = resolveLuauSynonyms(query);

  return guideBM25
    .search(resolvedQuery, limit)
    .filter((r) => r.score >= guideScoreThreshold)
    .map((r): SearchResult => {
      const meta = guideMetaById.get(r.id);
      const category = meta?.category ?? r.id.split("/")[0] ?? "unknown";

      return {
        type: "guide",
        name: r.id,
        path: r.id,
        score: r.score,
        category,
        ...(meta?.title ? { title: meta.title } : {}),
        ...(meta?.description ? { description: meta.description } : {}),
      };
    });
}

export async function search(
  query: string,
  options: SearchOptions = {},
  githubToken?: string,
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
    const apiResults = await searchApis(query, perType + aliases.length, githubToken);
    for (const r of apiResults) {
      if (results.some((x) => x.name === r.name)) continue;
      results.push(r);
    }
  }

  if (types.includes("guide")) {
    const guideResults = await searchGuides(query, perType, githubToken);
    for (const r of guideResults) {
      results.push(r);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function warmUp(githubToken?: string): void {
  void buildApiIndex(githubToken);
  void buildGuideIndex(githubToken);
}

export function _resetIndexesForTesting(opts?: { guideScoreThreshold?: number }): void {
  indexer = null;
  apiIndexing = null;
  guideIndexing = null;
  apiCategories.clear();
  guideMetaById.clear();
  apiBM25.reset();
  guideBM25.reset();
  guideScoreThreshold = opts?.guideScoreThreshold ?? GUIDE_SCORE_THRESHOLD;
}
