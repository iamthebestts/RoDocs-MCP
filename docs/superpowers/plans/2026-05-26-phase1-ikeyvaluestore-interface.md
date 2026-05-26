# Phase 1: IKeyValueStore Interface Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an `IKeyValueStore` interface from `LmdbStore` so the persistence backend is swappable, with zero behavior change in this phase.

**Architecture:** Create `src/store/store-interface.ts` with the `IKeyValueStore` interface. Have `LmdbStore` implement it. Update `Indexer`, `SyncStateManager`, `createStore()`, `createSyncStateManager()`, and all consumers to reference `IKeyValueStore` instead of `LmdbStore`. The `Indexer.basePath` regex is updated to accept both `store.lmdb` and `store.db` file names.

**Tech Stack:** TypeScript strict, Node.js 20+, existing `lmdb` package (unchanged).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/store/store-interface.ts` | `IKeyValueStore` interface definition |
| **Modify** | `src/store/lmdb-store.ts` | `implements IKeyValueStore` |
| **Modify** | `src/store/indexer.ts` | type `_store: IKeyValueStore`; fix basePath regex |
| **Modify** | `src/store/sync-state.ts` | type constructor param as `IKeyValueStore` |
| **Modify** | `src/store/index.ts` | export `IKeyValueStore`; update `createStore()` and `createSyncStateManager()` return/param types |
| **Modify** | `src/devforum/pipeline.ts` | `LmdbStore` → `IKeyValueStore` in constructor |
| **Modify** | `src/devforum/search.ts` | `LmdbStore` → `IKeyValueStore` in function params |
| **Modify** | `src/fastflags/scraper.ts` | `LmdbStore` → `IKeyValueStore` in constructor |
| **Modify** | `src/fastflags/search.ts` | `LmdbStore` → `IKeyValueStore` in constructor |
| **Modify** | `src/search/roblox-search.ts` | `LmdbStore` → `IKeyValueStore` in function params |
| **Modify** | `src/daemon/daemon-server.ts` | `LmdbStore` → `IKeyValueStore` in relevant types |
| **Modify** | `src/server/index.ts` | `LmdbStore` → `IKeyValueStore` in `CreateServerOptions` |

---

## Task 1: Create `IKeyValueStore` interface

**Files:**
- Create: `src/store/store-interface.ts`

- [ ] **Step 1: Create the interface file**

```typescript
// src/store/store-interface.ts
export interface IKeyValueStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void | unknown>;
  isOpen(): boolean;
  /**
   * Returns the full path to the backing store file (e.g. store.lmdb or store.db).
   * Not the directory — the file. Consumers that need the directory must strip the filename.
   */
  getPath(): string;
}
```

- [ ] **Step 2: Run typecheck to confirm no errors**

```bash
pnpm typecheck
```
Expected: no errors (new file is additive only).

- [ ] **Step 3: Commit**

```bash
git add src/store/store-interface.ts
git commit -m "feat(store): add IKeyValueStore interface"
```

---

## Task 2: `LmdbStore` implements `IKeyValueStore`

**Files:**
- Modify: `src/store/lmdb-store.ts`

- [ ] **Step 1: Add import and `implements` clause**

In `src/store/lmdb-store.ts`, add the import at the top and update the class declaration:

```typescript
import type { IKeyValueStore } from "./store-interface.js";
// ... existing imports ...

export class LmdbStore implements IKeyValueStore {
  // body unchanged
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: no errors — `LmdbStore` already exposes every method in `IKeyValueStore`.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: all tests pass (zero behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/store/lmdb-store.ts
git commit -m "feat(store): LmdbStore implements IKeyValueStore"
```

---

## Task 3: Update `Indexer` to use `IKeyValueStore`

**Files:**
- Modify: `src/store/indexer.ts`
- Test: `src/store/__tests__/indexer.test.ts`

- [ ] **Step 1: Write the failing test for the new basePath regex**

Open `src/store/__tests__/indexer.test.ts`. Add a test that verifies the basePath is derived correctly from a `.db` path (the new case). First, read the existing test file to understand its setup, then add:

```typescript
it("derives basePath from store.db path", () => {
  // Arrange: a minimal store mock whose getPath() returns a .db path
  const mockStore = {
    getPath: () => "/home/user/.cache/rodocsmcp/store.db",
  } as unknown as import("../index.js").LmdbStore;
  const mockSync = {} as import("../sync-state.js").SyncStateManager;

  // Act
  const indexer = new Indexer(mockStore, mockSync);

  // Assert: basePath must be the directory, not the file
  // Access private field via any cast (test-only)
  expect((indexer as unknown as { basePath: string }).basePath).toBe(
    "/home/user/.cache/rodocsmcp/",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/store/__tests__/indexer.test.ts
```
Expected: FAIL — the current regex `/store\.lmdb$/` does not match `store.db`, so basePath retains the filename.

- [ ] **Step 3: Update `Indexer` to use `IKeyValueStore` and fix the regex**

In `src/store/indexer.ts`:

```typescript
import type { IKeyValueStore } from "./store-interface.js";
// remove: import type { LmdbStore, SyncStateManager } from "./index.js"
import type { SyncStateManager } from "./sync-state.js";

export class Indexer {
  private readonly basePath: string;
  private readonly clearCallbacks = new Map<string, () => void>();

  constructor(
    readonly _store: IKeyValueStore,   // was: LmdbStore
    readonly _syncManager: SyncStateManager,
  ) {
    // Updated regex: handles both store.lmdb and store.db
    this.basePath = join(_store.getPath().replace(/store\.(lmdb|db)$/, ""), "");
  }
  // rest of the class unchanged
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test src/store/__tests__/indexer.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/indexer.ts src/store/__tests__/indexer.test.ts
git commit -m "feat(store): Indexer uses IKeyValueStore; fix basePath regex for .db files"
```

---

## Task 4: Update `SyncStateManager` to use `IKeyValueStore`

**Files:**
- Modify: `src/store/sync-state.ts`

- [ ] **Step 1: Replace `LmdbStore` reference**

In `src/store/sync-state.ts`, change the constructor's type:

```typescript
import type { IKeyValueStore } from "./store-interface.js";

export class SyncStateManager {
  constructor(private lmdbStore: IKeyValueStore) {}  // was: import("./lmdb-store").LmdbStore
  // rest unchanged
```

- [ ] **Step 2: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/store/sync-state.ts
git commit -m "feat(store): SyncStateManager constructor accepts IKeyValueStore"
```

---

## Task 5: Update `src/store/index.ts` public API

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Export `IKeyValueStore` and update factory types**

Replace the contents of `src/store/index.ts`:

```typescript
/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { LmdbStore, type LmdbStoreOptions } from "./lmdb-store.js";
import type { IKeyValueStore } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { LmdbStoreOptions, IKeyValueStore };
export { Indexer, LmdbStore, SyncStateManager };

/**
 * Factory function to create a store with default options.
 * Returns IKeyValueStore so callers are not coupled to the implementation.
 */
export function createStore(options?: LmdbStoreOptions): Promise<IKeyValueStore> {
  const store = new LmdbStore(options);
  return store.open().then(() => store);
}

/**
 * Factory function to create a sync state manager
 */
export function createSyncStateManager(store: IKeyValueStore): SyncStateManager {
  return new SyncStateManager(store);
}
```

- [ ] **Step 2: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(store): export IKeyValueStore; createStore returns IKeyValueStore"
```

---

## Task 6: Update all consumers

This task updates every file that currently imports `LmdbStore` only to use it as a type annotation for a store parameter/field. None of the runtime behavior changes.

**Files:**
- Modify: `src/devforum/pipeline.ts`
- Modify: `src/devforum/search.ts`
- Modify: `src/fastflags/scraper.ts`
- Modify: `src/fastflags/search.ts`
- Modify: `src/search/roblox-search.ts`
- Modify: `src/daemon/daemon-server.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update `src/devforum/pipeline.ts`**

Find the constructor that accepts `store: LmdbStore`. Change:
```typescript
import type { IKeyValueStore } from "../store/store-interface.js";
// remove LmdbStore from any import that only uses it as a type
```
And in the constructor:
```typescript
constructor(
  private readonly store: IKeyValueStore,   // was: LmdbStore
  // ... rest unchanged
```

- [ ] **Step 2: Update `src/devforum/search.ts`**

The function `buildDevForumIndex(store: LmdbStore)` and `searchDevForumStore(store: LmdbStore, ...)` — change both parameter types to `IKeyValueStore`:

```typescript
import type { IKeyValueStore } from "../store/store-interface.js";

async function buildDevForumIndex(store: IKeyValueStore): Promise<void> { ... }

export async function searchDevForumStore(
  store: IKeyValueStore,
  options: DevForumSearchOptions,
): Promise<DevForumSearchResponse> { ... }
```

- [ ] **Step 3: Update `src/fastflags/scraper.ts`**

```typescript
import type { IKeyValueStore } from "../store/store-interface.js";

export class FastFlagScraper {
  constructor(
    private readonly store: IKeyValueStore,   // was: LmdbStore
    // ... rest unchanged
```

- [ ] **Step 4: Update `src/fastflags/search.ts`**

```typescript
import type { IKeyValueStore } from "../store/store-interface.js";

export class FastFlagSearch {
  constructor(
    private readonly store: IKeyValueStore,   // was: LmdbStore
    indexer?: Indexer,
  ) { ... }
```

- [ ] **Step 5: Update `src/search/roblox-search.ts`**

Find the function(s) that accept `store: LmdbStore` and update:
```typescript
import type { IKeyValueStore } from "../store/store-interface.js";
// change every store parameter from LmdbStore to IKeyValueStore
```

- [ ] **Step 6: Update `src/daemon/daemon-server.ts`**

Find every reference to `LmdbStore` used only as a type for the store argument/field. Replace with `IKeyValueStore`. Keep any `LmdbStore`-specific method calls (none exist — the daemon only calls `.put` / `.del` which are on `IKeyValueStore`).

```typescript
import type { IKeyValueStore } from "../store/store-interface.js";
// replace store type annotations from LmdbStore to IKeyValueStore
```

- [ ] **Step 7: Update `src/server/index.ts`**

In `CreateServerOptions`:
```typescript
import type { IKeyValueStore } from "../store/store-interface.js";

export interface CreateServerOptions {
  // ...
  store?: IKeyValueStore;          // was: LmdbStore
  syncManager?: SyncStateManager;
  // ...
}
```

Also update the `ownsStore` reference — it checks `options.store === undefined`, which still works fine.

- [ ] **Step 8: Remove now-unused `LmdbStore` imports**

In each file updated above, if `LmdbStore` is no longer used as a value (only was used as a type), remove its import. Run:

```bash
pnpm check:fix
```
Biome will catch unused imports.

- [ ] **Step 9: Run typecheck and full tests**

```bash
pnpm typecheck && pnpm test
```
Expected: all green. If there are type errors, they will point to missed `LmdbStore` references — fix each one.

- [ ] **Step 10: Commit**

```bash
git add src/devforum/pipeline.ts src/devforum/search.ts \
        src/fastflags/scraper.ts src/fastflags/search.ts \
        src/search/roblox-search.ts src/daemon/daemon-server.ts \
        src/server/index.ts
git commit -m "feat(store): update all consumers to IKeyValueStore interface"
```

---

## Task 7: Final validation

- [ ] **Step 1: Run full CI gate**

```bash
pnpm ci
```
Expected: biome clean + all tests pass + tsc clean.

- [ ] **Step 2: Grep for remaining `LmdbStore` usage as a type annotation**

```bash
grep -rn ": LmdbStore\|<LmdbStore" src/ --include="*.ts"
```
Expected: only `src/store/lmdb-store.ts` itself (the class declaration). Zero hits in other files.

- [ ] **Step 3: Grep for old basePath regex**

```bash
grep -rn "store\\.lmdb\$" src/ --include="*.ts"
```
Expected: zero hits (the regex in `Indexer` now uses `store\.(lmdb|db)$`).

- [ ] **Step 4: Commit if any cleanup was needed, otherwise skip**

```bash
git add -p
git commit -m "chore(store): cleanup leftover LmdbStore type references"
```
