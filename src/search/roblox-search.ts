import { searchDevForumBm25 } from "../devforum/search.js";
import type { DevForumRecord } from "../devforum/types.js";
import type { FastFlag } from "../fastflags/parser.js";
import { FastFlagSearch } from "../fastflags/search.js";
import type { IKeyValueStore } from "../store/index.js";
import type { SearchResult } from "../types/index.js";
import { markDuplicates } from "./dedup.js";
import { hybridSearch } from "./hybrid.js";
import { searchApisLocal, searchGuidesLocal } from "./index.js";
import { applyRecencyBoost } from "./recency.js";

export const ROBLOX_SEARCH_SOURCES = ["all", "docs", "guides", "fastflags", "devforum"] as const;

export type RobloxSearchSource = (typeof ROBLOX_SEARCH_SOURCES)[number];

export interface RobloxSearchOptions {
  query: string;
  source?: RobloxSearchSource | undefined;
  limit?: number | undefined;
  githubToken?: string | undefined;
  /** When true, uses hybrid BM25 + vector search with RRF. Default: false. */
  hybrid?: boolean | undefined;
}

export interface FastFlagSearchResult {
  name: string;
  value: string | number | boolean | undefined;
  kind: string;
  behavior: string;
  platforms: string[];
  description?: string | undefined;
  score: number;
  title?: string | undefined;
  isDuplicate?: boolean | undefined;
}

export interface DevForumSearchResult {
  id: number;
  title: string;
  url: string;
  tags: string[];
  score: number;
  source: string;
  isDuplicate?: boolean | undefined;
  contentSnippet?: string | undefined;
  acceptedAnswerSnippet?: string | undefined;
}

export interface RobloxSearchResult {
  query: string;
  source: RobloxSearchSource;
  limit: number;
  results: {
    docs: readonly SearchResult[];
    guides: readonly SearchResult[];
    fastflags: readonly FastFlagSearchResult[];
    devforum: readonly DevForumSearchResult[];
  };
  messages?: string[] | undefined;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEVFORUM_SNIPPET_LENGTH = 360;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function shouldSearch(requested: RobloxSearchSource, source: Exclude<RobloxSearchSource, "all">) {
  return requested === "all" || requested === source;
}

function projectFastFlag(flag: FastFlag): FastFlagSearchResult {
  return {
    name: flag.name,
    title: flag.name,
    value: flag.value,
    kind: flag.kind,
    behavior: flag.behavior,
    platforms: flag.platforms,
    score: 1,
    ...(flag.description ? { description: flag.description } : {}),
  };
}

function snippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= DEVFORUM_SNIPPET_LENGTH) return normalized;
  return `${normalized.slice(0, DEVFORUM_SNIPPET_LENGTH - 3).trimEnd()}...`;
}

function projectDevForum(record: DevForumRecord): DevForumSearchResult {
  return {
    id: record.id,
    title: record.title,
    url: record.url,
    tags: record.tags,
    score: record.score,
    source: record.source,
    ...(snippet(record.content) ? { contentSnippet: snippet(record.content) } : {}),
    ...(snippet(record.acceptedAnswer)
      ? { acceptedAnswerSnippet: snippet(record.acceptedAnswer) }
      : {}),
  };
}

function ageDays(record: DevForumRecord): number {
  return Math.max(0, (Date.now() - record.lastSyncAt) / 86_400_000);
}

async function searchDevForum(
  store: IKeyValueStore,
  query: string,
  limit: number,
): Promise<readonly DevForumSearchResult[]> {
  const hits = await searchDevForumBm25(store, query, limit);
  if (hits.length === 0) return [];

  return hits
    .map(({ record, score }) => ({
      record,
      boostedScore: applyRecencyBoost(score, ageDays(record), {
        halfLifeDays: 365,
        minMultiplier: 0.5,
      }),
    }))
    .sort((a, b) => b.boostedScore - a.boostedScore)
    .map((entry) => projectDevForum(entry.record));
}

async function groupHybridResults(
  store: IKeyValueStore,
  items: readonly SearchResult[],
): Promise<RobloxSearchResult["results"]> {
  const docs: SearchResult[] = [];
  const guides: SearchResult[] = [];
  const fastflags: FastFlagSearchResult[] = [];
  const devforum: DevForumSearchResult[] = [];

  for (const item of items) {
    const itemType = item.type as string;
    if (itemType === "guide") {
      guides.push(item);
    } else if (itemType === "fastflags") {
      const key = item.name.startsWith("fastflags:") ? item.name : `fastflags:${item.name}`;
      const record = await store.get<FastFlag>(key).catch(() => null);
      if (record) {
        fastflags.push(projectFastFlag(record));
      } else {
        fastflags.push({
          name: item.title ?? item.name.replace(/^fastflags:/, ""),
          title: item.title ?? item.name.replace(/^fastflags:/, ""),
          value: undefined,
          kind: "Unknown",
          behavior: "Unknown",
          platforms: [],
          score: item.score,
          ...(item.description ? { description: item.description } : {}),
        });
      }
    } else if (itemType === "devforum") {
      const key = item.name.startsWith("devforum:") ? item.name : `devforum:${item.name}`;
      const record = await store.get<DevForumRecord>(key).catch(() => null);
      if (record) {
        devforum.push(projectDevForum(record));
      } else {
        const numericId = Number(key.replace(/^devforum:/, ""));
        devforum.push({
          id: Number.isFinite(numericId) ? numericId : 0,
          title: item.title ?? item.name,
          url: item.path ?? "",
          tags: [],
          score: item.score,
          source: "devforum",
        });
      }
    } else {
      docs.push(item);
    }
  }

  return { docs, guides, fastflags, devforum };
}

export async function robloxSearch(
  store: IKeyValueStore,
  options: RobloxSearchOptions,
): Promise<RobloxSearchResult> {
  const source = options.source ?? "all";
  const limit = normalizeLimit(options.limit);

  if (options.hybrid === true) {
    const hybridResult = await hybridSearch(
      store,
      options.query,
      source,
      limit,
      options.githubToken,
    );
    const grouped = await groupHybridResults(store, hybridResult.results);
    const deduped = markDuplicates(grouped);
    return {
      query: options.query,
      source,
      limit,
      results: {
        docs: deduped.docs ?? [],
        guides: deduped.guides ?? [],
        fastflags: deduped.fastflags ?? [],
        devforum: deduped.devforum ?? [],
      },
      searchMode: hybridResult.searchMode,
    } as RobloxSearchResult & { searchMode: string };
  }

  const messages: string[] = [];

  const [docs, guides, rawFastflags, devforum] = await Promise.all([
    shouldSearch(source, "docs") ? searchApisLocal(options.query, limit) : Promise.resolve([]),
    shouldSearch(source, "guides") ? searchGuidesLocal(options.query, limit) : Promise.resolve([]),
    shouldSearch(source, "fastflags")
      ? new FastFlagSearch(store).search({ query: options.query, limit })
      : Promise.resolve([]),
    shouldSearch(source, "devforum")
      ? searchDevForum(store, options.query, limit)
      : Promise.resolve([]),
  ]);

  const fastflags = rawFastflags.map(projectFastFlag);
  if (shouldSearch(source, "fastflags") && fastflags.length === 0) {
    messages.push("No local FastFlags found. Seed FastFlags before searching this source.");
  }
  if (shouldSearch(source, "devforum") && devforum.length === 0) {
    messages.push("No local DevForum records found. Seed DevForum before searching this source.");
  }

  const results: RobloxSearchResult["results"] = {
    docs,
    guides,
    fastflags,
    devforum,
  };

  const deduped = markDuplicates(results);

  return {
    query: options.query,
    source,
    limit,
    results: {
      docs: deduped.docs ?? [],
      guides: deduped.guides ?? [],
      fastflags: deduped.fastflags ?? [],
      devforum: deduped.devforum ?? [],
    },
    ...(messages.length > 0 ? { messages } : {}),
  };
}
