import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LmdbStore, SyncStateManager } from "../../store/index.js";
import { DevForumPipeline } from "../pipeline.js";

vi.mock("../fetcher.js");

interface MockFetcher {
  getCategories: ReturnType<typeof vi.fn>;
  getCategoryLatest: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  getTopicDetail: ReturnType<typeof vi.fn>;
}

describe("DevForum Pipeline", () => {
  let pipeline: DevForumPipeline;
  let mockStore: Record<string, ReturnType<typeof vi.fn>>;
  let mockSyncManager: Record<string, ReturnType<typeof vi.fn>>;
  let mockFetcher: MockFetcher;

  beforeEach(() => {
    mockStore = {
      put: vi.fn().mockResolvedValue(undefined),
    };
    mockSyncManager = {
      updateSourceState: vi.fn().mockResolvedValue(undefined),
    };
    pipeline = new DevForumPipeline(
      mockStore as unknown as LmdbStore,
      mockSyncManager as unknown as SyncStateManager,
    );
    mockFetcher = (pipeline as unknown as { fetcher: MockFetcher }).fetcher;
  });

  it("should run the seed process", async () => {
    mockFetcher.getCategories.mockResolvedValue([
      { name: "Scripting Support", slug: "scripting-support", id: 54 },
    ]);
    mockFetcher.getCategoryLatest.mockResolvedValue([
      {
        id: 1,
        title: "Topic 1",
        slug: "t1",
        created_at: new Date().toISOString(),
      },
    ]);
    mockFetcher.search.mockResolvedValue([]);
    mockFetcher.getTopicDetail.mockResolvedValue({
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
      post_stream: {
        posts: [
          {
            id: 101,
            username: "u1",
            cooked: "<pre><code>print(1)</code></pre>",
            post_number: 1,
            staff: false,
          },
          {
            id: 102,
            username: "staff1",
            cooked: "p2",
            post_number: 2,
            staff: true,
          },
        ],
      },
      accepted_answer_post_number: 2,
    });

    const result = await pipeline.seed();

    expect(result.added).toBeGreaterThan(0);
    expect(mockStore.put).toHaveBeenCalled();
    expect(mockSyncManager.updateSourceState).toHaveBeenCalledWith("devforum", expect.any(Object));
  });
});
