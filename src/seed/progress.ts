export type SeedPhaseEndDetail = {
  elapsedMs: number;
  detail?: string;
};

export type SeedFinishStats = {
  elapsedMs: number;
  added?: number;
  lowScore?: number;
  failed?: number;
  rejected?: number;
  detail?: string;
};

export interface SeedProgressReporter {
  onPhase(phase: string, detail?: string): void;
  onStep(done: number, total: number, label: string): void;
  onNote(message: string): void;
  onPhaseEnd?(phase: string, stats: SeedPhaseEndDetail): void;
  onFinish?(stats: SeedFinishStats): void;
}

export const noopSeedProgress: SeedProgressReporter = {
  onPhase: () => {},
  onStep: () => {},
  onNote: () => {},
  onPhaseEnd: () => {},
  onFinish: () => {},
};

export function throttleStep(
  reporter: SeedProgressReporter,
  minIntervalMs: number,
): SeedProgressReporter {
  let lastEmitAt = 0;
  return {
    onPhase: (phase, detail) => reporter.onPhase(phase, detail),
    onNote: (message) => reporter.onNote(message),
    onPhaseEnd: (phase, stats) => reporter.onPhaseEnd?.(phase, stats),
    onFinish: (stats) => reporter.onFinish?.(stats),
    onStep: (done, total, label) => {
      const now = Date.now();
      const isFinal = done >= total;
      if (!isFinal && now - lastEmitAt < minIntervalMs && done % 5 !== 0) return;
      lastEmitAt = now;
      reporter.onStep(done, total, label);
    },
  };
}
