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

  it("cancels shutdown state when a new connection arrives", () => {
    const idle = new IdleShutdown({ idleMs: 60_000, onShutdown: async () => {} });
    idle.state = "shutting_down";

    idle.connectionOpened({});

    expect(idle.state).toBe("ready");
    expect(idle.activeCount).toBe(1);
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
