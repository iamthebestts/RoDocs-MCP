# RoDocsMCP

Typed scraper and MCP server for the Roblox Creator Hub API Reference and Guides.

[![npm version](https://img.shields.io/npm/v/%40iamthebestts%2Frodocsmcp?style=flat-square)](https://www.npmjs.com/package/@iamthebestts/rodocsmcp)
[![license](https://img.shields.io/npm/l/%40iamthebestts%2Frodocsmcp?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square)](https://nodejs.org)

Provides MCP-compatible AI assistants with structured access to Roblox API + Creator Hub guides.

---

## MCP Setup

```json
{
  "mcpServers": {
    "rodocs": {
      "command": "npx",
      "args": ["-y", "@iamthebestts/rodocsmcp", "--stdio"]
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
      "args": ["-y", "@iamthebestts/rodocsmcp", "--stdio", "--github-token", "YOUR_GITHUB_PAT"]
    }
  }
}
```

---

## MCP Tools

| Tool                      | Description              |
| ------------------------- | ------------------------ |
| `get_api_reference`       | Fetch API entry          |
| `get_many_api_references` | Batch fetch (max 20)     |
| `list_api_names`          | List classes/enums       |
| `find_api_name`           | Resolve closest API name |
| `search_guides`           | Search Creator Guides    |
| `get_guide`               | Fetch guide content      |
| `list_guides`             | List available guides    |
| `get_code_samples`        | Fetch code samples only  |
| `compare_api_members`     | Compare topic members    |
| `get_api_changelog`       | Inspect deprecations     |

---

## CLI

### Usage

```bash
npx @iamthebestts/rodocsmcp TweenService
npx @iamthebestts/rodocsmcp --list
npx @iamthebestts/rodocsmcp --find tweenserv
npx @iamthebestts/rodocsmcp --search-guide "data store"
npx @iamthebestts/rodocsmcp --guide scripting/data/data-stores.md
npx @iamthebestts/rodocsmcp --github-token "$GITHUB_TOKEN" TweenService
npx @iamthebestts/rodocsmcp --stdio
```

### Commands

| Command                  | Description      |
| ------------------------ | ---------------- |
| `<topic>`                | Show API docs    |
| `--list`                 | List API names   |
| `--find <query>`         | Resolve API name |
| `--search-guide <query>` | Search guides    |
| `--guide <path>`         | Fetch guide      |
| `--github-token <token>` | Authenticate GitHub requests |
| `--stdio`                | Start MCP server |

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
} from "@iamthebestts/rodocsmcp";

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

- **API Reference**: Extracted from `__NEXT_DATA__` on Creator Hub (no DOM scraping)
- **Guides**: Fetched and indexed from Creator Hub docs
- **Search**: BM25 ranking with alias normalization and Luau synonym resolution
- **Cache**: In-memory TTL (10 min)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
