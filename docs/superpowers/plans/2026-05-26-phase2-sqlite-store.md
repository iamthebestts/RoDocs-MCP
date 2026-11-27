# Phase 2: SqliteStore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `SqliteStore` with `better-sqlite3`, swap it as the default in `createStore()`, run the full test suite against it, and remove LMDB after CI is green.

**Architecture:** `SqliteStore` implements `IKeyValueStore` (extracted in Phase 1). A single `kv` table stores all key-value pairs as JSON strings. The `backend?: 'sqlite' | 'lmdb'` option in `createStore()` allows switching backends during the validation window. After CI is confirmed green on SQLite, LMDB is removed. **Requires Phase 1 to be complete.**

**Tech Stack:** `better-sqlite3` (synchronous SQLite), Node.js 20/22, TypeScript strict.

---

## Prerequisites

Phase 1 must be merged and `IKeyValueStore` must be available at `src/store/store-interface.ts`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/store/sqlite-store.ts` | `SqliteStore implements IKeyValueStore` |
| **Create** | `src/store/__tests__/sqlite-store.test.ts` | Unit tests for `SqliteStore` |
| **Modify** | `src/store/index.ts` | Add `backend` option; default to `'sqlite'`; export `SqliteStore` |
| **Modify** | `package.json` | Add `better-sqlite3`; add `@types/better-sqlite3` as dev dep |
| **Delete** | `src/store/lmdb-store.ts` | Removed after CI is green on SQLite (Task 5) |
| **Delete** | `src/store/__tests__/lmdb-store.test.ts` | Removed with lmdb-store.ts (Task 5) |
| **Modify** | `src/store/index.ts` | Remove LMDB after Task 5 |

---

## Task 1: Install `better-sqlite3`

- [ ] **Step 1: Install the package**

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: Verify the install**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('SELECT 1 as n').get());"
```
Expected output: `{ n: 1 }`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add better-sqlite3"
```

---

## Task 2: Write `SqliteStore` tests (TDD — red phase)

**Files:**
- Create: `src/store/__tests__/sqlite-store.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/store/__tests__/sqlite-store.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../sqlite-store.js";

describe("SqliteStore", () => {
  let store: SqliteStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rodocs-sqlite-test-"));
    store = new SqliteStore({ cacheDir: tempDir });
    await store.open();
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should put and get a value", async () => {
    const key = "test-key";
    const value = { foo: "bar", baz: 123 };
    await store.put(key, value);
    const retrieved = await store.get(key);
    expect(retrieved).toEqual(value);
  });

  it("should return null for non-existent key", async () => {
    const retrieved = await store.get("non-existent");
    expect(retrieved).toBe(null);
  });

  it("should delete a key", async () => {
    await store.put("key", "value");
    await store.del("key");
    const retrieved = await store.get("key");
    expect(retrieved).toBe(null);
  });

  it("should clear the store", async () => {
    await store.put("key1", "val1");
    await store.put("key2", "val2");
    await store.clear();
    expect(await store.get("key1")).toBe(null);
    expect(await store.get("key2")).toBe(null);
  });

  it("should list all keys", async () => {
    await store.put("a", 1);
    await store.put("b", 2);
    await store.put("c", 3);
    const keys = await store.keys();
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it("getPath() returns the .db file path, not the directory", () => {
    const p = store.getPath();
    expect(p).toMatch(/store\.db$/);
    expect(p).toContain(tempDir);
  });

  it("isOpen() returns true after open() and false after close()", async () => {
    expect(store.isOpen()).toBe(true);
    await store.close();
    expect(store.isOpen()).toBe(false);
    // re-open so afterEach.close() does not throw
    await store.open();
  });

  it("put() is idempotent (upsert semantics)", async () => {
    await store.put("k", "first");
    await store.put("k", "second");
    expect(await store.get("k")).toBe("second");
  });

  it("throws if get() called before open()", async () => {
    const uninit = new SqliteStore({ cacheDir: tempDir });
    await expect(uninit.get("x")).rejects.toThrow(/not open/i);
  });

  it("respects RODOCS_CACHE_DIR env var when no cacheDir option is given", async () => {
    const envDir = await mkdtemp(join(tmpdir(), "rodocs-env-test-"));
    try {
      process.env.RODOCS_CACHE_DIR = envDir;
      const envStore = new SqliteStore();
      expect(envStore.getPath()).toContain(envDir);
    } finally {
      delete process.env.RODOCS_CACHE_DIR;
      await rm(envDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (SqliteStore does not exist yet)**

```bash
pnpm test src/store/__tests__/sqlite-store.test.ts
```
Expected: FAIL — `Cannot find module '../sqlite-store.js'`

---

## Task 3: Implement `SqliteStore`

**Files:**
- Create: `src/store/sqlite-store.ts`

- [ ] **Step 1: Create the implementation**

```typescript
// src/store/sqlite-store.ts
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { IKeyValueStore } from "./store-interface.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "rodocsmcp");

export interface SqliteStoreOptions {
  /** Custom cache directory path. Defaults to ~/.cache/rodocsmcp/ */
  cacheDir?: string;
  /** Whether to create the cache directory if it doesn't exist. Default: true */
  createDir?: boolean;
}

export class SqliteStore implements IKeyValueStore {
  private db: Database.Database | null = null;
  private readonly path: string;

  constructor(options: SqliteStoreOptions = {}) {
    const envCacheDir = process.env.RODOCS_CACHE_DIR;
    const cacheDir = options.cacheDir ?? envCacheDir ?? DEFAULT_CACHE_DIR;
    this.path = join(cacheDir, "store.db");

    if (!existsSync(cacheDir) && (options.createDir ?? true)) {
      mkdirSync(cacheDir, { recursive: true });
    }
  }

  async open(): Promise<void> {
    try {
      this.db = new Database(this.path);
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
    } catch (error) {
      throw new Error(
        `Failed to open SQLite store at ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = this.ensureOpen();
    const row = db.prepare<[string], { value: string }>("SELECT value FROM kv WHERE key = ?").get(key);
    if (row === undefined) return null;
    return JSON.parse(row.value) as T;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(
      key,
      JSON.stringify(value),
    );
  }

  async del(key: string): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }

  async keys(): Promise<string[]> {
    const db = this.ensureOpen();
    const rows = db.prepare<[], { key: string }>("SELECT key FROM kv").all();
    return rows.map((r) => r.key);
  }

  async clear(): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("DELETE FROM kv").run();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  getPath(): string {
    return this.path;
  }

  private ensureOpen(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.db;
  }
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
pnpm test src/store/__tests__/sqlite-store.test.ts
```
Expected: all 9 tests PASS.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/store/sqlite-store.ts src/store/__tests__/sqlite-store.test.ts
git commit -m "feat(store): implement SqliteStore with better-sqlite3"
```

---

## Task 4: Swap `createStore()` default to SQLite

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Update `src/store/index.ts`**

```typescript
/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { LmdbStore, type LmdbStoreOptions } from "./lmdb-store.js";
import { SqliteStore, type SqliteStoreOptions } from "./sqlite-store.js";
import type { IKeyValueStore } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { LmdbStoreOptions, SqliteStoreOptions, IKeyValueStore };
export { Indexer, LmdbStore, SqliteStore, SyncStateManager };

export type StoreBackend = "sqlite" | "lmdb";

export interface StoreOptions extends SqliteStoreOptions {
  /** Which backend to use. Default: 'sqlite'. Use 'lmdb' during validation only. */
  backend?: StoreBackend;
}

/**
 * Factory function to create a store.
 * Defaults to SqliteStore. Pass backend: 'lmdb' to use LmdbStore during migration validation.
 */
export function createStore(options?: StoreOptions): Promise<IKeyValueStore> {
  const backend = options?.backend ?? "sqlite";
  const store: IKeyValueStore =
    backend === "lmdb" ? new LmdbStore(options) : new SqliteStore(options);
  return store.open().then(() => store);
}

/**
 * Factory function to create a sync state manager
 */
export function createSyncStateManager(store: IKeyValueStore): SyncStateManager {
  return new SyncStateManager(store);
}
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```
Expected: all tests pass. Tests that use `createStore()` will now run against SQLite by default.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(store): swap createStore() default to SqliteStore"
```

---

## Task 5: Run full CI gate and remove LMDB

**This task only runs if Task 4's test suite is fully green.**

- [ ] **Step 1: Run the full CI gate**

```bash
pnpm ci
```
Expected: biome clean + all tests pass + tsc clean.

- [ ] **Step 2: Run E2E tests (requires network)**

```bash
cross-env E2E=true pnpm vitest run tests/
```
Expected: all E2E tests pass.

- [ ] **Step 3: Remove `lmdb` from `package.json`**

```bash
pnpm remove lmdb
```

- [ ] **Step 4: Remove LMDB source files**

```bash
rm src/store/lmdb-store.ts
rm src/store/__tests__/lmdb-store.test.ts
```

- [ ] **Step 5: Remove `backend: 'lmdb'` option from `src/store/index.ts`**

Update `src/store/index.ts` — remove all references to `LmdbStore` and the `backend` option:

```typescript
/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { SqliteStore, type SqliteStoreOptions } from "./sqlite-store.js";
import type { IKeyValueStore } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { SqliteStoreOptions, IKeyValueStore };
export { Indexer, SqliteStore, SyncStateManager };

/**
 * Factory function to create a SQLite-backed store.
 */
export function createStore(options?: SqliteStoreOptions): Promise<IKeyValueStore> {
  const store = new SqliteStore(options);
  return store.open().then(() => store);
}

/**
 * Factory function to create a sync state manager
 */
export function createSyncStateManager(store: IKeyValueStore): SyncStateManager {
  return new SyncStateManager(store);
}
```

- [ ] **Step 6: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```
Expected: clean. If any file still imports `LmdbStore`, fix the import.

- [ ] **Step 7: Run biome to catch leftover imports**

```bash
pnpm check:fix
```

- [ ] **Step 8: Commit LMDB removal**

```bash
git add -A
git commit -m "feat(store): remove LMDB; SqliteStore is the sole backend"
```
