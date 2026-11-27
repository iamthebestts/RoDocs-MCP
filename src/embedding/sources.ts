import type { DevForumRecord } from "../devforum/types.js";
import { fetchIndex } from "../scraper/fetch.js";
import { fetchGuideIndex } from "../scraper/guides.js";
import { type IKeyValueStore, storeGetByPrefix } from "../store/index.js";
import type { EmbedDoc } from "../types/index.js";

export function dedupeEmbedDocs(docs: EmbedDoc[]): EmbedDoc[] {
  const seen = new Set<string>();
  const unique: EmbedDoc[] = [];
  for (const doc of docs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    unique.push(doc);
  }
  return unique;
}

export async function buildDocsEmbedDocs(githubToken?: string): Promise<EmbedDoc[]> {
  const {
    classes,
    datatypes = [],
    enums,
    globals = [],
    libraries = [],
  } = await fetchIndex(githubToken);
  const names = [...classes, ...datatypes, ...enums, ...globals, ...libraries];
  return dedupeEmbedDocs(
    names.map((name) => ({
      id: name,
      source: "docs",
      text: name,
    })),
  );
}

export async function buildGuidesEmbedDocs(githubToken?: string): Promise<EmbedDoc[]> {
  const entries = await fetchGuideIndex(githubToken);
  return entries.map((entry) => ({
    id: entry.path,
    source: "guides",
    text: `${entry.title} ${entry.description}`.trim(),
  }));
}

export async function buildFastflagsEmbedDocs(store: IKeyValueStore): Promise<EmbedDoc[]> {
  const entries = await storeGetByPrefix<{ name: string; description?: string }>(
    store,
    "fastflags:",
  );
  return entries.map(({ key, value: record }) => ({
    id: key,
    source: "fastflags",
    text: record ? `${record.name} ${record.description ?? ""}`.trim() : key,
  }));
}

export async function buildDevforumEmbedDocs(store: IKeyValueStore): Promise<EmbedDoc[]> {
  const entries = await storeGetByPrefix<DevForumRecord>(store, "devforum:");
  return entries
    .filter(({ value: record }) => Boolean(record))
    .map(({ key, value: record }) => ({
      id: key,
      source: "devforum",
      text: `${record.title} ${record.content}`.trim(),
    }));
}
