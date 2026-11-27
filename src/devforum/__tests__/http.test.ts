import type https from "node:https";
import { describe, expect, it } from "vitest";
import { devForumClient } from "../http.js";

describe("devForum http client", () => {
  it("registers socket hygiene listeners on the https agent", () => {
    const agent = devForumClient.defaults.httpsAgent as https.Agent;
    expect(agent.listenerCount("free")).toBeGreaterThan(0);
    expect(agent.listenerCount("socket")).toBeGreaterThan(0);
  });

  it("does not emit MaxListenersExceededWarning under keep-alive reuse", async () => {
    let maxListenerWarnings = 0;
    const originalEmitWarning = process.emitWarning.bind(process);
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const message = typeof warning === "string" ? warning : warning.message;
      if (message.includes("MaxListenersExceededWarning")) {
        maxListenerWarnings++;
      }
      return originalEmitWarning(warning as never, ...(args as never[]));
    }) as typeof process.emitWarning;

    try {
      const urls = Array.from({ length: 15 }, (_, i) => `https://httpbin.org/get?n=${i}`);
      await Promise.all(urls.map((url) => devForumClient.get(url)));
      expect(maxListenerWarnings).toBe(0);
    } finally {
      process.emitWarning = originalEmitWarning;
    }
  }, 30_000);
});
