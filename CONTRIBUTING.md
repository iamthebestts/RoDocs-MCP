## Prerequisites

- Node.js >= 20.10.0
- pnpm >= 10.0.0

## Setup

```bash
git clone https://github.com/iamthebestts/RoDocs-MCP.git
cd RoDocs-MCP
pnpm install
pnpm dev
```

## Project Structure

```text
src/
├── cli/
│   └── index.ts           # CLI entry point and terminal formatter
├── server/
│   └── index.ts           # MCP server and tool registration
├── scraper/
│   ├── index.ts           # Public API, orchestration, caching
│   ├── fetch.ts           # API reference scraper (Creator Hub)
│   ├── guides.ts          # Guides fetching and indexing
│   ├── search.ts          # Unified search layer (API + guides)
│   ├── bm25.ts            # BM25 ranking implementation
│   ├── tokenizer.ts       # Tokenization logic
│   ├── aliases.ts         # Query normalization and aliases
│   ├── cache.ts           # TTL-based memory cache
│   └── __tests__/         # Unit tests for search engine
├── types/
│   └── index.ts           # Shared types (API + search + guides)
└── test-search.ts         # Manual testing/debug script

tests/
├── cli.e2e.test.ts        # CLI end-to-end tests
└── server.e2e.test.ts     # MCP server end-to-end tests

docs/
├── cli.md
├── mcp-tools.md
└── scraper.md
```

## Running Locally

- **Development**: `pnpm dev`
- **Build**: `pnpm build`
- **Typecheck**: `pnpm typecheck`
- **Lint**: `pnpm check`
- **Tests**:
  - Unit: `pnpm test`
  - E2E: `pnpm test:e2e`

## CLI Usage

```bash
rodocsmcp --list
rodocsmcp --find datastore
rodocsmcp --search-guide "data store"
rodocsmcp --guide docs/scripting/data-stores.md
rodocsmcp --stdio
```

## MCP Tools

- `get_api_reference`
- `get_many_api_references`
- `list_api_names`
- `find_api_name`
- `search_guides`
- `get_guide`
- `list_guides`

## Adding a New MCP Tool

1. **Define Types**
   Add types in `src/types/index.ts`.

2. **Implement Logic**
   Add logic in `src/scraper/` (or extend `search.ts` if relevant).

3. **Register Tool**
   Register in `src/server/index.ts` with:
   - Zod schema
   - handler function

## Commit Style

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

| Type       | Description                         |
| ---------- | ----------------------------------- |
| `feat`     | New feature                         |
| `fix`      | Bug fix                             |
| `docs`     | Documentation changes               |
| `chore`    | Maintenance                         |
| `refactor` | Code change without behavior change |

## Pull Request Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm check` (Biome) passes
- [ ] No `any` usage
- [ ] Tests pass (`pnpm test` / `pnpm test:e2e`)
- [ ] Behavior verified via CLI or MCP server
