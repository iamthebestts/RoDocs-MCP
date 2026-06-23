export interface SeedProgressReporter {
  onPhase(phase: string, detail?: string): void;
  onStep(done: number, total: number, label: string): void;
  onNote(message: string): void;
}

export const noopSeedProgress: SeedProgressReporter = {
  onPhase: () => {},
  onStep: () => {},
  onNote: () => {},
};

export function throttleStep(
  reporter: SeedProgressReporter,
  minIntervalMs: number,
): SeedProgressReporter {
  let lastEmitAt = 0;
  return {
    onPhase: (phase, detail) => reporter.onPhase(phase, detail),
    onNote: (message) => reporter.onNote(message),
    onStep: (done, total, label) => {
      const now = Date.now();
      const isFinal = done >= total;
      if (!isFinal && now - lastEmitAt < minIntervalMs && done % 5 !== 0) return;
      lastEmitAt = now;
      reporter.onStep(done, total, label);
    },
  };
}
