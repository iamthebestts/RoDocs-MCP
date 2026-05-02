export type IdleState = "ready" | "shutting_down" | "closed";

export interface IdleShutdownOptions {
  idleMs: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onShutdown: () => Promise<void>;
}

export class IdleShutdown {
  private activeConnections = 0;
  private closeSeen = new WeakSet<object>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private shutdownPromise: Promise<void> | null = null;
  state: IdleState = "ready";
  lastActivity: number;

  constructor(private readonly options: IdleShutdownOptions) {
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.lastActivity = this.now();
  }

  get activeCount(): number {
    return this.activeConnections;
  }

  recordActivity(): void {
    this.lastActivity = this.now();
  }

  connectionOpened(token: object): void {
    if (this.state === "shutting_down") {
      this.cancelShutdown();
    }
    if (this.state === "closed") return;
    this.activeConnections += 1;
    this.closeSeen.delete(token);
    this.recordActivity();
    this.clearTimer();
  }

  connectionClosed(token: object): void {
    if (this.closeSeen.has(token)) return;
    this.closeSeen.add(token);
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.recordActivity();
    this.scheduleIfIdle();
  }

  scheduleIfIdle(): void {
    if (this.state !== "ready" || this.activeConnections !== 0 || this.timer !== null) return;

    const elapsed = this.now() - this.lastActivity;
    const delay = Math.max(0, this.options.idleMs - elapsed);
    this.timer = this.setTimeoutFn(() => {
      void this.beginShutdown();
    }, delay);
  }

  async beginShutdown(): Promise<void> {
    if (this.state === "closed") return;
    if (this.activeConnections > 0) {
      this.cancelShutdown();
      return;
    }
    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }

    this.clearTimer();
    this.state = "shutting_down";
    this.shutdownPromise = this.options
      .onShutdown()
      .then(() => {
        this.state = "closed";
      })
      .finally(() => {
        this.shutdownPromise = null;
      });
    return this.shutdownPromise;
  }

  cancelShutdown(): void {
    if (this.state === "closed") return;
    this.state = "ready";
    this.clearTimer();
    this.recordActivity();
  }

  dispose(): void {
    this.clearTimer();
    this.state = "closed";
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clearTimeoutFn(this.timer);
    this.timer = null;
  }
}
