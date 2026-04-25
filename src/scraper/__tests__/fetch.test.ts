import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const axiosState = vi.hoisted(() => {
  const state = {
    get: vi.fn(),
    create: vi.fn(() => ({
      get: state.get,
    })),
    isAxiosError: vi.fn((err: unknown) => {
      return Boolean((err as { isAxiosError?: boolean }).isAxiosError);
    }),
  };

  return state;
});

vi.mock("axios", () => ({
  default: {
    create: axiosState.create,
    isAxiosError: axiosState.isAxiosError,
  },
  create: axiosState.create,
  isAxiosError: axiosState.isAxiosError,
}));

function makeAxiosError(status: number): {
  isAxiosError: true;
  response: { status: number };
  message: string;
} {
  return {
    isAxiosError: true,
    response: { status },
    message: `Request failed with status code ${status}`,
  };
}

function nextDataHtml(data: unknown): string {
  return `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

async function loadFetch() {
  return import("../fetch.js");
}

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchIndex sorts entries and caches the api dump hash", async () => {
    axiosState.get.mockResolvedValueOnce({
      data: {
        Classes: [{ Name: "Zed" }, { Name: "" }, { Name: "Alpha" }],
        Enums: [{ Name: "RunContext" }, { Name: "" }],
      },
      headers: { etag: '"abc"' },
    });

    const { fetchIndex, getEngineVersionHash } = await loadFetch();

    await expect(fetchIndex()).resolves.toEqual({
      classes: ["Alpha", "Zed"],
      enums: ["RunContext"],
    });
    expect(getEngineVersionHash()).toBe('"abc"');

    await expect(fetchIndex()).resolves.toEqual({
      classes: ["Alpha", "Zed"],
      enums: ["RunContext"],
    });
    expect(axiosState.get).toHaveBeenCalledTimes(1);
  });

  it("adds an Authorization header to GitHub dump requests when a token is provided", async () => {
    axiosState.get.mockResolvedValueOnce({
      data: {
        Classes: [],
        Enums: [],
      },
      headers: {},
    });

    const { fetchIndex } = await loadFetch();
    await fetchIndex("pat-123");

    expect(axiosState.get).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/Mini-API-Dump.json",
      {
        headers: {
          Authorization: "Bearer pat-123",
        },
      },
    );
  });

  it("wraps api dump failures", async () => {
    axiosState.get.mockRejectedValueOnce(new Error("boom"));

    const { fetchIndex } = await loadFetch();

    await expect(fetchIndex()).rejects.toThrow("Failed to load API dump: boom");
  });

  it("fetchTopic flattens creator hub data", async () => {
    const html = nextDataHtml({
      props: {
        pageProps: {
          data: {
            apiReference: {
              name: "SomeTopic",
              summary: "  Some  summary\ntext  ",
              description: "  Some description  ",
              inherits: ["BaseClass"],
              descendants: ["ChildClass"],
              tags: ["Deprecated"],
              deprecationMessage: "Use AnotherTopic",
              codeSamples: [
                {
                  identifier: "sample",
                  displayName: "Sample",
                  description: "Example",
                  codeSample:
                    'local value = game:GetService(\\"Players\\")\\\\nprint(\\"hi\\")\\\\tend',
                },
              ],
              properties: [
                {
                  name: "Enabled",
                  summary: "  Property summary  ",
                  type: { Name: "boolean" },
                  tags: ["ReadOnly"],
                  deprecationMessage: "",
                  threadSafety: "Safe",
                  security: { Name: "PluginSecurity" },
                },
              ],
              methods: [
                {
                  name: "DoThing",
                  summary: "  Method summary  ",
                  type: { name: "void" },
                  parameters: [
                    { Name: "count", Type: { Name: "number" }, Default: "1" },
                    { name: "player", type: "Player" },
                  ],
                  returns: [{ Type: { Name: "string" } }],
                  tags: ["Deprecated"],
                  deprecationMessage: "Deprecated",
                  threadSafety: "Unsafe",
                  security: { Name: "RobloxScriptSecurity" },
                },
              ],
              events: [
                {
                  name: "Changed",
                  summary: " Event summary ",
                  tags: [],
                  threadSafety: "Unsafe",
                  security: { Name: "None" },
                },
              ],
              callbacks: [
                {
                  name: "Callback",
                  summary: " Callback summary ",
                  parameters: [{ name: "x", type: "number" }],
                  returns: [{ type: { Name: "boolean" } }],
                  tags: [],
                  threadSafety: "Safe",
                  security: null,
                },
              ],
            },
            classReferenceParents: [
              {
                name: "ParentClass",
                properties: [
                  {
                    name: "ParentProperty",
                    summary: " inherited ",
                    type: "string",
                    tags: [],
                    threadSafety: "Safe",
                    security: "None",
                  },
                ],
                methods: [
                  {
                    name: "ParentMethod",
                    summary: " inherited method ",
                    type: "function",
                    parameters: [],
                    returns: [],
                    tags: [],
                    deprecationMessage: "",
                    threadSafety: "Safe",
                    security: "None",
                  },
                ],
                events: [],
                callbacks: [],
              },
            ],
          },
        },
      },
    });

    axiosState.get.mockImplementation((url: string) => {
      if (url.includes("/classes/SomeTopic")) {
        return Promise.resolve({ data: html });
      }

      return Promise.reject(makeAxiosError(404));
    });

    const { fetchTopic } = await loadFetch();
    const entry = await fetchTopic("SomeTopic");

    expect(entry.class.name).toBe("SomeTopic");
    expect(entry.class.summary).toBe("Some summary text");
    expect(entry.class.description).toBe("Some description");
    expect(entry.class.inherits).toEqual(["BaseClass"]);
    expect(entry.class.descendants).toEqual(["ChildClass"]);
    expect(entry.class.tags).toEqual(["Deprecated"]);
    expect(entry.class.deprecationMessage).toBe("Use AnotherTopic");
    expect(entry.class.codeSamples[0]?.language).toBe("luau");
    expect(entry.class.codeSamples[0]?.code).toContain("\n");
    expect(entry.class.ownMembers.properties[0]?.type).toBe("boolean");
    expect(entry.class.ownMembers.properties[0]?.security).toBe("PluginSecurity");
    expect(entry.class.ownMembers.methods[0]?.parameters?.[0]).toEqual({
      name: "count",
      type: "number",
      default: "1",
    });
    expect(entry.class.ownMembers.methods[0]?.returns).toBe("string");
    expect(entry.class.ownMembers.methods[0]?.isDeprecated).toBe(true);
    expect(entry.class.ownMembers.methods[0]?.security).toBe("RobloxScriptSecurity");
    expect(entry.class.ownMembers.events[0]?.security).toBe("None");
    expect(entry.class.ownMembers.callbacks[0]?.security).toBeNull();
    expect(entry.inheritedMembers[0]?.fromClass).toBe("ParentClass");
    expect(entry.inheritedMembers[0]?.methods[0]?.inheritedFrom).toBe("ParentClass");
  });

  it("throws when a topic does not exist", async () => {
    axiosState.get.mockRejectedValue(makeAxiosError(404));

    const { fetchTopic } = await loadFetch();

    await expect(fetchTopic("MissingTopic")).rejects.toThrow(
      'Topic "MissingTopic" not found on Creator Hub.',
    );
  });

  it("findClosestMatch prefers exact, prefix and contains matches", async () => {
    const { findClosestMatch } = await loadFetch();

    expect(findClosestMatch("datastore", ["DataStoreService", "RunService"])).toBe(
      "DataStoreService",
    );
    expect(findClosestMatch("run", ["DataStoreService", "RunService"])).toBe("RunService");
    expect(findClosestMatch("store", ["DataStoreService", "RunService"])).toBe("DataStoreService");
    expect(findClosestMatch("nope", ["DataStoreService", "RunService"])).toBeNull();
  });
});
