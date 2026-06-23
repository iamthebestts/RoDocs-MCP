import { beforeEach, describe, expect, it, vi } from "vitest";
import { BM25 } from "../../search/bm25.js";
import type { SyncState } from "../../store/sync-state.js";
import {
  DEFAULT_SEED_BATCH_SIZES,
  SeedManager,
  type SeedSourceRunner,
  type SeedSyncManager,
} from "../seed-manager.js";

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

function createIdleDetector(isIdle = true) {
  return { isIdle: vi.fn(() => isIdle) };
}

async function flushMicrotasks(): Promise<void> {
  // A setImmediate boundary drains the entire pending microtask queue,
  // letting an in-flight processNextBatch() chain settle and reschedule.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("SeedManager", () => {
  let syncManager: MemorySyncManager;
  let logger: { error: ReturnType<typeof vi.fn<(message: string) => void>> };
  let yieldFn: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    syncManager = new MemorySyncManager();
    logger = { error: vi.fn<(message: string) => void>() };
    yieldFn = vi.fn(async () => {});
  });

  it("prioritizes demanded sources over the default queue", async () => {
    const calls: string[] = [];
    const runners: SeedSourceRunner[] = [
      {
        source: "docs",
        estimatedTotal: 50,
        batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
        runBatch: async () => {
          calls.push("docs");
          return { processed: 50, done: true };
        },
      },
      {
        source: "fastflags",
        estimatedTotal: 6,
        batchSize: DEFAULT_SEED_BATCH_SIZES.fastflags,
        runBatch: async () => {
          calls.push("fastflags");
          return { processed: 3, done: false, cursor: "3" };
        },
      },
    ];
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(false),
      runners,
      logger,
      yieldFn,
    });

    manager.prioritize("fastflags");
    await manager.processNextBatch();

    expect(calls).toEqual(["fastflags"]);
    expect(manager.getProgress("fastflags")).toMatchObject({
      status: "partial",
      seededItems: 3,
      cursor: "3",
    });
  });

  it("processes batches using the configured maximum batch size", async () => {
    const runBatch = vi.fn(async ({ batchSize }) => ({
      processed: batchSize,
      done: false,
      cursor: String(batchSize),
    }));
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "fastflags",
          estimatedTotal: 12,
          batchSize: DEFAULT_SEED_BATCH_SIZES.fastflags,
          runBatch,
        },
      ],
      logger,
      yieldFn,
    });
    manager.prioritize("fastflags");

    await manager.processNextBatch();

    expect(runBatch).toHaveBeenCalledWith({
      source: "fastflags",
      batchSize: 3,
    });
    expect(manager.getProgress("fastflags").seededItems).toBe(3);
  });

  it("isolates a failing batch instead of rejecting", async () => {
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "fastflags",
          estimatedTotal: 12,
          batchSize: DEFAULT_SEED_BATCH_SIZES.fastflags,
          runBatch: async () => {
            throw new Error("ECONNABORTED");
          },
        },
      ],
      logger,
      yieldFn,
    });
    manager.prioritize("fastflags");

    // Must resolve (not reject) so the error can never become an unhandled rejection.
    await expect(manager.processNextBatch()).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalled();
    // A failed source stays retryable, never silently "complete".
    expect(manager.getProgress("fastflags").status).not.toBe("complete");
  });

  it("retries a source that failed on the previous cycle", async () => {
    let attempts = 0;
    const runBatch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient network error");
      return { processed: 12, done: true };
    });
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "fastflags",
          estimatedTotal: 12,
          batchSize: DEFAULT_SEED_BATCH_SIZES.fastflags,
          runBatch,
        },
      ],
      logger,
      yieldFn,
    });
    manager.prioritize("fastflags");

    await manager.processNextBatch();
    expect(manager.getProgress("fastflags").status).not.toBe("complete");

    await manager.processNextBatch();
    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(manager.getProgress("fastflags").status).toBe("complete");
  });

  it("does not let a failing source block lower-priority sources", async () => {
    const guidesRunBatch = vi.fn(async () => ({ processed: 50, done: true }));
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => {
            throw new Error("docs is down");
          },
        },
        {
          source: "guides",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.guides,
          runBatch: guidesRunBatch,
        },
      ],
      logger,
      yieldFn,
    });

    // docs is priority 1 and fails; guides (priority 2) must still get a turn
    // once docs is demoted. Demand guides so it can run on the next pass.
    await manager.processNextBatch();
    manager.prioritize("guides");
    await manager.processNextBatch();

    expect(guidesRunBatch).toHaveBeenCalled();
    expect(manager.getProgress("guides").status).toBe("complete");
  });

  it("applies capped exponential backoff to a persistently failing source", async () => {
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    let attempts = 0;
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => {
            attempts += 1;
            // Fail enough times to reach (and exceed) the backoff ceiling.
            if (attempts <= 8) throw new Error("always fails");
            return { processed: 350, done: true };
          },
        },
      ],
      logger,
      yieldFn,
      scheduleFn: (cb, ms) => {
        delays.push(ms);
        pending.push(cb);
      },
    });

    manager.startBackground();

    for (let i = 0; i < 8 && pending.length > 0; i++) {
      const cb = pending.shift();
      cb?.();
      await flushMicrotasks();
    }

    expect(delays[0]).toBe(0); // first tick is immediate
    expect(delays[1]).toBeGreaterThan(0); // backoff kicks in after the first failure
    expect(delays[2]).toBeGreaterThan(delays[1] as number); // grows on consecutive failures
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000); // and is capped
    expect(delays.some((d) => d === 30_000)).toBe(true); // reaches the ceiling
  });

  it("preserves a failing source's backoff when another source succeeds", async () => {
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => {
            throw new Error("docs keeps failing");
          },
        },
        {
          source: "guides",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.guides,
          runBatch: async () => ({ processed: 350, done: true }),
        },
      ],
      logger,
      yieldFn,
      scheduleFn: (cb, ms) => {
        delays.push(ms);
        pending.push(cb);
      },
    });

    manager.startBackground();
    pending.shift()?.(); // docs fails → backoff armed
    await flushMicrotasks();

    manager.prioritize("guides");
    pending.shift()?.(); // guides runs and succeeds
    await flushMicrotasks();

    expect(delays[1]).toBeGreaterThan(0); // docs backed off after its failure
    expect(delays[2]).toBe(delays[1]); // docs' backoff survives guides' success
  });

  it("resets the retry delay after a successful batch", async () => {
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    let attempts = 0;
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 350,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("transient");
            return { processed: 350, done: true };
          },
        },
      ],
      logger,
      yieldFn,
      scheduleFn: (cb, ms) => {
        delays.push(ms);
        pending.push(cb);
      },
    });

    manager.startBackground();

    for (let i = 0; i < 2 && pending.length > 0; i++) {
      const cb = pending.shift();
      cb?.();
      await flushMicrotasks();
    }

    expect(delays[1]).toBeGreaterThan(0); // backed off after the failure
    expect(delays[2]).toBe(0); // reset to immediate once the batch succeeded
  });

  it("yields to the event loop between batches", async () => {
    const setImmediateSpy = vi.spyOn(globalThis, "setImmediate");
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "devforum",
          estimatedTotal: 40,
          batchSize: DEFAULT_SEED_BATCH_SIZES.devforum,
          runBatch: async () => ({ processed: 20, done: false, cursor: "20" }),
        },
      ],
      logger,
    });
    manager.prioritize("devforum");

    await manager.processNextBatch();

    expect(setImmediateSpy).toHaveBeenCalled();
    setImmediateSpy.mockRestore();
  });

  it("persists progress and resumes from the previous cursor after restart", async () => {
    const firstRunner = vi.fn(async () => ({ processed: 20, done: false, cursor: "20" }));
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "devforum",
          estimatedTotal: 40,
          batchSize: DEFAULT_SEED_BATCH_SIZES.devforum,
          runBatch: firstRunner,
        },
      ],
      logger,
      yieldFn,
    });
    manager.prioritize("devforum");
    await manager.processNextBatch();

    const resumedRunner = vi.fn(async () => ({ processed: 20, done: true }));
    const resumed = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "devforum",
          estimatedTotal: 40,
          batchSize: DEFAULT_SEED_BATCH_SIZES.devforum,
          runBatch: resumedRunner,
        },
      ],
      logger,
      yieldFn,
    });
    await resumed.loadPersistedProgress();
    resumed.prioritize("devforum");
    await resumed.processNextBatch();

    expect(resumedRunner).toHaveBeenCalledWith({
      source: "devforum",
      cursor: "20",
      batchSize: 20,
    });
    expect(resumed.getProgress("devforum")).toMatchObject({
      status: "complete",
      seededItems: 40,
      percent: 1,
    });
  });

  it("keeps newly seeded BM25 documents searchable after a partial batch", async () => {
    const bm25 = new BM25();
    const docs = [
      {
        id: "guide:datastore",
        fields: {
          title: "DataStore retry strategy",
          path: "guides/datastore.md",
          description: "Handle transient failures",
          content: "Use UpdateAsync with retries",
        },
      },
    ];
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "guides",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.guides,
          runBatch: async () => {
            bm25.index(docs);
            return { processed: 1, done: false, cursor: "1" };
          },
        },
      ],
      logger,
      yieldFn,
    });
    manager.prioritize("guides");

    await manager.processNextBatch();

    expect(bm25.search("datastore", 1)).toEqual([
      expect.objectContaining({ id: "guide:datastore" }),
    ]);
  });

  it("waits for idle before default background batches", async () => {
    const runBatch = vi.fn(async () => ({ processed: 50, done: true }));
    const idleDetector = createIdleDetector(false);
    const manager = new SeedManager({
      syncManager,
      idleDetector,
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch,
        },
      ],
      logger,
      yieldFn,
    });

    const processed = await manager.processNextBatch();

    expect(processed).toBe(false);
    expect(runBatch).not.toHaveBeenCalled();
    expect(idleDetector.isIdle).toHaveBeenCalled();
  });

  it("uses rate limiters before background seed batches", async () => {
    const acquire = vi.fn(async () => {});
    const runBatch = vi.fn(async () => ({ processed: 20, done: true }));
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "devforum",
          estimatedTotal: 20,
          batchSize: DEFAULT_SEED_BATCH_SIZES.devforum,
          runBatch,
        },
      ],
      rateLimiters: { devforum: { acquire } },
      logger,
      yieldFn,
    });
    manager.prioritize("devforum");

    await manager.processNextBatch();

    expect(acquire).toHaveBeenCalledBefore(runBatch);
  });

  it("rebuilds an index after a completed batch when the runner marks it stale", async () => {
    const rebuildIndex = vi.fn(async () => {});
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => ({ processed: 50, done: true, needsRebuild: true }),
          rebuildIndex,
        },
      ],
      logger,
      yieldFn,
    });

    await manager.processNextBatch();

    expect(rebuildIndex).toHaveBeenCalledOnce();
  });

  it("marks sources without runners complete without blocking the queue", async () => {
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      logger,
      yieldFn,
    });

    await expect(manager.processNextBatch()).resolves.toBe(true);
    await expect(manager.processNextBatch()).resolves.toBe(true);
    await expect(manager.processNextBatch()).resolves.toBe(true);
    await expect(manager.processNextBatch()).resolves.toBe(true);
    await expect(manager.processNextBatch()).resolves.toBe(false);

    expect(manager.getAllProgress().docs.status).toBe("complete");
    expect(manager.getAllProgress().devforum.status).toBe("complete");
  });

  it("ignores malformed persisted progress", async () => {
    await syncManager.updateSourceState("seed:docs", {
      metadata: { seedProgress: { source: "docs", status: "partial" } },
    });
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      logger,
      yieldFn,
    });

    await manager.loadPersistedProgress();

    expect(manager.getProgress("docs")).toMatchObject({
      source: "docs",
      status: "pending",
      seededItems: 0,
    });
  });

  it("does not rebuild a completed source when the batch does not mark the index stale", async () => {
    const rebuildIndex = vi.fn(async () => {});
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => ({ processed: 50, done: true }),
          rebuildIndex,
        },
      ],
      logger,
      yieldFn,
    });

    await manager.processNextBatch();

    expect(rebuildIndex).not.toHaveBeenCalled();
  });

  it("calls buildEmbeddings after rebuildIndex when source completes with needsRebuild", async () => {
    const rebuildIndex = vi.fn(async () => {});
    const buildEmbeddings = vi.fn(async () => {});
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => ({ processed: 50, done: true, needsRebuild: true }),
          rebuildIndex,
          buildEmbeddings,
        },
      ],
      logger,
      yieldFn,
    });

    await manager.processNextBatch();
    // buildEmbeddings is fire-and-forget; flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(rebuildIndex).toHaveBeenCalledOnce();
    expect(buildEmbeddings).toHaveBeenCalledOnce();
    const rebuildOrder = rebuildIndex.mock.invocationCallOrder[0] ?? 0;
    const embedOrder = buildEmbeddings.mock.invocationCallOrder[0] ?? 0;
    expect(rebuildOrder).toBeLessThan(embedOrder);
  });

  it("calls buildEmbeddings without needsRebuild when configured", async () => {
    const buildEmbeddings = vi.fn(async () => {});
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => ({ processed: 50, done: true }),
          buildEmbeddings,
        },
      ],
      logger,
      yieldFn,
    });

    manager.prioritize("docs");
    await manager.processNextBatch();

    expect(buildEmbeddings).toHaveBeenCalledOnce();
  });

  it("buildEmbeddings error does not affect seed completion status", async () => {
    const buildEmbeddings = vi.fn(async () => {
      throw new Error("model load failed");
    });
    const manager = new SeedManager({
      syncManager,
      idleDetector: createIdleDetector(true),
      runners: [
        {
          source: "docs",
          estimatedTotal: 50,
          batchSize: DEFAULT_SEED_BATCH_SIZES.docs,
          runBatch: async () => ({ processed: 50, done: true, needsRebuild: true }),
          buildEmbeddings,
        },
      ],
      logger,
      yieldFn,
    });

    await manager.processNextBatch();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.getProgress("docs").status).toBe("complete");
  });
});
