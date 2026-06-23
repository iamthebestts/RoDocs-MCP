import type { DevForumRecord } from "../devforum/types.js";
import { fetchIndex } from "../scraper/fetch.js";
import { fetchGuideIndex } from "../scraper/guides.js";
import type { IKeyValueStore } from "../store/store-interface.js";
import type { EmbedDoc } from "../types/index.js";

export async function buildDocsEmbedDocs(githubToken?: string): Promise<EmbedDoc[]> {
  const {
    classes,
    datatypes = [],
    enums,
    globals = [],
    libraries = [],
  } = await fetchIndex(githubToken);
  const names = [...classes, ...datatypes, ...enums, ...globals, ...libraries];
  return names.map((name) => ({
    id: name,
    source: "docs",
    text: name,
  }));
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
  const keys = (await store.keys()).filter((key) => key.startsWith("fastflags:"));
  const docs: EmbedDoc[] = [];
  for (const key of keys) {
    const record = await store.get<{ name: string; description?: string }>(key);
    docs.push({
      id: key,
      source: "fastflags",
      text: record ? `${record.name} ${record.description ?? ""}`.trim() : key,
    });
  }
  return docs;
}

export async function buildDevforumEmbedDocs(store: IKeyValueStore): Promise<EmbedDoc[]> {
  const keys = (await store.keys()).filter((key) => key.startsWith("devforum:"));
  const docs: EmbedDoc[] = [];
  for (const key of keys) {
    const record = await store.get<DevForumRecord>(key);
    if (!record) continue;
    docs.push({
      id: key,
      source: "devforum",
      text: `${record.title} ${record.content}`.trim(),
    });
  }
  return docs;
}
