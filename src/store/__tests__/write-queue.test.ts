import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmdbStore } from "../lmdb-store.js";
import { WriteQueue } from "../write-queue.js";

describe("WriteQueue", () => {
  let store: LmdbStore;
  let queue: WriteQueue;
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-wq-test-"));
    store = new LmdbStore({
      cacheDir: tempDir,
    });
    await store.open();
    queue = new WriteQueue(store, {
      batchSize: 5,
      flushInterval: 1000,
    });
  });

  afterEach(async () => {
    await queue.close();
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("should flush when batch size is reached", async () => {
    // Enqueue 4 items (less than batchSize 5)
    for (let i = 0; i < 4; i++) {
      await queue.put(`key${i}`, `val${i}`);
    }

    expect(await store.get("key0")).toBe(null);

    // Enqueue 5th item to trigger flush
    await queue.put("key4", "val4");

    // Wait for the background flush to complete
    await queue.waitForFlush();

    expect(await store.get("key0")).toBe("val0");
    expect(await store.get("key4")).toBe("val4");
  });

  it("should flush when interval expires", async () => {
    await queue.put("key", "val");

    expect(await store.get("key")).toBe(null);

    // Advance time by 1000ms
    vi.advanceTimersByTime(1000);

    // Wait for the background flush to complete
    await queue.waitForFlush();

    expect(await store.get("key")).toBe("val");
  });

  it("should flush manually", async () => {
    await queue.put("key", "val");
    expect(await store.get("key")).toBe(null);

    await queue.flush();
    expect(await store.get("key")).toBe("val");
  });

  it("should re-queue operations on failure", async () => {
    // Mock store.put to fail once
    const originalPut = store.put.bind(store);
    let fail = true;
    store.put = async (k, v) => {
      if (fail) {
        fail = false;
        throw new Error("DB Failure");
      }
      return originalPut(k, v);
    };

    await queue.put("key", "val");

    // Trigger flush
    try {
      await queue.flush();
    } catch (e) {
      expect(e.message).toContain("Flush failed, operations re-queued");
    }

    // Value should not be in store
    expect(await store.get("key")).toBe(null);

    // Next flush should succeed
    await queue.flush();
    expect(await store.get("key")).toBe("val");
  });

  it("should flush pending operations on close", async () => {
    await queue.put("key", "val");
    expect(await store.get("key")).toBe(null);

    await queue.close();
    expect(await store.get("key")).toBe("val");
  });

  it("should reject enqueue after close", async () => {
    await queue.close();

    await expect(queue.put("key", "val")).rejects.toThrow("WriteQueue is closed");
    await expect(queue.del("key")).rejects.toThrow("WriteQueue is closed");
  });

  it("should handle mixed put and del operations in batch", async () => {
    await store.put("old", "val");

    await queue.put("new", "val");
    await queue.del("old");

    await queue.flush();

    expect(await store.get("new")).toBe("val");
    expect(await store.get("old")).toBe(null);
  });
});
