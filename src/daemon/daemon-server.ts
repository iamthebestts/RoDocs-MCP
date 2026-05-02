import net from "node:net";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { initIndexer } from "../search/index.js";
import { createServer, type ServerInstance } from "../server/index.js";
import { createSyncStateManager, LmdbStore, type SyncStateManager } from "../store/index.js";
import {
  DAEMON_HOST,
  DAEMON_PORT,
  encodeFrame,
  FrameDecoder,
  isJsonRpcMessage,
  isPing,
} from "./daemon-protocol.js";
import { IdleShutdown } from "./idle-shutdown.js";

export interface DaemonServerOptions {
  host?: string;
  port?: number;
  githubToken?: string;
  idleMs?: number;
  createStore?: () => LmdbStore;
  createMcpServer?: (context: DaemonServerContext) => ServerInstance;
}

export interface DaemonServerContext {
  store: LmdbStore;
  syncManager: SyncStateManager;
  githubToken?: string | undefined;
}

export interface RunningDaemonServer {
  host: string;
  port: number;
  close: () => Promise<void>;
  activeConnections: () => number;
  state: () => string;
}

class SocketTransport implements Transport {
  private readonly decoder = new FrameDecoder();
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly socket: net.Socket,
    private readonly onActivity: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.started) throw new Error("SocketTransport already started.");
    this.started = true;
    this.socket.on("data", this.onData);
    this.socket.on("error", this.onSocketError);
    this.socket.on("close", this.onSocketClose);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.onActivity();
    await writeSocket(this.socket, encodeFrame(message));
  }

  async close(): Promise<void> {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onSocketError);
    this.socket.off("close", this.onSocketClose);
    this.decoder.reset();
    this.socket.end();
    this.onclose?.();
  }

  private readonly onData = (chunk: Buffer): void => {
    try {
      for (const message of this.decoder.push(chunk)) {
        this.onActivity();
        if (isJsonRpcMessage(message)) {
          this.onmessage?.(message);
        }
      }
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      this.socket.destroy();
    }
  };

  private readonly onSocketError = (error: Error): void => {
    this.onerror?.(error);
  };

  private readonly onSocketClose = (): void => {
    this.onclose?.();
  };
}

export async function startDaemonServer(
  options: DaemonServerOptions = {},
): Promise<RunningDaemonServer> {
  const host = options.host ?? DAEMON_HOST;
  const port = options.port ?? DAEMON_PORT;
  const store = options.createStore?.() ?? new LmdbStore();
  let opened = false;
  let tcpServer: net.Server | null = null;
  const serverInstances = new Set<ServerInstance>();

  try {
    await store.open();
    opened = true;
    const syncManager = createSyncStateManager(store);
    initIndexer(store, syncManager);
    serializeStoreWrites(store);

    const idle = new IdleShutdown({
      idleMs: options.idleMs ?? 60_000,
      onShutdown: async () => {
        await closeTcpServer(tcpServer);
        for (const instance of serverInstances) {
          await Promise.resolve(instance.shutdown());
        }
        serverInstances.clear();
        await store.close();
      },
    });

    tcpServer = net.createServer((socket) => {
      if (idle.state === "shutting_down") idle.cancelShutdown();
      const token = {};
      idle.connectionOpened(token);

      let handshaken = false;
      let closed = false;
      let instance: ServerInstance | null = null;
      const decoder = new FrameDecoder();

      const closeConnection = (): void => {
        if (closed) return;
        closed = true;
        if (instance !== null) {
          instance.shutdown();
          serverInstances.delete(instance);
        }
        idle.connectionClosed(token);
      };

      const onHandshakeData = (chunk: Buffer): void => {
        try {
          for (const message of decoder.push(chunk)) {
            idle.recordActivity();
            if (!handshaken) {
              if (!isPing(message)) {
                socket.destroy(new Error("Expected daemon readiness ping."));
                return;
              }
              socket.off("data", onHandshakeData);
              void writeSocket(socket, encodeFrame({ type: "pong" })).then(() => {
                idle.recordActivity();
              });
              handshaken = true;
              instance =
                options.createMcpServer?.({
                  store,
                  syncManager,
                  githubToken: options.githubToken,
                }) ??
                createServer({
                  store,
                  syncManager,
                  initializeStore: false,
                  ...(options.githubToken === undefined
                    ? {}
                    : { githubToken: options.githubToken }),
                });
              serverInstances.add(instance);
              const transport = new SocketTransport(socket, () => idle.recordActivity());
              instance.server.connect(transport).catch((error: unknown) => {
                socket.destroy(error instanceof Error ? error : new Error(String(error)));
              });
            }
          }
        } catch (error) {
          socket.destroy(error instanceof Error ? error : new Error(String(error)));
        }
      };

      socket.on("data", onHandshakeData);
      socket.once("close", closeConnection);
      socket.once("error", () => closeConnection());
    });

    await listen(tcpServer, port, host);
    const address = tcpServer.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;
    idle.scheduleIfIdle();

    return {
      host,
      port: boundPort,
      close: async () => {
        idle.dispose();
        await closeTcpServer(tcpServer);
        for (const instance of serverInstances) {
          await Promise.resolve(instance.shutdown());
        }
        serverInstances.clear();
        await store.close();
      },
      activeConnections: () => idle.activeCount,
      state: () => idle.state,
    };
  } catch (error) {
    if (tcpServer !== null) await closeTcpServer(tcpServer);
    if (opened) await store.close();
    throw error;
  }
}

function serializeStoreWrites(store: LmdbStore): void {
  let tail = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const put = store.put.bind(store);
  const putMany = store.putMany.bind(store);
  const del = store.del.bind(store);
  const clear = store.clear.bind(store);

  store.put = <T = unknown>(key: string, value: T) => enqueue(() => put(key, value));
  store.putMany = <T = unknown>(entries: Array<{ key: string; value: T }>) =>
    enqueue(() => putMany(entries));
  store.del = (key: string) => enqueue(() => del(key));
  store.clear = () => enqueue(() => clear());
}

function listen(server: net.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeTcpServer(server: net.Server | null): Promise<void> {
  if (server === null || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function writeSocket(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error("Socket is closed."));
      return;
    }
    const onError = (error: Error): void => {
      socket.off("drain", onDrain);
      reject(error);
    };
    const onDrain = (): void => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    if (socket.write(data)) {
      socket.off("error", onError);
      resolve();
    } else {
      socket.once("drain", onDrain);
    }
  });
}
