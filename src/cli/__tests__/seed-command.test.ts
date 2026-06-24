import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeedProgressReporter } from "../../seed/progress.js";
import { runSeedAllCommand, runSeedCommand } from "../seed-command.js";
import type { SeedContext } from "../seed-context.js";

function makeContext(): SeedContext {
  return {
    store: { close: vi.fn(async () => undefined) } as unknown as SeedContext["store"],
    syncManager: {} as SeedContext["syncManager"],
    indexer: {} as SeedContext["indexer"],
  };
}

function makeIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | null = null;
  return {
    stdout,
    stderr,
    get exitCode() {
      return exitCode;
    },
    io: {
      writeStdout: (line: string) => {
        stdout.push(line);
      },
      writeStderr: (line: string) => {
        stderr.push(line);
      },
      exit: (code: number) => {
        exitCode = code;
      },
    },
  };
}

describe("runSeedCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens context, runs seed, prints success, and closes store", async () => {
    const ctx = makeContext();
    const { stdout, io } = makeIo();
    const progress: SeedProgressReporter = {
      onPhase: vi.fn(),
      onStep: vi.fn(),
      onNote: vi.fn(),
    };

    await runSeedCommand({
      source: "docs",
      failureLabel: "docs",
      githubToken: "token",
      io,
      openContext: async () => ctx,
      createProgress: () => progress,
      run: async () => {},
      formatSuccess: () => "Successfully seeded API docs index.\n",
    });

    expect(progress.onPhase).toHaveBeenCalledWith("store", "opening local cache");
    expect(ctx.store.close).toHaveBeenCalledOnce();
    expect(stdout.some((line) => line.includes("Successfully seeded API docs index."))).toBe(true);
  });

  it("writes failure message and exits with code 1 on error", async () => {
    const handles = makeIo();

    await runSeedCommand({
      source: "guides",
      failureLabel: "guides",
      githubToken: undefined,
      io: handles.io,
      openContext: async () => {
        throw new Error("disk full");
      },
      createProgress: () => ({
        onPhase: () => {},
        onStep: () => {},
        onNote: () => {},
      }),
      run: async () => {},
      formatSuccess: () => "\n",
    });

    expect(handles.stderr.some((line) => line.includes("Failed to seed guides"))).toBe(true);
    expect(handles.stderr.some((line) => line.includes("disk full"))).toBe(true);
    expect(handles.exitCode).toBe(1);
  });
});

describe("runSeedAllCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs all seeds with a single shared progress reporter", async () => {
    const ctx = makeContext();
    const { stdout, io } = makeIo();
    const progressInstances: SeedProgressReporter[] = [];
    const runs: string[] = [];

    await runSeedAllCommand({
      githubToken: "token",
      io,
      openContext: async () => ctx,
      createProgress: (source) => {
        const reporter: SeedProgressReporter = {
          onPhase: vi.fn(),
          onStep: vi.fn(),
          onNote: vi.fn(),
        };
        progressInstances.push(reporter);
        expect(source).toBe("all");
        return reporter;
      },
      runDocs: async () => {
        runs.push("docs");
      },
      runGuides: async () => {
        runs.push("guides");
      },
      runFastflags: async () => {
        runs.push("fastflags");
        return { added: 1, updated: 2 };
      },
      runDevforum: async () => {
        runs.push("devforum");
      },
      formatSuccess: () => "Successfully completed all seeds.\n",
    });

    expect(progressInstances).toHaveLength(1);
    expect(runs).toEqual(["docs", "guides", "fastflags", "devforum"]);
    expect(stdout.some((line) => line.includes("Successfully completed all seeds"))).toBe(true);
    expect(ctx.store.close).toHaveBeenCalledOnce();
  });
});
