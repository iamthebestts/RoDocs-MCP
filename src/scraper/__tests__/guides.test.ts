import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const axiosState = vi.hoisted(() => {
  const state = {
    get: vi.fn(),
    create: vi.fn(() => ({
      get: state.get,
    })),
  };

  return state;
});

vi.mock("axios", () => ({
  default: {
    create: axiosState.create,
  },
  create: axiosState.create,
}));

function tree(entries: Array<{ path: string; type?: string }>) {
  return {
    data: {
      tree: entries,
    },
  };
}

async function loadGuides() {
  return import("../guides.js");
}

describe("guides", () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  it("fetchGuideIndex filters reference files and refreshes after ttl", async () => {
    let callCount = 0;
    axiosState.get.mockImplementation(async () => {
      callCount += 1;
      return callCount === 1
        ? tree([
            { path: "content/en-us/tutorials/save-player-data.md" },
            { path: "content/en-us/reference/classes/Actor.md" },
            { path: "content/en-us/scripting/task.md" },
            { path: "docs/ignore.md" },
          ])
        : tree([
            { path: "content/en-us/tutorials/new-guide.md" },
            { path: "content/en-us/scripting/task.md" },
          ]);
    });

    const { fetchGuideIndex } = await loadGuides();

    const first = await fetchGuideIndex();
    expect(first).toEqual([
      {
        path: "tutorials/save-player-data.md",
        title: "",
        description: "",
        category: "tutorials",
      },
      {
        path: "scripting/task.md",
        title: "",
        description: "",
        category: "scripting",
      },
    ]);

    const second = await fetchGuideIndex();
    expect(second).toBe(first);
    expect(axiosState.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    const third = await fetchGuideIndex();
    expect(axiosState.get).toHaveBeenCalledTimes(2);
    expect(third).not.toBe(first);
    expect(third[0]?.path).toBe("tutorials/new-guide.md");
  });

  it("searchGuides resolves Luau synonyms and ranks matches", async () => {
    axiosState.get.mockResolvedValue(
      tree([
        {
          path: "content/en-us/scripting/task.md",
        },
        {
          path: "content/en-us/tutorials/save-player-data.md",
        },
        {
          path: "content/en-us/tutorials/data-storage.md",
        },
      ]),
    );

    const { searchGuides } = await loadGuides();

    const results = await searchGuides("task.wait");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toBe("scripting/task.md");
  });

  it("fetchGuide hydrates frontmatter and caches the markdown", async () => {
    axiosState.get.mockImplementation(async (url: string) => {
      if (url.includes("git/trees")) {
        return tree([{ path: "content/en-us/tutorials/save-player-data.md" }]);
      }

      return {
        data: `---
title: Save Player Data
description: How to save player data
---
# Save Player Data
Body`,
      };
    });

    const { fetchGuide, fetchGuideIndex } = await loadGuides();
    const entries = await fetchGuideIndex();

    const first = await fetchGuide("tutorials/save-player-data.md");
    const second = await fetchGuide("tutorials/save-player-data.md");

    expect(first).toBe(second);
    expect(first.path).toBe("tutorials/save-player-data.md");
    expect(first.markdown).toContain("# Save Player Data");
    expect(entries[0]?.title).toBe("Save Player Data");
    expect(entries[0]?.description).toBe("How to save player data");
    expect(axiosState.get).toHaveBeenCalledTimes(2);
  });

  it("adds an Authorization header when a github token is provided", async () => {
    axiosState.get.mockResolvedValue(tree([]));

    const { fetchGuideIndex } = await loadGuides();
    await fetchGuideIndex("pat-123");

    expect(axiosState.get).toHaveBeenCalledWith(
      "https://api.github.com/repos/Roblox/creator-docs/git/trees/main?recursive=1",
      {
        headers: {
          Authorization: "Bearer pat-123",
        },
      },
    );
  });

  it("falls back to GITHUB_TOKEN for raw guide fetches", async () => {
    process.env.GITHUB_TOKEN = "env-token";
    axiosState.get.mockResolvedValue({ data: "# Guide" });

    const { fetchGuide } = await loadGuides();
    await fetchGuide("tutorials/save-player-data.md");

    expect(axiosState.get).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/tutorials/save-player-data.md",
      {
        headers: {
          Accept: "text/plain",
          Authorization: "Bearer env-token",
        },
      },
    );
  });
});
