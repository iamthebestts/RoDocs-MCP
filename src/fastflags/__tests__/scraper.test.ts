import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LmdbStore } from "../../store/index.js";
import { createSyncStateManager } from "../../store/index.js";
import { FastFlagScraper } from "../scraper.js";
import { normalizeFastFlag } from "../parser.js";
import { enrichFastFlag } from "../enricher.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import axios from "axios";

vi.mock("axios");

describe("FastFlags Module", () => {
	let store: LmdbStore;
	let syncManager: any;
	let scraper: FastFlagScraper;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "rodocs-ff-test-"));
		store = new LmdbStore({ cacheDir: tempDir });
		await store.open();
		syncManager = createSyncStateManager(store);
		scraper = new FastFlagScraper(store, syncManager);
	});

	afterEach(async () => {
		await store.close();
		await rm(tempDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	describe("Parser & Enricher", () => {
		it("should normalize and enrich a standard FFlag", () => {
			const raw = { name: "FFlagTest", value: true, description: "Test flag" };
			const normalized = normalizeFastFlag(raw);
			const enriched = enrichFastFlag(normalized);
			
			expect(enriched.kind).toBe("FFlag");
			expect(enriched.behavior).toBe("Fast");
			expect(enriched.name).toBe("FFlagTest");
		});

		it("should correctly infer Dynamic flags", () => {
			const raw = { name: "DFIntTest", value: 123 };
			const normalized = normalizeFastFlag(raw);
			const enriched = enrichFastFlag(normalized);
			
			expect(enriched.kind).toBe("FInt");
			expect(enriched.behavior).toBe("Dynamic");
		});

		it("should correctly infer Synchronized flags", () => {
			const raw = { name: "SFFlagTest", value: false };
			const normalized = normalizeFastFlag(raw);
			const enriched = enrichFastFlag(normalized);
			
			expect(enriched.kind).toBe("FFlag");
			expect(enriched.behavior).toBe("Synchronized");
		});

		it("should handle Unknown types", () => {
			const raw = { name: "UnknownFlag", value: "something" };
			const normalized = normalizeFastFlag(raw);
			const enriched = enrichFastFlag(normalized);
			
			expect(enriched.kind).toBe("Unknown");
			expect(enriched.behavior).toBe("Unknown");
		});
	});

	describe("Scraper", () => {
		it("should seed flags from array source", async () => {
			const mockData = [
				{ name: "FFlag1", value: true },
				{ name: "DFInt1", value: 100 },
			];
			(axios.get as any).mockResolvedValue({ data: mockData });

			const { added, updated } = await scraper.seed("http://example.com/flags.json");
			
			expect(added).toBe(2);
			expect(await store.get("fastflags:FFlag1")).toBeDefined();
			expect((await store.get("fastflags:DFInt1"))?.kind).toBe("FInt");
		});

		it("should seed flags from object source", async () => {
			const mockData = {
				"FFlag1": true,
				"DFInt1": 100,
			};
			(axios.get as any).mockResolvedValue({ data: mockData });

			const { added, updated } = await scraper.seed("http://example.com/flags.json");
			
			expect(added).toBe(2);
			expect(await store.get("fastflags:FFlag1")).toBeDefined();
		});

		it("should retry on 503 error", async () => {
			const errorResponse = {
				response: { status: 503 },
				isAxiosError: true,
			};
			(axios.get as any)
				.mockRejectedValueOnce(errorResponse)
				.mockResolvedValueOnce({ data: [{ name: "FFlag1", value: true }] });

			const { added } = await scraper.seed("http://example.com/flags.json");
			
			expect(added).toBe(1);
			expect(axios.get).toHaveBeenCalledTimes(2);
		});

		it("should fail after max retries", async () => {
			const errorResponse = {
				response: { status: 503 },
				isAxiosError: true,
			};
			(axios.get as any).mockRejectedValue(errorResponse);

			await expect(scraper.seed("http://example.com/flags.json")).rejects.toThrow();
			expect(axios.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
		});

		it("should track sync state", async () => {
			(axios.get as any).mockResolvedValue({ data: [] });
			await scraper.seed("http://example.com/flags.json");
			
			const state = await syncManager.getSourceState("fastflags");
			expect(state?.lastSyncAt).toBeDefined();
		});
	});
});
