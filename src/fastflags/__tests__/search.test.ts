import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmdbStore } from "../../store/index.js";
import type { Indexer } from "../../store/indexer.js";
import { _setLogEventSinkForTesting, type LogEvent } from "../../utils/logger.js";
import type { FastFlag } from "../parser.js";
import { _resetFastFlagsIndexForTesting, FastFlagSearch } from "../search.js";

function makeFlag(overrides: Partial<FastFlag> = {}): FastFlag {
  return {
    name: "FFlagTestFeature",
    kind: "FFlag",
    behavior: "Fast",
    value: true,
    valuesByTarget: undefined,
    platforms: ["windows"],
    targets: ["PCClient"],
    sources: [{ target: "PCClient", url: "http://example.com", sha: "abc" }],
    ...overrides,
  };
}

class MockStore {
  private data: Map<string, FastFlag>;

  constructor(flags: FastFlag[]) {
    this.data = new Map(flags.map((f) => [`fastflags:${f.name}`, f]));
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }
}

function asStore(mock: MockStore): LmdbStore {
  return mock as unknown as LmdbStore;
}

describe("FastFlagSearch", () => {
  let captured: LogEvent[];

  beforeEach(() => {
    _resetFastFlagsIndexForTesting();
    captured = [];
    _setLogEventSinkForTesting((e) => captured.push(e));
  });

  afterEach(() => {
    _resetFastFlagsIndexForTesting();
    _setLogEventSinkForTesting(null);
  });

  describe("basic search", () => {
    it("returns empty array when store has no fastflag keys", async () => {
      const store = asStore(new MockStore([]));
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ query: "test" });

      expect(results).toEqual([]);
    });

    it("returns all flags alphabetically when no query is given", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FFlagZebra" }),
          makeFlag({ name: "FFlagAlpha" }),
          makeFlag({ name: "FFlagMiddle" }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({});

      expect(results.map((f) => f.name)).toEqual(["FFlagAlpha", "FFlagMiddle", "FFlagZebra"]);
    });

    it("returns matching flags for text query using BM25", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FIntTaskSchedulerLatency" }),
          makeFlag({ name: "FFlagEnableNewPhysics" }),
          makeFlag({ name: "FIntPlayerCount" }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ query: "TaskScheduler" });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("FIntTaskSchedulerLatency");
    });

    it("places exact match at the top", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FFlagTestFeatureEnabled" }),
          makeFlag({ name: "FFlagTestFeature" }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ query: "FFlagTestFeature" });

      expect(results[0]?.name).toBe("FFlagTestFeature");
    });

    it("returns empty array when no flags match the query", async () => {
      const store = asStore(new MockStore([makeFlag({ name: "FFlagUnrelated" })]));
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ query: "QuantumEntanglement" });

      expect(results).toEqual([]);
    });
  });

  describe("metadata filters", () => {
    it("filters by kind", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FFlagA", kind: "FFlag" }),
          makeFlag({ name: "FIntB", kind: "FInt" }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ kind: "FInt" });

      expect(results.every((f) => f.kind === "FInt")).toBe(true);
      expect(results.some((f) => f.name === "FIntB")).toBe(true);
    });

    it("filters by behavior", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FFlagFast", behavior: "Fast" }),
          makeFlag({ name: "DFIntDynamic", behavior: "Dynamic" }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ behavior: "Dynamic" });

      expect(results.every((f) => f.behavior === "Dynamic")).toBe(true);
    });

    it("filters by platform", async () => {
      const store = asStore(
        new MockStore([
          makeFlag({ name: "FFlagIos", platforms: ["ios", "mobile"] }),
          makeFlag({ name: "FFlagWindows", platforms: ["windows"] }),
        ]),
      );
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ platform: "ios" });

      expect(results.every((f) => f.platforms.includes("ios"))).toBe(true);
      expect(results.some((f) => f.name === "FFlagIos")).toBe(true);
      expect(results.some((f) => f.name === "FFlagWindows")).toBe(false);
    });

    it("respects limit", async () => {
      const flags = Array.from({ length: 10 }, (_, i) =>
        makeFlag({ name: `FFlagItem${i}`, kind: "FFlag" }),
      );
      const store = asStore(new MockStore(flags));
      const searcher = new FastFlagSearch(store);

      const results = await searcher.search({ limit: 3 });

      expect(results).toHaveLength(3);
    });
  });

  describe("singleton cache", () => {
    it("does not rebuild the index on subsequent searches (cache hit)", async () => {
      const mock = new MockStore([makeFlag({ name: "FFlagCached" })]);
      const keysSpy = vi.spyOn(mock, "keys");
      const store = asStore(mock);
      const searcher = new FastFlagSearch(store);

      await searcher.search({ query: "FFlagCached" });
      await searcher.search({ query: "FFlagCached" });

      // keys() is called only once during the initial build
      expect(keysSpy).toHaveBeenCalledTimes(1);
    });

    it("rebuilds after _resetFastFlagsIndexForTesting()", async () => {
      const mock = new MockStore([makeFlag({ name: "FFlagFirst" })]);
      const keysSpy = vi.spyOn(mock, "keys");
      const store = asStore(mock);
      const searcher = new FastFlagSearch(store);

      await searcher.search({});
      _resetFastFlagsIndexForTesting();
      await searcher.search({});

      expect(keysSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidation via Indexer", () => {
    it("rebuilds index after the registered onClear callback fires", async () => {
      let clearCallback: (() => void) | undefined;
      const fakeIndexer = {
        onClear: (_source: string, cb: () => void) => {
          clearCallback = cb;
        },
      } as unknown as Indexer;

      const mock = new MockStore([makeFlag({ name: "FFlagOriginal" })]);
      const keysSpy = vi.spyOn(mock, "keys");
      const store = asStore(mock);
      const searcher = new FastFlagSearch(store, fakeIndexer);

      await searcher.search({ query: "Original" });
      expect(keysSpy).toHaveBeenCalledTimes(1);

      // Simulate write: indexer.clear("fastflags") fires the callback
      clearCallback?.();

      await searcher.search({ query: "Original" });
      expect(keysSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("observability", () => {
    it("emits search.query with source=fastflags and durationMs on every search call", async () => {
      const store = asStore(new MockStore([makeFlag({ name: "FFlagA" })]));
      const searcher = new FastFlagSearch(store);

      await searcher.search({ query: "FFlagA" });

      const event = captured.find((e) => e.event === "search.query");
      expect(event).toMatchObject({ event: "search.query", source: "fastflags" });
      expect(typeof event?.durationMs).toBe("number");
    });

    it("emits search.rebuild with source=fastflags when building the index for the first time", async () => {
      const store = asStore(new MockStore([makeFlag({ name: "FFlagA" })]));
      const searcher = new FastFlagSearch(store);

      await searcher.search({});

      const event = captured.find((e) => e.event === "search.rebuild");
      expect(event).toMatchObject({ event: "search.rebuild", source: "fastflags" });
      expect(typeof event?.durationMs).toBe("number");
    });

    it("does not emit search.rebuild on a cache hit (index already built)", async () => {
      const store = asStore(new MockStore([makeFlag({ name: "FFlagA" })]));
      const searcher = new FastFlagSearch(store);

      await searcher.search({});
      captured = [];

      await searcher.search({});

      expect(captured.some((e) => e.event === "search.rebuild")).toBe(false);
    });

    it("emits exactly one search.query per search() call", async () => {
      const store = asStore(new MockStore([makeFlag({ name: "FFlagA" })]));
      const searcher = new FastFlagSearch(store);

      await searcher.search({ query: "FFlagA" });

      expect(captured.filter((e) => e.event === "search.query")).toHaveLength(1);
    });
  });
});
