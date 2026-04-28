import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LmdbStore } from "../lmdb-store.js";
import { SyncStateManager } from "../sync-state.js";

describe("SyncStateManager", () => {
  let store: LmdbStore;
  let syncManager: SyncStateManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-sync-test-"));
    store = new LmdbStore({
      cacheDir: tempDir,
    });
    await store.open();
    syncManager = new SyncStateManager(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should save and retrieve sync state", async () => {
    const sourceKey = "test-source";
    const state = {
      etag: 'W/"abc123"',
      lastModified: "Mon, 01 Jan 2023 00:00:00 GMT",
      lastSyncAt: Date.now(),
      commitSha: "abc123def456",
    };

    await syncManager.updateSourceState(sourceKey, state);
    const retrieved = await syncManager.getSourceState(sourceKey);

    expect(retrieved).toEqual(state);
  });

  it("should return null for non-existent source state", async () => {
    const result = await syncManager.getSourceState("non-existent");
    expect(result).toBe(null);
  });

  it("should merge updates to existing state", async () => {
    const sourceKey = "test-source";

    // Initial state
    await syncManager.updateSourceState(sourceKey, {
      etag: 'W/"abc123"',
      lastSyncAt: Date.now(),
    });

    // Partial update
    await syncManager.updateSourceState(sourceKey, {
      commitSha: "def456",
    });

    const final = await syncManager.getSourceState(sourceKey);

    expect(final?.etag).toBe('W/"abc123"');
    expect(final?.commitSha).toBe("def456");
    expect(final?.lastSyncAt).toBeDefined();
  });

  it("should clear source state", async () => {
    const sourceKey = "test-source";

    await syncManager.updateSourceState(sourceKey, {
      etag: 'W/"abc123"',
    });

    let retrieved = await syncManager.getSourceState(sourceKey);
    expect(retrieved).not.toBe(null);

    await syncManager.clearSourceState(sourceKey);
    retrieved = await syncManager.getSourceState(sourceKey);
    expect(retrieved).toBe(null);
  });

  it("should list all source keys", async () => {
    const sources = ["source1", "source2", "source3"];

    for (const source of sources) {
      await syncManager.updateSourceState(source, {
        lastSyncAt: Date.now(),
      });
    }

    const keys = await syncManager.getAllSourceKeys();
    const keySet = new Set(keys);

    expect(keySet.has("source1")).toBe(true);
    expect(keySet.has("source2")).toBe(true);
    expect(keySet.has("source3")).toBe(true);
  });

  it("should determine when sync is needed - no existing state", async () => {
    const result = await syncManager.needsSync("new-source");
    expect(result).toBe(true);
  });

  it("should determine when sync is needed - force option", async () => {
    const sourceKey = "test-source";

    await syncManager.updateSourceState(sourceKey, {
      lastSyncAt: Date.now(),
    });

    const result = await syncManager.needsSync(sourceKey, { force: true });
    expect(result).toBe(true);
  });

  it("should determine when sync is needed - ETag mismatch", async () => {
    const sourceKey = "test-source";

    await syncManager.updateSourceState(sourceKey, {
      etag: 'W/"old-etag"',
      lastSyncAt: Date.now(),
    });

    const result = await syncManager.needsSync(sourceKey, {
      etag: 'W/"new-etag"',
    });
    expect(result).toBe(true);
  });

  it("should determine when sync is needed - based on age", async () => {
    const sourceKey = "test-source";
    const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

    await syncManager.updateSourceState(sourceKey, {
      lastSyncAt: oldTimestamp,
    });

    const result = await syncManager.needsSync(sourceKey, {
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    expect(result).toBe(true);
  });

  it("should determine when sync is NOT needed", async () => {
    const sourceKey = "test-source";
    const recentTimestamp = Date.now() - 30 * 60 * 1000; // 30 minutes ago

    await syncManager.updateSourceState(sourceKey, {
      etag: 'W/"current-etag"',
      lastSyncAt: recentTimestamp,
    });

    const result = await syncManager.needsSync(sourceKey, {
      etag: 'W/"current-etag"',
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    expect(result).toBe(false);
  });

  it("should handle metadata in sync state", async () => {
    const sourceKey = "test-source";
    const metadata = {
      url: "https://example.com/api",
      version: "1.0.0",
      extra: { custom: "field" },
    };

    await syncManager.updateSourceState(sourceKey, {
      lastSyncAt: Date.now(),
      metadata,
    });

    const result = await syncManager.getSourceState(sourceKey);
    expect(result?.metadata).toEqual(metadata);
  });
});
