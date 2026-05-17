import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobloxDocEntry } from "../../scraper/fetch.js";
import type { ServerInstance } from "../../server/index.js";

interface MockServer {
  options: unknown;
  tools: Map<
    string,
    {
      schema: unknown;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  >;
  prompts: Map<
    string,
    {
      schema: unknown;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  >;
}

const serverState = vi.hoisted(() => {
  class FakeMcpServer {
    options: unknown;
    tools = new Map<
      string,
      {
        schema: unknown;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >();
    prompts = new Map<
      string,
      {
        schema: unknown;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >();

    constructor(options: unknown) {
      this.options = options;
    }

    registerTool(
      name: string,
      schema: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ): void {
      this.tools.set(name, { schema, handler });
    }

    registerPrompt(
      name: string,
      schema: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ): void {
      this.prompts.set(name, { schema, handler });
    }
  }

  return {
    FakeMcpServer,
    initIndexer: vi.fn(),
    warmUp: vi.fn(),
    scrapeIndex: vi.fn(),
    scrapeMany: vi.fn(),
    scrapeTopic: vi.fn(),
    search: vi.fn(),
    searchGuides: vi.fn(),
    robloxSearch: vi.fn(),
    searchDevForumStore: vi.fn(),
    fastFlagSearch: vi.fn(),
    fetchGuide: vi.fn(),
    fetchGuideIndex: vi.fn(),
    stores: [] as Array<{
      open: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      keys: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
    }>,
    syncManagers: [] as Array<{
      getSourceState: ReturnType<typeof vi.fn>;
      updateSourceState: ReturnType<typeof vi.fn>;
      needsSync: ReturnType<typeof vi.fn>;
    }>,
    seedManagers: [] as Array<{
      startBackground: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      prioritize: ReturnType<typeof vi.fn>;
      getProgress: ReturnType<typeof vi.fn>;
    }>,
  };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: serverState.FakeMcpServer,
}));

vi.mock("../../scraper/index.js", () => ({
  scrapeIndex: serverState.scrapeIndex,
  scrapeMany: serverState.scrapeMany,
  scrapeTopic: serverState.scrapeTopic,
}));

vi.mock("../../scraper/guides.js", () => ({
  fetchGuide: serverState.fetchGuide,
  fetchGuideIndex: serverState.fetchGuideIndex,
}));

vi.mock("../../search/index.js", () => ({
  initIndexer: serverState.initIndexer,
  search: serverState.search,
  searchGuides: serverState.searchGuides,
  warmUp: serverState.warmUp,
}));

vi.mock("../../search/roblox-search.js", () => ({
  ROBLOX_SEARCH_SOURCES: ["all", "docs", "guides", "fastflags", "devforum"],
  robloxSearch: serverState.robloxSearch,
}));

vi.mock("../../devforum/search.js", () => ({
  searchDevForumStore: serverState.searchDevForumStore,
  initDevForumSearch: vi.fn(),
}));

vi.mock("../../store/index.js", () => {
  class FakeLmdbStore {
    open = vi.fn(async () => {});
    close = vi.fn();
    keys = vi.fn(async () => []);
    get = vi.fn(async () => null);
    put = vi.fn(async () => {});
    del = vi.fn(async () => {});

    constructor() {
      serverState.stores.push(this);
    }
  }

  class FakeIndexer {}

  function createSyncStateManager() {
    const syncManager = {
      getSourceState: vi.fn(async () => null),
      updateSourceState: vi.fn(async () => {}),
      needsSync: vi.fn(async () => true),
    };
    serverState.syncManagers.push(syncManager);
    return syncManager;
  }

  return {
    LmdbStore: FakeLmdbStore,
    Indexer: FakeIndexer,
    createSyncStateManager,
  };
});

vi.mock("../../fastflags/search.js", () => {
  class FakeFastFlagSearch {
    search = serverState.fastFlagSearch;
  }

  return { FastFlagSearch: FakeFastFlagSearch };
});

vi.mock("../../scheduler/seed-manager.js", () => {
  class FakeSeedManager {
    startBackground = vi.fn();
    stop = vi.fn();
    prioritize = vi.fn();
    getProgress = vi.fn((source: string) => ({
      source,
      status: "pending",
      seededItems: 0,
      estimatedTotal: 10,
      percent: 0,
    }));

    constructor() {
      serverState.seedManagers.push(this);
    }
  }

  return { SeedManager: FakeSeedManager };
});

async function loadServer() {
  return import("../index.js");
}

function createEntry(name: string): RobloxDocEntry {
  return {
    class: {
      name,
      summary: "Summary",
      description: "Description",
      inherits: [],
      descendants: [],
      tags: [],
      deprecationMessage: "",
      codeSamples: [],
      ownMembers: {
        properties: [],
        methods: [],
        events: [],
        callbacks: [],
      },
    },
    inheritedMembers: [],
  };
}

describe("server", () => {
  const originalArgv = [...process.argv];
  const originalGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    serverState.seedManagers.length = 0;
    serverState.stores.length = 0;
    serverState.syncManagers.length = 0;
    serverState.fastFlagSearch.mockResolvedValue([]);
    process.argv = [...originalArgv];
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  it("registers the expected tools and prompt", async () => {
    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    expect(server.options).toMatchObject({
      name: "rodocsmcp",
      version: "2.0.0",
    });
    expect([...server.tools.keys()]).toEqual([
      "get_api_reference",
      "get_many_api_references",
      "list_api_names",
      "find_api_name",
      "search_guides",
      "roblox_search",
      "roblox_devforum",
      "get_guide",
      "list_guides",
      "get_code_samples",
      "compare_api_members",
      "get_api_changelog",
      "roblox_fastflags",
    ]);
    expect(server.prompts.has("roblox-dev-assistant")).toBe(true);
  }, 30000);

  it("starts quickly with background seeding scheduled after registration", async () => {
    const { createServer } = await loadServer();
    const startedAt = performance.now();
    const result = createServer() as unknown as ServerInstance;
    const elapsedMs = performance.now() - startedAt;
    const server = result.server as unknown as MockServer;

    expect(elapsedMs).toBeLessThan(100);
    expect(server.tools.size).toBeGreaterThan(0);
    expect(serverState.seedManagers[0]?.startBackground).toHaveBeenCalledOnce();

    result.shutdown();
  });

  it("projects api references through the tool handler", async () => {
    const entry: RobloxDocEntry = {
      class: {
        name: "DataStoreService",
        summary: "Summary",
        description: "Description",
        inherits: ["Instance"],
        descendants: [],
        tags: [],
        deprecationMessage: "",
        codeSamples: [
          {
            identifier: "sample",
            displayName: "Sample",
            description: "Example",
            language: "luau",
            code: "print('hi')",
          },
        ],
        ownMembers: {
          properties: [
            {
              name: "Enabled",
              summary: "Property",
              tags: ["ReadOnly"],
              deprecationMessage: "",
              isDeprecated: false,
              inheritedFrom: "DataStoreService",
              threadSafety: "Safe",
              security: "None",
            },
          ],
          methods: [
            {
              name: "GetDataStore",
              summary: "Method",
              type: "DataStore",
              tags: [],
              deprecationMessage: "",
              isDeprecated: false,
              inheritedFrom: "DataStoreService",
              threadSafety: "Safe",
              security: null,
              parameters: [{ name: "name", type: "string" }],
              returns: "DataStore",
            },
          ],
          events: [],
          callbacks: [],
        },
      },
      inheritedMembers: [
        {
          fromClass: "Instance",
          properties: [],
          methods: [
            {
              name: "ParentMethod",
              summary: "Inherited",
              tags: [],
              deprecationMessage: "",
              isDeprecated: false,
              inheritedFrom: "Instance",
              threadSafety: "Unsafe",
              security: "RobloxScriptSecurity",
            },
          ],
          events: [],
          callbacks: [],
        },
      ],
    };

    serverState.scrapeTopic.mockResolvedValue({
      ok: true,
      topic: "DataStoreService",
      entry,
    });

    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    const handler = server.tools.get("get_api_reference")?.handler;
    expect(handler).toBeDefined();

    const response = (await handler?.({
      topic: "DataStoreService",
      includeInherited: true,
    })) as { content: Array<{ text: string }> } | undefined;
    const payload = JSON.parse(response?.content[0]?.text ?? "{}") as {
      name: string;
      kind: string;
      members: Array<{
        name: string;
        kind: string;
      }>;
      codeSamples: Array<{ title: string; language: string; code: string }>;
    };

    expect(payload.name).toBe("DataStoreService");
    expect(payload.kind).toBe("class");
    expect(Array.isArray(payload.members)).toBe(true);
    expect(payload.members.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.codeSamples)).toBe(true);
    expect(payload.codeSamples.length).toBeGreaterThan(0);
  });

  it("uses --github-token for tool handlers without eager warm-up", async () => {
    process.argv = ["node", "src/server/index.ts", "--github-token", "pat-123"];

    serverState.scrapeTopic.mockResolvedValue({
      ok: true,
      topic: "Actor",
      entry: createEntry("Actor"),
    });
    serverState.search.mockResolvedValue([{ type: "api", name: "Actor", score: 100 }]);
    serverState.fetchGuide.mockResolvedValue({
      path: "tutorials/save-player-data.md",
      markdown: "# Guide",
    });

    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    expect(serverState.warmUp).not.toHaveBeenCalled();

    await server.tools.get("get_api_reference")?.handler({
      topic: "Actor",
      includeInherited: false,
    });
    await server.tools.get("find_api_name")?.handler({ query: "Act" });
    await server.tools.get("get_guide")?.handler({ path: "tutorials/save-player-data.md" });

    expect(serverState.scrapeTopic).toHaveBeenCalledWith("Actor", "pat-123");
    expect(serverState.search).toHaveBeenCalledWith("Act", { types: ["api"], limit: 5 }, "pat-123");
    expect(serverState.fetchGuide).toHaveBeenCalledWith("tutorials/save-player-data.md", "pat-123");
  });

  it("routes roblox_search through the grouped search service", async () => {
    serverState.robloxSearch.mockResolvedValue({
      query: "data store",
      source: "all",
      limit: 3,
      results: {
        docs: [{ type: "api", name: "DataStoreService", score: 10 }],
        guides: [],
        fastflags: [],
        devforum: [],
      },
    });

    const { createServer } = await loadServer();
    const result = createServer({
      autoStartScheduler: false,
      githubToken: "pat-123",
    }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    const response = (await server.tools.get("roblox_search")?.handler({
      query: "data store",
      source: "all",
      limit: 3,
    })) as { content: Array<{ text: string }> } | undefined;

    expect(serverState.robloxSearch).toHaveBeenCalledWith(expect.anything(), {
      query: "data store",
      source: "all",
      limit: 3,
      githubToken: "pat-123",
    });
    expect(JSON.parse(response?.content[0]?.text ?? "{}")).toMatchObject({
      query: "data store",
      results: {
        docs: [{ name: "DataStoreService" }],
      },
    });
  });

  it("routes roblox_devforum through the local DevForum search service", async () => {
    serverState.searchDevForumStore.mockResolvedValue({
      query: "datastore",
      results: [
        {
          title: "DataStore issue",
          url: "https://devforum.roblox.com/t/datastore/1",
          tags: ["scripting"],
          score: 90,
          codeSnippets: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    const response = (await server.tools.get("roblox_devforum")?.handler({
      query: "datastore",
      tags: ["scripting"],
      requireAcceptedAnswer: true,
      requireStaffReply: false,
      minScore: 70,
      limit: 5,
    })) as { content: Array<{ text: string }>; isError?: boolean } | undefined;

    expect(serverState.searchDevForumStore).toHaveBeenCalledWith(expect.anything(), {
      query: "datastore",
      tags: ["scripting"],
      requireAcceptedAnswer: true,
      requireStaffReply: false,
      minScore: 70,
      limit: 5,
    });
    expect(response?.isError).toBeUndefined();
    expect(serverState.seedManagers[0]?.prioritize).toHaveBeenCalledWith("devforum");
    expect(JSON.parse(response?.content[0]?.text ?? "{}")).toMatchObject({
      query: "datastore",
      results: [{ title: "DataStore issue" }],
    });
  });

  it("returns a warming hint for empty roblox_devforum local store responses", async () => {
    serverState.searchDevForumStore.mockResolvedValue({
      query: "datastore",
      results: [],
      message: "No local DevForum records found. Run `npx rodocsmcp --seed-devforum`.",
    });

    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    const response = (await server.tools.get("roblox_devforum")?.handler({
      query: "datastore",
    })) as { content: Array<{ text: string }>; isError?: boolean } | undefined;

    const payload = JSON.parse(response?.content[0]?.text ?? "{}") as {
      warming?: boolean;
      hint?: string;
      results?: unknown[];
    };

    expect(response?.isError).toBeUndefined();
    expect(payload.results).toEqual([]);
    expect(payload.warming).toBe(true);
    expect(payload.hint).toContain("--seed-devforum");
    expect(serverState.seedManagers[0]?.prioritize).toHaveBeenCalledWith("devforum");
  });

  it("falls back to GITHUB_TOKEN when no flag is present", async () => {
    process.argv = ["node", "src/server/index.ts"];
    process.env.GITHUB_TOKEN = "env-token";

    serverState.scrapeIndex.mockResolvedValue({
      ok: true,
      classes: ["Actor"],
      enums: [],
    });
    serverState.fetchGuideIndex.mockResolvedValue([]);

    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    expect(serverState.warmUp).not.toHaveBeenCalled();

    await server.tools.get("list_api_names")?.handler({});
    await server.tools.get("list_guides")?.handler({});

    expect(serverState.scrapeIndex).toHaveBeenCalledWith("env-token");
    expect(serverState.fetchGuideIndex).toHaveBeenCalledWith("env-token");
  });

  it("returns a warming hint and prioritizes fastflags when the local store is empty", async () => {
    const { createServer } = await loadServer();
    const result = createServer({ autoStartScheduler: false }) as unknown as ServerInstance;
    const server = result.server as unknown as MockServer;

    const response = (await server.tools.get("roblox_fastflags")?.handler({
      query: "Debug",
    })) as { content: Array<{ text: string }> } | undefined;
    const payload = JSON.parse(response?.content[0]?.text ?? "{}") as {
      results?: unknown[];
      warming?: boolean;
      hint?: string;
    };

    expect(payload.results).toEqual([]);
    expect(payload.warming).toBe(true);
    expect(payload.hint).toContain("--seed-fastflags");
    expect(serverState.seedManagers[0]?.prioritize).toHaveBeenCalledWith("fastflags");
  });
});
