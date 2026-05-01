const SUFFIXES = [
  ["ization", "ize"],
  ["isation", "ise"],
  ["ating", "ate"],
  ["ing", ""],
  ["tion", "t"],
  ["sion", "s"],
  ["ment", ""],
  ["ness", ""],
  ["able", ""],
  ["ible", ""],
  ["less", ""],
  ["ful", ""],
  ["ous", ""],
  ["ive", ""],
  ["est", ""],
  ["ed", ""],
  ["er", ""],
  ["ly", ""],
  ["al", ""],
  ["ize", ""],
  ["ise", ""],
] as const;

function hasDoubleFinalConsonant(value: string): boolean {
  if (value.length < 2) return false;
  const last = value.at(-1);
  return last === value.at(-2) && last !== undefined && !/[aeiou]/.test(last);
}

function normalizeStem(stem: string): string {
  if (hasDoubleFinalConsonant(stem)) return stem.slice(0, -1);
  if (/at$/.test(stem)) return `${stem}e`;
  return stem;
}

export function stemWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length < 4) return lower;

  for (const [suffix, replacement] of SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const base = lower.slice(0, -suffix.length);
    if (base.length < 2) return lower;
    return normalizeStem(`${base}${replacement}`);
  }

  return lower;
}
