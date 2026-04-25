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

  const state = {
    disk,
    diskCtor: DiskCacheMock,
    fetchIndex: vi.fn(),
    fetchTopic: vi.fn(),
    findClosestMatch: vi.fn(),
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
      enums: [],
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
      enums: [],
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
    expect(mockState.fetchTopic).toHaveBeenCalledWith("datastore");
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
      enums: ["KeyCode"],
    });

    const { findClosestApiName } = await loadScraper();

    await expect(findClosestApiName("datastore")).resolves.toBe("DataStoreService");
    await expect(findClosestApiName("run")).resolves.toBe("RunService");
    expect(mockState.fetchIndex).toHaveBeenCalledTimes(1);
  });

  it("passes an explicit github token to scrapeIndex", async () => {
    mockState.fetchIndex.mockResolvedValue({
      classes: ["Actor"],
      enums: ["KeyCode"],
    });

    const { scrapeIndex } = await loadScraper();

    await expect(scrapeIndex("pat-123")).resolves.toEqual({
      ok: true,
      classes: ["Actor"],
      enums: ["KeyCode"],
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
      enums: [],
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
});
