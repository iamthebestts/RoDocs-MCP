import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLI = ["--import", "tsx", "src/cli/index.ts"];
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const cliState = vi.hoisted(() => {
  const connect = vi.fn();

  class FakeTransport {}

  return {
    connect,
    FakeTransport,
    createServer: vi.fn(() => ({
      connect,
    })),
    scrapeTopic: vi.fn(),
    scrapeIndex: vi.fn(),
    findClosestApiName: vi.fn(),
    fetchGuide: vi.fn(),
    searchGuides: vi.fn(),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: cliState.FakeTransport,
}));

vi.mock("../../server/index.js", () => ({
  createServer: cliState.createServer,
}));

vi.mock("../../scraper/index.js", () => ({
  scrapeTopic: cliState.scrapeTopic,
  scrapeIndex: cliState.scrapeIndex,
  findClosestApiName: cliState.findClosestApiName,
}));

vi.mock("../../scraper/guides.js", () => ({
  fetchGuide: cliState.fetchGuide,
  searchGuides: cliState.searchGuides,
}));

function run(args: string[], timeoutMs = 20_000) {
  return spawnSync(process.execPath, [...CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

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

describe("cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints help output", () => {
    const result = run(["--help"]);

    expect(result.status).toBe(0);
    expect(stripAnsi(result.stdout)).toMatch(/USAGE/);
    expect(stripAnsi(result.stdout)).toMatch(/--find <query>/);
    expect(stripAnsi(result.stdout)).toMatch(/--github-token <t>/);
  }, 60_000);

  it("rejects a missing guide path", () => {
    const result = run(["--guide", ""]);

    expect(result.status).not.toBe(0);
    expect(stripAnsi(result.stderr)).toMatch(/--guide requires a path argument/);
  });

  it("rejects a missing search query", () => {
    const result = run(["--find", ""]);

    expect(result.status).not.toBe(0);
    expect(stripAnsi(result.stderr)).toMatch(/--find requires a query argument/);
  });

  it("passes an explicit github token to the stdio server", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    cliState.connect.mockResolvedValue(undefined);

    const { main } = await loadCli();
    await main(["--stdio", "--github-token", "pat-123"]);

    expect(cliState.createServer).toHaveBeenCalledWith({
      githubToken: "pat-123",
    });
    expect(cliState.connect).toHaveBeenCalledTimes(1);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("falls back to GITHUB_TOKEN for topic lookups", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    cliState.scrapeTopic.mockResolvedValue({
      ok: true,
      topic: "Actor",
      entry: createEntry("Actor"),
    });

    const { main } = await loadCli();
    await main(["Actor"], { GITHUB_TOKEN: "env-token" });

    expect(cliState.scrapeTopic).toHaveBeenCalledWith("Actor", "env-token");

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
