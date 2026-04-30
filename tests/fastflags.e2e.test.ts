import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FastFlagScraper } from "../src/fastflags/scraper.js";
import { FastFlagSearch } from "../src/fastflags/search.js";
import { createSyncStateManager, LmdbStore } from "../src/store/index.js";
import { Indexer } from "../src/store/indexer.js";

const e2e = process.env.E2E === "true" ? describe : describe.skip;

vi.mock("axios");

e2e("FastFlags E2E", () => {
  let store: LmdbStore;
  let scraper: FastFlagScraper;
  let ffSearch: FastFlagSearch;
  let tempDir: string;

  const mockFlags = {
    FFlagTestExact: true,
    FFlagTestPrefix: false,
    DFIntTest: 123,
    SFFlagTest: true,
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-ff-e2e-"));
    store = new LmdbStore({ cacheDir: tempDir });
    await store.open();
    const syncManager = createSyncStateManager(store);
    const indexer = new Indexer(store, syncManager);
    scraper = new FastFlagScraper(store, syncManager, indexer);
    ffSearch = new FastFlagSearch(store);

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: [
          {
            name: "Test.json",
            type: "file",
            download_url: "http://example.com/Test.json",
            sha: "sha1",
          },
        ],
      })
      .mockResolvedValueOnce({ data: mockFlags });

    await scraper.seed();
  });

  afterAll(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should search flags with ranking", async () => {
    const results = await ffSearch.search({ query: "Test" });

    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("should find by exact name", async () => {
    const results = await ffSearch.search({ query: "FFlagTestExact" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("FFlagTestExact");
  });

  it("should filter by kind", async () => {
    const results = await ffSearch.search({ kind: "FInt" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("DFIntTest");
  });

  it("should filter by behavior", async () => {
    const results = await ffSearch.search({ behavior: "Synchronized" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("SFFlagTest");
  });

  it("should respect limit", async () => {
    const results = await ffSearch.search({ limit: 1 });
    expect(results).toHaveLength(1);
  });
});
