import type { DevForumRecord } from "../devforum/types.js";
import type { FastFlag } from "../fastflags/parser.js";
import { FastFlagSearch } from "../fastflags/search.js";
import type { LmdbStore } from "../store/index.js";
import type { BM25Doc, SearchResult } from "../types/index.js";
import { BM25 } from "./bm25.js";
import { searchApisLocal, searchGuidesLocal } from "./index.js";

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
}

export interface DevForumSearchResult {
  id: number;
  title: string;
  url: string;
  tags: string[];
  score: number;
  source: string;
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
    value: flag.value,
    kind: flag.kind,
    behavior: flag.behavior,
    platforms: flag.platforms,
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

async function searchDevForum(
  store: LmdbStore,
  query: string,
  limit: number,
): Promise<readonly DevForumSearchResult[]> {
  const keys = (await store.keys()).filter((key) => key.startsWith("devforum:"));
  if (keys.length === 0) return [];

  const records = (await Promise.all(keys.map((key) => store.get<DevForumRecord>(key)))).filter(
    (record): record is DevForumRecord => record !== null,
  );

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
    .map((result) => byId.get(result.id))
    .filter((record): record is DevForumRecord => record !== undefined)
    .map(projectDevForum);
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

  return {
    query: options.query,
    source,
    limit,
    results,
    ...(messages.length > 0 ? { messages } : {}),
  };
}
