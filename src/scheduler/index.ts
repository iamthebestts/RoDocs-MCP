import { IdleDetector } from "./idle-detector.js";
import { JobRunner } from "./job-runner.js";
import { RateLimiter } from "./rate-limiter.js";

export class Scheduler {
  public readonly jobRunner: JobRunner;
  public readonly idleDetector: IdleDetector;
  public readonly devForumRateLimiter: RateLimiter;

  constructor(options: { jobsOptional?: boolean } = {}) {
    this.jobRunner = new JobRunner(options);
    this.idleDetector = new IdleDetector();
    this.devForumRateLimiter = new RateLimiter(1); // 1 req/s
  }

  start() {
    this.jobRunner.start();
  }

  stop() {
    this.jobRunner.stop();
  }

  recordActivity() {
    this.idleDetector.recordActivity();
  }
}
