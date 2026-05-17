import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setupRateLimiter } from "../devforum/http.js";
import { DevForumPipeline } from "../devforum/pipeline.js";
import { initDevForumSearch, searchDevForumStore } from "../devforum/search.js";
import { FastFlagScraper } from "../fastflags/scraper.js";
import { FastFlagSearch } from "../fastflags/search.js";
import { Scheduler } from "../scheduler/index.js";
import { SeedManager, type SeedSource } from "../scheduler/seed-manager.js";
import type { ApiKind, CodeSample, RichMember, RobloxDocEntry } from "../scraper/fetch.js";
import { fetchGuide, fetchGuideIndex } from "../scraper/guides.js";
import { scrapeIndex, scrapeMany, scrapeTopic } from "../scraper/index.js";
import { initIndexer, search, searchGuides, warmUp } from "../search/index.js";
import { ROBLOX_SEARCH_SOURCES, robloxSearch } from "../search/roblox-search.js";
import {
  createSyncStateManager,
  Indexer,
  LmdbStore,
  type SyncStateManager,
} from "../store/index.js";
import { parseGithubTokenArgs, resolveGithubToken } from "../utils/github-token.js";
import { logger } from "../utils/logger.js";

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
  kind: ApiKind;
  summary: string;
  inherits: string[];
  deprecated: boolean;
  deprecationMessage?: string;
  members: AIMember[];
  codeSamples: Array<{ title: string; language: string; code: string; identifier: string }>;
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

function projectCodeSample(sample: CodeSample): {
  title: string;
  language: string;
  code: string;
  identifier: string;
} {
  return {
    title: sample.displayName || sample.identifier,
    language: sample.language,
    code: sample.code,
    identifier: sample.identifier,
  };
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
    kind: cl.kind ?? "class",
    summary: cl.summary || cl.description,
    inherits: cl.inherits,
    deprecated: cl.deprecationMessage.length > 0 || cl.tags.includes("Deprecated"),
    members: [...ownMembers, ...inheritedMembers],
    codeSamples: cl.codeSamples.map(projectCodeSample),
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
  store?: LmdbStore;
  syncManager?: SyncStateManager;
  initializeStore?: boolean;
}

export interface ServerInstance {
  server: McpServer;
  scheduler: Scheduler;
  seedManager: SeedManager;
  shutdown: () => void;
}

const WARMING_HINTS: Record<SeedSource, string> = {
  docs: "This source is still warming up. Results may be incomplete. Run --seed-docs for immediate full seed.",
  guides:
    "This source is still warming up. Results may be incomplete. Run --seed-guides for immediate full seed.",
  fastflags:
    "This source is still warming up. Results may be incomplete. Run --seed-fastflags for immediate full seed.",
  devforum:
    "This source is still warming up. Results may be incomplete. Run --seed-devforum for immediate full seed.",
};

function searchSources(source: (typeof ROBLOX_SEARCH_SOURCES)[number]): SeedSource[] {
  if (source === "all") return ["docs", "guides", "fastflags", "devforum"];
  return [source];
}

function warmingMetadata(seedManager: SeedManager, source: SeedSource) {
  const progress = seedManager.getProgress(source);
  return {
    warming: progress.status !== "complete",
    hint: WARMING_HINTS[source],
    hints: { [source]: WARMING_HINTS[source] },
    progress,
  };
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
  const store = options.store ?? new LmdbStore();
  if (options.initializeStore !== false) {
    store.open().catch((err) => logger.error(`[Server] Store open failed: ${err}`));
  }
  const syncManager = options.syncManager ?? createSyncStateManager(store);

  // Single shared Indexer so that write-side invalidation (scraper/pipeline) reaches
  // the in-memory caches registered via onClear() in the search modules.
  const sharedIndexer = new Indexer(store, syncManager);
  if (options.store === undefined || options.syncManager === undefined) {
    initIndexer(store, syncManager, sharedIndexer);
    initDevForumSearch(sharedIndexer);
  }
  const ffSearch = new FastFlagSearch(store, sharedIndexer);

  const scheduler = new Scheduler(options.schedulerOptions);
  setupRateLimiter(scheduler.devForumRateLimiter);

  const server = new McpServer({
    name: "rodocsmcp",
    version: "2.0.0",
  });

  const fastFlagScraper = new FastFlagScraper(store, syncManager, sharedIndexer);
  const devForumPipeline = new DevForumPipeline(store, syncManager, sharedIndexer);
  const seedManager = new SeedManager({
    syncManager,
    idleDetector: scheduler.idleDetector,
    rateLimiters: {
      devforum: scheduler.devForumRateLimiter,
    },
    runners: [
      {
        source: "docs",
        estimatedTotal: 350,
        batchSize: 50,
        runBatch: async () => {
          warmUp(githubToken);
          return { processed: 50, done: true, logDetail: "50 paths" };
        },
      },
      {
        source: "guides",
        estimatedTotal: 350,
        batchSize: 50,
        runBatch: async () => {
          warmUp(githubToken);
          return { processed: 50, done: true, logDetail: "50 paths" };
        },
      },
      {
        source: "fastflags",
        estimatedTotal: 12,
        batchSize: 3,
        runBatch: async () => {
          await fastFlagScraper.seed(githubToken);
          return { processed: 3, done: true, needsRebuild: true, logDetail: "3 targets" };
        },
      },
      {
        source: "devforum",
        estimatedTotal: 100,
        batchSize: 20,
        runBatch: async () => {
          await devForumPipeline.seed();
          return { processed: 20, done: true, needsRebuild: true, logDetail: "20 topics" };
        },
      },
    ],
  });

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

  const ownsStore = options.store === undefined;
  const shutdown = () => {
    seedManager.stop();
    scheduler.stop();
    if (ownsStore) {
      store.close();
    }
  };

  server.registerTool(
    "get_api_reference",
    {
      title: "Get Roblox API Reference",
      description:
        "Returns API documentation for a single Roblox class, enum, datatype, library or global. " +
        "Own members are always included. Inherited members are excluded by default — " +
        "set includeInherited=true only when the user explicitly asks about parent-class behavior. " +
        "Includes parameter types, return types, security levels, thread safety and sample metadata.",
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
        "Returns all Roblox API names grouped by class, datatype, enum, global, and library. " +
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
            text: JSON.stringify(
              {
                classes: result.classes,
                datatypes: result.datatypes ?? [],
                enums: result.enums,
                globals: result.globals ?? [],
                libraries: result.libraries ?? [],
              },
              null,
              2,
            ),
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
        "BM25-searches known API names for the closest match to a query. " +
        "Use this when you have an approximate or misspelled name and need the exact spelling " +
        "before calling get_api_reference. Also resolves common aliases (e.g. 'datastore'). " +
        "Returns the best match plus up to 4 runner-up candidates with confidence scores. " +
        "Recommended first step in the lookup workflow: find_api_name → get_api_reference.",
      inputSchema: {
        query: z.string().min(1).describe("Partial or approximate API name to search for."),
      },
    },
    async ({ query }) => {
      scheduler.recordActivity();
      seedManager.prioritize("docs");
      const results = await search(query, { types: ["api"], limit: 5 }, githubToken);
      const top = results[0];
      const maxScore = top?.score ?? 1;
      const payload =
        top !== undefined
          ? {
              found: true,
              match: top.name,
              confidence: Math.min(1, top.score / Math.max(maxScore, 1)),
              candidates: results.slice(1).map((r) => ({
                name: r.name,
                score: r.score,
              })),
            }
          : { found: false, match: null, confidence: 0, candidates: [] };
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
        "matching a free-text query. Returns results with path, title, description and category. " +
        "Use this for tutorial/conceptual questions. For API reference, prefer find_api_name → get_api_reference.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Free-text search query. E.g.: "tweening", "physics constraints", "data store"',
          ),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum number of results. Default: 10."),
      },
    },
    async ({ query, limit }) => {
      scheduler.recordActivity();
      seedManager.prioritize("guides");
      const results = await searchGuides(query, limit, githubToken);
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
    "roblox_search",
    {
      title: "Search Roblox Docs, Guides, FastFlags, and DevForum",
      description:
        "Unified cross-source search across Roblox docs, guides, local FastFlags, and curated DevForum. " +
        "Results are grouped by source. Use this for broad exploratory queries that may span multiple sources. " +
        "For precise workflows, prefer: find_api_name → get_api_reference (API lookup), " +
        "search_guides → get_guide (tutorials), roblox_fastflags (flag-specific), roblox_devforum (community solutions).",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Free-text query. E.g.: "data store", "FFlagDebug", "remote events"'),
        source: z
          .enum(ROBLOX_SEARCH_SOURCES)
          .optional()
          .default("all")
          .describe(
            'Source filter: "all" (default), "docs", "guides", "fastflags", or "devforum".',
          ),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum results per selected source. Default: 10."),
      },
    },
    async ({ query, source, limit }) => {
      scheduler.recordActivity();
      for (const requestedSource of searchSources(source)) {
        seedManager.prioritize(requestedSource);
      }
      const result = await robloxSearch(store, {
        query,
        source,
        limit,
        githubToken,
      });
      const warmingSources = searchSources(source).filter((requestedSource) => {
        const values = result.results[requestedSource];
        return (
          values.length === 0 && seedManager.getProgress(requestedSource).status !== "complete"
        );
      });
      const payload =
        warmingSources.length > 0
          ? {
              ...result,
              warming: true,
              hints: Object.fromEntries(
                warmingSources.map((requestedSource) => [
                  requestedSource,
                  WARMING_HINTS[requestedSource],
                ]),
              ),
              progress: Object.fromEntries(
                warmingSources.map((requestedSource) => [
                  requestedSource,
                  seedManager.getProgress(requestedSource),
                ]),
              ),
            }
          : result;

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
    "roblox_devforum",
    {
      title: "Search Curated Roblox DevForum Records",
      description:
        "Searches locally seeded curated DevForum technical records for community solutions and patterns. " +
        "Offline-only; does not call DevForum. Use this for implementation patterns, community workarounds, " +
        "and real-world usage examples. For official docs, prefer get_api_reference or search_guides instead.",
      inputSchema: {
        query: z.string().min(1).describe("Technical query to search in local DevForum records."),
        tags: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Optional required DevForum tags to filter results. " +
              'Common tags: "scripting", "building", "animation", "networking", "ui".',
          ),
        requireAcceptedAnswer: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, only returns topics with an accepted answer."),
        requireStaffReply: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, only returns topics with a staff reply."),
        minScore: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .default(60)
          .describe("Minimum curated quality score. Default: 60."),
        limit: z
          .number()
          .min(1)
          .max(25)
          .optional()
          .default(10)
          .describe("Maximum number of results. Default: 10."),
      },
    },
    async (args) => {
      scheduler.recordActivity();
      seedManager.prioritize("devforum");
      const result = await searchDevForumStore(store, args);
      const payload =
        result.results.length === 0
          ? {
              ...result,
              ...warmingMetadata(seedManager, "devforum"),
            }
          : result;

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
        "Returns code sample metadata for a Roblox API topic. " +
        "Use when you want examples without the full API payload.",
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
        "Searches for Roblox FastFlags (FFlags) in the local store (source: MaximumADHD). " +
        "Supports filtering by name substring, kind, behavior, and platform. " +
        "Use this for debugging, feature detection, or checking experimental features. " +
        "For broader search across all sources, use roblox_search with source='fastflags'.",
      inputSchema: {
        query: z.string().optional().describe("Substring or exact name of the flag to search for."),
        kind: z
          .enum(["FFlag", "FInt", "FString", "FLog", "FBoolean", "Unknown"])
          .optional()
          .describe("Filter by flag type: FFlag (bool), FInt, FString, FLog, FBoolean."),
        behavior: z
          .enum(["Fast", "Dynamic", "Synchronized", "Unknown"])
          .optional()
          .describe(
            "Filter by update behavior: Fast (client-side), Dynamic (runtime), Synchronized.",
          ),
        platform: z
          .string()
          .optional()
          .describe(
            'Filter by platform. Common values: "Windows", "Mac", "iOS", "Android", "XBox", "Studio".',
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum number of results to return. Default: 50."),
      },
    },
    async (args) => {
      try {
        scheduler.recordActivity();
        seedManager.prioritize("fastflags");
        const flags = await ffSearch.search(args);

        if (flags.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    results: [],
                    ...warmingMetadata(seedManager, "fastflags"),
                  },
                  null,
                  2,
                ),
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

  if (options.autoStartScheduler !== false) {
    scheduler.start();
    seedManager.startBackground();
  }

  return { server, scheduler, seedManager, shutdown };
}
