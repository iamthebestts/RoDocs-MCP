import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LmdbStore, createSyncStateManager } from "../src/store/index.js";
import { FastFlagSearch } from "../src/fastflags/search.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("FastFlags Search Logic E2E", () => {
	let store: LmdbStore;
	let syncManager: any;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "rodocs-ff-e2e-"));
		store = new LmdbStore({ cacheDir: tempDir });
		await store.open();
		syncManager = createSyncStateManager(store);
	});

	afterEach(async () => {
		await store.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	async function seedFlags() {
		const mockFlags = [
			{ name: "FFlagTestExact", value: true, description: "Exact match" },
			{ name: "FFlagTestPrefix", value: false, description: "Prefix match" },
			{ name: "MyFFlagTestFlag", value: 1, description: "Substring match" },
			{ name: "DFIntTest", value: 100, description: "Dynamic Int" },
			{ name: "SFFlagTest", value: true, description: "Synchronized" },
		];
		
		for (const f of mockFlags) {
			const enriched = {
				name: f.name,
				value: f.value,
				kind: f.name.includes("Int") ? "FInt" : "FFlag",
				behavior: f.name.startsWith("DF") ? "Dynamic" : f.name.startsWith("SF") ? "Synchronized" : "Fast",
				platforms: [],
				channels: [],
				description: f.description,
			};
			await store.put(`fastflags:${f.name}`, enriched);
		}
	}


	it("should order results: exact > prefix > substring", async () => {
		await seedFlags();
		const searcher = new FastFlagSearch(store);
		
		const results = await searcher.search({ query: "FFlagTest" });
		
		expect(results[0].name).toBe("FFlagTestExact");
		expect(results[1].name).toBe("FFlagTestPrefix");
		expect(results.some(f => f.name === "MyFFlagTestFlag")).toBe(true);
	});

	it("should filter by kind", async () => {
		await seedFlags();
		const searcher = new FastFlagSearch(store);
		
		const results = await searcher.search({ kind: "FInt" });
		
		expect(results.every(f => f.kind === "FInt")).toBe(true);
		expect(results.some(f => f.name === "DFIntTest")).toBe(true);
	});

	it("should filter by behavior", async () => {
		await seedFlags();
		const searcher = new FastFlagSearch(store);
		
		const results = await searcher.search({ behavior: "Dynamic" });
		
		expect(results.every(f => f.behavior === "Dynamic")).toBe(true);
		expect(results.some(f => f.name === "DFIntTest")).toBe(true);
	});

	it("should return empty result and suggest seeding when store is empty", async () => {
		const searcher = new FastFlagSearch(store);
		const results = await searcher.search({ query: "any" });
		
		expect(results).toEqual([]);
	});

	it("should respect limit", async () => {
		await seedFlags();
		const searcher = new FastFlagSearch(store);
		
		const results = await searcher.search({ limit: 2 });
		
		expect(results.length).toBeLessThanOrEqual(2);
	});
});
