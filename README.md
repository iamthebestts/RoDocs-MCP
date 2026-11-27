# RoDocsMCP

Typed scraper and MCP server for the Roblox Creator Hub API Reference and Guides.

[![npm version](https://img.shields.io/npm/v/rodocsmcp?style=flat-square)](https://www.npmjs.com/package/rodocsmcp)
[![license](https://img.shields.io/npm/l/rodocsmcp?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square)](https://nodejs.org)

Provides MCP-compatible AI assistants with structured access to Roblox API + Creator Hub guides.

![Demo](.github/assets/RoDocs%20preview.gif)

---

## MCP Setup

```bash
npx rodocsmcp --setup claude
```

Or manually:

```json
{
  "mcpServers": {
    "rodocs": {
      "command": "npx",
      "args": ["-y", "rodocsmcp", "--stdio"]
    }
  }
}
```

If you need higher GitHub API limits or access to authenticated raw/content fetches, pass a GitHub PAT with `--github-token` or expose it through `GITHUB_TOKEN`.

```json
{
  "mcpServers": {
    "rodocs": {
      "command": "npx",
      "args": ["-y", "rodocsmcp", "--stdio", "--github-token", "YOUR_GITHUB_PAT"]
    }
  }
}
```

---

## MCP Tools

All 14 tools are annotated as read-only and idempotent (`readOnlyHint: true`, `idempotentHint: true`). See [docs/mcp-tools.md](docs/mcp-tools.md) for full schemas and examples.

| Tool                      | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `get_api_reference`       | Fetch API entry (with `memberFilter`, `memberKind`, `summaryOnly`) |
| `get_many_api_references` | Batch fetch (max 20)                                    |
| `list_api_names`          | List API names by kind/prefix/limit                     |
| `find_api_name`           | Resolve closest API name                                |
| `search_guides`           | Search Creator Guides                                   |
| `get_guide`               | Fetch guide content                                     |
| `list_guides`             | List available guides (filterable by category/prefix/limit) |
| `get_code_samples`        | Fetch code sample metadata                              |
| `compare_api_members`     | Compare topic members                                   |
| `get_api_changelog`       | Inspect deprecations and notable tags                   |
| `roblox_search`           | Multi-source search across docs, guides, FastFlags, and DevForum |
| `roblox_fastflags`        | Search local FastFlags (MaximumADHD)                    |
| `roblox_devforum`         | Search locally seeded curated DevForum solutions        |
| `rodocs_status`           | Report local cache, seed progress, record & vector counts |

---

## CLI

### Usage

```bash
# Modern subcommands (recommended)
npx rodocs serve
npx rodocs setup claude-code
npx rodocs api get TweenService
npx rodocs api find tweenserv
npx rodocs api list
npx rodocs guides search "data store"
npx rodocs guides get scripting/data/data-stores.md
npx rodocs seed fastflags --no-embed
npx rodocs seed all --no-embed
npx rodocs cache status
npx rodocs cache clear fastflags
npx rodocs doctor
npx rodocs --version

# Legacy aliases remain supported
npx rodocsmcp TweenService
npx rodocsmcp --list
npx rodocsmcp --stdio
```

### Commands

| Command                            | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `serve [--stdio\|--daemon\|--client]` | Start MCP server, TCP daemon, or daemon bridge    |
| `setup <provider> [--local] [--daemon]` | Configure MCP in IDE/editor                    |
| `api get\|list\|find`              | Query Roblox API reference                          |
| `guides search\|get\|list`         | Query Roblox Creator Hub guides                     |
| `seed <source\|all> [--no-embed]`  | Seed local cache (`docs`, `guides`, `fastflags`, `devforum`, `all`) |
| `cache status\|path\|clear [src]`  | Inspect or clear local SQLite + BM25 + vector cache |
| `doctor`                           | Check Node, GitHub token, SQLite, `sqlite-vec`, and seed states |
| `--github-token <token>`           | Authenticate GitHub requests                        |
| `--version` / `-v`                 | Print version                                       |

### Authentication

GitHub-backed fetches accept either:

- the `--github-token <token>` CLI flag
- the `GITHUB_TOKEN` environment variable

The explicit CLI flag takes precedence over `GITHUB_TOKEN`.

---

## Programmatic API

```ts
import {
  scrapeTopic,
  scrapeMany,
  scrapeIndex,
  findClosestApiName,
} from "rodocsmcp";

await scrapeTopic("Actor");
await scrapeMany(["Vector3", "CFrame"]);
await scrapeIndex();
await findClosestApiName("tweenserv");
```

---

## Build from Source

**Requirements:** Node.js >= 20.10.0, pnpm >= 10

```bash
git clone https://github.com/iamthebestts/RoDocs-MCP
cd RoDocs-MCP
pnpm install
```

### Development

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

### Run built CLI

```bash
node dist/cli.js TweenService
node dist/cli.js --stdio
```

### Quality

```bash
pnpm typecheck
pnpm check
pnpm test
```

---

## How it works

- **API Reference**: Fetched from `Roblox/creator-docs` YAML files for classes, datatypes, enums, globals, and libraries
- **Guides**: Fetched and indexed from `Roblox/creator-docs` Markdown files
- **FastFlags & DevForum**: Locally seeded into SQLite (`WAL` mode) for fast offline queries
- **Search**: Persisted BM25 indexes (MessagePack) with alias normalization, Luau synonym resolution, and optional `sqlite-vec` hybrid semantic search (`multilingual-e5-small`)
- **Daemon**: Optional shared local TCP daemon (`rodocs serve --daemon` / `--client`) sharing a single store, scheduler, and background seed manager across IDE connections

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
