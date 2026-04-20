import { MemoryCache } from "./cache.js";
import type { RobloxDocEntry } from "./fetch.js";
import { fetchIndex, fetchTopic, findClosestMatch } from "./fetch.js";

const cache = new MemoryCache<RobloxDocEntry>();

let indexSnapshot: { classes: string[]; enums: string[] } | null = null;

async function getIndexSnapshot(): Promise<{
  classes: string[];
  enums: string[];
}> {
  if (indexSnapshot !== null) return indexSnapshot;
  indexSnapshot = await fetchIndex();
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

/** Fetches and caches full API docs for a single Roblox topic. */
export async function scrapeTopic(topic: string): Promise<ScrapeResult> {
  const cached = cache.get(topic);
  if (cached !== undefined) {
    return { ok: true, topic, entry: cached };
  }

  const entry = await fetchTopic(topic);

  cache.set(topic, entry);
  if (entry.class.name !== topic) {
    cache.set(entry.class.name, entry);
  }

  return { ok: true, topic, entry };
}

/** Fetches up to 20 topics in parallel. Never rejects — failures become ScrapeError. */
export async function scrapeMany(topics: string[]): Promise<ScrapeOutcome[]> {
  const settled = await Promise.allSettled(topics.map((t) => scrapeTopic(t)));

  return settled.map((result, i): ScrapeOutcome => {
    const topic = topics[i] ?? String(i);
    if (result.status === "fulfilled") return result.value;

    const error =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);

    return { ok: false, topic, error };
  });
}

/** Returns sorted lists of all class and enum names from the API dump. */
export async function scrapeIndex(): Promise<IndexResult> {
  const { classes, enums } = await fetchIndex();
  indexSnapshot = { classes, enums };
  return { ok: true, classes, enums };
}

/** Fuzzy-matches a query against all known API names. Returns null if nothing found. */
export async function findClosestApiName(
  query: string,
): Promise<string | null> {
  const { classes, enums } = await getIndexSnapshot();
  return findClosestMatch(query, [...classes, ...enums]);
}
