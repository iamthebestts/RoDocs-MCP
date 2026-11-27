import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SeedSource } from "./seed-manager.js";

export type WarmCacheContext = {
  store: IKeyValueStore;
};

export type EmbeddingSyncMetadata = {
  embeddingsComplete?: boolean;
  embeddingsCount?: number;
};

const BM25_INDEX_FILES: Readonly<Record<"docs" | "guides", string>> = {
  docs: "api.index.msgpack",
  guides: "guides.index.msgpack",
};

const KV_PREFIXES: Readonly<Record<"fastflags" | "devforum", string>> = {
  fastflags: "fastflags:",
  devforum: "devforum:",
};

/** Minimum KV rows required before treating a source as warm. */
export const WARM_KV_MIN_COUNTS: Readonly<Record<"fastflags" | "devforum", number>> = {
  fastflags: 3,
  devforum: 5,
};

export function resolveCacheDir(store: IKeyValueStore): string {
  return dirname(store.getPath());
}

export async function detectWarmSources(ctx: WarmCacheContext): Promise<SeedSource[]> {
  const cacheDir = resolveCacheDir(ctx.store);
  const warm = new Set<SeedSource>();

  for (const [source, file] of Object.entries(BM25_INDEX_FILES) as Array<
    ["docs" | "guides", string]
  >) {
    if (existsSync(join(cacheDir, file))) warm.add(source);
  }

  for (const [source, prefix] of Object.entries(KV_PREFIXES) as Array<
    ["fastflags" | "devforum", string]
  >) {
    const count = await ctx.store.countByPrefix(prefix);
    if (count >= WARM_KV_MIN_COUNTS[source]) warm.add(source);
  }

  return [...warm];
}

export function countEmbeddingsForSource(db: Database.Database, source: string): number {
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM vec_items WHERE source = ?")
      .get(source) as { count: number } | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export function sourceNeedsEmbeddings(
  db: Database.Database | null | undefined,
  source: SeedSource,
  metadata?: EmbeddingSyncMetadata,
): boolean {
  if (!db) return false;
  const actual = countEmbeddingsForSource(db, source);
  if (actual === 0) return true;

  if (metadata?.embeddingsComplete === true && metadata.embeddingsCount !== undefined) {
    return actual < metadata.embeddingsCount;
  }

  if (metadata?.embeddingsComplete !== true) {
    return true;
  }

  return false;
}
