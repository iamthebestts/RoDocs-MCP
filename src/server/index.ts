import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RichMember, RobloxDocEntry } from "../scraper/fetch.js";
import { fetchGuide, fetchGuideIndex } from "../scraper/guides.js";
import { scrapeIndex, scrapeMany, scrapeTopic } from "../scraper/index.js";
import { search, searchGuides, warmUp } from "../scraper/search.js";

interface AIMember {
  name: string;
  kind: "property" | "method" | "event" | "callback";
  summary: string;
  type?: string;
  parameters?: Array<{ name: string; type: string; default?: string }>;
  returns?: string;
  deprecated: boolean;
  inherited: boolean;
  inheritedFrom?: string;
  threadSafety?: string | null;
  security?: string;
}

interface AIEntry {
  name: string;
  kind: "class" | "enum" | "datatype" | "global" | "library";
  summary: string;
  inherits: string[];
  deprecated: boolean;
  deprecationMessage?: string;
  members: AIMember[];
  codeSamples: Array<{ title: string; language: string; code: string }>;
}

// ! Projection helpers

function flattenType(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.Name === "string") return obj.Name;
    if (typeof obj.name === "string") return obj.name;
  }
  return "unknown";
}

function flattenParams(raw: unknown[] | undefined): AIMember["parameters"] | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
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

function flattenReturns(raw: unknown[] | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const first = raw[0] as Record<string, unknown> | undefined;
  if (first === undefined) return undefined;
  const typeRaw = first.Type ?? first.type ?? first;
  return flattenType(typeRaw);
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function projectMember(
  m: RichMember,
  kind: AIMember["kind"],
  inherited: boolean,
  inheritedFrom?: string,
): AIMember {
  const member: AIMember = {
    name: m.name,
    kind,
    summary: cleanText(m.summary || m.description),
    deprecated: m.isDeprecated,
    inherited,
    threadSafety: m.threadSafety ?? null,
  };

  if (inheritedFrom !== undefined) member.inheritedFrom = inheritedFrom;

  const type = flattenType(m.type);
  if (type !== "unknown") member.type = type;

  const params = flattenParams(m.parameters);
  if (params !== undefined) member.parameters = params;

  const returns = flattenReturns(m.returns);
  if (returns !== undefined) member.returns = returns;

  if (m.security !== null && m.security !== undefined) {
    const sec = flattenType(m.security);
    if (sec !== "unknown" && sec !== "None") member.security = sec;
  }

  return member;
}

function projectForAI(entry: RobloxDocEntry): AIEntry {
  const cl = entry.class;

  const ownMembers: AIMember[] = [
    ...cl.ownMembers.properties.map((m) => projectMember(m, "property", false)),
    ...cl.ownMembers.methods.map((m) => projectMember(m, "method", false)),
    ...cl.ownMembers.events.map((m) => projectMember(m, "event", false)),
    ...cl.ownMembers.callbacks.map((m) => projectMember(m, "callback", false)),
  ];

  const inheritedMembers: AIMember[] = entry.inheritedMembers.flatMap((group) => [
    ...group.properties.map((m) => projectMember(m, "property", true, group.fromClass)),
    ...group.methods.map((m) => projectMember(m, "method", true, group.fromClass)),
    ...group.events.map((m) => projectMember(m, "event", true, group.fromClass)),
    ...group.callbacks.map((m) => projectMember(m, "callback", true, group.fromClass)),
  ]);

  const result: AIEntry = {
    name: cl.name,
    kind: "class",
    summary: cleanText(cl.summary || cl.description),
    inherits: cl.inherits,
    deprecated: cl.deprecationMessage.length > 0 || cl.tags.includes("Deprecated"),
    members: [...ownMembers, ...inheritedMembers],
    codeSamples: cl.codeSamples.map((s) => ({
      title: s.displayName || s.identifier,
      language: s.language,
      code: s.code,
    })),
  };

  if (cl.deprecationMessage) result.deprecationMessage = cl.deprecationMessage;

  return result;
}

// ! Server

export function createServer(): McpServer {
  const server = new McpServer({
    name: "rodocsmcp",
    version: "1.0.0",
  });

  // Warm up search indices in the background on server start
  warmUp();

  server.registerTool(
    "get_api_reference",
    {
      title: "Get Roblox API Reference",
      description:
        "Returns full API documentation for a single Roblox class, enum, datatype, library or global. " +
        "Includes all own and inherited properties, methods, events, callbacks, parameter types, " +
        "return types, security levels, thread safety and code samples. " +
        "Use this to understand how a specific Roblox API works before writing Luau code.",
      inputSchema: {
        topic: z
          .string()
          .min(1)
          .describe(
            "Exact topic name, case-sensitive. E.g.: Actor, TweenService, KeyCode, Vector3, task",
          ),
      },
    },
    async ({ topic }) => {
      const result = await scrapeTopic(topic);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(projectForAI(result.entry), null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_many_api_references",
    {
      title: "Get Multiple Roblox API References",
      description:
        "Fetches API references for up to 20 Roblox topics in one call. " +
        "Returns partial results — failed topics include an error message, successful ones return full docs. " +
        "Use this when you need to look up several APIs at once to avoid multiple round-trips.",
      inputSchema: {
        topics: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe("List of exact topic names. Max 20."),
      },
    },
    async ({ topics }) => {
      const results = await scrapeMany(topics);
      const projected = results.map((r) =>
        r.ok ? { ok: true, topic: r.topic, entry: projectForAI(r.entry) } : r,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(projected, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_api_names",
    {
      title: "List All Roblox API Names",
      description:
        "Returns a flat list of all Roblox class names and enum names from the Creator Hub. " +
        "Does NOT include documentation — only names. Use this to discover available APIs, " +
        "validate topic names before calling get_api_reference, or build autocomplete lists.",
      inputSchema: {},
    },
    async () => {
      const result = await scrapeIndex();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ classes: result.classes, enums: result.enums }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "find_api_name",
    {
      title: "Find Closest Roblox API Name",
      description:
        "BM25-searches all known class and enum names for the closest match to a query. " +
        "Use this when you have an approximate or misspelled name and need the exact spelling " +
        "before calling get_api_reference. Also resolves common aliases (e.g. 'datastore').",
      inputSchema: {
        query: z.string().min(1).describe("Partial or approximate API name to search for."),
      },
    },
    async ({ query }) => {
      const results = await search(query, { types: ["api"], limit: 1 });
      const top = results[0];
      const payload =
        top !== undefined ? { found: true, match: top.name } : { found: false, match: null };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_guides",
    {
      title: "Search Roblox Creator Guides",
      description:
        "BM25-searches the Roblox creator-docs repository for guides, tutorials and documentation pages " +
        "matching a free-text query. Returns up to 10 results with path, title, description and category. " +
        "Use this to discover relevant guides before fetching their full content with get_guide.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Free-text search query. E.g.: "tweening", "physics constraints", "data store"',
          ),
      },
    },
    async ({ query }) => {
      const results = await searchGuides(query, 10);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_guide",
    {
      title: "Get Roblox Creator Guide",
      description:
        "Fetches the full Markdown content of a single Roblox creator guide by its path. " +
        "The path is the relative path returned by search_guides or list_guides " +
        '(e.g.: "scripting/services/tween-service.md"). ' +
        "Returns raw Markdown including frontmatter, prose and code samples.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Relative guide path as returned by search_guides or list_guides. " +
              'E.g.: "scripting/services/tween-service.md"',
          ),
      },
    },
    async ({ path }) => {
      const result = await fetchGuide(path);
      return {
        content: [
          {
            type: "text" as const,
            text: result.markdown,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_guides",
    {
      title: "List All Roblox Creator Guides",
      description:
        "Returns the full index of all Roblox creator guide paths and their categories. " +
        "Title and description fields are populated lazily as guides are fetched — " +
        "they may be empty on first call. Use search_guides for a faster filtered view.",
      inputSchema: {},
    },
    async () => {
      const entries = await fetchGuideIndex();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(entries, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
