import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IKeyValueStore } from "../../store/store-interface.js";
import {
  countEmbeddingsForSource,
  detectWarmSources,
  resolveCacheDir,
  sourceNeedsEmbeddings,
  WARM_KV_MIN_COUNTS,
} from "../warm-cache.js";

function makeStore(tmpDir: string, keys: string[] = []): IKeyValueStore {
  return {
    getPath: () => join(tmpDir, "store.db"),
    keys: async () => keys,
    countByPrefix: async (prefix: string) => keys.filter((k) => k.startsWith(prefix)).length,
    get: async () => null,
    put: async () => {},
    del: async () => {},
    clear: async () => {},
    open: async () => {},
    close: async () => undefined,
    isOpen: () => true,
  };
}

describe("warm-cache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join("/tmp", `rodocs-warm-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // temp dirs left for inspection; harmless in /tmp
  });

  it("detectWarmSources() marks docs/guides from BM25 index files", async () => {
    await writeFile(join(tmpDir, "api.index.msgpack"), "x");
    await writeFile(join(tmpDir, "guides.index.msgpack"), "x");
    const warm = await detectWarmSources({ store: makeStore(tmpDir) });
    expect(warm).toContain("docs");
    expect(warm).toContain("guides");
  });

  it("detectWarmSources() does not mark devforum warm with a single key", async () => {
    const warm = await detectWarmSources({
      store: makeStore(tmpDir, ["devforum:42"]),
    });
    expect(warm).not.toContain("devforum");
  });

  it("detectWarmSources() marks kv sources when prefix count meets threshold", async () => {
    const devforumKeys = Array.from(
      { length: WARM_KV_MIN_COUNTS.devforum },
      (_, i) => `devforum:${i}`,
    );
    const warm = await detectWarmSources({
      store: makeStore(tmpDir, [...devforumKeys, "fastflags:only-one"]),
    });
    expect(warm).toContain("devforum");
    expect(warm).not.toContain("fastflags");
  });

  it("sourceNeedsEmbeddings() returns true when partial embeddings exist without completion metadata", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    db.exec(`
      CREATE VIRTUAL TABLE vec_items USING vec0(
        id TEXT PRIMARY KEY,
        source TEXT,
        embedding FLOAT[384]
      )
    `);
    db.prepare("INSERT INTO vec_items (id, source, embedding) VALUES (?, ?, ?)").run(
      "Actor",
      "docs",
      new Float32Array(384).fill(0.1),
    );
    expect(sourceNeedsEmbeddings(db, "docs")).toBe(true);
    db.close();
  });

  it("sourceNeedsEmbeddings() returns false when embeddings match declared count", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    db.exec(`
      CREATE VIRTUAL TABLE vec_items USING vec0(
        id TEXT PRIMARY KEY,
        source TEXT,
        embedding FLOAT[384]
      )
    `);
    db.prepare("INSERT INTO vec_items (id, source, embedding) VALUES (?, ?, ?)").run(
      "Actor",
      "docs",
      new Float32Array(384).fill(0.1),
    );
    expect(
      sourceNeedsEmbeddings(db, "docs", { embeddingsComplete: true, embeddingsCount: 1 }),
    ).toBe(false);
    expect(countEmbeddingsForSource(db, "docs")).toBe(1);
    db.close();
  });

  it("resolveCacheDir() returns parent of store.db", () => {
    expect(resolveCacheDir(makeStore(tmpDir))).toBe(tmpDir);
  });
});
