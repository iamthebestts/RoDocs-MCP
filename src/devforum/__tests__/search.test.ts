import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmdbStore } from "../../store/index.js";
import type { Indexer } from "../../store/indexer.js";
import { _setLogEventSinkForTesting, type LogEvent } from "../../utils/logger.js";
import {
  _resetDevForumIndexForTesting,
  initDevForumSearch,
  searchDevForumStore,
} from "../search.js";
import type { DevForumRecord } from "../types.js";

class MemoryStore {
  constructor(private readonly data = new Map<string, unknown>()) {}

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }
}

function asStore(store: MemoryStore): LmdbStore {
  return store as unknown as LmdbStore;
}

function record(overrides: Partial<DevForumRecord>): DevForumRecord {
  return {
    id: 1,
    title: "DataStore saving fails",
    url: "https://devforum.roblox.com/t/datastore-saving-fails/1",
    content: "DataStore UpdateAsync save player data issue",
    acceptedAnswer: "Use UpdateAsync with retries.",
    staffReplies: ["Staff says avoid SetAsync spam."],
    codeSnippets: ["local ds = game:GetService('DataStoreService')"],
    tags: ["scripting", "data-store"],
    score: 85,
    source: "search:data store",
    lastSyncAt: Date.UTC(2026, 0, 1),
    ...overrides,
  };
}

describe("searchDevForumStore (fallback path — no Indexer)", () => {
  // These tests exercise the existing per-call LMDB path (no initDevForumSearch called).
  beforeEach(() => {
    _resetDevForumIndexForTesting();
  });

  afterEach(() => {
    _resetDevForumIndexForTesting();
  });

  it("returns a setup message when the local store is empty", async () => {
    const result = await searchDevForumStore(asStore(new MemoryStore()), { query: "datastore" });

    expect(result.results).toEqual([]);
    expect(result.message).toContain("npx rodocsmcp --seed-devforum");
  });

  it("searches records by query and orders by relevance before score", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          [
            "devforum:1",
            record({
              id: 1,
              title: "DataStore saving fails",
              content: "DataStore DataStore DataStore player saving",
              score: 70,
            }),
          ],
          [
            "devforum:2",
            record({
              id: 2,
              title: "General DataStore issue",
              content: "DataStore issue",
              score: 95,
            }),
          ],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, { query: "DataStore", minScore: 60 });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.title).toBe("DataStore saving fails");
  });

  it("applies tags, accepted answer, staff reply, minScore, and limit filters", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["devforum:1", record({ id: 1, score: 90 })],
          [
            "devforum:2",
            record({
              id: 2,
              title: "DataStore without staff",
              staffReplies: [],
              tags: ["scripting"],
              score: 90,
            }),
          ],
          [
            "devforum:3",
            record({
              id: 3,
              title: "Low score DataStore",
              score: 40,
            }),
          ],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, {
      query: "DataStore",
      tags: ["data-store"],
      requireAcceptedAnswer: true,
      requireStaffReply: true,
      minScore: 80,
      limit: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("DataStore saving fails");
  });

  it("returns clean short excerpts and short code snippets", async () => {
    const longCode = "print('x')\n".repeat(80);
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          [
            "devforum:1",
            record({
              acceptedAnswer: "<p>Use &lt;UpdateAsync&gt; and retry writes.</p>",
              staffReplies: [
                "<aside>quoted</aside><p>Staff &amp; engineers recommend budgets.</p>",
              ],
              codeSnippets: [longCode, "second", "third", "fourth"],
            }),
          ],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, { query: "UpdateAsync", minScore: 60 });
    const first = result.results[0];

    expect(first?.acceptedAnswer).toBe("Use <UpdateAsync> and retry writes.");
    expect(first?.staffReply).toContain("Staff & engineers");
    expect(first?.staffReply).not.toContain("<p>");
    expect(first?.codeSnippets).toHaveLength(3);
    expect(first?.codeSnippets[0]?.length).toBeLessThanOrEqual(360);
    expect(first?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(first?.lastSeenAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses defaults, ignores non-devforum keys, and omits empty optional excerpts", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["other:1", record({ title: "Ignored DataStore" })],
          [
            "devforum:1",
            record({
              title: "DataStore without extras",
              acceptedAnswer: undefined,
              staffReplies: [],
              codeSnippets: ["   "],
            }),
          ],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, { query: "DataStore" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("DataStore without extras");
    expect(result.results[0]).not.toHaveProperty("acceptedAnswer");
    expect(result.results[0]).not.toHaveProperty("staffReply");
    expect(result.results[0]?.codeSnippets).toEqual([]);
  });

  it("returns no results for punctuation-only queries or missing required tags", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([["devforum:1", record({ title: "DataStore saving fails" })]]),
      ),
    );

    const punctuation = await searchDevForumStore(store, { query: "!!!" });
    const missingTag = await searchDevForumStore(store, {
      query: "DataStore",
      tags: ["physics"],
    });

    expect(punctuation.results).toEqual([]);
    expect(missingTag.results).toEqual([]);
  });

  it("clamps large limits and uses score as a tie-breaker for equal relevance", async () => {
    const entries = Array.from(
      { length: 30 },
      (_, index) =>
        [
          `devforum:${index}`,
          record({
            id: index,
            title: `DataStore topic ${index}`,
            content: "DataStore",
            score: index === 5 ? 99 : 80,
          }),
        ] as const,
    );
    const store = asStore(new MemoryStore(new Map<string, unknown>(entries)));

    const result = await searchDevForumStore(store, {
      query: "DataStore",
      minScore: 0,
      limit: 100,
    });

    expect(result.results).toHaveLength(25);
    expect(result.results[0]?.title).toBe("DataStore topic 5");
  });
});

describe("searchDevForumStore (cached path — with Indexer)", () => {
  let clearCallback: (() => void) | undefined;
  let fakeIndexer: Indexer;

  beforeEach(() => {
    _resetDevForumIndexForTesting();
    clearCallback = undefined;
    fakeIndexer = {
      onClear: (_source: string, cb: () => void) => {
        clearCallback = cb;
      },
    } as unknown as Indexer;
    initDevForumSearch(fakeIndexer);
  });

  afterEach(() => {
    _resetDevForumIndexForTesting();
  });

  it("returns results via cache after index is built", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["devforum:1", record({ id: 1, title: "DataStore saving fails" })],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, { query: "DataStore", minScore: 0 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("DataStore saving fails");
  });

  it("cache hit: does not reload records from store on second call", async () => {
    const memStore = new MemoryStore(new Map<string, unknown>([["devforum:1", record({ id: 1 })]]));
    const keysSpy = vi.spyOn(memStore, "keys");
    const store = asStore(memStore);

    await searchDevForumStore(store, { query: "DataStore", minScore: 0 });
    await searchDevForumStore(store, { query: "DataStore", minScore: 0 });

    expect(keysSpy).toHaveBeenCalledTimes(1);
  });

  it("returns empty message when cache is empty (no records in store)", async () => {
    const store = asStore(new MemoryStore(new Map()));

    const result = await searchDevForumStore(store, { query: "DataStore" });

    expect(result.results).toEqual([]);
    expect(result.message).toContain("npx rodocsmcp --seed-devforum");
  });

  it("returns empty array after BM25 pre-filter finds no candidates", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([["devforum:1", record({ id: 1, title: "Physics joints" })]]),
      ),
    );

    const result = await searchDevForumStore(store, { query: "QuantumEntanglement", minScore: 0 });

    expect(result.results).toEqual([]);
  });

  it("invalidation: rebuilds index after onClear fires", async () => {
    const memStore = new MemoryStore(new Map<string, unknown>([["devforum:1", record({ id: 1 })]]));
    const keysSpy = vi.spyOn(memStore, "keys");
    const store = asStore(memStore);

    await searchDevForumStore(store, { query: "DataStore", minScore: 0 });
    expect(keysSpy).toHaveBeenCalledTimes(1);

    // Simulate DevForumPipeline calling indexer.clear("devforum")
    clearCallback?.();

    await searchDevForumStore(store, { query: "DataStore", minScore: 0 });
    expect(keysSpy).toHaveBeenCalledTimes(2);
  });

  it("applies minScore, tags, acceptedAnswer, staffReply filters from cache", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["devforum:1", record({ id: 1, score: 85, tags: ["scripting", "data-store"] })],
          ["devforum:2", record({ id: 2, score: 30, tags: ["scripting"] })],
        ]),
      ),
    );

    const result = await searchDevForumStore(store, {
      query: "DataStore",
      minScore: 80,
      tags: ["data-store"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.tags).toContain("data-store");
  });
});

describe("searchDevForumStore observability", () => {
  let captured: LogEvent[];

  function makeRecord(overrides: Partial<DevForumRecord> = {}): DevForumRecord {
    return {
      id: 1,
      title: "DataStore issue",
      url: "https://devforum.roblox.com/t/1",
      content: "DataStore UpdateAsync problem",
      acceptedAnswer: "Use retries.",
      staffReplies: [],
      codeSnippets: [],
      tags: ["scripting"],
      score: 85,
      source: "search:datastore",
      lastSyncAt: Date.UTC(2026, 0, 1),
      ...overrides,
    };
  }

  function storeWith(records: DevForumRecord[]): LmdbStore {
    const data = new Map<string, unknown>(records.map((r) => [`devforum:${r.id}`, r]));
    return {
      async keys() {
        return [...data.keys()];
      },
      async get<T>(key: string): Promise<T | null> {
        return (data.get(key) as T | undefined) ?? null;
      },
    } as unknown as LmdbStore;
  }

  beforeEach(() => {
    _resetDevForumIndexForTesting();
    captured = [];
    _setLogEventSinkForTesting((e) => captured.push(e));
  });

  afterEach(() => {
    _resetDevForumIndexForTesting();
    _setLogEventSinkForTesting(null);
  });

  it("emits search.query with source=devforum on every call", async () => {
    const store = storeWith([makeRecord()]);

    await searchDevForumStore(store, { query: "DataStore" });

    const event = captured.find((e) => e.event === "search.query");
    expect(event).toMatchObject({ event: "search.query", source: "devforum" });
    expect(typeof event?.durationMs).toBe("number");
  });

  it("emits search.query even when result set is empty", async () => {
    const store = storeWith([]);

    await searchDevForumStore(store, { query: "anything" });

    expect(captured.some((e) => e.event === "search.query")).toBe(true);
  });

  it("emits exactly one search.query per call", async () => {
    const store = storeWith([makeRecord()]);

    await searchDevForumStore(store, { query: "DataStore" });

    expect(captured.filter((e) => e.event === "search.query")).toHaveLength(1);
  });

  it("emits search.rebuild with source=devforum when BM25 index is built via Indexer path", async () => {
    const fakeIndexer = {
      onClear: (_source: string, cb: () => void) => {
        void cb;
      },
    } as unknown as Indexer;

    const store = storeWith([makeRecord()]);
    initDevForumSearch(fakeIndexer);

    await searchDevForumStore(store, { query: "DataStore" });

    const event = captured.find((e) => e.event === "search.rebuild");
    expect(event).toMatchObject({ event: "search.rebuild", source: "devforum" });
    expect(typeof event?.durationMs).toBe("number");
  });

  it("does not emit search.rebuild on subsequent calls when index is cached", async () => {
    const fakeIndexer = {
      onClear: (_source: string, _cb: () => void) => {},
    } as unknown as Indexer;

    const store = storeWith([makeRecord()]);
    initDevForumSearch(fakeIndexer);

    await searchDevForumStore(store, { query: "DataStore" });
    captured = [];

    await searchDevForumStore(store, { query: "DataStore" });

    expect(captured.some((e) => e.event === "search.rebuild")).toBe(false);
  });
});
