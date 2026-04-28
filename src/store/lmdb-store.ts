import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Database, open } from "lmdb";

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "rodocsmcp");
const DEFAULT_STORE_PATH = join(DEFAULT_CACHE_DIR, "store.lmdb");

export interface LmdbStoreOptions {
  /**
   * Custom cache directory path. Defaults to ~/.cache/rodocsmcp/store.lmdb
   */
  cacheDir?: string;
  /**
   * Whether to create the cache directory if it doesn't exist
   */
  createDir?: boolean;
}

/**
 * LMDB wrapper for RoDocsMCP caching
 * Provides type-safe operations over LMDB with proper error handling
 */
export class LmdbStore {
  private db: Database | null = null;
  private readonly path: string;

  constructor(options: LmdbStoreOptions = {}) {
    // Allow override via environment variable
    const envCacheDir = process.env.RODOCS_CACHE_DIR;

    if (options.cacheDir) {
      this.path = join(options.cacheDir, "store.lmdb");
    } else if (envCacheDir) {
      this.path = join(envCacheDir, "store.lmdb");
    } else {
      this.path = DEFAULT_STORE_PATH;
    }

    // Create directory if needed
    const dir = this.path.replace(/[/\\][^/\\]*$/, "");
    if (!existsSync(dir) && (options.createDir ?? true)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize the LMDB database
   */
  async open(): Promise<void> {
    try {
      this.db = open({
        path: this.path,
        compression: true,
      });
    } catch (error) {
      throw new Error(
        `Failed to open LMDB store at ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a value by key
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureOpen();
    try {
      const value = await this.getDb().get(key);
      return value !== undefined ? (value as T) : null;
    } catch (error) {
      throw new Error(
        `Failed to get key "${key}" from LMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Put a value with key
   */
  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.ensureOpen();
    try {
      await this.getDb().put(key, value);
    } catch (error) {
      throw new Error(
        `Failed to put key "${key}" to LMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    this.ensureOpen();
    try {
      await this.getDb().remove(key);
    } catch (error) {
      throw new Error(
        `Failed to delete key "${key}" from LMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T = unknown>(keys: string[]): Promise<Array<T | null>> {
    this.ensureOpen();
    const results: Array<T | null> = [];

    for (const key of keys) {
      try {
        const value = await this.getDb().get(key);
        results.push(value !== undefined ? (value as T) : null);
      } catch (error) {
        throw new Error(
          `Failed to get key "${key}" from LMDB: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  /**
   * Put multiple key-value pairs
   */
  async putMany<T = unknown>(entries: Array<{ key: string; value: T }>): Promise<void> {
    this.ensureOpen();

    // Simple implementation using individual puts
    // In a future version we could use proper transactions for atomicity
    for (const { key, value } of entries) {
      await this.put(key, value);
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
        this.db = null;
      } catch (error) {
        throw new Error(
          `Failed to close LMDB store: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Check if database is open
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Get the database path
   */
  getPath(): string {
    return this.path;
  }

  /**
   * Clear all data in the store
   */
  async clear(): Promise<void> {
    this.ensureOpen();
    try {
      await this.getDb().clear();
    } catch (error) {
      throw new Error(
        `Failed to clear LMDB store: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all keys in the store
   */
  async keys(): Promise<string[]> {
    this.ensureOpen();
    const keys: string[] = [];

    try {
      for await (const { key } of this.getDb().getRange()) {
        if (typeof key === "string") {
          keys.push(key);
        }
      }
      return keys;
    } catch (error) {
      throw new Error(
        `Failed to get keys from LMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private ensureOpen(): void {
    if (!this.db) {
      throw new Error("LMDB store is not open. Call open() first.");
    }
  }

  /**
   * Helper to assert database is open and return it
   */
  private getDb(): Database {
    if (!this.db) {
      throw new Error("LMDB store is not open. Call open() first.");
    }
    return this.db;
  }
}
