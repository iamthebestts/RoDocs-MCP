import { describe, expect, it, vi } from "vitest";
import { IdleShutdown } from "../idle-shutdown.js";

describe("IdleShutdown", () => {
  it("shuts down after 60 seconds with zero active connections", async () => {
    vi.useFakeTimers();
    const onShutdown = vi.fn(async () => {});
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown });

    idle.scheduleIfIdle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(idle.state).toBe("closed");
    vi.useRealTimers();
  });

  it("does not shut down while a connection is active", async () => {
    vi.useFakeTimers();
    const onShutdown = vi.fn(async () => {});
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown });

    idle.connectionOpened({});
    idle.scheduleIfIdle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onShutdown).not.toHaveBeenCalled();
    expect(idle.activeCount).toBe(1);
    vi.useRealTimers();
  });

  it("rejects a connection that arrives while shutdown is in flight", async () => {
    let resolveShutdown: () => void = () => {};
    const onShutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    );
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown });

    const shutdown = idle.beginShutdown();
    expect(idle.state).toBe("shutting_down");

    // A committed shutdown cannot be cancelled and accepts no new connections.
    expect(idle.connectionOpened({})).toBe(false);
    expect(idle.activeCount).toBe(0);
    expect(idle.state).toBe("shutting_down");

    resolveShutdown();
    await shutdown;
    expect(idle.state).toBe("closed");
  });

  it("does not revert an in-flight shutdown via cancelShutdown", async () => {
    let resolveShutdown: () => void = () => {};
    const idle = new IdleShutdown({
      idleMs: 60_000,
      onShutdown: () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    });

    const shutdown = idle.beginShutdown();
    idle.cancelShutdown();

    expect(idle.state).toBe("shutting_down");
    resolveShutdown();
    await shutdown;
    expect(idle.state).toBe("closed");
  });

  it("accepts a connection while the idle timer is merely pending", () => {
    vi.useFakeTimers();
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown: async () => {} });

    idle.scheduleIfIdle(); // timer armed, shutdown not yet started
    expect(idle.connectionOpened({})).toBe(true);
    expect(idle.activeCount).toBe(1);
    expect(idle.state).toBe("ready");
    vi.useRealTimers();
  });

  it("increments and decrements active count once per lifecycle", () => {
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown: async () => {} });
    const token = {};

    idle.connectionOpened(token);
    idle.connectionClosed(token);
    idle.connectionClosed(token);

    expect(idle.activeCount).toBe(0);
  });
});
