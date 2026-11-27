import type Database from "better-sqlite3";
import type { SeedSource } from "../scheduler/seed-manager.js";
import type { IKeyValueStore, SyncStateManager } from "../store/index.js";

export const CACHE_SEED_SOURCES: readonly SeedSource[] = [
  "docs",
  "guides",
  "fastflags",
  "devforum",
] as const;

export interface SourceCacheStatus {
  source: SeedSource;
  records: number | null;
  vectors: number | null;
  persistedStatus: string;
  lastSyncAt: string | null;
  embeddingsComplete: boolean;
  embeddingsCount: number | null;
}

export interface CacheStatusSnapshot {
  cachePath: string | null;
  sqliteVecAvailable: boolean;
  sources: SourceCacheStatus[];
}

export function maybeStorePath(store: IKeyValueStore): string | undefined {
  const candidate = store as IKeyValueStore & { getPath?: () => string };
  return typeof candidate.getPath === "function" ? candidate.getPath() : undefined;
}

export function maybeStoreDb(store: IKeyValueStore): Database.Database | undefined {
  const candidate = store as IKeyValueStore & { getDb?: () => Database.Database };
  return typeof candidate.getDb === "function" ? candidate.getDb() : undefined;
}

export function formatIsoTimestamp(ms: number | undefined): string | null {
  return typeof ms === "number" ? new Date(ms).toISOString() : null;
}

export function readPersistedSeedStatus(metadata: Record<string, unknown> | undefined): string {
  const progress = metadata?.seedProgress;
  if (typeof progress !== "object" || progress === null) return "unknown";
  const status = (progress as Record<string, unknown>).status;
  return typeof status === "string" ? status : "unknown";
}

export function readVectorCounts(store: IKeyValueStore): {
  available: boolean;
  counts: Map<string, number>;
} {
  const db = maybeStoreDb(store);
  if (db === undefined) return { available: false, counts: new Map() };
  try {
    const rows = db
      .prepare<[], { source: string; count: number }>(
        "SELECT source, COUNT(*) AS count FROM vec_items GROUP BY source",
      )
      .all();
    return {
      available: true,
      counts: new Map(rows.map((row) => [row.source, row.count])),
    };
  } catch {
    return { available: false, counts: new Map() };
  }
}

export async function readCacheStatus(
  store: IKeyValueStore,
  syncManager: Pick<SyncStateManager, "getSourceState">,
  sources: readonly SeedSource[] = CACHE_SEED_SOURCES,
): Promise<CacheStatusSnapshot> {
  const { available: sqliteVecAvailable, counts: vectorCounts } = readVectorCounts(store);
  const details: SourceCacheStatus[] = [];

  for (const source of sources) {
    const state = await syncManager.getSourceState(`seed:${source}`);
    const metadata = state?.metadata;
    const embeddingsCount =
      typeof metadata?.embeddingsCount === "number" ? metadata.embeddingsCount : null;
    const records =
      source === "fastflags" || source === "devforum"
        ? await store.countByPrefix(`${source}:`)
        : null;

    details.push({
      source,
      records,
      vectors: vectorCounts.get(source) ?? null,
      persistedStatus: readPersistedSeedStatus(metadata),
      lastSyncAt: formatIsoTimestamp(state?.lastSyncAt),
      embeddingsComplete: metadata?.embeddingsComplete === true,
      embeddingsCount,
    });
  }

  return {
    cachePath: maybeStorePath(store) ?? null,
    sqliteVecAvailable,
    sources: details,
  };
}
