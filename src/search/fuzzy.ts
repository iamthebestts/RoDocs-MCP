export function levenshteinDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= right.length; j++) {
      previous[j] = current[j] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}

export function findClosestMatch(
  input: string,
  candidates: string[],
  maxDistance?: number,
): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || candidates.length === 0) return null;

  const threshold = maxDistance ?? (trimmed.length >= 6 ? 2 : 1);
  let best: { candidate: string; distance: number } | null = null;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(trimmed, candidate);
    if (distance > threshold) continue;
    if (best === null || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best?.candidate ?? null;
}
