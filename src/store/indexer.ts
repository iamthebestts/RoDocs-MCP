import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { decode, encode } from "@msgpack/msgpack";
import type { BM25, BM25Doc } from "../search/bm25.js";
import { logger, observe, startTimer } from "../utils/logger.js";
import type { IKeyValueStore } from "./store-interface.js";
import type { SyncStateManager } from "./sync-state.js";

interface SerializedIndex {
  termFreqs: [string, [string, number][]][];
  idfScores: [string, number][];
  docLengths: [string, number][];
  avgDocLength: number;
  docs: readonly BM25Doc[];
}

/**
 * Service for persisting and restoring the BM25 index.
 */
export class Indexer {
  private readonly basePath: string;
  private readonly clearCallbacks = new Map<string, Set<() => void>>();

  constructor(
    readonly _store: IKeyValueStore,
    readonly _syncManager: SyncStateManager,
  ) {
    this.basePath = dirname(_store.getPath());
  }

  /**
   * Registers a callback to be invoked when clear() is called for the given source.
   * Allows in-memory caches to be invalidated alongside the on-disk index.
   * Multiple callbacks per source are supported; the same function is registered once.
   */
  onClear(source: string, callback: () => void): void {
    let callbacks = this.clearCallbacks.get(source);
    if (callbacks === undefined) {
      callbacks = new Set();
      this.clearCallbacks.set(source, callbacks);
    }
    callbacks.add(callback);
  }

  private getIndexPath(source: string): string {
    return join(this.basePath, `${source}.index.msgpack`);
  }

  async save(bm25: BM25, source: string): Promise<void> {
    const path = this.getIndexPath(source);
    const data = bm25.serialize();
    const packed = encode(data);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, packed);
  }

  async load(bm25: BM25, source: string): Promise<boolean> {
    const path = this.getIndexPath(source);
    try {
      const packed = await readFile(path);
      const data = decode(packed) as SerializedIndex;

      if (
        !data.termFreqs ||
        !data.idfScores ||
        !data.docLengths ||
        data.avgDocLength === undefined ||
        !data.docs
      ) {
        return false;
      }

      bm25.restore(data);
      return true;
    } catch (_error) {
      // File not found or corrupted
      return false;
    }
  }

  /**
   * Deletes the persisted index and notifies any registered in-memory invalidation callbacks.
   */
  async clear(source: string): Promise<void> {
    observe({ event: "indexer.clear", source });
    try {
      await rm(this.getIndexPath(source), { force: true });
    } catch (error) {
      // A failed delete leaves a stale index on disk; surface it instead of hiding it.
      logger.warn(
        `[Indexer] failed to delete persisted index for "${source}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    for (const callback of this.clearCallbacks.get(source) ?? []) callback();
  }

  /**
   * High-level helper to load from cache or build and save.
   */
  async loadOrBuildIndex(_source: string, bm25: BM25, builder: () => Promise<void>): Promise<void> {
    const loaded = await this.load(bm25, _source);
    if (loaded) return;

    const elapsed = startTimer();
    await builder();
    await this.save(bm25, _source);
    observe({ event: "indexer.rebuild", source: _source, durationMs: elapsed() });
  }
}
