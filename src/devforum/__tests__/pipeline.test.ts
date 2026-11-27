import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeedProgressReporter } from "../../seed/progress.js";
import type { IKeyValueStore, Indexer, SyncStateManager } from "../../store/index.js";
import { logger } from "../../utils/logger.js";
import type { DevForumFetcher } from "../fetcher.js";
import { DevForumPipeline } from "../pipeline.js";
import type { DevForumTopicDetail } from "../types.js";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("DevForum Pipeline", () => {
  let pipeline: DevForumPipeline;
  let mockStore: IKeyValueStore;
  let mockSyncManager: SyncStateManager;
  let mockIndexer: Indexer;
  let mockFetcher: DevForumFetcher;

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    mockStore = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as IKeyValueStore;
    mockSyncManager = {
      getSourceState: vi.fn().mockResolvedValue(null),
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

  it("should report seed phases to an optional progress reporter", async () => {
    const phases: string[] = [];
    const reporter: SeedProgressReporter = {
      onPhase: (phase) => phases.push(phase),
      onStep: () => {},
      onNote: () => {},
    };

    await pipeline.seed({ reporter });

    expect(phases).toContain("categories");
    expect(phases).toContain("discovery");
    expect(phases).toContain("rank");
    expect(phases).toContain("fetch");
    expect(phases).toContain("index");
  });

  it("should skip discovery when a fresh cache exists", async () => {
    const cachedAt = Date.now();
    vi.mocked(mockSyncManager.getSourceState).mockResolvedValue({
      metadata: {
        discoveryCache: {
          cachedAt,
          candidates: [
            {
              topic: {
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
              },
              source: "top-monthly",
              tier: "top",
              weight: 4,
            },
          ],
        },
      },
    });

    const result = await pipeline.seed();

    expect(result.discoveryFromCache).toBe(true);
    expect(mockFetcher.getCategories).not.toHaveBeenCalled();
    expect(mockFetcher.search).not.toHaveBeenCalled();
    expect(result.added).toBe(1);
  });

  it("should emit a single aggregated warning for unresolved category slugs", async () => {
    await pipeline.seed();

    const warnCalls = vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
    const categoryWarns = warnCalls.filter((message) => message.includes("categories-unresolved"));
    expect(categoryWarns).toHaveLength(1);
    expect(categoryWarns[0]).toMatch(/categories-unresolved count=\d+ slugs=/);
    expect(categoryWarns[0]).not.toMatch(/category-skip/);
  });
});
