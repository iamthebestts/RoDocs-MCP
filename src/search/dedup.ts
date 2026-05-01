export interface DuplicateAwareResult {
  title?: string | undefined;
  name?: string | undefined;
  path?: string | undefined;
  score: number;
  isDuplicate?: boolean | undefined;
}

export type GroupedResults<T extends DuplicateAwareResult = DuplicateAwareResult> = Record<
  string,
  readonly T[]
>;

type MarkedGroups<T extends Record<string, readonly DuplicateAwareResult[]>> = {
  [K in keyof T]: Array<T[K][number] & { isDuplicate?: boolean | undefined }>;
};

function titleOf(result: DuplicateAwareResult): string {
  return result.title ?? result.name ?? result.path ?? "";
}

function normalizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

export function markDuplicates<T extends Record<string, readonly DuplicateAwareResult[]>>(
  results: T,
): MarkedGroups<T> {
  const entries = Object.entries(results).flatMap(([source, sourceResults]) =>
    sourceResults.map((result, index) => ({
      source,
      index,
      result,
      words: normalizeTitle(titleOf(result)),
    })),
  );

  const duplicateKeys = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const left = entries[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const right = entries[j];
      if (right === undefined || left.source === right.source) continue;
      if (jaccard(left.words, right.words) < 0.7) continue;

      const duplicate = left.result.score <= right.result.score ? left : right;
      duplicateKeys.add(`${duplicate.source}:${duplicate.index}`);
    }
  }

  return Object.fromEntries(
    Object.entries(results).map(([source, sourceResults]) => [
      source,
      sourceResults.map((result, index) => ({
        ...result,
        ...(duplicateKeys.has(`${source}:${index}`) ? { isDuplicate: true } : {}),
      })),
    ]),
  ) as MarkedGroups<T>;
}
