# MCP Tools Reference

## `get_api_reference`
Returns full API documentation for a single Roblox class, enum, datatype, library or global.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `topic` | `string` | Yes | Exact topic name, case-sensitive. E.g.: Actor, TweenService. |

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
    "error": "Topic \"InvalidName\" not found on Creator Hub."
  }
]
```

## `list_api_names`
Returns a flat list of all Roblox class names and enum names.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| N/A | N/A | No | No input required. |

**Example Response**
```json
{
  "classes": ["Actor", "BasePart", "Instance", "..."],
  "enums": ["Enum.Material", "Enum.KeyCode", "..."]
}
```

## `find_api_name`
Fuzzy-searches all known class and enum names for the closest match to a query.

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Yes | Partial or approximate API name to search for. |

**Example Response**
```json
{
  "found": true,
  "match": "TweenService"
}
```
