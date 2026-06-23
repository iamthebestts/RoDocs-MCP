import type { SeedProgressReporter } from "../seed/progress.js";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

function styled(code: string, text: string): string {
  return `${code}${text}${ANSI.reset}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m${secs.toString().padStart(2, "0")}s`;
}

function progressBar(done: number, total: number, width = 24): string {
  if (total <= 0) return `[${"░".repeat(width)}]`;
  const ratio = Math.min(1, done / total);
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

export function createCliSeedProgressReporter(source: string): SeedProgressReporter {
  const startedAt = Date.now();
  let phaseStartedAt = startedAt;
  const write = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };

  return {
    onPhase(phase, detail) {
      phaseStartedAt = Date.now();
      const detailSuffix = detail ? ` ${styled(ANSI.dim, `— ${detail}`)}` : "";
      write(
        `${styled(ANSI.cyan, "▸")} ${styled(ANSI.bold, source)} ${styled(ANSI.yellow, phase)}${detailSuffix}`,
      );
    },
    onStep(done, total, label) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const phaseElapsedSec = (Date.now() - phaseStartedAt) / 1000;
      const rate = done > 0 ? done / Math.max(phaseElapsedSec, 0.5) : 0;
      const remaining = total - done;
      const etaSec = rate > 0 ? remaining / rate : 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      write(
        [
          `  ${progressBar(done, total)}`,
          `${styled(ANSI.bold, `${done}/${total}`)}`,
          styled(ANSI.dim, `(${pct}%)`),
          styled(ANSI.dim, label),
          styled(ANSI.dim, `· ${formatDuration(elapsedSec)} elapsed`),
          remaining > 0 && rate > 0 ? styled(ANSI.dim, `· ~${formatDuration(etaSec)} left`) : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
    onNote(message) {
      write(`  ${styled(ANSI.dim, message)}`);
    },
  };
}
