import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RobloxDocEntry } from "../fetch.js";
import { fetchGitHubTree } from "../tree.js";
import { parseYamlToDocEntry } from "../yaml-parser.js";

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

vi.mock("../yaml-parser.js", () => ({
  parseYamlToDocEntry: vi.fn(),
}));

vi.mock("../tree.js", () => ({
  fetchGitHubTree: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: axiosState.create,
    isAxiosError: axiosState.isAxiosError,
  },
  create: axiosState.create,
  isAxiosError: axiosState.isAxiosError,
}));

async function loadFetch() {
  return import("../fetch.js");
}

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

describe("fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    axiosState.get.mockReset();
    axiosState.create.mockClear();
    axiosState.isAxiosError.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchIndex calls Tree API and sorts entries", async () => {
    (fetchGitHubTree as Mock).mockResolvedValue({
      entries: [
        { path: "content/en-us/reference/engine/classes/Alpha.yaml" },
        { path: "content/en-us/reference/engine/classes/Zed.yaml" },
        { path: "content/en-us/reference/engine/enums/RunContext.yaml" },
        { path: "content/en-us/reference/engine/README.md" },
      ],
      sha: "abc",
    });

    const { fetchIndex, getEngineVersionHash } = await loadFetch();

    await expect(fetchIndex()).resolves.toEqual({
      classes: ["Alpha", "Zed"],
      datatypes: [],
      enums: ["RunContext"],
      globals: [],
      libraries: [],
    });
    expect(getEngineVersionHash()).toBe("abc");
  });

  it("fetchTopic loads creator-docs YAML with GitHub auth headers", async () => {
    (fetchGitHubTree as Mock).mockResolvedValue({
      entries: [{ path: "content/en-us/reference/engine/classes/Actor.yaml" }],
      sha: "abc",
    });
    axiosState.get.mockResolvedValue({ data: "name: Actor" });
    (parseYamlToDocEntry as Mock).mockReturnValue(createEntry("Actor"));

    const { fetchIndex, fetchTopic } = await loadFetch();
    await fetchIndex("pat-123");

    await expect(fetchTopic("Actor", "pat-123")).resolves.toMatchObject({
      class: { name: "Actor" },
    });
    expect(axiosState.get).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Actor.yaml",
      {
        headers: {
          Accept: "text/plain",
          Authorization: "Bearer pat-123",
        },
      },
    );
    expect(parseYamlToDocEntry).toHaveBeenCalledWith("name: Actor");
  });

  it("fetchTopic probes categories until YAML is found", async () => {
    axiosState.get.mockImplementation((url: string) => {
      if (url.includes("/classes/Vector3.yaml")) {
        return Promise.reject(makeAxiosError(404));
      }
      if (url.includes("/datatypes/Vector3.yaml")) {
        return Promise.resolve({ data: "name: Vector3" });
      }
      return Promise.reject(makeAxiosError(404));
    });
    (parseYamlToDocEntry as Mock).mockReturnValue(createEntry("Vector3"));

    const { fetchTopic } = await loadFetch();

    await expect(fetchTopic("Vector3")).resolves.toMatchObject({
      class: { name: "Vector3" },
    });
    expect(axiosState.get).toHaveBeenCalledTimes(2);
  });

  it("fetchTopic rebuilds inherited member groups from parent YAML", async () => {
    const child = createEntry("Actor");
    child.class.inherits = ["Instance"];
    const parent = createEntry("Instance");
    parent.class.ownMembers.methods.push({
      name: "Destroy",
      summary: "Destroys the instance",
      tags: [],
      deprecationMessage: "",
      isDeprecated: false,
      inheritedFrom: "",
      threadSafety: "Unsafe",
      security: null,
    });

    axiosState.get
      .mockResolvedValueOnce({ data: "name: Actor" })
      .mockResolvedValueOnce({ data: "name: Instance" });
    (parseYamlToDocEntry as Mock).mockReturnValueOnce(child).mockReturnValueOnce(parent);

    const { fetchTopic } = await loadFetch();

    const entry = await fetchTopic("Actor");
    expect(entry.inheritedMembers[0]?.fromClass).toBe("Instance");
    expect(entry.inheritedMembers[0]?.methods[0]).toMatchObject({
      name: "Destroy",
      inheritedFrom: "Instance",
    });
  });

  it("fetchTopic reports a clear error when all categories 404", async () => {
    axiosState.get.mockRejectedValue(makeAxiosError(404));

    const { fetchTopic } = await loadFetch();

    await expect(fetchTopic("MissingTopic")).rejects.toThrow(
      'Topic "MissingTopic" not found in creator-docs reference.',
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
