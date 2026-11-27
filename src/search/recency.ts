export interface RecencyConfig {
  halfLifeDays?: number | undefined;
  minMultiplier?: number | undefined;
  enabled?: boolean | undefined;
}

export function applyRecencyBoost(
  score: number,
  ageDays: number,
  config: RecencyConfig = {},
): number {
  if (config.enabled === false) return score;
  const halfLifeDays = config.halfLifeDays ?? 365;
  const minMultiplier = config.minMultiplier ?? 0.5;
  const multiplier = Math.max(minMultiplier, 2 ** (-ageDays / halfLifeDays));
  return score * multiplier;
}
