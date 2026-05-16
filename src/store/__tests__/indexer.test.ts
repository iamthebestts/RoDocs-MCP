import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BM25 } from "../../search/bm25.js";
import { _setLogEventSinkForTesting, type LogEvent } from "../../utils/logger.js";
import { LmdbStore, SyncStateManager } from "../index.js";
import { Indexer } from "../indexer.js";

describe("Indexer", () => {
  let indexer: Indexer;
  let bm25: BM25;
  let tempDir: string;
  let store: LmdbStore;
  let syncManager: SyncStateManager;
  let captured: LogEvent[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-indexer-test-"));
    store = new LmdbStore({ cacheDir: tempDir });
    await store.open();
    syncManager = new SyncStateManager(store);
    indexer = new Indexer(store, syncManager);
    bm25 = new BM25();
    captured = [];
    _setLogEventSinkForTesting((e) => captured.push(e));
  });

  afterEach(async () => {
    _setLogEventSinkForTesting(null);
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should save and load the index", async () => {
    bm25.index([
      { id: "doc1", fields: { title: "Roblox API Persistence" } },
      { id: "doc2", fields: { title: "Luau Scripting Performance" } },
    ]);

    await indexer.save(bm25, "test");

    const newBm25 = new BM25();
    const loaded = await indexer.load(newBm25, "test");

    expect(loaded).toBe(true);
    const results = newBm25.search("Persistence");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("doc1");
  });

  it("should return false if index file doesn't exist", async () => {
    const loaded = await indexer.load(bm25, "test");
    expect(loaded).toBe(false);
  });

  it("should clear the index", async () => {
    bm25.index([{ id: "doc1", fields: { title: "test" } }]);
    await indexer.save(bm25, "test");
    await indexer.clear("test");

    const newBm25 = new BM25();
    const loaded = await indexer.load(newBm25, "test");
    expect(loaded).toBe(false);
  });

  it("calls the registered onClear callback when clear() is invoked", async () => {
    let called = false;
    indexer.onClear("mySource", () => {
      called = true;
    });

    await indexer.clear("mySource");

    expect(called).toBe(true);
  });

  it("does not call callback for unrelated sources", async () => {
    let called = false;
    indexer.onClear("sourceA", () => {
      called = true;
    });

    await indexer.clear("sourceB");

    expect(called).toBe(false);
  });

  describe("observability", () => {
    it("emits indexer.clear with the correct source when clear() is called", async () => {
      await indexer.clear("api");

      const event = captured.find((e) => e.event === "indexer.clear");
      expect(event).toMatchObject({ event: "indexer.clear", source: "api" });
    });

    it("emits indexer.clear before invoking onClear callbacks", async () => {
      const order: string[] = [];
      indexer.onClear("api", () => order.push("callback"));

      await indexer.clear("api");

      expect(captured.find((e) => e.event === "indexer.clear")).toBeDefined();
      expect(order).toContain("callback");
    });

    it("emits indexer.rebuild with source and durationMs when building from scratch", async () => {
      bm25.index([{ id: "doc1", fields: { title: "Roblox API" } }]);
      const builder = async () => {
        bm25.index([{ id: "doc2", fields: { title: "New Doc" } }]);
      };

      const freshBm25 = new BM25();
      await indexer.loadOrBuildIndex("api", freshBm25, builder);

      const event = captured.find((e) => e.event === "indexer.rebuild");
      expect(event).toMatchObject({ event: "indexer.rebuild", source: "api" });
      expect(typeof event?.durationMs).toBe("number");
    });

    it("does not emit indexer.rebuild when loading from persisted cache", async () => {
      bm25.index([{ id: "doc1", fields: { title: "Cached Doc" } }]);
      await indexer.save(bm25, "api");
      captured = [];

      const freshBm25 = new BM25();
      const builder = async () => {};
      await indexer.loadOrBuildIndex("api", freshBm25, builder);

      expect(captured.some((e) => e.event === "indexer.rebuild")).toBe(false);
    });

    it("emits exactly one indexer.clear per clear() call", async () => {
      await indexer.clear("api");

      expect(captured.filter((e) => e.event === "indexer.clear")).toHaveLength(1);
    });
  });
});
