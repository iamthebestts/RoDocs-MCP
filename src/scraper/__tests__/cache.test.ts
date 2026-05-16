import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setLogEventSinkForTesting, type LogEvent } from "../../utils/logger.js";
import { MemoryCache } from "../cache.js";

describe("MemoryCache", () => {
  let captured: LogEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    captured = [];
    _setLogEventSinkForTesting((e) => captured.push(e));
  });

  afterEach(() => {
    _setLogEventSinkForTesting(null);
    vi.useRealTimers();
  });

  it("stores values and reports membership", () => {
    const cache = new MemoryCache<string>();

    cache.set("topic", "value");

    expect(cache.get("topic")).toBe("value");
    expect(cache.has("topic")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("clears entries", () => {
    const cache = new MemoryCache<string>();

    cache.set("topic", "value");
    cache.clear();

    expect(cache.get("topic")).toBeUndefined();
    expect(cache.has("topic")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("expires entries after ttl", () => {
    const cache = new MemoryCache<string>(1000);

    cache.set("topic", "value");
    vi.advanceTimersByTime(1001);

    expect(cache.get("topic")).toBeUndefined();
    expect(cache.has("topic")).toBe(false);
    expect(cache.size).toBe(0);
  });

  describe("observability", () => {
    it("emits cache.hit on a successful get", () => {
      const cache = new MemoryCache<string>(10_000, "l1");
      cache.set("k1", "v1");
      captured = [];

      cache.get("k1");

      const hit = captured.find((e) => e.event === "cache.hit");
      expect(hit).toMatchObject({ event: "cache.hit", source: "l1", hit: true, key: "k1" });
      expect(typeof hit?.durationMs).toBe("number");
    });

    it("emits cache.miss when key is absent", () => {
      const cache = new MemoryCache<string>(10_000, "l1");

      cache.get("missing");

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({ event: "cache.miss", source: "l1", key: "missing" });
      expect(typeof captured[0]?.durationMs).toBe("number");
    });

    it("emits cache.miss when entry is expired", () => {
      const cache = new MemoryCache<string>(1000, "l1");
      cache.set("k1", "v1");
      captured = [];
      vi.advanceTimersByTime(1001);

      cache.get("k1");

      expect(captured.some((e) => e.event === "cache.miss" && e.key === "k1")).toBe(true);
    });

    it("emits cache.write on set", () => {
      const cache = new MemoryCache<string>(10_000, "l1");

      cache.set("k1", "v1");

      expect(captured.some((e) => e.event === "cache.write" && e.key === "k1")).toBe(true);
    });

    it("uses the provided label as source", () => {
      const cache = new MemoryCache<string>(10_000, "custom-label");
      cache.get("any");

      expect(captured[0]?.source).toBe("custom-label");
    });

    it("defaults to 'memory' label", () => {
      const cache = new MemoryCache<string>();
      cache.get("any");

      expect(captured[0]?.source).toBe("memory");
    });
  });
});
