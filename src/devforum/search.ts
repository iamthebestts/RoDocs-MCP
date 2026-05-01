import type { LmdbStore } from "../store/index.js";
import type { DevForumRecord } from "./types.js";

export interface DevForumSearchOptions {
  query: string;
  tags?: string[] | undefined;
  requireAcceptedAnswer?: boolean | undefined;
  requireStaffReply?: boolean | undefined;
  minScore?: number | undefined;
  limit?: number | undefined;
}

export interface DevForumSearchResult {
  title: string;
  url: string;
  tags: string[];
  score: number;
  acceptedAnswer?: string | undefined;
  staffReply?: string | undefined;
  codeSnippets: string[];
  updatedAt: string;
  lastSeenAt: string;
}

export interface DevForumSearchResponse {
  query: string;
  results: DevForumSearchResult[];
  message?: string | undefined;
}

const DEFAULT_MIN_SCORE = 60;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const EXCERPT_LENGTH = 420;
const CODE_SNIPPET_LENGTH = 360;
const MAX_CODE_SNIPPETS = 3;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const clean = stripHtml(value);
  if (clean.length === 0) return undefined;
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length > 1);
}

function relevance(record: DevForumRecord, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = [
    record.title,
    record.content,
    record.acceptedAnswer ?? "",
    record.staffReplies.join(" "),
    record.codeSnippets.join(" "),
    record.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    const matches = haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    return score + (matches?.length ?? 0);
  }, 0);
}

function hasAllTags(record: DevForumRecord, tags: string[] | undefined): boolean {
  if (tags === undefined || tags.length === 0) return true;
  const recordTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return tags.every((tag) => recordTags.has(tag.toLowerCase()));
}

function project(record: DevForumRecord): DevForumSearchResult {
  const acceptedAnswer = excerpt(record.acceptedAnswer, EXCERPT_LENGTH);
  const staffReply = excerpt(record.staffReplies[0], EXCERPT_LENGTH);
  const timestamp = new Date(record.lastSyncAt).toISOString();

  return {
    title: record.title,
    url: record.url,
    tags: record.tags,
    score: record.score,
    ...(acceptedAnswer ? { acceptedAnswer } : {}),
    ...(staffReply ? { staffReply } : {}),
    codeSnippets: record.codeSnippets
      .map((snippet) => excerpt(snippet, CODE_SNIPPET_LENGTH))
      .filter((snippet): snippet is string => snippet !== undefined)
      .slice(0, MAX_CODE_SNIPPETS),
    updatedAt: timestamp,
    lastSeenAt: timestamp,
  };
}

export async function searchDevForumStore(
  store: LmdbStore,
  options: DevForumSearchOptions,
): Promise<DevForumSearchResponse> {
  const keys = (await store.keys()).filter((key) => key.startsWith("devforum:"));
  if (keys.length === 0) {
    return {
      query: options.query,
      results: [],
      message:
        "No local DevForum records found. Run `npx rodocsmcp --seed-devforum` to seed curated DevForum content.",
    };
  }

  const records = (await Promise.all(keys.map((key) => store.get<DevForumRecord>(key)))).filter(
    (record): record is DevForumRecord => record !== null,
  );

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const limit = clampLimit(options.limit);
  const terms = queryTerms(options.query);

  const results = records
    .filter((record) => record.score >= minScore)
    .filter((record) => hasAllTags(record, options.tags))
    .filter((record) => !options.requireAcceptedAnswer || record.acceptedAnswer !== undefined)
    .filter((record) => !options.requireStaffReply || record.staffReplies.length > 0)
    .map((record) => ({ record, relevance: relevance(record, terms) }))
    .filter((entry) => entry.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.record.score - a.record.score)
    .slice(0, limit)
    .map((entry) => project(entry.record));

  return {
    query: options.query,
    results,
  };
}
