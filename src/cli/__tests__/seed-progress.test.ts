import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliSeedProgressReporter } from "../seed-progress.js";

function mockStderrTTY(isTTY: boolean): void {
  Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true });
}

describe("createCliSeedProgressReporter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates a single live step line without newlines on TTY", () => {
    const writes: string[] = [];
    mockStderrTTY(true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const reporter = createCliSeedProgressReporter("devforum");
    reporter.onPhase("discovery", "10 fetches");
    reporter.onStep(3, 10, "discovery fetches");

    const output = writes.join("");
    expect(output).toContain("devforum");
    expect(output).toContain("discovery");
    expect(output).toContain("3/10");
    expect(output).toContain("█");
    expect(output).not.toContain("\n");
  });

  it("writes a completion line when a phase ends", () => {
    const writes: string[] = [];
    mockStderrTTY(true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const reporter = createCliSeedProgressReporter("devforum");
    reporter.onPhase("discovery", "10 fetches");
    reporter.onPhaseEnd?.("discovery", { elapsedMs: 1500, detail: "42 cached" });

    const output = writes.join("");
    expect(output).toContain("✓");
    expect(output).toContain("discovery");
    expect(output).toContain("42 cached");
    expect(output).toContain("\n");
  });

  it("writes final stats on finish", () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const reporter = createCliSeedProgressReporter("devforum");
    reporter.onFinish?.({
      elapsedMs: 60_000,
      added: 12,
      failed: 1,
      detail: "discovery from cache",
    });

    const output = writes.join("");
    expect(output).toContain("complete");
    expect(output).toContain("added=12");
    expect(output).toContain("failed=1");
    expect(output).toContain("discovery from cache");
  });
});
