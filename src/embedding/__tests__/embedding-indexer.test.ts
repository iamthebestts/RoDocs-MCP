import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedDoc } from "../../types/index.js";

vi.mock("../embedder.js", () => ({
  embed: vi.fn(),
}));

import { embed } from "../embedder.js";
import { EmbeddingIndexer } from "../embedding-indexer.js";

const mockEmbed = vi.mocked(embed);

function makeInMemoryStore() {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      id TEXT PRIMARY KEY,
      source TEXT,
      embedding FLOAT[384]
    )
  `);
  const storeMock = {
    getPath: () => ":memory:",
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    countByPrefix: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    isOpen: () => true,
  };
  return { db, storeMock };
}

describe("EmbeddingIndexer", () => {
  let indexer: EmbeddingIndexer;
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    const { db: testDb, storeMock } = makeInMemoryStore();
    db = testDb;
    indexer = new EmbeddingIndexer(
      storeMock as unknown as import("../../store/store-interface.js").IKeyValueStore,
      db,
    );
  });

  afterEach(() => {
    db.close();
  });

  it("indexSource() inserts one row per doc", async () => {
    const docs: EmbedDoc[] = [
      { id: "doc1", source: "docs", text: "Hello world" },
      { id: "doc2", source: "docs", text: "Roblox scripting" },
    ];
    mockEmbed.mockResolvedValue([new Float32Array(384).fill(0.1), new Float32Array(384).fill(0.2)]);

    await indexer.indexSource("docs", docs);

    const rows = db.prepare("SELECT id FROM vec_items").all();
    expect(rows).toHaveLength(2);
  });

  it("clearSource() removes only rows for that source", async () => {
    const docs: EmbedDoc[] = [
      { id: "a", source: "docs", text: "doc a" },
      { id: "b", source: "guides", text: "guide b" },
    ];
    mockEmbed
      .mockResolvedValueOnce([new Float32Array(384).fill(0.1)])
      .mockResolvedValueOnce([new Float32Array(384).fill(0.2)]);
    const [docA, docB] = docs;
    if (!docA || !docB) throw new Error("test setup");
    await indexer.indexSource("docs", [docA]);
    await indexer.indexSource("guides", [docB]);

    await indexer.clearSource("docs");

    const remaining = db.prepare("SELECT id FROM vec_items").all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(["b"]);
  });

  it("indexSource() is a no-op when docs is empty", async () => {
    await indexer.indexSource("docs", []);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it("indexSource() deduplicates docs with the same id before inserting", async () => {
    const docs: EmbedDoc[] = [
      { id: "Color3", source: "docs", text: "Color3 datatype" },
      { id: "Color3", source: "docs", text: "Color3 class" },
    ];
    mockEmbed.mockResolvedValue([new Float32Array(384).fill(0.1)]);

    await indexer.indexSource("docs", docs);

    const rows = db.prepare("SELECT id FROM vec_items").all() as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("Color3");
    expect(mockEmbed).toHaveBeenCalledWith(["Color3 datatype"]);
  });

  it("indexSource() throws when vector count mismatches doc count", async () => {
    const docs: EmbedDoc[] = [{ id: "a", source: "docs", text: "one" }];
    mockEmbed.mockResolvedValue([]);

    await expect(indexer.indexSource("docs", docs)).rejects.toThrow(/vector count mismatch/);
  });

  it("indexSource() replaces existing rows for the same source", async () => {
    const first: EmbedDoc[] = [{ id: "Actor", source: "docs", text: "Actor v1" }];
    const second: EmbedDoc[] = [{ id: "Actor", source: "docs", text: "Actor v2" }];
    mockEmbed
      .mockResolvedValueOnce([new Float32Array(384).fill(0.1)])
      .mockResolvedValueOnce([new Float32Array(384).fill(0.2)]);

    await indexer.indexSource("docs", first);
    await indexer.indexSource("docs", second);

    const rows = db.prepare("SELECT id FROM vec_items WHERE source = 'docs'").all();
    expect(rows).toHaveLength(1);
  });
});
