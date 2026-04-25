import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobloxDocEntry } from "../../scraper/fetch.js";

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
    warmUp: vi.fn(),
    scrapeIndex: vi.fn(),
    scrapeMany: vi.fn(),
    scrapeTopic: vi.fn(),
    search: vi.fn(),
    searchGuides: vi.fn(),
    fetchGuide: vi.fn(),
    fetchGuideIndex: vi.fn(),
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

vi.mock("../../scraper/search.js", () => ({
  search: serverState.search,
  searchGuides: serverState.searchGuides,
  warmUp: serverState.warmUp,
}));

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
    const server = createServer() as unknown as {
      options: { name: string; version: string };
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
    };

    expect(server.options).toMatchObject({ name: "rodocsmcp", version: "1.0.0" });
    expect([...server.tools.keys()]).toEqual([
      "get_api_reference",
      "get_many_api_references",
      "list_api_names",
      "find_api_name",
      "search_guides",
      "get_guide",
      "list_guides",
      "get_code_samples",
      "compare_api_members",
      "get_api_changelog",
    ]);
    expect(server.prompts.has("roblox-dev-assistant")).toBe(true);
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
    const server = createServer() as unknown as {
      tools: Map<
        string,
        {
          handler: (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
          }>;
        }
      >;
    };

    const handler = server.tools.get("get_api_reference")?.handler;
    expect(handler).toBeDefined();

    const response = await handler?.({
      topic: "DataStoreService",
      includeInherited: true,
    });
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

  it("uses --github-token for warm-up and tool handlers", async () => {
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
    const server = createServer() as unknown as {
      tools: Map<
        string,
        {
          handler: (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
          }>;
        }
      >;
    };

    expect(serverState.warmUp).toHaveBeenCalledWith("pat-123");

    await server.tools.get("get_api_reference")?.handler({
      topic: "Actor",
      includeInherited: false,
    });
    await server.tools.get("find_api_name")?.handler({ query: "Act" });
    await server.tools.get("get_guide")?.handler({ path: "tutorials/save-player-data.md" });

    expect(serverState.scrapeTopic).toHaveBeenCalledWith("Actor", "pat-123");
    expect(serverState.search).toHaveBeenCalledWith("Act", { types: ["api"], limit: 1 }, "pat-123");
    expect(serverState.fetchGuide).toHaveBeenCalledWith("tutorials/save-player-data.md", "pat-123");
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
    const server = createServer() as unknown as {
      tools: Map<
        string,
        {
          handler: (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
          }>;
        }
      >;
    };

    expect(serverState.warmUp).toHaveBeenCalledWith("env-token");

    await server.tools.get("list_api_names")?.handler({});
    await server.tools.get("list_guides")?.handler({});

    expect(serverState.scrapeIndex).toHaveBeenCalledWith("env-token");
    expect(serverState.fetchGuideIndex).toHaveBeenCalledWith("env-token");
  });
});
