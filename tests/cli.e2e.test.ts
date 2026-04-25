import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const e2e = process.env.E2E === "true" ? describe : describe.skip;
const CLI = "node dist/cli.js";
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function run(args: string[], timeoutMs = 20_000) {
  const [cmd, ...rest] = CLI.split(" ");
  if (!cmd) {
    throw new Error("Invalid CLI");
  }
  return spawnSync(cmd, [...rest, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function extractFirstGuidePath(output: string): string | null {
  const lines = stripAnsi(output)
    .split("\n")
    .map((line) => line.trim());

  return lines.find((line) => /\.md$/i.test(line)) ?? null;
}

e2e("CLI e2e", { timeout: 30_000 }, () => {
  it("exits 0 for a valid topic", () => {
    const result = run(["DataStoreService"]);
    expect(result.status).toBe(0);
  });

  it("prints the requested class name", () => {
    const result = run(["DataStoreService"]);
    expect(stripAnsi(result.stdout)).toMatch(/DataStoreService/);
  });

  it("prints a methods or members section", () => {
    const result = run(["DataStoreService"]);
    expect(stripAnsi(result.stdout)).toMatch(/method|member|property|GetDataStore/i);
  });

  it("unknown topic exits non-zero and prints an error", () => {
    const result = run(["xXNotARealClassXx123"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("--find returns a closest match", () => {
    const result = run(["--find", "datastore"]);
    expect(result.status).toBe(0);
    expect(stripAnsi(result.stdout)).toMatch(/Closest match/i);
    expect(stripAnsi(result.stdout)).toMatch(/DataStore/i);
  });

  it("--search-guide returns guide results", () => {
    const result = run(["--search-guide", "save player data"]);
    expect(result.status).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toMatch(/GUIDES/i);
    expect(out).toMatch(/\.md|data|store|player/i);
  });

  it("--guide can fetch a guide path from search results", () => {
    const searchResult = run(["--search-guide", "data store"]);
    expect(searchResult.status).toBe(0);
    const path = extractFirstGuidePath(searchResult.stdout);
    expect(path).not.toBeNull();

    const guideResult = run(["--guide", path ?? ""]);
    expect(guideResult.status).toBe(0);
    expect(stripAnsi(guideResult.stdout)).toMatch(/GUIDE:/i);
    expect(stripAnsi(guideResult.stdout)).toMatch(/^(---|#)/m);
  });

  it("empty guide-search query exits non-zero", () => {
    const result = run(["--search-guide", ""]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("--list exits 0 and lists known classes", () => {
    const result = run(["--list"]);
    expect(result.status).toBe(0);
    expect(stripAnsi(result.stdout)).toMatch(/DataStoreService|RunService|TweenService/);
  });
});
