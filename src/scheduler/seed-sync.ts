import type { SyncState } from "../store/sync-state.js";
import {
  DEFAULT_ESTIMATED_TOTALS,
  type SeedProgress,
  type SeedSource,
  type SeedSyncManager,
} from "./seed-manager.js";

export function seedProgressKey(source: SeedSource): string {
  return `seed:${source}`;
}

export async function markSeedSourceComplete(
  syncManager: SeedSyncManager,
  source: SeedSource,
  options?: { seededItems?: number; embeddingsComplete?: boolean; embeddingsCount?: number },
): Promise<void> {
  const estimatedTotal = DEFAULT_ESTIMATED_TOTALS[source];
  const seededItems = options?.seededItems ?? estimatedTotal;
  const progress: SeedProgress = {
    source,
    status: "complete",
    seededItems,
    estimatedTotal: Math.max(estimatedTotal, seededItems),
    percent: 1,
  };

  const existing = await syncManager.getSourceState(seedProgressKey(source));
  const metadata: Record<string, unknown> = {
    ...(existing?.metadata ?? {}),
    seedProgress: progress,
  };
  if (options?.embeddingsComplete) {
    metadata.embeddingsComplete = true;
  }
  if (options?.embeddingsCount !== undefined) {
    metadata.embeddingsCount = options.embeddingsCount;
  }

  const state: Partial<SyncState> = {
    lastSyncAt: Date.now(),
    metadata,
  };
  await syncManager.updateSourceState(seedProgressKey(source), state);
}
