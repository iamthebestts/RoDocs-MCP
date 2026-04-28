import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LmdbStore } from "../lmdb-store.js";

describe("LmdbStore", () => {
  let store: LmdbStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-test-"));
    store = new LmdbStore({
      cacheDir: tempDir,
    });
    await store.open();
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should open and close without errors", async () => {
    const newStore = new LmdbStore({
      cacheDir: tempDir,
    });

    expect(newStore.isOpen()).toBe(false);
    await newStore.open();
    expect(newStore.isOpen()).toBe(true);

    await newStore.close();
    expect(newStore.isOpen()).toBe(false);
  });

  it("should put and get a simple value", async () => {
    const key = "test-key";
    const value = { foo: "bar", number: 42 };

    await store.put(key, value);
    const retrieved = await store.get(key);

    expect(retrieved).toEqual(value);
  });

  it("should return null for non-existent key", async () => {
    const result = await store.get("non-existent");
    expect(result).toBe(null);
  });

  it("should put and get multiple values", async () => {
    const entries = [
      { key: "key1", value: { data: "value1" } },
      { key: "key2", value: { data: "value2" } },
      { key: "key3", value: { data: "value3" } },
    ];

    await store.putMany(entries);

    const keys = entries.map((e) => e.key);
    const retrieved = await store.getMany(keys);

    expect(retrieved[0]).toEqual(entries[0].value);
    expect(retrieved[1]).toEqual(entries[1].value);
    expect(retrieved[2]).toEqual(entries[2].value);
  });

  it("should delete a key", async () => {
    const key = "to-delete";
    const value = { delete: "me" };

    await store.put(key, value);
    let retrieved = await store.get(key);
    expect(retrieved).toEqual(value);

    await store.del(key);
    retrieved = await store.get(key);
    expect(retrieved).toBe(null);
  });

  it("should handle partial missing keys in getMany", async () => {
    const entries = [
      { key: "existing1", value: { data: "value1" } },
      { key: "existing2", value: { data: "value2" } },
    ];

    await store.putMany(entries);

    const keys = ["existing1", "missing", "existing2", "also-missing"];
    const retrieved = await store.getMany(keys);

    expect(retrieved).toEqual([{ data: "value1" }, null, { data: "value2" }, null]);
  });

  it("should clear all data", async () => {
    const entries = [
      { key: "key1", value: "value1" },
      { key: "key2", value: "value2" },
    ];

    await store.putMany(entries);
    let keys = await store.keys();
    expect(keys).toHaveLength(2);

    await store.clear();
    keys = await store.keys();
    expect(keys).toHaveLength(0);
  });

  it("should return all keys", async () => {
    const entries = [
      { key: "alpha", value: "value1" },
      { key: "beta", value: "value2" },
      { key: "gamma", value: "value3" },
    ];

    await store.putMany(entries);

    const keys = await store.keys();
    const keySet = new Set(keys);

    expect(keySet.has("alpha")).toBe(true);
    expect(keySet.has("beta")).toBe(true);
    expect(keySet.has("gamma")).toBe(true);
  });

  it("should throw errors when operations are attempted on closed store", async () => {
    await store.close();

    await expect(store.get("test")).rejects.toThrow("LMDB store is not open");
    await expect(store.put("test", "value")).rejects.toThrow("LMDB store is not open");
    await expect(store.del("test")).rejects.toThrow("LMDB store is not open");
    await expect(store.getMany(["test"])).rejects.toThrow("LMDB store is not open");
    await expect(store.putMany([{ key: "test", value: "test" }])).rejects.toThrow(
      "LMDB store is not open",
    );
    await expect(store.clear()).rejects.toThrow("LMDB store is not open");
    await expect(store.keys()).rejects.toThrow("LMDB store is not open");
  });

  it("should handle complex data types", async () => {
    const complexValue = {
      string: "test",
      number: 42,
      boolean: true,
      null: null,
      undefined: undefined,
      array: [1, 2, 3, { nested: "object" }],
      date: new Date("2023-01-01T00:00:00Z"),
    };

    const key = "complex";
    await store.put(key, complexValue);

    const retrieved = await store.get<typeof complexValue>(key);
    expect(retrieved).toEqual(complexValue);
    expect(retrieved?.date).toBeInstanceOf(Date);
  });
});
