import { getCachedDevForumRecords } from "../devforum/search.js";
import type { DevForumRecord } from "../devforum/types.js";
import type { FastFlag } from "../fastflags/parser.js";
import { FastFlagSearch } from "../fastflags/search.js";
import type { LmdbStore } from "../store/index.js";
import type { BM25Doc, SearchResult } from "../types/index.js";
import { BM25 } from "./bm25.js";
import { markDuplicates } from "./dedup.js";
import { searchApisLocal, searchGuidesLocal } from "./index.js";
import { applyRecencyBoost } from "./recency.js";

export const ROBLOX_SEARCH_SOURCES = ["all", "docs", "guides", "fastflags", "devforum"] as const;

export type RobloxSearchSource = (typeof ROBLOX_SEARCH_SOURCES)[number];

export interface RobloxSearchOptions {
  query: string;
  source?: RobloxSearchSource | undefined;
  limit?: number | undefined;
  githubToken?: string | undefined;
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

async function fetchDevForumRecords(store: LmdbStore): Promise<readonly DevForumRecord[]> {
  // Use the singleton cache when the DevForum index has been pre-warmed,
  // avoiding a full LMDB key-scan + record fetch on every search call.
  const cached = getCachedDevForumRecords();
  if (cached.length > 0) return cached;

  const keys = (await store.keys()).filter((key) => key.startsWith("devforum:"));
  const records = (await Promise.all(keys.map((key) => store.get<DevForumRecord>(key)))).filter(
    (record): record is DevForumRecord => record !== null,
  );
  return records;
}

async function searchDevForum(
  store: LmdbStore,
  query: string,
  limit: number,
): Promise<readonly DevForumSearchResult[]> {
  const records = await fetchDevForumRecords(store);
  if (records.length === 0) return [];

  const docs: BM25Doc[] = records.map((record) => ({
    id: String(record.id),
    fields: {
      title: record.title,
      path: record.url,
      description: record.tags.join(" "),
      content: [
        record.content,
        record.acceptedAnswer ?? "",
        record.staffReplies.join(" "),
        record.codeSnippets.join(" "),
      ].join(" "),
    },
  }));

  const bm25 = new BM25();
  bm25.index(docs);
  const byId = new Map(records.map((record) => [String(record.id), record]));

  return bm25
    .search(query, limit)
    .map((result) => {
      const record = byId.get(result.id);
      return record === undefined
        ? undefined
        : {
            record,
            boostedScore: applyRecencyBoost(result.score, ageDays(record), {
              halfLifeDays: 365,
              minMultiplier: 0.5,
            }),
          };
    })
    .filter(
      (entry): entry is { record: DevForumRecord; boostedScore: number } => entry !== undefined,
    )
    .sort((a, b) => b.boostedScore - a.boostedScore)
    .map((entry) => projectDevForum(entry.record));
}

export async function robloxSearch(
  store: LmdbStore,
  options: RobloxSearchOptions,
): Promise<RobloxSearchResult> {
  const source = options.source ?? "all";
  const limit = normalizeLimit(options.limit);
  const messages: string[] = [];

  const results: RobloxSearchResult["results"] = {
    docs: [],
    guides: [],
    fastflags: [],
    devforum: [],
  };

  if (shouldSearch(source, "docs")) {
    results.docs = await searchApisLocal(options.query, limit);
  }

  if (shouldSearch(source, "guides")) {
    results.guides = await searchGuidesLocal(options.query, limit);
  }

  if (shouldSearch(source, "fastflags")) {
    const fastflags = await new FastFlagSearch(store).search({
      query: options.query,
      limit,
    });
    results.fastflags = fastflags.map(projectFastFlag);
    if (results.fastflags.length === 0) {
      messages.push("No local FastFlags found. Seed FastFlags before searching this source.");
    }
  }

  if (shouldSearch(source, "devforum")) {
    results.devforum = await searchDevForum(store, options.query, limit);
    if (results.devforum.length === 0) {
      messages.push("No local DevForum records found. Seed DevForum before searching this source.");
    }
  }

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
