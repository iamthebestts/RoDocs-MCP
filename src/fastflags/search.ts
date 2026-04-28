import { LmdbStore } from "../store/index.js";
import { FastFlag } from "./parser.js";

export interface FastFlagSearchOptions {
	query?: string;
	kind?: string;
	behavior?: string;
	platform?: string;
	limit?: number;
}

/**
 * Search service for FastFlags stored in LMDB.
 */
export class FastFlagSearch {
	constructor(private readonly store: LmdbStore) {}

	/**
	 * Searches for FastFlags based on the provided filters.
	 */
	async search(options: FastFlagSearchOptions): Promise<FastFlag[]> {
		const keys = await this.store.keys();
		const flagKeys = keys.filter(k => k.startsWith("fastflags:"));
		
		if (flagKeys.length === 0) {
			return [];
		}

		const flags: FastFlag[] = [];
		for (const key of flagKeys) {
			const flag = await this.store.get<FastFlag>(key);
			if (!flag) continue;
			
			// Filter by Kind
			if (options.kind && flag.kind !== options.kind) continue;
			
			// Filter by Behavior
			if (options.behavior && flag.behavior !== options.behavior) continue;
			
			// Filter by Platform
			if (options.platform && !flag.platforms.includes(options.platform)) continue;
			
			// Filter by Query
			if (options.query) {
				const q = options.query.toLowerCase();
				if (!flag.name.toLowerCase().includes(q)) continue;
			}
			
			flags.push(flag);
		}

		// Sorting logic:
		// 1. Exact match first
		// 2. Prefix match second
		// 3. Substring match third
		// 4. Alphabetical fallback
		const query = options.query?.toLowerCase();
		if (query) {
			flags.sort((a, b) => {
				const nameA = a.name.toLowerCase();
				const nameB = b.name.toLowerCase();
				
				if (nameA === query && nameB !== query) return -1;
				if (nameB === query && nameA !== query) return 1;
				
				if (nameA.startsWith(query) && !nameB.startsWith(query)) return -1;
				if (nameB.startsWith(query) && !nameA.startsWith(query)) return 1;
				
				if (nameA.includes(query) && !nameB.includes(query)) return -1;
				if (nameB.includes(query) && !nameA.includes(query)) return 1;
				
				return nameA.localeCompare(nameB);
			});
		} else {
			flags.sort((a, b) => a.name.localeCompare(b.name));
		}

		return flags.slice(0, options.limit ?? 50);
	}
}
