import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCache } from "../cache.js";

describe("MemoryCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
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
});
