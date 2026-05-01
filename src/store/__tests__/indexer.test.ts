import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BM25 } from "../../search/bm25.js";
import { LmdbStore, SyncStateManager } from "../index.js";
import { Indexer } from "../indexer.js";

describe("Indexer", () => {
  let indexer: Indexer;
  let bm25: BM25;
  let tempDir: string;
  let store: LmdbStore;
  let syncManager: SyncStateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-indexer-test-"));
    store = new LmdbStore({ cacheDir: tempDir });
    await store.open();
    syncManager = new SyncStateManager(store);
    indexer = new Indexer(store, syncManager);
    bm25 = new BM25();
  });

  afterEach(async () => {
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
});
