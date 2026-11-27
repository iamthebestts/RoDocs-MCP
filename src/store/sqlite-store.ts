import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { logger } from "../utils/logger.js";
import type { IKeyValueStore, KeyValueEntry } from "./store-interface.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "rodocsmcp");

export interface SqliteStoreOptions {
  /** Custom cache directory path. Defaults to ~/.cache/rodocsmcp/ */
  cacheDir?: string;
  /** Whether to create the cache directory if it doesn't exist. Default: true */
  createDir?: boolean;
}

/**
 * Computes the exclusive upper bound for a binary prefix range scan:
 * `key >= prefix AND key < upperBound`.
 * Returns `null` when `prefix` is empty or has no finite upper bound.
 */
function prefixUpperBound(prefix: string): string | null {
  if (prefix.length === 0) return null;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const code = prefix.charCodeAt(i);
    if (code < 0xffff) {
      return prefix.slice(0, i) + String.fromCharCode(code + 1);
    }
  }
  return null;
}

interface PreparedStatements {
  get: Database.Statement<[string], { value: string }>;
  put: Database.Statement<[string, string]>;
  del: Database.Statement<[string]>;
  keys: Database.Statement<[], { key: string }>;
  countAll: Database.Statement<[], { count: number }>;
  countRange: Database.Statement<[string, string], { count: number }>;
  countFrom: Database.Statement<[string], { count: number }>;
  getAll: Database.Statement<[], { key: string; value: string }>;
  getRange: Database.Statement<[string, string], { key: string; value: string }>;
  getFrom: Database.Statement<[string], { key: string; value: string }>;
  delAll: Database.Statement<[]>;
  delRange: Database.Statement<[string, string]>;
  delFrom: Database.Statement<[string]>;
  putManyTx: Database.Transaction<(entries: ReadonlyArray<KeyValueEntry<unknown>>) => void>;
}

export class SqliteStore implements IKeyValueStore {
  private db: Database.Database | null = null;
  private stmts: PreparedStatements | null = null;
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
      const db = new Database(this.path);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("busy_timeout = 5000");
      db.pragma("temp_store = MEMORY");

      try {
        loadSqliteVec(db);
      } catch (vecErr) {
        logger.warn(
          `[SqliteStore] sqlite-vec failed to load; hybrid search disabled: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`,
        );
      }

      db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
            id TEXT PRIMARY KEY,
            source TEXT,
            embedding FLOAT[384]
          )
        `);
      } catch {
        // vec0 unavailable if sqlite-vec failed to load — safe to ignore
      }

      const putStmt = db.prepare<[string, string]>(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
      );
      const putManyTx = db.transaction((entries: ReadonlyArray<KeyValueEntry<unknown>>) => {
        for (const entry of entries) {
          putStmt.run(entry.key, JSON.stringify(entry.value));
        }
      });

      this.db = db;
      this.stmts = {
        get: db.prepare<[string], { value: string }>("SELECT value FROM kv WHERE key = ?"),
        put: putStmt,
        del: db.prepare<[string]>("DELETE FROM kv WHERE key = ?"),
        keys: db.prepare<[], { key: string }>("SELECT key FROM kv"),
        countAll: db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM kv"),
        countRange: db.prepare<[string, string], { count: number }>(
          "SELECT COUNT(*) AS count FROM kv WHERE key >= ? AND key < ?",
        ),
        countFrom: db.prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM kv WHERE key >= ?",
        ),
        getAll: db.prepare<[], { key: string; value: string }>("SELECT key, value FROM kv"),
        getRange: db.prepare<[string, string], { key: string; value: string }>(
          "SELECT key, value FROM kv WHERE key >= ? AND key < ?",
        ),
        getFrom: db.prepare<[string], { key: string; value: string }>(
          "SELECT key, value FROM kv WHERE key >= ?",
        ),
        delAll: db.prepare<[]>("DELETE FROM kv"),
        delRange: db.prepare<[string, string]>("DELETE FROM kv WHERE key >= ? AND key < ?"),
        delFrom: db.prepare<[string]>("DELETE FROM kv WHERE key >= ?"),
        putManyTx,
      };
    } catch (error) {
      throw new Error(
        `Failed to open SQLite store at ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const stmts = this.ensureStatements();
    const row = stmts.get.get(key);
    if (row === undefined) return null;
    return JSON.parse(row.value) as T;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const stmts = this.ensureStatements();
    stmts.put.run(key, JSON.stringify(value));
  }

  async putMany<T = unknown>(entries: ReadonlyArray<KeyValueEntry<T>>): Promise<void> {
    const stmts = this.ensureStatements();
    if (entries.length === 0) return;
    stmts.putManyTx(entries);
  }

  async del(key: string): Promise<void> {
    const stmts = this.ensureStatements();
    stmts.del.run(key);
  }

  async keys(): Promise<string[]> {
    const stmts = this.ensureStatements();
    const rows = stmts.keys.all();
    return rows.map((r) => r.key);
  }

  async countByPrefix(prefix: string): Promise<number> {
    const stmts = this.ensureStatements();
    if (prefix.length === 0) {
      return stmts.countAll.get()?.count ?? 0;
    }
    const upper = prefixUpperBound(prefix);
    const row = upper !== null ? stmts.countRange.get(prefix, upper) : stmts.countFrom.get(prefix);
    return row?.count ?? 0;
  }

  async getByPrefix<T = unknown>(prefix: string): Promise<KeyValueEntry<T>[]> {
    const stmts = this.ensureStatements();
    let rows: Array<{ key: string; value: string }>;
    if (prefix.length === 0) {
      rows = stmts.getAll.all();
    } else {
      const upper = prefixUpperBound(prefix);
      rows = upper !== null ? stmts.getRange.all(prefix, upper) : stmts.getFrom.all(prefix);
    }
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
  }

  async delByPrefix(prefix: string): Promise<number> {
    const stmts = this.ensureStatements();
    if (prefix.length === 0) {
      return stmts.delAll.run().changes;
    }
    const upper = prefixUpperBound(prefix);
    const info = upper !== null ? stmts.delRange.run(prefix, upper) : stmts.delFrom.run(prefix);
    return info.changes;
  }

  async clear(): Promise<void> {
    const db = this.ensureOpen();
    const stmts = this.ensureStatements();
    stmts.delAll.run();
    try {
      db.prepare("DELETE FROM vec_items").run();
    } catch {
      // vec_items unavailable if sqlite-vec failed to load — safe to ignore
    }
  }

  async close(): Promise<void> {
    this.stmts = null;
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
    return this.ensureOpen();
  }

  private ensureOpen(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.db;
  }

  private ensureStatements(): PreparedStatements {
    if (!this.stmts) {
      throw new Error("SQLite store is not open. Call open() first.");
    }
    return this.stmts;
  }
}
