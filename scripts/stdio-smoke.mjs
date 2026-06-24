#!/usr/bin/env node
/**
 * Runtime smoke: fresh --stdio process with warm on-disk cache.
 * Measures initialize, tools/list, and find_api_name latency.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "dist/cli.js");
// Use real user cache unless explicitly overridden for this smoke run.
const CACHE_DIR =
  process.env.RODOCS_SMOKE_CACHE_DIR ??
  join(process.env.HOME ?? "", ".cache/rodocsmcp");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class McpClient {
  constructor(stderrLines) {
    this.stderrLines = stderrLines;
    this.pending = new Map();
    this.id = 0;
    this.buffer = "";
    this.proc = spawn("node", [CLI, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RODOCS_CACHE_DIR: CACHE_DIR,
        LOG_LEVEL: "INFO",
      },
    });
    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t) this.stderrLines.push(t);
      }
    });
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id !== undefined) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(msg.id);
              pending.resolve(msg);
            }
          }
        } catch {
          // ignore non-json
        }
      }
    });
  }

  call(method, params, timeoutMs = 30_000) {
    const requestId = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
    });
  }

  stop() {
    this.proc.kill("SIGTERM");
  }
}

async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  return { label, ms, result };
}

const stderrLines = [];
const client = new McpClient(stderrLines);

try {
  console.log(`cache: ${CACHE_DIR}`);
  console.log("spawning fresh --stdio process...\n");

  const init = await timed("initialize", () =>
    client.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stdio-smoke", version: "0.0.1" },
    }),
  );
  if (init.result.error) throw new Error(`initialize failed: ${JSON.stringify(init.result)}`);
  console.log(`✓ initialize: ${init.ms}ms`);

  client.proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );

  const list = await timed("tools/list", () => client.call("tools/list"));
  if (list.result.error) throw new Error(`tools/list failed: ${JSON.stringify(list.result)}`);
  const tools = list.result.result?.tools ?? [];
  console.log(`✓ tools/list: ${list.ms}ms (${tools.length} tools)`);

  const findImmediate = await timed("find_api_name (immediate)", () =>
    client.call("tools/call", {
      name: "find_api_name",
      arguments: { query: "TweenService" },
    }),
  );
  const immPayload = findImmediate.result.result?.content?.[0]?.text ?? "";
  const immParsed = immPayload ? JSON.parse(immPayload) : {};
  console.log(
    `✓ find_api_name (immediate): ${findImmediate.ms}ms → ${immParsed.match ?? "?"}`,
  );

  await sleep(500);

  const find = await timed("find_api_name", () =>
    client.call("tools/call", {
      name: "find_api_name",
      arguments: { query: "DataStoreService" },
    }),
  );
  if (find.result.error) throw new Error(`find_api_name failed: ${JSON.stringify(find.result)}`);
  const payload = find.result.result?.content?.[0]?.text ?? "";
  if (!payload) throw new Error(`find_api_name empty payload: ${JSON.stringify(find.result)}`);
  const parsed = JSON.parse(payload);
  const hit = parsed.match ?? parsed.name ?? parsed.candidates?.[0]?.name ?? "?";
  console.log(`✓ find_api_name: ${find.ms}ms → ${hit}`);

  const seedLogs = stderrLines.filter((l) => l.includes("[Seed]"));
  const batchLogs = seedLogs.filter((l) => /batch \d+\/\d+/.test(l));
  const completeWarm = seedLogs.some((l) => /docs: complete/.test(l) && !/batch/.test(l));

  console.log("\n--- seed stderr (last 8) ---");
  for (const line of seedLogs.slice(-8)) console.log(line);

  console.log("\n--- verdict ---");
  const findOk = find.ms < 15_000;
  const noBatchDuringFind = batchLogs.length === 0;
  console.log(`find_api_name < 15s: ${findOk ? "PASS" : "FAIL"} (${find.ms}ms)`);
  console.log(`no seed batches during test: ${noBatchDuringFind ? "PASS" : "FAIL"} (${batchLogs.length} batch logs)`);
  if (completeWarm) console.log("warm cache: docs marked complete at startup");

  if (!findOk || !noBatchDuringFind) process.exitCode = 1;
} catch (err) {
  console.error("SMOKE FAILED:", err);
  process.exitCode = 1;
} finally {
  client.stop();
}