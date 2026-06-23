import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliSeedProgressReporter } from "../seed-progress.js";

describe("createCliSeedProgressReporter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes phase and step progress to stderr", () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const reporter = createCliSeedProgressReporter("devforum");
    reporter.onPhase("discovery", "10 fetches");
    reporter.onStep(3, 10, "discovery fetches");

    expect(writes.join("")).toContain("devforum");
    expect(writes.join("")).toContain("discovery");
    expect(writes.join("")).toContain("3/10");
    expect(writes.join("")).toContain("█");
  });
});
