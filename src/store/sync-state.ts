/**
 * Sync state management for tracking source synchronization metadata
 */

export interface SyncState {
  /**
   * ETag from HTTP headers for conditional requests
   */
  etag?: string;
  /**
   * Last-Modified header from HTTP response
   */
  lastModified?: string;
  /**
   * Timestamp of last successful sync
   */
  lastSyncAt?: number;
  /**
   * Git commit SHA when source was last fetched
   */
  commitSha?: string;
  /**
   * Additional metadata for the source
   */
  metadata?: Record<string, unknown>;
}

/**
 * Manager for sync state per data source
 * Uses LMDB store for persistence
 */
export class SyncStateManager {
  constructor(private lmdbStore: import("./lmdb-store").LmdbStore) {}

  /**
   * Get sync state for a specific source
   */
  async getSourceState(sourceKey: string): Promise<SyncState | null> {
    const key = `sync:${sourceKey}`;
    return await this.lmdbStore.get<SyncState>(key);
  }

  /**
   * Update sync state for a specific source
   */
  async updateSourceState(sourceKey: string, state: Partial<SyncState>): Promise<void> {
    const key = `sync:${sourceKey}`;
    const current = await this.getSourceState(sourceKey);

    const updated: SyncState = {
      ...current,
      ...state,
    };

    await this.lmdbStore.put(key, updated);
  }

  /**
   * Clear sync state for a specific source
   */
  async clearSourceState(sourceKey: string): Promise<void> {
    const key = `sync:${sourceKey}`;
    await this.lmdbStore.del(key);
  }

  /**
   * Get all source keys with sync state
   */
  async getAllSourceKeys(): Promise<string[]> {
    const allKeys = await this.lmdbStore.keys();
    return allKeys.filter((key) => key.startsWith("sync:")).map((key) => key.replace("sync:", ""));
  }

  /**
   * Check if source needs sync based on conditions
   */
  async needsSync(
    sourceKey: string,
    options: {
      /**
       * Force sync regardless of state
       */
      force?: boolean;
      /**
       * Maximum age in milliseconds before forcing sync
       */
      maxAge?: number;
      /**
       * Current ETag to compare with stored ETag
       */
      etag?: string;
    } = {},
  ): Promise<boolean> {
    if (options.force) {
      return true;
    }

    const state = await this.getSourceState(sourceKey);
    if (!state) {
      return true; // No state means we need to sync
    }

    // Check if ETag has changed
    if (options.etag && state.etag && options.etag !== state.etag) {
      return true;
    }

    // Check age
    if (options.maxAge && state.lastSyncAt) {
      const age = Date.now() - state.lastSyncAt;
      if (age > options.maxAge) {
        return true;
      }
    }

    return false;
  }
}
