import { fetchIndex } from "../scraper/fetch.js";
import type { GuideMetadata } from "../scraper/guides.js";
import { fetchGuideIndex } from "../scraper/guides.js";
import type { IKeyValueStore, SyncStateManager } from "../store/index.js";
import { Indexer } from "../store/indexer.js";
import type { BM25Doc, SearchOptions, SearchResult } from "../types/index.js";
import { observe, startTimer } from "../utils/logger.js";
import { expandQuery, resolveAliases, resolveLuauSynonyms } from "./aliases.js";
import { BM25 } from "./bm25.js";
import { findClosestMatch } from "./fuzzy.js";
import { applyRecencyBoost, type RecencyConfig } from "./recency.js";

const apiBM25 = new BM25();
const guideBM25 = new BM25();

let indexer: Indexer | null = null;

type ApiSearchKind = "class" | "datatype" | "enum" | "global" | "library";

const apiCategories = new Map<string, ApiSearchKind>();
const guideMetaById = new Map<string, GuideMetadata>();

let apiIndexing: Promise<void> | null = null;
let guideIndexing: Promise<void> | null = null;

const GUIDE_SCORE_THRESHOLD = 5;
const API_SCORE_THRESHOLD = 5;
let guideScoreThreshold = GUIDE_SCORE_THRESHOLD;

function apiPathPrefix(category: ApiSearchKind): string {
  switch (category) {
    case "class":
      return "classes";
    case "datatype":
      return "datatypes";
    case "enum":
      return "enums";
    case "global":
      return "globals";
    case "library":
      return "libraries";
  }
}

function apiKindFromPath(path: string | undefined): ApiSearchKind | undefined {
  if (!path) return undefined;
  if (path.startsWith("classes/")) return "class";
  if (path.startsWith("datatypes/")) return "datatype";
  if (path.startsWith("enums/")) return "enum";
  if (path.startsWith("globals/")) return "global";
  if (path.startsWith("libraries/")) return "library";
  return undefined;
}

function hydrateApiCategoriesFromBM25(): void {
  if (apiCategories.size > 0 || apiBM25.indexedCount === 0) return;
  for (const doc of apiBM25.indexedDocs) {
    const kind = apiKindFromPath(doc.fields.path) ?? "class";
    apiCategories.set(doc.id, kind);
  }
}

function hydrateGuideMetaFromBM25(): void {
  if (guideMetaById.size > 0 || guideBM25.indexedCount === 0) return;
  for (const doc of guideBM25.indexedDocs) {
    const path = doc.fields.path ?? doc.id;
    guideMetaById.set(doc.id, {
      path,
      title: doc.fields.title ?? "",
      description: doc.fields.description ?? "",
      category: path.split("/")[0] ?? "unknown",
    });
  }
}

export function lookupApiCategory(name: string): ApiSearchKind | undefined {
  hydrateApiCategoriesFromBM25();
  return apiCategories.get(name);
}

export function lookupGuideMeta(path: string): GuideMetadata | undefined {
  hydrateGuideMetaFromBM25();
  return guideMetaById.get(path);
}

/**
 * Initialize the indexer with the provided store and sync manager.
 * Accepts an existing Indexer instance so the server can share one across all components.
 */
export function initIndexer(
  store: IKeyValueStore,
  syncManager: SyncStateManager,
  existingIndexer?: Indexer,
): void {
  indexer = existingIndexer ?? new Indexer(store, syncManager);
  indexer.onClear("api", () => {
    apiIndexing = null;
    apiBM25.reset();
    apiCategories.clear();
  });
  indexer.onClear("guides", () => {
    guideIndexing = null;
    guideBM25.reset();
    guideMetaById.clear();
  });
}

function uniqueByName(results: readonly SearchResult[]): readonly SearchResult[] {
  const byName = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = byName.get(result.name);
    if (existing === undefined || result.score > existing.score) {
      byName.set(result.name, result);
    }
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}

function applyQueryExpansion(
  bm25: BM25,
  query: string,
  limit: number,
  mapper: (result: { id: string; score: number }) => SearchResult,
): readonly SearchResult[] {
  const results = expandQuery(query).flatMap((variant) => bm25.search(variant, limit).map(mapper));
  return uniqueByName(results).slice(0, limit);
}

function projectApiResult(name: string, score: number): SearchResult {
  const category = apiCategories.get(name);
  const pathPrefix = category === undefined ? "classes" : apiPathPrefix(category);
  return {
    type: "api",
    name,
    path: `${pathPrefix}/${name}`,
    score,
    ...(category ? { category } : {}),
  };
}

function findExactApiName(query: string): string | undefined {
  const normalized = query.toLowerCase().replace(/\s+/g, "");
  return [...apiCategories.keys()].find((name) => name.toLowerCase() === normalized);
}

export function sortByRecency<T extends SearchResult & { ageDays?: number | undefined }>(
  results: readonly T[],
  config: RecencyConfig = {},
): readonly T[] {
  return [...results].sort((a, b) => {
    const left = applyRecencyBoost(a.score, a.ageDays ?? 0, config);
    const right = applyRecencyBoost(b.score, b.ageDays ?? 0, config);
    return right - left;
  });
}

function buildApiIndex(githubToken?: string): Promise<void> {
  if (apiIndexing !== null) return apiIndexing;

  apiIndexing = (async (): Promise<void> => {
    const build = async () => {
      const elapsed = startTimer();
      const {
        classes,
        datatypes = [],
        enums,
        globals = [],
        libraries = [],
      } = await fetchIndex(githubToken);
      const docs: BM25Doc[] = [];

      const addDocs = (names: string[], category: ApiSearchKind) => {
        const pathPrefix = apiPathPrefix(category);
        for (const name of names) {
          docs.push({
            id: name,
            fields: { title: name, path: `${pathPrefix}/${name}` },
          });
          apiCategories.set(name, category);
        }
      };

      addDocs(classes, "class");
      addDocs(datatypes, "datatype");
      addDocs(enums, "enum");
      addDocs(globals, "global");
      for (const name of libraries) {
        docs.push({
          id: name,
          fields: { title: name, path: `libraries/${name}` },
        });
        apiCategories.set(name, "library");
      }

      apiBM25.index(docs);
      observe({ event: "search.rebuild", source: "api", durationMs: elapsed() });
    };

    if (indexer) {
      await indexer.loadOrBuildIndex("api", apiBM25, build);
      hydrateApiCategoriesFromBM25();
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
      const elapsed = startTimer();
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
      observe({ event: "search.rebuild", source: "guides", durationMs: elapsed() });
    };

    if (indexer) {
      await indexer.loadOrBuildIndex("guides", guideBM25, build);
      hydrateGuideMetaFromBM25();
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
  const elapsed = startTimer();
  try {
    await buildApiIndex(githubToken);

    const exact = findExactApiName(query);
    const results = uniqueByName([
      ...(exact !== undefined ? [projectApiResult(exact, 100)] : []),
      ...applyQueryExpansion(apiBM25, query, limit, (r) => projectApiResult(r.id, r.score)),
    ]).filter((r) => r.score >= API_SCORE_THRESHOLD);

    if (results.length > 0) return results;

    const closest = findClosestMatch(query, [...apiCategories.keys()]);
    if (closest === null) return [];

    return [projectApiResult(closest, API_SCORE_THRESHOLD)];
  } finally {
    observe({ event: "search.query", source: "api", durationMs: elapsed() });
  }
}

export async function searchApisLocal(query: string, limit = 10): Promise<readonly SearchResult[]> {
  if (apiBM25.indexedCount === 0 && indexer) {
    await indexer.load(apiBM25, "api");
  }
  if (apiBM25.indexedCount === 0) return [];
  hydrateApiCategoriesFromBM25();

  const exact = findExactApiName(query);
  return uniqueByName([
    ...(exact !== undefined ? [projectApiResult(exact, 100)] : []),
    ...applyQueryExpansion(apiBM25, query, limit, (r) => projectApiResult(r.id, r.score)),
  ])
    .filter((r) => r.score >= API_SCORE_THRESHOLD)
    .slice(0, limit);
}

export async function searchGuides(
  query: string,
  limit = 10,
  githubToken?: string,
): Promise<readonly SearchResult[]> {
  const elapsed = startTimer();
  try {
    await buildGuideIndex(githubToken);

    const resolvedQuery = resolveLuauSynonyms(query);

    const results = applyQueryExpansion(guideBM25, resolvedQuery, limit, (r): SearchResult => {
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
    }).filter((r) => r.score >= guideScoreThreshold);

    if (results.length > 0) return results;

    const candidates = [...guideMetaById.values()].flatMap((meta) => [meta.path, meta.title]);
    const closest = findClosestMatch(
      resolvedQuery,
      candidates.filter((candidate) => candidate.length > 0),
    );
    if (closest === null) return [];

    const meta = [...guideMetaById.values()].find(
      (entry) => entry.path === closest || entry.title === closest,
    );
    if (meta === undefined) return [];

    return [
      {
        type: "guide",
        name: meta.path,
        path: meta.path,
        score: guideScoreThreshold,
        category: meta.category,
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.description ? { description: meta.description } : {}),
      },
    ];
  } finally {
    observe({ event: "search.query", source: "guides", durationMs: elapsed() });
  }
}

export async function searchGuidesLocal(
  query: string,
  limit = 10,
): Promise<readonly SearchResult[]> {
  if (guideBM25.indexedCount === 0 && indexer) {
    await indexer.load(guideBM25, "guides");
  }
  if (guideBM25.indexedCount === 0) return [];
  hydrateGuideMetaFromBM25();

  const resolvedQuery = resolveLuauSynonyms(query);

  return applyQueryExpansion(guideBM25, resolvedQuery, limit, (r): SearchResult => {
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
  })
    .filter((r) => r.score >= guideScoreThreshold)
    .slice(0, limit);
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

/**
 * Awaitable warmups. Unlike {@link warmUp} (fire-and-forget), these resolve
 * only once the index is actually queryable and reject if the build fails,
 * so the seed pipeline can mark a source "complete" accurately and retry on
 * failure instead of silently swallowing errors.
 */
export function ensureApiIndex(githubToken?: string): Promise<void> {
  return buildApiIndex(githubToken);
}

export function ensureGuideIndex(githubToken?: string): Promise<void> {
  return buildGuideIndex(githubToken);
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
