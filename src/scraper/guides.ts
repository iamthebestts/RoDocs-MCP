import axios from "axios";
import { MemoryCache } from "./cache.js";

export interface GuideMetadata {
  path: string;
  title: string;
  description: string;
  category: string;
}

export interface GuideResult {
  path: string;
  markdown: string;
}

interface TreeEntry {
  path?: string;
  type?: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
}

const TREE_URL = "https://api.github.com/repos/Roblox/creator-docs/git/trees/main?recursive=1";

const RAW_BASE = "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/";

const CONTENT_PREFIX = "content/en-us/";
const REFERENCE_PREFIX = "content/en-us/reference/";
const INDEX_TTL_MS = 30 * 60 * 1000;
const GUIDE_TTL_MS = 10 * 60 * 1000;

const http = axios.create({
  timeout: 20_000,
  headers: {
    "User-Agent": "rodocsmcp/1.0.0",
    Accept: "application/json, text/plain",
  },
});

const guideCache = new MemoryCache<GuideResult>(GUIDE_TTL_MS);

let indexSnapshot: { entries: GuideMetadata[]; fetchedAt: number } | null = null;

function parseFrontmatter(markdown: string): {
  title: string;
  description: string;
} {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (match === null || match[1] === undefined) {
    return { title: "", description: "" };
  }

  const block = match[1];
  const titleMatch = block.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const descMatch = block.match(/^description:\s*["']?(.+?)["']?\s*$/m);

  return {
    title: titleMatch?.[1]?.trim() ?? "",
    description: descMatch?.[1]?.trim() ?? "",
  };
}

function hydrateFrontmatter(path: string, markdown: string): void {
  if (indexSnapshot === null) return;
  const entry = indexSnapshot.entries.find((e) => e.path === path);
  if (entry === undefined) return;
  const { title, description } = parseFrontmatter(markdown);
  entry.title = title;
  entry.description = description;
}

export async function fetchGuideIndex(): Promise<GuideMetadata[]> {
  const now = Date.now();

  if (indexSnapshot !== null && now - indexSnapshot.fetchedAt < INDEX_TTL_MS) {
    return indexSnapshot.entries;
  }

  const { data } = await http.get<TreeResponse>(TREE_URL);
  const tree = data.tree ?? [];

  const entries: GuideMetadata[] = tree
    .filter((item): item is { path: string } => {
      return (
        typeof item.path === "string" &&
        item.path.startsWith(CONTENT_PREFIX) &&
        item.path.endsWith(".md") &&
        !item.path.startsWith(REFERENCE_PREFIX)
      );
    })
    .map((item) => {
      const relative = item.path.slice(CONTENT_PREFIX.length);
      const category = relative.split("/")[0] ?? "";
      return { path: relative, title: "", description: "", category };
    });

  indexSnapshot = { entries, fetchedAt: now };
  return entries;
}

export async function searchGuides(query: string): Promise<GuideMetadata[]> {
  const entries = await fetchGuideIndex();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const scored = entries.map((entry) => {
    const haystack = `${entry.path} ${entry.title} ${entry.description}`.toLowerCase();

    const score = tokens.reduce((acc, token) => {
      const matches = haystack.match(new RegExp(token, "g"));
      return acc + (matches?.length ?? 0);
    }, 0);

    return { entry, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ entry }) => entry);
}

export async function fetchGuide(path: string): Promise<GuideResult> {
  const cached = guideCache.get(path);
  if (cached !== undefined) return cached;

  const url = `${RAW_BASE}${path}`;
  const { data: markdown } = await http.get<string>(url, {
    headers: { Accept: "text/plain" },
  });

  const result: GuideResult = { path, markdown };
  guideCache.set(path, result);
  hydrateFrontmatter(path, markdown);

  return result;
}
