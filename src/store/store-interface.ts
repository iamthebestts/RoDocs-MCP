export interface IKeyValueStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void | unknown>;
  isOpen(): boolean;
  /**
   * Returns the full path to the backing store file (e.g. store.lmdb or store.db).
   * Not the directory — the file. Consumers that need the directory must strip the filename.
   */
  getPath(): string;
}
