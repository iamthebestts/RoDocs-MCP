import { describe, expect, it } from "vitest";
import { processTopic } from "../processor.js";
import type { DevForumTopicDetail } from "../types.js";

describe("DevForum Processor", () => {
  const mockTopic: DevForumTopicDetail = {
    id: 1,
    title: "Sample Topic",
    slug: "sample-topic",
    posts_count: 2,
    reply_count: 1,
    views: 1000,
    like_count: 20,
    has_accepted_answer: true,
    created_at: new Date().toISOString(),
    closed: false,
    category_id: undefined,
    tags: undefined,
    accepted_answer_post_number: 2,
    post_stream: {
      posts: [
        {
          id: 101,
          username: "user1",
          cooked: "<p>This is the problem. <pre><code>print('hello')</code></pre></p>",
          post_number: 1,
          created_at: new Date().toISOString(),
          staff: false,
          trust_level: 2,
        },
        {
          id: 102,
          username: "staff1",
          cooked: "<p>This is the solution. <pre><code>print('world')</code></pre></p>",
          post_number: 2,
          created_at: new Date().toISOString(),
          staff: true,
          trust_level: 4,
        },
      ],
    },
  };

  it("should extract code snippets", () => {
    const record = processTopic(mockTopic);
    expect(record.codeSnippets).toContain("print('hello')");
    expect(record.codeSnippets).toContain("print('world')");
  });

  it("should clean HTML content", () => {
    const record = processTopic(mockTopic);
    expect(record.content).not.toContain("<p>");
    expect(record.content).toContain("This is the problem.");
  });

  it("should identify staff replies", () => {
    const record = processTopic(mockTopic);
    expect(record.staffReplies).toHaveLength(1);
    expect(record.staffReplies[0]).toContain("This is the solution.");
  });

  it("should identify accepted answer", () => {
    const record = processTopic(mockTopic);
    expect(record.acceptedAnswer).toContain("This is the solution.");
  });

  it("should calculate score", () => {
    const record = processTopic(mockTopic);
    expect(record.score).toBeGreaterThan(60);
  });
});
