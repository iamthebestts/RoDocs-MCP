import { observe, startTimer } from "../utils/logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private readonly store: Map<string, CacheEntry<T>>;
  private readonly ttlMs: number;
  private readonly label: string;
  private readonly maxEntries: number;

  constructor(ttlMs: number = 10 * 60 * 1000, label = "memory", maxEntries = 1_000) {
    this.store = new Map();
    this.ttlMs = ttlMs;
    this.label = label;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const elapsed = startTimer();
    const entry = this.store.get(key);
    if (entry === undefined) {
      observe({ event: "cache.miss", source: this.label, key, durationMs: elapsed() });
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      observe({ event: "cache.miss", source: this.label, key, durationMs: elapsed() });
      return undefined;
    }
    // LRU: promote to most-recently-used by removing and re-inserting.
    // Map preserves insertion order — first key is LRU, last is MRU.
    this.store.delete(key);
    this.store.set(key, entry);
    observe({ event: "cache.hit", source: this.label, hit: true, key, durationMs: elapsed() });
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) {
      // Existing key: remove to reset recency position before re-inserting at end.
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // At capacity: evict the LRU entry (first key in Map insertion order).
      for (const lruKey of this.store.keys()) {
        this.store.delete(lruKey);
        observe({ event: "cache.evict", source: this.label, key: lruKey });
        break;
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    observe({ event: "cache.write", source: this.label, key });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
