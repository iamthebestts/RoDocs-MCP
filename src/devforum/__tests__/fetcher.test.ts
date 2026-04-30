import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevForumFetcher } from "../fetcher.js";

vi.mock("axios");

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
    vi.mocked(axios.get).mockResolvedValue({ data: mockData });

    const topics = await fetcher.search("query");
    expect(topics).toHaveLength(2);
    expect(topics[0]?.title).toBe("Topic 1");
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("search.json?q=query"));
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
    vi.mocked(axios.get).mockResolvedValue({ data: mockData });

    const detail = await fetcher.getTopicDetail(1);
    expect(detail.id).toBe(1);
    expect(detail.post_stream.posts).toHaveLength(1);
  });

  it("should fetch categories", async () => {
    const mockData = {
      category_list: {
        categories: [{ id: 1, name: "Cat 1", slug: "cat-1" }],
      },
    };
    vi.mocked(axios.get).mockResolvedValue({ data: mockData });

    const cats = await fetcher.getCategories();
    expect(cats).toHaveLength(1);
    expect(cats[0]?.name).toBe("Cat 1");
  });

  it("should fetch category latest topics", async () => {
    const mockData = {
      topic_list: {
        topics: [{ id: 1, title: "T1", slug: "t1" }],
      },
    };
    vi.mocked(axios.get).mockResolvedValue({ data: mockData });

    const topics = await fetcher.getCategoryLatest("cat-1", 1);
    expect(topics).toHaveLength(1);
    expect(topics[0]?.title).toBe("T1");
  });
});
