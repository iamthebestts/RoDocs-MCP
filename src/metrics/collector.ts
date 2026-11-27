import type { LogEvent } from "../utils/logger.js";

export class CircularBuffer {
  private readonly buffer: number[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<number>(capacity);
  }

  push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = this.buffer.slice(0, this.count).sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  min(): number {
    if (this.count === 0) return 0;
    let m = this.buffer[0] as number;
    for (let i = 1; i < this.count; i++) {
      if ((this.buffer[i] as number) < m) m = this.buffer[i] as number;
    }
    return m;
  }

  max(): number {
    if (this.count === 0) return 0;
    let m = this.buffer[0] as number;
    for (let i = 1; i < this.count; i++) {
      if ((this.buffer[i] as number) > m) m = this.buffer[i] as number;
    }
    return m;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface MetricsSnapshot {
  uptimeMs: number;
  cache: {
    l1Hits: number;
    l1Misses: number;
    l1HitRate: number;
    l2Hits: number;
    l2Misses: number;
    l2HitRate: number;
    l1MissToL2HitRate: number;
    totalMissToScrapeRate: number;
    evictionsByLru: number;
    evictionsByTtl: number;
    currentSize: number;
    maxSize: number;
  };
  latency: {
    search: LatencyStats;
    scrape: LatencyStats;
  };
  bm25: {
    rebuildsTotal: number;
    avgRebuildMs: number;
  };
}

export class MetricsCollector {
  private static instance: MetricsCollector | null = null;

  private readonly startedAt = Date.now();

  private l1Hits = 0;
  private l1Misses = 0;
  private l2Hits = 0;
  private l2Misses = 0;
  private evictionsByLru = 0;
  private evictionsByTtl = 0;
  private rebuildsTotal = 0;
  private rebuildMsTotal = 0;

  private cacheSize = 0;
  private cacheMaxSize = 0;

  private readonly searchLatency: CircularBuffer;
  private readonly scrapeLatency: CircularBuffer;

  private constructor(bufferCapacity = 1_000) {
    this.searchLatency = new CircularBuffer(bufferCapacity);
    this.scrapeLatency = new CircularBuffer(bufferCapacity);
  }

  static getInstance(): MetricsCollector {
    if (MetricsCollector.instance === null) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  record(event: LogEvent): void {
    switch (event.event) {
      case "cache.hit":
        if (event.source === "disk") {
          this.l2Hits++;
        } else {
          this.l1Hits++;
        }
        break;
      case "cache.miss":
        if (event.source === "disk") {
          this.l2Misses++;
        } else {
          this.l1Misses++;
        }
        break;
      case "cache.evict":
        if (event.metadata?.reason === "ttl") {
          this.evictionsByTtl++;
        } else {
          this.evictionsByLru++;
        }
        break;
      case "search.query":
        if (typeof event.durationMs === "number") {
          this.searchLatency.push(event.durationMs);
        }
        break;
      case "search.rebuild":
      case "indexer.rebuild":
        this.rebuildsTotal++;
        if (typeof event.durationMs === "number") {
          this.rebuildMsTotal += event.durationMs;
        }
        break;
      case "scraper.fallback":
        if (event.strategy === "network" && typeof event.durationMs === "number") {
          this.scrapeLatency.push(event.durationMs);
        }
        break;
      case "cache.write": {
        const meta = event.metadata;
        if (meta && typeof meta.currentSize === "number" && typeof meta.maxSize === "number") {
          this.cacheSize = meta.currentSize;
          this.cacheMaxSize = meta.maxSize;
        }
        break;
      }
    }
  }

  setCacheGauge(currentSize: number, maxSize: number): void {
    this.cacheSize = currentSize;
    this.cacheMaxSize = maxSize;
  }

  snapshot(): MetricsSnapshot {
    const l1Total = this.l1Hits + this.l1Misses;
    const l2Total = this.l2Hits + this.l2Misses;

    return {
      uptimeMs: Date.now() - this.startedAt,
      cache: {
        l1Hits: this.l1Hits,
        l1Misses: this.l1Misses,
        l1HitRate: l1Total > 0 ? this.l1Hits / l1Total : 0,
        l2Hits: this.l2Hits,
        l2Misses: this.l2Misses,
        l2HitRate: l2Total > 0 ? this.l2Hits / l2Total : 0,
        l1MissToL2HitRate: this.l1Misses > 0 ? this.l2Hits / this.l1Misses : 0,
        totalMissToScrapeRate: l1Total > 0 ? (l1Total - this.l1Hits - this.l2Hits) / l1Total : 0,
        evictionsByLru: this.evictionsByLru,
        evictionsByTtl: this.evictionsByTtl,
        currentSize: this.cacheSize,
        maxSize: this.cacheMaxSize,
      },
      latency: {
        search: this.latencyStats(this.searchLatency),
        scrape: this.latencyStats(this.scrapeLatency),
      },
      bm25: {
        rebuildsTotal: this.rebuildsTotal,
        avgRebuildMs:
          this.rebuildsTotal > 0 ? Math.round(this.rebuildMsTotal / this.rebuildsTotal) : 0,
      },
    };
  }

  private latencyStats(buf: CircularBuffer): LatencyStats {
    return {
      count: buf.size,
      p50: buf.percentile(50),
      p95: buf.percentile(95),
      p99: buf.percentile(99),
      min: buf.min(),
      max: buf.max(),
    };
  }

  reset(): void {
    this.l1Hits = 0;
    this.l1Misses = 0;
    this.l2Hits = 0;
    this.l2Misses = 0;
    this.evictionsByLru = 0;
    this.evictionsByTtl = 0;
    this.rebuildsTotal = 0;
    this.rebuildMsTotal = 0;
    this.cacheSize = 0;
    this.cacheMaxSize = 0;
    this.searchLatency.clear();
    this.scrapeLatency.clear();
  }
}

export function _resetMetricsForTesting(): void {
  MetricsCollector.getInstance().reset();
}
