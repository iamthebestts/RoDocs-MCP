import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchIndex = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    classes: [
      "MemoryStoreService",
      "MemoryStoreQueue",
      "MemoryStoreHashMap",
      "DataStoreService",
      "DataStore",
      "TweenService",
      "RemoteEvent",
      "RunService",
      "Player",
    ],
    enums: ["TweenStatus", "RunContext"],
  }),
);

const mockFetchGuideIndex = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      path: "cloud-services/data-stores/save-player-data.md",
      title: "Save Player Data",
      description: "How to persist and save player data using DataStore",
      category: "cloud-services",
    },
    {
      path: "cloud-services/data-stores/index.md",
      title: "Data Stores Overview",
      description: "Overview of data store features for saving player data",
      category: "cloud-services",
    },
    {
      path: "cloud-services/data-stores/player-data-purchasing.md",
      title: "Player Data and Purchasing",
      description: "Managing player data alongside in-experience purchases",
      category: "cloud-services",
    },
    {
      path: "scripting/events/remote.md",
      title: "Remote Events",
      description: "How to use remote events for client server communication",
      category: "scripting",
    },
    {
      path: "scripting/events/bindable.md",
      title: "Bindable Events",
      description:
        "How to use bindable events for server to server communication",
      category: "scripting",
    },
    {
      path: "production/creator-store.md",
      title: "Creator Store",
      description: "Publishing assets to the creator store marketplace",
      category: "production",
    },
    {
      path: "tutorials/use-case-tutorials/data-storage/index.md",
      title: "Data Storage Tutorials",
      description: "Tutorials for saving and loading player data",
      category: "tutorials",
    },
  ]),
);

vi.mock("../fetch.js", () => ({
  fetchIndex: mockFetchIndex,
  fetchTopic: vi.fn(),
  findClosestMatch: vi.fn(),
}));

vi.mock("../guides.js", () => ({
  fetchGuideIndex: mockFetchGuideIndex,
  fetchGuide: vi.fn(),
  searchGuides: vi.fn(),
}));

import {
  _resetIndexesForTesting,
  search,
  searchApis,
  searchGuides,
  warmUp,
} from "../search.js";

describe("search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetIndexesForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("alias layer (layer 1)", () => {
    it("alias hit returns score 100 in first position", async () => {
      const results = await search("memory store", { limit: 5 });
      const first = results[0];
      expect(first?.score).toBe(100);
      expect(first?.name).toBe("MemoryStoreService");
    });

    it("alias hit type is 'api'", async () => {
      const results = await search("datastore", { limit: 3 });
      const aliasResult = results.find((r) => r.name === "DataStoreService");
      expect(aliasResult?.type).toBe("api");
    });

    it("alias result is not duplicated by BM25 layer", async () => {
      const results = await search("memory store", { limit: 10 });
      const names = results.map((r) => r.name);
      const unique = [...new Set(names)];
      expect(names).toEqual(unique);
    });
  });

  describe("BM25 API layer (layer 2)", () => {
    it("returns api results for known class name", async () => {
      const results = await search("TweenService", { limit: 5 });
      const types = results.map((r) => r.type);
      expect(types).toContain("api");
    });

    it("filters by types option api only", async () => {
      const results = await search("data store", { limit: 10, types: ["api"] });
      for (const r of results) {
        expect(r.type).toBe("api");
      }
    });
  });

  describe("BM25 guide layer (layer 3)", () => {
    beforeEach(() => {
      _resetIndexesForTesting({ guideScoreThreshold: 0 });
    });

    it("returns guide results for natural language query", async () => {
      const results = await searchGuides("save player data", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.type).toBe("guide");
      expect(results[0]?.path).toContain("data");
    });

    it("filters by types option guide only via searchGuides", async () => {
      const results = await searchGuides("remote events scripting", 5);
      for (const r of results) {
        expect(r.type).toBe("guide");
      }
    });
  });

  describe("options", () => {
    it("respects limit option", async () => {
      const results = await search("data store service", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("uses default limit of 10 when not specified", async () => {
      const results = await search("service");
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it("returns empty array for empty query", async () => {
      const results = await search("", { limit: 5 });
      expect(results).toEqual([]);
    });
  });

  describe("result shape", () => {
    it("every result has required fields", async () => {
      const results = await search("DataStore", { limit: 5 });
      for (const r of results) {
        expect(typeof r.type).toBe("string");
        expect(["api", "guide"]).toContain(r.type);
        expect(typeof r.name).toBe("string");
        expect(r.name.length).toBeGreaterThan(0);
        expect(typeof r.score).toBe("number");
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it("api results have path with class or enum prefix", async () => {
      const results = await search("RunService", { limit: 3, types: ["api"] });
      for (const r of results) {
        if (r.type === "api") {
          expect(r.path).toMatch(/^(classes|enums)\//);
        }
      }
    });
  });

  describe("sorting", () => {
    it("results are sorted by score descending", async () => {
      const results = await search("data store", { limit: 10 });
      for (let i = 0; i < results.length - 1; i++) {
        const current = results[i];
        const next = results[i + 1];
        if (current !== undefined && next !== undefined) {
          expect(current.score).toBeGreaterThanOrEqual(next.score);
        }
      }
    });
  });

  describe("promise lock (no duplicate index builds)", () => {
    it("calling search concurrently does not throw", async () => {
      await expect(
        Promise.all([
          search("DataStore", { limit: 3 }),
          search("TweenService", { limit: 3 }),
          search("RemoteEvent", { limit: 3 }),
        ]),
      ).resolves.not.toThrow();
    });
  });

  describe("warmUp", () => {
    it("executes without throwing", () => {
      expect(() => warmUp()).not.toThrow();
    });
  });
});

describe("searchApis (direct)", () => {
  beforeEach(() => {
    _resetIndexesForTesting();
  });

  it("returns only api type results", async () => {
    const results = await searchApis("RunService", 5);
    for (const r of results) {
      expect(r.type).toBe("api");
    }
  });
});

describe("searchGuides (direct)", () => {
  beforeEach(() => {
    _resetIndexesForTesting();
  });

  it("returns only guide type results", async () => {
    const results = await searchGuides("save player data", 5);
    for (const r of results) {
      expect(r.type).toBe("guide");
    }
  });

  describe("score threshold", () => {
    it("search() omits guide results below threshold", async () => {
      const results = await search("save player data", { limit: 5 });
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(5);
      }
    });
  });
});
