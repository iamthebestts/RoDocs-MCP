import { encode, decode } from "@msgpack/msgpack";
import { LmdbStore } from "./lmdb-store.js";
import { SyncStateManager } from "./sync-state.js";
import { BM25 } from "../scraper/bm25.js";

export interface IndexerOptions {
	/**
	 * Key prefix for the index in LMDB
	 */
	indexPrefix?: string;
}

/**
 * Handles persistence and loading of the BM25 index.
 */
export class Indexer {
	private readonly indexPrefix: string;

	constructor(
		private readonly store: LmdbStore,
		private readonly syncManager: SyncStateManager,
		options: IndexerOptions = {}
	) {
		this.indexPrefix = options.indexPrefix ?? "idx:bm25:";
	}

	/**
	 * Generates a version key for the index based on the source state.
	 */
	private async getVersionKey(sourceKey: string): Promise<string> {
		const state = await this.syncManager.getSourceState(sourceKey);
		
		// Priority: commitSha > etag > fallback
		const version = state?.commitSha || state?.etag || "v1";
		return `${this.indexPrefix}${sourceKey}:${version}`;
	}

	/**
	 * Saves the serialized BM25 index to the store.
	 */
	async saveIndex(sourceKey: string, bm25: BM25): Promise<void> {
		const key = await this.getVersionKey(sourceKey);
		const data = bm25.serialize();
		const packed = encode(data);
		
		await this.store.put(key, packed);
	}

	/**
	 * Loads a persisted index if it exists and is valid.
	 */
	async loadIndex(sourceKey: string, bm25: BM25): Promise<{ restored: boolean; error?: string }> {
		try {
			const key = await this.getVersionKey(sourceKey);
			const packed = await this.store.get<Uint8Array>(key);
			
			if (!packed) {
				return { restored: false };
			}

			const data = decode(packed);
			bm25.restore(data);
			
			return { restored: true };
		} catch (error) {
			return { 
				restored: false, 
				error: `Failed to restore index: ${error instanceof Error ? error.message : String(error)}` 
			};
		}
	}

	/**
	 * High-level method to either restore the index or build it.
	 */
	async loadOrBuildIndex(
		sourceKey: string, 
		bm25: BM25, 
		buildFn: () => Promise<void>
	): Promise<void> {
		const { restored, error } = await this.loadIndex(sourceKey, bm25);
		
		if (error) {
			console.warn(`[Indexer] ${error}. Rebuilding index...`);
		}

		if (!restored) {
			await buildFn();
			await this.saveIndex(sourceKey, bm25);
		}
	}
}
