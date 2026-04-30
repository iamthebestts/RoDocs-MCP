import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncStateManager, LmdbStore, type SyncStateManager } from "../../store/index.js";
import { Indexer } from "../../store/indexer.js";
import { enrichFastFlag } from "../enricher.js";
import { normalizeFastFlag } from "../parser.js";
import { FastFlagScraper } from "../scraper.js";

vi.mock("axios");

describe("FastFlags Module", () => {
  let store: LmdbStore;
  let syncManager: SyncStateManager;
  let scraper: FastFlagScraper;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-ff-test-"));
    store = new LmdbStore({ cacheDir: tempDir });
    await store.open();
    syncManager = createSyncStateManager(store);
    const indexer = new Indexer(store, syncManager);
    scraper = new FastFlagScraper(store, syncManager, indexer);
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
      const enriched = enrichFastFlag({
        ...normalized,
        platforms: ["pc"],
        targets: ["PCClient"],
        sources: [{ target: "PCClient", url: "http://example.com" }],
      });

      expect(enriched.kind).toBe("FFlag");
      expect(enriched.behavior).toBe("Fast");
      expect(enriched.name).toBe("FFlagTest");
    });

    it("should correctly infer Dynamic flags", () => {
      const raw = { name: "DFIntTest", value: 123 };
      const normalized = normalizeFastFlag(raw);
      const enriched = enrichFastFlag({
        ...normalized,
        platforms: ["pc"],
        targets: ["PCClient"],
        sources: [{ target: "PCClient", url: "http://example.com" }],
      });

      expect(enriched.kind).toBe("FInt");
      expect(enriched.behavior).toBe("Dynamic");
    });

    it("should correctly infer Synchronized flags", () => {
      const raw = { name: "SFFlagTest", value: false };
      const normalized = normalizeFastFlag(raw);
      const enriched = enrichFastFlag({
        ...normalized,
        platforms: ["pc"],
        targets: ["PCClient"],
        sources: [{ target: "PCClient", url: "http://example.com" }],
      });

      expect(enriched.kind).toBe("FFlag");
      expect(enriched.behavior).toBe("Synchronized");
    });

    it("should handle Unknown types", () => {
      const raw = { name: "UnknownFlag", value: "something" };
      const normalized = normalizeFastFlag(raw);
      const enriched = enrichFastFlag({
        ...normalized,
        platforms: ["pc"],
        targets: ["PCClient"],
        sources: [{ target: "PCClient", url: "http://example.com" }],
      });

      expect(enriched.kind).toBe("Unknown");
      expect(enriched.behavior).toBe("Unknown");
    });
  });

  describe("Scraper", () => {
    it("should seed flags from files", async () => {
      const mockItems = [
        {
          name: "PCClient.json",
          type: "file",
          download_url: "http://example.com/PCClient.json",
          sha: "sha1",
        },
        { name: "README.md", type: "file", download_url: null },
      ];
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: mockItems }) // Discovery
        .mockResolvedValueOnce({ data: [{ name: "FFlag1", value: true }] }); // Download

      const { added } = await scraper.seed();

      expect(added).toBe(1);
      expect(await store.get("fastflags:FFlag1")).toBeDefined();
    });

    it("should track sync state per file", async () => {
      const mockItems = [
        {
          name: "PCClient.json",
          type: "file",
          download_url: "http://example.com/PCClient.json",
          sha: "sha1",
        },
      ];
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: mockItems }) // Discovery
        .mockResolvedValueOnce({ data: [{ name: "FFlag1", value: true }] }); // Download

      await scraper.seed();

      const state = await syncManager.getSourceState("fastflags:PCClient.json");
      expect(state?.etag).toBe("sha1");
    });
  });
});
