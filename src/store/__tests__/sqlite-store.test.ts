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
});
