# CLI Reference

## Command Modes

### Default / Server Mode
Starts the MCP server using stdio transport.
```bash
rodocsmcp
# or
rodocsmcp --stdio
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
┌CLASS: Actor                                                                 ┐
│Inherits: Instance                                                           │
│Members: 12 own  45 inherited                                                │
└─────────────────────────────────────────────────────────────────────────────┘
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
──────────────────────────────────────────────────────────────────────────────
  Actor
  BasePart
  ...

ENUMS (400)
──────────────────────────────────────────────────────────────────────────────
  Enum.Material
  ...
```

### Fuzzy Find
Searches for the closest API name matching the provided query.
```bash
rodocsmcp --find tweenserv
```
**Output**
```text
✔ Closest match: TweenService
```

### Help
Displays the CLI usage guide.
```bash
rodocsmcp --help
```
**Output**
```text
rodocsmcp — Roblox Creator Hub API reference & MCP server

USAGE
  rodocsmcp                    Start MCP server (stdio)
  ...
```
