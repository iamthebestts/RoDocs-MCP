import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchIndex = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    classes: [
      "MemoryStoreService",
      "MemoryStoreQueue",
      "MemoryStoreHashMap",
      "DataStoreService",
      "DataStore",
      "PathfindingService",
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
      description: "How to use bindable events for server to server communication",
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

vi.mock("../../scraper/fetch.js", () => ({
  fetchIndex: mockFetchIndex,
  fetchTopic: vi.fn(),
  findClosestMatch: vi.fn(),
}));

vi.mock("../../scraper/guides.js", () => ({
  fetchGuideIndex: mockFetchGuideIndex,
  fetchGuide: vi.fn(),
  searchGuides: vi.fn(),
}));

import type { Indexer } from "../../store/indexer.js";
import {
  _resetIndexesForTesting,
  initIndexer,
  search,
  searchApis,
  searchApisLocal,
  searchGuides,
  searchGuidesLocal,
  sortByRecency,
  warmUp,
} from "../index.js";

function initMissingPersistedIndexer() {
  initIndexer({ getPath: () => "C:/tmp/rodocs-missing-store/store.lmdb" } as never, {} as never);
}

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

    it("expands aliases before BM25 search", async () => {
      const results = await search("ds", { limit: 10, types: ["api"] });
      const names = results.map((r) => r.name);

      expect(names).toContain("DataStore");
      expect(names).toContain("DataStoreService");
      expect(names.length).toBeGreaterThan(1);
    });

    it("uses fuzzy fallback when BM25 returns no results", async () => {
      const results = await search("PathfindngService", { limit: 5, types: ["api"] });

      expect(results[0]?.name).toBe("PathfindingService");
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

    it("can sort post-BM25 results with recency boost", () => {
      const results = sortByRecency(
        [
          {
            type: "guide",
            name: "old",
            score: 10,
            ageDays: 365,
          },
          {
            type: "guide",
            name: "new",
            score: 8,
            ageDays: 0,
          },
        ],
        { halfLifeDays: 365, minMultiplier: 0.1 },
      );

      expect(results[0]?.name).toBe("new");
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

describe("initIndexer invalidation via onClear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetIndexesForTesting();
  });

  it("rebuilds the API index after the shared indexer fires clear('api')", async () => {
    const fakeIndexer = {
      _store: {},
      _syncManager: {},
      onClear: vi.fn(),
      load: vi.fn().mockResolvedValue(false),
      save: vi.fn().mockResolvedValue(undefined),
      loadOrBuildIndex: vi.fn().mockImplementation(async (_s, _b, builder) => {
        await builder();
      }),
    } as unknown as Indexer;

    // Capture the "api" callback registered by initIndexer
    let apiClearCallback: (() => void) | undefined;
    vi.mocked(fakeIndexer.onClear).mockImplementation((source, cb) => {
      if (source === "api") apiClearCallback = cb;
    });

    initIndexer({} as never, {} as never, fakeIndexer);

    // First search builds the index
    await searchApis("TweenService", 3);
    expect(mockFetchIndex).toHaveBeenCalledTimes(1);

    // Simulated write: pipeline calls indexer.clear("api") which fires the callback
    apiClearCallback?.();

    // Next search must rebuild (fetch called again)
    await searchApis("RunService", 3);
    expect(mockFetchIndex).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the guide index after the shared indexer fires clear('guides')", async () => {
    const fakeIndexer = {
      _store: {},
      _syncManager: {},
      onClear: vi.fn(),
      load: vi.fn().mockResolvedValue(false),
      save: vi.fn().mockResolvedValue(undefined),
      loadOrBuildIndex: vi.fn().mockImplementation(async (_s, _b, builder) => {
        await builder();
      }),
    } as unknown as Indexer;

    let guidesClearCallback: (() => void) | undefined;
    vi.mocked(fakeIndexer.onClear).mockImplementation((source, cb) => {
      if (source === "guides") guidesClearCallback = cb;
    });

    initIndexer({} as never, {} as never, fakeIndexer);

    await searchGuides("save player data", 3);
    expect(mockFetchGuideIndex).toHaveBeenCalledTimes(1);

    guidesClearCallback?.();

    await searchGuides("remote events", 3);
    expect(mockFetchGuideIndex).toHaveBeenCalledTimes(2);
  });
});

describe("searchApis (direct)", () => {
  beforeEach(() => {
    _resetIndexesForTesting();
    vi.clearAllMocks();
  });

  it("returns only api type results", async () => {
    const results = await searchApis("RunService", 5);
    for (const r of results) {
      expect(r.type).toBe("api");
    }
  });

  it("local search returns empty without fetching when the index is cold", async () => {
    const results = await searchApisLocal("RunService", 5);

    expect(results).toEqual([]);
    expect(mockFetchIndex).not.toHaveBeenCalled();
  });

  it("local search checks persisted API indexes without building remotely", async () => {
    initMissingPersistedIndexer();

    const results = await searchApisLocal("RunService", 5);

    expect(results).toEqual([]);
    expect(mockFetchIndex).not.toHaveBeenCalled();
  });

  it("local search uses an already-built API index", async () => {
    await searchApis("RunService", 5);
    vi.clearAllMocks();

    const results = await searchApisLocal("RunService", 5);

    expect(results.some((r) => r.name === "RunService")).toBe(true);
    expect(mockFetchIndex).not.toHaveBeenCalled();
  });
});

describe("searchGuides (direct)", () => {
  beforeEach(() => {
    _resetIndexesForTesting();
    vi.clearAllMocks();
  });

  it("returns only guide type results", async () => {
    const results = await searchGuides("save player data", 5);
    for (const r of results) {
      expect(r.type).toBe("guide");
    }
  });

  it("local search returns empty without fetching when the guide index is cold", async () => {
    const results = await searchGuidesLocal("save player data", 5);

    expect(results).toEqual([]);
    expect(mockFetchGuideIndex).not.toHaveBeenCalled();
  });

  it("local search checks persisted guide indexes without building remotely", async () => {
    initMissingPersistedIndexer();

    const results = await searchGuidesLocal("save player data", 5);

    expect(results).toEqual([]);
    expect(mockFetchGuideIndex).not.toHaveBeenCalled();
  });

  it("local search uses an already-built guide index", async () => {
    _resetIndexesForTesting({ guideScoreThreshold: 0 });
    await searchGuides("save player data", 5);
    vi.clearAllMocks();

    const results = await searchGuidesLocal("save player data", 5);

    expect(results.some((r) => r.type === "guide")).toBe(true);
    expect(mockFetchGuideIndex).not.toHaveBeenCalled();
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
