import { DevForumPipeline } from "../devforum/pipeline.js";
import { FastFlagScraper } from "../fastflags/scraper.js";
import type { SeedProgressReporter } from "../seed/progress.js";
import { noopSeedProgress } from "../seed/progress.js";
import {
  createEmbeddingIndexer,
  runDevforumSeed,
  runDocsSeed,
  runFastflagsSeed,
  runGuidesSeed,
  type SeedRunnersDeps,
  type SeedRunOptions,
} from "../seed/runners.js";
import type { createSyncStateManager, IKeyValueStore, Indexer } from "../store/index.js";
import { openSeedContext } from "./seed-context.js";

export { openSeedContext };

export async function seedDocs(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
  options?: SeedRunOptions,
): Promise<void> {
  await runDocsSeed(
    {
      store,
      syncManager,
      githubToken,
      embeddingIndexer: createEmbeddingIndexer(store),
    },
    reporter,
    options,
  );
}

export async function seedGuides(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
  options?: SeedRunOptions,
): Promise<void> {
  await runGuidesSeed(
    {
      store,
      syncManager,
      githubToken,
      embeddingIndexer: createEmbeddingIndexer(store),
    },
    reporter,
    options,
  );
}

export async function seedFastflags(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  indexer: Indexer,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
  options?: SeedRunOptions,
): Promise<{ added: number; updated: number }> {
  return runFastflagsSeed(
    {
      store,
      syncManager,
      githubToken,
      embeddingIndexer: createEmbeddingIndexer(store),
      fastFlagScraper: new FastFlagScraper(store, syncManager, indexer),
      devForumPipeline: new DevForumPipeline(store, syncManager, indexer),
    },
    reporter,
    options,
  );
}

export async function seedDevforum(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  indexer: Indexer,
  reporter: SeedProgressReporter = noopSeedProgress,
  options?: SeedRunOptions,
): Promise<Awaited<ReturnType<DevForumPipeline["seed"]>>> {
  return runDevforumSeed(
    {
      store,
      syncManager,
      githubToken: undefined,
      embeddingIndexer: createEmbeddingIndexer(store),
      fastFlagScraper: new FastFlagScraper(store, syncManager, indexer),
      devForumPipeline: new DevForumPipeline(store, syncManager, indexer),
    },
    reporter,
    options,
  );
}

export type { SeedRunnersDeps };
