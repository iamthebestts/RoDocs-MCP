import { logger } from "../utils/logger.js";

export interface Job {
  name: string;
  task: () => Promise<void>;
  intervalMs: number;
  constraints?: (now: Date) => boolean;
}

export class JobRunner {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor(private options: { jobsOptional?: boolean } = {}) {}

  async schedule(job: Job) {
    if (this.options.jobsOptional === false && !job.task) {
      throw new Error(`Job ${job.name} is mandatory but has no task`);
    }

    this.scheduleNext(job);
  }

  private scheduleNext(job: Job) {
    if (!this.isRunning) return;
    const timer = setTimeout(() => this.runJob(job), job.intervalMs);
    this.timers.set(job.name, timer);
  }

  private async runJob(job: Job) {
    const now = new Date();
    if (job.constraints && !job.constraints(now)) {
      logger.debug(`[JobRunner] skipped job ${job.name}: constraints not met`);
      this.scheduleNext(job);
      return;
    }

    try {
      logger.debug(`[JobRunner] started job ${job.name}`);
      await job.task();
      logger.debug(`[JobRunner] completed job ${job.name}`);
    } catch (e) {
      logger.error(
        `[JobRunner] failed job ${job.name} with reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.scheduleNext(job);
    }
  }

  start() {
    this.isRunning = true;
  }

  stop() {
    this.isRunning = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
