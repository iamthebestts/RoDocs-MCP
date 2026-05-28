# Graph Report - RoDocsMCP  (2026-05-27)

## Corpus Check
- 113 files · ~61,966 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1248 nodes · 2102 edges · 68 communities (63 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `af1253d0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]

## God Nodes (most connected - your core abstractions)
1. `observe()` - 25 edges
2. `startTimer()` - 22 edges
3. `C` - 21 edges
4. `SeedManager` - 20 edges
5. `Indexer` - 20 edges
6. `dim()` - 17 edges
7. `main()` - 17 edges
8. `BM25` - 16 edges
9. `LmdbStore` - 16 edges
10. `MCP Tools Reference` - 16 edges

## Surprising Connections (you probably didn't know these)
- `runDaemonMode()` --calls--> `startDaemonServer()`  [INFERRED]
  src/cli/index.ts → src/daemon/daemon-server.ts
- `runClientMode()` --calls--> `runDaemonClient()`  [INFERRED]
  src/cli/index.ts → src/daemon/daemon-client.ts
- `searchDevForumStore()` --calls--> `elapsed`  [INFERRED]
  src/devforum/search.ts → src/utils/__tests__/logger.test.ts
- `scrapeTopic()` --calls--> `elapsed`  [INFERRED]
  src/scraper/index.ts → src/utils/__tests__/logger.test.ts
- `initMissingPersistedIndexer()` --calls--> `initIndexer()`  [EXTRACTED]
  src/search/__tests__/index.test.ts → src/search/index.ts

## Communities (68 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (44): getCachedDevForumRecords(), DevForumRecord, enrichFastFlag(), FastFlag, FastFlagBehavior, FastFlagKind, normalizeFastFlag(), RawFastFlag (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (54): fetchGuideIndex(), guideCache, GuideMetadata, GuideResult, http, hydrateFrontmatter(), parseFrontmatter(), searchGuides() (+46 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (44): BM25, BM25Options, FIELD_KEYS, FIELD_WEIGHTS, FieldKey, hasDoubleFinalConsonant(), normalizeStem(), stemWord() (+36 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (32): calculatePercent(), DEFAULT_ESTIMATED_TOTALS, DEFAULT_PRIORITY, DEFAULT_SEED_BATCH_SIZES, isProgress(), progressKey(), SEED_SOURCES, SeedBatchContext (+24 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (42): code:typescript (// src/store/store-interface.ts), code:typescript (import type { IKeyValueStore } from "./store-interface.js";), code:bash (pnpm test src/store/__tests__/indexer.test.ts), code:bash (pnpm test), code:bash (git add src/store/indexer.ts src/store/__tests__/indexer.tes), code:typescript (import type { IKeyValueStore } from "./store-interface.js";), code:bash (pnpm typecheck && pnpm test), code:bash (git add src/store/sync-state.ts) (+34 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (17): CircularBuffer, LatencyStats, MetricsCollector, MetricsSnapshot, _resetMetricsForTesting(), formatLatency(), formatMetricsReport(), formatUptime() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.21
Nodes (36): bold(), boxBottom(), boxRow(), boxTop(), C, dim(), formatCodeSample(), formatEntry() (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (35): Changes, code:typescript (export interface IKeyValueStore {), code:sql (SELECT id, distance FROM vec_items), code:typescript (hybrid?: boolean  // default: false during rollout), code:block12 (Phase 1 (Interface)  →  Phase 2 (SQLite KV)  →  Phase 3 (Emb), code:typescript (export class SqliteStore implements IKeyValueStore {), code:typescript (export function createStore(options?: StoreOptions): Promise), code:typescript (import { load } from "sqlite-vec";) (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (12): IdleDetector, Scheduler, Job, JobRunner, RateLimiter, detector, job, runner (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (31): code:block1 ("What's the API for X?"), code:json ({), code:json ({), code:json ({), code:json ({), code:json ({), code:json ([), code:json ({) (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (10): DEFAULT_CACHE_DIR, DEFAULT_STORE_PATH, LmdbStore, LmdbStoreOptions, SyncStateManager, value, keySet, metadata (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (29): code:bash (pnpm add better-sqlite3), code:typescript (/**), code:bash (pnpm test), code:bash (pnpm typecheck), code:bash (git add src/store/index.ts), code:bash (pnpm ci), code:bash (cross-env E2E=true pnpm vitest run tests/), code:bash (pnpm remove lmdb) (+21 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (28): API Name Search, CLI Reference, code:bash (rodocsmcp), code:text (GUIDES (5 results)), code:bash (rodocsmcp --guide scripting/data/data-stores.md), code:text (GUIDE: scripting/data/data-stores.md), code:bash (rodocsmcp --github-token "$GITHUB_TOKEN" Actor), code:bash (GITHUB_TOKEN=your_pat rodocsmcp --search-guide "data store") (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (28): code:typescript (// src/search/__tests__/hybrid.test.ts), code:bash (pnpm typecheck), code:bash (git add src/search/hybrid.ts src/search/__tests__/hybrid.tes), code:typescript (it("uses BM25 when hybrid is not set (default behavior uncha), code:bash (pnpm test src/search/__tests__/roblox-search.test.ts), code:typescript (import { hybridSearch } from "./hybrid.js";), code:bash (pnpm test), code:bash (pnpm typecheck) (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (26): Adding a new MCP tool, Architecture and invariants, Biome rules (enforced as errors), BM25 singleton isolation, BM25 singleton pattern, CLAUDE.md — RoDocsMCP, code:bash (pnpm typecheck          # tsc --noEmit (must be clean before), code:block2 (src/) (+18 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (26): Authentication, Build, Build from Source, CLI, code:bash (npx rodocsmcp --setup claude), code:bash (pnpm typecheck), code:json ({), code:json ({) (+18 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (13): asStore(), entries, event, fakeIndexer, flags, keysSpy, longCode, MemoryStore (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (19): ApiKind, CATEGORIES, Category, categoryMap, enrichInheritedMembers(), fetchYaml(), http, InheritedGroup (+11 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (16): RichMember, collectCodeSamples(), displayNameFromIdentifier(), firstLine(), flattenSecurity(), mapCodeSample(), mapMember(), parseYamlToDocEntry() (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.19
Nodes (19): backupFile(), ensureDir(), McpServerConfig, mergeJsonConfig(), Provider, ProviderPathOptions, PROVIDERS, ProviderSetupResult (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (18): call(), callTool(), caps, entries, entry, failed, hasDataStore, hasDatastoreMethod (+10 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (7): buildDevForumIndex(), FastFlagSearch, CacheEntry, MemoryCache, elapsed, observe(), startTimer()

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (14): cache, hit, builder(), event, freshBm25, newBm25, order, results (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.16
Nodes (13): DaemonControlMessage, DaemonFrame, FrameDecodeError, FrameDecoder, isJsonRpcMessage(), isObject(), isPing(), isPong() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (12): initDevForumSearch(), CodeSample, AIEntry, AIMember, createServer(), CreateServerOptions, KIND_LABELS, MEMBER_KEYS (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (13): FakeFastFlagSearch, FakeIndexer, FakeLmdbStore, FakeSeedManager, loadServer(), MockServer, originalArgv, payload (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (6): IdleShutdown, IdleShutdownOptions, IdleState, idle, onShutdown, token

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (15): applyFilters(), _bm25, _cachedRecords, clampLimit(), DevForumSearchOptions, DevForumSearchResponse, DevForumSearchResult, ensureDevForumIndex() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.15
Nodes (12): CATEGORY_WEIGHT_TO_NUM, CategoryWeight, CONFIG, delay(), DiscoveryCandidate, DiscoveryTier, IntRange, isTransientError() (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.26
Nodes (14): fetchIndex(), fetchTopic(), findClosestMatch(), diskCache, getIndexSnapshot(), IndexResult, memCache, normalizeIndexResult() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.13
Nodes (12): activeSockets, error, fallback, options, output, { port }, socket, spawnDaemon (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.21
Nodes (13): autoStartDaemon(), connectToDaemon(), DaemonClientOptions, isNodeError(), line, newline, onceConnect(), parsed (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.2
Nodes (10): encodeFrame(), closeTcpServer(), DaemonServerOptions, listen(), RunningDaemonServer, serializeStoreWrites(), SocketTransport, startDaemonServer() (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (11): DiscoursePost, DiscourseTopic, DiscourseTopicDetail, TOP_PATHS, TopPeriod, devForumClient, httpAgent, httpsAgent (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (11): acquireDaemonLock(), DaemonLock, isNodeError(), isProcessAlive(), readLockPid(), removeStaleLock(), resolveDaemonCacheDir(), resolveDaemonLockPath() (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (11): DevForumPost, DevForumScoreInput, DevForumScoreInputSchema, baseInput, freshScore, oldScore, perfect, poor (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.19
Nodes (11): CACHE_DIR, DiskCache, DiskEntry, makeCacheKey(), getEngineVersionHash(), cache, cacheDir(), cachePath() (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (13): code:ts (export async function scrapeTopic(topic: string): Promise<Sc), code:ts (const result = await scrapeTopic('Vector3');), code:ts (export async function scrapeMany(topics: string[]): Promise<), code:ts (const results = await scrapeMany(['Actor', 'InvalidTopic']);), code:ts (export async function scrapeIndex(): Promise<IndexResult>), code:ts (const index = await scrapeIndex();), code:ts (export async function findClosestApiName(query: string): Pro), code:ts (const match = await findClosestApiName('tweenserv');) (+5 more)

### Community 38 - "Community 38"
Cohesion: 0.15
Nodes (7): DaemonServerContext, ServerInstance, decoder, FakeStore, order, request, store

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (12): Adding a New MCP Tool, CLI Usage, code:bash (git clone https://github.com/iamthebestts/RoDocs-MCP.git), code:text (src/), code:bash (rodocsmcp --list), Commit Style, MCP Tools, Prerequisites (+4 more)

### Community 40 - "Community 40"
Cohesion: 0.18
Nodes (9): extractFirstGuidePath(), out, path, runCache, RunResult, searchResult, { status, stderr }, { status, stdout } (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.24
Nodes (9): isTechnicalCategory(), REJECTED_CATEGORIES, REJECTED_TITLE_PATTERNS, shouldRejectTopic(), DevForumTopic, baseTopic, oldDate, topic (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (10): [1.0.0] - 2026-04-20, [2.0.0] - 2026-04-25, Added, Added, Changed, Changelog, Documentation, Planned (+2 more)

### Community 44 - "Community 44"
Cohesion: 0.2
Nodes (6): CLI, cliState, loadCli(), result, stderrSpy, stdoutSpy

### Community 45 - "Community 45"
Cohesion: 0.2
Nodes (9): contains, entry, exact, fallback, fallbacks, loadScraper(), lower, mockState (+1 more)

### Community 46 - "Community 46"
Cohesion: 0.31
Nodes (8): cleanContent(), NOISE_SELECTORS, processTopic(), safeAgeDays(), truncateWords(), calculateScore(), mockTopic, record

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (6): _bm25, _cachedFlags, FastFlagSearchOptions, _invalidate(), _resetFastFlagsIndexForTesting(), SerializedIndex

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (7): code:typescript (it("calls buildEmbeddings after rebuildIndex when source com), code:bash (pnpm test src/scheduler/__tests__/seed-manager.test.ts), code:typescript (export interface SeedSourceRunner {), code:typescript (if (updated.status === "complete") {), code:bash (pnpm test src/scheduler/__tests__/seed-manager.test.ts), code:bash (git add src/scheduler/seed-manager.ts src/scheduler/__tests_), Task 8: Add `buildEmbeddings` to `SeedSourceRunner` and wire in `SeedManager`

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (6): code:typescript (it("creates vec_items virtual table on open()", async () => ), code:bash (pnpm test src/store/__tests__/sqlite-store.test.ts), code:typescript (import Database from "better-sqlite3";), code:bash (pnpm test src/store/__tests__/sqlite-store.test.ts), code:bash (git add src/store/sqlite-store.ts src/store/__tests__/sqlite), Task 5: Load `sqlite-vec` in `SqliteStore` and create `vec_items` table

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (6): code:typescript (// src/embedding/__tests__/embedder.test.ts), code:bash (pnpm test src/embedding/__tests__/embedder.test.ts), code:typescript (// src/embedding/embedder.ts), code:bash (pnpm test src/embedding/__tests__/embedder.test.ts), code:bash (git add src/embedding/embedder.ts src/embedding/__tests__/em), Task 4: Implement `embedder.ts` with tests (TDD)

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (6): code:typescript (// src/embedding/__tests__/embedding-indexer.test.ts), code:bash (pnpm test src/embedding/__tests__/embedding-indexer.test.ts), code:typescript (// src/embedding/embedding-indexer.ts), code:bash (pnpm test src/embedding/__tests__/embedding-indexer.test.ts), code:bash (git add src/embedding/embedding-indexer.ts src/embedding/__t), Task 6: Implement `EmbeddingIndexer` with tests (TDD)

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (6): code:typescript (import { EmbeddingIndexer } from "../embedding/embedding-ind), code:typescript ({), code:bash (pnpm typecheck), code:bash (pnpm test), code:bash (git add src/server/index.ts), Task 9: Wire `EmbeddingIndexer` into `createServer()`

### Community 57 - "Community 57"
Cohesion: 0.4
Nodes (4): code:bash (node -e "const {pipeline} = require('@xenova/transformers');), File Map, Phase 3: Embedding Pipeline — Implementation Plan, Prerequisites

### Community 58 - "Community 58"
Cohesion: 0.5
Nodes (4): code:bash (pnpm add @xenova/transformers sqlite-vec), code:bash (node -e "const Database = require('better-sqlite3'); const {), code:bash (git add package.json pnpm-lock.yaml), Task 1: Install dependencies

### Community 59 - "Community 59"
Cohesion: 0.5
Nodes (4): code:bash (git add src/embedding/model.ts), code:typescript (// src/embedding/model.ts), code:bash (pnpm typecheck), Task 3: Implement `model.ts` (singleton loader)

### Community 60 - "Community 60"
Cohesion: 0.5
Nodes (4): code:typescript (include: [), code:bash (pnpm test:coverage), code:bash (git add vitest.config.ts), Task 10: Add `src/embedding/` to coverage scope

### Community 61 - "Community 61"
Cohesion: 0.5
Nodes (4): code:bash (pnpm ci), code:bash (grep -rn "console\.log\|console\.debug" src/embedding/ --inc), code:bash (git add -p), Task 11: Final validation

### Community 62 - "Community 62"
Cohesion: 0.5
Nodes (4): code:typescript (/**), code:bash (pnpm typecheck), code:bash (git add src/types/index.ts), Task 2: Add `EmbedDoc` type

### Community 63 - "Community 63"
Cohesion: 0.5
Nodes (4): code:typescript (/**), code:bash (pnpm typecheck && pnpm test), code:bash (git add src/store/sqlite-store.ts), Task 7: Expose `db` from `SqliteStore` for `EmbeddingIndexer`

## Knowledge Gaps
- **513 isolated node(s):** `CLI`, `cliState`, `result`, `stdoutSpy`, `stderrSpy` (+508 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SeedManager` connect `Community 3` to `Community 24`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `DevForumFetcher` connect `Community 42` to `Community 33`, `Community 28`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `LmdbStore` connect `Community 10` to `Community 0`, `Community 34`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `CLI`, `cliState`, `result` to the rest of the system?**
  _513 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._