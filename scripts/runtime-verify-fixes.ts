/**
 * Runtime verification for seed/warm-cache/embed fixes.
 * Usage: pnpm exec tsx scripts/runtime-verify-fixes.ts
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { createSeedSourceRunners } from "../src/seed/runners.js";
import {
  detectWarmSources,
  sourceNeedsEmbeddings,
  WARM_KV_MIN_COUNTS,
} from "../src/scheduler/warm-cache.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import type { IKeyValueStore } from "../src/store/store-interface.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  console.error(`ok: ${message}`);
}

async function main(): Promise<void> {
  const tmpDir = join("/tmp", `rodocs-runtime-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const store = new SqliteStore({ cacheDir: tmpDir });
  await store.open();

  try {
    await store.put("devforum:1", { id: 1 });
    let warm = await detectWarmSources({ store });
    assert(!warm.includes("devforum"), "single devforum key is not warm");

    for (let i = 2; i <= WARM_KV_MIN_COUNTS.devforum; i++) {
      await store.put(`devforum:${i}`, { id: i });
    }
    warm = await detectWarmSources({ store });
    assert(warm.includes("devforum"), `devforum warm at ${WARM_KV_MIN_COUNTS.devforum} keys`);

    assert(await store.countByPrefix("devforum:") === WARM_KV_MIN_COUNTS.devforum, "countByPrefix");

    const db = store.getDb();
    assert(sourceNeedsEmbeddings(db, "devforum"), "empty vec needs embeddings");

    loadSqliteVec(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
        id TEXT PRIMARY KEY,
        source TEXT,
        embedding FLOAT[384]
      )
    `);
    db.prepare("INSERT INTO vec_items (id, source, embedding) VALUES (?, ?, ?)").run(
      "devforum:1",
      "devforum",
      new Float32Array(384).fill(0.1),
    );
    assert(sourceNeedsEmbeddings(db, "devforum"), "partial vec without metadata needs embed");
    assert(
      !sourceNeedsEmbeddings(db, "devforum", {
        embeddingsComplete: true,
        embeddingsCount: 1,
      }),
      "complete metadata with matching count skips embed",
    );

    const runners = createSeedSourceRunners({
      store: store as IKeyValueStore,
      githubToken: undefined,
      embeddingIndexer: null,
      fastFlagScraper: { seed: async () => ({ added: 0, updated: 0 }) } as never,
      devForumPipeline: { seed: async () => ({ added: 0, lowScore: 0, failed: 0, rejected: 0, bm25Invalidated: false, discoveryFromCache: false }) } as never,
    });
    assert(
      runners.every((r) => r.batchSize === r.estimatedTotal),
      "seed runners use honest one-shot batch sizes",
    );

    console.error("\nAll runtime checks passed.");
  } finally {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});