import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BM25 } from "../../scraper/bm25.js";
import { Indexer } from "../indexer.js";
import { LmdbStore, createSyncStateManager } from "../index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Indexer", () => {
	let store: LmdbStore;
	let syncManager: any;
	let indexer: Indexer;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-idx-test-"));
		store = new LmdbStore({
			cacheDir: tempDir,
		});
		await store.open();
		syncManager = createSyncStateManager(store);
		indexer = new Indexer(store, syncManager);
	});

	afterEach(async () => {
		await store.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should serialize and restore a BM25 index", async () => {
		const bm25 = new BM25();
		const docs = [
			{ id: "doc1", fields: { title: "Hello World", path: "p1", description: "Desc 1", content: "Content 1" } },
			{ id: "doc2", fields: { title: "Roblox API", path: "p2", description: "Desc 2", content: "Content 2" } },
		];
		bm25.index(docs);
		
		const originalResults = bm25.search("Roblox");
		
		const serialized = bm25.serialize();
		const newBm25 = new BM25();
		newBm25.restore(serialized);
		
		const restoredResults = newBm25.search("Roblox");
		expect(restoredResults).toEqual(originalResults);
		expect(newBm25.indexedCount).toBe(2);
	});

	it("should save and load index from LMDB store", async () => {
		const sourceKey = "test-source";
		const bm25 = new BM25();
		const docs = [
			{ id: "doc1", fields: { title: "Persistence Test", path: "p1", description: "Desc 1", content: "Content 1" } },
		];
		bm25.index(docs);
		
		// Set a sync state to have a stable version key
		await syncManager.updateSourceState(sourceKey, { commitSha: "sha123" });
		
		await indexer.saveIndex(sourceKey, bm25);
		
		const newBm25 = new BM25();
		const { restored } = await indexer.loadIndex(sourceKey, newBm25);
		
		expect(restored).toBe(true);
		expect(newBm25.indexedCount).toBe(1);
		expect(newBm25.search("Persistence")[0].id).toBe("doc1");
	});

	it("should force rebuild when index is invalid or corrupt", async () => {
		const sourceKey = "corrupt-source";
		await syncManager.updateSourceState(sourceKey, { commitSha: "sha123" });
		
		// Manually put corrupt data at the index key
		const key = `idx:bm25:${sourceKey}:sha123`;
		await store.put(key, new Uint8Array([1, 2, 3, 4]));
		
		const bm25 = new BM25();
		const { restored, error } = await indexer.loadIndex(sourceKey, bm25);
		
		expect(restored).toBe(false);
		expect(error).toBeDefined();
		expect(error).toContain("Failed to restore index");
	});

	it("should loadOrBuildIndex: restore when available", async () => {
		const sourceKey = "avail-source";
		const bm25 = new BM25();
		const docs = [{ id: "doc1", fields: { title: "Fast", path: "p1", description: "D1", content: "C1" } }];
		bm25.index(docs);
		
		await syncManager.updateSourceState(sourceKey, { commitSha: "sha1" });
		await indexer.saveIndex(sourceKey, bm25);
		
		const newBm25 = new BM25();
		let buildCalled = false;
		const buildFn = async () => { buildCalled = true; };
		
		await indexer.loadOrBuildIndex(sourceKey, newBm25, buildFn);
		
		expect(buildCalled).toBe(false);
		expect(newBm25.indexedCount).toBe(1);
	});

	it("should loadOrBuildIndex: build when not available", async () => {
		const sourceKey = "missing-source";
		const bm25 = new BM25();
		
		let buildCalled = false;
		const buildFn = async () => { 
			buildCalled = true;
			bm25.index([{ id: "doc1", fields: { title: "New", path: "p1", description: "D1", content: "C1" } }]);
		};
		
		await indexer.loadOrBuildIndex(sourceKey, bm25, buildFn);
		
		expect(buildCalled).toBe(true);
		expect(bm25.indexedCount).toBe(1);
	});
});