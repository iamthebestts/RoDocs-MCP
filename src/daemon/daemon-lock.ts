import { constants, existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DaemonLock {
  path: string;
  pid: number;
  release: () => Promise<void>;
}

export function resolveDaemonCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.RODOCS_CACHE_DIR ?? join(homedir(), ".cache", "rodocsmcp");
}

export function resolveDaemonLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDaemonCacheDir(env), "daemon.lock");
}

export async function acquireDaemonLock(
  lockPath = resolveDaemonLockPath(),
  pid = process.pid,
): Promise<DaemonLock | null> {
  await mkdir(dirname(lockPath), { recursive: true });
  await removeStaleLock(lockPath);

  try {
    const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.writeFile(JSON.stringify({ pid, createdAt: Date.now() }));
    await handle.close();
    return {
      path: lockPath,
      pid,
      release: async () => {
        await rm(lockPath, { force: true });
      },
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") return null;
    throw error;
  }
}

export async function removeStaleLock(lockPath = resolveDaemonLockPath()): Promise<boolean> {
  if (!existsSync(lockPath)) return false;

  const pid = await readLockPid(lockPath);
  if (pid === null || !isProcessAlive(pid)) {
    await rm(lockPath, { force: true });
    return true;
  }
  return false;
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const text = await readFile(lockPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.pid === "number") return record.pid;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
