/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { LmdbStore, type LmdbStoreOptions } from "./lmdb-store.js";
import { SqliteStore, type SqliteStoreOptions } from "./sqlite-store.js";
import type { IKeyValueStore } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { IKeyValueStore, LmdbStoreOptions, SqliteStoreOptions };
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
