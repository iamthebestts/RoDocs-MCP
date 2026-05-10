import { type ChildProcess, spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const e2e = process.env.E2E === "true" ? describe : describe.skip;

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

class McpClient {
  private proc!: ChildProcess;
  private pending = new Map<
    number,
    {
      resolve: (v: JsonRpcResponse) => void;
      reject: (e: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();

  private id = 0;
  private buffer = "";

  constructor() {
    this.proc = spawn("node", ["dist/cli.js", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    if (!this.proc.stdout || !this.proc.stderr) {
      throw new Error("process error");
    }

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        try {
          const msg = JSON.parse(trimmed) as JsonRpcResponse;
          if (msg.id !== undefined) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(msg.id);
              pending.resolve(msg);
            }
          }
        } catch {}
      }
    });

    this.proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    this.proc.on("error", (err) => {
      process.stderr.write(`MCP Client Process Error: ${err}\n`);
    });
  }

  async call(method: string, params?: unknown, timeoutMs = 15_000): Promise<JsonRpcResponse> {
    const requestId = ++this.id;
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      if (!this.proc.stdin) {
        throw new Error("process error");
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request ${method} (id: ${requestId}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  async stop() {
    this.proc.kill();
  }
}

function parseText<T>(result: ToolResult): T {
  return JSON.parse(result.content[0]?.text ?? "") as T;
}

e2e("server e2e", () => {
  let client!: McpClient;

  beforeAll(() => {
    client = new McpClient();
  });

  afterAll(async () => {
    await client.stop();
  });

  async function call(method: string, params?: unknown) {
    return client.call(method, params);
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await call("tools/call", { name, arguments: args });
    expect(res.error).toBeUndefined();
    return res.result as ToolResult;
  }

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
      arguments: { topic: "qweaszxc123456" },
    });
    const result = res.result as ToolResult;
    expect(result.isError).toBe(true);
  });

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

  it("returns API name arrays grouped by category", async () => {
    const result = await callTool("list_api_names", {});
    const payload = parseText<{
      classes: string[];
      datatypes: string[];
      enums: string[];
      globals: string[];
      libraries: string[];
    }>(result);
    expect(Array.isArray(payload.classes)).toBe(true);
    expect(Array.isArray(payload.datatypes)).toBe(true);
    expect(Array.isArray(payload.enums)).toBe(true);
    expect(Array.isArray(payload.globals)).toBe(true);
    expect(Array.isArray(payload.libraries)).toBe(true);
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

  it("finds a datastore-related name for 'datastore'", async () => {
    const result = await callTool("find_api_name", { query: "datastore" });
    const payload = parseText<{ found: boolean; match: string | null }>(result);
    expect(payload.found).toBe(true);
    expect(typeof payload.match).toBe("string");
    expect(payload.match).toMatch(/DataStore/i);
  });

  it("returns found:false for gibberish", async () => {
    const result = await callTool("find_api_name", {
      query: "qweaszxc123456",
    });
    const payload = parseText<{ found: boolean; match: null }>(result);
    expect(payload.found).toBe(false);
    expect(payload.match).toBeNull();
  });

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

  it("returns markdown content for a valid path", async () => {
    const searchResult = await callTool("search_guides", {
      query: "data store",
    });
    const results = parseText<Array<{ path: string }>>(searchResult);
    const path = results[0]?.path;
    expect(path).toBeDefined();

    const guideResult = await callTool("get_guide", { path });
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

    const guideResult = await callTool("get_guide", { path });
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

  it("handles 3 parallel tool calls and returns all ids", async () => {
    const [res1, res2, res3] = await Promise.all([
      call("tools/call", {
        name: "get_api_reference",
        arguments: { topic: "TweenService" },
      }),
      call("tools/call", {
        name: "find_api_name",
        arguments: { query: "remote event" },
      }),
      call("tools/call", {
        name: "list_api_names",
        arguments: {},
      }),
    ]);

    expect(res1.error).toBeUndefined();
    expect(res2.error).toBeUndefined();
    expect(res3.error).toBeUndefined();
  });
});
