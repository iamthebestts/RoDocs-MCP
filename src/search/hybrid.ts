import { searchDevForumStore } from "../devforum/search.js";
import { embed } from "../embedding/embedder.js";
import { SqliteStore } from "../store/sqlite-store.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SearchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { searchApis, searchGuides } from "./index.js";

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

export type HybridSource = "docs" | "guides" | "devforum" | "all";

export interface HybridSearchResponse {
  results: readonly SearchResult[];
  searchMode: "hybrid" | "bm25";
}

export async function hybridSearch(
  store: IKeyValueStore,
  query: string,
  source: HybridSource,
  limit: number,
  githubToken?: string,
): Promise<HybridSearchResponse> {
  const bm25Candidates: SearchResult[] = [];

  if (source === "docs" || source === "all") {
    const r = await searchApis(query, limit, githubToken).catch(() => []);
    bm25Candidates.push(...r);
  }
  if (source === "guides" || source === "all") {
    const r = await searchGuides(query, limit, githubToken).catch(() => []);
    bm25Candidates.push(...r);
  }
  if (source === "devforum" || source === "all") {
    const r = await searchDevForumStore(store, { query, limit }).catch(() => ({ results: [] }));
    for (const hit of r.results) {
      bm25Candidates.push({
        type: "devforum",
        name: hit.title,
        path: hit.url,
        score: hit.score,
      } as unknown as SearchResult);
    }
  }

  const bm25Ranked = bm25Candidates.slice(0, limit).map((r, i) => ({
    id: r.name,
    bm25Rank: i + 1,
    result: r,
  }));

  let vecRanked: Array<{ id: string; vecRank: number }> = [];
  let usedHybrid = false;

  try {
    const queryVec = await embed([query]);
    const qv = queryVec[0];
    if (qv && store instanceof SqliteStore) {
      const db = store.getDb();
      const rows = db
        .prepare<[Uint8Array, string, number], { id: string; distance: number }>(
          `SELECT id, distance FROM vec_items
           WHERE embedding MATCH ? AND source LIKE ? LIMIT ?`,
        )
        .all(Buffer.from(qv.buffer), source === "all" ? "%" : source, limit);

      vecRanked = rows.map((row, i) => ({ id: row.id, vecRank: i + 1 }));
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

  const fusedResults = fused
    .map((entry) => resultById.get(entry.id))
    .filter((r): r is SearchResult => r !== undefined);

  return { results: fusedResults, searchMode: "hybrid" };
}
