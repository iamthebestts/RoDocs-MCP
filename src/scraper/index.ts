import { resolveGithubToken } from "../utils/github-token.js";
import { MemoryCache } from "./cache.js";
import { DiskCache } from "./disk-cache.js";
import type { RobloxDocEntry } from "./fetch.js";
import { fetchIndex, fetchTopic, findClosestMatch } from "./fetch.js";

const memCache = new MemoryCache<RobloxDocEntry>();
const diskCache = new DiskCache<RobloxDocEntry>();

let indexSnapshot: { classes: string[]; enums: string[] } | null = null;

async function getIndexSnapshot(githubToken?: string): Promise<{
  classes: string[];
  enums: string[];
}> {
  if (indexSnapshot !== null) return indexSnapshot;
  indexSnapshot = await fetchIndex(resolveGithubToken(githubToken));
  return indexSnapshot;
}

// ! Result types

export interface ScrapeResult {
  ok: true;
  topic: string;
  entry: RobloxDocEntry;
}

export interface ScrapeError {
  ok: false;
  topic: string;
  error: string;
}

export type ScrapeOutcome = ScrapeResult | ScrapeError;

export interface IndexResult {
  ok: true;
  classes: string[];
  enums: string[];
}

// ! Public API

/** Fetches and caches full API docs for a single Roblox topic. L1 = memory (10 min), L2 = disk (24 h). */
export async function scrapeTopic(topic: string, githubToken?: string): Promise<ScrapeResult> {
  // L1: memory cache
  const memHit = memCache.get(topic);
  if (memHit !== undefined) return { ok: true, topic, entry: memHit };

  // Ensure engineVersionHash is populated before computing disk cache key
  await getIndexSnapshot(githubToken);

  // L2: disk cache
  const diskHit = await diskCache.get(topic);
  if (diskHit !== undefined) {
    memCache.set(topic, diskHit);
    return { ok: true, topic, entry: diskHit };
  }

  // Fetch from network
  const entry = await fetchTopic(topic);

  memCache.set(topic, entry);
  if (entry.class.name !== topic) {
    memCache.set(entry.class.name, entry);
  }

  await diskCache.set(topic, entry);
  if (entry.class.name !== topic) {
    await diskCache.set(entry.class.name, entry);
  }

  return { ok: true, topic, entry };
}

/** Fetches up to 20 topics in parallel. Never rejects — failures become ScrapeError. */
export async function scrapeMany(topics: string[], githubToken?: string): Promise<ScrapeOutcome[]> {
  const settled = await Promise.allSettled(topics.map((t) => scrapeTopic(t, githubToken)));

  return settled.map((result, i): ScrapeOutcome => {
    const topic = topics[i] ?? String(i);
    if (result.status === "fulfilled") return result.value;

    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);

    return { ok: false, topic, error };
  });
}

/** Returns sorted lists of all class and enum names from the API dump. */
export async function scrapeIndex(githubToken?: string): Promise<IndexResult> {
  const { classes, enums } = await fetchIndex(resolveGithubToken(githubToken));
  indexSnapshot = { classes, enums };
  return { ok: true, classes, enums };
}

/** Fuzzy-matches a query against all known API names. Returns null if nothing found. */
export async function findClosestApiName(
  query: string,
  githubToken?: string,
): Promise<string | null> {
  const { classes, enums } = await getIndexSnapshot(githubToken);
  return findClosestMatch(query, [...classes, ...enums]);
}
