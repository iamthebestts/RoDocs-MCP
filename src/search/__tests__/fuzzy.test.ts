import { describe, expect, it } from "vitest";
import { findClosestMatch, levenshteinDistance } from "../fuzzy.js";

describe("fuzzy search", () => {
  it("calculates Levenshtein distance", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("finds DataStore for Datastore", () => {
    expect(findClosestMatch("Datastore", ["DataStore", "TweenService"])).toBe("DataStore");
  });

  it("finds PathfindingService for a small typo", () => {
    expect(findClosestMatch("PathfindngService", ["PathfindingService"])).toBe(
      "PathfindingService",
    );
  });

  it("returns null above the threshold", () => {
    expect(findClosestMatch("abc", ["DataStore"], 1)).toBeNull();
  });
});
