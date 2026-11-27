import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runDaemonClient, startDaemonServer } from "../daemon/index.js";
import { MetricsCollector } from "../metrics/collector.js";
import { formatMetricsReport } from "../metrics/reporter.js";
import type {
  CodeSample,
  InheritedGroup,
  OwnMembers,
  RichMember,
  RobloxDocEntry,
} from "../scraper/fetch.js";
import { fetchGuide, fetchGuideIndex, searchGuides } from "../scraper/guides.js";
import { findClosestApiName, scrapeIndex, scrapeTopic } from "../scraper/index.js";
import { createEmbeddingIndexer, type SeedRunOptions } from "../seed/runners.js";
import { CACHE_SEED_SOURCES, readCacheStatus } from "../seed/status.js";
import { createServer } from "../server/index.js";
import { storeDelByPrefix } from "../store/index.js";
import { parseGithubTokenArgs } from "../utils/github-token.js";
import { _setMetricsSink } from "../utils/logger.js";
import { APP_VERSION } from "../utils/version.js";
import { runSeedAllCommand, runSeedCommand } from "./seed-command.js";
import { openSeedContext } from "./seed-context.js";
import { createCliSeedProgressReporter } from "./seed-progress.js";
import { seedDevforum, seedDocs, seedFastflags, seedGuides } from "./seed-runner.js";
import { runSetup } from "./setup.js";

const W = 76;
const HR = "─".repeat(W);
const HR_THIN = "╌".repeat(W);

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgDark: "\x1b[48;5;236m",
} as const;

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`;
}

function bold(text: string): string {
  return `${C.bold}${text}${C.reset}`;
}

function dim(text: string): string {
  return `${C.dim}${text}${C.reset}`;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function shouldBuildSeedEmbeddings(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return (
    !args.includes("--no-embed") &&
    !args.includes("--skip-embeddings") &&
    !isTruthyEnv(env.RODOCS_SKIP_EMBEDDINGS)
  );
}

function createSeedIo() {
  return {
    writeStdout: (line: string) => {
      process.stdout.write(line);
    },
    writeStderr: (line: string) => {
      process.stderr.write(`${c("red", "✖")} ${line}`);
    },
    exit: (code: number) => {
      process.exit(code);
    },
  };
}

function boxTop(label: string, color: keyof typeof C = "cyan"): string {
  const inner = ` ${label} `;
  const fill = Math.max(0, W - inner.length - 1);
  return c(color, `┌${inner}${"─".repeat(fill)}┐`);
}

function boxRow(text: string, color: keyof typeof C = "cyan"): string {
  const content = ` ${text}`;
  const fill = Math.max(0, W - content.length - 1);
  return `${c(color, "│")}${content}${" ".repeat(fill)}${c(color, "│")}`;
}

function boxBottom(color: keyof typeof C = "cyan"): string {
  return c(color, `└${"─".repeat(W)}┘`);
}

function wrap(text: string, indent: string, width = W): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return `${indent}${dim("(no description)")}`;
  const maxW = width - indent.length;
  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (cur.length + word.length + 1 > maxW && cur.length > 0) {
      lines.push(indent + cur.trimEnd());
      cur = `${word} `;
    } else {
      cur += `${word} `;
    }
  }
  if (cur.trim()) lines.push(indent + cur.trimEnd());
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function section(title: string, count?: number): string {
  const num = count !== undefined ? ` ${dim(`(${count})`)}` : "";
  return `\n${bold(c("cyan", title))}${num}\n${c("gray", HR)}`;
}

const KIND_COLOR: Record<string, keyof typeof C> = {
  Property: "green",
  Function: "blue",
  Event: "magenta",
  Callback: "yellow",
};

function kindBadge(kind: string): string {
  const color = (KIND_COLOR[kind] ?? "white") as keyof typeof C;
  return c(color, `[${kind.slice(0, 4).toUpperCase()}]`);
}

function formatParam(p: unknown): string {
  const param = p as Record<string, unknown>;
  const name =
    typeof param.Name === "string" ? param.Name : typeof param.name === "string" ? param.name : "?";
  const type =
    typeof param.Type === "object" && param.Type !== null
      ? (((param.Type as Record<string, unknown>).Name as string | undefined) ?? "unknown")
      : typeof param.type === "string"
        ? param.type
        : "unknown";
  const def = param.Default ?? param.default;
  const defStr = typeof def === "string" ? dim(` = ${def}`) : "";
  return `${c("white", name)}: ${c("yellow", type)}${defStr}`;
}

function formatMember(m: RichMember, kind: string): string {
  const badge = kindBadge(kind);
  const dep = m.isDeprecated ? ` ${c("red", "⚠ deprecated")}` : "";
  const inherited = m.inheritedFrom ? ` ${dim(`↑ ${m.inheritedFrom}`)}` : "";

  const nameLine = `  ${badge} ${bold(m.name)}${dep}${inherited}`;

  const parts: string[] = [nameLine];

  if (m.summary) {
    parts.push(`     ${dim(truncate(m.summary, W - 5))}`);
  }

  if (m.type !== undefined) {
    parts.push(`     ${dim("type:")} ${c("yellow", m.type)}`);
  }

  if (Array.isArray(m.parameters) && m.parameters.length > 0) {
    const paramStr = m.parameters.map(formatParam).join(dim(", "));
    parts.push(`     ${dim("params:")} ${paramStr}`);
  }

  if (m.returns !== undefined) {
    parts.push(`     ${dim("returns:")} ${c("green", m.returns)}`);
  }

  if (m.threadSafety && m.threadSafety !== "Unsafe") {
    parts.push(`     ${dim(`thread: ${m.threadSafety}`)}`);
  }

  return parts.join("\n");
}

function formatMemberGroup(label: string, kind: string, members: RichMember[]): string {
  if (members.length === 0) return "";
  const lines: string[] = [section(label, members.length)];
  for (const m of members) {
    lines.push(formatMember(m, kind));
    lines.push(c("gray", `  ${HR_THIN}`));
  }
  return lines.join("\n");
}

function formatOwnMembers(own: OwnMembers): string {
  return [
    formatMemberGroup("Properties", "Property", own.properties),
    formatMemberGroup("Methods", "Function", own.methods),
    formatMemberGroup("Events", "Event", own.events),
    formatMemberGroup("Callbacks", "Callback", own.callbacks),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatInherited(groups: InheritedGroup[]): string {
  const nonEmpty = groups.filter(
    (g) => g.properties.length + g.methods.length + g.events.length + g.callbacks.length > 0,
  );
  if (nonEmpty.length === 0) return "";

  const lines: string[] = [section("Inherited Members")];
  for (const g of nonEmpty) {
    lines.push(`\n  ${c("magenta", "▸")} ${bold(`from ${g.fromClass}`)}`);
    lines.push(formatMemberGroup("  Properties", "Property", g.properties));
    lines.push(formatMemberGroup("  Methods", "Function", g.methods));
    lines.push(formatMemberGroup("  Events", "Event", g.events));
    lines.push(formatMemberGroup("  Callbacks", "Callback", g.callbacks));
  }
  return lines.join("\n");
}

function formatCodeSample(s: CodeSample, index: number): string {
  const title = s.displayName || s.identifier || `Sample ${index + 1}`;
  const codeLines = s.code.split("\n");
  const preview = codeLines.slice(0, 25);
  const truncated = codeLines.length > 25;

  const lines: string[] = [`\n  ${c("cyan", "◆")} ${bold(title)} ${dim(`(${s.language})`)}`];
  if (s.description) lines.push(`  ${dim(truncate(s.description, W - 2))}`);
  lines.push(`  ${c("gray", `┌${"─".repeat(W - 4)}┐`)}`);
  for (const line of preview) {
    const padded = line.length > W - 6 ? `${line.slice(0, W - 9)}…` : line;
    lines.push(`  ${c("gray", "│")} ${c("green", padded)}`);
  }
  if (truncated) {
    lines.push(`  ${c("gray", "│")} ${dim(`… ${codeLines.length - 25} more lines`)}`);
  }
  lines.push(`  ${c("gray", `└${"─".repeat(W - 4)}┘`)}`);
  return lines.join("\n");
}

function formatEntry(entry: RobloxDocEntry): string {
  const cl = entry.class;
  const parts: string[] = [];
  const depFlag = cl.deprecationMessage ? ` ${c("red", "⚠ DEPRECATED")}` : "";
  parts.push(boxTop(`CLASS: ${cl.name}${depFlag}`, "cyan"));

  if (cl.inherits.length > 0) {
    parts.push(boxRow(`Inherits: ${c("yellow", cl.inherits.join(", "))}`, "cyan"));
  } else {
    parts.push(boxRow(dim("No superclass"), "cyan"));
  }

  if (cl.descendants.length > 0) {
    parts.push(boxRow(`Descendants: ${dim(truncate(cl.descendants.join(", "), W - 16))}`, "cyan"));
  }

  if (cl.tags.length > 0) {
    parts.push(boxRow(`Tags: ${dim(cl.tags.join(", "))}`, "cyan"));
  }

  const totalOwn =
    cl.ownMembers.properties.length +
    cl.ownMembers.methods.length +
    cl.ownMembers.events.length +
    cl.ownMembers.callbacks.length;

  const totalInherited = entry.inheritedMembers.reduce(
    (acc, g) => acc + g.properties.length + g.methods.length + g.events.length + g.callbacks.length,
    0,
  );

  parts.push(
    boxRow(
      `Members: ${c("green", String(totalOwn))} own  ${c("gray", String(totalInherited))} inherited`,
      "cyan",
    ),
  );
  parts.push(boxBottom("cyan"));

  const desc = cl.description || cl.summary;
  if (desc) {
    parts.push(section("Description"));
    parts.push(wrap(desc, "  "));
  }

  if (cl.deprecationMessage) {
    parts.push(`\n  ${c("red", "⚠")}  ${c("yellow", cl.deprecationMessage)}`);
  }

  if (cl.codeSamples.length > 0) {
    parts.push(section("Code Samples", cl.codeSamples.length));
    for (let i = 0; i < cl.codeSamples.length; i++) {
      const s = cl.codeSamples[i];
      if (s !== undefined) parts.push(formatCodeSample(s, i));
    }
  }

  const ownStr = formatOwnMembers(cl.ownMembers);
  if (ownStr) parts.push(ownStr);

  const inhStr = formatInherited(entry.inheritedMembers);
  if (inhStr) parts.push(inhStr);

  parts.push(`\n${c("gray", HR)}\n`);

  return parts.join("\n");
}

// ! Guide formatters

function formatGuideSearch(results: Awaited<ReturnType<typeof searchGuides>>): string {
  if (results.length === 0) {
    return `\n${c("yellow", "✖")} No guides found.\n`;
  }

  const lines: string[] = [
    "",
    `${bold(c("cyan", "GUIDES"))} ${dim(`(${results.length} results)`)}`,
    c("gray", HR),
  ];

  for (const r of results) {
    lines.push(`  ${bold(c("green", r.path))}`);
    if (r.title) lines.push(`  ${c("white", r.title)}`);
    if (r.description) lines.push(`  ${dim(truncate(r.description, W - 2))}`);
    lines.push(`  ${dim(`category: ${r.category}`)}`);
    lines.push(c("gray", `  ${HR_THIN}`));
  }

  return `${lines.join("\n")}\n`;
}

function formatGuideContent(path: string, markdown: string): string {
  const lines: string[] = [];
  lines.push(boxTop(`GUIDE: ${path}`, "green"));
  lines.push(boxBottom("green"));
  lines.push("");

  const mdLines = markdown.split("\n");
  const preview = mdLines.slice(0, 60);
  const truncated = mdLines.length > 60;

  for (const line of preview) {
    if (line.startsWith("# ")) {
      lines.push(bold(c("cyan", line)));
    } else if (line.startsWith("## ")) {
      lines.push(c("yellow", line));
    } else if (line.startsWith("### ")) {
      lines.push(c("green", line));
    } else if (line.startsWith("```")) {
      lines.push(c("gray", line));
    } else {
      lines.push(line);
    }
  }

  if (truncated) {
    lines.push("");
    lines.push(dim(`… ${mdLines.length - 60} more lines (use get_guide tool for full content)`));
  }

  lines.push(`\n${c("gray", HR)}\n`);
  return lines.join("\n");
}

// ! Help

function printHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocsmcp")) + dim(" — Roblox Creator Hub API reference & MCP server"),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocs")} ${c("yellow", "serve")} ${dim("[--stdio | --daemon | --client]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "setup <provider>")} ${dim("[--local] [--daemon]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "api <command>")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "guides <command>")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed <source>")} ${dim("[--no-embed]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "cache <command>")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "doctor")}`,
      "",
      bold("COMMON COMMANDS"),
      `  ${c("green", "rodocs")} ${c("yellow", "api get TweenService")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "api find tweenserv")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "api list")}`,
      `  ${c("green", "rodocs")} ${c("yellow", 'guides search "data store"')}`,
      `  ${c("green", "rodocs")} ${c("yellow", "guides get scripting/data/data-stores.md")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed fastflags --no-embed")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "cache status")}`,
      "",
      bold("GLOBAL OPTIONS"),
      `  ${c("yellow", "--github-token <token>")}    Authenticate GitHub requests`,
      `  ${c("yellow", "--json")}                    Print machine-readable output where supported`,
      `  ${c("yellow", "--help")} ${dim("| -h")}                Show help`,
      "",
      bold("HELP TOPICS"),
      `  ${c("green", "rodocs")} ${c("yellow", "help api")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "help guides")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "help seed")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "help cache")}`,

      "",
      dim(
        "Legacy aliases like rodocsmcp --list, --find, --guide, and --seed-fastflags still work.",
      ),

      "",
    ].join("\n"),
  );
}

function printApiHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocs api")),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocs")} ${c("yellow", "api get <name>")} ${dim("[--json]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "api list")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "api find <query>")}`,
      "",
    ].join("\n"),
  );
}

function printGuidesHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocs guides")),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocs")} ${c("yellow", "guides search <query>")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "guides get <path>")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "guides list")} ${dim("[--json]")}`,
      "",
    ].join("\n"),
  );
}

function printSeedHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocs seed")),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocs")} ${c("yellow", "seed docs")} ${dim("[--no-embed]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed guides")} ${dim("[--no-embed]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed fastflags")} ${dim("[--no-embed]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed devforum")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "seed all")} ${dim("[--no-embed]")}`,
      "",
      bold("OPTIONS"),
      `  ${c("yellow", "--no-embed")} ${dim("| --skip-embeddings")}    Skip vector embedding generation`,
      `  ${c("yellow", "RODOCS_SKIP_EMBEDDINGS=true")}       Environment equivalent`,
      "",
    ].join("\n"),
  );
}

function printCacheHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocs cache")),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocs")} ${c("yellow", "cache status")} ${dim("[--json]")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "cache path")}`,
      `  ${c("green", "rodocs")} ${c("yellow", "cache clear")} ${dim("[all | docs | guides | fastflags | devforum]")}`,
      "",
    ].join("\n"),
  );
}

// ! Modes

async function runMcpServer(githubToken?: string): Promise<void> {
  const { server, shutdown } = githubToken ? createServer({ githubToken }) : createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("rodocsmcp MCP server ready (stdio)\n");

  const intervalMs = Number(process.env.METRICS_INTERVAL_MS ?? 300_000);
  let metricsTimer: ReturnType<typeof setInterval> | undefined;
  if (intervalMs > 0) {
    metricsTimer = setInterval(() => {
      const snap = MetricsCollector.getInstance().snapshot();
      process.stderr.write(`[METRICS] ${JSON.stringify(snap)}\n`);
    }, intervalMs);
    metricsTimer.unref();
  }

  process.on("SIGINT", () => {
    if (metricsTimer) clearInterval(metricsTimer);
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    if (metricsTimer) clearInterval(metricsTimer);
    shutdown();
    process.exit(0);
  });
}

async function runDaemonMode(githubToken?: string): Promise<void> {
  const daemon =
    githubToken === undefined
      ? await startDaemonServer()
      : await startDaemonServer({ githubToken });

  const shutdown = async () => {
    await daemon.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

async function runClientMode(githubToken?: string): Promise<void> {
  await runDaemonClient({
    fallback: () => runMcpServer(githubToken),
    ...(githubToken === undefined ? {} : { githubToken }),
  });
}

async function runTopicCli(topic: string, githubToken?: string, jsonOutput = false): Promise<void> {
  process.stderr.write(`${dim(`Fetching "${topic}"...`)}\n`);
  try {
    const result = await scrapeTopic(topic, githubToken);
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result.entry, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatEntry(result.entry)}\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const suggestion = await findClosestApiName(topic, githubToken).catch(() => null);
    if (jsonOutput) {
      process.stdout.write(
        `${JSON.stringify({ error: message, suggestion: suggestion ?? undefined }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`${c("red", "✖")} ${message}\n`);
      if (suggestion !== null) {
        process.stderr.write(`${c("yellow", "?")} Did you mean: ${bold(c("cyan", suggestion))}?\n`);
      }
    }
    process.exit(1);
  }
}

async function runListCli(githubToken?: string): Promise<void> {
  process.stderr.write(`${dim("Fetching API index...")}\n`);
  const result = await scrapeIndex(githubToken);

  const lines: string[] = [
    "",
    `${bold(c("cyan", `CLASSES`))} ${dim(`(${result.classes.length})`)}`,
    c("gray", HR),
    ...result.classes.map((n) => `  ${n}`),
    "",
    `${bold(c("blue", `DATATYPES`))} ${dim(`(${result.datatypes.length})`)}`,
    c("gray", HR),
    ...result.datatypes.map((n) => `  ${n}`),
    "",
    `${bold(c("magenta", `ENUMS`))} ${dim(`(${result.enums.length})`)}`,
    c("gray", HR),
    ...result.enums.map((n) => `  ${n}`),
    "",
    `${bold(c("yellow", `GLOBALS`))} ${dim(`(${result.globals.length})`)}`,
    c("gray", HR),
    ...result.globals.map((n) => `  ${n}`),
    "",
    `${bold(c("green", `LIBRARIES`))} ${dim(`(${result.libraries.length})`)}`,
    c("gray", HR),
    ...result.libraries.map((n) => `  ${n}`),
    "",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function runFindCli(query: string, githubToken?: string): Promise<void> {
  process.stderr.write(`${dim(`Searching for "${query}"...`)}\n`);
  const match = await findClosestApiName(query, githubToken);
  if (match !== null) {
    process.stdout.write(`${c("green", "✔")} Closest match: ${bold(c("cyan", match))}\n`);
  } else {
    process.stdout.write(`${c("yellow", "✖")} No match found for "${query}".\n`);
  }
}

async function runGuideSearchCli(query: string, githubToken?: string): Promise<void> {
  process.stderr.write(`${dim(`Searching guides for "${query}"...`)}\n`);
  const results = await searchGuides(query, githubToken);
  process.stdout.write(formatGuideSearch(results));
}

async function runGuideListCli(githubToken?: string, jsonOutput = false): Promise<void> {
  process.stderr.write(`${dim("Fetching guide index...")}\n`);
  const entries = await fetchGuideIndex(githubToken);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    return;
  }

  const byCategory = new Map<string, typeof entries>();
  for (const entry of entries) {
    const category = entry.category || "uncategorized";
    byCategory.set(category, [...(byCategory.get(category) ?? []), entry]);
  }

  const lines: string[] = ["", `${bold(c("cyan", "GUIDES"))} ${dim(`(${entries.length})`)}`];
  for (const [category, categoryEntries] of [...byCategory.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push("", `${bold(c("green", category))} ${dim(`(${categoryEntries.length})`)}`);
    lines.push(c("gray", HR));
    for (const entry of categoryEntries) {
      lines.push(`  ${entry.path}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function runGuideCli(path: string, githubToken?: string): Promise<void> {
  process.stderr.write(`${dim(`Fetching guide "${path}"...`)}\n`);
  try {
    const result = await fetchGuide(path, githubToken);
    if (result === null) {
      process.stderr.write(`${c("red", "✖")} Guide not found at path: ${path}\n`);
      process.exit(1);
    }
    process.stdout.write(formatGuideContent(result.path, result.markdown));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${c("red", "✖")} ${message}\n`);
    process.exit(1);
  }
}

async function runSeedDocsCli(
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<void> {
  await runSeedCommand({
    source: "docs",
    failureLabel: "docs",
    githubToken,
    seedOptions,
    io: createSeedIo(),
    createProgress: createCliSeedProgressReporter,
    run: async (ctx, progress, token, options) => {
      await seedDocs(ctx.store, ctx.syncManager, token, progress, options);
      progress.onPhase("done", "API index ready");
    },
    formatSuccess: () => `${c("green", "✔")} Successfully seeded API docs index.\n`,
  });
}

async function runSeedGuidesCli(
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<void> {
  await runSeedCommand({
    source: "guides",
    failureLabel: "guides",
    githubToken,
    seedOptions,
    io: createSeedIo(),
    createProgress: createCliSeedProgressReporter,
    run: async (ctx, progress, token, options) => {
      await seedGuides(ctx.store, ctx.syncManager, token, progress, options);
      progress.onPhase("done", "guides index ready");
    },
    formatSuccess: () => `${c("green", "✔")} Successfully seeded guides index.\n`,
  });
}

async function runSeedFastflagsCli(
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<void> {
  let flagsResult = { added: 0, updated: 0 };
  await runSeedCommand({
    source: "fastflags",
    failureLabel: "FastFlags",
    githubToken,
    seedOptions,
    io: createSeedIo(),
    createProgress: createCliSeedProgressReporter,
    run: async (ctx, progress, token, options) => {
      flagsResult = await seedFastflags(
        ctx.store,
        ctx.syncManager,
        ctx.indexer,
        token,
        progress,
        options,
      );
      progress.onPhase("done", `${flagsResult.added} added, ${flagsResult.updated} updated`);
    },
    formatSuccess: () =>
      `${c("green", "✔")} Successfully seeded FastFlags: ${bold(String(flagsResult.added))} added, ${bold(String(flagsResult.updated))} updated.\n`,
  });
}

async function runSeedDevforumCli(
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<void> {
  let devforumResult = {
    added: 0,
    lowScore: 0,
    failed: 0,
    rejected: 0,
    bm25Invalidated: false,
    discoveryFromCache: false,
  };
  await runSeedCommand({
    source: "devforum",
    failureLabel: "DevForum",
    githubToken,
    seedOptions,
    io: createSeedIo(),
    createProgress: createCliSeedProgressReporter,
    run: async (ctx, progress, _token, options) => {
      devforumResult = await seedDevforum(
        ctx.store,
        ctx.syncManager,
        ctx.indexer,
        progress,
        options,
      );
    },
    formatSuccess: () =>
      `${c("green", "✔")} Successfully seeded DevForum content: ${bold(String(devforumResult.added))} added, ${bold(String(devforumResult.rejected))} filtered, ${bold(String(devforumResult.lowScore))} low score, ${bold(String(devforumResult.failed))} failed. BM25 invalidated: ${String(devforumResult.bm25Invalidated)}. Discovery cache: ${devforumResult.discoveryFromCache ? "hit" : "miss"}.\n`,
  });
}

async function runSeedAllCli(
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<void> {
  await runSeedAllCommand({
    githubToken,
    seedOptions,
    io: createSeedIo(),
    createProgress: createCliSeedProgressReporter,
    formatSuccess: () => `${c("green", "✔")} Successfully completed all seeds.\n`,
  });
}

async function runCachePathCli(): Promise<void> {
  const ctx = await openSeedContext();
  try {
    process.stdout.write(`${ctx.store.getPath()}\n`);
  } finally {
    await ctx.store.close();
  }
}

async function runCacheClearCli(target = "all"): Promise<void> {
  const validTargets = new Set<string>(["all", ...CACHE_SEED_SOURCES]);
  if (!validTargets.has(target)) {
    process.stderr.write(
      `${c("red", "✖")} Unknown cache clear target: ${target} (expected all, docs, guides, fastflags, or devforum).\n`,
    );
    process.exit(1);
  }

  const ctx = await openSeedContext();
  try {
    const embeddingIndexer = createEmbeddingIndexer(ctx.store);
    if (target === "all") {
      await ctx.store.clear();
      await ctx.indexer.clear("api");
      await ctx.indexer.clear("guides");
      await ctx.indexer.clear("fastflags");
      await ctx.indexer.clear("devforum");
      process.stdout.write(`${c("green", "✔")} Cleared all local RoDocs cache data.\n`);
      return;
    }

    if (target === "docs") {
      await ctx.indexer.clear("api");
    } else {
      await ctx.indexer.clear(target);
    }

    if (target === "fastflags" || target === "devforum") {
      await storeDelByPrefix(ctx.store, `${target}:`);
    }
    await ctx.store.del(`sync:seed:${target}`);
    await embeddingIndexer?.clearSource(target);
    process.stdout.write(`${c("green", "✔")} Cleared local cache for "${target}".\n`);
  } finally {
    await ctx.store.close();
  }
}

async function runCacheStatusCli(jsonOutput = false): Promise<void> {
  const ctx = await openSeedContext();
  try {
    const snapshot = await readCacheStatus(ctx.store, ctx.syncManager);

    if (jsonOutput) {
      process.stdout.write(
        `${JSON.stringify(
          {
            path: snapshot.cachePath,
            sqliteVecAvailable: snapshot.sqliteVecAvailable,
            sources: snapshot.sources.map((s) => ({
              source: s.source,
              records: s.records,
              vectors: s.vectors,
              status: s.persistedStatus,
              lastSyncAt: s.lastSyncAt,
              embeddingsComplete: s.embeddingsComplete,
              embeddingsCount: s.embeddingsCount,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const lines = [
      "",
      bold(c("cyan", "CACHE")),
      c("gray", HR),
      `path: ${snapshot.cachePath ?? "unknown"}`,
      `sqlite-vec: ${snapshot.sqliteVecAvailable ? c("green", "available") : c("yellow", "unavailable")}`,
      "",
    ];
    for (const status of snapshot.sources) {
      const records = status.records === null ? "-" : String(status.records);
      const vectors = status.vectors === null ? "-" : String(status.vectors);
      const embed =
        status.embeddingsComplete && status.embeddingsCount !== null
          ? `complete (${status.embeddingsCount})`
          : "pending";
      lines.push(
        `${c("green", status.source.padEnd(10))} records: ${records.padStart(6)}  vectors: ${vectors.padStart(6)}  seed: ${status.persistedStatus.padEnd(8)}  embeddings: ${embed}`,
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  } finally {
    await ctx.store.close();
  }
}

async function runDoctorCli(githubToken: string | undefined): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    name: "node",
    ok: nodeMajor >= 20,
    detail: process.versions.node,
  });
  checks.push({
    name: "github token",
    ok: githubToken !== undefined,
    detail: githubToken === undefined ? "not configured" : "configured",
  });

  try {
    const ctx = await openSeedContext();
    try {
      const snapshot = await readCacheStatus(ctx.store, ctx.syncManager);
      checks.push({ name: "cache", ok: true, detail: snapshot.cachePath ?? ctx.store.getPath() });
      checks.push({
        name: "sqlite-vec",
        ok: snapshot.sqliteVecAvailable,
        detail: snapshot.sqliteVecAvailable ? "loaded" : "unavailable (BM25-only mode)",
      });

      for (const source of snapshot.sources) {
        if (source.source === "fastflags" || source.source === "devforum") {
          const count = source.records ?? 0;
          checks.push({
            name: source.source,
            ok: count > 0,
            detail: `${count} records (${source.persistedStatus})`,
          });
        } else {
          checks.push({
            name: `${source.source} seed`,
            ok: source.persistedStatus === "complete",
            detail: source.persistedStatus,
          });
        }
      }
    } finally {
      await ctx.store.close();
    }
  } catch (err: unknown) {
    checks.push({
      name: "cache",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const lines = ["", bold(c("cyan", "DOCTOR")), c("gray", HR)];
  for (const check of checks) {
    lines.push(`${check.ok ? c("green", "✔") : c("red", "✖")} ${check.name}: ${check.detail}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function isHelpArg(arg: string | undefined): boolean {
  return arg === undefined || arg === "--help" || arg === "-h" || arg === "help";
}

function requireCommandArg(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    process.stderr.write(`${c("red", "✖")} ${message}\n`);
    process.exit(1);
  }
  return value;
}

async function runModernCommand(
  args: readonly string[],
  githubToken: string | undefined,
  seedOptions: SeedRunOptions,
): Promise<boolean> {
  const command = args[0];
  if (command === undefined || command.startsWith("--")) return false;

  if (command === "help") {
    const topic = args[1];
    if (topic === "api") printApiHelp();
    else if (topic === "guides" || topic === "guide") printGuidesHelp();
    else if (topic === "seed") printSeedHelp();
    else if (topic === "cache") printCacheHelp();
    else printHelp();
    return true;
  }

  if (command === "serve" || command === "server" || command === "mcp") {
    if (args.includes("--daemon") || args[1] === "daemon") {
      await runDaemonMode(githubToken);
    } else if (args.includes("--client") || args[1] === "client") {
      await runClientMode(githubToken);
    } else {
      await runMcpServer(githubToken);
    }
    return true;
  }

  if (command === "setup") {
    if (isHelpArg(args[1])) {
      process.stdout.write(
        [
          "",
          bold(c("cyan", "rodocs setup")),
          "",
          `  ${c("green", "rodocs")} ${c("yellow", "setup <provider>")} ${dim("[--local] [--daemon]")}`,
          "",
        ].join("\n"),
      );
      return true;
    }
    const provider = requireCommandArg(
      args[1],
      "setup requires a provider (claude-code, claude, opencode, codex, gemini, cursor, vscode).",
    );
    await runSetup(provider, args.includes("--daemon"), githubToken, args.includes("--local"));
    return true;
  }

  if (command === "api") {
    const action = args[1];
    if (isHelpArg(action)) {
      printApiHelp();
      return true;
    }
    if (action === "get" || action === "show") {
      const topic = requireCommandArg(args[2], "api get requires a topic name.");
      await runTopicCli(topic, githubToken, args.includes("--json"));
      return true;
    }
    if (action === "list" || action === "ls") {
      await runListCli(githubToken);
      return true;
    }
    if (action === "find" || action === "search") {
      const query = requireCommandArg(args[2], "api find requires a query.");
      await runFindCli(query, githubToken);
      return true;
    }
    process.stderr.write(`${c("red", "✖")} Unknown api command: ${action ?? ""}\n`);
    printApiHelp();
    process.exit(1);
  }

  if (command === "guides" || command === "guide") {
    const action = args[1];
    if (isHelpArg(action)) {
      printGuidesHelp();
      return true;
    }
    if (action === "search" || action === "find") {
      const query = requireCommandArg(args[2], "guides search requires a query.");
      await runGuideSearchCli(query, githubToken);
      return true;
    }
    if (action === "get" || action === "show") {
      const path = requireCommandArg(args[2], "guides get requires a guide path.");
      await runGuideCli(path, githubToken);
      return true;
    }
    if (action === "list" || action === "ls") {
      await runGuideListCli(githubToken, args.includes("--json"));
      return true;
    }
    process.stderr.write(`${c("red", "✖")} Unknown guides command: ${action ?? ""}\n`);
    printGuidesHelp();
    process.exit(1);
  }

  if (command === "seed") {
    const source = args[1];
    if (isHelpArg(source)) {
      printSeedHelp();
      return true;
    }
    if (source === "docs" || source === "api") {
      await runSeedDocsCli(githubToken, seedOptions);
      return true;
    }
    if (source === "guides") {
      await runSeedGuidesCli(githubToken, seedOptions);
      return true;
    }
    if (source === "fastflags" || source === "flags") {
      await runSeedFastflagsCli(githubToken, seedOptions);
      return true;
    }
    if (source === "devforum") {
      await runSeedDevforumCli(githubToken, seedOptions);
      return true;
    }
    if (source === "all") {
      await runSeedAllCli(githubToken, seedOptions);
      return true;
    }
    process.stderr.write(`${c("red", "✖")} Unknown seed source: ${source ?? ""}\n`);
    printSeedHelp();
    process.exit(1);
  }

  if (command === "cache") {
    const action = args[1];
    if (isHelpArg(action)) {
      printCacheHelp();
      return true;
    }
    if (action === "status") {
      await runCacheStatusCli(args.includes("--json"));
      return true;
    }
    if (action === "path") {
      await runCachePathCli();
      return true;
    }
    if (action === "clear") {
      await runCacheClearCli(args[2] ?? "all");
      return true;
    }
    process.stderr.write(`${c("red", "✖")} Unknown cache command: ${action ?? ""}\n`);
    printCacheHelp();
    process.exit(1);
  }

  if (command === "doctor") {
    await runDoctorCli(githubToken);
    return true;
  }

  if (command === "version") {
    process.stdout.write(`${APP_VERSION}\n`);
    return true;
  }

  return false;
}

// ! Entry point

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const metrics = MetricsCollector.getInstance();
  _setMetricsSink((event) => metrics.record(event));

  const { args, githubToken } = parseGithubTokenArgs(argv, env);
  const seedOptions = { buildEmbeddings: shouldBuildSeedEmbeddings(args, env) };

  if (await runModernCommand(args, githubToken, seedOptions)) {
    return;
  }

  if (args.length === 0 || args.includes("--stdio")) {
    await runMcpServer(githubToken);
    return;
  }

  const first = args[0];

  if (first === "--setup") {
    const provider = args[1];
    if (!provider) {
      process.stderr.write(
        `${c("red", "✖")} --setup requires a provider (claude-code, claude, opencode, codex, gemini, cursor, vscode).\n`,
      );
      process.exit(1);
    }
    const daemon = args.includes("--daemon");
    const local = args.includes("--local");
    await runSetup(provider, daemon, githubToken, local);
    return;
  }

  if (first === "--daemon") {
    await runDaemonMode(githubToken);
    return;
  }

  if (first === "--client") {
    await runClientMode(githubToken);
    return;
  }

  if (first === "--help" || first === "-h") {
    printHelp();
    return;
  }

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${APP_VERSION}\n`);
    return;
  }

  if (first === "--list") {
    await runListCli(githubToken);
    return;
  }

  if (first === "--find") {
    const query = args[1];
    if (query === undefined || query.trim() === "") {
      process.stderr.write(`${c("red", "✖")} --find requires a query argument.\n`);
      process.exit(1);
    }
    await runFindCli(query, githubToken);
    return;
  }

  if (first === "--search-guide") {
    const query = args[1];
    if (query === undefined || query.trim() === "") {
      process.stderr.write(`${c("red", "✖")} --search-guide requires a query argument.\n`);
      process.exit(1);
    }
    await runGuideSearchCli(query, githubToken);
    return;
  }

  if (first === "--seed-docs") {
    await runSeedDocsCli(githubToken, seedOptions);
    return;
  }

  if (first === "--seed-guides") {
    await runSeedGuidesCli(githubToken, seedOptions);
    return;
  }

  if (first === "--seed-fastflags") {
    await runSeedFastflagsCli(githubToken, seedOptions);
    return;
  }

  if (first === "--seed-devforum") {
    await runSeedDevforumCli(githubToken, seedOptions);
    return;
  }

  if (first === "--seed-all") {
    await runSeedAllCli(githubToken, seedOptions);
    return;
  }

  if (first === "--metrics") {
    const snap = MetricsCollector.getInstance().snapshot();
    process.stdout.write(`${formatMetricsReport(snap)}\n`);
    return;
  }

  if (first === "--guide") {
    const path = args[1];
    if (path === undefined || path.trim() === "") {
      process.stderr.write(`${c("red", "✖")} --guide requires a path argument.\n`);
      process.exit(1);
    }
    await runGuideCli(path, githubToken);
    return;
  }

  if (first !== undefined) {
    const jsonOutput = args.includes("--json");
    const topic = jsonOutput && first === "--json" ? args[1] : first;
    if (topic !== undefined) {
      await runTopicCli(topic, githubToken, jsonOutput);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(resolvePath(entry)).href;
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${c("red", "✖")} ${message}\n`);
    process.exit(1);
  });
}
