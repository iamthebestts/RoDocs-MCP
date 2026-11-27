import { stemWord } from "./stemmer.js";

const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "do",
  "for",
  "from",
  "get",
  "had",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "s",
  "set",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "you",
]);

export interface TokenizeOptions {
  useStemming?: boolean | undefined;
}

/**
 * Splits a PascalCase or camelCase word into parts.
 *
 * Handles:
 *   - Standard camelCase:         dataStore      → ["data", "Store"]
 *   - Digit boundaries:           v3DataStore    → ["v3", "Data", "Store"]
 *   - Consecutive uppercase:      HTTPSRequest   → ["HTTPS", "Request"]
 *   - Long async names:           GetUserIdFromNameAsync → ["Get","User","Id","From","Name","Async"]
 */
function splitCamelCase(word: string): readonly string[] {
  return word
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/);
}

function isCamelOrPascalCase(word: string): boolean {
  return /[a-z\d][A-Z]/.test(word) || /[A-Z]+[A-Z][a-z]/.test(word);
}

function addToken(result: string[], seen: Set<string>, token: string): void {
  const lower = token.toLowerCase();
  if (lower.length < 2) return;
  if (STOPWORDS.has(lower)) return;
  if (seen.has(lower)) return;
  seen.add(lower);
  result.push(lower);
}

export function tokenize(text: string, options: TokenizeOptions = {}): readonly string[] {
  const words = text
    .replace(/[^a-zA-Z0-9\s_]/g, " ")
    .split(/[\s_]+/)
    .filter((word) => word.length > 0);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    const shouldStem = options.useStemming === true && !isCamelOrPascalCase(word);
    for (const part of splitCamelCase(word)) {
      addToken(result, seen, part);
      if (!shouldStem) continue;
      const stem = stemWord(part);
      if (stem !== part.toLowerCase()) {
        addToken(result, seen, stem);
      }
    }
  }

  return result;
}
