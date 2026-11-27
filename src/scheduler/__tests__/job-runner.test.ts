import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Job, JobRunner } from "../job-runner.js";

describe("JobRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should run a job and reschedule it", async () => {
    const runner = new JobRunner();
    const task = vi.fn().mockResolvedValue(undefined);
    const job: Job = {
      name: "test-job",
      task,
      intervalMs: 1000,
    };

    runner.start();
    await runner.schedule(job);

    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    await Promise.resolve(); // flush microtasks
    expect(task).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("should respect constraints", async () => {
    const runner = new JobRunner();
    const task = vi.fn().mockResolvedValue(undefined);
    const job: Job = {
      name: "constrained-job",
      task,
      intervalMs: 1000,
      constraints: (now) => now.getUTCHours() === 10,
    };

    runner.start();
    await runner.schedule(job);

    // Mock now to be hour 11
    vi.setSystemTime(new Date("2026-04-30T11:00:00Z"));
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();

    // Mock now to be hour 10
    vi.setSystemTime(new Date("2026-04-30T10:00:00Z"));
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("should stop all timers on stop()", async () => {
    const runner = new JobRunner();
    const task = vi.fn().mockResolvedValue(undefined);
    const job: Job = {
      name: "stop-job",
      task,
      intervalMs: 1000,
    };

    runner.start();
    await runner.schedule(job);

    runner.stop();
    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();
    expect(task).not.toHaveBeenCalled();
  });
});
