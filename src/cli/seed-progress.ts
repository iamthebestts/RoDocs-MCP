import type {
  SeedFinishStats,
  SeedPhaseEndDetail,
  SeedProgressReporter,
} from "../seed/progress.js";

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

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m${secs.toString().padStart(2, "0")}s`;
}

function progressBar(done: number, total: number, width = 20): string {
  if (total <= 0) return `[${"░".repeat(width)}]`;
  const ratio = Math.min(1, done / total);
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

export function createCliSeedProgressReporter(source: string): SeedProgressReporter {
  const startedAt = Date.now();
  let phaseStartedAt = startedAt;
  let currentPhase = "";
  let liveLine = false;
  const isTTY = process.stderr.isTTY ?? false;

  const writeLine = (line: string): void => {
    process.stderr.write(`${line}\n`);
    liveLine = false;
  };

  const clearLiveLine = (): void => {
    if (liveLine && isTTY) {
      process.stderr.write("\r\x1b[2K");
      liveLine = false;
    }
  };

  const writeLive = (line: string): void => {
    if (isTTY) {
      process.stderr.write(`\r\x1b[2K${line}`);
      liveLine = true;
      return;
    }
    writeLine(line);
  };

  return {
    onPhase(phase, _detail) {
      clearLiveLine();
      currentPhase = phase;
      phaseStartedAt = Date.now();
    },
    onStep(done, total, label) {
      const elapsedMs = Date.now() - phaseStartedAt;
      const phaseElapsedSec = elapsedMs / 1000;
      const rate = done > 0 ? done / Math.max(phaseElapsedSec, 0.5) : 0;
      const remaining = total - done;
      const etaMs = rate > 0 ? (remaining / rate) * 1000 : 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      writeLive(
        [
          styled(ANSI.cyan, "▸"),
          styled(ANSI.bold, source),
          styled(ANSI.yellow, currentPhase),
          progressBar(done, total),
          styled(ANSI.bold, `${done}/${total}`),
          styled(ANSI.dim, `(${pct}%)`),
          styled(ANSI.dim, label),
          styled(ANSI.dim, `· ${formatDuration(elapsedMs)}`),
          remaining > 0 && rate > 0 ? styled(ANSI.dim, `· ~${formatDuration(etaMs)}`) : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
    onNote(message) {
      clearLiveLine();
      writeLine(`  ${styled(ANSI.dim, message)}`);
    },
    onPhaseEnd(phase, stats: SeedPhaseEndDetail) {
      if (phase !== currentPhase) return;
      clearLiveLine();
      const suffix = stats.detail ? styled(ANSI.dim, ` · ${stats.detail}`) : "";
      writeLine(
        `${styled(ANSI.green, "✓")} ${styled(ANSI.bold, source)} ${styled(ANSI.yellow, phase)} ${styled(ANSI.dim, `· ${formatDuration(stats.elapsedMs)}`)}${suffix}`,
      );
      currentPhase = "";
    },
    onFinish(stats: SeedFinishStats) {
      clearLiveLine();
      const parts = [
        styled(ANSI.green, "✓"),
        styled(ANSI.bold, source),
        styled(ANSI.green, "complete"),
        styled(ANSI.dim, `· ${formatDuration(stats.elapsedMs)} total`),
      ];
      if (stats.added !== undefined) parts.push(styled(ANSI.dim, `· added=${stats.added}`));
      if (stats.lowScore !== undefined) parts.push(styled(ANSI.dim, `· low=${stats.lowScore}`));
      if (stats.failed !== undefined) parts.push(styled(ANSI.dim, `· failed=${stats.failed}`));
      if (stats.rejected !== undefined)
        parts.push(styled(ANSI.dim, `· filtered=${stats.rejected}`));
      if (stats.detail) parts.push(styled(ANSI.dim, `· ${stats.detail}`));
      writeLine(parts.join(" "));
    },
  };
}
