## Prerequisites
- Node.js >= 20.0.0
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
│   └── index.ts      # CLI entry point and terminal UI formatter
├── server/
│   └── index.ts      # MCP server registration and AI-optimized projections
├── scraper/
│   ├── index.ts      # Public API with caching and index management
│   ├── fetch.ts      # HTTP client and HTML scraper for Creator Hub
│   └── cache.ts      # TTL-based memory cache implementation
└── types/
    └── index.ts      # Shared type definitions for Roblox API entries
```

## Running Locally
- **Development**: `pnpm dev`
- **Build**: `pnpm build`
- **Typecheck**: `pnpm typecheck`

## Adding a New MCP Tool
1. **Define Types**: Add necessary interfaces to `src/types/index.ts` or `src/scraper/fetch.ts`.
2. **Implement Logic**: Create the scraping or processing logic in `src/scraper/index.ts`.
3. **Register Tool**: Add a `server.registerTool` call in `src/server/index.ts` with a Zod input schema and handler.

## Commit Style
This project follows [Conventional Commits](https://www.conventionalcommits.org/).

| Type | Description |
| :--- | :--- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `chore` | Maintenance tasks |
| `refactor` | Code change that neither fixes a bug nor adds a feature |

## Pull Request Checklist
- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm check` (Biome) passes
- [ ] No use of `any` type
- [ ] Logic changes are verified via CLI or server tests
