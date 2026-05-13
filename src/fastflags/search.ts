import type { BM25Doc } from "../search/bm25.js";
import { BM25 } from "../search/bm25.js";
import type { LmdbStore } from "../store/index.js";
import type { Indexer } from "../store/indexer.js";
import type { FastFlag } from "./parser.js";

export interface FastFlagSearchOptions {
  query?: string | undefined;
  kind?: string | undefined;
  behavior?: string | undefined;
  platform?: string | undefined;
  limit?: number | undefined;
}

// Module-level singleton: built once per session, invalidated on write.
const _bm25 = new BM25();
let _buildPromise: Promise<void> | null = null;
let _cachedFlags: readonly FastFlag[] = [];

function _invalidate(): void {
  _buildPromise = null;
  _bm25.reset();
  _cachedFlags = [];
}

export function _resetFastFlagsIndexForTesting(): void {
  _invalidate();
}

/**
 * Search service for FastFlags stored in LMDB.
 * Builds a BM25 index once per session; invalidated automatically when new flags are written.
 */
export class FastFlagSearch {
  constructor(
    private readonly store: LmdbStore,
    indexer?: Indexer,
  ) {
    if (indexer) {
      indexer.onClear("fastflags", _invalidate);
    }
  }

  private async ensureIndex(): Promise<void> {
    if (_buildPromise !== null) return _buildPromise;

    _buildPromise = this.buildIndex().catch((err: unknown) => {
      _buildPromise = null;
      throw err;
    });

    return _buildPromise;
  }

  private async buildIndex(): Promise<void> {
    const keys = (await this.store.keys()).filter((k) => k.startsWith("fastflags:"));
    const flags: FastFlag[] = [];
    const docs: BM25Doc[] = [];

    for (const key of keys) {
      const flag = await this.store.get<FastFlag>(key);
      if (!flag) continue;
      flags.push(flag);
      docs.push({
        id: flag.name,
        fields: {
          title: flag.name,
          path: `${flag.kind}/${flag.behavior}`,
          description: flag.platforms.join(" "),
        },
      });
    }

    _cachedFlags = flags;
    _bm25.index(docs);
  }

  /**
   * Searches for FastFlags based on the provided filters.
   */
  async search(options: FastFlagSearchOptions): Promise<FastFlag[]> {
    await this.ensureIndex();

    if (_cachedFlags.length === 0) return [];

    let flags = [..._cachedFlags];

    if (options.kind) flags = flags.filter((f) => f.kind === options.kind);
    if (options.behavior) flags = flags.filter((f) => f.behavior === options.behavior);
    if (options.platform) {
      const platform = options.platform;
      flags = flags.filter((f) => f.platforms.includes(platform));
    }

    if (options.query) {
      const bm25Results = _bm25.search(options.query, flags.length);
      if (bm25Results.length === 0) return [];

      const scoreMap = new Map(bm25Results.map((r) => [r.id, r.score]));
      flags = flags.filter((f) => scoreMap.has(f.name));

      const query = options.query.toLowerCase();
      flags.sort((a, b) => {
        const aExact = a.name.toLowerCase() === query ? 1 : 0;
        const bExact = b.name.toLowerCase() === query ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return (scoreMap.get(b.name) ?? 0) - (scoreMap.get(a.name) ?? 0);
      });
    } else {
      flags.sort((a, b) => a.name.localeCompare(b.name));
    }

    return flags.slice(0, options.limit ?? 50);
  }
}
