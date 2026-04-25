# CLI Reference

GitHub-backed requests can be authenticated with `--github-token <token>` or `GITHUB_TOKEN`. The explicit flag takes precedence.

## Command Modes

### Default / Server Mode
Starts the MCP server using stdio transport.
```bash
rodocsmcp
# or
rodocsmcp --stdio
# or
rodocsmcp --stdio --github-token "$GITHUB_TOKEN"
```
**Output**
```text
rodocsmcp MCP server ready (stdio)
```

### Topic Lookup
Prints formatted documentation for the specified Roblox topic.
```bash
rodocsmcp Actor
```
**Output**
```text
CLASS: Actor                                                                 
Inherits: Instance                                                           
Members: 12 own  45 inherited                                                

...
```

### Index List
Lists all available classes and enums in the Roblox API.
```bash
rodocsmcp --list
```
**Output**
```text
CLASSES (1200)

  Actor
  BasePart
  ...

ENUMS (400)

  Enum.Material
  ...
```

### API Name Search
Searches for the closest API name matching the provided query using BM25. Supports common aliases (e.g., 'datastore').
```bash
rodocsmcp --find tweenserv
```
**Output**
```text
✔ Closest match: TweenService
```

### Guide Lookup
Search for and fetch Roblox Creator Guides.

#### Search Guides
Searches guides by keyword.
```bash
rodocsmcp --search-guide "data store"
```
**Output**
```text
GUIDES (5 results)
────────────────────────────────────────────────────────────────────────────
  scripting/data/data-stores.md
  Data Stores
  How to save and load data...
  category: scripting
  ──────────────────
  ...
```

#### Fetch Guide
Fetches the full content of a guide by its relative path.
```bash
rodocsmcp --guide scripting/data/data-stores.md
```
**Output**
```text
GUIDE: scripting/data/data-stores.md
───────────────────────────────────────

# Data Stores
...
```

### GitHub Authentication
Authenticates requests that hit GitHub-hosted APIs or raw content.
```bash
rodocsmcp --github-token "$GITHUB_TOKEN" Actor
```

You can also omit the flag and rely on:
```bash
GITHUB_TOKEN=your_pat rodocsmcp --search-guide "data store"
```

### Help
Displays the CLI usage guide.
```bash
rodocsmcp --help
```
**Output**
```text
rodocsmcp - Roblox Creator Hub API reference & MCP server

USAGE
  rodocsmcp                    Start MCP server (stdio)
  ...
```

### Flags Summary

| Flag | Description |
| :--- | :--- |
| `--stdio` | Starts the MCP server over stdio. |
| `--list` | Lists all known class and enum names. |
| `--find <query>` | Resolves the closest API name. |
| `--search-guide <query>` | Searches creator guides by keyword. |
| `--guide <path>` | Fetches a guide by relative path. |
| `--github-token <token>` | Adds GitHub authentication for GitHub API and raw content requests. |
| `--help`, `-h` | Prints CLI help. |
