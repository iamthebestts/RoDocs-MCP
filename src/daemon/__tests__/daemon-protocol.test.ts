import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecodeError, FrameDecoder } from "../daemon-protocol.js";

describe("daemon protocol framing", () => {
  it("encodes and decodes multiple frames", () => {
    const decoder = new FrameDecoder();
    const data = Buffer.concat([
      encodeFrame({ type: "ping" }),
      encodeFrame({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    ]);

    expect(decoder.push(data)).toEqual([
      { type: "ping" },
      { jsonrpc: "2.0", id: 1, method: "initialize" },
    ]);
  });

  it("handles partial frames", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ type: "pong" });

    expect(decoder.push(frame.subarray(0, 3))).toEqual([]);
    expect(decoder.push(frame.subarray(3))).toEqual([{ type: "pong" }]);
  });

  it("rejects malformed length frames", () => {
    const decoder = new FrameDecoder();
    const malformed = Buffer.alloc(4);
    malformed.writeUInt32BE(0, 0);

    expect(() => decoder.push(malformed)).toThrow(FrameDecodeError);
  });
});
