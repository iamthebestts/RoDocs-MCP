# CLAUDE.md — RoDocsMCP

## Purpose

MCP server and typed scraper for Roblox Creator Hub API Reference and Guides. Exposes Roblox API docs to AI assistants via the Model Context Protocol. Also ships a CLI and a programmatic API.

---

## Tech stack

| Concern         | Tool / version                  |
|-----------------|---------------------------------|
| Runtime         | Node.js >= 20.10.0              |
| Package manager | pnpm >= 10 (`pnpm-lock.yaml`)   |
| Language        | TypeScript (strict, TS 6 beta)  |
| Build           | tsup (dual ESM + CJS)           |
| Test            | Vitest 4                        |
| Lint / format   | Biome 2                         |
| Persistence     | LMDB (`lmdb` package)           |
| MCP SDK         | `@modelcontextprotocol/sdk`     |

> Claude Code sessions on this machine allow `bun run <script>` and `bunx biome/vitest` as shortcuts — both work because bun can execute package.json scripts. Official commands below use pnpm.

---

## Commands

```bash
pnpm typecheck          # tsc --noEmit (must be clean before commit)
pnpm check              # biome check (lint + format check)
pnpm check:fix          # biome check --write (auto-fix)
pnpm test               # vitest run (unit tests only)
pnpm test:coverage      # vitest run --coverage (80% lines/functions, 75% branches)
pnpm build              # tsup → dist/ (ESM + CJS + DTS)
pnpm dev                # tsx src/cli/index.ts
pnpm ci                 # biome ci + vitest run + tsc --noEmit (full gate)

# E2E (require live network; run separately)
cross-env E2E=true pnpm vitest run tests/server.e2e.test.ts
cross-env E2E=true pnpm vitest run tests/cli.e2e.test.ts
cross-env E2E=true pnpm vitest run tests/
```

---

## Repository layout

```
src/
  cli/          CLI entry point; terminal formatter; setup wizard
  server/       MCP server; all tool registration (Zod schemas + handlers)
  scraper/      Public API (scrapeTopic, scrapeMany, scrapeIndex);
                creator-docs YAML fetcher; guides fetcher; in-memory + disk cache
  search/       BM25 engine; tokenizer; aliases; recency boost; roblox-search
  store/        LmdbStore; Indexer (BM25 disk persistence, msgpack);
                SyncStateManager; WriteQueue
  daemon/       TCP daemon (port 30030); daemon-client/server/protocol; idle shutdown
  scheduler/    JobRunner; IdleDetector; RateLimiter; SeedManager
  fastflags/    FastFlag scraper (MaximumADHD); BM25 search; parser; enricher
  devforum/     DevForum pipeline; fetcher; BM25 search; filters; processor
  types/        Shared types (Roblox API, search, BM25)
  utils/        logger; github-token; semaphore

tests/          E2E tests (require E2E=true env var)
dist/           Build output — not committed
```

**Build entry points:**
- `src/scraper/index.ts` → `dist/index.js` / `dist/index.cjs` (public API)
- `src/cli/index.ts` → `dist/cli.js` (binary: `rodocsmcp` / `rodocs`)

---

## Architecture and invariants

### MCP protocol
- MCP uses **stdout** for JSON-RPC frames. **Never write to stdout** (no `console.log`). Use `logger` from `src/utils/logger.ts` — it writes to `console.error`.
- Log level controlled by `LOG_LEVEL` env var (DEBUG/INFO/WARN/ERROR). Default: INFO.

### Daemon
- TCP server on `localhost:30030` (constant in `src/daemon/daemon-protocol.ts`).
- Daemon tests are flaky with `EADDRINUSE` if port is already in use — **this is a pre-existing issue**, not introduced by code changes. Verify with `netstat -ano | findstr :30030`.

### BM25 singleton pattern
- Module-level singletons (`_bm25`, `_buildPromise`, `_cachedFlags`/`_cachedRecords`) — built once per session, rebuild only on `Indexer.clear()`.
- A **single shared `Indexer` instance** is created in `src/server/index.ts` and passed to all components. This is required for `onClear()` callbacks to propagate from scraper writes to in-memory BM25 caches.
- Every module that exports a singleton **must** export a `_reset*ForTesting()` function and call it in `beforeEach` for test isolation.

### LMDB
- Default cache path: `~/.cache/rodocsmcp/store.lmdb`
- Override via `RODOCS_CACHE_DIR` env var or `LmdbStoreOptions.cacheDir`
- BM25 indexes persisted as msgpack at `<cacheDir>/<source>.index.msgpack`

### DevForum search (two-path)
- **With Indexer**: BM25 pre-filter → existing `relevance()` term-count ranking (sort order preserved).
- **Without Indexer** (fallback / existing tests): full LMDB scan, original behavior unchanged.

### Coverage scope
Vitest coverage only tracks `src/search/`, `src/scraper/`, `src/devforum/`, `src/fastflags/`. Thresholds: 80% lines/functions, 75% branches.

---

## Coding standards

### TypeScript
- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`
- `moduleResolution: "bundler"` — imports use `.js` extensions even for `.ts` source files
- `ignoreDeprecations: "6.0"` — project is on TypeScript 6 beta

### Biome rules (enforced as errors)
- `noExplicitAny` — no `any`, use unknown + type guards
- `useImportType` — type-only imports must use `import type`
- `noUnusedVariables` / `noUnusedImports`
- `useNodejsImportProtocol` — `import ... from "node:fs"`, not `"fs"`
- Line width: 100. Indent: 2 spaces. Quotes: double. Trailing commas: all.

### No `console.log` or `console.debug`
Use `logger.info/warn/error/debug` from `src/utils/logger.ts`.

### Adding a new MCP tool
1. Add types to `src/types/index.ts` if shared.
2. Implement logic in the appropriate domain module (`src/scraper/`, `src/search/`, etc.).
3. Register in `src/server/index.ts` with a Zod schema and handler.

---

## Testing

- Unit tests: `src/**/__tests__/**/*.test.ts` — colocated with source
- E2E tests: `tests/*.e2e.test.ts` — require `E2E=true`, make real network calls
- Test timeout: 10 000 ms

### BM25 singleton isolation
Every test file that touches `FastFlagSearch`, `DevForumSearch`, or any BM25-indexed module must call the relevant `_reset*ForTesting()` in `beforeEach`:
```ts
import { _resetFastFlagsIndexForTesting } from "../search.js";
beforeEach(() => { _resetFastFlagsIndexForTesting(); });
```
Skipping this causes stale cache bleed between test cases.

---

## Known issues / gotchas

- **Daemon port 30030**: `EADDRINUSE` in `src/daemon/__tests__/client.test.ts` is pre-existing (port conflict at OS level, not a code bug).
- **stdout is sacred**: any stray `console.log` breaks MCP JSON-RPC framing. Biome does not catch this — review manually.
- **`exactOptionalPropertyTypes`**: `{ field?: string }` and `{ field: string | undefined }` are distinct. Do not conflate them.
- **`noUncheckedIndexedAccess`**: array access `arr[i]` returns `T | undefined`. Always guard or use `.at()`.
- **graphify temp files**: `.graphify_python` and `.graphify_detect.json` are generated by the graphify skill and should not be committed (covered by `.gitignore`).
- **E2E tests hit GitHub API**: they consume rate limit. Pass `GITHUB_TOKEN` or `--github-token` to avoid 403s.

---

## Commit and release

- **Style**: [Conventional Commits](https://www.conventionalcommits.org/) — `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`
- **Changelog**: generated by `git-cliff` from `cliff.toml`
- **Release**: CD triggers on `v*.*.*` tags. Tag version must exactly match `package.json#version` or the pipeline fails.
- **PR checklist**: `pnpm typecheck` + `pnpm check` + `pnpm test` all green; no `any`; behavior verified.
