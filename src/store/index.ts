/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { LmdbStore, type LmdbStoreOptions } from "./lmdb-store.js";
import { SyncStateManager } from "./sync-state.js";
import { WriteQueue } from "./write-queue.js";

export type { SyncState } from "./sync-state.js";
export type { WriteOp } from "./write-queue.js";
export type { LmdbStoreOptions };
export { Indexer, LmdbStore, SyncStateManager, WriteQueue };

/**
 * Factory function to create a store with default options
 */
export function createStore(options?: LmdbStoreOptions): Promise<LmdbStore> {
  const store = new LmdbStore(options);
  return store.open().then(() => store);
}

/**
 * Factory function to create a sync state manager
 */
export function createSyncStateManager(store: LmdbStore): SyncStateManager {
  return new SyncStateManager(store);
}
