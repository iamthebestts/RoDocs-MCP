import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevForumRecord } from "../../devforum/types.js";
import type { FastFlag } from "../../fastflags/parser.js";
import type { LmdbStore } from "../../store/index.js";
import { robloxSearch } from "../roblox-search.js";

const searchState = vi.hoisted(() => ({
  searchApisLocal: vi.fn(),
  searchGuidesLocal: vi.fn(),
}));

vi.mock("../../scraper/search.js", () => ({
  searchApisLocal: searchState.searchApisLocal,
  searchGuidesLocal: searchState.searchGuidesLocal,
}));

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

function flag(name: string, description = "Controls a data store experiment"): FastFlag {
  return {
    name,
    value: true,
    valuesByTarget: undefined,
    kind: "FFlag",
    behavior: "Fast",
    platforms: ["Windows"],
    targets: ["PCClient"],
    sources: [{ target: "PCClient", url: "https://example.test/flags.json" }],
    ...(description ? { description } : {}),
  };
}

function devForumRecord(
  id: number,
  title: string,
  content: string,
  acceptedAnswer: string | undefined = "Use UpdateAsync for player data writes.",
): DevForumRecord {
  return {
    id,
    title,
    url: `https://devforum.roblox.com/t/${id}`,
    content,
    acceptedAnswer,
    staffReplies: [],
    codeSnippets: ["DataStoreService:GetDataStore('PlayerData')"],
    tags: ["scripting", "data-store"],
    score: 82,
    source: "search:data store",
    lastSyncAt: 1_700_000_000,
  };
}

describe("robloxSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchState.searchApisLocal.mockResolvedValue([
      {
        type: "api",
        name: "DataStoreService",
        path: "classes/DataStoreService",
        score: 20,
        category: "class",
      },
    ]);
    searchState.searchGuidesLocal.mockResolvedValue([
      {
        type: "guide",
        name: "cloud-services/data-stores.md",
        path: "cloud-services/data-stores.md",
        score: 15,
        category: "cloud-services",
        title: "Data Stores",
      },
    ]);
  });

  it("searches only docs when source is docs", async () => {
    const store = asStore(new MemoryStore());
    const result = await robloxSearch(store, { query: "data store", source: "docs", limit: 2 });

    expect(searchState.searchApisLocal).toHaveBeenCalledWith("data store", 2);
    expect(searchState.searchGuidesLocal).not.toHaveBeenCalled();
    expect(result.results.docs).toHaveLength(1);
    expect(result.results.guides).toHaveLength(0);
    expect(result.results.fastflags).toHaveLength(0);
    expect(result.results.devforum).toHaveLength(0);
  });

  it("searches only local FastFlags when source is fastflags", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["fastflags:FFlagDataStoreExperiment", flag("FFlagDataStoreExperiment")],
          ["fastflags:FFlagOther", flag("FFlagOther")],
        ]),
      ),
    );

    const result = await robloxSearch(store, {
      query: "DataStore",
      source: "fastflags",
      limit: 5,
    });

    expect(searchState.searchApisLocal).not.toHaveBeenCalled();
    expect(searchState.searchGuidesLocal).not.toHaveBeenCalled();
    expect(result.results.fastflags).toEqual([
      expect.objectContaining({
        name: "FFlagDataStoreExperiment",
        kind: "FFlag",
        behavior: "Fast",
      }),
    ]);
  });

  it("searches only local DevForum records when source is devforum", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          [
            "devforum:101",
            devForumRecord(101, "Saving player data with DataStoreService", "Data store guide"),
          ],
          ["devforum:102", devForumRecord(102, "Remote events", "Networking guide")],
        ]),
      ),
    );

    const result = await robloxSearch(store, {
      query: "DataStoreService",
      source: "devforum",
      limit: 1,
    });

    expect(searchState.searchApisLocal).not.toHaveBeenCalled();
    expect(searchState.searchGuidesLocal).not.toHaveBeenCalled();
    expect(result.results.devforum).toHaveLength(1);
    expect(result.results.devforum[0]).toMatchObject({
      id: 101,
      title: "Saving player data with DataStoreService",
    });
    expect(result.results.devforum[0]?.contentSnippet?.length).toBeLessThanOrEqual(360);
  });

  it("searches all sources and groups results", async () => {
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["fastflags:FFlagDataStoreExperiment", flag("FFlagDataStoreExperiment")],
          [
            "devforum:101",
            devForumRecord(101, "Saving player data with DataStoreService", "Data store guide"),
          ],
        ]),
      ),
    );

    const result = await robloxSearch(store, {
      query: "DataStore",
      source: "all",
      limit: 3,
      githubToken: "pat-123",
    });

    expect(searchState.searchApisLocal).toHaveBeenCalledWith("DataStore", 3);
    expect(searchState.searchGuidesLocal).toHaveBeenCalledWith("DataStore", 3);
    expect(result.results.docs).toHaveLength(1);
    expect(result.results.guides).toHaveLength(1);
    expect(result.results.fastflags).toHaveLength(1);
    expect(result.results.devforum).toHaveLength(1);
  });

  it("returns empty groups and setup messages when local stores are empty", async () => {
    const store = asStore(new MemoryStore());
    const result = await robloxSearch(store, {
      query: "anything",
      source: "all",
      limit: 10,
    });

    expect(result.results.fastflags).toEqual([]);
    expect(result.results.devforum).toEqual([]);
    expect(result.messages).toEqual([
      "No local FastFlags found. Seed FastFlags before searching this source.",
      "No local DevForum records found. Seed DevForum before searching this source.",
    ]);
  });

  it("defaults to all sources, clamps per-source limits, and truncates long DevForum content", async () => {
    const longContent = `${"DataStore ".repeat(80)}final detail`;
    const recordWithoutAnswer = devForumRecord(101, "DataStore troubleshooting", longContent);
    recordWithoutAnswer.acceptedAnswer = undefined;
    const store = asStore(
      new MemoryStore(
        new Map<string, unknown>([
          ["fastflags:FFlagDataStoreExperiment", flag("FFlagDataStoreExperiment", "")],
          ["devforum:101", recordWithoutAnswer],
        ]),
      ),
    );

    const result = await robloxSearch(store, {
      query: "DataStore",
      limit: 999,
    });

    expect(searchState.searchApisLocal).toHaveBeenCalledWith("DataStore", 50);
    expect(searchState.searchGuidesLocal).toHaveBeenCalledWith("DataStore", 50);
    expect(result.source).toBe("all");
    expect(result.limit).toBe(50);
    expect(result.results.fastflags[0]).not.toHaveProperty("description");
    expect(result.results.devforum[0]?.contentSnippet).toMatch(/\.\.\.$/);
    expect(result.results.devforum[0]).not.toHaveProperty("acceptedAnswerSnippet");
  });
});
