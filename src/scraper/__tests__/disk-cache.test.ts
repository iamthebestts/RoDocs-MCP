import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => {
  const state = {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
    homedir: vi.fn(() => "C:/Users/test"),
    getEngineVersionHash: vi.fn(() => "engine-hash"),
  };

  return state;
});

vi.mock("node:fs/promises", () => ({
  mkdir: fsState.mkdir,
  readFile: fsState.readFile,
  unlink: fsState.unlink,
  writeFile: fsState.writeFile,
}));

vi.mock("node:os", () => ({
  homedir: fsState.homedir,
}));

vi.mock("../fetch.js", () => ({
  getEngineVersionHash: fsState.getEngineVersionHash,
}));

import { DiskCache } from "../disk-cache.js";

function cacheDir(): string {
  return join("C:/Users/test", ".cache", "rodocsmcp");
}

function cachePath(topic: string): string {
  const key = createHash("sha256").update(`${topic}:engine-hash`).digest("hex");
  return join(cacheDir(), `${key}.json`);
}

describe("DiskCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads cached entries from disk", async () => {
    const cache = new DiskCache<{ name: string }>();
    const entry = {
      value: { name: "DataStoreService" },
      expiresAt: Date.now() + 1000,
    };

    fsState.readFile.mockResolvedValue(JSON.stringify(entry));

    await expect(cache.get("DataStoreService")).resolves.toEqual(entry.value);
    expect(fsState.readFile).toHaveBeenCalledWith(cachePath("DataStoreService"), "utf-8");
  });

  it("returns undefined when reading fails", async () => {
    const cache = new DiskCache<{ name: string }>();

    fsState.readFile.mockRejectedValue(new Error("missing"));

    await expect(cache.get("DataStoreService")).resolves.toBeUndefined();
  });

  it("removes expired entries", async () => {
    const cache = new DiskCache<{ name: string }>();
    const entry = {
      value: { name: "DataStoreService" },
      expiresAt: Date.now() - 1,
    };

    fsState.readFile.mockResolvedValue(JSON.stringify(entry));
    fsState.unlink.mockResolvedValue(undefined);

    await expect(cache.get("DataStoreService")).resolves.toBeUndefined();
    expect(fsState.unlink).toHaveBeenCalledWith(cachePath("DataStoreService"));
  });

  it("creates the cache directory and writes entries", async () => {
    const cache = new DiskCache<{ name: string }>();

    fsState.mkdir.mockResolvedValue(undefined);
    fsState.writeFile.mockResolvedValue(undefined);

    await expect(
      cache.set("DataStoreService", { name: "DataStoreService" }),
    ).resolves.toBeUndefined();

    expect(fsState.mkdir).toHaveBeenCalledWith(cacheDir(), { recursive: true });
    expect(fsState.writeFile).toHaveBeenCalledTimes(1);

    const [filePath, raw, encoding] = fsState.writeFile.mock.calls[0] ?? [];
    expect(filePath).toBe(cachePath("DataStoreService"));
    expect(encoding).toBe("utf-8");

    const parsed = JSON.parse(String(raw));
    expect(parsed.value).toEqual({ name: "DataStoreService" });
    expect(parsed.expiresAt).toBe(Date.now() + 24 * 60 * 60 * 1000);
  });

  it("swallows io failures while writing", async () => {
    const cache = new DiskCache<{ name: string }>();

    fsState.mkdir.mockResolvedValue(undefined);
    fsState.writeFile.mockRejectedValue(new Error("disk full"));

    await expect(
      cache.set("DataStoreService", { name: "DataStoreService" }),
    ).resolves.toBeUndefined();
  });
});
