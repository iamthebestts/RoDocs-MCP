import axios from "axios";
import { buildGithubHeaders } from "../utils/github-token.js";

// ! Flat types

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
  type?: string;
  parameters?: Array<{ name: string; type: string; default?: string }>;
  returns?: string;
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

// ! Internal flatten helpers (applied at enrichment time)

function flattenType(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.Name === "string") return obj.Name;
    if (typeof obj.name === "string") return obj.name;
  }
  return "unknown";
}

function flattenParams(raw: unknown[]): Array<{ name: string; type: string; default?: string }> {
  return raw.map((p) => {
    const param = p as Record<string, unknown>;
    const typeRaw = param.Type ?? param.type;
    const entry: { name: string; type: string; default?: string } = {
      name:
        typeof param.Name === "string"
          ? param.Name
          : typeof param.name === "string"
            ? param.name
            : "",
      type: flattenType(typeRaw),
    };
    const def = param.Default ?? param.default;
    if (typeof def === "string") entry.default = def;
    return entry;
  });
}

function flattenReturns(raw: unknown[]): string | undefined {
  if (raw.length === 0) return undefined;
  const first = raw[0] as Record<string, unknown> | undefined;
  if (first === undefined) return undefined;
  const typeRaw = first.Type ?? first.type ?? first;
  const result = flattenType(typeRaw);
  return result === "unknown" ? undefined : result;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ! Raw API dump

interface RawTag {
  Name: string;
}

interface RawApiDump {
  Classes?: Array<{ Name: string; Tags?: RawTag[] }>;
  Enums?: Array<{ Name: string }>;
}

const http = axios.create({
  timeout: 20_000,
  headers: {
    "User-Agent": "rodocsmcp/1.0.0",
    Accept: "application/json, text/html",
  },
});

const DUMP_URL =
  "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/Mini-API-Dump.json";

let cachedDump: RawApiDump | null = null;
let engineVersionHash = "default";

async function loadApiDump(githubToken?: string): Promise<RawApiDump> {
  if (cachedDump !== null) return cachedDump;
  try {
    const response = await http.get<RawApiDump>(DUMP_URL, {
      headers: buildGithubHeaders({}, githubToken),
    });
    cachedDump = response.data;
    const etag = response.headers.etag;
    const lastModified = response.headers["last-modified"];
    const rawHash =
      (typeof etag === "string" ? etag : undefined) ??
      (typeof lastModified === "string" ? lastModified : undefined) ??
      "default";
    engineVersionHash = rawHash;
    return response.data;
  } catch (err: unknown) {
    throw new Error(`Failed to load API dump: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Returns ETag/Last-Modified from the Mini-API-Dump, fetched once and kept in memory. */
export function getEngineVersionHash(): string {
  return engineVersionHash;
}

// ! Creator Hub scraper

const BASE_URL = "https://create.roblox.com/docs/reference/engine";
const CATEGORIES = ["classes", "datatypes", "enums", "libraries", "globals"] as const;

type Category = (typeof CATEGORIES)[number];

interface RawApiRef {
  name?: string;
  summary?: string;
  description?: string;
  inherits?: string[];
  descendants?: string[];
  tags?: string[];
  deprecationMessage?: string;
  codeSamples?: RawCodeSample[];
  properties?: RawMember[];
  methods?: RawMember[];
  events?: RawMember[];
  callbacks?: RawMember[];
}

interface RawCodeSample {
  identifier?: string;
  displayName?: string;
  description?: string;
  codeSample?: string;
}

interface RawMember {
  name?: string;
  summary?: string;
  type?: unknown;
  parameters?: unknown[];
  returns?: unknown[];
  tags?: string[];
  deprecationMessage?: string;
  threadSafety?: string;
  security?: unknown;
}

interface NextDataShape {
  props?: {
    pageProps?: {
      data?: {
        apiReference?: RawApiRef;
        classReferenceParents?: RawApiRef[];
      };
    };
  };
}

async function fetchCreatorHubPage(
  topic: string,
  category: Category,
): Promise<RobloxDocEntry | null> {
  const url = `${BASE_URL}/${category}/${topic}`;
  let html: string;

  try {
    const { data } = await http.get<string>(url, {
      headers: { Accept: "text/html" },
    });
    html = data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }

  return extractDocEntry(html);
}

function extractDocEntry(html: string): RobloxDocEntry | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (match === null || match[1] === undefined) return null;

  let parsed: NextDataShape;
  try {
    parsed = JSON.parse(match[1]) as NextDataShape;
  } catch {
    return null;
  }

  const data = parsed.props?.pageProps?.data;
  if (data === undefined) return null;

  const apiRef = data.apiReference;
  if (apiRef === undefined) return null;

  const parents = data.classReferenceParents ?? [];
  return buildDocObject(apiRef, parents);
}

// ! Doc builder

function buildDocObject(apiRef: RawApiRef, parents: RawApiRef[]): RobloxDocEntry {
  const targetName = apiRef.name ?? "Unknown";

  const ownMembers: OwnMembers = {
    properties: (apiRef.properties ?? []).map((p) => enrichMember(p, targetName)),
    methods: (apiRef.methods ?? []).map((m) => enrichMember(m, targetName)),
    events: (apiRef.events ?? []).map((e) => enrichMember(e, targetName)),
    callbacks: (apiRef.callbacks ?? []).map((c) => enrichMember(c, targetName)),
  };

  const inheritedMembers: InheritedGroup[] = parents.map((parent) => {
    const fromClass = parent.name ?? "Unknown";
    return {
      fromClass,
      properties: (parent.properties ?? []).map((p) => enrichMember(p, fromClass)),
      methods: (parent.methods ?? []).map((m) => enrichMember(m, fromClass)),
      events: (parent.events ?? []).map((e) => enrichMember(e, fromClass)),
      callbacks: (parent.callbacks ?? []).map((c) => enrichMember(c, fromClass)),
    };
  });

  return {
    class: {
      name: targetName,
      summary: cleanText(apiRef.summary ?? ""),
      description: cleanText(apiRef.description ?? ""),
      inherits: apiRef.inherits ?? [],
      descendants: apiRef.descendants ?? [],
      tags: apiRef.tags ?? [],
      deprecationMessage: apiRef.deprecationMessage ?? "",
      codeSamples: (apiRef.codeSamples ?? []).map(enrichCodeSample),
      ownMembers,
    },
    inheritedMembers,
  };
}

// ! Member enrichment

function enrichMember(raw: RawMember, inheritedFrom: string): RichMember {
  const tags = raw.tags ?? [];
  const deprecationMessage = raw.deprecationMessage ?? "";

  const rawSec = raw.security ?? null;
  const secStr = rawSec !== null ? flattenType(rawSec) : null;

  const member: RichMember = {
    name: raw.name ?? "",
    summary: cleanText(raw.summary ?? ""),
    tags,
    deprecationMessage,
    isDeprecated: tags.includes("Deprecated") || deprecationMessage.length > 0,
    inheritedFrom,
    threadSafety: raw.threadSafety ?? null,
    security: secStr === "unknown" ? null : secStr,
  };

  if (raw.type !== undefined) {
    const typeStr = flattenType(raw.type);
    if (typeStr !== "unknown") member.type = typeStr;
  }

  if (raw.parameters !== undefined && raw.parameters.length > 0) {
    member.parameters = flattenParams(raw.parameters);
  }

  if (raw.returns !== undefined && raw.returns.length > 0) {
    const ret = flattenReturns(raw.returns);
    if (ret !== undefined) member.returns = ret;
  }

  return member;
}

function enrichCodeSample(raw: RawCodeSample): CodeSample {
  const code = unescapeCode(raw.codeSample ?? "");
  return {
    identifier: raw.identifier ?? "",
    displayName: raw.displayName ?? "",
    description: raw.description ?? "",
    language: detectLanguage(code),
    code,
  };
}

function unescapeCode(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"');
}

function detectLanguage(code: string): CodeSample["language"] {
  if (/\b(local |game:GetService|:Connect\(|task\.wait|print\()\b/.test(code)) return "luau";
  if (/\b(import |const |let |=>|async |await )\b/.test(code)) return "typescript";
  if (/\b(def |import .*from|__init__)\b/.test(code)) return "python";
  return "luau";
}

// ! Exported functions

export async function fetchTopic(topic: string): Promise<RobloxDocEntry> {
  for (const category of CATEGORIES) {
    const entry = await fetchCreatorHubPage(topic, category);
    if (entry !== null) return entry;
  }

  throw new Error(
    `Topic "${topic}" not found on Creator Hub. ` +
      `Check spelling — names are case-sensitive (e.g. "Actor", "KeyCode", "Vector3").`,
  );
}

export async function fetchIndex(githubToken?: string): Promise<{
  classes: string[];
  enums: string[];
}> {
  const dump = await loadApiDump(githubToken);

  const classes = (dump.Classes ?? [])
    .map((c) => c.Name)
    .filter((n) => n.length > 0)
    .sort();

  const enums = (dump.Enums ?? [])
    .map((e) => e.Name)
    .filter((n) => n.length > 0)
    .sort();

  return { classes, enums };
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
