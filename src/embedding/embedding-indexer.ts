import type Database from "better-sqlite3";
import type { EmbedDoc } from "../types/index.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import { embed } from "./embedder.js";
import { observe } from "../utils/logger.js";

export class EmbeddingIndexer {
  constructor(
    private readonly store: IKeyValueStore,
    private readonly db: Database.Database,
  ) {}

  async indexSource(source: string, docs: EmbedDoc[]): Promise<void> {
    if (docs.length === 0) return;

    const texts = docs.map((d) => d.text);
    const vectors = await embed(texts);

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

    const entries = docs.map((doc, i) => ({
      id: doc.id,
      source: doc.source,
      vec: vectors[i] ?? new Float32Array(384),
    }));

    insertMany(entries);
    observe({ event: "embedding.indexed", source, metadata: { count: docs.length } });
  }

  async clearSource(source: string): Promise<void> {
    this.db.prepare("DELETE FROM vec_items WHERE source = ?").run(source);
    observe({ event: "embedding.cleared", source });
  }
}
