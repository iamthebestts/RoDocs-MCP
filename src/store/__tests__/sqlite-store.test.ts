import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../sqlite-store.js";

describe("SqliteStore", () => {
  let store: SqliteStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-sqlite-test-"));
    store = new SqliteStore({ cacheDir: tempDir });
    await store.open();
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should put and get a value", async () => {
    const key = "test-key";
    const value = { foo: "bar", baz: 123 };
    await store.put(key, value);
    const retrieved = await store.get(key);
    expect(retrieved).toEqual(value);
  });

  it("should return null for non-existent key", async () => {
    const retrieved = await store.get("non-existent");
    expect(retrieved).toBe(null);
  });

  it("should delete a key", async () => {
    await store.put("key", "value");
    await store.del("key");
    const retrieved = await store.get("key");
    expect(retrieved).toBe(null);
  });

  it("should clear the store", async () => {
    await store.put("key1", "val1");
    await store.put("key2", "val2");
    await store.clear();
    expect(await store.get("key1")).toBe(null);
    expect(await store.get("key2")).toBe(null);
  });

  it("countByPrefix() counts keys with matching prefix", async () => {
    await store.put("fastflags:a", { name: "a" });
    await store.put("fastflags:b", { name: "b" });
    await store.put("devforum:1", { title: "t" });
    expect(await store.countByPrefix("fastflags:")).toBe(2);
    expect(await store.countByPrefix("devforum:")).toBe(1);
    expect(await store.countByPrefix("missing:")).toBe(0);
  });

  it("should list all keys", async () => {
    await store.put("a", 1);
    await store.put("b", 2);
    await store.put("c", 3);
    const keys = await store.keys();
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it("getPath() returns the .db file path, not the directory", () => {
    const p = store.getPath();
    expect(p).toMatch(/store\.db$/);
    expect(p).toContain(tempDir);
  });

  it("isOpen() returns true after open() and false after close()", async () => {
    expect(store.isOpen()).toBe(true);
    await store.close();
    expect(store.isOpen()).toBe(false);
    // re-open so afterEach.close() does not throw
    await store.open();
  });

  it("put() is idempotent (upsert semantics)", async () => {
    await store.put("k", "first");
    await store.put("k", "second");
    expect(await store.get("k")).toBe("second");
  });

  it("throws if get() called before open()", async () => {
    const uninit = new SqliteStore({ cacheDir: tempDir });
    await expect(uninit.get("x")).rejects.toThrow(/not open/i);
  });

  it("respects RODOCS_CACHE_DIR env var when no cacheDir option is given", async () => {
    const envDir = await mkdtemp(join(tmpdir(), "rodocs-env-test-"));
    try {
      process.env.RODOCS_CACHE_DIR = envDir;
      const envStore = new SqliteStore();
      expect(envStore.getPath()).toContain(envDir);
    } finally {
      delete process.env.RODOCS_CACHE_DIR;
      await rm(envDir, { recursive: true, force: true });
    }
  });

  it("creates vec_items virtual table on open()", async () => {
    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    const row = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'`,
      )
      .get();
    expect(row?.name).toBe("vec_items");
  });

  it("enables WAL journal mode and busy_timeout on open()", () => {
    const db = store.getDb();
    expect(String(db.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("countByPrefix() is case-sensitive and treats SQL LIKE wildcards literally", async () => {
    await store.put("a_b:1", 1);
    await store.put("axb:2", 2);
    await store.put("A_B:3", 3);
    await store.put("p%:4", 4);
    await store.put("px:5", 5);

    expect(await store.countByPrefix("a_b:")).toBe(1);
    expect(await store.countByPrefix("p%:")).toBe(1);
    expect(await store.countByPrefix("")).toBe(5);
  });

  it("putMany(), getByPrefix(), and delByPrefix() work atomically", async () => {
    await store.putMany([
      { key: "fastflags:A", value: { name: "A" } },
      { key: "fastflags:B", value: { name: "B" } },
      { key: "devforum:1", value: { title: "One" } },
    ]);

    const flags = await store.getByPrefix<{ name: string }>("fastflags:");
    expect(flags).toHaveLength(2);
    expect(flags.map((e) => e.key).sort()).toEqual(["fastflags:A", "fastflags:B"]);
    expect(flags.find((e) => e.key === "fastflags:A")?.value).toEqual({ name: "A" });

    const deleted = await store.delByPrefix("fastflags:");
    expect(deleted).toBe(2);
    expect(await store.countByPrefix("fastflags:")).toBe(0);
    expect(await store.countByPrefix("devforum:")).toBe(1);
  });

  it("clear() also removes rows from vec_items", async () => {
    const db = store.getDb();
    const vec = new Float32Array(384).fill(0.1);
    db.prepare("INSERT INTO vec_items (id, source, embedding) VALUES (?, ?, ?)").run(
      "doc-1",
      "docs",
      vec,
    );
    await store.put("k1", "v1");

    await store.clear();

    const row = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM vec_items").get();
    expect(row?.count).toBe(0);
    expect(await store.get("k1")).toBe(null);
  });
});
