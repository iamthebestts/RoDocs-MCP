import { describe, expect, it, vi } from "vitest";
import { IdleDetector } from "../idle-detector.js";

describe("IdleDetector", () => {
  it("should not be idle initially", () => {
    const detector = new IdleDetector(1000);
    expect(detector.isIdle()).toBe(false);
  });

  it("should be idle after threshold", async () => {
    const detector = new IdleDetector(1000);
    vi.useFakeTimers();

    vi.advanceTimersByTime(1001);
    expect(detector.isIdle()).toBe(true);
  });

  it("should reset idle state on activity", async () => {
    const detector = new IdleDetector(1000);
    vi.useFakeTimers();

    vi.advanceTimersByTime(500);
    detector.recordActivity();

    vi.advanceTimersByTime(600);
    expect(detector.isIdle()).toBe(false);

    vi.advanceTimersByTime(500);
    expect(detector.isIdle()).toBe(true);
  });
});
