import { logger } from "../utils/logger.js";
import type { LmdbStore } from "./lmdb-store.js";

export type WriteOp = { type: "put"; key: string; value: unknown } | { type: "del"; key: string };

export interface WriteQueueOptions {
  /**
   * Max number of operations before auto-flush. Default: 100
   */
  batchSize?: number;
  /**
   * Max time in milliseconds between flushes. Default: 5000
   */
  flushInterval?: number;
}

/**
 * Asynchronous WriteQueue for LmdbStore.
 * Buffers writes and flushes them in batches to optimize performance.
 */
export class WriteQueue {
  private queue: WriteOp[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isClosed = false;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private currentFlush: Promise<void> | null = null;

  constructor(
    private readonly store: LmdbStore,
    options: WriteQueueOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.flushInterval = options.flushInterval ?? 5000;
  }

  /**
   * Enqueue a put operation
   */
  async put(key: string, value: unknown): Promise<void> {
    this.ensureOpen();
    this.enqueue({ type: "put", key, value });
  }

  /**
   * Enqueue a delete operation
   */
  async del(key: string): Promise<void> {
    this.ensureOpen();
    this.enqueue({ type: "del", key });
  }

  private enqueue(op: WriteOp): void {
    this.queue.push(op);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch((err) => {
        logger.error(`[WriteQueue] Auto-flush failed: ${err}`);
      });
    } else {
      this.resetTimer();
    }
  }

  private resetTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.flush().catch((err) => {
        logger.error(`[WriteQueue] Timer-flush failed: ${err}`);
      });
    }, this.flushInterval);
  }

  /**
   * Manually trigger a flush of all pending operations
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // Avoid concurrent flushes
    if (this.currentFlush) {
      await this.currentFlush;
      if (this.queue.length === 0) return;
    }

    const batch = this.queue;
    this.queue = [];

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.currentFlush = (async () => {
      try {
        await this.processBatch(batch);
      } catch (error) {
        // Re-queue failed operations at the front
        this.queue = [...batch, ...this.queue];
        throw new Error(
          `[WriteQueue] Flush failed, operations re-queued: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.currentFlush = null;
      }
    })();

    return this.currentFlush;
  }

  private async processBatch(batch: WriteOp[]): Promise<void> {
    const puts: Array<{ key: string; value: unknown }> = [];
    const dels: string[] = [];

    for (const op of batch) {
      if (op.type === "put") {
        puts.push({ key: op.key, value: op.value });
      } else {
        dels.push(op.key);
      }
    }

    // Process puts in batch
    if (puts.length > 0) {
      await this.store.putMany(puts);
    }

    // Process deletes (individually as LmdbStore doesn't have delMany yet)
    for (const key of dels) {
      await this.store.del(key);
    }
  }

  /**
   * Close the queue, flushing pending operations
   */
  async close(): Promise<void> {
    this.isClosed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private ensureOpen(): void {
    if (this.isClosed) {
      throw new Error("WriteQueue is closed and cannot accept new operations.");
    }
  }

  /**
   * Wait for any pending flush to complete. Useful for testing.
   */
  async waitForFlush(): Promise<void> {
    if (this.currentFlush) {
      await this.currentFlush;
    }
  }
}
