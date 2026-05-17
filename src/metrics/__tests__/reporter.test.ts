import { describe, expect, it } from "vitest";
import type { MetricsSnapshot } from "../collector.js";
import { formatMetricsReport } from "../reporter.js";

function makeSnapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    uptimeMs: 65_000,
    cache: {
      l1Hits: 80,
      l1Misses: 20,
      l1HitRate: 0.8,
      l2Hits: 15,
      l2Misses: 5,
      l2HitRate: 0.75,
      l1MissToL2HitRate: 0.75,
      totalMissToScrapeRate: 0.05,
      evictionsByLru: 3,
      evictionsByTtl: 7,
      currentSize: 150,
      maxSize: 1000,
    },
    latency: {
      search: { count: 50, p50: 2, p95: 8, p99: 15, min: 1, max: 20 },
      scrape: { count: 5, p50: 150, p95: 300, p99: 450, min: 80, max: 500 },
    },
    bm25: {
      rebuildsTotal: 4,
      avgRebuildMs: 120,
    },
    ...overrides,
  };
}

describe("formatMetricsReport", () => {
  it("contains cache hit rate section", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("L1 hit rate: 80.0%");
    expect(report).toContain("80 hits / 100 total");
  });

  it("contains L2 hit rate", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("L2 hit rate: 75.0%");
  });

  it("contains latency percentiles", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("p50=2ms");
    expect(report).toContain("p95=8ms");
    expect(report).toContain("p99=15ms");
  });

  it("contains BM25 rebuild info", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("Rebuilds this session: 4");
    expect(report).toContain("Avg rebuild time: 120ms");
  });

  it("contains LRU info", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("Items: 150 / 1000");
    expect(report).toContain("Evictions by LRU: 3");
    expect(report).toContain("Evictions by TTL: 7");
  });

  it("formats uptime in minutes", () => {
    const report = formatMetricsReport(makeSnapshot({ uptimeMs: 65_000 }));
    expect(report).toContain("Uptime: 1m 5s");
  });

  it("formats uptime in hours", () => {
    const report = formatMetricsReport(makeSnapshot({ uptimeMs: 3_700_000 }));
    expect(report).toContain("Uptime: 1h 1m");
  });

  it("shows (no data) when latency count is 0", () => {
    const snap = makeSnapshot();
    snap.latency.scrape = { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
    const report = formatMetricsReport(snap);
    expect(report).toContain("(no data)");
  });

  it("contains header and footer lines", () => {
    const report = formatMetricsReport(makeSnapshot());
    expect(report).toContain("── Metrics Report");
    expect(report).toContain("────────────────────────────────────────────────");
  });
});
