import type { LatencyStats, MetricsSnapshot } from "./collector.js";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatLatency(stats: LatencyStats): string {
  if (stats.count === 0) return "  (no data)\n";
  return `  p50=${stats.p50}ms  p95=${stats.p95}ms  p99=${stats.p99}ms  (n=${stats.count})\n`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatMetricsReport(snap: MetricsSnapshot): string {
  const lines: string[] = [];

  lines.push("── Metrics Report ──────────────────────────────");
  lines.push("");
  lines.push("Cache:");
  lines.push(
    `  L1 hit rate: ${pct(snap.cache.l1HitRate)} (${snap.cache.l1Hits} hits / ${snap.cache.l1Hits + snap.cache.l1Misses} total)`,
  );
  lines.push(
    `  L2 hit rate: ${pct(snap.cache.l2HitRate)} (${snap.cache.l2Hits} hits / ${snap.cache.l2Hits + snap.cache.l2Misses} total)`,
  );
  lines.push(`  L1 miss → L2 hit rate: ${pct(snap.cache.l1MissToL2HitRate)}`);
  lines.push(`  L1+L2 miss → scrape rate: ${pct(snap.cache.totalMissToScrapeRate)}`);
  lines.push("");
  lines.push("Latency:");
  lines.push(`  BM25 search: ${formatLatency(snap.latency.search).trimEnd()}`);
  lines.push(`  Fallback scrape: ${formatLatency(snap.latency.scrape).trimEnd()}`);
  lines.push("");
  lines.push("BM25 Index:");
  lines.push(`  Rebuilds this session: ${snap.bm25.rebuildsTotal}`);
  lines.push(`  Avg rebuild time: ${snap.bm25.avgRebuildMs}ms`);
  lines.push("");
  lines.push("LRU:");
  lines.push(`  Items: ${snap.cache.currentSize} / ${snap.cache.maxSize}`);
  lines.push(`  Evictions by LRU: ${snap.cache.evictionsByLru}`);
  lines.push(`  Evictions by TTL: ${snap.cache.evictionsByTtl}`);
  lines.push("");
  lines.push(`Uptime: ${formatUptime(snap.uptimeMs)}`);
  lines.push("────────────────────────────────────────────────");

  return lines.join("\n");
}
