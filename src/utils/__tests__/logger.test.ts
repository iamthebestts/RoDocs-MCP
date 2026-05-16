import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setLogEventSinkForTesting, type LogEvent, observe, startTimer } from "../logger.js";

describe("logger observability helpers", () => {
  let captured: LogEvent[];

  beforeEach(() => {
    captured = [];
    _setLogEventSinkForTesting((e) => captured.push(e));
  });

  afterEach(() => {
    _setLogEventSinkForTesting(null);
  });

  describe("startTimer", () => {
    it("returns a function that yields a non-negative number", () => {
      const elapsed = startTimer();
      const ms = elapsed();
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThanOrEqual(0);
    });

    it("elapsed values are non-decreasing", () => {
      const elapsed = startTimer();
      const first = elapsed();
      const second = elapsed();
      expect(second).toBeGreaterThanOrEqual(first);
    });
  });

  describe("observe", () => {
    it("routes event to the test sink", () => {
      observe({ event: "cache.hit", source: "memory", hit: true, key: "k1", durationMs: 5 });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        event: "cache.hit",
        source: "memory",
        hit: true,
        key: "k1",
        durationMs: 5,
      });
    });

    it("routes multiple events in order", () => {
      observe({ event: "cache.miss", source: "disk", key: "k1", durationMs: 2 });
      observe({ event: "scraper.fallback", source: "scraper", strategy: "network" });

      expect(captured[0]?.event).toBe("cache.miss");
      expect(captured[1]?.event).toBe("scraper.fallback");
    });

    it("does not call sink after it is cleared", () => {
      _setLogEventSinkForTesting(null);
      observe({ event: "cache.hit", source: "memory" });
      expect(captured).toHaveLength(0);
    });
  });
});
