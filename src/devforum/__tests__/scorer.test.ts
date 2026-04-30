import { describe, expect, it } from "vitest";
import { calculateScore } from "../scorer.js";
import type { DevForumScoreInput } from "../types.js";

describe("DevForum Scorer", () => {
  const baseInput: DevForumScoreInput = {
    views: 1000,
    likes: 10,
    hasAcceptedAnswer: true,
    hasStaffReply: false,
    hasCode: true,
    replyCount: 5,
    ageDays: 10,
    isClosed: true,
  };

  it("should calculate a high score for quality topics", () => {
    const score = calculateScore(baseInput);
    // 30 (accepted) + 15 (code) + 10 (likes) + 2 (views) + 2 (replies) = 59
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it("should boost score with staff reply", () => {
    const scoreWithout = calculateScore({ ...baseInput, hasStaffReply: false });
    const scoreWith = calculateScore({ ...baseInput, hasStaffReply: true });
    expect(scoreWith).toBe(scoreWithout + 25);
  });

  it("should apply age penalty", () => {
    const freshScore = calculateScore({ ...baseInput, ageDays: 10 });
    const oldScore = calculateScore({ ...baseInput, ageDays: 730 }); // 2 years
    expect(oldScore).toBeLessThan(freshScore);
  });

  it("should reach 100 with perfect conditions", () => {
    const perfect: DevForumScoreInput = {
      views: 10000,
      likes: 50,
      hasAcceptedAnswer: true,
      hasStaffReply: true,
      hasCode: true,
      replyCount: 20,
      ageDays: 1,
      isClosed: false,
    };
    expect(calculateScore(perfect)).toBe(100);
  });

  it("should handle low engagement topics", () => {
    const poor: DevForumScoreInput = {
      views: 10,
      likes: 0,
      hasAcceptedAnswer: false,
      hasStaffReply: false,
      hasCode: false,
      replyCount: 1,
      ageDays: 400,
      isClosed: true,
    };
    expect(calculateScore(poor)).toBeLessThan(20);
  });
});
