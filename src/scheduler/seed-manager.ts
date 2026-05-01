import type { SyncState } from "../store/sync-state.js";
import type { IdleDetector } from "./idle-detector.js";
import type { RateLimiter } from "./rate-limiter.js";

export const SEED_SOURCES = ["docs", "guides", "fastflags", "devforum"] as const;
export type SeedSource = (typeof SEED_SOURCES)[number];

export type SeedStatus = "pending" | "seeding" | "partial" | "complete";

export interface SeedProgress {
  source: SeedSource;
  status: SeedStatus;
  seededItems: number;
  estimatedTotal: number;
  percent: number;
  cursor?: string;
  needsRebuild?: boolean;
}

export interface SeedBatchContext {
  source: SeedSource;
  cursor?: string;
  batchSize: number;
}

export interface SeedBatchResult {
  processed: number;
  done: boolean;
  cursor?: string;
  estimatedTotal?: number;
  needsRebuild?: boolean;
  logDetail?: string;
}

export interface SeedSourceRunner {
  source: SeedSource;
  estimatedTotal: number;
  batchSize: number;
  runBatch: (context: SeedBatchContext) => Promise<SeedBatchResult>;
  rebuildIndex?: () => Promise<void>;
}

export interface SeedManagerOptions {
  syncManager: SeedSyncManager;
  idleDetector: Pick<IdleDetector, "isIdle">;
  runners?: SeedSourceRunner[];
  rateLimiters?: Partial<Record<SeedSource, Pick<RateLimiter, "acquire">>>;
  logger?: SeedLogger;
  yieldFn?: () => Promise<void>;
}

export interface SeedSyncManager {
  getSourceState(sourceKey: string): Promise<SyncState | null>;
  updateSourceState(sourceKey: string, state: Partial<SyncState>): Promise<void>;
}

export interface SeedLogger {
  error(message: string): void;
}

export const DEFAULT_SEED_BATCH_SIZES: Record<SeedSource, number> = {
  docs: 50,
  guides: 50,
  fastflags: 3,
  devforum: 20,
};

const DEFAULT_ESTIMATED_TOTALS: Record<SeedSource, number> = {
  docs: 350,
  guides: 350,
  fastflags: 12,
  devforum: 100,
};

const DEFAULT_PRIORITY: SeedSource[] = ["docs", "guides", "fastflags", "devforum"];

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function progressKey(source: SeedSource): string {
  return `seed:${source}`;
}

function calculatePercent(seededItems: number, estimatedTotal: number): number {
  if (estimatedTotal <= 0) return 0;
  return Math.min(1, seededItems / estimatedTotal);
}

function isProgress(value: unknown, source: SeedSource): value is SeedProgress {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SeedProgress>;
  return (
    candidate.source === source &&
    typeof candidate.seededItems === "number" &&
    typeof candidate.estimatedTotal === "number" &&
    typeof candidate.percent === "number" &&
    (candidate.status === "pending" ||
      candidate.status === "seeding" ||
      candidate.status === "partial" ||
      candidate.status === "complete")
  );
}

export class SeedManager {
  private readonly syncManager: SeedSyncManager;
  private readonly idleDetector: Pick<IdleDetector, "isIdle">;
  private readonly runners = new Map<SeedSource, SeedSourceRunner>();
  private readonly rateLimiters: Partial<Record<SeedSource, Pick<RateLimiter, "acquire">>>;
  private readonly logger: SeedLogger;
  private readonly yieldFn: () => Promise<void>;
  private readonly priorityQueue: SeedSource[] = [...DEFAULT_PRIORITY];
  private readonly demandedSources = new Set<SeedSource>();
  private readonly progress = new Map<SeedSource, SeedProgress>();
  private running = false;
  private scheduled = false;
  private startedAt = 0;

  constructor(options: SeedManagerOptions) {
    this.syncManager = options.syncManager;
    this.idleDetector = options.idleDetector;
    this.rateLimiters = options.rateLimiters ?? {};
    this.logger = options.logger ?? console;
    this.yieldFn = options.yieldFn ?? defaultYield;

    for (const source of SEED_SOURCES) {
      this.progress.set(source, this.createInitialProgress(source));
    }

    for (const runner of options.runners ?? []) {
      this.runners.set(runner.source, runner);
      this.progress.set(runner.source, this.createInitialProgress(runner.source, runner));
    }
  }

  async loadPersistedProgress(): Promise<void> {
    for (const source of SEED_SOURCES) {
      const state = await this.syncManager.getSourceState(progressKey(source));
      const persisted = state?.metadata?.seedProgress;
      if (isProgress(persisted, source)) {
        this.progress.set(source, persisted);
      }
    }
  }

  startBackground(): void {
    if (this.running || this.scheduled) return;
    this.startedAt = Date.now();
    this.logger.error("[Seed] startup: store empty, scheduling background seed");
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.scheduled = false;
  }

  prioritize(source: SeedSource): void {
    this.demandedSources.add(source);
    this.moveToFront(source);
    this.scheduleNext();
  }

  getProgress(source: SeedSource): SeedProgress {
    return this.progress.get(source) ?? this.createInitialProgress(source);
  }

  getAllProgress(): Record<SeedSource, SeedProgress> {
    return {
      docs: this.getProgress("docs"),
      guides: this.getProgress("guides"),
      fastflags: this.getProgress("fastflags"),
      devforum: this.getProgress("devforum"),
    };
  }

  async processNextBatch(): Promise<boolean> {
    if (this.running) return false;

    const source = this.nextSource();
    if (source === null) {
      this.logAllComplete();
      return false;
    }

    const canRunNow = this.idleDetector.isIdle() || this.demandedSources.has(source);
    if (!canRunNow) {
      await this.yieldFn();
      return false;
    }

    const runner = this.runners.get(source);
    if (!runner) {
      await this.markComplete(source, 0, true);
      await this.yieldFn();
      return true;
    }

    this.running = true;
    try {
      await this.rateLimiters[source]?.acquire();
      await this.runBatch(source, runner);
      this.demandedSources.delete(source);
      await this.yieldFn();
      return true;
    } finally {
      this.running = false;
    }
  }

  private async runBatch(source: SeedSource, runner: SeedSourceRunner): Promise<void> {
    const current = this.getProgress(source);
    const seeding: SeedProgress = {
      ...current,
      status: "seeding",
      estimatedTotal: current.estimatedTotal || runner.estimatedTotal,
    };
    this.progress.set(source, seeding);
    await this.persistProgress(seeding);

    const context: SeedBatchContext = {
      source,
      batchSize: runner.batchSize,
    };
    if (current.cursor !== undefined) context.cursor = current.cursor;

    const result = await runner.runBatch(context);

    const estimatedTotal = result.estimatedTotal ?? seeding.estimatedTotal;
    const seededItems = Math.min(estimatedTotal, seeding.seededItems + result.processed);
    const status: SeedStatus = result.done ? "complete" : "partial";
    const updated: SeedProgress = {
      source,
      status,
      seededItems,
      estimatedTotal,
      percent: result.done ? 1 : calculatePercent(seededItems, estimatedTotal),
    };
    const needsRebuild = result.needsRebuild ?? seeding.needsRebuild;
    if (needsRebuild !== undefined) updated.needsRebuild = needsRebuild;

    if (!result.done && result.cursor !== undefined) {
      updated.cursor = result.cursor;
    }

    this.progress.set(source, updated);
    await this.persistProgress(updated);
    this.logBatch(source, result, updated, runner.batchSize);

    if (updated.status === "complete") {
      if (updated.needsRebuild) {
        await runner.rebuildIndex?.();
      }
      this.logger.error(`[Seed] ${source}: complete (${updated.seededItems} entries)`);
    }
  }

  private async markComplete(
    source: SeedSource,
    seededItems: number,
    silent = false,
  ): Promise<void> {
    const current = this.getProgress(source);
    const updated: SeedProgress = {
      source,
      status: "complete",
      seededItems,
      estimatedTotal: Math.max(current.estimatedTotal, seededItems),
      percent: 1,
    };
    this.progress.set(source, updated);
    await this.persistProgress(updated);
    if (!silent) this.logger.error(`[Seed] ${source}: complete (${seededItems} entries)`);
  }

  private async persistProgress(progress: SeedProgress): Promise<void> {
    const state: Partial<SyncState> = {
      metadata: { seedProgress: progress },
    };
    if (progress.status === "complete") state.lastSyncAt = Date.now();
    await this.syncManager.updateSourceState(progressKey(progress.source), state);
  }

  private scheduleNext(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      void this.processNextBatch().then((processed) => {
        if (processed || this.nextSource() !== null) {
          this.scheduleNext();
        }
      });
    }, 0);
  }

  private nextSource(): SeedSource | null {
    for (const source of this.priorityQueue) {
      if (this.getProgress(source).status !== "complete") return source;
    }
    return null;
  }

  private moveToFront(source: SeedSource): void {
    const currentIndex = this.priorityQueue.indexOf(source);
    if (currentIndex >= 0) this.priorityQueue.splice(currentIndex, 1);
    this.priorityQueue.unshift(source);
  }

  private createInitialProgress(source: SeedSource, runner?: SeedSourceRunner): SeedProgress {
    const estimatedTotal = runner?.estimatedTotal ?? DEFAULT_ESTIMATED_TOTALS[source];
    return {
      source,
      status: "pending",
      seededItems: 0,
      estimatedTotal,
      percent: 0,
    };
  }

  private logBatch(
    source: SeedSource,
    result: SeedBatchResult,
    progress: SeedProgress,
    batchSize: number,
  ): void {
    const totalBatches = Math.max(1, Math.ceil(progress.estimatedTotal / batchSize));
    const currentBatch = Math.min(totalBatches, Math.ceil(progress.seededItems / batchSize));
    const detail = result.logDetail ?? `${result.processed} items`;
    this.logger.error(`[Seed] ${source}: batch ${currentBatch}/${totalBatches} (${detail})`);
  }

  private logAllComplete(): void {
    if (this.startedAt === 0) return;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    this.logger.error(`[Seed] all sources seeded in ${elapsedSeconds}s (non-blocking)`);
    this.startedAt = 0;
  }
}
