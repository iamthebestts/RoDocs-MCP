import type Database from "better-sqlite3";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { EmbedDoc } from "../types/index.js";
import { observe } from "../utils/logger.js";
import { embed } from "./embedder.js";
import { dedupeEmbedDocs } from "./sources.js";

export class EmbeddingIndexer {
  constructor(
    _store: IKeyValueStore,
    private readonly db: Database.Database,
  ) {}

  async indexSource(source: string, docs: EmbedDoc[]): Promise<number> {
    const uniqueDocs = dedupeEmbedDocs(docs);
    if (uniqueDocs.length === 0) return 0;

    await this.clearSource(source);

    const texts = uniqueDocs.map((d) => d.text);
    const vectors = await embed(texts);

    if (vectors.length !== uniqueDocs.length) {
      throw new Error(
        `[EmbeddingIndexer] vector count mismatch for ${source}: expected ${uniqueDocs.length}, got ${vectors.length}`,
      );
    }

    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO vec_items (id, source, embedding) VALUES (?, ?, ?)`,
    );

    const insertMany = this.db.transaction(
      (entries: Array<{ id: string; source: string; vec: Float32Array }>) => {
        for (const entry of entries) {
          upsert.run(entry.id, entry.source, entry.vec);
        }
      },
    );

    const entries = uniqueDocs.map((doc, i) => {
      const vec = vectors[i];
      if (!vec) {
        throw new Error(`[EmbeddingIndexer] missing vector for ${source} doc ${doc.id}`);
      }
      return { id: doc.id, source: doc.source, vec };
    });

    insertMany(entries);
    observe({ event: "embedding.indexed", source, metadata: { count: uniqueDocs.length } });
    return uniqueDocs.length;
  }

  async clearSource(source: string): Promise<void> {
    this.db.prepare("DELETE FROM vec_items WHERE source = ?").run(source);
    observe({ event: "embedding.cleared", source });
  }
}
