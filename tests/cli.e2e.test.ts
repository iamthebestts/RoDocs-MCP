import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const e2e = process.env.E2E === "true" ? describe : describe.skip;
const CLI = "node dist/cli.js";
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

type RunResult = ReturnType<typeof spawnSync>;

const runCache = new Map<string, RunResult>();

function run(args: string[], timeoutMs = 20_000): RunResult {
  const key = JSON.stringify(args);
  const cached = runCache.get(key);
  if (cached) return cached;

  const [cmd, ...rest] = CLI.split(" ");
  if (!cmd) throw new Error("Invalid CLI");

  const result = spawnSync(cmd, [...rest, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
  });

  runCache.set(key, result);
  return result;
}

function str(value: string | NodeJS.ArrayBufferView): string {
  if (typeof value === "string") return value;

  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
    "utf8",
  );
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function extractFirstGuidePath(output: string): string | null {
  return (
    stripAnsi(output)
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /\.md$/i.test(l)) ?? null
  );
}

e2e("CLI e2e", { timeout: 30_000 }, () => {
  it("DataStoreService: exits 0, prints class name and members section", () => {
    const { status, stdout } = run(["DataStoreService"]);
    const out = stripAnsi(str(stdout));
    expect(status).toBe(0);
    expect(out).toMatch(/DataStoreService/);
    expect(out).toMatch(/method|member|property|GetDataStore/i);
  });

  it("unknown topic: exits non-zero and writes to stderr", () => {
    const { status, stderr } = run(["xXNotARealClassXx123"]);
    expect(status).not.toBe(0);
    expect(str(stderr).length).toBeGreaterThan(0);
  });

  it("--find: exits 0 and returns closest match for 'datastore'", () => {
    const { status, stdout } = run(["--find", "datastore"]);
    const out = stripAnsi(str(stdout));
    expect(status).toBe(0);
    expect(out).toMatch(/Closest match/i);
    expect(out).toMatch(/DataStore/i);
  });

  it("--search-guide: exits 0 and returns guide results for 'save player data'", () => {
    const { status, stdout } = run(["--search-guide", "save player data"]);
    const out = stripAnsi(str(stdout));
    expect(status).toBe(0);
    expect(out).toMatch(/GUIDES/i);
    expect(out).toMatch(/\.md|data|store|player/i);
  });

  it("--guide: fetches a guide from --search-guide path", () => {
    const searchResult = run(["--search-guide", "data store"]);
    expect(searchResult.status).toBe(0);

    const path = extractFirstGuidePath(str(searchResult.stdout));
    expect(path).not.toBeNull();

    const { status, stdout } = run(["--guide", path ?? ""]);
    const out = stripAnsi(str(stdout));
    expect(status).toBe(0);
    expect(out).toMatch(/GUIDE:/i);
    expect(out).toMatch(/^(---|#)/m);
  });

  it("--search-guide with empty query: exits non-zero and writes to stderr", () => {
    const { status, stderr } = run(["--search-guide", ""]);
    expect(status).not.toBe(0);
    expect(str(stderr).length).toBeGreaterThan(0);
  });

  it("--list: exits 0 and lists known classes", () => {
    const { status, stdout } = run(["--list"]);
    expect(status).toBe(0);
    expect(stripAnsi(str(stdout))).toMatch(
      /DataStoreService|RunService|TweenService/,
    );
  });
});
