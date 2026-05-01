import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decode, encode } from "@msgpack/msgpack";
import type { BM25, BM25Doc } from "../search/bm25.js";
import type { LmdbStore, SyncStateManager } from "./index.js";

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

  constructor(
    readonly _store: LmdbStore,
    readonly _syncManager: SyncStateManager,
  ) {
    this.basePath = join(_store.getPath().replace(/store\.lmdb$/, ""), "");
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
   * Deletes the persisted index.
   */
  async clear(source: string): Promise<void> {
    try {
      await writeFile(this.getIndexPath(source), "");
    } catch (_error) {
      // Ignore
    }
  }

  /**
   * High-level helper to load from cache or build and save.
   */
  async loadOrBuildIndex(_source: string, bm25: BM25, builder: () => Promise<void>): Promise<void> {
    const loaded = await this.load(bm25, _source);
    if (loaded) return;

    await builder();
    await this.save(bm25, _source);
  }
}
