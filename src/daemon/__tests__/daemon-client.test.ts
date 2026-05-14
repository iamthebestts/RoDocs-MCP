import net, { createServer } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { pollForReadySocket, runDaemonClient } from "../daemon-client.js";
import type { DaemonLock } from "../daemon-lock.js";
import { encodeFrame, FrameDecoder, isPing, isPong } from "../daemon-protocol.js";

function createLock(): DaemonLock {
  return {
    path: "/tmp/daemon.lock",
    pid: process.pid,
    release: vi.fn(async () => {}),
  };
}

describe("daemon client", () => {
  it("handshakes with the daemon and bridges MCP after pong", async () => {
    // Track active server-side sockets for deterministic teardown
    const activeSockets = new Set<net.Socket>();

    const tcpServer = createServer((socket) => {
      activeSockets.add(socket);
      socket.once("close", () => activeSockets.delete(socket));

      const decoder = new FrameDecoder();
      socket.on("data", (chunk) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        for (const message of decoder.push(buffer)) {
          if (isPing(message)) {
            socket.write(encodeFrame({ type: "pong" }));
          } else {
            socket.write(encodeFrame(message));
          }
        }
      });
    });

    // port 0 → OS assigns a free port; eliminates hardcoded-port conflicts
    await new Promise<void>((resolve, reject) => {
      tcpServer.once("error", reject);
      tcpServer.listen(0, "127.0.0.1", () => {
        tcpServer.off("error", reject);
        resolve();
      });
    });
    const { port } = tcpServer.address() as net.AddressInfo;

    // Custom connect that targets the dynamic port and performs the ping/pong handshake,
    // mirroring what connectToDaemon() does in production.
    const connect = async (): Promise<net.Socket> => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      await new Promise<void>((resolve, reject) => {
        const decoder = new FrameDecoder();
        const onData = (chunk: Buffer): void => {
          for (const frame of decoder.push(chunk)) {
            socket.off("data", onData);
            if (isPong(frame)) resolve();
            else reject(new Error("Expected pong from server"));
            return;
          }
        };
        socket.on("data", onData);
        socket.once("error", reject);
        socket.write(encodeFrame({ type: "ping" }));
      });
      return socket;
    };

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const fallback = vi.fn(async () => {});
    await runDaemonClient({ fallback, stdin, stdout, stderr, retryMs: 100, connect });

    const output = new Promise<string>((resolve) => {
      stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
    });
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);

    await expect(output).resolves.toContain('"method":"tools/list"');
    expect(fallback).not.toHaveBeenCalled();

    stdin.end();
    // Destroy active server-side sockets so tcpServer.close() resolves immediately
    for (const s of activeSockets) s.destroy();
    await new Promise<void>((resolve, reject) => {
      tcpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("spawns the daemon when connect fails and the lock is acquired", async () => {
    let now = 0;
    const spawnDaemon = vi.fn();
    const fallback = vi.fn(async () => {});

    await runDaemonClient({
      fallback,
      spawnDaemon,
      acquireLock: async () => createLock(),
      connect: async () => {
        const error = new Error("refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        throw error;
      },
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      retryMs: 100,
    });

    expect(spawnDaemon).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("waits without spawning when the lock is held", async () => {
    let now = 0;
    const spawnDaemon = vi.fn();

    await runDaemonClient({
      fallback: async () => {},
      spawnDaemon,
      acquireLock: async () => null,
      connect: async () => {
        const error = new Error("refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        throw error;
      },
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      retryMs: 100,
    });

    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  it("stops retrying after the configured window", async () => {
    let now = 0;
    let attempts = 0;

    const socket = await pollForReadySocket({
      connect: async () => {
        attempts += 1;
        const error = new Error("refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        throw error;
      },
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      retryMs: 100,
    });

    expect(socket).toBeNull();
    expect(attempts).toBe(2);
  });

  it("simulates startup race with only one daemon spawn", async () => {
    let lockTaken = false;
    let now = 0;
    const spawnDaemon = vi.fn();
    const options = {
      fallback: async () => {},
      spawnDaemon,
      acquireLock: async () => {
        if (lockTaken) return null;
        lockTaken = true;
        return createLock();
      },
      connect: async () => {
        const error = new Error("refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        throw error;
      },
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      retryMs: 100,
    };

    await Promise.all([
      runDaemonClient(options),
      runDaemonClient(options),
      runDaemonClient(options),
    ]);

    expect(spawnDaemon).toHaveBeenCalledOnce();
  });

  it("falls back after unexpected daemon close when reconnect fails", async () => {
    const socket = new PassThrough() as unknown as net.Socket;
    socket.write = vi.fn(() => true) as unknown as net.Socket["write"];
    socket.end = vi.fn() as unknown as net.Socket["end"];
    const fallback = vi.fn(async () => {});
    let now = 0;
    let firstConnect = true;

    await runDaemonClient({
      fallback,
      connect: async () => {
        if (firstConnect) {
          firstConnect = false;
          return socket;
        }
        const error = new Error("refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        throw error;
      },
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      retryMs: 100,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    socket.emit("close");

    await vi.waitFor(() => {
      expect(fallback).toHaveBeenCalledOnce();
    });
  });
});
