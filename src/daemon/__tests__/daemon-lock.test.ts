import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireDaemonLock,
  removeStaleLock,
  resolveDaemonCacheDir,
  resolveDaemonLockPath,
} from "../daemon-lock.js";

describe("daemon lock", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("resolves cache and lock paths from RODOCS_CACHE_DIR", () => {
    const env = { RODOCS_CACHE_DIR: "/tmp/rodocs-cache" } as NodeJS.ProcessEnv;

    expect(resolveDaemonCacheDir(env).replace(/\\/g, "/")).toBe("/tmp/rodocs-cache");
    expect(resolveDaemonLockPath(env).replace(/\\/g, "/")).toBe("/tmp/rodocs-cache/daemon.lock");
  });

  it("acquires lock atomically and releases it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rodocs-lock-"));
    tempDirs.push(dir);
    const lockPath = join(dir, "daemon.lock");

    const lock = await acquireDaemonLock(lockPath, process.pid);
    expect(lock).not.toBeNull();
    await expect(readFile(lockPath, "utf8")).resolves.toContain(`"pid":${process.pid}`);
    await expect(acquireDaemonLock(lockPath, 456)).resolves.toBeNull();

    await lock?.release();
    await expect(acquireDaemonLock(lockPath, 456)).resolves.not.toBeNull();
  });

  it("removes stale locks with dead pids or invalid contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rodocs-lock-"));
    tempDirs.push(dir);
    const lockPath = join(dir, "daemon.lock");

    await writeFile(lockPath, JSON.stringify({ pid: 999_999_999 }));
    await expect(removeStaleLock(lockPath)).resolves.toBe(true);

    await writeFile(lockPath, "not json");
    await expect(removeStaleLock(lockPath)).resolves.toBe(true);
  });
});
