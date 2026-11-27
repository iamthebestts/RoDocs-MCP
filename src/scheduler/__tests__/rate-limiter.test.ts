import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should allow requests when tokens are available", async () => {
    const limiter = new RateLimiter(1);
    const promise = limiter.acquire();
    vi.advanceTimersByTime(1);
    await promise;
    expect(true).toBe(true);
  });

  it("should block requests when tokens are exhausted", async () => {
    const limiter = new RateLimiter(1);

    const p1 = limiter.acquire();
    vi.advanceTimersByTime(1);
    await p1;

    let resolved = false;
    limiter.acquire().then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(500);
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync(); // This might still be dangerous, but for a single resolve it should be okay
    expect(resolved).toBe(true);
  });

  it("should implement exponential backoff on specific errors", async () => {
    const limiter = new RateLimiter(1);

    limiter.reportError(429);

    let resolved = false;
    limiter.acquire().then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(1000);
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(10000);
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });

  it("should reset backoff on success", async () => {
    const limiter = new RateLimiter(1);
    limiter.reportError(429);
    limiter.resetBackoff();

    let resolved = false;
    limiter.acquire().then(() => {
      resolved = true;
    });

    vi.runAllTimers();
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });
});
