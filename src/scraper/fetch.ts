import axios from "axios";
import { buildGithubHeaders } from "../utils/github-token.js";
import { fetchGitHubTree } from "./tree.js";
import { parseYamlToDocEntry } from "./yaml-parser.js";

export type ApiKind = "class" | "datatype" | "enum" | "global" | "library";

export interface CodeSample {
  identifier: string;
  displayName: string;
  description: string;
  language: "luau" | "typescript" | "python" | "other";
  code: string;
}

export interface RichMember {
  name: string;
  summary: string;
  type?: string | undefined;
  parameters?: Array<{ name: string; type: string; default?: string }>;
  returns?: string | undefined;
  tags: string[];
  deprecationMessage: string;
  isDeprecated: boolean;
  inheritedFrom: string;
  threadSafety: string | null;
  security: string | null;
}

export interface OwnMembers {
  properties: RichMember[];
  methods: RichMember[];
  events: RichMember[];
  callbacks: RichMember[];
}

export interface InheritedGroup {
  fromClass: string;
  properties: RichMember[];
  methods: RichMember[];
  events: RichMember[];
  callbacks: RichMember[];
}

export interface RobloxDocEntry {
  class: {
    kind?: ApiKind;
    name: string;
    summary: string;
    description: string;
    inherits: string[];
    descendants: string[];
    tags: string[];
    deprecationMessage: string;
    codeSamples: CodeSample[];
    ownMembers: OwnMembers;
  };
  inheritedMembers: InheritedGroup[];
}

const http = axios.create({
  timeout: 20_000,
  headers: {
    "User-Agent": "rodocsmcp/1.0.0",
    Accept: "application/json, text/plain",
  },
});

let engineVersionHash = "default";

export function getEngineVersionHash(): string {
  return engineVersionHash;
}

const CATEGORIES = ["classes", "datatypes", "enums", "globals", "libraries"] as const;
type Category = (typeof CATEGORIES)[number];

const RAW_BASE =
  "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine";

const categoryMap = new Map<string, Category>();

export async function fetchTopic(topic: string, githubToken?: string): Promise<RobloxDocEntry> {
  const knownCategory = categoryMap.get(topic);
  if (knownCategory) {
    return fetchYaml(knownCategory, topic, githubToken);
  }

  for (const category of CATEGORIES) {
    try {
      return await fetchYaml(category, topic, githubToken);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) continue;
      throw err;
    }
  }

  throw new Error(
    `Topic "${topic}" not found in creator-docs reference. ` +
      `Check spelling — names are case-sensitive.`,
  );
}

async function fetchYaml(
  category: Category,
  topic: string,
  githubToken?: string,
  visitedParents: Set<string> = new Set(),
): Promise<RobloxDocEntry> {
  const url = `${RAW_BASE}/${category}/${topic}.yaml`;
  const { data } = await http.get<string>(url, {
    headers: buildGithubHeaders({ Accept: "text/plain" }, githubToken),
  });
  const entry = parseYamlToDocEntry(data);
  return enrichInheritedMembers(entry, githubToken, visitedParents);
}

function markInherited(members: OwnMembers, fromClass: string): OwnMembers {
  return {
    properties: members.properties.map((member) => ({ ...member, inheritedFrom: fromClass })),
    methods: members.methods.map((member) => ({ ...member, inheritedFrom: fromClass })),
    events: members.events.map((member) => ({ ...member, inheritedFrom: fromClass })),
    callbacks: members.callbacks.map((member) => ({ ...member, inheritedFrom: fromClass })),
  };
}

async function enrichInheritedMembers(
  entry: RobloxDocEntry,
  githubToken: string | undefined,
  visitedParents: Set<string>,
): Promise<RobloxDocEntry> {
  if ((entry.class.kind ?? "class") !== "class" || entry.class.inherits.length === 0) return entry;

  const inheritedMembers: InheritedGroup[] = [];

  for (const parentName of entry.class.inherits) {
    if (visitedParents.has(parentName)) continue;
    visitedParents.add(parentName);

    try {
      const parent = await fetchYaml("classes", parentName, githubToken, visitedParents);
      const inherited = markInherited(parent.class.ownMembers, parent.class.name);
      inheritedMembers.push({
        fromClass: parent.class.name,
        properties: inherited.properties,
        methods: inherited.methods,
        events: inherited.events,
        callbacks: inherited.callbacks,
      });
      inheritedMembers.push(...parent.inheritedMembers);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) continue;
      throw err;
    }
  }

  return { ...entry, inheritedMembers };
}

export function findClosestMatch(topic: string, names: string[]): string | null {
  const lower = topic.toLowerCase();

  const exact = names.find((n) => n.toLowerCase() === lower);
  if (exact !== undefined) return exact;

  const startsWith = names.find((n) => n.toLowerCase().startsWith(lower));
  if (startsWith !== undefined) return startsWith;

  const contains = names.find((n) => n.toLowerCase().includes(lower));
  if (contains !== undefined) return contains;

  return null;
}

export async function fetchIndex(githubToken?: string): Promise<{
  classes: string[];
  datatypes: string[];
  enums: string[];
  globals: string[];
  libraries: string[];
}> {
  const { entries, sha } = await fetchGitHubTree(githubToken);
  engineVersionHash = sha;

  const result: Record<Category, string[]> = {
    classes: [],
    datatypes: [],
    enums: [],
    globals: [],
    libraries: [],
  };

  categoryMap.clear();

  for (const entry of entries) {
    const path = entry.path ?? "";
    if (!path.startsWith("content/en-us/reference/engine/") || !path.endsWith(".yaml")) continue;

    const parts = path.split("/");
    const category = parts[4] as Category;
    const fileName = parts[parts.length - 1] ?? "";
    const name = fileName.replace(".yaml", "");

    if (CATEGORIES.includes(category)) {
      result[category].push(name);
      categoryMap.set(name, category);
    }
  }

  for (const category of CATEGORIES) {
    result[category].sort();
  }

  return result;
}
