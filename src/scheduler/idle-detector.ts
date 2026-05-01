export class IdleDetector {
  private lastActivity: number = Date.now();
  private readonly idleThresholdMs: number;

  constructor(idleThresholdMs: number = 60_000) {
    this.idleThresholdMs = idleThresholdMs;
  }

  recordActivity() {
    this.lastActivity = Date.now();
  }

  isIdle(): boolean {
    return Date.now() - this.lastActivity > this.idleThresholdMs;
  }
}
