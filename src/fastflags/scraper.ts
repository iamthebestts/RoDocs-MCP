import axios from "axios";
import {
  type IKeyValueStore,
  type KeyValueEntry,
  type SyncStateManager,
  storeGetByPrefix,
  storePutMany,
} from "../store/index.js";
import type { Indexer } from "../store/indexer.js";
import { createKeepAliveAgents } from "../utils/axios-agents.js";
import { buildGithubHeaders } from "../utils/github-token.js";
import { logger } from "../utils/logger.js";
import { enrichFastFlag } from "./enricher.js";
import { type FastFlag, normalizeFastFlag, type RawFastFlag } from "./parser.js";

type GitHubContentItem = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  sha?: string;
  size?: number;
};

const githubAgents = createKeepAliveAgents(8);
const githubRequestConfig = {
  httpAgent: githubAgents.httpAgent,
  httpsAgent: githubAgents.httpsAgent,
  timeout: 30_000,
} as const;

/**
 * Scraper for Roblox FastFlags from MaximumADHD sources.
 */
export class FastFlagScraper {
  constructor(
    private readonly store: IKeyValueStore,
    private readonly syncManager: SyncStateManager,
    private readonly indexer: Indexer,
  ) {}

  /**
   * Fetches and persists FastFlags.
   */
  async seed(githubToken?: string): Promise<{ added: number; updated: number }> {
    const baseUrl = "https://api.github.com/repos/MaximumADHD/Roblox-FFlag-Tracker/contents/";
    logger.debug(`Fetching flags from ${baseUrl}...`);

    const headers = buildGithubHeaders({}, githubToken);
    const response = await axios.get<GitHubContentItem[]>(baseUrl, {
      headers,
      ...githubRequestConfig,
    });
    const items = response.data;

    let added = 0;
    let updated = 0;
    let modified = false;

    const existingEntries = await storeGetByPrefix<FastFlag>(this.store, "fastflags:");
    const flagMap = new Map<string, FastFlag>(existingEntries.map((e) => [e.key, e.value]));

    for (const item of items) {
      if (item.type !== "file" || !item.name.endsWith(".json") || !item.download_url) {
        continue;
      }

      const syncState = await this.syncManager.getSourceState(`fastflags:${item.name}`);
      if (syncState?.etag === item.sha) {
        logger.debug(`Skipping ${item.name} (no changes)`);
        continue;
      }

      logger.debug(`Downloading ${item.name}...`);
      const fileResponse = await axios.get(item.download_url, githubRequestConfig);
      const rawFlags = this.ensureArray(fileResponse.data);

      const platforms = this.inferPlatforms(item.name);
      const targetName = item.name.replace(".json", "");
      const dirtyEntries = new Map<string, FastFlag>();

      for (const raw of rawFlags) {
        const normalized = normalizeFastFlag(raw);
        const enriched = enrichFastFlag({
          ...normalized,
          platforms,
          targets: [targetName],
          sources: [{ target: targetName, url: item.download_url, sha: item.sha ?? "" }],
        });

        const key = `fastflags:${enriched.name}`;
        const existing = flagMap.get(key);

        if (!existing) {
          added++;
          flagMap.set(key, enriched);
          dirtyEntries.set(key, enriched);
          modified = true;
        } else {
          const merged = this.mergeFlags(existing, enriched);
          if (JSON.stringify(merged) !== JSON.stringify(existing)) {
            flagMap.set(key, merged);
            dirtyEntries.set(key, merged);
            updated++;
            modified = true;
          }
        }
      }

      if (dirtyEntries.size > 0) {
        const batch: KeyValueEntry<FastFlag>[] = [];
        for (const [key, value] of dirtyEntries) {
          batch.push({ key, value });
        }
        await storePutMany(this.store, batch);
      }

      await this.syncManager.updateSourceState(`fastflags:${item.name}`, {
        lastSyncAt: Date.now(),
        etag: item.sha ?? "unknown",
      });
    }

    if (modified) {
      await this.indexer.clear("fastflags");
      logger.debug("BM25 index invalidated.");
    }

    return { added, updated };
  }

  private mergeFlags(existing: FastFlag, incoming: FastFlag): FastFlag {
    const platforms = [...new Set([...existing.platforms, ...incoming.platforms])];
    const targets = [...new Set([...existing.targets, ...incoming.targets])];

    // Deduplicate sources by target so repeated syncs update the entry in place
    // instead of growing the sources array unboundedly.
    const sourcesByTarget = new Map(existing.sources.map((s) => [s.target, s]));
    for (const src of incoming.sources) {
      sourcesByTarget.set(src.target, src);
    }
    const sources = Array.from(sourcesByTarget.values());

    let value = existing.value;
    let valuesByTarget = existing.valuesByTarget;

    if (incoming.value !== undefined) {
      if (value === undefined) {
        value = incoming.value;
      } else if (value !== incoming.value) {
        // Divergence
        const targetName = incoming.targets[0] || "unknown";
        const newValuesByTarget = { ...valuesByTarget };

        for (const t of existing.targets) {
          if (value !== undefined) {
            newValuesByTarget[t] = value;
          }
        }
        newValuesByTarget[targetName] = incoming.value;

        valuesByTarget = newValuesByTarget;
        value = undefined;
      }
    }

    return {
      ...existing,
      platforms,
      targets,
      sources,
      value,
      valuesByTarget,
    };
  }

  private inferPlatforms(name: string): string[] {
    const platforms = new Set<string>();
    const lowerName = name.toLowerCase();

    const rules: [RegExp, string[]][] = [
      [/ios/i, ["ios", "mobile"]],
      [/android/i, ["android", "mobile"]],
      [/mac/i, ["mac"]],
      [/pc|windows/i, ["windows"]],
      [/xbox/i, ["xbox", "console"]],
      [/playstation/i, ["playstation", "console"]],
      [/uwp/i, ["uwp"]],
      [/studio/i, ["studio"]],
      [/client/i, ["client"]],
      [/desktop/i, ["desktop"]],
      [/bootstrapper/i, ["bootstrapper"]],
      [/app/i, ["app"]],
    ];

    for (const [regex, tags] of rules) {
      if (regex.test(lowerName)) {
        for (const tag of tags) platforms.add(tag);
      }
    }

    return platforms.size > 0 ? Array.from(platforms) : ["unknown"];
  }

  private ensureArray(data: unknown): RawFastFlag[] {
    if (Array.isArray(data)) {
      return data as RawFastFlag[];
    }
    if (typeof data === "object" && data !== null) {
      return Object.entries(data).map(([name, value]) => ({
        name,
        value: value as string | number | boolean,
      }));
    }
    throw new Error("Invalid FastFlag source format: expected array or object");
  }
}
