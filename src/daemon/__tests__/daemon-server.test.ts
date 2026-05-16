import net from "node:net";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ServerInstance } from "../../server/index.js";
import type { LmdbStore } from "../../store/index.js";
import { encodeFrame, FrameDecoder } from "../daemon-protocol.js";
import { type DaemonServerContext, startDaemonServer } from "../daemon-server.js";

class FakeStore {
  open = vi.fn(async () => {});
  close = vi.fn(async () => {});
  getPath = vi.fn(() => "/tmp/rodocsmcp-test/store.lmdb");
  get = vi.fn(async () => null);
  keys = vi.fn(async () => []);
  put = vi.fn(async (_key: string, _value: unknown) => {});
  del = vi.fn(async (_key: string) => {});
  clear = vi.fn(async () => {});
}

function asStore(store: FakeStore): LmdbStore {
  return store as unknown as LmdbStore;
}

function createEchoServer(): (context: DaemonServerContext) => ServerInstance {
  return () =>
    ({
      server: {
        connect: async (transport: {
          start: () => Promise<void>;
          send: (message: JSONRPCMessage) => Promise<void>;
          onmessage?: (message: JSONRPCMessage) => void;
        }) => {
          transport.onmessage = (message) => {
            void transport.send(message);
          };
          await transport.start();
        },
      },
      scheduler: {},
      seedManager: {},
      shutdown: vi.fn(),
    }) as unknown as ServerInstance;
}

async function listenOnUsedPort(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address.");
  return { server, port: address.port };
}

async function connect(port: number): Promise<net.Socket> {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

describe("daemon server", () => {
  it("answers pong after initialization and routes framed MCP messages", async () => {
    const store = new FakeStore();
    const daemon = await startDaemonServer({
      port: 0,
      createStore: () => asStore(store),
      createMcpServer: createEchoServer(),
    });
    const socket = await connect(daemon.port);
    const decoder = new FrameDecoder();

    socket.write(encodeFrame({ type: "ping" }));
    const pong = await readFrame(socket, decoder);
    expect(pong).toEqual({ type: "pong" });

    const request = { jsonrpc: "2.0", id: 1, method: "tools/list" } as const;
    socket.write(encodeFrame(request));
    await expect(readFrame(socket, decoder)).resolves.toEqual(request);

    socket.destroy();
    await daemon.close();
    expect(store.open).toHaveBeenCalledBefore(store.close);
  });

  it("handles bind race and closes initialized resources", async () => {
    const { server, port } = await listenOnUsedPort();
    const store = new FakeStore();

    await expect(
      startDaemonServer({
        port,
        createStore: () => asStore(store),
        createMcpServer: createEchoServer(),
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });

    expect(store.open).toHaveBeenCalledOnce();
    expect(store.close).toHaveBeenCalledOnce();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serializes concurrent writes through the daemon-owned store", async () => {
    const store = new FakeStore();
    const order: string[] = [];
    store.put = vi.fn(async (key: string, _value: unknown) => {
      order.push(`start:${key}`);
      await new Promise<void>((resolve) => setTimeout(resolve, key === "a" ? 20 : 0));
      order.push(`end:${key}`);
    });

    const daemon = await startDaemonServer({
      port: 0,
      createStore: () => asStore(store),
      createMcpServer: (context) =>
        ({
          server: {
            connect: async () => {
              await Promise.all([context.store.put("a", 1), context.store.put("b", 2)]);
            },
          },
          scheduler: {},
          seedManager: {},
          shutdown: vi.fn(),
        }) as unknown as ServerInstance,
    });

    const socket = await connect(daemon.port);
    socket.write(encodeFrame({ type: "ping" }));
    await readFrame(socket, new FrameDecoder());

    await vi.waitFor(() => {
      expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    });
    socket.destroy();
    await daemon.close();
  });

  it("shuts down from startup when no clients connect", async () => {
    const store = new FakeStore();
    const daemon = await startDaemonServer({
      port: 0,
      idleMs: 5,
      createStore: () => asStore(store),
      createMcpServer: createEchoServer(),
    });

    expect(daemon.activeConnections()).toBe(0);
    await vi.waitFor(() => {
      expect(daemon.state()).toBe("closed");
    });
    expect(store.close).toHaveBeenCalledOnce();
  });
});

function readFrame(socket: net.Socket, decoder: FrameDecoder): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      try {
        const frames = decoder.push(chunk);
        const first = frames[0];
        if (first !== undefined) {
          socket.off("data", onData);
          socket.off("error", onError);
          resolve(first);
        }
      } catch (error) {
        socket.off("data", onData);
        socket.off("error", onError);
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      socket.off("data", onData);
      reject(error);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}
