export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const CURRENT_LEVEL = process.env.LOG_LEVEL
  ? (LogLevel[process.env.LOG_LEVEL.toUpperCase() as keyof typeof LogLevel] ?? LogLevel.INFO)
  : LogLevel.INFO;

export const logger = {
  debug: (...args: unknown[]) => {
    if (CURRENT_LEVEL <= LogLevel.DEBUG) {
      console.error(`[DEBUG]`, ...args);
    }
  },
  info: (...args: unknown[]) => {
    if (CURRENT_LEVEL <= LogLevel.INFO) {
      console.error(`[INFO]`, ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (CURRENT_LEVEL <= LogLevel.WARN) {
      console.error(`[WARN]`, ...args);
    }
  },
  error: (...args: unknown[]) => {
    if (CURRENT_LEVEL <= LogLevel.ERROR) {
      console.error(`[ERROR]`, ...args);
    }
  },
};

export interface LogEvent {
  event: string;
  source: string;
  hit?: boolean;
  durationMs?: number;
  key?: string;
  strategy?: string;
  metadata?: Record<string, unknown>;
}

let _testSink: ((event: LogEvent) => void) | null = null;

export function _setLogEventSinkForTesting(sink: ((event: LogEvent) => void) | null): void {
  _testSink = sink;
}

export function startTimer(): () => number {
  const t = performance.now();
  return () => Math.round(performance.now() - t);
}

export function observe(event: LogEvent): void {
  _testSink?.(event);
  logger.debug(event);
}
