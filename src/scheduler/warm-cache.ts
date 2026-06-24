import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { SeedSource } from "./seed-manager.js";

export type WarmCacheContext = {
  store: IKeyValueStore;
};

const BM25_INDEX_FILES: Readonly<Record<"docs" | "guides", string>> = {
  docs: "api.index.msgpack",
  guides: "guides.index.msgpack",
};

const KV_PREFIXES: Readonly<Record<"fastflags" | "devforum", string>> = {
  fastflags: "fastflags:",
  devforum: "devforum:",
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

  const keys = await ctx.store.keys();
  for (const [source, prefix] of Object.entries(KV_PREFIXES) as Array<
    ["fastflags" | "devforum", string]
  >) {
    if (keys.some((key) => key.startsWith(prefix))) warm.add(source);
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
): boolean {
  if (!db) return false;
  return countEmbeddingsForSource(db, source) === 0;
}
