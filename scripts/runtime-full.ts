/**
 * Full runtime verification suite.
 * Usage: pnpm exec tsx scripts/runtime-full.ts
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { runSeedAllCommand, runSeedCommand } from "../src/cli/seed-command.js";
import { DevForumPipeline } from "../src/devforum/pipeline.js";
import { EmbeddingIndexer } from "../src/embedding/embedding-indexer.js";
import { createSeedSourceRunners, runDevforumSeed } from "../src/seed/runners.js";
import {
  detectWarmSources,
  sourceNeedsEmbeddings,
  WARM_KV_MIN_COUNTS,
} from "../src/scheduler/warm-cache.js";
import { createServer } from "../src/server/index.js";
import { createSeedManager } from "../src/server/seed-wiring.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { Indexer } from "../src/store/indexer.js";
import { createSyncStateManager } from "../src/store/index.js";
import type { IKeyValueStore } from "../src/store/store-interface.js";

let passed = 0;
let failed = 0;

function ok(message: string): void {
  passed++;
  console.error(`ok: ${message}`);
}

function fail(message: string): never {
  failed++;
  throw new Error(message);
}

function assert(condition: boolean, message: string): void {
  if (!condition) fail(`ASSERT FAILED: ${message}`);
  ok(message);
}

async function section(name: string, fn: () => Promise<void>): Promise<void> {
  console.error(`\n== ${name} ==`);
  await fn();
}

async function testWarmCacheAndEmbeddings(tmpDir: string): Promise<SqliteStore> {
  const store = new SqliteStore({ cacheDir: tmpDir });
  await store.open();

  await store.put("devforum:1", { id: 1 });
  let warm = await detectWarmSources({ store });
  assert(!warm.includes("devforum"), "single devforum key is not warm");

  for (let i = 2; i <= WARM_KV_MIN_COUNTS.devforum; i++) {
    await store.put(`devforum:${i}`, { id: i });
  }
  warm = await detectWarmSources({ store });
  assert(warm.includes("devforum"), `devforum warm at ${WARM_KV_MIN_COUNTS.devforum} keys`);
  assert(
    (await store.countByPrefix("devforum:")) === WARM_KV_MIN_COUNTS.devforum,
    "countByPrefix matches inserted rows",
  );

  const db = store.getDb();
  loadSqliteVec(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      id TEXT PRIMARY KEY,
      source TEXT,
      embedding FLOAT[384]
    )
  `);
  assert(sourceNeedsEmbeddings(db, "devforum"), "empty vec needs embeddings");

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

  return store;
}

async function testSeedRunners(store: SqliteStore): Promise<void> {
  const syncManager = createSyncStateManager(store);
  const indexer = new Indexer(store, syncManager);

  const runners = createSeedSourceRunners({
    store,
    syncManager,
    githubToken: undefined,
    embeddingIndexer: null,
    fastFlagScraper: { seed: async () => ({ added: 0, updated: 0 }) } as never,
    devForumPipeline: new DevForumPipeline(store, syncManager, indexer),
  });
  assert(
    runners.every((r) => r.batchSize === r.estimatedTotal),
    "seed runners use honest one-shot batch sizes",
  );
  assert(runners.map((r) => r.source).join(",") === "docs,guides,fastflags,devforum", "four seed runners");
}

async function testDevforumEmbedOnCacheHit(store: SqliteStore): Promise<void> {
  const syncManager = createSyncStateManager(store);
  let indexCalls = 0;

  const fakeEmbeddingIndexer = {
    async indexSource(source: string, docs: Array<{ id: string; source: string }>) {
      indexCalls++;
      store.getDb().prepare("DELETE FROM vec_items WHERE source = ?").run(source);
      const upsert = store
        .getDb()
        .prepare("INSERT OR REPLACE INTO vec_items (id, source, embedding) VALUES (?, ?, ?)");
      for (const doc of docs) {
        upsert.run(doc.id, source, new Float32Array(384).fill(0.2));
      }
      return docs.length;
    },
    async clearSource(source: string) {
      store.getDb().prepare("DELETE FROM vec_items WHERE source = ?").run(source);
    },
  } as unknown as EmbeddingIndexer;

  const pipeline = {
    seed: async () => ({
      added: 0,
      lowScore: 0,
      failed: 0,
      rejected: 0,
      bm25Invalidated: false,
      discoveryFromCache: true,
    }),
  } as unknown as DevForumPipeline;

  await runDevforumSeed({
    store,
    syncManager,
    githubToken: undefined,
    embeddingIndexer: fakeEmbeddingIndexer,
    fastFlagScraper: { seed: async () => ({ added: 0, updated: 0 }) } as never,
    devForumPipeline: pipeline,
  });

  const count = (
    store.getDb().prepare("SELECT COUNT(*) AS count FROM vec_items WHERE source = 'devforum'").get() as {
      count: number;
    }
  ).count;
  assert(count === WARM_KV_MIN_COUNTS.devforum, "devforum embeddings built when added=0 and vec was empty");
  assert(indexCalls === 1, "embedding indexer invoked for cache-hit devforum seed");
}

async function testCliSeedCommand(): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | null = null;

  await runSeedCommand({
    source: "docs",
    failureLabel: "docs",
    githubToken: undefined,
    io: {
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line),
      exit: (code) => {
        exitCode = code;
      },
    },
    openContext: async () => ({
      store: { close: async () => undefined } as never,
      syncManager: {} as never,
      indexer: {} as never,
    }),
    createProgress: () => ({
      onPhase: () => {},
      onStep: () => {},
      onNote: () => {},
    }),
    run: async (_ctx, progress) => {
      progress.onPhase("done", "mock");
    },
    formatSuccess: () => "Successfully seeded API docs index.\n",
  });

  assert(stdout.some((l) => l.includes("Successfully seeded API docs index")), "runSeedCommand success output");
  assert(exitCode === null, "runSeedCommand does not exit on success");

  const allRuns: string[] = [];
  await runSeedAllCommand({
    githubToken: undefined,
    formatSuccess: () => "Successfully completed all seeds.\n",
    io: {
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line),
      exit: (code) => {
        exitCode = code;
      },
    },
    openContext: async () => ({
      store: { close: async () => undefined } as never,
      syncManager: {} as never,
      indexer: {} as never,
    }),
    createProgress: (source) => {
      assert(source === "all", "seed-all uses single all reporter");
      return { onPhase: () => {}, onStep: () => {}, onNote: () => {} };
    },
    runDocs: async () => {
      allRuns.push("docs");
    },
    runGuides: async () => {
      allRuns.push("guides");
    },
    runFastflags: async () => {
      allRuns.push("fastflags");
      return { added: 1, updated: 0 };
    },
    runDevforum: async () => {
      allRuns.push("devforum");
    },
  });

  assert(allRuns.join(",") === "docs,guides,fastflags,devforum", "seed-all runs all sources in order");
  assert(stdout.some((l) => l.includes("Successfully completed all seeds")), "seed-all success output");
}

async function testServerStartup(tmpDir: string): Promise<void> {
  const store = new SqliteStore({ cacheDir: join(tmpDir, "server") });
  await store.open();
  await writeFile(join(tmpDir, "server", "api.index.msgpack"), "warm");

  const { server, seedManager, shutdown } = await createServer({
    store,
    autoStartScheduler: false,
  });

  assert(server !== undefined, "createServer returns MCP server");
  assert(seedManager !== undefined, "createServer returns seedManager");

  const manager = createSeedManager({
    store,
    syncManager: createSyncStateManager(store),
    indexer: new Indexer(store, createSyncStateManager(store)),
    scheduler: {
      idleDetector: { isIdle: () => true },
      devForumRateLimiter: { acquire: async () => {} },
    } as never,
    githubToken: undefined,
  });
  assert(manager.getProgress("docs").source === "docs", "createSeedManager exposes progress API");

  shutdown();
  await store.close();
}

async function testDistCli(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const distCli = join(process.cwd(), "dist", "cli.js");

  const { stdout } = await execFileAsync("node", [distCli, "--help"], {
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert(stdout.includes("--seed-docs"), "dist/cli.js --help lists --seed-docs");
  assert(stdout.includes("--seed-all"), "dist/cli.js --help lists --seed-all");
}

async function main(): Promise<void> {
  const tmpDir = join("/tmp", `rodocs-runtime-full-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    await section("warm-cache + embeddings", async () => {
      const store = await testWarmCacheAndEmbeddings(tmpDir);
      await testSeedRunners(store);
      await testDevforumEmbedOnCacheHit(store);
      await store.close();
    });

    await section("cli seed-command", () => testCliSeedCommand());

    await section("server startup", async () => {
      await testServerStartup(tmpDir);
    });

    await section("dist build artifact", async () => {
      await testDistCli();
    });

    console.error(`\nRuntime full: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});