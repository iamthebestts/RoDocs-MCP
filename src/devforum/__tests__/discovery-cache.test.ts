import { describe, expect, it } from "vitest";
import {
  type DiscoveryCachePayload,
  isDiscoveryCacheFresh,
  readDiscoveryCache,
} from "../discovery-cache.js";

const sampleCache = (ageMs: number): DiscoveryCachePayload => ({
  cachedAt: Date.now() - ageMs,
  candidates: [
    {
      topic: {
        id: 1,
        title: "T",
        slug: "t",
        posts_count: 1,
        reply_count: 0,
        views: 100,
        like_count: 1,
        has_accepted_answer: false,
        created_at: new Date().toISOString(),
        closed: false,
        category_id: 54,
        tags: [],
      },
      source: "top-monthly",
      tier: "top",
      weight: 4,
    },
  ],
});

describe("discovery cache", () => {
  it("isDiscoveryCacheFresh returns true within TTL", () => {
    expect(isDiscoveryCacheFresh(sampleCache(60_000), 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("isDiscoveryCacheFresh returns false when expired", () => {
    expect(isDiscoveryCacheFresh(sampleCache(25 * 60 * 60 * 1000), 24 * 60 * 60 * 1000)).toBe(
      false,
    );
  });

  it("readDiscoveryCache parses metadata payload", () => {
    const cache = sampleCache(0);
    const parsed = readDiscoveryCache({ metadata: { discoveryCache: cache } });
    expect(parsed?.candidates).toHaveLength(1);
    expect(parsed?.candidates[0]?.topic.id).toBe(1);
  });
});
