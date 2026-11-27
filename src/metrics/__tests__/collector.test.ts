import { beforeEach, describe, expect, it } from "vitest";
import { _resetMetricsForTesting, CircularBuffer, MetricsCollector } from "../collector.js";

describe("CircularBuffer", () => {
  it("returns 0 for all stats when empty", () => {
    const buf = new CircularBuffer(10);
    expect(buf.size).toBe(0);
    expect(buf.percentile(50)).toBe(0);
    expect(buf.min()).toBe(0);
    expect(buf.max()).toBe(0);
  });

  it("accumulates values up to capacity", () => {
    const buf = new CircularBuffer(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.size).toBe(3);
  });

  it("wraps around when capacity is exceeded", () => {
    const buf = new CircularBuffer(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.size).toBe(3);
    expect(buf.min()).toBe(2);
    expect(buf.max()).toBe(4);
  });

  it("calculates percentiles correctly with known values", () => {
    const buf = new CircularBuffer(100);
    for (let i = 1; i <= 100; i++) {
      buf.push(i);
    }
    expect(buf.percentile(50)).toBe(50);
    expect(buf.percentile(95)).toBe(95);
    expect(buf.percentile(99)).toBe(99);
  });

  it("calculates p50 for small buffer", () => {
    const buf = new CircularBuffer(10);
    buf.push(5);
    buf.push(1);
    buf.push(3);
    expect(buf.percentile(50)).toBe(3);
  });

  it("clears the buffer", () => {
    const buf = new CircularBuffer(10);
    buf.push(42);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.percentile(50)).toBe(0);
  });
});

describe("MetricsCollector", () => {
  beforeEach(() => {
    _resetMetricsForTesting();
  });

  it("is a singleton", () => {
    const a = MetricsCollector.getInstance();
    const b = MetricsCollector.getInstance();
    expect(a).toBe(b);
  });

  it("records L1 cache hits and misses", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "a", durationMs: 1 });
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "b", durationMs: 1 });
    mc.record({ event: "cache.miss", source: "memory", key: "c", durationMs: 2 });

    const snap = mc.snapshot();
    expect(snap.cache.l1Hits).toBe(2);
    expect(snap.cache.l1Misses).toBe(1);
  });

  it("records L2 cache hits and misses", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.hit", source: "disk", hit: true, key: "x", durationMs: 5 });
    mc.record({ event: "cache.miss", source: "disk", key: "y", durationMs: 3 });

    const snap = mc.snapshot();
    expect(snap.cache.l2Hits).toBe(1);
    expect(snap.cache.l2Misses).toBe(1);
  });

  it("calculates hit rate correctly — 0%", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.miss", source: "memory", key: "a" });
    mc.record({ event: "cache.miss", source: "memory", key: "b" });

    const snap = mc.snapshot();
    expect(snap.cache.l1HitRate).toBe(0);
  });

  it("calculates hit rate correctly — 50%", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "a" });
    mc.record({ event: "cache.miss", source: "memory", key: "b" });

    const snap = mc.snapshot();
    expect(snap.cache.l1HitRate).toBe(0.5);
  });

  it("calculates hit rate correctly — 100%", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "a" });
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "b" });

    const snap = mc.snapshot();
    expect(snap.cache.l1HitRate).toBe(1);
  });

  it("tracks evictions by LRU", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.evict", source: "memory", key: "old", metadata: { reason: "lru" } });
    mc.record({ event: "cache.evict", source: "memory", key: "old2", metadata: { reason: "lru" } });

    const snap = mc.snapshot();
    expect(snap.cache.evictionsByLru).toBe(2);
    expect(snap.cache.evictionsByTtl).toBe(0);
  });

  it("tracks evictions by TTL", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({
      event: "cache.evict",
      source: "memory",
      key: "expired",
      metadata: { reason: "ttl" },
    });

    const snap = mc.snapshot();
    expect(snap.cache.evictionsByTtl).toBe(1);
    expect(snap.cache.evictionsByLru).toBe(0);
  });

  it("tracks search latency percentiles", () => {
    const mc = MetricsCollector.getInstance();
    for (let i = 1; i <= 100; i++) {
      mc.record({ event: "search.query", source: "api", durationMs: i });
    }

    const snap = mc.snapshot();
    expect(snap.latency.search.count).toBe(100);
    expect(snap.latency.search.p50).toBe(50);
    expect(snap.latency.search.p95).toBe(95);
    expect(snap.latency.search.p99).toBe(99);
    expect(snap.latency.search.min).toBe(1);
    expect(snap.latency.search.max).toBe(100);
  });

  it("tracks scrape latency only for network strategy", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "scraper.fallback", source: "scraper", key: "A", strategy: "disk" });
    mc.record({
      event: "scraper.fallback",
      source: "scraper",
      key: "B",
      strategy: "network",
      durationMs: 200,
    });

    const snap = mc.snapshot();
    expect(snap.latency.scrape.count).toBe(1);
    expect(snap.latency.scrape.p50).toBe(200);
  });

  it("counts BM25 rebuilds", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "search.rebuild", source: "api", durationMs: 50 });
    mc.record({ event: "search.rebuild", source: "guides", durationMs: 30 });
    mc.record({ event: "indexer.rebuild", source: "devforum", durationMs: 100 });

    const snap = mc.snapshot();
    expect(snap.bm25.rebuildsTotal).toBe(3);
    expect(snap.bm25.avgRebuildMs).toBe(60);
  });

  it("updates cache gauge from cache.write metadata", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({
      event: "cache.write",
      source: "memory",
      key: "x",
      metadata: { currentSize: 42, maxSize: 1000 },
    });

    const snap = mc.snapshot();
    expect(snap.cache.currentSize).toBe(42);
    expect(snap.cache.maxSize).toBe(1000);
  });

  it("reset() clears all state", () => {
    const mc = MetricsCollector.getInstance();
    mc.record({ event: "cache.hit", source: "memory", hit: true, key: "a", durationMs: 5 });
    mc.record({ event: "search.query", source: "api", durationMs: 10 });
    mc.record({ event: "cache.evict", source: "memory", key: "b", metadata: { reason: "lru" } });

    mc.reset();
    const snap = mc.snapshot();

    expect(snap.cache.l1Hits).toBe(0);
    expect(snap.cache.l1Misses).toBe(0);
    expect(snap.cache.evictionsByLru).toBe(0);
    expect(snap.latency.search.count).toBe(0);
    expect(snap.bm25.rebuildsTotal).toBe(0);
  });

  it("snapshot reports uptime", () => {
    const mc = MetricsCollector.getInstance();
    const snap = mc.snapshot();
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
