# Scraper API Reference

## `scrapeTopic`
Fetches and caches full API docs for a single Roblox topic.

**Signature**
```ts
export async function scrapeTopic(topic: string): Promise<ScrapeResult>
```

**Parameters**
- `topic`: Exact topic name, case-sensitive (e.g., "Actor").

**Returns**
- `ScrapeResult`: Object containing the `topic` name and the `RobloxDocEntry`.

**Example**
```ts
const result = await scrapeTopic('Vector3');
console.log(result.entry.class.summary);
```

---

## `scrapeMany`
Fetches up to 20 topics in parallel. Never rejects - failures become `ScrapeError`.

**Signature**
```ts
export async function scrapeMany(topics: string[]): Promise<ScrapeOutcome[]>
```

**Parameters**
- `topics`: Array of topic names to fetch.

**Returns**
- `ScrapeOutcome[]`: Array of results, each either a `ScrapeResult` or a `ScrapeError`.

**Example**
```ts
const results = await scrapeMany(['Actor', 'InvalidTopic']);
results.forEach(res => {
  if (res.ok) console.log(`Found ${res.topic}`);
  else console.error(`Error in ${res.topic}: ${res.error}`);
});
```

---

## `scrapeIndex`
Returns sorted lists of all class and enum names from the API dump.

**Signature**
```ts
export async function scrapeIndex(): Promise<IndexResult>
```

**Returns**
- `IndexResult`: Object containing `classes` and `enums` string arrays.

**Example**
```ts
const index = await scrapeIndex();
console.log(`Total classes: ${index.classes.length}`);
```

---

## `findClosestApiName`
BM25-searches a query against all known API names and resolves common aliases. Returns null if nothing found.

**Signature**
```ts
export async function findClosestApiName(query: string): Promise<string | null>
```

**Parameters**
- `query`: Partial or approximate API name.

**Returns**
- `string | null`: The exact API name if a match is found, otherwise `null`.

**Example**
```ts
const match = await findClosestApiName('tweenserv'); 
// returns 'TweenService'
```
