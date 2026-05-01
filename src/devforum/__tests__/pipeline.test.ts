import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Indexer, LmdbStore, SyncStateManager } from "../../store/index.js";
import type { DevForumFetcher } from "../fetcher.js";
import { DevForumPipeline } from "../pipeline.js";
import type { DevForumTopicDetail } from "../types.js";

vi.mock("../fetcher.js");

describe("DevForum Pipeline", () => {
  let pipeline: DevForumPipeline;
  let mockStore: LmdbStore;
  let mockSyncManager: SyncStateManager;
  let mockIndexer: Indexer;
  let mockFetcher: DevForumFetcher;

  beforeEach(() => {
    mockStore = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as LmdbStore;
    mockSyncManager = {
      updateSourceState: vi.fn().mockResolvedValue(undefined),
    } as unknown as SyncStateManager;
    mockIndexer = {
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as Indexer;

    pipeline = new DevForumPipeline(mockStore, mockSyncManager, mockIndexer);
    mockFetcher = pipeline.fetcher;

    // Mock all methods
    vi.spyOn(mockFetcher, "getCategories").mockResolvedValue([
      { name: "Scripting Support", slug: "scripting-support", id: 54 },
    ]);
    vi.spyOn(mockFetcher, "getCategoryLatest").mockResolvedValue([
      {
        id: 1,
        title: "Topic 1",
        slug: "t1",
        posts_count: 2,
        reply_count: 1,
        views: 10000,
        like_count: 50,
        has_accepted_answer: true,
        created_at: new Date().toISOString(),
        closed: false,
        category_id: 54,
        tags: [],
      },
    ]);
    vi.spyOn(mockFetcher, "search").mockResolvedValue([]);
    vi.spyOn(mockFetcher, "getTopicDetail").mockResolvedValue({
      id: 1,
      title: "Topic 1",
      slug: "t1",
      posts_count: 2,
      reply_count: 1,
      views: 10000,
      like_count: 50,
      has_accepted_answer: true,
      created_at: new Date().toISOString(),
      closed: false,
      category_id: 54,
      tags: [],
      post_stream: {
        posts: [
          {
            id: 101,
            username: "u1",
            cooked: "p1",
            post_number: 1,
            staff: false,
            trust_level: 1,
            created_at: new Date().toISOString(),
          },
        ],
      },
      accepted_answer_post_number: 1,
    } as DevForumTopicDetail);
    vi.spyOn(mockFetcher, "getTopMonthly").mockResolvedValue([]);
    vi.spyOn(mockFetcher, "getTopYearly").mockResolvedValue([]);
    vi.spyOn(mockFetcher, "getTopAllTime").mockResolvedValue([]);
    vi.spyOn(mockFetcher, "getCategoryTop").mockResolvedValue([]);
  });

  it("should run the seed process", async () => {
    const result = await pipeline.seed();
    expect(result.added).toBe(1);
    expect(mockStore.put).toHaveBeenCalled();
    expect(mockSyncManager.updateSourceState).toHaveBeenCalledWith(
      "devforum",
      expect.objectContaining({
        topicCount: expect.any(Number),
      }),
    );
  });
});
