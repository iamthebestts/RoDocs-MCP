import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  InheritedGroup,
  OwnMembers,
  RichMember,
  RobloxDocEntry,
  CodeSample,
} from "../scraper/fetch.js";
import {
  findClosestApiName,
  scrapeIndex,
  scrapeTopic,
} from "../scraper/index.js";
import { createServer } from "../server/index.js";

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
    typeof param["Name"] === "string"
      ? param["Name"]
      : typeof param["name"] === "string"
        ? param["name"]
        : "?";
  const type =
    typeof param["Type"] === "object" && param["Type"] !== null
      ? (((param["Type"] as Record<string, unknown>)["Name"] as
          | string
          | undefined) ?? "unknown")
      : typeof param["type"] === "string"
        ? param["type"]
        : "unknown";
  const def = param["Default"] ?? param["default"];
  const defStr = typeof def === "string" ? dim(` = ${def}`) : "";
  return `${c("white", name)}: ${c("yellow", type)}${defStr}`;
}

function formatMember(m: RichMember, kind: string): string {
  const badge = kindBadge(kind);
  const dep = m.isDeprecated ? ` ${c("red", "⚠ deprecated")}` : "";
  const inherited = m.inheritedFrom ? ` ${dim(`↑ ${m.inheritedFrom}`)}` : "";

  const nameLine = `  ${badge} ${bold(m.name)}${dep}${inherited}`;

  const parts: string[] = [nameLine];

  const summary = m.summary || m.description;
  if (summary) {
    parts.push(`     ${dim(truncate(summary, W - 5))}`);
  }

  if (m.type !== undefined) {
    const typeName =
      typeof m.type === "object" && m.type !== null
        ? (((m.type as Record<string, unknown>)["Name"] as
            | string
            | undefined) ?? JSON.stringify(m.type))
        : String(m.type);
    parts.push(`     ${dim("type:")} ${c("yellow", typeName)}`);
  }

  if (Array.isArray(m.parameters) && m.parameters.length > 0) {
    const paramStr = m.parameters.map(formatParam).join(dim(", "));
    parts.push(`     ${dim("params:")} ${paramStr}`);
  }

  if (Array.isArray(m.returns) && m.returns.length > 0) {
    const first = m.returns[0] as Record<string, unknown> | undefined;
    if (first !== undefined) {
      const retType =
        typeof first["Type"] === "object" && first["Type"] !== null
          ? (((first["Type"] as Record<string, unknown>)["Name"] as
              | string
              | undefined) ?? "unknown")
          : typeof first["type"] === "string"
            ? first["type"]
            : "unknown";
      parts.push(`     ${dim("returns:")} ${c("green", retType)}`);
    }
  }

  if (m.threadSafety && m.threadSafety !== "Unsafe") {
    parts.push(`     ${dim(`thread: ${m.threadSafety}`)}`);
  }

  return parts.join("\n");
}
function formatMemberGroup(
  label: string,
  kind: string,
  members: RichMember[],
): string {
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
    (g) =>
      g.properties.length +
        g.methods.length +
        g.events.length +
        g.callbacks.length >
      0,
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

  const lines: string[] = [
    `\n  ${c("cyan", "◆")} ${bold(title)} ${dim(`(${s.language})`)}`,
  ];
  if (s.description) lines.push(`  ${dim(truncate(s.description, W - 2))}`);
  lines.push(`  ${c("gray", "┌" + "─".repeat(W - 4) + "┐")}`);
  for (const line of preview) {
    const padded = line.length > W - 6 ? `${line.slice(0, W - 9)}…` : line;
    lines.push(`  ${c("gray", "│")} ${c("green", padded)}`);
  }
  if (truncated) {
    lines.push(
      `  ${c("gray", "│")} ${dim(`… ${codeLines.length - 25} more lines`)}`,
    );
  }
  lines.push(`  ${c("gray", "└" + "─".repeat(W - 4) + "┘")}`);
  return lines.join("\n");
}

function formatEntry(entry: RobloxDocEntry): string {
  const cl = entry.class;
  const parts: string[] = [];
  const depFlag = cl.deprecationMessage ? ` ${c("red", "⚠ DEPRECATED")}` : "";
  parts.push(boxTop(`CLASS: ${cl.name}${depFlag}`, "cyan"));

  if (cl.inherits.length > 0) {
    parts.push(
      boxRow(`Inherits: ${c("yellow", cl.inherits.join(", "))}`, "cyan"),
    );
  } else {
    parts.push(boxRow(dim("No superclass"), "cyan"));
  }

  if (cl.descendants.length > 0) {
    parts.push(
      boxRow(
        `Descendants: ${dim(truncate(cl.descendants.join(", "), W - 16))}`,
        "cyan",
      ),
    );
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
    (acc, g) =>
      acc +
      g.properties.length +
      g.methods.length +
      g.events.length +
      g.callbacks.length,
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

// ! Help

function printHelp(): void {
  process.stdout.write(
    [
      "",
      bold(c("cyan", "rodocsmcp")) +
        dim(" — Roblox Creator Hub API reference & MCP server"),
      "",
      bold("USAGE"),
      `  ${c("green", "rodocsmcp")}                    Start MCP server ${dim("(stdio)")}`,
      `  ${c("green", "rodocsmcp")} ${c("yellow", "--stdio")}             Start MCP server ${dim("(stdio, explicit)")}`,
      `  ${c("green", "rodocsmcp")} ${c("yellow", "<TopicName>")}         Print docs for a topic`,
      `  ${c("green", "rodocsmcp")} ${c("yellow", "--list")}              List all class and enum names`,
      `  ${c("green", "rodocsmcp")} ${c("yellow", "--find <query>")}      Find closest API name`,
      `  ${c("green", "rodocsmcp")} ${c("yellow", "--help")} ${dim("| -h")}          Show this help`,
      "",
      bold("EXAMPLES"),
      `  ${dim("$")} rodocsmcp Actor`,
      `  ${dim("$")} rodocsmcp TweenService`,
      `  ${dim("$")} rodocsmcp KeyCode`,
      `  ${dim("$")} rodocsmcp --list`,
      `  ${dim("$")} rodocsmcp --find tweenserv`,
      "",
    ].join("\n"),
  );
}

// ! Modes

async function runMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("rodocsmcp MCP server ready (stdio)\n");
}

async function runTopicCli(topic: string): Promise<void> {
  process.stderr.write(`${dim(`Fetching "${topic}"...`)}\n`);
  try {
    const result = await scrapeTopic(topic);
    process.stdout.write(formatEntry(result.entry) + "\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const suggestion = await findClosestApiName(topic).catch(() => null);
    process.stderr.write(`${c("red", "✖")} ${message}\n`);
    if (suggestion !== null) {
      process.stderr.write(
        `${c("yellow", "?")} Did you mean: ${bold(c("cyan", suggestion))}?\n`,
      );
    }
    process.exit(1);
  }
}

async function runListCli(): Promise<void> {
  process.stderr.write(`${dim("Fetching API index...")}\n`);
  const result = await scrapeIndex();

  const lines: string[] = [
    "",
    `${bold(c("cyan", `CLASSES`))} ${dim(`(${result.classes.length})`)}`,
    c("gray", HR),
    ...result.classes.map((n) => `  ${n}`),
    "",
    `${bold(c("magenta", `ENUMS`))} ${dim(`(${result.enums.length})`)}`,
    c("gray", HR),
    ...result.enums.map((n) => `  ${n}`),
    "",
  ];

  process.stdout.write(lines.join("\n") + "\n");
}

async function runFindCli(query: string): Promise<void> {
  process.stderr.write(`${dim(`Searching for "${query}"...`)}\n`);
  const match = await findClosestApiName(query);
  if (match !== null) {
    process.stdout.write(
      `${c("green", "✔")} Closest match: ${bold(c("cyan", match))}\n`,
    );
  } else {
    process.stdout.write(
      `${c("yellow", "✖")} No match found for "${query}".\n`,
    );
  }
}

// ! Entry point

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--stdio")) {
    await runMcpServer();
    return;
  }

  const first = args[0];

  if (first === "--help" || first === "-h") {
    printHelp();
    return;
  }

  if (first === "--list") {
    await runListCli();
    return;
  }

  if (first === "--find") {
    const query = args[1];
    if (query === undefined || query.trim() === "") {
      process.stderr.write(
        `${c("red", "✖")} --find requires a query argument.\n`,
      );
      process.exit(1);
    }
    await runFindCli(query);
    return;
  }

  await runTopicCli(first as string);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${c("red", "✖")} ${message}\n`);
  process.exit(1);
});
