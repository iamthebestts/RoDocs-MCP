import type Database from "better-sqlite3";
import { DevForumPipeline } from "../devforum/pipeline.js";
import { EmbeddingIndexer } from "../embedding/embedding-indexer.js";
import {
  buildDevforumEmbedDocs,
  buildDocsEmbedDocs,
  buildFastflagsEmbedDocs,
  buildGuidesEmbedDocs,
} from "../embedding/sources.js";
import { FastFlagScraper } from "../fastflags/scraper.js";
import { markSeedSourceComplete } from "../scheduler/seed-sync.js";
import { ensureApiIndex, ensureGuideIndex, initIndexer } from "../search/index.js";
import type { SeedProgressReporter } from "../seed/progress.js";
import { noopSeedProgress } from "../seed/progress.js";
import {
  createSyncStateManager,
  type IKeyValueStore,
  Indexer,
  SqliteStore,
} from "../store/index.js";

type StoreWithDb = IKeyValueStore & { getDb(): Database.Database };

function hasGetDb(store: IKeyValueStore): store is StoreWithDb {
  return typeof (store as StoreWithDb).getDb === "function";
}

function createEmbeddingIndexer(store: IKeyValueStore): EmbeddingIndexer | null {
  if (!hasGetDb(store)) return null;
  try {
    return new EmbeddingIndexer(store, store.getDb());
  } catch {
    return null;
  }
}

export async function seedDocs(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<void> {
  reporter.onPhase("index", "building API reference BM25 index");
  await ensureApiIndex(githubToken);

  const embeddingIndexer = createEmbeddingIndexer(store);
  if (embeddingIndexer) {
    reporter.onPhase("embed", "generating docs embedding vectors");
    const docs = await buildDocsEmbedDocs(githubToken);
    await embeddingIndexer.indexSource("docs", docs);
    await markSeedSourceComplete(syncManager, "docs", { embeddingsComplete: true });
  } else {
    await markSeedSourceComplete(syncManager, "docs");
  }
}

export async function seedGuides(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<void> {
  reporter.onPhase("index", "building guides BM25 index");
  await ensureGuideIndex(githubToken);

  const embeddingIndexer = createEmbeddingIndexer(store);
  if (embeddingIndexer) {
    reporter.onPhase("embed", "generating guides embedding vectors");
    const docs = await buildGuidesEmbedDocs(githubToken);
    await embeddingIndexer.indexSource("guides", docs);
    await markSeedSourceComplete(syncManager, "guides", { embeddingsComplete: true });
  } else {
    await markSeedSourceComplete(syncManager, "guides");
  }
}

export async function seedFastflags(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  indexer: Indexer,
  githubToken: string | undefined,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<{ added: number; updated: number }> {
  reporter.onPhase("fetch", "downloading flags from MaximumADHD");
  const scraper = new FastFlagScraper(store, syncManager, indexer);
  const result = await scraper.seed(githubToken);

  const embeddingIndexer = createEmbeddingIndexer(store);
  if (embeddingIndexer) {
    reporter.onPhase("embed", "generating fastflags embedding vectors");
    const docs = await buildFastflagsEmbedDocs(store);
    await embeddingIndexer.indexSource("fastflags", docs);
    await markSeedSourceComplete(syncManager, "fastflags", {
      seededItems: result.added + result.updated,
      embeddingsComplete: true,
    });
  } else {
    await markSeedSourceComplete(syncManager, "fastflags", {
      seededItems: result.added + result.updated,
    });
  }

  return result;
}

export async function seedDevforum(
  store: IKeyValueStore,
  syncManager: ReturnType<typeof createSyncStateManager>,
  indexer: Indexer,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<Awaited<ReturnType<DevForumPipeline["seed"]>>> {
  const pipeline = new DevForumPipeline(store, syncManager, indexer);
  const result = await pipeline.seed({ reporter });

  const embeddingIndexer = createEmbeddingIndexer(store);
  if (embeddingIndexer && result.added > 0) {
    const embedStartedAt = Date.now();
    reporter.onPhase("embed", "generating devforum embedding vectors");
    const docs = await buildDevforumEmbedDocs(store);
    await embeddingIndexer.indexSource("devforum", docs);
    reporter.onPhaseEnd?.("embed", {
      elapsedMs: Date.now() - embedStartedAt,
      detail: `${docs.length} vectors`,
    });
    await markSeedSourceComplete(syncManager, "devforum", {
      seededItems: result.added,
      embeddingsComplete: true,
    });
  } else if (result.added > 0 || result.discoveryFromCache) {
    await markSeedSourceComplete(syncManager, "devforum", { seededItems: result.added });
  }

  return result;
}

export interface SeedContext {
  store: SqliteStore;
  syncManager: ReturnType<typeof createSyncStateManager>;
  indexer: Indexer;
}

export async function openSeedContext(): Promise<SeedContext> {
  const store = new SqliteStore();
  await store.open();
  const syncManager = createSyncStateManager(store);
  const indexer = new Indexer(store, syncManager);
  initIndexer(store, syncManager, indexer);
  return { store, syncManager, indexer };
}
