import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LmdbStore } from "../lmdb-store.js";

describe("LmdbStore", () => {
  let store: LmdbStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-lmdb-test-"));
    store = new LmdbStore({ cacheDir: tempDir });
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

  it("should put and get many values", async () => {
    const entries = [
      { key: "k1", value: "v1" },
      { key: "k2", value: "v2" },
      { key: "k3", value: "v3" },
    ];

    await store.putMany(entries);
    const retrieved = await store.getMany(["k1", "k2", "k3"]);

    expect(retrieved).toHaveLength(3);
    expect(retrieved[0]).toEqual(entries[0]?.value);
    expect(retrieved[1]).toEqual(entries[1]?.value);
    expect(retrieved[2]).toEqual(entries[2]?.value);
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
});
