import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setupRateLimiter } from "../devforum/http.js";
import { DevForumPipeline } from "../devforum/pipeline.js";
import { FastFlagScraper } from "../fastflags/scraper.js";
import { FastFlagSearch } from "../fastflags/search.js";
import { Scheduler } from "../scheduler/index.js";
import type { RichMember, RobloxDocEntry } from "../scraper/fetch.js";
import { fetchGuide, fetchGuideIndex } from "../scraper/guides.js";
import { scrapeIndex, scrapeMany, scrapeTopic } from "../scraper/index.js";
import { initIndexer, search, searchGuides, warmUp } from "../scraper/search.js";
import { createSyncStateManager, Indexer, LmdbStore } from "../store/index.js";
import { parseGithubTokenArgs, resolveGithubToken } from "../utils/github-token.js";

// ! AI projection types

// ! AI projection types

// ! AI projection types

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

// ! Shared constants

const MEMBER_KEYS = ["properties", "methods", "events", "callbacks"] as const;
type MemberKey = (typeof MEMBER_KEYS)[number];

const KIND_LABELS: Record<MemberKey, AIMember["kind"]> = {
  properties: "property",
  methods: "method",
  events: "event",
  callbacks: "callback",
};

const NOTABLE_TAGS = new Set(["ReadOnly", "Hidden", "NotReplicated"]);

// ! Projection helpers

function projectMember(
  m: RichMember,
  kind: AIMember["kind"],
  inherited: boolean,
  inheritedFrom?: string,
): AIMember {
  const member: AIMember = {
    name: m.name,
    kind,
    summary: m.summary,
    deprecated: m.isDeprecated,
    inherited,
    threadSafety: m.threadSafety,
  };

  // Set inheritedFrom only when the member is actually inherited
  if (inherited && inheritedFrom !== undefined) member.inheritedFrom = inheritedFrom;

  if (m.type !== undefined) member.type = m.type;
  if (m.parameters !== undefined && m.parameters.length > 0) member.parameters = m.parameters;
  if (m.returns !== undefined) member.returns = m.returns;

  if (m.security !== null && m.security !== "None") {
    member.security = m.security;
  }

  return member;
}

function projectForAI(entry: RobloxDocEntry, includeInherited = false): AIEntry {
  const cl = entry.class;

  const ownMembers: AIMember[] = [
    ...cl.ownMembers.properties.map((m) => projectMember(m, "property", false)),
    ...cl.ownMembers.methods.map((m) => projectMember(m, "method", false)),
    ...cl.ownMembers.events.map((m) => projectMember(m, "event", false)),
    ...cl.ownMembers.callbacks.map((m) => projectMember(m, "callback", false)),
  ];

  const inheritedMembers: AIMember[] = includeInherited
    ? entry.inheritedMembers.flatMap((group) => [
        ...group.properties.map((m) => projectMember(m, "property", true, group.fromClass)),
        ...group.methods.map((m) => projectMember(m, "method", true, group.fromClass)),
        ...group.events.map((m) => projectMember(m, "event", true, group.fromClass)),
        ...group.callbacks.map((m) => projectMember(m, "callback", true, group.fromClass)),
      ])
    : [];

  const result: AIEntry = {
    name: cl.name,
    kind: "class",
    summary: cl.summary || cl.description,
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

// ! Prompt text

const ROBLOX_DEV_ASSISTANT_PROMPT =
  `You are a Roblox Luau development assistant with access to the RoDocs MCP tools.\n\n` +
  `Follow this workflow for every API lookup:\n` +
  `1. If the API name is uncertain or approximate, always call find_api_name first to get the exact spelling.\n` +
  `2. Call get_api_reference with the exact name. Use includeInherited=true only when the user explicitly asks about inherited behavior or parent classes.\n` +
  `3. If the user asks for code examples, prefer get_code_samples over get_api_reference to save context.\n` +
  `4. If asked to compare APIs, use compare_api_members.\n` +
  `5. Before suggesting any method or property, check get_api_changelog to avoid deprecated members.\n` +
  `6. For conceptual or tutorial questions, use search_guides then get_guide.\n\n` +
  `Never guess API names. Never suggest deprecated members without warning.`;

// ! Server

export interface CreateServerOptions {
  githubToken?: string;
  schedulerOptions?: { jobsOptional?: boolean };
  autoStartScheduler?: boolean;
}

export interface ServerInstance {
  server: McpServer;
  scheduler: Scheduler;
  shutdown: () => void;
}

function resolveServerGithubToken(options: CreateServerOptions): string | undefined {
  if (options.githubToken !== undefined) {
    return resolveGithubToken(options.githubToken);
  }

  return parseGithubTokenArgs(process.argv.slice(2)).githubToken;
}

export function createServer(options: CreateServerOptions = {}): ServerInstance {
  const githubToken = resolveServerGithubToken(options);

  // Initialize LMDB Store for index persistence
  const store = new LmdbStore();
  store.open().catch((err) => console.error(`[Server] Store open failed: ${err}`));
  const syncManager = createSyncStateManager(store);
  initIndexer(store, syncManager);
  const ffSearch = new FastFlagSearch(store);

  const scheduler = new Scheduler(options.schedulerOptions);
  setupRateLimiter(scheduler.devForumRateLimiter);

  const server = new McpServer({
    name: "rodocsmcp",
    version: "1.0.0",
  });

  warmUp(githubToken);

  const fastFlagScraper = new FastFlagScraper(store, syncManager, new Indexer(store, syncManager));
  const devForumPipeline = new DevForumPipeline(
    store,
    syncManager,
    new Indexer(store, syncManager),
  );

  scheduler.jobRunner.schedule({
    name: "fastflags-update",
    intervalMs: 24 * 60 * 60 * 1000,
    task: async () => {
      await fastFlagScraper.seed(githubToken);
    },
  });

  scheduler.jobRunner.schedule({
    name: "devforum-update",
    intervalMs: 6 * 60 * 60 * 1000,
    constraints: (now) => {
      const utcHour = now.getUTCHours();
      return utcHour < 14 || utcHour >= 22;
    },
    task: async () => {
      const needsSync = await syncManager.needsSync("devforum", { maxAge: 6 * 60 * 60 * 1000 });
      if (!needsSync) return;
      await devForumPipeline.seed();
    },
  });

  if (options.autoStartScheduler !== false) {
    scheduler.start();
  }

  const shutdown = () => {
    scheduler.stop();
    store.close();
  };

  server.registerTool(
    "get_api_reference",
    {
      title: "Get Roblox API Reference",
      description:
        "Returns API documentation for a single Roblox class, enum, datatype, library or global. " +
        "Own members are always included. Inherited members are excluded by default — " +
        "set includeInherited=true only when the user explicitly asks about parent-class behavior. " +
        "Includes parameter types, return types, security levels, thread safety and code samples.",
      inputSchema: {
        topic: z
          .string()
          .min(1)
          .describe(
            "Exact topic name, case-sensitive. E.g.: Actor, TweenService, KeyCode, Vector3, task",
          ),
        includeInherited: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, includes members inherited from parent classes. Default: false."),
      },
    },
    async ({ topic, includeInherited }) => {
      scheduler.recordActivity();
      const result = await scrapeTopic(topic, githubToken);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(projectForAI(result.entry, includeInherited), null, 2),
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
        "Inherited members are excluded by default; set includeInherited=true to include them.",
      inputSchema: {
        topics: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe("List of exact topic names. Max 20."),
        includeInherited: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, includes inherited members for all topics. Default: false."),
      },
    },
    async ({ topics, includeInherited }) => {
      scheduler.recordActivity();
      const results = await scrapeMany(topics, githubToken);
      const projected = results.map((r) =>
        r.ok
          ? {
              ok: true,
              topic: r.topic,
              entry: projectForAI(r.entry, includeInherited),
            }
          : r,
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
      scheduler.recordActivity();
      const result = await scrapeIndex(githubToken);
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
      scheduler.recordActivity();
      const results = await search(query, { types: ["api"], limit: 1 }, githubToken);
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
      scheduler.recordActivity();
      const results = await searchGuides(query, 10, githubToken);
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
      scheduler.recordActivity();
      const result = await fetchGuide(path, githubToken);
      if (!result) {
        return {
          content: [],
          isError: true,
        };
      }
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
      scheduler.recordActivity();
      const entries = await fetchGuideIndex(githubToken);
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

  server.registerTool(
    "get_code_samples",
    {
      title: "Get Roblox API Code Samples",
      description:
        "Returns only the code samples for a Roblox API topic. " +
        "Use when you want practical usage examples without the full API payload.",
      inputSchema: {
        topic: z
          .string()
          .min(1)
          .describe("Exact topic name, e.g.: TweenService, DataStore, RunService"),
      },
    },
    async ({ topic }) => {
      scheduler.recordActivity();
      const result = await scrapeTopic(topic, githubToken);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.entry.class.codeSamples, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "compare_api_members",
    {
      title: "Compare Roblox API Members",
      description:
        "Compares member names across 2–5 Roblox API topics. " +
        "Shows shared members and members unique to each topic.",
      inputSchema: {
        topics: z
          .array(z.string().min(1))
          .min(2)
          .max(5)
          .describe("List of 2–5 exact topic names to compare."),
      },
    },
    async ({ topics }) => {
      scheduler.recordActivity();
      const results = await scrapeMany(topics, githubToken);

      const memberSets = new Map<string, Set<string>>();
      for (const result of results) {
        if (!result.ok) continue;
        const names = new Set<string>();
        for (const key of MEMBER_KEYS) {
          for (const m of result.entry.class.ownMembers[key]) {
            names.add(m.name);
          }
        }
        memberSets.set(result.topic, names);
      }

      const allTopics = [...memberSets.keys()];
      const allNames = new Set([...memberSets.values()].flatMap((s) => [...s]));

      const shared: string[] = [];
      const unique: Record<string, string[]> = Object.fromEntries(allTopics.map((t) => [t, []]));

      for (const name of allNames) {
        const count = allTopics.filter((t) => memberSets.get(t)?.has(name) === true).length;
        if (count === memberSets.size) {
          shared.push(name);
        } else {
          for (const t of allTopics) {
            if (memberSets.get(t)?.has(name) === true) {
              unique[t]?.push(name);
            }
          }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ topics, shared, unique }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_api_changelog",
    {
      title: "Get Roblox API Changelog",
      description:
        "Returns deprecation and tag metadata for a Roblox API topic. " +
        "Use this to avoid suggesting removed or deprecated members.",
      inputSchema: {
        topic: z.string().min(1).describe("Exact topic name, e.g.: TweenService, Humanoid"),
      },
    },
    async ({ topic }) => {
      scheduler.recordActivity();
      const result = await scrapeTopic(topic, githubToken);
      const cl = result.entry.class;

      const deprecated: Array<{ name: string; kind: string; message: string }> = [];
      const notable: Array<{ name: string; kind: string; tags: string[] }> = [];

      for (const key of MEMBER_KEYS) {
        const kindLabel = KIND_LABELS[key];
        for (const m of cl.ownMembers[key]) {
          if (m.isDeprecated) {
            deprecated.push({
              name: m.name,
              kind: kindLabel,
              message: m.deprecationMessage,
            });
          }
          const notableTags = m.tags.filter((t) => NOTABLE_TAGS.has(t));
          if (notableTags.length > 0)
            notable.push({ name: m.name, kind: kindLabel, tags: notableTags });
        }
      }

      for (const group of result.entry.inheritedMembers) {
        for (const key of MEMBER_KEYS) {
          const kindLabel = KIND_LABELS[key];
          for (const m of group[key]) {
            if (m.isDeprecated) {
              deprecated.push({
                name: m.name,
                kind: kindLabel,
                message: m.deprecationMessage,
              });
            }
            const notableTags = m.tags.filter((t) => NOTABLE_TAGS.has(t));
            if (notableTags.length > 0)
              notable.push({ name: m.name, kind: kindLabel, tags: notableTags });
          }
        }
      }

      const classDeprecated = cl.deprecationMessage.length > 0 || cl.tags.includes("Deprecated");

      const payload: {
        topic: string;
        classDeprecated: boolean;
        classDeprecationMessage?: string;
        deprecated: Array<{ name: string; kind: string; message: string }>;
        notable: Array<{ name: string; kind: string; tags: string[] }>;
      } = { topic, classDeprecated, deprecated, notable };

      if (cl.deprecationMessage) payload.classDeprecationMessage = cl.deprecationMessage;

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
    "roblox_fastflags",

    {
      title: "Search Roblox FastFlags",
      description:
        "Searches for Roblox FastFlags (FFlags) in the local store. " +
        "Supports filtering by name, kind, behavior, and platform. " +
        "Returns a list of flags with their values and metadata.",
      inputSchema: {
        query: z.string().optional().describe("Substring or exact name of the flag to search for."),
        kind: z
          .enum(["FFlag", "FInt", "FString", "FLog", "FBoolean", "Unknown"])
          .optional()
          .describe("Filter by flag type."),
        behavior: z
          .enum(["Fast", "Dynamic", "Synchronized", "Unknown"])
          .optional()
          .describe("Filter by update behavior."),
        platform: z.string().optional().describe("Filter by specific platform."),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum number of results to return."),
      },
    },
    async (args) => {
      try {
        const flags = await ffSearch.search(args);

        if (flags.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No FastFlags found matching the criteria. If the store is empty, please run the --seed-fastflags command first.",
              },
            ],
          };
        }

        const projected = flags.map((f) => ({
          name: f.name,
          value: f.value,
          kind: f.kind,
          behavior: f.behavior,
          platforms: f.platforms,
          source: "MaximumADHD",
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(projected, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching FastFlags: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerPrompt(
    "roblox-dev-assistant",
    {
      title: "Roblox Dev Assistant",
      description: "Instructs the assistant to follow the correct RoDocs lookup flow.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: ROBLOX_DEV_ASSISTANT_PROMPT,
          },
        },
      ],
    }),
  );

  return { server, scheduler, shutdown };
}
