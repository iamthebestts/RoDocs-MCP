import type Database from "better-sqlite3";
import type { DevForumPipeline } from "../devforum/pipeline.js";
import { EmbeddingIndexer } from "../embedding/embedding-indexer.js";
import {
  buildDevforumEmbedDocs,
  buildDocsEmbedDocs,
  buildFastflagsEmbedDocs,
  buildGuidesEmbedDocs,
} from "../embedding/sources.js";
import type { FastFlagScraper } from "../fastflags/scraper.js";
import {
  DEFAULT_ESTIMATED_TOTALS,
  type SeedSourceRunner,
  type SeedSyncManager,
} from "../scheduler/seed-manager.js";
import { markSeedSourceComplete } from "../scheduler/seed-sync.js";
import { sourceNeedsEmbeddings } from "../scheduler/warm-cache.js";
import { ensureApiIndex, ensureGuideIndex } from "../search/index.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SeedProgressReporter } from "./progress.js";
import { noopSeedProgress } from "./progress.js";

type StoreWithDb = IKeyValueStore & { getDb(): Database.Database };

function hasGetDb(store: IKeyValueStore): store is StoreWithDb {
  return typeof (store as StoreWithDb).getDb === "function";
}

export function createEmbeddingIndexer(store: IKeyValueStore): EmbeddingIndexer | null {
  if (!hasGetDb(store)) return null;
  try {
    return new EmbeddingIndexer(store, store.getDb());
  } catch {
    return null;
  }
}

export type SeedRunnersDeps = {
  store: IKeyValueStore;
  syncManager?: SeedSyncManager;
  githubToken: string | undefined;
  embeddingIndexer: EmbeddingIndexer | null;
  fastFlagScraper: FastFlagScraper;
  devForumPipeline: DevForumPipeline;
};

async function indexEmbeddingsIfNeeded(
  embeddingIndexer: EmbeddingIndexer | null,
  source: "docs" | "guides" | "fastflags" | "devforum",
  docs: Awaited<ReturnType<typeof buildDocsEmbedDocs>>,
  syncManager: SeedSyncManager | undefined,
  reporter: SeedProgressReporter,
  phaseLabel: string,
): Promise<number> {
  if (!embeddingIndexer) return 0;
  reporter.onPhase("embed", phaseLabel);
  const count = await embeddingIndexer.indexSource(source, docs);
  if (syncManager) {
    await markSeedSourceComplete(syncManager, source, {
      embeddingsComplete: true,
      embeddingsCount: count,
    });
  }
  return count;
}

export async function runDocsSeed(
  deps: Pick<SeedRunnersDeps, "store" | "syncManager" | "githubToken" | "embeddingIndexer">,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<void> {
  reporter.onPhase("index", "building API reference BM25 index");
  await ensureApiIndex(deps.githubToken);

  const docs = await buildDocsEmbedDocs(deps.githubToken);
  const count = await indexEmbeddingsIfNeeded(
    deps.embeddingIndexer,
    "docs",
    docs,
    deps.syncManager,
    reporter,
    "generating docs embedding vectors",
  );
  if (!deps.embeddingIndexer && deps.syncManager) {
    await markSeedSourceComplete(deps.syncManager, "docs");
  } else if (deps.embeddingIndexer && deps.syncManager && count === 0) {
    await markSeedSourceComplete(deps.syncManager, "docs");
  }
}

export async function runGuidesSeed(
  deps: Pick<SeedRunnersDeps, "store" | "syncManager" | "githubToken" | "embeddingIndexer">,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<void> {
  reporter.onPhase("index", "building guides BM25 index");
  await ensureGuideIndex(deps.githubToken);

  const docs = await buildGuidesEmbedDocs(deps.githubToken);
  const count = await indexEmbeddingsIfNeeded(
    deps.embeddingIndexer,
    "guides",
    docs,
    deps.syncManager,
    reporter,
    "generating guides embedding vectors",
  );
  if (!deps.embeddingIndexer && deps.syncManager) {
    await markSeedSourceComplete(deps.syncManager, "guides");
  } else if (deps.embeddingIndexer && deps.syncManager && count === 0) {
    await markSeedSourceComplete(deps.syncManager, "guides");
  }
}

export async function runFastflagsSeed(
  deps: SeedRunnersDeps,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<{ added: number; updated: number }> {
  reporter.onPhase("fetch", "downloading flags from MaximumADHD");
  const result = await deps.fastFlagScraper.seed(deps.githubToken);

  if (deps.embeddingIndexer) {
    reporter.onPhase("embed", "generating fastflags embedding vectors");
    const docs = await buildFastflagsEmbedDocs(deps.store);
    const count = await deps.embeddingIndexer.indexSource("fastflags", docs);
    if (deps.syncManager) {
      await markSeedSourceComplete(deps.syncManager, "fastflags", {
        seededItems: result.added + result.updated,
        embeddingsComplete: true,
        embeddingsCount: count,
      });
    }
  } else if (deps.syncManager) {
    await markSeedSourceComplete(deps.syncManager, "fastflags", {
      seededItems: result.added + result.updated,
    });
  }

  return result;
}

export async function runDevforumSeed(
  deps: SeedRunnersDeps,
  reporter: SeedProgressReporter = noopSeedProgress,
): Promise<Awaited<ReturnType<DevForumPipeline["seed"]>>> {
  const result = await deps.devForumPipeline.seed({ reporter });

  const db = hasGetDb(deps.store) ? deps.store.getDb() : null;
  const needsEmbed =
    deps.embeddingIndexer !== null &&
    sourceNeedsEmbeddings(db, "devforum", await getDevforumEmbedMetadata(deps.syncManager));

  if (needsEmbed && deps.embeddingIndexer) {
    const embedStartedAt = Date.now();
    reporter.onPhase("embed", "generating devforum embedding vectors");
    const docs = await buildDevforumEmbedDocs(deps.store);
    const count = await deps.embeddingIndexer.indexSource("devforum", docs);
    reporter.onPhaseEnd?.("embed", {
      elapsedMs: Date.now() - embedStartedAt,
      detail: `${count} vectors`,
    });
    if (deps.syncManager) {
      await markSeedSourceComplete(deps.syncManager, "devforum", {
        seededItems: result.added,
        embeddingsComplete: true,
        embeddingsCount: count,
      });
    }
  } else if (deps.syncManager && (result.added > 0 || result.discoveryFromCache)) {
    await markSeedSourceComplete(deps.syncManager, "devforum", { seededItems: result.added });
  }

  return result;
}

async function getDevforumEmbedMetadata(
  syncManager: SeedSyncManager | undefined,
): Promise<{ embeddingsComplete?: boolean; embeddingsCount?: number } | undefined> {
  if (!syncManager) return undefined;
  const state = await syncManager.getSourceState("seed:devforum");
  const meta = state?.metadata;
  if (typeof meta !== "object" || meta === null) return undefined;
  const m = meta as Record<string, unknown>;
  return {
    ...(m.embeddingsComplete === true ? { embeddingsComplete: true } : {}),
    ...(typeof m.embeddingsCount === "number" ? { embeddingsCount: m.embeddingsCount } : {}),
  };
}

export function createSeedSourceRunners(deps: SeedRunnersDeps): SeedSourceRunner[] {
  const totals = DEFAULT_ESTIMATED_TOTALS;

  return [
    {
      source: "docs",
      estimatedTotal: totals.docs,
      batchSize: totals.docs,
      runBatch: async () => {
        await runDocsSeed(deps);
        return { processed: totals.docs, done: true, logDetail: "full API index" };
      },
      ...(deps.embeddingIndexer
        ? {
            buildEmbeddings: async () => {
              const indexer = deps.embeddingIndexer;
              if (!indexer) return undefined;
              const docs = await buildDocsEmbedDocs(deps.githubToken);
              const count = await indexer.indexSource("docs", docs);
              if (deps.syncManager) {
                await markSeedSourceComplete(deps.syncManager, "docs", {
                  embeddingsComplete: true,
                  embeddingsCount: count,
                });
              }
              return count;
            },
          }
        : {}),
    },
    {
      source: "guides",
      estimatedTotal: totals.guides,
      batchSize: totals.guides,
      runBatch: async () => {
        await runGuidesSeed(deps);
        return { processed: totals.guides, done: true, logDetail: "full guides index" };
      },
      ...(deps.embeddingIndexer
        ? {
            buildEmbeddings: async () => {
              const indexer = deps.embeddingIndexer;
              if (!indexer) return undefined;
              const docs = await buildGuidesEmbedDocs(deps.githubToken);
              const count = await indexer.indexSource("guides", docs);
              if (deps.syncManager) {
                await markSeedSourceComplete(deps.syncManager, "guides", {
                  embeddingsComplete: true,
                  embeddingsCount: count,
                });
              }
              return count;
            },
          }
        : {}),
    },
    {
      source: "fastflags",
      estimatedTotal: totals.fastflags,
      batchSize: totals.fastflags,
      runBatch: async () => {
        await runFastflagsSeed(deps);
        return {
          processed: totals.fastflags,
          done: true,
          needsRebuild: true,
          logDetail: "full fastflags seed",
        };
      },
      ...(deps.embeddingIndexer
        ? {
            buildEmbeddings: async () => {
              const indexer = deps.embeddingIndexer;
              if (!indexer) return undefined;
              const docs = await buildFastflagsEmbedDocs(deps.store);
              const count = await indexer.indexSource("fastflags", docs);
              if (deps.syncManager) {
                await markSeedSourceComplete(deps.syncManager, "fastflags", {
                  embeddingsComplete: true,
                  embeddingsCount: count,
                });
              }
              return count;
            },
          }
        : {}),
    },
    {
      source: "devforum",
      estimatedTotal: totals.devforum,
      batchSize: totals.devforum,
      runBatch: async () => {
        await runDevforumSeed(deps);
        return {
          processed: totals.devforum,
          done: true,
          needsRebuild: true,
          logDetail: "full devforum seed",
        };
      },
      ...(deps.embeddingIndexer
        ? {
            buildEmbeddings: async () => {
              const indexer = deps.embeddingIndexer;
              if (!indexer) return undefined;
              const docs = await buildDevforumEmbedDocs(deps.store);
              const count = await indexer.indexSource("devforum", docs);
              if (deps.syncManager) {
                await markSeedSourceComplete(deps.syncManager, "devforum", {
                  embeddingsComplete: true,
                  embeddingsCount: count,
                });
              }
              return count;
            },
          }
        : {}),
    },
  ];
}
