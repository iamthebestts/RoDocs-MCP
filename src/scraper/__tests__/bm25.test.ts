import { describe, expect, it } from "vitest";
import type { BM25Doc } from "../../types/index.js";
import { BM25 } from "../bm25.js";

const DOCS: BM25Doc[] = [
  {
    id: "MemoryStoreService",
    fields: { title: "MemoryStoreService", path: "classes/MemoryStoreService" },
  },
  {
    id: "MemoryStoreQueue",
    fields: { title: "MemoryStoreQueue", path: "classes/MemoryStoreQueue" },
  },
  {
    id: "DataStoreService",
    fields: { title: "DataStoreService", path: "classes/DataStoreService" },
  },
  {
    id: "DataStore",
    fields: { title: "DataStore", path: "classes/DataStore" },
  },
  {
    id: "TweenService",
    fields: { title: "TweenService", path: "classes/TweenService" },
  },
  {
    id: "RunService",
    fields: { title: "RunService", path: "classes/RunService" },
  },
  {
    id: "guide-datastore",
    fields: {
      title: "Data Stores",
      path: "cloud-services/data-stores/index.md",
      description: "How to persist player data using DataStore",
    },
  },
];

function makeEngine(): BM25 {
  const engine = new BM25();
  engine.index(DOCS);
  return engine;
}

describe("BM25", () => {
  describe("index", () => {
    it("indexes without throwing", () => {
      expect(() => makeEngine()).not.toThrow();
    });

    it("returns empty results before indexing", () => {
      const engine = new BM25();
      expect(engine.search("DataStore")).toEqual([]);
    });

    it("handles empty doc list", () => {
      const engine = new BM25();
      engine.index([]);
      expect(engine.search("anything")).toEqual([]);
    });
  });

  describe("search ranking", () => {
    it("returns results sorted by score descending", () => {
      const engine = makeEngine();
      const results = engine.search("DataStore", 5);
      for (let i = 0; i < results.length - 1; i++) {
        const current = results[i];
        const next = results[i + 1];
        if (current !== undefined && next !== undefined) {
          expect(current.score).toBeGreaterThanOrEqual(next.score);
        }
      }
    });

    it("ranks exact title match above path-only match", () => {
      const engine = makeEngine();
      const results = engine.search("DataStoreService", 5);
      const first = results[0];
      expect(first?.id).toBe("DataStoreService");
    });

    it("returns relevant results for partial query", () => {
      const engine = makeEngine();
      const results = engine.search("memory store", 5);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("MemoryStoreService");
      expect(ids).toContain("MemoryStoreQueue");
    });

    it("does not return unrelated docs for specific query", () => {
      const engine = makeEngine();
      const results = engine.search("tween", 3);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("TweenService");
      expect(ids).not.toContain("RunService");
    });

    it("respects limit parameter", () => {
      const engine = makeEngine();
      expect(engine.search("service", 2)).toHaveLength(2);
      expect(engine.search("service", 1)).toHaveLength(1);
    });

    it("returns at most available docs when limit exceeds corpus", () => {
      const engine = makeEngine();
      const results = engine.search("service", 999);
      expect(results.length).toBeLessThanOrEqual(DOCS.length);
    });

    it("returns empty for query with no matches", () => {
      const engine = makeEngine();
      const results = engine.search("xyznotexists");
      expect(results).toEqual([]);
    });

    it("scores description field matches", () => {
      const engine = makeEngine();
      const results = engine.search("persist player data", 5);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("guide-datastore");
    });
  });

  describe("score values", () => {
    it("all scores are positive numbers", () => {
      const engine = makeEngine();
      const results = engine.search("data store service", 10);
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(Number.isFinite(r.score)).toBe(true);
      }
    });

    it("same query returns same scores (deterministic)", () => {
      const engine = makeEngine();
      const r1 = engine.search("DataStore", 5).map((r) => r.score);
      const r2 = engine.search("DataStore", 5).map((r) => r.score);
      expect(r1).toEqual(r2);
    });
  });
});
