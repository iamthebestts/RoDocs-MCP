import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const DAEMON_HOST = "127.0.0.1";
export const DAEMON_PORT = 30030;
export const MAX_FRAME_LENGTH = 16 * 1024 * 1024;

export type DaemonControlMessage = { type: "ping" } | { type: "pong" };
export type DaemonFrame = DaemonControlMessage | JSONRPCMessage;

export class FrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameDecodeError";
  }
}

export function encodeFrame(message: DaemonFrame): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length === 0 || body.length > MAX_FRAME_LENGTH) {
    throw new FrameDecodeError(`Frame length ${body.length} is outside the allowed range.`);
  }

  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DaemonFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: DaemonFrame[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_LENGTH) {
        throw new FrameDecodeError(`Malformed frame length: ${length}.`);
      }
      if (this.buffer.length < 4 + length) break;

      const body = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      frames.push(parseFrameBody(body));
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export function isPing(message: DaemonFrame): message is { type: "ping" } {
  return isObject(message) && (message as Record<string, unknown>).type === "ping";
}

export function isPong(message: DaemonFrame): message is { type: "pong" } {
  return isObject(message) && (message as Record<string, unknown>).type === "pong";
}

export function isJsonRpcMessage(message: DaemonFrame): message is JSONRPCMessage {
  return isObject(message) && "jsonrpc" in message;
}

function parseFrameBody(body: string): DaemonFrame {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isObject(parsed)) {
      throw new FrameDecodeError("Frame body must be a JSON object.");
    }
    return parsed as DaemonFrame;
  } catch (error) {
    if (error instanceof FrameDecodeError) throw error;
    throw new FrameDecodeError(
      `Frame body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
