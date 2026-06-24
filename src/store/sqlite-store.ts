import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { logger } from "../utils/logger.js";
import type { IKeyValueStore } from "./store-interface.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "rodocsmcp");

export interface SqliteStoreOptions {
  /** Custom cache directory path. Defaults to ~/.cache/rodocsmcp/ */
  cacheDir?: string;
  /** Whether to create the cache directory if it doesn't exist. Default: true */
  createDir?: boolean;
}

export class SqliteStore implements IKeyValueStore {
  private db: Database.Database | null = null;
  private readonly path: string;

  constructor(options: SqliteStoreOptions = {}) {
    const envCacheDir = process.env.RODOCS_CACHE_DIR;
    const cacheDir = options.cacheDir ?? envCacheDir ?? DEFAULT_CACHE_DIR;
    this.path = join(cacheDir, "store.db");

    if (!existsSync(cacheDir) && (options.createDir ?? true)) {
      mkdirSync(cacheDir, { recursive: true });
    }
  }

  async open(): Promise<void> {
    try {
      this.db = new Database(this.path);

      try {
        loadSqliteVec(this.db);
      } catch (vecErr) {
        logger.warn(
          `[SqliteStore] sqlite-vec failed to load; hybrid search disabled: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`,
        );
      }

      this.db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
            id TEXT PRIMARY KEY,
            source TEXT,
            embedding FLOAT[384]
          )
        `);
      } catch {
        // vec0 unavailable if sqlite-vec failed to load — safe to ignore
      }
    } catch (error) {
      throw new Error(
        `Failed to open SQLite store at ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = this.ensureOpen();
    const row = db
      .prepare<[string], { value: string }>("SELECT value FROM kv WHERE key = ?")
      .get(key);
    if (row === undefined) return null;
    return JSON.parse(row.value) as T;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(
      key,
      JSON.stringify(value),
    );
  }

  async del(key: string): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }

  async keys(): Promise<string[]> {
    const db = this.ensureOpen();
    const rows = db.prepare<[], { key: string }>("SELECT key FROM kv").all();
    return rows.map((r) => r.key);
  }

  async countByPrefix(prefix: string): Promise<number> {
    const db = this.ensureOpen();
    const row = db
      .prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM kv WHERE key LIKE ?")
      .get(`${prefix}%`);
    return row?.count ?? 0;
  }

  async clear(): Promise<void> {
    const db = this.ensureOpen();
    db.prepare("DELETE FROM kv").run();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  getPath(): string {
    return this.path;
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.db;
  }

  private ensureOpen(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.db;
  }
}
