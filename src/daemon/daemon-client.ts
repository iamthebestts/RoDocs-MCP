import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import type { Readable, Writable } from "node:stream";
import { type JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { acquireDaemonLock, type DaemonLock, resolveDaemonLockPath } from "./daemon-lock.js";
import {
  DAEMON_HOST,
  DAEMON_PORT,
  encodeFrame,
  FrameDecoder,
  isJsonRpcMessage,
  isPong,
} from "./daemon-protocol.js";

export interface DaemonClientOptions {
  githubToken?: string;
  retryMs?: number;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  fallback: () => Promise<void>;
  spawnDaemon?: (githubToken?: string) => ChildProcess;
  acquireLock?: () => Promise<DaemonLock | null>;
  connect?: () => Promise<net.Socket>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function runDaemonClient(options: DaemonClientOptions): Promise<void> {
  const retryMs = options.retryMs ?? 2_000;
  const stderr = options.stderr ?? process.stderr;
  const connect = options.connect ?? (() => connectToDaemon());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  let socket = await tryConnect(connect);
  let startupLock: DaemonLock | null = null;
  if (socket === null) {
    startupLock = await autoStartDaemon(options);
    try {
      socket = await pollForReadySocket({ connect, retryMs, now, sleep });
    } finally {
      await startupLock?.release();
    }
  }

  if (socket === null) {
    stderr.write("rodocsmcp daemon unavailable; falling back to isolated stdio mode.\n");
    await options.fallback();
    return;
  }

  const bridge = new ClientBridge({
    socket,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr,
    connect,
    retryMs,
    now,
    sleep,
    fallback: options.fallback,
  });
  await bridge.start();
}

export async function pollForReadySocket(options: {
  connect: () => Promise<net.Socket>;
  retryMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}): Promise<net.Socket | null> {
  const deadline = options.now() + options.retryMs;
  do {
    const socket = await tryConnect(options.connect);
    if (socket !== null) return socket;
    await options.sleep(50);
  } while (options.now() < deadline);
  return null;
}

export function spawnCurrentDaemon(githubToken?: string): ChildProcess {
  const entry = process.argv[1];
  if (entry === undefined) {
    throw new Error("Cannot auto-start daemon without a CLI entrypoint.");
  }
  const args = [...process.execArgv, entry, "--daemon"];
  if (githubToken !== undefined) {
    args.push("--github-token", githubToken);
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child;
}

async function autoStartDaemon(options: DaemonClientOptions): Promise<DaemonLock | null> {
  const acquireLock = options.acquireLock ?? (() => acquireDaemonLock(resolveDaemonLockPath()));
  const lock = await acquireLock();
  if (lock === null) return null;

  (options.spawnDaemon ?? spawnCurrentDaemon)(options.githubToken);
  return lock;
}

async function connectToDaemon(): Promise<net.Socket> {
  const socket = net.createConnection({ host: DAEMON_HOST, port: DAEMON_PORT });
  await onceConnect(socket);
  await performHandshake(socket);
  return socket;
}

async function tryConnect(connect: () => Promise<net.Socket>): Promise<net.Socket | null> {
  try {
    return await connect();
  } catch (error) {
    if (isNodeError(error) && (error.code === "ECONNREFUSED" || error.code === "ENOENT")) {
      return null;
    }
    return null;
  }
}

async function performHandshake(socket: net.Socket): Promise<void> {
  const decoder = new FrameDecoder();
  await writeSocket(socket, encodeFrame({ type: "ping" }));
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      try {
        for (const message of decoder.push(chunk)) {
          if (isPong(message)) {
            cleanup();
            resolve();
            return;
          }
          reject(new Error("Daemon did not return readiness pong."));
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("Daemon socket closed during handshake."));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

class ClientBridge {
  private socket: net.Socket;
  private readonly decoder = new FrameDecoder();
  private stdinBuffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly options: {
      socket: net.Socket;
      stdin: Readable;
      stdout: Writable;
      stderr: Writable;
      connect: () => Promise<net.Socket>;
      retryMs: number;
      now: () => number;
      sleep: (ms: number) => Promise<void>;
      fallback: () => Promise<void>;
    },
  ) {
    this.socket = options.socket;
  }

  async start(): Promise<void> {
    this.attachSocket();
    this.options.stdin.on("data", this.onStdinData);
    this.options.stdin.on("end", this.onStdinEnd);
  }

  private attachSocket(): void {
    this.socket.on("data", this.onSocketData);
    this.socket.once("close", this.onSocketClose);
    this.socket.once("error", this.onSocketError);
  }

  private detachSocket(): void {
    this.socket.off("data", this.onSocketData);
    this.socket.off("close", this.onSocketClose);
    this.socket.off("error", this.onSocketError);
  }

  private readonly onStdinData = (chunk: Buffer): void => {
    this.stdinBuffer = Buffer.concat([this.stdinBuffer, chunk]);
    while (true) {
      const newline = this.stdinBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.stdinBuffer.toString("utf8", 0, newline).replace(/\r$/, "");
      this.stdinBuffer = this.stdinBuffer.subarray(newline + 1);
      if (line.trim() === "") continue;
      const parsed = JSONRPCMessageSchema.parse(JSON.parse(line)) as JSONRPCMessage;
      void writeSocket(this.socket, encodeFrame(parsed)).catch(() => this.reconnectOrFallback());
    }
  };

  private readonly onStdinEnd = (): void => {
    this.closed = true;
    this.socket.end();
  };

  private readonly onSocketData = (chunk: Buffer): void => {
    try {
      for (const message of this.decoder.push(chunk)) {
        if (!isJsonRpcMessage(message)) continue;
        this.options.stdout.write(`${JSON.stringify(message)}\n`);
      }
    } catch (error) {
      this.options.stderr.write(
        `rodocsmcp daemon protocol error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      void this.reconnectOrFallback();
    }
  };

  private readonly onSocketError = (): void => {};

  private readonly onSocketClose = (): void => {
    if (!this.closed) void this.reconnectOrFallback();
  };

  private async reconnectOrFallback(): Promise<void> {
    if (this.closed) return;
    this.detachSocket();
    const socket = await pollForReadySocket({
      connect: this.options.connect,
      retryMs: this.options.retryMs,
      now: this.options.now,
      sleep: this.options.sleep,
    });
    if (socket === null) {
      this.closed = true;
      this.options.stderr.write(
        "rodocsmcp daemon connection lost; falling back to isolated stdio mode.\n",
      );
      await this.options.fallback();
      return;
    }
    this.socket = socket;
    this.decoder.reset();
    this.attachSocket();
  }
}

function onceConnect(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onConnect = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function writeSocket(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error("Socket is closed."));
      return;
    }
    if (socket.write(data)) {
      resolve();
    } else {
      socket.once("drain", resolve);
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
