import { describe, expect, it } from "vitest";
import { isTechnicalCategory, shouldRejectTopic } from "../filters.js";
import type { DevForumTopic } from "../types.js";

describe("DevForum Filters", () => {
  const baseTopic: DevForumTopic = {
    id: 123,
    title: "How to optimize Luau code",
    slug: "how-to-optimize-luau-code",
    posts_count: 5,
    reply_count: 4,
    views: 1000,
    like_count: 10,
    has_accepted_answer: true,
    created_at: new Date().toISOString(),
    closed: false,
    category_id: undefined,
    tags: undefined,
  };

  it("should accept technical topics", () => {
    expect(shouldRejectTopic(baseTopic)).toBe(false);
  });

  it("should reject closed topics without accepted answer", () => {
    const topic = { ...baseTopic, closed: true, has_accepted_answer: false };
    expect(shouldRejectTopic(topic)).toBe(true);
  });

  it("should reject topics with non-technical title patterns", () => {
    const topic = { ...baseTopic, title: "Please add this feature to Roblox" };
    expect(shouldRejectTopic(topic)).toBe(true);

    const topic2 = { ...baseTopic, title: "Hiring a scripter for 100k Robux" };
    expect(shouldRejectTopic(topic2)).toBe(true);
  });

  it("should reject old topics with low engagement", () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    const topic = {
      ...baseTopic,
      created_at: oldDate.toISOString(),
      like_count: 0,
      reply_count: 0,
    };
    expect(shouldRejectTopic(topic)).toBe(true);
  });

  it("should reject topics with blacklisted tags", () => {
    const topic = { ...baseTopic, tags: ["recruitment", "scripting"] };
    expect(shouldRejectTopic(topic)).toBe(true);
  });

  it("should correctly identify technical categories", () => {
    expect(isTechnicalCategory("Scripting Support", "scripting-support")).toBe(true);
    expect(isTechnicalCategory("Community Tutorials", "community-tutorials")).toBe(true);
    expect(isTechnicalCategory("Off-topic", "off-topic")).toBe(false);
    expect(isTechnicalCategory("Recruitment", "recruitment")).toBe(false);
  });
});
