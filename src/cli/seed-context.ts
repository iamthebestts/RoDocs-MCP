import { initIndexer } from "../search/index.js";
import { createSyncStateManager, Indexer, SqliteStore } from "../store/index.js";

export interface SeedContext {
  store: SqliteStore;
  syncManager: ReturnType<typeof createSyncStateManager>;
  indexer: Indexer;
}

export async function openSeedContext(): Promise<SeedContext> {
  const store = new SqliteStore();
  await store.open();
  const syncManager = createSyncStateManager(store);
  const indexer = new Indexer(store, syncManager);
  initIndexer(store, syncManager, indexer);
  return { store, syncManager, indexer };
}
