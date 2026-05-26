# Phase 3: Embedding Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local embedding pipeline using `Xenova/multilingual-e5-small` that generates 384-dimensional vectors for each data source after seeding, stored in a `sqlite-vec` virtual table in `store.db`.

**Architecture:** Three new files in `src/embedding/` (`model.ts`, `embedder.ts`, `embedding-indexer.ts`). The `SeedSourceRunner` interface gains an optional `buildEmbeddings()` method. `SeedManager` calls it as a separate background stage after `rebuildIndex()`. The `vec_items` virtual table is created at `SqliteStore.open()`. **Requires Phase 2 to be complete.**

**Tech Stack:** `@xenova/transformers` (WASM/ONNX), `sqlite-vec` (npm package with native binaries), `better-sqlite3`.

---

## Prerequisites

- Phase 2 must be merged (`SqliteStore` is the live backend).
- **Pre-implementation check:** Verify the correct model identifier before writing `model.ts`. Run:
  ```bash
  node -e "const {pipeline} = require('@xenova/transformers'); pipeline('feature-extraction', 'Xenova/multilingual-e5-small').then(p => p('test', {pooling:'mean', normalize:true})).then(r => console.log('dims:', r.dims)).catch(console.error)"
  ```
  If this fails or the namespace has changed, find the correct identifier in the `@xenova/transformers` model hub before proceeding.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/embedding/model.ts` | Singleton model loader |
| **Create** | `src/embedding/embedder.ts` | `embed()` function, L2 normalization |
| **Create** | `src/embedding/embedding-indexer.ts` | `EmbeddingIndexer` class; CRUD on `vec_items` |
| **Create** | `src/embedding/__tests__/embedder.test.ts` | Unit tests with mock model |
| **Create** | `src/embedding/__tests__/embedding-indexer.test.ts` | Tests with in-memory SQLite |
| **Modify** | `src/types/index.ts` | Add `EmbedDoc` interface |
| **Modify** | `src/store/sqlite-store.ts` | Create `vec_items` virtual table at open(); load `sqlite-vec` |
| **Modify** | `src/scheduler/seed-manager.ts` | Add `buildEmbeddings?` to `SeedSourceRunner`; call it after `rebuildIndex()` |
| **Modify** | `src/server/index.ts` | Wire `EmbeddingIndexer` to each seed runner's `buildEmbeddings` |
| **Modify** | `vitest.config.ts` | Add `src/embedding/**/*.ts` to coverage include |
| **Modify** | `package.json` | Add `@xenova/transformers`, `sqlite-vec` |

---

## Task 1: Install dependencies

- [ ] **Step 1: Install packages**

```bash
pnpm add @xenova/transformers sqlite-vec
```

- [ ] **Step 2: Verify `sqlite-vec` loads**

```bash
node -e "const Database = require('better-sqlite3'); const {load} = require('sqlite-vec'); const db = new Database(':memory:'); load(db); console.log('sqlite-vec loaded OK');"
```
Expected: `sqlite-vec loaded OK`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add @xenova/transformers and sqlite-vec"
```

---

## Task 2: Add `EmbedDoc` type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `EmbedDoc` to the shared types**

Open `src/types/index.ts` and append:

```typescript
/**
 * A document prepared for embedding. The `text` field is pre-formatted
 * (title + description combined) — the caller is responsible for concatenation.
 */
export interface EmbedDoc {
  id: string;
  source: string;
  text: string;
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add EmbedDoc interface"
```

---

## Task 3: Implement `model.ts` (singleton loader)

**Files:**
- Create: `src/embedding/model.ts`

- [ ] **Step 1: Create the model singleton**

```typescript
// src/embedding/model.ts
import { logger } from "../utils/logger.js";

// Dynamic import avoids loading the 50MB WASM binary unless embedding is used.
type PipelineType = Awaited<ReturnType<typeof import("@xenova/transformers")["pipeline"]>>;

const MODEL_ID = "Xenova/multilingual-e5-small";

let _model: PipelineType | null = null;
let _loadPromise: Promise<PipelineType> | null = null;

export async function loadModel(): Promise<PipelineType> {
  if (_model !== null) return _model;
  if (_loadPromise !== null) return _loadPromise;

  _loadPromise = (async () => {
    logger.info(`[Embedding] loading model ${MODEL_ID}`);
    const { pipeline } = await import("@xenova/transformers");
    const model = await pipeline("feature-extraction", MODEL_ID);
    _model = model;
    logger.info(`[Embedding] model ready`);
    return model;
  })().catch((err: unknown) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

/** Reset for testing — clears singleton state */
export function _resetModelForTesting(): void {
  _model = null;
  _loadPromise = null;
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/embedding/model.ts
git commit -m "feat(embedding): add model singleton loader"
```

---

## Task 4: Implement `embedder.ts` with tests (TDD)

**Files:**
- Create: `src/embedding/__tests__/embedder.test.ts`
- Create: `src/embedding/embedder.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/embedding/__tests__/embedder.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the model module so tests don't load the real 50MB WASM binary
vi.mock("../model.js", () => ({
  loadModel: vi.fn(),
  _resetModelForTesting: vi.fn(),
}));

import { _resetModelForTesting, loadModel } from "../model.js";
import { embed } from "../embedder.js";

const mockLoadModel = vi.mocked(loadModel);

describe("embed()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetModelForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one vector per input text", async () => {
    // Mock model returns a fake tensor-like object
    const fakeOutput = {
      data: new Float32Array([1, 0, 0]),
      dims: [1, 3],
      mean: () => fakeOutput,
      normalize: () => fakeOutput,
    };
    mockLoadModel.mockResolvedValue(
      vi.fn().mockResolvedValue(fakeOutput) as unknown as Awaited<ReturnType<typeof loadModel>>,
    );

    const results = await embed(["hello world"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
  });

  it("returns empty array for empty input", async () => {
    mockLoadModel.mockResolvedValue(
      vi.fn() as unknown as Awaited<ReturnType<typeof loadModel>>,
    );
    const results = await embed([]);
    expect(results).toHaveLength(0);
    expect(mockLoadModel).not.toHaveBeenCalled();
  });

  it("L2-normalizes the output vectors", async () => {
    // Vector [3, 4] has L2 norm 5 → normalized: [0.6, 0.8]
    const rawData = new Float32Array([3, 4]);
    const fakeOutput = {
      data: rawData,
      dims: [1, 2],
      mean: () => fakeOutput,
      normalize: () => ({
        data: new Float32Array([0.6, 0.8]),
        dims: [1, 2],
      }),
    };
    mockLoadModel.mockResolvedValue(
      vi.fn().mockResolvedValue(fakeOutput) as unknown as Awaited<ReturnType<typeof loadModel>>,
    );

    const results = await embed(["test"]);
    expect(results[0]?.[0]).toBeCloseTo(0.6, 4);
    expect(results[0]?.[1]).toBeCloseTo(0.8, 4);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/embedding/__tests__/embedder.test.ts
```
Expected: FAIL — `Cannot find module '../embedder.js'`

- [ ] **Step 3: Implement `embedder.ts`**

```typescript
// src/embedding/embedder.ts
import { loadModel } from "./model.js";

/**
 * Generates L2-normalized embedding vectors for a batch of texts.
 * Returns one Float32Array per input string.
 * Returns empty array immediately if texts is empty (no model load).
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const model = await loadModel();
  const results: Float32Array[] = [];

  for (const text of texts) {
    const output = await model(text, { pooling: "mean", normalize: true });
    results.push(new Float32Array(output.data as Float32Array));
  }

  return results;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test src/embedding/__tests__/embedder.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/embedding/embedder.ts src/embedding/__tests__/embedder.test.ts
git commit -m "feat(embedding): implement embed() with L2 normalization"
```

---

## Task 5: Load `sqlite-vec` in `SqliteStore` and create `vec_items` table

**Files:**
- Modify: `src/store/sqlite-store.ts`

- [ ] **Step 1: Write the failing test for `vec_items` table creation**

Open `src/store/__tests__/sqlite-store.test.ts` and add:

```typescript
it("creates vec_items virtual table on open()", async () => {
  // Access the private db via cast (test-only)
  const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
  // Query sqlite_master to confirm the table exists
  const row = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'`,
    )
    .get();
  expect(row?.name).toBe("vec_items");
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/store/__tests__/sqlite-store.test.ts
```
Expected: FAIL — `vec_items` does not exist yet.

- [ ] **Step 3: Update `SqliteStore.open()` to load `sqlite-vec` and create the table**

In `src/store/sqlite-store.ts`, update the imports and `open()` method:

```typescript
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import type { IKeyValueStore } from "./store-interface.js";
import { logger } from "../utils/logger.js";
// ... other imports unchanged ...

  async open(): Promise<void> {
    try {
      this.db = new Database(this.path);

      // Load sqlite-vec extension (npm package ships native binaries)
      try {
        loadSqliteVec(this.db);
      } catch (vecErr) {
        // sqlite-vec is optional — hybrid search will be disabled if it fails
        logger.warn(
          `[SqliteStore] sqlite-vec failed to load; hybrid search disabled: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`,
        );
      }

      // Core KV table
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );

      // Embedding vectors table (created only if sqlite-vec loaded successfully)
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
            id TEXT PRIMARY KEY,
            source TEXT,
            embedding FLOAT[384]
          )
        `);
      } catch {
        // vec0 is not available if sqlite-vec failed to load — safe to ignore
      }
    } catch (error) {
      throw new Error(
        `Failed to open SQLite store at ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/store/__tests__/sqlite-store.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sqlite-store.ts src/store/__tests__/sqlite-store.test.ts
git commit -m "feat(store): load sqlite-vec and create vec_items table on open"
```

---

## Task 6: Implement `EmbeddingIndexer` with tests (TDD)

**Files:**
- Create: `src/embedding/__tests__/embedding-indexer.test.ts`
- Create: `src/embedding/embedding-indexer.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/embedding/__tests__/embedding-indexer.test.ts
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedDoc } from "../../types/index.js";

vi.mock("../embedder.js", () => ({
  embed: vi.fn(),
}));

import { embed } from "../embedder.js";
import { EmbeddingIndexer } from "../embedding-indexer.js";

const mockEmbed = vi.mocked(embed);

function makeInMemoryStore() {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      id TEXT PRIMARY KEY,
      source TEXT,
      embedding FLOAT[384]
    )
  `);
  // Minimal IKeyValueStore stub — EmbeddingIndexer only needs getPath()
  const storeMock = {
    getPath: () => ":memory:",
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    clear: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    isOpen: () => true,
  };
  return { db, storeMock };
}

describe("EmbeddingIndexer", () => {
  let indexer: EmbeddingIndexer;
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    const { db: testDb, storeMock } = makeInMemoryStore();
    db = testDb;
    indexer = new EmbeddingIndexer(storeMock as unknown as import("../../store/store-interface.js").IKeyValueStore, db);
  });

  afterEach(() => {
    db.close();
  });

  it("indexSource() inserts one row per doc", async () => {
    const docs: EmbedDoc[] = [
      { id: "doc1", source: "docs", text: "Hello world" },
      { id: "doc2", source: "docs", text: "Roblox scripting" },
    ];
    mockEmbed.mockResolvedValue([
      new Float32Array(384).fill(0.1),
      new Float32Array(384).fill(0.2),
    ]);

    await indexer.indexSource("docs", docs);

    const rows = db.prepare("SELECT id FROM vec_items").all();
    expect(rows).toHaveLength(2);
  });

  it("clearSource() removes only rows for that source", async () => {
    const docs: EmbedDoc[] = [
      { id: "a", source: "docs", text: "doc a" },
      { id: "b", source: "guides", text: "guide b" },
    ];
    mockEmbed.mockResolvedValue([
      new Float32Array(384).fill(0.1),
      new Float32Array(384).fill(0.2),
    ]);
    await indexer.indexSource("docs", [docs[0]!]);
    await indexer.indexSource("guides", [docs[1]!]);

    await indexer.clearSource("docs");

    const remaining = db.prepare("SELECT id FROM vec_items").all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(["b"]);
  });

  it("indexSource() is a no-op when docs is empty", async () => {
    await indexer.indexSource("docs", []);
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/embedding/__tests__/embedding-indexer.test.ts
```
Expected: FAIL — `Cannot find module '../embedding-indexer.js'`

- [ ] **Step 3: Implement `EmbeddingIndexer`**

```typescript
// src/embedding/embedding-indexer.ts
import type Database from "better-sqlite3";
import type { EmbedDoc } from "../types/index.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import { embed } from "./embedder.js";
import { observe } from "../utils/logger.js";

export class EmbeddingIndexer {
  constructor(
    private readonly store: IKeyValueStore,
    // db is injected to allow testing with an in-memory database;
    // in production, SqliteStore exposes the db instance via a package-internal method
    private readonly db: Database.Database,
  ) {}

  /**
   * Generates embeddings for all docs in the source and upserts into vec_items.
   * No-op if docs is empty.
   */
  async indexSource(source: string, docs: EmbedDoc[]): Promise<void> {
    if (docs.length === 0) return;

    const texts = docs.map((d) => d.text);
    const vectors = await embed(texts);

    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO vec_items (id, source, embedding) VALUES (?, ?, ?)`,
    );

    const insertMany = this.db.transaction(
      (entries: Array<{ id: string; source: string; vec: Float32Array }>) => {
        for (const entry of entries) {
          upsert.run(entry.id, entry.source, entry.vec);
        }
      },
    );

    const entries = docs.map((doc, i) => ({
      id: doc.id,
      source: doc.source,
      vec: vectors[i] ?? new Float32Array(384),
    }));

    insertMany(entries);
    observe({ event: "embedding.indexed", source, count: docs.length });
  }

  /**
   * Removes all vectors for a given source.
   */
  async clearSource(source: string): Promise<void> {
    this.db.prepare("DELETE FROM vec_items WHERE source = ?").run(source);
    observe({ event: "embedding.cleared", source });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/embedding/__tests__/embedding-indexer.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/embedding/embedding-indexer.ts src/embedding/__tests__/embedding-indexer.test.ts
git commit -m "feat(embedding): implement EmbeddingIndexer"
```

---

## Task 7: Expose `db` from `SqliteStore` for `EmbeddingIndexer`

`EmbeddingIndexer` needs access to the raw `better-sqlite3` `Database` instance. Add a package-internal accessor to `SqliteStore`.

**Files:**
- Modify: `src/store/sqlite-store.ts`

- [ ] **Step 1: Add `getDb()` method to `SqliteStore`**

Inside `SqliteStore`, add after `getPath()`:

```typescript
  /**
   * Returns the underlying better-sqlite3 Database instance.
   * For use by EmbeddingIndexer only. Throws if store is not open.
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.db;
  }
```

Also add `getDb(): Database.Database` to `IKeyValueStore` in `src/store/store-interface.ts`? **No** — `getDb()` is SQLite-specific. Instead, add it only to `SqliteStore` directly. `EmbeddingIndexer` will accept `SqliteStore` (not `IKeyValueStore`) as a second parameter, or do an `instanceof` check in `src/server/index.ts`.

- [ ] **Step 2: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/store/sqlite-store.ts
git commit -m "feat(store): expose getDb() accessor on SqliteStore"
```

---

## Task 8: Add `buildEmbeddings` to `SeedSourceRunner` and wire in `SeedManager`

**Files:**
- Modify: `src/scheduler/seed-manager.ts`

- [ ] **Step 1: Write the failing test for the new `buildEmbeddings` call**

Open `src/scheduler/__tests__/seed-manager.test.ts` (or the existing test file for SeedManager). Add:

```typescript
it("calls buildEmbeddings after rebuildIndex when source completes", async () => {
  const rebuildIndex = vi.fn().mockResolvedValue(undefined);
  const buildEmbeddings = vi.fn().mockResolvedValue(undefined);

  // Create a minimal SeedManager with one runner that has both hooks
  // (use the existing test setup pattern from the file)
  // ... wire up runner with rebuildIndex and buildEmbeddings ...
  // ... run the seed until done ...

  expect(rebuildIndex).toHaveBeenCalledOnce();
  expect(buildEmbeddings).toHaveBeenCalledOnce();
  // Verify order: rebuildIndex before buildEmbeddings
  expect(rebuildIndex.mock.invocationCallOrder[0]).toBeLessThan(
    buildEmbeddings.mock.invocationCallOrder[0]!,
  );
});

it("buildEmbeddings error does not affect seed completion status", async () => {
  const buildEmbeddings = vi.fn().mockRejectedValue(new Error("model load failed"));
  // ... wire up runner ...
  // seed completes normally despite buildEmbeddings throwing
  // source progress should be "complete"
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test src/scheduler/__tests__/seed-manager.test.ts
```
Expected: FAIL — `buildEmbeddings` does not exist on `SeedSourceRunner` yet.

- [ ] **Step 3: Update `SeedSourceRunner` interface**

In `src/scheduler/seed-manager.ts`, update the interface:

```typescript
export interface SeedSourceRunner {
  source: SeedSource;
  estimatedTotal: number;
  batchSize: number;
  runBatch: (context: SeedBatchContext) => Promise<SeedBatchResult>;
  rebuildIndex?: () => Promise<void>;
  /** Separate background stage — called after rebuildIndex; errors are isolated */
  buildEmbeddings?: () => Promise<void>;
}
```

- [ ] **Step 4: Update the `SeedManager` batch completion logic**

Find the section in `SeedManager` that calls `runner.rebuildIndex?.()` (around line 251). Update it:

```typescript
    if (updated.status === "complete") {
      if (updated.needsRebuild) {
        await runner.rebuildIndex?.();

        // Embedding generation is a separate stage — errors are isolated
        if (runner.buildEmbeddings) {
          runner.buildEmbeddings().catch((err: unknown) => {
            this.logger.error(
              `[Seed] ${source}: buildEmbeddings failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }
      this.logger.error(`[Seed] ${source}: complete (${updated.seededItems} entries)`);
    }
```

- [ ] **Step 5: Run tests**

```bash
pnpm test src/scheduler/__tests__/seed-manager.test.ts
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/seed-manager.ts src/scheduler/__tests__/seed-manager.test.ts
git commit -m "feat(scheduler): add buildEmbeddings stage to SeedSourceRunner"
```

---

## Task 9: Wire `EmbeddingIndexer` into `createServer()`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add `EmbeddingIndexer` wiring**

In `src/server/index.ts`, after the `sharedIndexer` is created, add:

```typescript
import { EmbeddingIndexer } from "../embedding/embedding-indexer.js";
import { SqliteStore } from "../store/sqlite-store.js";

// ... inside createServer(), after sharedIndexer is created ...

// Wire up EmbeddingIndexer if the store is a SqliteStore (sqlite-vec required)
let embeddingIndexer: EmbeddingIndexer | null = null;
if (store instanceof SqliteStore) {
  try {
    embeddingIndexer = new EmbeddingIndexer(store, store.getDb());
  } catch {
    logger.warn("[Server] EmbeddingIndexer could not be initialized; hybrid search disabled");
  }
}
```

Then, in the `runners` array inside the `SeedManager` constructor, add `buildEmbeddings` to each runner that has document text. Example for `docs`:

```typescript
      {
        source: "docs",
        estimatedTotal: 350,
        batchSize: 50,
        runBatch: async () => {
          warmUp(githubToken);
          return { processed: 50, done: true, logDetail: "50 paths" };
        },
        buildEmbeddings: embeddingIndexer
          ? async () => {
              // fetch the index of API names and build EmbedDocs
              const { classes = [], datatypes = [], enums = [], globals = [], libraries = [] } =
                await import("../scraper/index.js").then((m) => m.scrapeIndex(githubToken));
              const allNames = [...classes, ...datatypes, ...enums, ...globals, ...libraries];
              const docs = allNames.map((name) => ({
                id: name,
                source: "docs" as const,
                text: name,
              }));
              await embeddingIndexer!.indexSource("docs", docs);
            }
          : undefined,
      },
```

For `devforum` and `fastflags`, similarly read the records from the store and build `EmbedDoc[]` using the existing `keys()`/`get()` pattern.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: all tests pass. (Server tests use mock stores; `embeddingIndexer` will be `null` in tests since the mock store is not a `SqliteStore` instance.)

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): wire EmbeddingIndexer into SeedManager runners"
```

---

## Task 10: Add `src/embedding/` to coverage scope

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update coverage include**

In `vitest.config.ts`, add `src/embedding/**/*.ts` to the `coverage.include` array:

```typescript
      include: [
        "src/search/**/*.ts",
        "src/scraper/**/*.ts",
        "src/devforum/**/*.ts",
        "src/fastflags/**/*.ts",
        "src/embedding/**/*.ts",   // new
      ],
      exclude: [
        "src/search/__tests__/**",
        "src/scraper/__tests__/**",
        "src/devforum/__tests__/**",
        "src/fastflags/__tests__/**",
        "src/embedding/__tests__/**",  // new
      ],
```

- [ ] **Step 2: Run coverage and verify `src/embedding/` meets 70% threshold on new lines**

```bash
pnpm test:coverage
```
Expected: coverage report shows `src/embedding/` files at ≥70% lines. If below threshold, add tests to cover the missing branches (primarily error paths in `model.ts` and `embedding-indexer.ts`).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test(config): add src/embedding/ to vitest coverage scope"
```

---

## Task 11: Final validation

- [ ] **Step 1: Run full CI gate**

```bash
pnpm ci
```
Expected: clean.

- [ ] **Step 2: Verify no `console.log` in new files**

```bash
grep -rn "console\.log\|console\.debug" src/embedding/ --include="*.ts"
```
Expected: zero hits. (Use `logger` from `src/utils/logger.ts`.)

- [ ] **Step 3: Commit any cleanup**

```bash
git add -p
git commit -m "chore(embedding): cleanup and final CI pass"
```
