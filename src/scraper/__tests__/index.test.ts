import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const disk = {
    get: vi.fn(),
    set: vi.fn(),
  };

  class DiskCacheMock {
    get = disk.get;
    set = disk.set;
  }

  const logEvents: Array<{ event: string; strategy?: string; key?: string }> = [];

  const state = {
    disk,
    diskCtor: DiskCacheMock,
    fetchIndex: vi.fn(),
    fetchTopic: vi.fn(),
    findClosestMatch: vi.fn(),
    logEvents,
    observe: vi.fn((e: { event: string; strategy?: string; key?: string }) => logEvents.push(e)),
    startTimer: vi.fn(() => () => 0),
  };

  return state;
});

vi.mock("../fetch.js", () => ({
  fetchIndex: mockState.fetchIndex,
  fetchTopic: mockState.fetchTopic,
  findClosestMatch: mockState.findClosestMatch,
}));

vi.mock("../disk-cache.js", () => ({
  DiskCache: mockState.diskCtor,
}));

vi.mock("../../utils/logger.js", () => ({
  observe: mockState.observe,
  startTimer: mockState.startTimer,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  _setLogEventSinkForTesting: vi.fn(),
}));

async function loadScraper() {
  return import("../index.js");
}

describe("scraper index", () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockState.disk.get.mockReset();
    mockState.disk.set.mockReset();
    mockState.fetchIndex.mockReset();
    mockState.fetchTopic.mockReset();
    mockState.findClosestMatch.mockReset();
    mockState.logEvents.length = 0;
    mockState.observe.mockClear();
    mockState.startTimer.mockReturnValue(() => 0);
    mockState.findClosestMatch.mockImplementation((query: string, names: string[]) => {
      const lower = query.toLowerCase();
      const exact = names.find((name) => name.toLowerCase() === lower);
      if (exact !== undefined) return exact;
      const startsWith = names.find((name) => name.toLowerCase().startsWith(lower));
      if (startsWith !== undefined) return startsWith;
      const contains = names.find((name) => name.toLowerCase().includes(lower));
      return contains ?? null;
    });
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  it("returns disk hits without fetching the topic again", async () => {
    const entry = {
      class: {
        name: "DataStoreService",
        summary: "",
        description: "",
        inherits: [],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [],
        ownMembers: {
          properties: [],
          methods: [],
          events: [],
          callbacks: [],
        },
      },
      inheritedMembers: [],
    };

    mockState.fetchIndex.mockResolvedValue({
      classes: ["DataStoreService"],
      datatypes: [],
      enums: [],
      globals: [],
      libraries: [],
    });
    mockState.disk.get.mockResolvedValue(entry);

    const { scrapeTopic } = await loadScraper();

    const result = await scrapeTopic("DataStoreService");
    const again = await scrapeTopic("DataStoreService");

    expect(result.ok).toBe(true);
    expect(result.entry).toBe(entry);
    expect(again.entry).toBe(entry);
    expect(mockState.fetchTopic).not.toHaveBeenCalled();
    expect(mockState.disk.set).not.toHaveBeenCalled();
    expect(mockState.fetchIndex).toHaveBeenCalledTimes(1);
    expect(mockState.disk.get).toHaveBeenCalledTimes(1);
  });

  it("caches canonical names after a network fetch", async () => {
    const entry = {
      class: {
        name: "DataStoreService",
        summary: "",
        description: "",
        inherits: [],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [],
        ownMembers: {
          properties: [],
          methods: [],
          events: [],
          callbacks: [],
        },
      },
      inheritedMembers: [],
    };

    mockState.fetchIndex.mockResolvedValue({
      classes: ["DataStoreService"],
      datatypes: [],
      enums: [],
      globals: [],
      libraries: [],
    });
    mockState.fetchTopic.mockResolvedValue(entry);
    mockState.disk.get.mockResolvedValue(undefined);
    mockState.disk.set.mockResolvedValue(undefined);

    const { scrapeTopic } = await loadScraper();

    const result = await scrapeTopic("datastore");
    const cached = await scrapeTopic("DataStoreService");

    expect(result.ok).toBe(true);
    expect(cached.entry).toBe(entry);
    expect(mockState.fetchIndex).toHaveBeenCalledTimes(1);
    expect(mockState.fetchTopic).toHaveBeenCalledTimes(1);
    expect(mockState.fetchTopic).toHaveBeenCalledWith("datastore", undefined);
    expect(mockState.disk.get).toHaveBeenCalledTimes(1);
    expect(mockState.disk.set).toHaveBeenCalledWith("datastore", entry);
    expect(mockState.disk.set).toHaveBeenCalledWith("DataStoreService", entry);
  });

  it("returns errors from scrapeMany without changing order", async () => {
    const entry = {
      class: {
        name: "Good",
        summary: "",
        description: "",
        inherits: [],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [],
        ownMembers: {
          properties: [],
          methods: [],
          events: [],
          callbacks: [],
        },
      },
      inheritedMembers: [],
    };

    mockState.fetchIndex.mockResolvedValue({
      classes: ["Good"],
      enums: [],
    });
    mockState.disk.get.mockResolvedValue(undefined);
    mockState.disk.set.mockResolvedValue(undefined);
    mockState.fetchTopic.mockImplementation(async (topic: string) => {
      if (topic === "Bad") throw new Error("boom");
      return entry;
    });

    const { scrapeMany } = await loadScraper();
    const results = await scrapeMany(["Good", "Bad"]);

    expect(results[0]).toMatchObject({ ok: true, topic: "Good" });
    expect(results[1]).toMatchObject({
      ok: false,
      topic: "Bad",
      error: "boom",
    });
  });

  it("finds the closest api name from a cached index", async () => {
    mockState.fetchIndex.mockResolvedValue({
      classes: ["DataStoreService", "RunService"],
      datatypes: ["Vector3"],
      enums: ["KeyCode"],
      globals: [],
      libraries: [],
    });

    const { findClosestApiName } = await loadScraper();

    await expect(findClosestApiName("datastore")).resolves.toBe("DataStoreService");
    await expect(findClosestApiName("run")).resolves.toBe("RunService");
    await expect(findClosestApiName("vector")).resolves.toBe("Vector3");
    expect(mockState.fetchIndex).toHaveBeenCalledTimes(1);
  });

  it("passes an explicit github token to scrapeIndex", async () => {
    mockState.fetchIndex.mockResolvedValue({
      classes: ["Actor"],
      datatypes: [],
      enums: ["KeyCode"],
      globals: [],
      libraries: [],
    });

    const { scrapeIndex } = await loadScraper();

    await expect(scrapeIndex("pat-123")).resolves.toEqual({
      ok: true,
      classes: ["Actor"],
      datatypes: [],
      enums: ["KeyCode"],
      globals: [],
      libraries: [],
    });
    expect(mockState.fetchIndex).toHaveBeenCalledWith("pat-123");
  });

  it("falls back to GITHUB_TOKEN for scrapeTopic", async () => {
    process.env.GITHUB_TOKEN = "env-token";

    const entry = {
      class: {
        name: "Actor",
        summary: "",
        description: "",
        inherits: [],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [],
        ownMembers: {
          properties: [],
          methods: [],
          events: [],
          callbacks: [],
        },
      },
      inheritedMembers: [],
    };

    mockState.fetchIndex.mockResolvedValue({
      classes: ["Actor"],
      datatypes: [],
      enums: [],
      globals: [],
      libraries: [],
    });
    mockState.fetchTopic.mockResolvedValue(entry);
    mockState.disk.get.mockResolvedValue(undefined);
    mockState.disk.set.mockResolvedValue(undefined);

    const { scrapeTopic } = await loadScraper();

    await expect(scrapeTopic("Actor")).resolves.toMatchObject({
      ok: true,
      topic: "Actor",
      entry,
    });
    expect(mockState.fetchIndex).toHaveBeenCalledWith("env-token");
  });

  describe("fallback chain observability", () => {
    const entry = {
      class: {
        name: "DataStoreService",
        summary: "",
        description: "",
        inherits: [],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [],
        ownMembers: { properties: [], methods: [], events: [], callbacks: [] },
      },
      inheritedMembers: [],
    };

    beforeEach(() => {
      mockState.fetchIndex.mockResolvedValue({
        classes: ["DataStoreService"],
        datatypes: [],
        enums: [],
        globals: [],
        libraries: [],
      });
    });

    it("does not emit scraper.fallback on L1 memory hit", async () => {
      mockState.disk.get.mockResolvedValue(undefined);
      mockState.disk.set.mockResolvedValue(undefined);
      mockState.fetchTopic.mockResolvedValue(entry);

      const { scrapeTopic } = await loadScraper();
      // first call: network fetch (warms L1)
      await scrapeTopic("DataStoreService");
      mockState.logEvents.length = 0;
      mockState.observe.mockClear();

      // second call: L1 hit — no fallback event
      await scrapeTopic("DataStoreService");

      const fallbacks = mockState.logEvents.filter((e) => e.event === "scraper.fallback");
      expect(fallbacks).toHaveLength(0);
    });

    it("emits scraper.fallback with strategy=disk on L2 hit", async () => {
      mockState.disk.get.mockResolvedValue(entry);

      const { scrapeTopic } = await loadScraper();
      await scrapeTopic("DataStoreService");

      const fallback = mockState.logEvents.find((e) => e.event === "scraper.fallback");
      expect(fallback).toMatchObject({
        event: "scraper.fallback",
        source: "scraper",
        key: "DataStoreService",
        strategy: "disk",
      });
    });

    it("emits scraper.fallback with strategy=network on full cache miss", async () => {
      mockState.disk.get.mockResolvedValue(undefined);
      mockState.disk.set.mockResolvedValue(undefined);
      mockState.fetchTopic.mockResolvedValue(entry);

      const { scrapeTopic } = await loadScraper();
      await scrapeTopic("DataStoreService");

      const fallback = mockState.logEvents.find((e) => e.event === "scraper.fallback");
      expect(fallback).toMatchObject({
        event: "scraper.fallback",
        source: "scraper",
        strategy: "network",
      });
    });

    it("emits exactly one scraper.fallback per call", async () => {
      mockState.disk.get.mockResolvedValue(undefined);
      mockState.disk.set.mockResolvedValue(undefined);
      mockState.fetchTopic.mockResolvedValue(entry);

      const { scrapeTopic } = await loadScraper();
      await scrapeTopic("DataStoreService");

      const fallbacks = mockState.logEvents.filter((e) => e.event === "scraper.fallback");
      expect(fallbacks).toHaveLength(1);
    });
  });
});
