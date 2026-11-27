import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IKeyValueStore } from "../../store/store-interface.js";
import {
  createEmbeddingIndexer,
  createSeedSourceRunners,
  type SeedRunnersDeps,
} from "../runners.js";

function makeStore(withDb = false): IKeyValueStore {
  const base = {
    getPath: () => "/tmp/store.db",
    get: async () => null,
    put: async () => {},
    del: async () => {},
    keys: async () => [],
    countByPrefix: async () => 0,
    clear: async () => {},
    open: async () => {},
    close: async () => undefined,
    isOpen: () => true,
  };
  if (!withDb) return base;
  return {
    ...base,
    getDb: () => {
      throw new Error("db unavailable in test");
    },
  } as IKeyValueStore & { getDb(): unknown };
}

describe("seed runners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createEmbeddingIndexer() returns null when store has no getDb", () => {
    expect(createEmbeddingIndexer(makeStore(false))).toBeNull();
  });

  it("createSeedSourceRunners() returns one runner per source with honest one-shot batch sizes", () => {
    const runBatch = vi.fn();
    const deps: SeedRunnersDeps = {
      store: makeStore(),
      githubToken: undefined,
      embeddingIndexer: null,
      fastFlagScraper: { seed: vi.fn() } as unknown as SeedRunnersDeps["fastFlagScraper"],
      devForumPipeline: { seed: vi.fn() } as unknown as SeedRunnersDeps["devForumPipeline"],
    };

    const runners = createSeedSourceRunners(deps);
    expect(runners.map((r) => r.source)).toEqual(["docs", "guides", "fastflags", "devforum"]);
    for (const runner of runners) {
      expect(runner.batchSize).toBe(runner.estimatedTotal);
    }
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("defers embeddings out of runBatch in createSeedSourceRunners()", async () => {
    const indexSource = vi.fn().mockResolvedValue(1);
    const seedFastflagsMock = vi.fn().mockResolvedValue({ added: 5, updated: 0 });
    const deps: SeedRunnersDeps = {
      store: makeStore(),
      githubToken: undefined,
      embeddingIndexer: { indexSource } as unknown as SeedRunnersDeps["embeddingIndexer"],
      fastFlagScraper: {
        seed: seedFastflagsMock,
      } as unknown as SeedRunnersDeps["fastFlagScraper"],
      devForumPipeline: { seed: vi.fn() } as unknown as SeedRunnersDeps["devForumPipeline"],
    };

    const runners = createSeedSourceRunners(deps);
    const ffRunner = runners.find((r) => r.source === "fastflags");
    expect(ffRunner).toBeDefined();

    await ffRunner?.runBatch({ source: "fastflags", batchSize: 12 });

    expect(seedFastflagsMock).toHaveBeenCalledTimes(1);
    expect(indexSource).not.toHaveBeenCalled();
  });
});
