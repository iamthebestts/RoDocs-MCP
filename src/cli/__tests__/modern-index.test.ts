import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliState = vi.hoisted(() => {
  const connect = vi.fn();

  class FakeTransport {}

  return {
    connect,
    FakeTransport,
    createServer: vi.fn(() => ({
      server: {
        connect,
      },
      scheduler: {},
      shutdown: vi.fn(),
    })),
    scrapeTopic: vi.fn(),
    scrapeIndex: vi.fn(),
    findClosestApiName: vi.fn(),
    fetchGuide: vi.fn(),
    fetchGuideIndex: vi.fn(),
    searchGuides: vi.fn(),
    runDaemonClient: vi.fn(),
    startDaemonServer: vi.fn(),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: cliState.FakeTransport,
}));

vi.mock("../../server/index.js", () => ({
  createServer: cliState.createServer,
}));

vi.mock("../../daemon/index.js", () => ({
  runDaemonClient: cliState.runDaemonClient,
  startDaemonServer: cliState.startDaemonServer,
}));

vi.mock("../../scraper/index.js", () => ({
  scrapeTopic: cliState.scrapeTopic,
  scrapeIndex: cliState.scrapeIndex,
  findClosestApiName: cliState.findClosestApiName,
}));

vi.mock("../../scraper/guides.js", () => ({
  fetchGuide: cliState.fetchGuide,
  fetchGuideIndex: cliState.fetchGuideIndex,
  searchGuides: cliState.searchGuides,
}));

function createEntry(name: string) {
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

async function loadCli() {
  return import("../index.js");
}

describe("modern cli commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts stdio server through serve", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    cliState.connect.mockResolvedValue(undefined);

    const { main } = await loadCli();
    await main(["serve"]);

    expect(cliState.createServer).toHaveBeenCalledTimes(1);
    expect(cliState.connect).toHaveBeenCalledTimes(1);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("routes api get/list/find commands", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    cliState.scrapeTopic.mockResolvedValue({
      ok: true,
      topic: "TweenService",
      entry: createEntry("TweenService"),
    });
    cliState.scrapeIndex.mockResolvedValue({
      ok: true,
      classes: ["Actor"],
      datatypes: [],
      enums: [],
      globals: [],
      libraries: [],
    });
    cliState.findClosestApiName.mockResolvedValue("TweenService");

    const { main } = await loadCli();
    await main(["api", "get", "TweenService"]);
    await main(["api", "list"]);
    await main(["api", "find", "tweenserv"]);

    expect(cliState.scrapeTopic).toHaveBeenCalledWith("TweenService", undefined);
    expect(cliState.scrapeIndex).toHaveBeenCalledWith(undefined);
    expect(cliState.findClosestApiName).toHaveBeenCalledWith("tweenserv", undefined);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("routes guides search/get/list commands", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    cliState.searchGuides.mockResolvedValue([
      {
        path: "tutorials/save-player-data.md",
        title: "Save player data",
        description: "",
        category: "tutorials",
      },
    ]);
    cliState.fetchGuide.mockResolvedValue({
      path: "tutorials/save-player-data.md",
      markdown: "# Save player data",
    });
    cliState.fetchGuideIndex.mockResolvedValue([
      {
        path: "tutorials/save-player-data.md",
        title: "",
        description: "",
        category: "tutorials",
      },
    ]);

    const { main } = await loadCli();
    await main(["guides", "search", "data"]);
    await main(["guides", "get", "tutorials/save-player-data.md"]);
    await main(["guides", "list", "--json"]);

    expect(cliState.searchGuides).toHaveBeenCalledWith("data", undefined);
    expect(cliState.fetchGuide).toHaveBeenCalledWith("tutorials/save-player-data.md", undefined);
    expect(cliState.fetchGuideIndex).toHaveBeenCalledWith(undefined);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("prints version for --version and version command", async () => {
    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const { main } = await loadCli();
    await main(["--version"]);
    await main(["version"]);

    expect(writes).toEqual(["2.0.0\n", "2.0.0\n"]);
    stdoutSpy.mockRestore();
  });
});
