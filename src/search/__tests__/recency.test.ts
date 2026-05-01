import { describe, expect, it } from "vitest";
import { applyRecencyBoost } from "../recency.js";

describe("applyRecencyBoost", () => {
  it("keeps age zero near the original score", () => {
    expect(applyRecencyBoost(10, 0)).toBeCloseTo(10);
  });

  it("halves the score at the configured half-life", () => {
    expect(applyRecencyBoost(10, 30, { halfLifeDays: 30, minMultiplier: 0.1 })).toBeCloseTo(5);
  });

  it("returns the original score when disabled", () => {
    expect(applyRecencyBoost(10, 365, { enabled: false })).toBe(10);
  });
});
