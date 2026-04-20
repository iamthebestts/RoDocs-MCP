# RoDocsMCP

Typed scraper and MCP server for the Roblox Creator Hub API Reference.

[![npm version](https://img.shields.io/npm/v/rodocsmcp?style=flat-square)](https://www.npmjs.com/package/rodocsmcp)
[![license](https://img.shields.io/npm/l/rodocsmcp?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square)](https://nodejs.org)

Provides any MCP-compatible AI assistant with live, structured access to the full Roblox Engine API — classes, enums, datatypes, globals, libraries, and Creator Hub guides — without hallucinated signatures or stale documentation.

---

## MCP Setup

Add to your `claude_desktop_config.json` (or equivalent):

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

Restart your client. The server exposes three tools automatically:

| Tool | What it does |
| :--- | :--- |
| `get_api_reference` | Full docs for a single class, enum, datatype, or global |
| `get_many_api_references` | Up to 20 topics in one call |
| `list_api_names` | All class and enum names for discovery or validation |

---

## CLI

### npx (no install)

```bash
npx rodocsmcp Actor
```

### Global install

```bash
npm install -g rodocsmcp
```

```bash
rodocs Actor
rodocs --list
rodocs --find tweenserv
```

### Commands

| Command | Description | Example |
| :--- | :--- | :--- |
| `rodocs` | Start MCP server (stdio) | `rodocs` |
| `rodocs --stdio` | Start MCP server (explicit) | `rodocs --stdio` |
| `rodocs <Topic>` | Print formatted docs for a topic | `rodocs TweenService` |
| `rodocs --list` | List all class and enum names | `rodocs --list` |
| `rodocs --find <query>` | Fuzzy-match the closest API name | `rodocs --find tweenserv` |
| `rodocs --help` | Show help | `rodocs --help` |

### Example output

```
rodocs Actor
```

```
┌──────────────────────────────────────────────────────┐
│ CLASS: Actor                                         │
│ Inherits: Instance                                   │
└──────────────────────────────────────────────────────┘

DESCRIPTION
  The Actor class represents a unit of execution that can run
  scripts in parallel using Roblox's parallel Luau model.

FUNCTIONS (3)
──────────────────────────────────────────────────────
  SendMessage(topic: string, ...): void — Sends a message to the Actor
  BindToMessage(topic: string, func: function): RBXScriptConnection
  BindToMessageParallel(topic: string, func: function): RBXScriptConnection

PROPERTIES (1)
──────────────────────────────────────────────────────
  ...
```

---

## Programmatic API

```bash
npm install rodocsmcp
```

```ts
import { scrapeTopic, scrapeMany, scrapeIndex, findClosestApiName } from "rodocsmcp";

const actor = await scrapeTopic("Actor");
console.log(actor.entry.class.ownMembers.methods);

const [vec3, cframe] = await scrapeMany(["Vector3", "CFrame"]);

const index = await scrapeIndex();
console.log(index.classes.length);

const match = await findClosestApiName("tweenserv");
// → "TweenService"
```

---

## Build from Source

**Requirements:** Node.js >= 20, pnpm >= 10

```bash
git clone https://github.com/iamthebestts/RoDocs-MCP
cd RoDocs-MCP
pnpm install
```

### Development

```bash
pnpm dev Actor
```

Runs the CLI directly via `tsx` — no compile step.

### Build

```bash
pnpm build
```

Outputs ESM + CJS bundles with `.d.ts` declarations to `dist/`.

### Run the built output

```bash
node dist/cli.js Actor
node dist/cli.js --stdio
```

### Type-check only

```bash
pnpm typecheck
```

### Lint + format

```bash
pnpm lint
pnpm format
```

---

## How it works

The scraper targets two sources:

**API Reference** — `create.roblox.com` is a Next.js app. Every page embeds the full structured API payload in a `<script id="__NEXT_DATA__">` block. The scraper extracts and parses that JSON directly — no DOM traversal, no CSS selectors. This gives access to member signatures, security levels, thread safety, deprecation status, inherited members, and code samples exactly as Roblox publishes them.

**Name Index** — Class and enum names are sourced from [`MaximumADHD/Roblox-Client-Tracker`](https://github.com/MaximumADHD/Roblox-Client-Tracker), which publishes a machine-generated `Mini-API-Dump.json` from the Roblox client binary on every engine update.

All responses are cached in-memory with a 10-minute TTL.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
