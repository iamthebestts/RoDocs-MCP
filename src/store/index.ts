/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { SqliteStore, type SqliteStoreOptions } from "./sqlite-store.js";
import type { IKeyValueStore } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { IKeyValueStore, SqliteStoreOptions };
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
