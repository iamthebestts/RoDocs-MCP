import type { SeedProgressReporter } from "../seed/progress.js";
import { noopSeedProgress, throttleStep } from "../seed/progress.js";
import type { IKeyValueStore, Indexer, SyncStateManager } from "../store/index.js";
import { logger } from "../utils/logger.js";
import { Semaphore } from "../utils/semaphore.js";
import {
  candidatesToMap,
  loadDiscoveryCache,
  mapToSerialized,
  saveDiscoveryCache,
} from "./discovery-cache.js";
import { DevForumFetcher } from "./fetcher.js";
import { shouldRejectTopic } from "./filters.js";
import { DEVFORUM_HTTP_CONCURRENCY } from "./http.js";
import { processTopic } from "./processor.js";
import { EXPANDED_QUERIES, GOLD_CATEGORIES } from "./sources.js";
import type { DevForumTopic } from "./types.js";

type IntRange = { min: number; max: number; default: number };

function readIntEnv(name: string, range: IntRange): number {
  const raw = process.env[name];
  if (!raw) return range.default;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < range.min || parsed > range.max) {
    return range.default;
  }
  return parsed;
}

function readBoolEnv(name: string): boolean {
  const raw = process.env[name];
  return raw === "1" || raw === "true";
}

const CONFIG = Object.freeze({
  maxTopicsTotal: readIntEnv("RODOCS_DEVFORUM_MAX_TOPICS", {
    min: 1,
    max: 2000,
    default: 300,
  }),
  perQueryCap: readIntEnv("RODOCS_DEVFORUM_PER_QUERY_CAP", {
    min: 1,
    max: 100,
    default: 10,
  }),
  perTopListCap: readIntEnv("RODOCS_DEVFORUM_PER_TOP_LIST_CAP", {
    min: 1,
    max: 100,
    default: 15,
  }),
  perCategoryTopGold: readIntEnv("RODOCS_DEVFORUM_PER_CAT_TOP_GOLD", {
    min: 1,
    max: 100,
    default: 20,
  }),
  perCategoryTopHigh: readIntEnv("RODOCS_DEVFORUM_PER_CAT_TOP_HIGH", {
    min: 1,
    max: 100,
    default: 12,
  }),
  perCategoryLatestGold: readIntEnv("RODOCS_DEVFORUM_PER_CAT_LATEST_GOLD", {
    min: 1,
    max: 100,
    default: 10,
  }),
  perCategoryLatestMedium: readIntEnv("RODOCS_DEVFORUM_PER_CAT_LATEST_MEDIUM", {
    min: 1,
    max: 100,
    default: 8,
  }),
  discoveryConcurrency: readIntEnv("RODOCS_DEVFORUM_DISCOVERY_CONCURRENCY", {
    min: 1,
    max: 16,
    default: DEVFORUM_HTTP_CONCURRENCY,
  }),
  topicConcurrency: readIntEnv("RODOCS_DEVFORUM_TOPIC_CONCURRENCY", {
    min: 1,
    max: 16,
    default: DEVFORUM_HTTP_CONCURRENCY,
  }),
  minScore: readIntEnv("RODOCS_DEVFORUM_MIN_SCORE", {
    min: 0,
    max: 100,
    default: 40,
  }),
  maxRetries: readIntEnv("RODOCS_DEVFORUM_MAX_RETRIES", {
    min: 0,
    max: 5,
    default: 2,
  }),
  retryBaseMs: readIntEnv("RODOCS_DEVFORUM_RETRY_BASE_MS", {
    min: 100,
    max: 10000,
    default: 800,
  }),
  maxQueries: readIntEnv("RODOCS_DEVFORUM_MAX_QUERIES", {
    min: 0,
    max: EXPANDED_QUERIES.length,
    default: 40,
  }),
  skipSearch: readBoolEnv("RODOCS_DEVFORUM_SKIP_SEARCH"),
  refreshDiscovery: readBoolEnv("RODOCS_DEVFORUM_REFRESH_DISCOVERY"),
  discoveryCacheTtlMs:
    readIntEnv("RODOCS_DEVFORUM_DISCOVERY_CACHE_HOURS", {
      min: 1,
      max: 168,
      default: 24,
    }) *
    60 *
    60 *
    1000,
} as const);

type SourceWeight = 0 | 1 | 2 | 3 | 4;
type CategoryWeight = "gold" | "high" | "medium";
type DiscoveryTier = "top" | "category" | "search";

type DiscoveryCandidate = {
  topic: DevForumTopic;
  source: string;
  tier: DiscoveryTier;
  categoryWeight?: CategoryWeight;
  weight: SourceWeight;
};

// Persisted shape — keep stable for sync_state consumers.
type SourceCounters = {
  topMonthly: number;
  gold: number;
  high: number;
  medium: number;
  search: number;
};

const CATEGORY_WEIGHT_TO_NUM: Record<CategoryWeight, SourceWeight> = {
  gold: 3,
  high: 2,
  medium: 1,
};

const TRANSIENT_RE =
  /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|status code (?:202|408|425|429)|status code 5\d\d|Invalid DevForum response|missing post_stream/i;

function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return TRANSIENT_RE.test(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DevForumPipeline {
  public fetcher: DevForumFetcher;
  private semaphore: Semaphore;
  private discoverySemaphore: Semaphore;

  constructor(
    private readonly store: IKeyValueStore,
    private readonly syncManager: SyncStateManager,
    private readonly indexer: Indexer,
  ) {
    this.fetcher = new DevForumFetcher();
    this.semaphore = new Semaphore(CONFIG.topicConcurrency);
    this.discoverySemaphore = new Semaphore(CONFIG.discoveryConcurrency);
  }

  async seed(options?: { reporter?: SeedProgressReporter }): Promise<{
    added: number;
    lowScore: number;
    failed: number;
    rejected: number;
    bm25Invalidated: boolean;
    discoveryFromCache: boolean;
  }> {
    const reporter = throttleStep(options?.reporter ?? noopSeedProgress, 500);
    const seedStartedAt = Date.now();
    let phaseStartedAt = seedStartedAt;
    const startPhase = (phase: string, detail?: string) => {
      phaseStartedAt = Date.now();
      reporter.onPhase(phase, detail);
    };
    const endPhase = (phase: string, detail?: string) => {
      reporter.onPhaseEnd?.(phase, {
        elapsedMs: Date.now() - phaseStartedAt,
        ...(detail ? { detail } : {}),
      });
    };

    let added = 0;
    let lowScore = 0;
    let failed = 0;
    let inFlight = 0;
    let bm25Invalidated = false;
    let discoveryFromCache = false;

    const activeQueries = CONFIG.skipSearch ? [] : EXPANDED_QUERIES.slice(0, CONFIG.maxQueries);

    logger.info("[DevForumPipeline] Starting seed process...");

    const candidateTopics = new Map<number, DiscoveryCandidate>();

    if (!CONFIG.refreshDiscovery) {
      const cached = await loadDiscoveryCache(this.syncManager, CONFIG.discoveryCacheTtlMs);
      if (cached) {
        discoveryFromCache = true;
        const restored = candidatesToMap(cached.candidates);
        for (const [id, cand] of restored) {
          candidateTopics.set(id, cand);
        }
        startPhase("discovery", `${cached.candidates.length} candidates from cache`);
        endPhase("discovery", `${cached.candidates.length} cached`);
      }
    }

    if (!discoveryFromCache) {
      startPhase("categories", "resolving DevForum category map");

      const categories = await this.fetcher.getCategories();
      const goldCategoryMap = new Map<string, number>();
      for (const cat of categories) {
        if (GOLD_CATEGORIES.some((gc) => gc.slug === cat.slug)) {
          goldCategoryMap.set(cat.slug, cat.id);
        }
      }

      endPhase("categories");

      const discoveryStats = await this.runDiscovery(
        candidateTopics,
        goldCategoryMap,
        activeQueries,
        startPhase,
        reporter,
      );
      endPhase(
        "discovery",
        `${candidateTopics.size} unique · ${discoveryStats.discoveryTotal} fetches · ${discoveryStats.queryCount} queries`,
      );
    }

    startPhase("rank", "scoring and capping topic candidates");

    const uniqueTopics = Array.from(candidateTopics.values())
      .map((c) => {
        const t = c.topic;
        const ageDays = t.created_at
          ? Math.max(0, (Date.now() - new Date(t.created_at).getTime()) / 86_400_000)
          : 0;
        const recencyBoost = ageDays > 0 && ageDays < 365 ? 5 : 0;
        const acceptedBoost = t.has_accepted_answer ? 15 : 0;
        const scoreEstimate =
          Math.min(t.views / 500, 30) +
          Math.min(t.like_count * 2, 30) +
          Math.min(t.reply_count ?? 0, 10) +
          acceptedBoost +
          recencyBoost;
        return { ...c, scoreEstimate };
      })
      .sort((a, b) => b.weight * 1000 + b.scoreEstimate - (a.weight * 1000 + a.scoreEstimate))
      .slice(0, CONFIG.maxTopicsTotal);

    logger.info(
      `[DevForum] discovery fromCache=${discoveryFromCache} unique=${candidateTopics.size} after-prefilter=${uniqueTopics.length} capped=${CONFIG.maxTopicsTotal}`,
    );
    reporter.onNote(
      `candidates: ${candidateTopics.size} unique → ${uniqueTopics.length} after rank (cap ${CONFIG.maxTopicsTotal})`,
    );
    endPhase("rank", `${uniqueTopics.length} selected`);

    startPhase("fetch", `downloading ${uniqueTopics.length} topic details`);
    const sourceCounters: SourceCounters = {
      topMonthly: 0,
      gold: 0,
      high: 0,
      medium: 0,
      search: 0,
    };

    const heartbeat = setInterval(() => {
      const done = added + lowScore + failed;
      reporter.onStep(
        done,
        uniqueTopics.length,
        `added=${added} low=${lowScore} failed=${failed} in-flight=${inFlight}`,
      );
      logger.debug(
        `[DevForum] heartbeat in-flight=${inFlight} done=${done}/${uniqueTopics.length} added=${added} lowScore=${lowScore} failed=${failed} ${this.formatMix(sourceCounters)}`,
      );
    }, 3000);
    heartbeat.unref();

    try {
      await Promise.allSettled(
        uniqueTopics.map(async (cand, i) => {
          const { topic: t, source, weight } = cand;
          await this.semaphore.acquire();
          inFlight++;
          const startedAt = Date.now();
          logger.debug(
            `[DevForum] [${i + 1}/${uniqueTopics.length}] start topic=${t.id} source=${source}`,
          );

          try {
            const detail = await this.fetchTopicWithRetry(t.id);
            const record = processTopic(detail, weight);
            record.source = source;
            const elapsedMs = Date.now() - startedAt;

            if (record.score < CONFIG.minScore) {
              lowScore++;
              logger.debug(
                `[DevForum] [${i + 1}/${uniqueTopics.length}] done  topic=${t.id} score=${record.score} lowScore in ${(elapsedMs / 1000).toFixed(1)}s source=${source}`,
              );
            } else {
              await this.store.put(`devforum:${record.id}`, record);
              added++;
              this.bumpCounters(sourceCounters, cand);
              logger.debug(
                `[DevForum] [${i + 1}/${uniqueTopics.length}] done  topic=${t.id} score=${record.score} added in ${(elapsedMs / 1000).toFixed(1)}s source=${source} "${record.title}"`,
              );
            }
          } catch (e) {
            failed++;
            const reason = e instanceof Error ? e.message : String(e);
            logger.warn(
              `[DevForum] [${i + 1}/${uniqueTopics.length}] failed topic=${t.id} reason=${reason}`,
            );
          } finally {
            inFlight--;
            this.semaphore.release();
            const done = added + lowScore + failed;
            reporter.onStep(
              done,
              uniqueTopics.length,
              `added=${added} low=${lowScore} failed=${failed}`,
            );
          }
        }),
      );
    } finally {
      clearInterval(heartbeat);
    }

    endPhase(
      "fetch",
      `added=${added} low=${lowScore} failed=${failed} · ${this.formatMix(sourceCounters)}`,
    );

    if (added > 0) {
      startPhase("index", "invalidating DevForum BM25 cache");
      await this.indexer.clear("devforum");
      bm25Invalidated = true;
      endPhase("index");
    }

    const existingState = await this.syncManager.getSourceState("devforum");
    await this.syncManager.updateSourceState("devforum", {
      lastSyncAt: Date.now(),
      lastBumpedAt: new Date().toISOString(),
      topicCount: uniqueTopics.length,
      addedCount: added,
      metadata: {
        ...(existingState?.metadata ?? {}),
        sourceMix: sourceCounters,
      },
    });

    const rejected = uniqueTopics.length - added - lowScore - failed;
    const elapsedMs = Date.now() - seedStartedAt;
    logger.info(
      `[DevForum] done in ${(elapsedMs / 1000).toFixed(1)}s. added=${added} lowScore=${lowScore} failed=${failed}. store=${added}. BM25 invalidated=${bm25Invalidated}. cache=${discoveryFromCache}. ${this.formatMix(sourceCounters)}`,
    );

    reporter.onFinish?.({
      elapsedMs,
      added,
      lowScore,
      failed,
      rejected,
      ...(discoveryFromCache ? { detail: "discovery from cache" } : {}),
    });

    return {
      added,
      lowScore,
      failed,
      rejected,
      bm25Invalidated,
      discoveryFromCache,
    };
  }

  private async runDiscovery(
    candidateTopics: Map<number, DiscoveryCandidate>,
    goldCategoryMap: Map<string, number>,
    activeQueries: readonly string[],
    startPhase: (phase: string, detail?: string) => void,
    reporter: SeedProgressReporter,
  ): Promise<{ discoveryTotal: number; queryCount: number }> {
    const upsertCandidate = (cand: DiscoveryCandidate) => {
      const existing = candidateTopics.get(cand.topic.id);
      if (!existing || cand.weight > existing.weight) {
        candidateTopics.set(cand.topic.id, cand);
      }
    };

    const discoveryTasks: Array<() => Promise<void>> = [];

    const topPeriods = ["monthly", "yearly", "all"] as const;
    for (const period of topPeriods) {
      discoveryTasks.push(async () => {
        await this.discoverySemaphore.acquire();
        try {
          const topics =
            period === "monthly"
              ? await this.fetcher.getTopMonthly()
              : period === "yearly"
                ? await this.fetcher.getTopYearly()
                : await this.fetcher.getTopAllTime();
          const source = `top-${period}`;
          for (const t of topics.slice(0, CONFIG.perTopListCap)) {
            if (!shouldRejectTopic(t, source)) {
              upsertCandidate({ topic: t, source, tier: "top", weight: 4 });
            }
          }
        } finally {
          this.discoverySemaphore.release();
        }
      });
    }

    const unresolvedSlugs: string[] = [];
    for (const gc of GOLD_CATEGORIES) {
      const id = goldCategoryMap.get(gc.slug);
      if (!id) {
        unresolvedSlugs.push(gc.slug);
        continue;
      }
      const numericWeight = CATEGORY_WEIGHT_TO_NUM[gc.weight];

      if (gc.weight !== "medium") {
        const limit = gc.weight === "gold" ? CONFIG.perCategoryTopGold : CONFIG.perCategoryTopHigh;
        discoveryTasks.push(async () => {
          await this.discoverySemaphore.acquire();
          try {
            const topics = await this.fetcher.getCategoryTop(gc.slug, id, "monthly");
            const source = `category-top:${gc.slug}`;
            for (const t of topics.slice(0, limit)) {
              if (!shouldRejectTopic(t, source)) {
                upsertCandidate({
                  topic: t,
                  source,
                  tier: "category",
                  categoryWeight: gc.weight,
                  weight: numericWeight,
                });
              }
            }
          } finally {
            this.discoverySemaphore.release();
          }
        });
      }

      const latestLimit =
        gc.weight === "gold" ? CONFIG.perCategoryLatestGold : CONFIG.perCategoryLatestMedium;
      discoveryTasks.push(async () => {
        await this.discoverySemaphore.acquire();
        try {
          const topics = await this.fetcher.getCategoryLatest(gc.slug, id);
          const source = `category-latest:${gc.slug}`;
          for (const t of topics.slice(0, latestLimit)) {
            if (!shouldRejectTopic(t, source)) {
              upsertCandidate({
                topic: t,
                source,
                tier: "category",
                categoryWeight: gc.weight,
                weight: numericWeight,
              });
            }
          }
        } finally {
          this.discoverySemaphore.release();
        }
      });
    }

    if (unresolvedSlugs.length > 0) {
      const msg = `unresolved categories: ${unresolvedSlugs.length}`;
      logger.warn(
        `[DevForum] categories-unresolved count=${unresolvedSlugs.length} slugs=${unresolvedSlugs.join(",")}`,
      );
      reporter.onNote(msg);
    }

    for (const query of activeQueries) {
      discoveryTasks.push(async () => {
        await this.discoverySemaphore.acquire();
        try {
          const topics = await this.fetcher.search(query);
          const source = `search:${query}`;
          for (const t of topics.slice(0, CONFIG.perQueryCap)) {
            if (!shouldRejectTopic(t, source)) {
              upsertCandidate({ topic: t, source, tier: "search", weight: 0 });
            }
          }
        } finally {
          this.discoverySemaphore.release();
        }
      });
    }

    const discoveryTotal = discoveryTasks.length;
    let discoveryDone = 0;
    startPhase(
      "discovery",
      `${discoveryTotal} fetches (top, categories, ${activeQueries.length} queries)`,
    );

    await Promise.allSettled(
      discoveryTasks
        .map((task) => async () => {
          try {
            await task();
          } finally {
            discoveryDone++;
            reporter.onStep(discoveryDone, discoveryTotal, "discovery fetches");
          }
        })
        .map((wrapped) => wrapped()),
    );

    await saveDiscoveryCache(this.syncManager, mapToSerialized(candidateTopics));

    const goldCount = GOLD_CATEGORIES.filter((g) => goldCategoryMap.has(g.slug)).length;
    logger.info(
      `[DevForum] discovery sources=top(${topPeriods.length})+cats(${goldCount}/${GOLD_CATEGORIES.length})+queries(${activeQueries.length}) unique=${candidateTopics.size}`,
    );

    return { discoveryTotal, queryCount: activeQueries.length };
  }

  private async fetchTopicWithRetry(
    id: number,
  ): Promise<Awaited<ReturnType<DevForumFetcher["getTopicDetail"]>>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
      try {
        return await this.fetcher.getTopicDetail(id);
      } catch (e) {
        lastErr = e;
        if (attempt === CONFIG.maxRetries || !isTransientError(e)) throw e;
        const backoff = CONFIG.retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 200);
        await delay(backoff);
      }
    }
    throw lastErr;
  }

  private bumpCounters(c: SourceCounters, cand: DiscoveryCandidate) {
    if (cand.tier === "top") c.topMonthly++;
    else if (cand.tier === "search") c.search++;
    else if (cand.categoryWeight) c[cand.categoryWeight]++;
  }

  private formatMix(c: SourceCounters): string {
    return `mix=top=${c.topMonthly} gold=${c.gold} high=${c.high} medium=${c.medium} search=${c.search}`;
  }
}
