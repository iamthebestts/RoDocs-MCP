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
