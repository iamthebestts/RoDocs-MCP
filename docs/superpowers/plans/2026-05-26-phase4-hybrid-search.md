# Phase 4: Hybrid Search with RRF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hybrid BM25 + vector search fused via Reciprocal Rank Fusion (RRF, k=60), surfaced through the existing `robloxSearch()` function behind a `hybrid?: boolean` feature flag. Transparent to all MCP clients.

**Architecture:** New `src/search/hybrid.ts` with a pure `reciprocalRankFusion()` function and an async `hybridSearch()` orchestrator. `robloxSearch()` gains an optional `hybrid` parameter that delegates to `hybridSearch` when `true`. Any failure in the vector path (model cold, `sqlite-vec` unavailable, query embedding error) falls back silently to BM25 with `searchMode: "bm25"` in the response. **Requires Phase 3 to be complete.**

**Tech Stack:** `sqlite-vec` (via `SqliteStore`), `@xenova/transformers`, existing `BM25` class and searchers.

---

## Prerequisites

- Phase 3 must be merged (`EmbeddingIndexer`, `SqliteStore` with `vec_items`, `embed()` all live).
- Confirm with team whether `hybrid` should default to `true` when Phase 4 lands, or remain `false` (feature flag). This plan uses `false` (opt-in).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/search/hybrid.ts` | `reciprocalRankFusion()` pure function + `hybridSearch()` orchestrator |
| **Create** | `src/search/__tests__/hybrid.test.ts` | Unit tests for both functions |
| **Modify** | `src/search/roblox-search.ts` | Add `hybrid?: boolean` param; delegate to `hybridSearch` |
| **Modify** | `src/search/__tests__/roblox-search.test.ts` | Test fallback to BM25 when hybrid=true but model cold |

---

## Task 1: Implement `reciprocalRankFusion()` with tests (TDD)

**Files:**
- Create: `src/search/__tests__/hybrid.test.ts`
- Create: `src/search/hybrid.ts` (partial — pure function only)

- [ ] **Step 1: Write the failing tests for `reciprocalRankFusion()`**

```typescript
// src/search/__tests__/hybrid.test.ts
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../hybrid.js";

describe("reciprocalRankFusion()", () => {
  it("combines ranks from both lists", () => {
    const bm25 = [
      { id: "a", bm25Rank: 1 },
      { id: "b", bm25Rank: 2 },
    ];
    const vec = [
      { id: "b", vecRank: 1 },
      { id: "a", vecRank: 2 },
    ];
    const result = reciprocalRankFusion(bm25, vec, 60, 10);
    // "a": 1/(60+1) + 1/(60+2) = 0.01639 + 0.01613 = 0.03252
    // "b": 1/(60+2) + 1/(60+1) = 0.01613 + 0.01639 = 0.03252
    // Both scores are equal here — both should appear
    expect(result.map((r) => r.id)).toContain("a");
    expect(result.map((r) => r.id)).toContain("b");
  });

  it("applies soft penalty for docs absent from one list", () => {
    const limit = 5;
    const bm25 = [{ id: "only-bm25", bm25Rank: 1 }];
    const vec = [{ id: "only-vec", vecRank: 1 }];
    const result = reciprocalRankFusion(bm25, vec, 60, limit);
    // "only-bm25": 1/(60+1) + 1/(60+limit+1) = 0.01639 + 0.01515 = 0.03154
    // "only-vec":  1/(60+limit+1) + 1/(60+1) = same
    expect(result).toHaveLength(2);
    const scores = result.map((r) => r.rrfScore);
    expect(scores[0]).toBeCloseTo(scores[1]!, 6); // symmetric penalty
  });

  it("returns results sorted by rrfScore descending", () => {
    // "best" appears #1 in both lists — highest score
    const bm25 = [
      { id: "best", bm25Rank: 1 },
      { id: "mid", bm25Rank: 2 },
      { id: "worst", bm25Rank: 3 },
    ];
    const vec = [
      { id: "best", vecRank: 1 },
      { id: "mid", vecRank: 2 },
      { id: "worst", vecRank: 3 },
    ];
    const result = reciprocalRankFusion(bm25, vec, 60, 10);
    expect(result[0]?.id).toBe("best");
    expect(result[1]?.id).toBe("mid");
    expect(result[2]?.id).toBe("worst");
  });

  it("respects limit", () => {
    const bm25 = Array.from({ length: 20 }, (_, i) => ({ id: `doc${i}`, bm25Rank: i + 1 }));
    const result = reciprocalRankFusion(bm25, [], 60, 5);
    expect(result).toHaveLength(5);
  });

  it("handles empty bm25 list", () => {
    const vec = [{ id: "x", vecRank: 1 }];
    const result = reciprocalRankFusion([], vec, 60, 10);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("x");
  });

  it("handles both lists empty", () => {
    const result = reciprocalRankFusion([], [], 60, 10);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/search/__tests__/hybrid.test.ts
```
Expected: FAIL — `Cannot find module '../hybrid.js'`

- [ ] **Step 3: Implement `reciprocalRankFusion()` in `src/search/hybrid.ts`**

```typescript
// src/search/hybrid.ts
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SearchResult } from "../types/index.js";

export interface RRFEntry {
  id: string;
  rrfScore: number;
}

/**
 * Fuses two ranked lists using Reciprocal Rank Fusion.
 *
 * @param bm25Results - BM25 ranked results (1-based bm25Rank)
 * @param vecResults  - Vector ranked results (1-based vecRank, sorted by distance asc)
 * @param k           - RRF constant (default 60, empirically proven)
 * @param limit       - Number of results to return
 */
export function reciprocalRankFusion(
  bm25Results: ReadonlyArray<{ id: string; bm25Rank: number }>,
  vecResults: ReadonlyArray<{ id: string; vecRank: number }>,
  k = 60,
  limit: number,
): readonly RRFEntry[] {
  const penalty = limit + 1; // soft penalty rank for docs absent from a list
  const scores = new Map<string, number>();

  for (const { id, bm25Rank } of bm25Results) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + bm25Rank));
  }

  // Docs only in vec list get BM25 penalty
  const bm25Ids = new Set(bm25Results.map((r) => r.id));
  for (const { id, vecRank } of vecResults) {
    const bm25Score = bm25Ids.has(id) ? 0 : 1 / (k + penalty);
    scores.set(id, (scores.get(id) ?? bm25Score) + 1 / (k + vecRank));
  }

  // Docs only in BM25 list get vec penalty
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
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/search/__tests__/hybrid.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search/hybrid.ts src/search/__tests__/hybrid.test.ts
git commit -m "feat(search): implement reciprocalRankFusion() pure function"
```

---

## Task 2: Implement `hybridSearch()` with tests

**Files:**
- Modify: `src/search/hybrid.ts` (add `hybridSearch`)
- Modify: `src/search/__tests__/hybrid.test.ts` (add hybridSearch tests)

- [ ] **Step 1: Write failing tests for `hybridSearch()`**

Append to `src/search/__tests__/hybrid.test.ts`:

```typescript
import { vi } from "vitest";

// Mock embed so hybridSearch tests don't touch the real model
vi.mock("../../embedding/embedder.js", () => ({
  embed: vi.fn(),
}));

import { embed } from "../../embedding/embedder.js";
import { hybridSearch } from "../hybrid.js";
import type { IKeyValueStore } from "../../store/store-interface.js";
import type { SearchResult } from "../../types/index.js";

const mockEmbed = vi.mocked(embed);

function makeStoreMock(rows: Array<{ id: string; distance: number }> = []) {
  // Minimal mock — hybridSearch calls store only to get the db (if SqliteStore)
  // For these unit tests, we inject a mock db directly
  return {
    getPath: () => "/tmp/store.db",
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    clear: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    isOpen: () => true,
  } as unknown as IKeyValueStore;
}

describe("hybridSearch()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns searchMode: bm25 when embed throws (fallback)", async () => {
    mockEmbed.mockRejectedValue(new Error("model not loaded"));

    // Provide a minimal BM25 result set by mocking the searcher
    // (hybridSearch is tested via its public interface; BM25 searchers are called internally)
    const store = makeStoreMock();
    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("bm25");
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("returns searchMode: hybrid when embed succeeds", async () => {
    mockEmbed.mockResolvedValue([new Float32Array(384).fill(0.1)]);

    const store = makeStoreMock();
    // With no real vec_items, vec candidates will be empty — RRF still runs
    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("hybrid");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/search/__tests__/hybrid.test.ts
```
Expected: FAIL — `hybridSearch` is not exported yet.

- [ ] **Step 3: Implement `hybridSearch()` in `src/search/hybrid.ts`**

Append to `src/search/hybrid.ts`:

```typescript
import { embed } from "../embedding/embedder.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { searchApis, searchGuides } from "./index.js";
import { searchDevForumStore } from "../devforum/search.js";
import { logger } from "../utils/logger.js";
import { reciprocalRankFusion } from "./hybrid.js";

export type HybridSource = "docs" | "guides" | "devforum" | "all";

export interface HybridSearchResponse {
  results: readonly SearchResult[];
  searchMode: "hybrid" | "bm25";
}

/**
 * Hybrid BM25 + vector search fused with RRF.
 * Falls back to BM25 silently on any vector-path failure.
 */
export async function hybridSearch(
  store: IKeyValueStore,
  query: string,
  source: HybridSource,
  limit: number,
  githubToken?: string,
): Promise<HybridSearchResponse> {
  // --- BM25 candidates ---
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
    // Map DevForumSearchResult to SearchResult shape
    for (const hit of r.results) {
      bm25Candidates.push({
        type: "devforum" as const,
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

  // --- Vector candidates (may fail silently) ---
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

  // --- RRF fusion ---
  const fused = reciprocalRankFusion(bm25Ranked, vecRanked, 60, limit);
  const resultById = new Map(bm25Ranked.map((r) => [r.id, r.result]));

  const fusedResults = fused
    .map((entry) => resultById.get(entry.id))
    .filter((r): r is SearchResult => r !== undefined);

  return { results: fusedResults, searchMode: "hybrid" };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/search/__tests__/hybrid.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/search/hybrid.ts src/search/__tests__/hybrid.test.ts
git commit -m "feat(search): implement hybridSearch() with RRF and BM25 fallback"
```

---

## Task 3: Wire `hybridSearch` into `robloxSearch`

**Files:**
- Modify: `src/search/roblox-search.ts`
- Modify: `src/search/__tests__/roblox-search.test.ts`

- [ ] **Step 1: Write the failing test for the `hybrid` parameter**

Open `src/search/__tests__/roblox-search.test.ts` and add:

```typescript
it("uses BM25 when hybrid is not set (default behavior unchanged)", async () => {
  // This is the regression test — existing behavior must be preserved
  const result = await robloxSearch(store, { query: "TweenService", source: "docs", limit: 5 });
  // No searchMode in non-hybrid response
  expect((result as { searchMode?: unknown }).searchMode).toBeUndefined();
});
```

- [ ] **Step 2: Run to confirm the existing test passes before modification**

```bash
pnpm test src/search/__tests__/roblox-search.test.ts
```
Expected: PASS (baseline).

- [ ] **Step 3: Update `robloxSearch()` to accept and forward `hybrid`**

In `src/search/roblox-search.ts`, find the options interface and the function body:

```typescript
import { hybridSearch } from "./hybrid.js";

export interface RobloxSearchOptions {
  query: string;
  source?: (typeof ROBLOX_SEARCH_SOURCES)[number];
  limit?: number;
  githubToken?: string;
  /** When true, uses hybrid BM25 + vector search with RRF. Default: false. */
  hybrid?: boolean;
}

export async function robloxSearch(
  store: IKeyValueStore,
  options: RobloxSearchOptions,
): Promise<RobloxSearchResult> {
  const { query, source = "all", limit = 10, githubToken, hybrid = false } = options;

  if (hybrid) {
    const hybridResult = await hybridSearch(store, query, source as HybridSource, limit, githubToken);
    return {
      query,
      results: buildResultsMap(hybridResult.results, source),
      searchMode: hybridResult.searchMode,
    } as RobloxSearchResult & { searchMode: string };
  }

  // existing BM25-only path — unchanged
  // ...
```

Preserve the entire existing BM25 path unchanged. Only prepend the `if (hybrid)` branch.

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```
Expected: all tests pass — the `hybrid` parameter defaults to `false`, so existing tests are unaffected.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/search/roblox-search.ts src/search/__tests__/roblox-search.test.ts
git commit -m "feat(search): add hybrid flag to robloxSearch(); delegates to hybridSearch when true"
```

---

## Task 4: Final validation

- [ ] **Step 1: Run the full CI gate**

```bash
pnpm ci
```
Expected: biome clean + all tests pass + tsc clean.

- [ ] **Step 2: Run coverage and confirm `src/search/hybrid.ts` is ≥70% lines**

```bash
pnpm test:coverage
```
Expected: `src/search/hybrid.ts` ≥70% lines covered. The `reciprocalRankFusion` function is pure and fully tested. The `hybridSearch` fallback path is covered by the mock-embed test.

- [ ] **Step 3: Verify `searchMode` is not exposed in MCP tool output when hybrid is off**

Search `src/server/index.ts` for every `robloxSearch` call — confirm none pass `hybrid: true`. The flag is off by default and should not be enabled in the server until confirmed.

```bash
grep -n "hybrid:" src/server/index.ts
```
Expected: zero hits (or only `hybrid: false` explicitly, which is fine).

- [ ] **Step 4: Final commit**

```bash
git add -p
git commit -m "chore(search): final cleanup for hybrid search phase"
```
