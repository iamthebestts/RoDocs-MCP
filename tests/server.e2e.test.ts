// tests/server.e2e.test.ts
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * E2E tests for the MCP server (stdio JSON-RPC 2.0).
 * Requires: npm run build before running.
 * Run: E2E=true vitest run tests/server.e2e.test.ts --reporter=verbose
 */
const e2e = process.env.E2E === "true" ? describe : describe.skip;

// ── JSON-RPC helpers ────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

function runServer(requests: JsonRpcRequest[], timeoutMs = 25_000): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/cli.js", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const responses: JsonRpcResponse[] = [];
    const pendingIds = new Set(requests.map((r) => r.id));
    let buffer = "";

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Server timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcResponse;
          if (msg.id !== undefined) {
            responses.push(msg);
            pendingIds.delete(msg.id);
            if (pendingIds.size === 0) {
              clearTimeout(timer);
              proc.kill();
              resolve(responses);
            }
          }
        } catch {
          // ignora linhas não-JSON (logs de debug, etc.)
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    for (const req of requests) {
      proc.stdin.write(`${JSON.stringify(req)}\n`);
    }
    proc.stdin.end();
  });
}

let _id = 0;
async function call(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const id = ++_id;
  const [res] = await runServer([{ jsonrpc: "2.0", id, method, params }]);
  if (res === undefined) throw new Error("No response received");
  return res;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await call("tools/call", { name, arguments: args });
  expect(res.error).toBeUndefined();
  return res.result as ToolResult;
}

function parseText<T>(result: ToolResult): T {
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text) as T;
}

// ── tests ───────────────────────────────────────────────────────────────────

e2e("MCP server e2e", { timeout: 30_000 }, () => {
  describe("initialize", () => {
    it("responds with serverInfo", async () => {
      const res = await call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" },
      });
      expect(res.error).toBeUndefined();
      const result = res.result as Record<string, unknown>;
      expect(result.serverInfo).toMatchObject({ name: "rodocsmcp" });
    });

    it("advertises tools capability", async () => {
      const res = await call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" },
      });
      const result = res.result as Record<string, unknown>;
      const caps = result.capabilities as Record<string, unknown>;
      expect(caps.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("exposes all 7 registered tools", async () => {
      const res = await call("tools/list");
      const { tools } = res.result as { tools: { name: string }[] };
      const names = tools.map((t) => t.name);
      expect(names).toContain("get_api_reference");
      expect(names).toContain("get_many_api_references");
      expect(names).toContain("list_api_names");
      expect(names).toContain("find_api_name");
      expect(names).toContain("search_guides");
      expect(names).toContain("get_guide");
      expect(names).toContain("list_guides");
    });

    it("each tool has name, description and inputSchema", async () => {
      const res = await call("tools/list");
      const { tools } = res.result as {
        tools: { name: string; description: string; inputSchema: unknown }[];
      };
      for (const tool of tools) {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
      }
    });
  });

  describe("get_api_reference", () => {
    it("returns AIEntry for DataStoreService", async () => {
      const result = await callTool("get_api_reference", {
        topic: "DataStoreService",
      });
      expect(result.isError).toBeFalsy();
      const entry = parseText<{
        name: string;
        kind: string;
        members: Array<{ name: string; kind: string }>;
      }>(result);
      expect(entry.name).toBe("DataStoreService");
      expect(entry.kind).toBe("class");
      expect(Array.isArray(entry.members)).toBe(true);
      expect(entry.members.length).toBeGreaterThan(0);
      expect(entry.members.some((m) => m.kind === "method")).toBe(true);
    });

    it("entry contains a datastore-related method", async () => {
      const result = await callTool("get_api_reference", {
        topic: "DataStoreService",
      });
      const entry = parseText<{
        members: Array<{ name: string; kind: string }>;
      }>(result);
      const hasDatastoreMethod = entry.members.some(
        (m) => m.kind === "method" && /Get.*DataStore/i.test(m.name),
      );
      expect(hasDatastoreMethod).toBe(true);
    });

    it("entry for TweenService has summary", async () => {
      const result = await callTool("get_api_reference", {
        topic: "TweenService",
      });
      const entry = parseText<{ summary: string }>(result);
      expect(entry.summary.length).toBeGreaterThan(0);
    });

    it("unknown topic returns isError true", async () => {
      const res = await call("tools/call", {
        name: "get_api_reference",
        arguments: { topic: "xXNotARealClassXx" },
      });
      const result = res.result as ToolResult;
      expect(result.isError).toBe(true);
    });
  });

  describe("get_many_api_references", () => {
    it("returns results for multiple topics", async () => {
      const result = await callTool("get_many_api_references", {
        topics: ["TweenService", "RunService"],
      });
      const results = parseText<Array<{ ok: boolean; topic: string }>>(result);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it("failed topic has ok:false with error field", async () => {
      const result = await callTool("get_many_api_references", {
        topics: ["TweenService", "xXNotARealClassXx"],
      });
      const results = parseText<Array<{ ok: boolean; topic: string; error?: string }>>(result);
      const failed = results.find((r) => r.topic === "xXNotARealClassXx");
      expect(failed?.ok).toBe(false);
      expect(typeof failed?.error).toBe("string");
    });

    it("respects max 20 topics limit — over limit returns tool error", async () => {
      const topics = Array.from({ length: 21 }, (_, i) => `Topic${i}`);
      const res = await call("tools/call", {
        name: "get_many_api_references",
        arguments: { topics },
      });
      const result = res.result as ToolResult;
      expect(result.isError).toBe(true);
    });
  });

  describe("list_api_names", () => {
    it("returns classes and enums arrays", async () => {
      const result = await callTool("list_api_names", {});
      const payload = parseText<{ classes: string[]; enums: string[] }>(result);
      expect(Array.isArray(payload.classes)).toBe(true);
      expect(Array.isArray(payload.enums)).toBe(true);
      expect(payload.classes.length).toBeGreaterThan(100);
      expect(payload.enums.length).toBeGreaterThan(10);
    });

    it("classes list contains DataStoreService", async () => {
      const result = await callTool("list_api_names", {});
      const payload = parseText<{ classes: string[] }>(result);
      expect(payload.classes).toContain("DataStoreService");
    });

    it("enums list contains KeyCode", async () => {
      const result = await callTool("list_api_names", {});
      const payload = parseText<{ enums: string[] }>(result);
      expect(payload.enums).toContain("KeyCode");
    });
  });

  describe("find_api_name", () => {
    it("finds a datastore-related name for 'datastore'", async () => {
      const result = await callTool("find_api_name", { query: "datastore" });
      const payload = parseText<{ found: boolean; match: string | null }>(result);
      expect(payload.found).toBe(true);
      expect(typeof payload.match).toBe("string");
      expect(payload.match).toMatch(/DataStore/i);
    });

    it("returns found:false for gibberish", async () => {
      const result = await callTool("find_api_name", {
        query: "xXNotARealClassXx123",
      });
      const payload = parseText<{ found: boolean; match: null }>(result);
      expect(payload.found).toBe(false);
      expect(payload.match).toBeNull();
    });
  });

  describe("search_guides", () => {
    it("returns array of guide results", async () => {
      const result = await callTool("search_guides", {
        query: "save player data",
      });
      expect(result.isError).toBeFalsy();
      const results =
        parseText<
          Array<{
            name?: string;
            path: string;
            title?: string;
            description?: string;
            category: string;
            type?: string;
          }>
        >(result);
      expect(Array.isArray(results)).toBe(true);
    });

    it("results have required fields", async () => {
      const result = await callTool("search_guides", {
        query: "remote events",
      });
      const results =
        parseText<
          Array<{
            path: string;
            title?: string;
            description?: string;
            category: string;
          }>
        >(result);
      for (const r of results) {
        expect(typeof r.path).toBe("string");
        expect(typeof r.category).toBe("string");
      }
    });

    it("'data store' query returns relevant guide", async () => {
      const result = await callTool("search_guides", { query: "data store" });
      const results =
        parseText<Array<{ path: string; title?: string; description?: string }>>(result);
      const hasDataStore = results.some((r) => {
        const blob = [r.path, r.title ?? "", r.description ?? ""].join(" ");
        return /data|store/i.test(blob);
      });
      expect(hasDataStore).toBe(true);
    });
  });

  describe("get_guide", () => {
    it("returns markdown content for a valid path", async () => {
      const searchResult = await callTool("search_guides", {
        query: "data store",
      });
      const results = parseText<Array<{ path: string }>>(searchResult);
      const path = results[0]?.path;
      expect(path).toBeDefined();

      const guideResult = await callTool("get_guide", { path: path });
      expect(guideResult.isError).toBeFalsy();
      const markdown = guideResult.content[0]?.text ?? "";
      expect(markdown.length).toBeGreaterThan(100);
    });

    it("markdown contains expected content markers", async () => {
      const searchResult = await callTool("search_guides", {
        query: "remote events scripting",
      });
      const results = parseText<Array<{ path: string }>>(searchResult);
      const path = results[0]?.path;
      expect(path).toBeDefined();

      const guideResult = await callTool("get_guide", { path: path });
      const markdown = guideResult.content[0]?.text ?? "";
      expect(markdown).toMatch(/^(---|#)/m);
    });

    it("invalid path returns isError true", async () => {
      const res = await call("tools/call", {
        name: "get_guide",
        arguments: { path: "not/a/real/guide.md" },
      });
      const result = res.result as ToolResult;
      expect(result.isError).toBe(true);
    });
  });

  describe("list_guides", () => {
    it("returns array with path and category", async () => {
      const result = await callTool("list_guides", {});
      const entries = parseText<Array<{ path: string; category: string }>>(result);
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(10);
      expect(typeof entries[0]?.path).toBe("string");
      expect(typeof entries[0]?.category).toBe("string");
    });

    it("entries have path ending in .md", async () => {
      const result = await callTool("list_guides", {});
      const entries = parseText<Array<{ path: string }>>(result);
      for (const e of entries.slice(0, 20)) {
        expect(e.path).toMatch(/\.md$/);
      }
    });
  });

  describe("error handling", () => {
    it("unknown method returns JSON-RPC -32601", async () => {
      const res = await call("methods/doesNotExist");
      expect(res.error?.code).toBe(-32601);
    });

    it("call with missing required arg returns error", async () => {
      const res = await call("tools/call", {
        name: "get_api_reference",
        arguments: {},
      });
      const hasError = res.error !== undefined || (res.result as ToolResult)?.isError === true;
      expect(hasError).toBe(true);
    });
  });

  describe("concurrent requests", () => {
    it("handles 3 parallel tool calls and returns all ids", async () => {
      const responses = await runServer([
        {
          jsonrpc: "2.0",
          id: 100,
          method: "tools/call",
          params: {
            name: "get_api_reference",
            arguments: { topic: "TweenService" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: {
            name: "find_api_name",
            arguments: { query: "remote event" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: {
            name: "list_api_names",
            arguments: {},
          },
        },
      ]);
      expect(responses).toHaveLength(3);
      const ids = new Set(responses.map((r) => r.id));
      expect(ids.has(100)).toBe(true);
      expect(ids.has(101)).toBe(true);
      expect(ids.has(102)).toBe(true);
      for (const r of responses) {
        expect(r.error).toBeUndefined();
      }
    });
  });
});
