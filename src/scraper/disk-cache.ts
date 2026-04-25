import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getEngineVersionHash } from "./fetch.js";

const CACHE_DIR = join(homedir(), ".cache", "rodocsmcp");
const TTL_MS = 24 * 60 * 60 * 1000;

interface DiskEntry<T> {
  value: T;
  expiresAt: number;
}

function makeCacheKey(topic: string): string {
  const hash = getEngineVersionHash();
  return createHash("sha256").update(`${topic}:${hash}`).digest("hex");
}

export class DiskCache<T> {
  async get(topic: string): Promise<T | undefined> {
    const key = makeCacheKey(topic);
    const filePath = join(CACHE_DIR, `${key}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      const entry = JSON.parse(raw) as DiskEntry<T>;
      if (Date.now() > entry.expiresAt) {
        await unlink(filePath).catch(() => undefined);
        return undefined;
      }
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set(topic: string, value: T): Promise<void> {
    const key = makeCacheKey(topic);
    const filePath = join(CACHE_DIR, `${key}.json`);
    const entry: DiskEntry<T> = { value, expiresAt: Date.now() + TTL_MS };
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(filePath, JSON.stringify(entry), "utf-8");
    } catch {
      // silently continue — memory cache still works
    }
  }
}
