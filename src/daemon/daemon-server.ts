import net from "node:net";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { setupRateLimiter } from "../devforum/http.js";
import { initDevForumSearch } from "../devforum/search.js";
import { Scheduler } from "../scheduler/index.js";
import type { SeedManager } from "../scheduler/seed-manager.js";
import { initIndexer } from "../search/index.js";
import { createEmbeddingIndexer } from "../seed/runners.js";
import { createServer, type ServerInstance } from "../server/index.js";
import { createSeedManager } from "../server/seed-wiring.js";
import {
  createSyncStateManager,
  type IKeyValueStore,
  Indexer,
  SqliteStore,
  type SyncStateManager,
} from "../store/index.js";
import { logger } from "../utils/logger.js";
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
  createStore?: () => IKeyValueStore;
  createMcpServer?: (context: DaemonServerContext) => ServerInstance;
}

export interface DaemonServerContext {
  store: IKeyValueStore;
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
  const store = options.createStore?.() ?? new SqliteStore();
  let opened = false;
  let tcpServer: net.Server | null = null;
  const serverInstances = new Set<ServerInstance>();

  let sharedScheduler: Scheduler | null = null;
  let sharedSeedManager: SeedManager | null = null;

  try {
    await store.open();
    opened = true;
    const syncManager = createSyncStateManager(store);
    serializeStoreWrites(store);

    let sharedIndexer: Indexer | undefined;
    if (options.createMcpServer === undefined) {
      sharedIndexer = new Indexer(store, syncManager);
      initIndexer(store, syncManager, sharedIndexer);
      initDevForumSearch(sharedIndexer);

      sharedScheduler = new Scheduler();
      setupRateLimiter(sharedScheduler.devForumRateLimiter);
      sharedSeedManager = createSeedManager({
        store,
        syncManager,
        indexer: sharedIndexer,
        scheduler: sharedScheduler,
        githubToken: options.githubToken,
      });

      sharedScheduler.start();
      const seedMgr = sharedSeedManager;
      setImmediate(() => {
        const getDb = createEmbeddingIndexer(store)
          ? () => (store as IKeyValueStore & { getDb(): import("better-sqlite3").Database }).getDb()
          : undefined;
        void seedMgr
          .prepareStartup({ store, ...(getDb ? { getDb } : {}) })
          .then(() => seedMgr.startBackground())
          .catch((err: unknown) => {
            logger.error(
              `[Daemon] prepareStartup failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            seedMgr.startBackground();
          });
      });
    }

    const stopSharedRuntime = (): void => {
      sharedSeedManager?.stop();
      sharedScheduler?.stop();
      sharedSeedManager = null;
      sharedScheduler = null;
    };

    const idle = new IdleShutdown({
      idleMs: options.idleMs ?? 60_000,
      onShutdown: async () => {
        await closeTcpServer(tcpServer);
        for (const instance of serverInstances) {
          await Promise.resolve(instance.shutdown());
        }
        serverInstances.clear();
        stopSharedRuntime();
        await store.close();
      },
    });

    tcpServer = net.createServer((socket) => {
      const token = {};
      if (!idle.connectionOpened(token)) {
        // Shutdown already committed: refuse the socket so the client falls back
        // to its retry/spawn path against a fresh daemon instead of racing a
        // store that is being closed underneath it.
        socket.destroy();
        return;
      }

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
                  ...(sharedIndexer ? { indexer: sharedIndexer } : {}),
                  ...(sharedScheduler ? { scheduler: sharedScheduler } : {}),
                  ...(sharedSeedManager ? { seedManager: sharedSeedManager } : {}),
                  initializeStore: false,
                  autoStartScheduler: false,
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
        stopSharedRuntime();
        await store.close();
      },
      activeConnections: () => idle.activeCount,
      state: () => idle.state,
    };
  } catch (error) {
    if (tcpServer !== null) await closeTcpServer(tcpServer);
    sharedSeedManager?.stop();
    sharedScheduler?.stop();
    if (opened) await store.close();
    throw error;
  }
}

function serializeStoreWrites(store: IKeyValueStore): void {
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
  const del = store.del.bind(store);
  const clear = store.clear.bind(store);

  store.put = <T = unknown>(key: string, value: T) => enqueue(() => put(key, value));
  store.del = (key: string) => enqueue(() => del(key));
  store.clear = () => enqueue(() => clear());
  if (typeof store.putMany === "function") {
    const putMany = store.putMany.bind(store);
    store.putMany = (entries) => enqueue(() => putMany(entries));
  }
  if (typeof store.delByPrefix === "function") {
    const delByPrefix = store.delByPrefix.bind(store);
    store.delByPrefix = (prefix) => enqueue(() => delByPrefix(prefix));
  }
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
