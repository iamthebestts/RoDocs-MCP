# Design: SQLite Migration + Hybrid Search

**Date:** 2026-05-26  
**Branch:** feat/rodocs-knowledge-engine  
**Status:** Approved

---

## Executive Summary

Migrate the persistence layer from LMDB to `better-sqlite3 + sqlite-vec` and add hybrid BM25 + embedding search using `Xenova/multilingual-e5-small`. The migration is split into 4 independent phases that can each ship and be validated separately.

---

## Decisions

| Question | Decision |
|---|---|
| BM25 index storage | Keep msgpack files (Option A) — SQLite only replaces the KV store |
| Embedding trigger | Seed pipeline stage (Option C) — `buildEmbeddings()` as a separate step in `SeedSourceRunner` |
| Hybrid ranking | RRF with k=60 (Option A) |
| Migration risk posture | Interface extraction + swap (Option C) — `IKeyValueStore` contract, LMDB removed only after green CI on SQLite |

---

## Phase 1 — Interface Extraction

**Goal:** Extract a `IKeyValueStore` interface so `LmdbStore` and the new `SqliteStore` are interchangeable. Zero behavior change.

### New file: `src/store/store-interface.ts`

```typescript
export interface IKeyValueStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void | unknown>;
  isOpen(): boolean;
  getPath(): string; // returns the backing store FILE path (e.g. store.lmdb or store.db)
}
```

### Changes

- `LmdbStore` gains `implements IKeyValueStore` — no logic changes.
- `Indexer` constructor changes from `readonly _store: LmdbStore` to `readonly _store: IKeyValueStore`.
- `Indexer.basePath` strip regex updated: `/store\.(lmdb|db)$/` → `""` — handles both backends.
- `SyncStateManager` constructor types against `IKeyValueStore`.
- `createStore()` return type changes to `Promise<IKeyValueStore>`.
- `createSyncStateManager()` parameter type changes to `IKeyValueStore`.
- All consumers (`FastFlagSearch`, `FastFlagScraper`, `DevForumPipeline`, `DevForumSearch`, `RobloxSearch`, `DaemonServer`) update their `LmdbStore` references to `IKeyValueStore`.

### Validation

All existing tests pass unchanged — they still use `LmdbStore` as the implementation.

---

## Phase 2 — SQLite KV Store

**Goal:** Implement `SqliteStore` and swap it as the default. Remove LMDB only after green CI.

### New file: `src/store/sqlite-store.ts`

```typescript
export class SqliteStore implements IKeyValueStore {
  // backend: better-sqlite3 (synchronous)
  // database file: <cacheDir>/store.db
  // table: CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)
  // values serialized as JSON.stringify / JSON.parse
}
```

Key design points:

- **`getPath()`** returns `<cacheDir>/store.db` — preserves the file-path contract. The `Indexer` regex `/store\.(lmdb|db)$/` strips correctly to derive `basePath`.
- **`keys()`** → `SELECT key FROM kv` — identical semantics to LMDB's `getRange()`.
- **`open()` / `close()`** are lifecycle wrappers for the `better-sqlite3` `Database` object.
- **`put()`** uses `INSERT OR REPLACE INTO kv VALUES (?, ?)` — upsert semantics.
- **`clear()`** uses `DELETE FROM kv`.
- `better-sqlite3` is synchronous; all async methods resolve immediately — no performance regression vs LMDB.

### `createStore()` change

```typescript
export function createStore(options?: StoreOptions): Promise<IKeyValueStore> {
  const backend = options?.backend ?? 'sqlite';
  const store = backend === 'lmdb' ? new LmdbStore(options) : new SqliteStore(options);
  return store.open().then(() => store);
}
```

The `backend?: 'sqlite' | 'lmdb'` option lets existing tests continue running against LMDB during the validation window.

### Migration of existing cache

No automatic data migration. On first run with `SqliteStore`, the store starts empty. Sources are re-seeded on the next `SeedManager` background run. `sync:*` state is also lost — all sources re-sync once. This is acceptable: the existing cache is a performance optimization, not authoritative data.

### Removal of LMDB

After CI is green against `SqliteStore`:
1. Remove `lmdb` from `package.json`.
2. Remove `backend?: 'lmdb'` option from `createStore()`.
3. Delete `src/store/lmdb-store.ts` and its tests.

### Validation

- All unit tests re-run with `SqliteStore` as default.
- `LmdbStore` tests are kept until removal is confirmed.
- E2E tests pass with `SqliteStore`.

---

## Phase 3 — sqlite-vec + Embedding Pipeline

**Goal:** Store embedding vectors in `sqlite-vec` and generate them automatically after each source is seeded.

### New module: `src/embedding/`

**`model.ts`** — singleton loader for `Xenova/multilingual-e5-small`:
- Exports `loadModel(): Promise<EmbeddingModel>` and `_resetModelForTesting()`.
- Model downloaded once into the transformers cache on first call; subsequent calls reuse the singleton.
- Loading is lazy — nothing runs until `embed()` is first called.

**`embedder.ts`** — exports `embed(texts: string[]): Promise<Float32Array[]>`:
- Batches inputs, calls the model, returns L2-normalized vectors.
- Vector dimensionality: 384 (multilingual-e5-small output size).

**`embedding-indexer.ts`** — `EmbeddingIndexer` class:
- Constructor takes `IKeyValueStore` (derives the `store.db` path for `sqlite-vec`).
- Methods:
  - `indexSource(source: string, docs: EmbedDoc[]): Promise<void>` — generates embeddings, upserts into `vec_items`.
  - `clearSource(source: string): Promise<void>` — deletes all vectors for a source.
- `vec_items` virtual table schema (created at `SqliteStore.open()`):
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
    id TEXT PRIMARY KEY,
    source TEXT,
    embedding FLOAT[384]
  )
  ```

### New type: `EmbedDoc`

Added to `src/types/index.ts`:
```typescript
export interface EmbedDoc {
  id: string;
  source: string;
  text: string; // pre-formatted: title + description — caller's responsibility
}
```

### `SeedSourceRunner` changes

Two new optional methods added to the existing interface:

```typescript
interface SeedSourceRunner {
  source: SeedSource;
  estimatedTotal: number;
  batchSize: number;
  runBatch: (ctx: SeedBatchContext) => Promise<SeedBatchResult>;
  rebuildIndex?: () => Promise<void>;     // BM25 rebuild (existing behavior)
  buildEmbeddings?: () => Promise<void>;  // embedding generation (new, separate stage)
}
```

`SeedManager` execution order per source:
1. Run `runBatch()` until source is complete.
2. If `needsRebuild: true`, call `rebuildIndex()`.
3. If `buildEmbeddings` exists, call `buildEmbeddings()` as a **separate background job** — errors here do not affect the seed result of the source.

This separates the progress of seeding (`seed:docs`) from embedding (`embed:docs`), enabling independent observability and failure isolation.

### Validation

- Unit tests for `embedder.ts` use a mock model.
- `EmbeddingIndexer` tests use an in-memory SQLite database.
- `SeedManager` tests mock `buildEmbeddings` and verify it is called after `needsRebuild: true`.

---

## Phase 4 — Hybrid Search with RRF

**Goal:** Add hybrid BM25 + vector search, fused via Reciprocal Rank Fusion. Transparent to MCP clients.

### New file: `src/search/hybrid.ts`

**`reciprocalRankFusion()` — pure function (testable in isolation):**

```typescript
function reciprocalRankFusion(
  bm25Results: ReadonlyArray<{ id: string; bm25Rank: number }>,
  vecResults: ReadonlyArray<{ id: string; vecRank: number }>,
  k = 60,
  limit: number,
): readonly { id: string; rrfScore: number }[]
```

- `bm25Rank` and `vecRank` are 1-based positions in their respective ranked lists.
- Documents absent from a list receive `rank = limit + 1` (soft penalty, not infinite).
- Formula: `rrfScore = 1/(k + bm25Rank) + 1/(k + vecRank)`.
- Result sorted by `rrfScore` descending, sliced to `limit`.

**`hybridSearch()` — main entry point:**

```typescript
async function hybridSearch(
  store: IKeyValueStore,
  query: string,
  source: HybridSource,
  limit: number,
  githubToken?: string,
): Promise<readonly SearchResult[]>
```

Internal flow:
1. **BM25 candidates** — calls existing searchers (`searchApis`, `searchGuides`, `searchDevForumStore`). Assigns `bm25Rank` (1-based).
2. **Vector candidates** — generates query embedding via `embed([query])`, executes:
   ```sql
   SELECT id, distance FROM vec_items
   WHERE source = ? AND embedding MATCH ?
   ORDER BY distance LIMIT ?
   ```
   Assigns `vecRank` (1-based by distance).
3. **RRF fusion** — calls `reciprocalRankFusion()`, returns final ranked list.

**Fallback:** If the embedding model is not yet loaded (cold start), `hybridSearch` falls back silently to BM25-only. No error is surfaced to MCP tools. The response includes `searchMode: "hybrid" | "bm25"` for observability.

### Integration with `robloxSearch`

`src/search/roblox-search.ts` receives a new optional parameter:

```typescript
hybrid?: boolean  // default: false during rollout
```

When `true`, delegates to `hybridSearch`. No changes to Zod schemas or MCP tool definitions — the upgrade is transparent to all MCP clients.

### Validation

- `reciprocalRankFusion()` tested with unit tests covering: both lists populated, one list empty, all ties, `limit` smaller than total candidates.
- `hybridSearch()` tested with a mock embedding model and in-memory SQLite.
- `robloxSearch()` tests verify fallback to BM25 when model is cold.

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `better-sqlite3` native bindings break on some platforms/Node versions | Medium | High | Pin to a tested version; add CI matrix for Node 20/22 on Win/Linux/Mac |
| `sqlite-vec` extension load failure (missing `.so`/`.dll`) | Medium | Medium | Wrap in try/catch; if `sqlite-vec` fails to load, disable hybrid search and log a warning |
| Embedding model download blocked at startup in offline/firewall environments | High | Medium | Model loading is lazy; if download fails, fall back to BM25 silently. Document `TRANSFORMERS_CACHE` env var for offline pre-download |
| `@xenova/transformers` WASM binary is large (~50MB) and slow on first run | High | Low | Only loaded if `buildEmbeddings` is configured; seed pipeline already runs in background |
| Cache loss on first SQLite run (re-seed required) | Certain | Low | Document in release notes; sources re-seed automatically in background |
| `Indexer` regex change (`/store\.lmdb$/` → `/store\.(lmdb\|db)$/`) missed in a callsite | Low | Medium | Grep for the old regex as part of Phase 1 PR checklist |

---

## Execution Order

```
Phase 1 (Interface)  →  Phase 2 (SQLite KV)  →  Phase 3 (Embeddings)  →  Phase 4 (Hybrid Search)
     |                        |                         |                         |
  No behavior            Remove LMDB               Requires Phase 2          Requires Phase 3
   change                after CI                  + sqlite-vec               + hybrid.ts
```

Each phase is a standalone PR. Phases 3 and 4 depend on Phase 2 (SQLite must be live before `sqlite-vec` is added).

---

## Pending Confirmations Before Implementation

1. **`better-sqlite3` vs `bun:sqlite`** — the project allows `bun run <script>` as a shortcut. Should `SqliteStore` use the Node.js `better-sqlite3` package or the Bun-native `bun:sqlite` (zero-install, but ties the runtime to Bun)? Recommend `better-sqlite3` for Node.js compatibility.

2. **`sqlite-vec` distribution** — `sqlite-vec` requires loading a native extension via `db.loadExtension()`. Confirm the extension is bundled as an npm package (`sqlite-vec` on npm) or must be installed separately. This affects the `package.json` dependency and the `tsup` build config.

3. **Embedding model offline policy** — confirm whether `TRANSFORMERS_CACHE` pre-download should be documented in the README or enforced as a required setup step for air-gapped environments.

4. **`hybrid: true` rollout gate** — confirm whether `hybrid` defaults to `false` (feature flag) until manually enabled, or whether it becomes the default once Phase 4 lands.

5. **Coverage scope** — `src/embedding/` is not currently in the Vitest coverage scope (`src/search/`, `src/scraper/`, `src/devforum/`, `src/fastflags/`). Confirm whether to add it or keep the current scope unchanged.
