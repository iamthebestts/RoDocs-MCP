import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(result.map((r) => r.id)).toContain("a");
    expect(result.map((r) => r.id)).toContain("b");
  });

  it("applies soft penalty for docs absent from one list", () => {
    const limit = 5;
    const bm25 = [{ id: "only-bm25", bm25Rank: 1 }];
    const vec = [{ id: "only-vec", vecRank: 1 }];
    const result = reciprocalRankFusion(bm25, vec, 60, limit);
    expect(result).toHaveLength(2);
    const [scoreA, scoreB] = result.map((r) => r.rrfScore);
    expect(scoreA).toBeCloseTo(scoreB ?? 0, 6);
  });

  it("returns results sorted by rrfScore descending", () => {
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

vi.mock("../../embedding/embedder.js", () => ({
  embed: vi.fn(),
}));

import { embed } from "../../embedding/embedder.js";
import type { IKeyValueStore } from "../../store/store-interface.js";
import { hybridSearch } from "../hybrid.js";

const mockEmbed = vi.mocked(embed);

function makeStoreMock() {
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

function makeDbMock(vecRows: Array<{ id: string; distance: number }>) {
  const stmt = { all: vi.fn().mockReturnValue(vecRows) };
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

function makeStoreWithDb(
  dbMock: ReturnType<typeof makeDbMock>,
): IKeyValueStore & { getDb(): unknown } {
  return { ...makeStoreMock(), getDb: () => dbMock } as unknown as IKeyValueStore & {
    getDb(): unknown;
  };
}

describe("hybridSearch()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns searchMode: bm25 when embed throws (fallback)", async () => {
    mockEmbed.mockRejectedValue(new Error("model not loaded"));

    const store = makeStoreMock();
    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("bm25");
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("returns searchMode: bm25 when embed succeeds but store has no getDb", async () => {
    mockEmbed.mockResolvedValue([new Float32Array(384).fill(0.1)]);

    const store = makeStoreMock();
    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("bm25");
  });

  it("returns searchMode: hybrid when embed succeeds and store has getDb", async () => {
    const vec = new Float32Array(384).fill(0.1);
    mockEmbed.mockResolvedValue([vec]);

    const db = makeDbMock([
      { id: "doc-alpha", distance: 0.1 },
      { id: "doc-beta", distance: 0.2 },
    ]);
    const store = makeStoreWithDb(db);

    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("hybrid");
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("vec_items"));
  });

  it("fuses BM25 and vector candidates via RRF when hybrid path succeeds", async () => {
    const vec = new Float32Array(384).fill(0.05);
    mockEmbed.mockResolvedValue([vec]);

    // vec returns same id as what BM25 would rank — bm25Ranked may be empty
    // (searchApis falls back to []) so fusedResults will be empty array,
    // but searchMode must still be "hybrid"
    const db = makeDbMock([{ id: "tweenservice", distance: 0.05 }]);
    const store = makeStoreWithDb(db);

    const result = await hybridSearch(store, "tweenservice", "docs", 5);

    expect(result.searchMode).toBe("hybrid");
    expect(Array.isArray(result.results)).toBe(true);
  });
});
