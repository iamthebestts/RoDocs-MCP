export interface KeyValueEntry<T = unknown> {
  key: string;
  value: T;
}

export interface IKeyValueStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** Count KV entries whose key starts with the given prefix. */
  countByPrefix(prefix: string): Promise<number>;
  /** Optional fast prefix scan returning parsed entries (implemented by SqliteStore). */
  getByPrefix?<T = unknown>(prefix: string): Promise<KeyValueEntry<T>[]>;
  /** Optional atomic batch upsert (implemented by SqliteStore). */
  putMany?<T = unknown>(entries: ReadonlyArray<KeyValueEntry<T>>): Promise<void>;
  /** Optional fast prefix delete returning number of deleted rows (implemented by SqliteStore). */
  delByPrefix?(prefix: string): Promise<number>;
  clear(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<undefined | unknown>;
  isOpen(): boolean;
  /**
   * Returns the full path to the backing store file (e.g. store.db).
   * Not the directory — the file. Consumers that need the directory must strip the filename.
   */
  getPath(): string;
}
