/**
 * Public API for the Store module
 */

import { Indexer } from "./indexer.js";
import { SqliteStore, type SqliteStoreOptions } from "./sqlite-store.js";
import type { IKeyValueStore, KeyValueEntry } from "./store-interface.js";
import { SyncStateManager } from "./sync-state.js";

export type { SyncState } from "./sync-state.js";
export type { IKeyValueStore, KeyValueEntry, SqliteStoreOptions };
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

/**
 * Reads all key-value entries matching `prefix`, using SqliteStore's indexed range scan
 * when available and falling back to `keys()` + `get()` for minimal in-memory stores.
 */
export async function storeGetByPrefix<T = unknown>(
  store: IKeyValueStore,
  prefix: string,
): Promise<KeyValueEntry<T>[]> {
  if (typeof store.getByPrefix === "function") {
    return store.getByPrefix<T>(prefix);
  }
  const keys = (await store.keys()).filter((key) => key.startsWith(prefix));
  const entries: KeyValueEntry<T>[] = [];
  for (const key of keys) {
    const value = await store.get<T>(key);
    if (value !== null) {
      entries.push({ key, value });
    }
  }
  return entries;
}

/**
 * Atomically upserts multiple entries using SqliteStore's transaction when available,
 * falling back to sequential `put()` calls for minimal in-memory stores.
 */
export async function storePutMany<T = unknown>(
  store: IKeyValueStore,
  entries: ReadonlyArray<KeyValueEntry<T>>,
): Promise<void> {
  if (entries.length === 0) return;
  if (typeof store.putMany === "function") {
    await store.putMany(entries);
    return;
  }
  for (const entry of entries) {
    await store.put(entry.key, entry.value);
  }
}

/**
 * Deletes all keys matching `prefix` using SqliteStore's range delete when available,
 * falling back to `keys()` + `del()` for minimal in-memory stores.
 */
export async function storeDelByPrefix(store: IKeyValueStore, prefix: string): Promise<number> {
  if (typeof store.delByPrefix === "function") {
    return store.delByPrefix(prefix);
  }
  const keys = (await store.keys()).filter((key) => key.startsWith(prefix));
  for (const key of keys) {
    await store.del(key);
  }
  return keys.length;
}
