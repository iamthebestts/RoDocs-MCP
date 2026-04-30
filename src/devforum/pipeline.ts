import type { LmdbStore, SyncStateManager } from "../store/index.js";
import { DevForumFetcher } from "./fetcher.js";
import { isTechnicalCategory, shouldRejectTopic } from "./filters.js";
import { processTopic } from "./processor.js";

const DEFAULT_QUERIES = [
  "Luau performance",
  "Memory leak",
  "DataStore",
  "PathfindingService",
  "StreamingEnabled",
  "CollectionService",
  "Parallel Luau",
  "Actor",
  "MicroProfiler",
  "RemoteEvent security",
  "BasePart optimization",
];

export class DevForumPipeline {
  private fetcher: DevForumFetcher;

  constructor(
    private readonly store: LmdbStore,
    private readonly syncManager: SyncStateManager,
  ) {
    this.fetcher = new DevForumFetcher();
  }

  async seed(): Promise<{ added: number; rejected: number; scored: number }> {
    let added = 0;
    let rejected = 0;
    let scored = 0;

    console.log("[DevForumPipeline] Starting seed process...");

    // 1. Get technical categories
    const categories = await this.fetcher.getCategories();
    const techCategories = categories.filter((c) =>
      isTechnicalCategory(c.name as string, c.slug as string),
    );

    const topicIds = new Set<number>();

    // 2. Fetch latest topics from technical categories
    for (const cat of techCategories) {
      console.log(`[DevForumPipeline] Fetching latest from category: ${cat.name}`);
      try {
        const topics = await this.fetcher.getCategoryLatest(cat.slug as string, cat.id as number);

        for (const t of topics) topicIds.add(t.id);
      } catch (e) {
        console.warn(`[DevForumPipeline] Failed to fetch category ${cat.name}:`, e);
      }
    }

    // 3. Fetch topics from search queries
    for (const query of DEFAULT_QUERIES) {
      console.log(`[DevForumPipeline] Searching for: ${query}`);
      try {
        const topics = await this.fetcher.search(query);
        for (const t of topics) topicIds.add(t.id);
      } catch (e) {
        console.warn(`[DevForumPipeline] Failed to search for ${query}:`, e);
      }
    }

    console.log(`[DevForumPipeline] Found ${topicIds.size} unique topics. Processing...`);

    // 4. Process each topic
    for (const id of topicIds) {
      try {
        const detail = await this.fetcher.getTopicDetail(id);

        if (shouldRejectTopic(detail)) {
          rejected++;
          continue;
        }

        const record = processTopic(detail);

        if (record.score < 60) {
          scored++;
          continue;
        }

        const key = `devforum:${record.id}`;
        await this.store.put(key, record);
        added++;
      } catch (e) {
        console.warn(`[DevForumPipeline] Failed to process topic ${id}:`, e);
      }
    }

    // 5. Update sync state
    await this.syncManager.updateSourceState("devforum", {
      lastSyncAt: Date.now(),
      etag: "fixed-version",
    });

    return { added, rejected, scored };
  }
}
