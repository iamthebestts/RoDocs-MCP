import { observe, startTimer } from "../utils/logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private readonly store: Map<string, CacheEntry<T>>;
  private readonly ttlMs: number;
  private readonly label: string;

  constructor(ttlMs: number = 10 * 60 * 1000, label = "memory") {
    this.store = new Map();
    this.ttlMs = ttlMs;
    this.label = label;
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
    observe({ event: "cache.hit", source: this.label, hit: true, key, durationMs: elapsed() });
    return entry.value;
  }

  set(key: string, value: T): void {
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
