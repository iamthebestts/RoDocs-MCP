import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  type IKeyValueStore,
  storeDelByPrefix,
  storeGetByPrefix,
  storePutMany,
} from "../store/index.js";
import type { EmbedDoc } from "../types/index.js";
import { observe } from "../utils/logger.js";
import { embed } from "./embedder.js";
import { dedupeEmbedDocs } from "./sources.js";

type EmbedMetadata = {
  hash: string;
};

type ChangedDoc = {
  doc: EmbedDoc;
  hash: string;
};

const DEFAULT_CHECKPOINT_CHUNK_SIZE = 128;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function metadataPrefix(source: string): string {
  return `embed:${source}:`;
}

function metadataKey(source: string, id: string): string {
  return `embed:${source}:${id}`;
}

function isEmbedMetadata(value: unknown): value is EmbedMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).hash === "string"
  );
}

export class EmbeddingIndexer {
  constructor(
    private readonly store: IKeyValueStore,
    private readonly db: Database.Database,
    private readonly chunkSize = DEFAULT_CHECKPOINT_CHUNK_SIZE,
  ) {}

  async indexSource(source: string, docs: EmbedDoc[]): Promise<number> {
    const uniqueDocs = dedupeEmbedDocs(docs);
    if (uniqueDocs.length === 0) return 0;

    await this.deleteStaleRows(source, uniqueDocs);

    const existingIds = this.readExistingIds(source);
    const docsToEmbed = await this.filterChangedDocs(source, uniqueDocs, existingIds);
    if (docsToEmbed.length === 0) {
      observe({
        event: "embedding.indexed",
        source,
        metadata: { count: uniqueDocs.length, skipped: uniqueDocs.length },
      });
      return uniqueDocs.length;
    }

    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO vec_items (id, source, embedding) VALUES (?, ?, ?)`,
    );
    const deleteExisting = this.db.prepare("DELETE FROM vec_items WHERE source = ? AND id = ?");

    const insertChunk = this.db.transaction(
      (entries: Array<{ id: string; source: string; vec: Float32Array }>) => {
        for (const entry of entries) {
          deleteExisting.run(entry.source, entry.id);
          upsert.run(entry.id, entry.source, entry.vec);
        }
      },
    );

    const step = Math.max(1, this.chunkSize);
    for (let offset = 0; offset < docsToEmbed.length; offset += step) {
      const chunk = docsToEmbed.slice(offset, offset + step);
      const texts = chunk.map((item) => item.doc.text);
      const vectors = await embed(texts, { mode: "passage" });

      if (vectors.length !== chunk.length) {
        throw new Error(
          `[EmbeddingIndexer] vector count mismatch for ${source}: expected ${chunk.length}, got ${vectors.length}`,
        );
      }

      const entries = chunk.map((item, i) => {
        const vec = vectors[i];
        if (!vec) {
          throw new Error(`[EmbeddingIndexer] missing vector for ${source} doc ${item.doc.id}`);
        }
        return { id: item.doc.id, source: item.doc.source, vec };
      });

      insertChunk(entries);
      await storePutMany(
        this.store,
        chunk.map((item) => ({
          key: metadataKey(source, item.doc.id),
          value: { hash: item.hash },
        })),
      );
    }

    observe({
      event: "embedding.indexed",
      source,
      metadata: { count: uniqueDocs.length, embedded: docsToEmbed.length },
    });
    return uniqueDocs.length;
  }

  async clearSource(source: string): Promise<void> {
    this.db.prepare("DELETE FROM vec_items WHERE source = ?").run(source);
    await storeDelByPrefix(this.store, metadataPrefix(source));
    observe({ event: "embedding.cleared", source });
  }

  private readExistingIds(source: string): Set<string> {
    const rows = this.db
      .prepare<[string], { id: string }>("SELECT id FROM vec_items WHERE source = ?")
      .all(source);
    return new Set(rows.map((row) => row.id));
  }

  private async filterChangedDocs(
    source: string,
    docs: EmbedDoc[],
    existingIds: Set<string>,
  ): Promise<ChangedDoc[]> {
    const storedMeta = await storeGetByPrefix<unknown>(this.store, metadataPrefix(source));
    const hashByKey = new Map<string, string>();
    for (const entry of storedMeta) {
      if (isEmbedMetadata(entry.value)) {
        hashByKey.set(entry.key, entry.value.hash);
      }
    }

    const changed: ChangedDoc[] = [];
    for (const doc of docs) {
      const hash = hashText(doc.text);
      if (!existingIds.has(doc.id)) {
        changed.push({ doc, hash });
        continue;
      }

      if (hashByKey.get(metadataKey(source, doc.id)) !== hash) {
        changed.push({ doc, hash });
      }
    }
    return changed;
  }

  private async deleteStaleRows(source: string, docs: EmbedDoc[]): Promise<void> {
    const desiredIds = new Set(docs.map((doc) => doc.id));
    const existingIds = this.readExistingIds(source);
    const deleteRow = this.db.prepare("DELETE FROM vec_items WHERE source = ? AND id = ?");

    for (const id of existingIds) {
      if (desiredIds.has(id)) continue;
      deleteRow.run(source, id);
      await this.store.del(metadataKey(source, id));
    }
  }
}
