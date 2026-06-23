import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevForumFetcher } from "../fetcher.js";
import { devForumClient } from "../http.js";

vi.mock("../http.js", () => ({
  devForumClient: {
    get: vi.fn(),
  },
}));

describe("DevForum Fetcher", () => {
  let fetcher: DevForumFetcher;

  beforeEach(() => {
    fetcher = new DevForumFetcher();
    vi.resetAllMocks();
  });

  it("should search for topics", async () => {
    const mockData = {
      topics: [
        { id: 1, title: "Topic 1", slug: "topic-1", views: 100 },
        { id: 2, title: "Topic 2", slug: "topic-2", views: 200 },
      ],
    };
    vi.mocked(devForumClient.get).mockResolvedValue({ data: mockData });

    const topics = await fetcher.search("query");
    expect(topics).toHaveLength(2);
    expect(topics[0]?.title).toBe("Topic 1");
    expect(devForumClient.get).toHaveBeenCalledWith(expect.stringContaining("search.json?q=query"));
  });

  it("should reject topic detail responses without post_stream", async () => {
    vi.mocked(devForumClient.get).mockResolvedValue({
      data: { id: 9, title: "Empty", slug: "empty" },
    });

    await expect(fetcher.getTopicDetail(9)).rejects.toThrow(/missing post_stream\.posts/);
  });

  it("should fetch topic detail", async () => {
    const mockData = {
      id: 1,
      title: "Topic 1",
      slug: "topic-1",
      post_stream: {
        posts: [
          {
            id: 101,
            username: "u1",
            cooked: "p1",
            post_number: 1,
            staff: false,
          },
        ],
      },
    };
    vi.mocked(devForumClient.get).mockResolvedValue({ data: mockData });

    const detail = await fetcher.getTopicDetail(1);
    expect(detail.id).toBe(1);
    expect(detail.post_stream.posts).toHaveLength(1);
  });

  it("should fetch categories including nested subcategories", async () => {
    const mockData = {
      category_list: {
        categories: [
          {
            id: 45,
            name: "Updates",
            slug: "updates",
            subcategory_list: [
              { id: 36, name: "Announcements", slug: "announcements" },
              { id: 193, name: "Release Notes", slug: "release-notes" },
            ],
          },
          { id: 71, name: "Resources", slug: "resources" },
        ],
      },
    };
    vi.mocked(devForumClient.get).mockResolvedValue({ data: mockData });

    const cats = await fetcher.getCategories();
    expect(devForumClient.get).toHaveBeenCalledWith(
      expect.stringContaining("categories.json?include_subcategories=true"),
    );
    expect(cats).toHaveLength(4);
    expect(cats.map((c) => c.slug)).toEqual([
      "updates",
      "announcements",
      "release-notes",
      "resources",
    ]);
  });

  it("should fetch category latest topics", async () => {
    const mockData = {
      topic_list: {
        topics: [{ id: 1, title: "T1", slug: "t1" }],
      },
    };
    vi.mocked(devForumClient.get).mockResolvedValue({ data: mockData });

    const topics = await fetcher.getCategoryLatest("cat-1", 1);
    expect(topics).toHaveLength(1);
    expect(topics[0]?.title).toBe("T1");
  });
});
