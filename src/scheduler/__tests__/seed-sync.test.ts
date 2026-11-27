import { beforeEach, describe, expect, it } from "vitest";
import type { SyncState } from "../../store/sync-state.js";
import { DEFAULT_ESTIMATED_TOTALS, type SeedSyncManager } from "../seed-manager.js";
import { markSeedSourceComplete, seedProgressKey } from "../seed-sync.js";

class MemorySyncManager implements SeedSyncManager {
  readonly states = new Map<string, SyncState>();

  async getSourceState(sourceKey: string): Promise<SyncState | null> {
    return this.states.get(sourceKey) ?? null;
  }

  async updateSourceState(sourceKey: string, state: Partial<SyncState>): Promise<void> {
    this.states.set(sourceKey, {
      ...this.states.get(sourceKey),
      ...state,
    });
  }
}

describe("seed-sync", () => {
  let syncManager: MemorySyncManager;

  beforeEach(() => {
    syncManager = new MemorySyncManager();
  });

  it("seedProgressKey() uses seed: prefix", () => {
    expect(seedProgressKey("docs")).toBe("seed:docs");
  });

  it("markSeedSourceComplete() persists complete progress", async () => {
    await markSeedSourceComplete(syncManager, "guides", { seededItems: 120 });

    const state = await syncManager.getSourceState("seed:guides");
    expect(state?.metadata?.seedProgress).toMatchObject({
      source: "guides",
      status: "complete",
      seededItems: 120,
      percent: 1,
    });
    expect(state?.lastSyncAt).toBeTypeOf("number");
  });

  it("markSeedSourceComplete() sets embeddingsComplete without dropping existing metadata", async () => {
    await syncManager.updateSourceState("seed:docs", {
      metadata: { customFlag: true },
    });

    await markSeedSourceComplete(syncManager, "docs", { embeddingsComplete: true });

    const state = await syncManager.getSourceState("seed:docs");
    expect(state?.metadata?.customFlag).toBe(true);
    expect(state?.metadata?.embeddingsComplete).toBe(true);
    expect(state?.metadata?.seedProgress).toMatchObject({
      source: "docs",
      status: "complete",
      estimatedTotal: DEFAULT_ESTIMATED_TOTALS.docs,
    });
  });
});
