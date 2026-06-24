import type { SyncState, SyncStateManager } from "../store/sync-state.js";
import type { DevForumTopic } from "./types.js";

const SYNC_SOURCE = "devforum";
const METADATA_KEY = "discoveryCache";

export type CachedDiscoveryTier = "top" | "category" | "search";
export type CachedCategoryWeight = "gold" | "high" | "medium";
export type CachedSourceWeight = 0 | 1 | 2 | 3 | 4;

export type SerializedDiscoveryCandidate = {
  topic: DevForumTopic;
  source: string;
  tier: CachedDiscoveryTier;
  categoryWeight?: CachedCategoryWeight;
  weight: CachedSourceWeight;
};

export type DiscoveryCachePayload = {
  cachedAt: number;
  candidates: SerializedDiscoveryCandidate[];
};

export function isDiscoveryCacheFresh(
  cache: DiscoveryCachePayload | null | undefined,
  ttlMs: number,
  now = Date.now(),
): boolean {
  if (!cache || cache.candidates.length === 0) return false;
  return now - cache.cachedAt < ttlMs;
}

export function readDiscoveryCache(state: SyncState | null): DiscoveryCachePayload | null {
  const raw = state?.metadata?.[METADATA_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<DiscoveryCachePayload>;
  if (typeof candidate.cachedAt !== "number" || !Array.isArray(candidate.candidates)) {
    return null;
  }
  return { cachedAt: candidate.cachedAt, candidates: candidate.candidates };
}

export async function loadDiscoveryCache(
  syncManager: SyncStateManager,
  ttlMs: number,
): Promise<DiscoveryCachePayload | null> {
  const state = await syncManager.getSourceState(SYNC_SOURCE);
  const cache = readDiscoveryCache(state);
  return isDiscoveryCacheFresh(cache, ttlMs) ? cache : null;
}

export async function saveDiscoveryCache(
  syncManager: SyncStateManager,
  candidates: SerializedDiscoveryCandidate[],
): Promise<void> {
  const state = await syncManager.getSourceState(SYNC_SOURCE);
  const metadata = {
    ...(state?.metadata ?? {}),
    [METADATA_KEY]: {
      cachedAt: Date.now(),
      candidates,
    } satisfies DiscoveryCachePayload,
  };
  await syncManager.updateSourceState(SYNC_SOURCE, { metadata });
}

export function candidatesToMap(
  candidates: SerializedDiscoveryCandidate[],
): Map<number, SerializedDiscoveryCandidate> {
  const map = new Map<number, SerializedDiscoveryCandidate>();
  for (const cand of candidates) {
    if (typeof cand.topic.id !== "number" || Number.isNaN(cand.topic.id)) continue;
    map.set(cand.topic.id, cand);
  }
  return map;
}

export function mapToSerialized(
  map: Map<
    number,
    {
      topic: DevForumTopic;
      source: string;
      tier: CachedDiscoveryTier;
      categoryWeight?: CachedCategoryWeight;
      weight: CachedSourceWeight;
    }
  >,
): SerializedDiscoveryCandidate[] {
  return Array.from(map.values()).map((cand) => ({
    topic: cand.topic,
    source: cand.source,
    tier: cand.tier,
    ...(cand.categoryWeight ? { categoryWeight: cand.categoryWeight } : {}),
    weight: cand.weight,
  }));
}
