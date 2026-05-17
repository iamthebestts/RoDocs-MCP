# MCP Tools Reference

The server can authenticate GitHub-backed fetches with `--github-token <token>` or `GITHUB_TOKEN` when started over stdio.

## Tool Selection Guide

Use this decision tree to pick the right tool:

```
"What's the API for X?"
  → find_api_name (fuzzy match) → get_api_reference (exact lookup)

"Show me a tutorial about X"
  → search_guides → get_guide

"Is X deprecated?"
  → get_api_changelog

"Compare X and Y"
  → compare_api_members

"Show me code examples for X"
  → get_code_samples

"Broad search across everything"
  → roblox_search (multi-source)

"What FastFlags exist for X?"
  → roblox_fastflags

"How did people solve X?"
  → roblox_devforum (community patterns)
```

---

## `get_api_reference`
Returns full API documentation for a single Roblox class, enum, datatype, library or global.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topic` | `string` | Yes | Exact topic name, case-sensitive. E.g.: Actor, TweenService. |
| `includeInherited` | `boolean` | No | Includes members inherited from parent classes. Default: `false`. |

**Example Response**
```json
{
  "name": "Actor",
  "kind": "class",
  "summary": "The Actor class represents a thread of execution...",
  "inherits": ["Instance"],
  "deprecated": false,
  "members": [
    {
      "name": "Parent",
      "kind": "property",
      "summary": "Returns the parent of this object",
      "type": "Instance",
      "deprecated": false,
      "inherited": true,
      "inheritedFrom": "Instance"
    }
  ],
  "codeSamples": []
}
```

## `get_many_api_references`
Fetches API references for up to 20 Roblox topics in one call.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topics` | `string[]` | Yes | List of exact topic names. Max 20. |
| `includeInherited` | `boolean` | No | Includes inherited members for every topic. Default: `false`. |

**Example Response**
```json
[
  {
    "ok": true,
    "topic": "Vector3",
    "entry": { "name": "Vector3", "kind": "class", "...": "..." }
  },
  {
    "ok": false,
    "topic": "InvalidName",
    "error": "Topic \"InvalidName\" not found in creator-docs reference."
  }
]
```

## `list_api_names`
Returns Roblox API names grouped by class, datatype, enum, global, and library.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| N/A | N/A | No | No input required. |

**Example Response**
```json
{
  "classes": ["Actor", "BasePart", "Instance", "..."],
  "datatypes": ["Vector3", "CFrame", "..."],
  "enums": ["Material", "KeyCode", "..."],
  "globals": ["task", "..."],
  "libraries": ["buffer", "..."]
}
```

## `find_api_name`
BM25-searches known API names for the closest match to a query. Resolves common aliases (e.g., 'datastore'). Returns the best match plus up to 4 runner-up candidates with confidence scores.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Yes | Partial or approximate API name to search for. |

**Example Response**
```json
{
  "found": true,
  "match": "TweenService",
  "confidence": 1,
  "candidates": [
    { "name": "TweenBase", "score": 8.2 },
    { "name": "Tween", "score": 6.1 }
  ]
}
```

## `search_guides`
BM25-searches the Roblox creator-docs repository for guides, tutorials and documentation pages matching a free-text query.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Yes | Free-text search query. E.g.: "tweening", "physics constraints". |
| `limit` | `number` | No | Maximum results (1–50). Default: 10. |

**Example Response**
```json
[
  {
    "name": "scripting/services/tween-service.md",
    "title": "TweenService",
    "description": "Learn how to use TweenService to animate objects...",
    "category": "scripting",
    "score": 12.5
  }
]
```

## `get_guide`
Fetches the full Markdown content of a single Roblox creator guide by its relative path.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `path` | `string` | Yes | Relative guide path returned by `search_guides` or `list_guides`. |

**Example Response**
```markdown
# TweenService
TweenService is used to interpolate...
```

## `list_guides`
Returns the full index of all Roblox creator guide paths and their categories.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| N/A | N/A | No | No input required. |

**Example Response**
```json
[
  {
    "path": "scripting/services/tween-service.md",
    "category": "scripting"
  }
]
```

## `get_code_samples`
Returns code sample metadata for a Roblox API topic.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topic` | `string` | Yes | Exact topic name. E.g.: TweenService, DataStore, RunService. |

**Example Response**
```json
[
  {
    "identifier": "create-tween",
    "displayName": "Create Tween",
    "description": "Basic TweenService example",
    "language": "luau",
    "code": ""
  }
]
```

## `compare_api_members`
Compares member names across 2 to 5 Roblox API topics and returns shared and topic-specific members.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topics` | `string[]` | Yes | List of 2 to 5 exact topic names. |

**Example Response**
```json
{
  "topics": ["TweenService", "RunService"],
  "shared": [],
  "unique": {
    "TweenService": ["Create"],
    "RunService": ["BindToRenderStep"]
  }
}
```

## `get_api_changelog`
Returns deprecation and notable tag metadata for a Roblox API topic.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topic` | `string` | Yes | Exact topic name. E.g.: TweenService, Humanoid. |

**Example Response**
```json
{
  "topic": "Humanoid",
  "classDeprecated": false,
  "deprecated": [],
  "notable": [
    {
      "name": "Health",
      "kind": "property",
      "tags": ["ReadOnly"]
    }
  ]
}
```

## `roblox_search`
Unified cross-source search across docs, guides, FastFlags, and DevForum. Results grouped by source.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Yes | Free-text query. E.g.: "data store", "FFlagDebug". |
| `source` | `string` | No | `"all"` (default), `"docs"`, `"guides"`, `"fastflags"`, or `"devforum"`. |
| `limit` | `number` | No | Max results per source (1–50). Default: 10. |

**Example Response**
```json
{
  "query": "data store",
  "source": "all",
  "limit": 10,
  "results": {
    "docs": [{ "name": "DataStoreService", "score": 15.2, "category": "class" }],
    "guides": [{ "name": "scripting/data/data-stores.md", "title": "Data Stores", "score": 12.1 }],
    "fastflags": [],
    "devforum": [{ "title": "Best practices for DataStore", "url": "...", "score": 9.0 }]
  }
}
```

When sources are still warming up, the response includes:
```json
{
  "warming": true,
  "hints": { "fastflags": "This source is still warming up..." },
  "progress": { "fastflags": { "status": "running", "processed": 3, "total": 12 } }
}
```

## `roblox_devforum`
Searches locally seeded curated DevForum technical records for community solutions and patterns.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Yes | Technical query. |
| `tags` | `string[]` | No | Required DevForum tags. Common: "scripting", "building", "animation". |
| `requireAcceptedAnswer` | `boolean` | No | Only topics with accepted answers. Default: `false`. |
| `requireStaffReply` | `boolean` | No | Only topics with staff replies. Default: `false`. |
| `minScore` | `number` | No | Minimum quality score (0–100). Default: 60. |
| `limit` | `number` | No | Max results (1–25). Default: 10. |

**Example Response**
```json
{
  "query": "remote events best practices",
  "results": [
    {
      "title": "RemoteEvent Security Best Practices",
      "url": "https://devforum.roblox.com/t/...",
      "tags": ["scripting", "networking"],
      "score": 85,
      "codeSnippets": ["..."],
      "updatedAt": "2025-03-15"
    }
  ]
}
```

## `roblox_fastflags`
Searches Roblox FastFlags (FFlags) in the local store (source: MaximumADHD).

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | No | Substring or exact flag name. |
| `kind` | `string` | No | `"FFlag"`, `"FInt"`, `"FString"`, `"FLog"`, `"FBoolean"`, or `"Unknown"`. |
| `behavior` | `string` | No | `"Fast"`, `"Dynamic"`, `"Synchronized"`, or `"Unknown"`. |
| `platform` | `string` | No | Platform filter: "Windows", "Mac", "iOS", "Android", "XBox", "Studio". |
| `limit` | `number` | No | Max results (1–100). Default: 50. |

**Example Response**
```json
[
  {
    "name": "FFlagDebugDisplayFPS",
    "value": "true",
    "kind": "FFlag",
    "behavior": "Fast",
    "platforms": ["Windows", "Mac"],
    "source": "MaximumADHD"
  }
]
```

## Prompt

The server registers the `roblox-dev-assistant` prompt, which instructs MCP clients to follow the recommended lookup workflow:
1. Verify API name with `find_api_name`
2. Fetch reference with `get_api_reference`
3. Check deprecation with `get_api_changelog`
4. Use `search_guides` → `get_guide` for tutorials
5. Use `compare_api_members` for differences
