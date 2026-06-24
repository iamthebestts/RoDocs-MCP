import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevForumPipeline } from "../../devforum/pipeline.js";
import type { FastFlagScraper } from "../../fastflags/scraper.js";
import type { IKeyValueStore } from "../../store/store-interface.js";
import { runDevforumSeed } from "../runners.js";

vi.mock("../../embedding/embedder.js", () => ({
  embed: vi.fn().mockResolvedValue([new Float32Array(384).fill(0.1)]),
}));

vi.mock("../../embedding/sources.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../embedding/sources.js")>();
  return {
    ...actual,
    buildDevforumEmbedDocs: vi
      .fn()
      .mockResolvedValue([{ id: "devforum:1", source: "devforum", text: "topic content" }]),
  };
});

function makeStoreWithDb(): IKeyValueStore & { getDb(): Database.Database } {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`
    CREATE VIRTUAL TABLE vec_items USING vec0(
      id TEXT PRIMARY KEY,
      source TEXT,
      embedding FLOAT[384]
    )
  `);
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(
    "devforum:1",
    JSON.stringify({ id: 1, title: "t", content: "body" }),
  );

  return {
    getPath: () => "/tmp/store.db",
    get: async <T>(key: string): Promise<T | null> => {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row ? (JSON.parse(row.value) as T) : null;
    },
    put: async () => {},
    del: async () => {},
    keys: async () => ["devforum:1"],
    countByPrefix: async (prefix: string) => (prefix === "devforum:" ? 1 : 0),
    clear: async () => {},
    open: async () => {},
    close: async () => {
      db.close();
    },
    isOpen: () => true,
    getDb: () => db,
  };
}

describe("runDevforumSeed embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs embeddings when added=0 but vec rows are missing", async () => {
    const store = makeStoreWithDb();
    const syncManager = {
      states: new Map<string, unknown>(),
      async getSourceState(key: string) {
        return (this.states.get(key) as null) ?? null;
      },
      async updateSourceState(key: string, state: unknown) {
        this.states.set(key, state);
      },
    };

    const pipeline = {
      seed: vi.fn().mockResolvedValue({
        added: 0,
        lowScore: 0,
        failed: 0,
        rejected: 0,
        bm25Invalidated: false,
        discoveryFromCache: true,
      }),
    } as unknown as DevForumPipeline;

    const { EmbeddingIndexer } = await import("../../embedding/embedding-indexer.js");
    const embeddingIndexer = new EmbeddingIndexer(store, store.getDb());

    await runDevforumSeed({
      store,
      syncManager,
      githubToken: undefined,
      embeddingIndexer,
      fastFlagScraper: {} as FastFlagScraper,
      devForumPipeline: pipeline,
    });

    const rows = store.getDb().prepare("SELECT COUNT(*) AS count FROM vec_items").get() as {
      count: number;
    };
    expect(rows.count).toBe(1);
    store.close();
  });
});
