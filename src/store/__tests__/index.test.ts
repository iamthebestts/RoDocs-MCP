import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStore, createSyncStateManager } from "../index.js";

describe("Store Public API", () => {
  it("should create store with factory function", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-api-test-"));

    try {
      const store = await createStore({
        cacheDir: tempDir,
      });

      expect(store.isOpen()).toBe(true);
      expect(store.getPath()).toContain(tempDir);

      await store.put("test", "value");
      const result = await store.get("test");
      expect(result).toBe("value");

      await store.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should create sync state manager with factory function", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rodocsmcp-sync-api-test-"));

    try {
      const store = await createStore({
        cacheDir: tempDir,
      });

      const syncManager = createSyncStateManager(store);

      await syncManager.updateSourceState("test", {
        lastSyncAt: Date.now(),
      });

      const result = await syncManager.getSourceState("test");
      expect(result?.lastSyncAt).toBeDefined();

      await store.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
