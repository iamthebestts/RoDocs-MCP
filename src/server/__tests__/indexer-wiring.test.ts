import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetDevForumIndexForTesting,
  getCachedDevForumRecords,
  searchDevForumStore,
} from "../../devforum/search.js";
import type { DevForumRecord } from "../../devforum/types.js";
import { _resetFastFlagsIndexForTesting } from "../../fastflags/search.js";
import { _resetIndexesForTesting } from "../../search/index.js";
import type { IKeyValueStore, SyncStateManager } from "../../store/index.js";
import { createServer } from "../index.js";

function devForumRecord(id: number): DevForumRecord {
  return {
    id,
    title: "How to persist player data with DataStoreService",
    url: `https://devforum.roblox.com/t/${id}`,
    content: "Use DataStoreService to persist player data across sessions.",
    acceptedAnswer: "Use UpdateAsync for player data writes.",
    staffReplies: [],
    codeSnippets: ["DataStoreService:GetDataStore('PlayerData')"],
    tags: ["scripting", "data-store"],
    score: 82,
    source: "search:data store",
    lastSyncAt: 1_700_000_000,
  };
}

function createStubStore(): IKeyValueStore {
  const data = new Map<string, unknown>([["devforum:1", devForumRecord(1)]]);
  return {
    getPath: () => "/tmp/rodocs-wiring-test/store.db",
    open: async () => {},
    close: async () => {},
    keys: async () => [...data.keys()],
    countByPrefix: async (prefix: string) =>
      [...data.keys()].filter((k) => k.startsWith(prefix)).length,
    get: async (key: string) => data.get(key) ?? null,
    put: async () => {},
    del: async () => {},
    clear: async () => {},
  } as unknown as IKeyValueStore;
}

const stubSyncManager = {
  getSourceState: async () => null,
  updateSourceState: async () => {},
} as unknown as SyncStateManager;

describe("createServer indexer wiring", () => {
  beforeEach(() => {
    _resetDevForumIndexForTesting();
    _resetFastFlagsIndexForTesting();
    _resetIndexesForTesting();
  });

  it("wires the devforum singleton to the shared Indexer when store and syncManager are external (daemon path)", async () => {
    const store = createStubStore();
    const instance = createServer({
      store,
      syncManager: stubSyncManager,
      initializeStore: false,
      autoStartScheduler: false,
    });

    try {
      const response = await searchDevForumStore(store, { query: "data store" });

      // With the shared Indexer wired, the BM25 path builds the in-memory record
      // cache; the unwired fallback (full store scan) leaves it empty.
      expect(getCachedDevForumRecords().length).toBeGreaterThan(0);
      expect(response.results.length).toBeGreaterThan(0);
    } finally {
      instance.shutdown();
    }
  });
});
