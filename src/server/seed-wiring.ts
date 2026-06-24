import { DevForumPipeline } from "../devforum/pipeline.js";
import { FastFlagScraper } from "../fastflags/scraper.js";
import type { Scheduler } from "../scheduler/index.js";
import { SeedManager } from "../scheduler/seed-manager.js";
import { createEmbeddingIndexer, createSeedSourceRunners } from "../seed/runners.js";
import type { IKeyValueStore, Indexer, SyncStateManager } from "../store/index.js";

export type SeedWiringContext = {
  store: IKeyValueStore;
  syncManager: SyncStateManager;
  indexer: Indexer;
  scheduler: Scheduler;
  githubToken: string | undefined;
};

export function createSeedManager(ctx: SeedWiringContext): SeedManager {
  const fastFlagScraper = new FastFlagScraper(ctx.store, ctx.syncManager, ctx.indexer);
  const devForumPipeline = new DevForumPipeline(ctx.store, ctx.syncManager, ctx.indexer);
  const embeddingIndexer = createEmbeddingIndexer(ctx.store);

  return new SeedManager({
    syncManager: ctx.syncManager,
    idleDetector: ctx.scheduler.idleDetector,
    rateLimiters: {
      devforum: ctx.scheduler.devForumRateLimiter,
    },
    runners: createSeedSourceRunners({
      store: ctx.store,
      syncManager: ctx.syncManager,
      githubToken: ctx.githubToken,
      embeddingIndexer,
      fastFlagScraper,
      devForumPipeline,
    }),
  });
}
