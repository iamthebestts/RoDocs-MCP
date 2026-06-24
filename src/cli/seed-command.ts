import type { SeedProgressReporter } from "../seed/progress.js";
import { openSeedContext, type SeedContext } from "./seed-context.js";
import { createCliSeedProgressReporter } from "./seed-progress.js";
import { seedDevforum, seedDocs, seedFastflags, seedGuides } from "./seed-runner.js";

export type SeedCommandIo = {
  writeStdout: (line: string) => void;
  writeStderr: (line: string) => void;
  exit: (code: number) => void;
};

const defaultIo: SeedCommandIo = {
  writeStdout: (line) => {
    process.stdout.write(line);
  },
  writeStderr: (line) => {
    process.stderr.write(line);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export type RunSeedCommandOptions = {
  source: string;
  failureLabel: string;
  githubToken: string | undefined;
  run: (
    ctx: SeedContext,
    progress: SeedProgressReporter,
    githubToken: string | undefined,
  ) => Promise<void>;
  formatSuccess: (ctx: SeedContext) => string;
  io?: Partial<SeedCommandIo>;
  openContext?: () => Promise<SeedContext>;
  createProgress?: (source: string) => SeedProgressReporter;
};

function resolveIo(partial?: Partial<SeedCommandIo>): SeedCommandIo {
  return {
    writeStdout: partial?.writeStdout ?? defaultIo.writeStdout,
    writeStderr: partial?.writeStderr ?? defaultIo.writeStderr,
    exit: partial?.exit ?? defaultIo.exit,
  };
}

export async function runSeedCommand(options: RunSeedCommandOptions): Promise<void> {
  const io = resolveIo(options.io);
  const openContext = options.openContext ?? openSeedContext;
  const createProgress = options.createProgress ?? createCliSeedProgressReporter;

  const progress = createProgress(options.source);
  try {
    progress.onPhase("store", "opening local cache");
    const ctx = await openContext();
    await options.run(ctx, progress, options.githubToken);
    io.writeStdout(options.formatSuccess(ctx));
    await ctx.store.close();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeStderr(`Failed to seed ${options.failureLabel}: ${message}\n`);
    io.exit(1);
  }
}

export type RunSeedAllCommandOptions = {
  githubToken: string | undefined;
  formatSuccess?: () => string;
  io?: Partial<SeedCommandIo>;
  openContext?: () => Promise<SeedContext>;
  createProgress?: (source: string) => SeedProgressReporter;
  runDocs?: (
    ctx: SeedContext,
    progress: SeedProgressReporter,
    githubToken: string | undefined,
  ) => Promise<void>;
  runGuides?: (
    ctx: SeedContext,
    progress: SeedProgressReporter,
    githubToken: string | undefined,
  ) => Promise<void>;
  runFastflags?: (
    ctx: SeedContext,
    progress: SeedProgressReporter,
    githubToken: string | undefined,
  ) => Promise<{ added: number; updated: number }>;
  runDevforum?: (ctx: SeedContext, progress: SeedProgressReporter) => Promise<unknown>;
};

export async function runSeedAllCommand(options: RunSeedAllCommandOptions): Promise<void> {
  const io = resolveIo(options.io);
  const openContext = options.openContext ?? openSeedContext;
  const createProgress = options.createProgress ?? createCliSeedProgressReporter;
  const runDocs =
    options.runDocs ??
    ((ctx, progress, token) => seedDocs(ctx.store, ctx.syncManager, token, progress));
  const runGuides =
    options.runGuides ??
    ((ctx, progress, token) => seedGuides(ctx.store, ctx.syncManager, token, progress));
  const runFastflags =
    options.runFastflags ??
    ((ctx, progress, token) =>
      seedFastflags(ctx.store, ctx.syncManager, ctx.indexer, token, progress));
  const runDevforum =
    options.runDevforum ??
    ((ctx, progress) => seedDevforum(ctx.store, ctx.syncManager, ctx.indexer, progress));

  const progress = createProgress("all");
  try {
    progress.onPhase("store", "opening local cache");
    const ctx = await openContext();

    await runDocs(ctx, progress, options.githubToken);
    await runGuides(ctx, progress, options.githubToken);
    await runFastflags(ctx, progress, options.githubToken);
    await runDevforum(ctx, progress);

    io.writeStdout(options.formatSuccess?.() ?? "Successfully completed all seeds.\n");
    await ctx.store.close();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeStderr(`Failed during --seed-all: ${message}\n`);
    io.exit(1);
  }
}
