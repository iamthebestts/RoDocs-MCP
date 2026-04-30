import axios, { AxiosError } from "axios";
import type { LmdbStore, SyncStateManager } from "../store/index.js";
import { enrichFastFlag } from "./enricher.js";
import { normalizeFastFlag, type RawFastFlag } from "./parser.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

/**
 * Scraper for Roblox FastFlags from MaximumADHD sources.
 */
export class FastFlagScraper {
  constructor(
    private readonly store: LmdbStore,
    private readonly syncManager: SyncStateManager,
  ) {}

  /**
   * Fetches and persists FastFlags.
   */
  async seed(url: string, githubToken?: string): Promise<{ added: number; updated: number }> {
    console.log(`[FastFlagScraper] Fetching flags from ${url}...`);

    const data = await this.fetchWithRetry(url, githubToken);
    const rawFlags = this.ensureArray(data);

    let added = 0;
    let updated = 0;

    for (const raw of rawFlags) {
      const normalized = normalizeFastFlag(raw);
      const enriched = enrichFastFlag(normalized);

      const key = `fastflags:${enriched.name}`;
      const existing = await this.store.get(key);

      if (!existing) {
        added++;
      } else {
        updated++;
      }

      await this.store.put(key, enriched);
    }

    // Update sync state
    await this.syncManager.updateSourceState("fastflags", {
      lastSyncAt: Date.now(),
      // We use a dummy ETag if the source doesn't provide one
      etag: "fixed-version",
    });

    return { added, updated };
  }

  private async fetchWithRetry(url: string, token?: string, attempt = 0): Promise<unknown> {
    try {
      const response = await axios.get(url, {
        headers: token ? { Authorization: `token ${token}` } : {},
        timeout: 10000,
      });
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        if (
          (status === 502 || status === 503 || status === 504 || status === 429) &&
          attempt < MAX_RETRIES
        ) {
          const delay = INITIAL_BACKOFF * 2 ** attempt;
          console.warn(`[FastFlagScraper] Request failed (${status}). Retrying in ${delay}ms...`);
          await new Promise((res) => setTimeout(res, delay));
          return this.fetchWithRetry(url, token, attempt + 1);
        }
      }
      throw error;
    }
  }

  private ensureArray(data: unknown): RawFastFlag[] {
    if (Array.isArray(data)) {
      return data as RawFastFlag[];
    }
    if (typeof data === "object" && data !== null) {
      // If it's a map of name: value, convert to array
      return Object.entries(data).map(([name, value]) => ({
        name,
        value: value as string | number | boolean,
      }));
    }
    throw new Error("Invalid FastFlag source format: expected array or object");
  }
}
