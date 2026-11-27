import type Database from "better-sqlite3";
import { searchDevForumStore } from "../devforum/search.js";
import type { DevForumRecord } from "../devforum/types.js";
import { embed } from "../embedding/embedder.js";
import type { FastFlag } from "../fastflags/parser.js";
import { FastFlagSearch } from "../fastflags/search.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SearchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { lookupApiCategory, lookupGuideMeta, searchApis, searchGuides } from "./index.js";

type StoreWithDb = IKeyValueStore & { getDb(): Database.Database };

function hasGetDb(store: IKeyValueStore): store is StoreWithDb {
  return typeof (store as unknown as Record<string, unknown>)["getDb"] === "function";
}

export interface RRFEntry {
  id: string;
  rrfScore: number;
}

export function reciprocalRankFusion(
  bm25Results: ReadonlyArray<{ id: string; bm25Rank: number }>,
  vecResults: ReadonlyArray<{ id: string; vecRank: number }>,
  k = 60,
  limit: number,
): readonly RRFEntry[] {
  const penalty = limit + 1;
  const scores = new Map<string, number>();

  for (const { id, bm25Rank } of bm25Results) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + bm25Rank));
  }

  const bm25Ids = new Set(bm25Results.map((r) => r.id));
  for (const { id, vecRank } of vecResults) {
    const bm25Score = bm25Ids.has(id) ? 0 : 1 / (k + penalty);
    scores.set(id, (scores.get(id) ?? bm25Score) + 1 / (k + vecRank));
  }

  const vecIds = new Set(vecResults.map((r) => r.id));
  for (const { id } of bm25Results) {
    if (!vecIds.has(id)) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + penalty));
    }
  }

  return Array.from(scores.entries())
    .map(([id, rrfScore]) => ({ id, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);
}

export type HybridSource = "docs" | "guides" | "fastflags" | "devforum" | "all";

export interface HybridSearchResponse {
  results: readonly SearchResult[];
  searchMode: "hybrid" | "bm25";
}

function inferHitSource(
  id: string,
  rowSource: string | undefined,
  requestedSource: HybridSource,
): Exclude<HybridSource, "all"> {
  if (
    rowSource === "docs" ||
    rowSource === "guides" ||
    rowSource === "fastflags" ||
    rowSource === "devforum"
  ) {
    return rowSource;
  }
  if (requestedSource !== "all") return requestedSource;
  if (id.startsWith("devforum:")) return "devforum";
  if (id.startsWith("fastflags:")) return "fastflags";
  if (id.includes("/") || id.endsWith(".md")) return "guides";
  return "docs";
}

function apiPathPrefix(category: string | undefined): string {
  switch (category) {
    case "datatype":
      return "datatypes";
    case "enum":
      return "enums";
    case "global":
      return "globals";
    case "library":
      return "libraries";
    default:
      return "classes";
  }
}

async function hydrateVectorOnlyHit(
  store: IKeyValueStore,
  id: string,
  rowSource: string | undefined,
  requestedSource: HybridSource,
  score: number,
): Promise<SearchResult | undefined> {
  const hitSource = inferHitSource(id, rowSource, requestedSource);

  if (hitSource === "devforum") {
    const key = id.startsWith("devforum:") ? id : `devforum:${id}`;
    const record = await store.get<DevForumRecord>(key).catch(() => null);
    if (!record) return undefined;
    return {
      type: "devforum",
      name: key,
      path: record.url,
      score,
      title: record.title,
    } as unknown as SearchResult;
  }

  if (hitSource === "fastflags") {
    const key = id.startsWith("fastflags:") ? id : `fastflags:${id}`;
    const flag = await store.get<FastFlag>(key).catch(() => null);
    if (!flag) return undefined;
    return {
      type: "fastflags",
      name: key,
      path: `${flag.kind}/${flag.behavior}`,
      score,
      title: flag.name,
      ...(flag.description ? { description: flag.description } : {}),
    } as unknown as SearchResult;
  }

  if (hitSource === "guides") {
    const meta = lookupGuideMeta(id);
    const category = meta?.category ?? id.split("/")[0] ?? "unknown";
    return {
      type: "guide",
      name: id,
      path: id,
      score,
      category,
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
    };
  }

  const category = lookupApiCategory(id);
  return {
    type: "api",
    name: id,
    path: `${apiPathPrefix(category)}/${id}`,
    score,
    ...(category ? { category } : {}),
  };
}

export async function hybridSearch(
  store: IKeyValueStore,
  query: string,
  source: HybridSource,
  limit: number,
  githubToken?: string,
): Promise<HybridSearchResponse> {
  const tasks: Array<Promise<SearchResult[]>> = [];

  if (source === "docs" || source === "all") {
    tasks.push(
      searchApis(query, limit, githubToken).then(
        (r) => [...r],
        () => [],
      ),
    );
  }
  if (source === "guides" || source === "all") {
    tasks.push(
      searchGuides(query, limit, githubToken).then(
        (r) => [...r],
        () => [],
      ),
    );
  }
  if (source === "fastflags" || source === "all") {
    tasks.push(
      new FastFlagSearch(store).search({ query, limit }).then(
        (flags) =>
          flags.map(
            (flag) =>
              ({
                type: "fastflags",
                name: `fastflags:${flag.name}`,
                path: `${flag.kind}/${flag.behavior}`,
                score: 1,
                title: flag.name,
                ...(flag.description ? { description: flag.description } : {}),
              }) as unknown as SearchResult,
          ),
        () => [],
      ),
    );
  }
  if (source === "devforum" || source === "all") {
    tasks.push(
      searchDevForumStore(store, { query, limit }).then(
        (r) =>
          r.results.map(
            (hit) =>
              ({
                type: "devforum",
                name: `devforum:${hit.id}`,
                path: hit.url,
                score: hit.score,
                title: hit.title,
              }) as unknown as SearchResult,
          ),
        () => [],
      ),
    );
  }

  const perSourceResults = await Promise.all(tasks);
  const bm25Candidates = perSourceResults.flat().sort((a, b) => b.score - a.score);

  const bm25Ranked = bm25Candidates.map((r, i) => ({
    id: r.name,
    bm25Rank: i + 1,
    result: r,
  }));

  let vecRanked: Array<{ id: string; vecRank: number }> = [];
  const vecSourceById = new Map<string, string>();
  let usedHybrid = false;

  try {
    const queryVec = await embed([query], { mode: "query" });
    const qv = queryVec[0];
    if (qv && hasGetDb(store)) {
      const db = store.getDb();
      const rows = db
        .prepare<[Uint8Array, string, number], { id: string; source?: string; distance: number }>(
          `SELECT id, source, distance FROM vec_items
           WHERE embedding MATCH ? AND source LIKE ? LIMIT ?`,
        )
        .all(
          Buffer.from(qv.buffer, qv.byteOffset, qv.byteLength),
          source === "all" ? "%" : source,
          limit,
        );

      vecRanked = rows.map((row, i) => {
        if (typeof row.source === "string") {
          vecSourceById.set(row.id, row.source);
        }
        return { id: row.id, vecRank: i + 1 };
      });
      usedHybrid = true;
    }
  } catch (err) {
    logger.debug(
      `[hybridSearch] vector path failed, falling back to BM25: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!usedHybrid) {
    return { results: bm25Candidates.slice(0, limit), searchMode: "bm25" };
  }

  const fused = reciprocalRankFusion(bm25Ranked, vecRanked, 60, limit);
  const resultById = new Map(bm25Ranked.map((r) => [r.id, r.result]));

  const hydrated = await Promise.all(
    fused.map(async (entry) => {
      const existing = resultById.get(entry.id);
      if (existing !== undefined) return existing;
      return hydrateVectorOnlyHit(
        store,
        entry.id,
        vecSourceById.get(entry.id),
        source,
        entry.rrfScore,
      );
    }),
  );

  const fusedResults = hydrated.filter((r): r is SearchResult => r !== undefined);

  return { results: fusedResults, searchMode: "hybrid" };
}
