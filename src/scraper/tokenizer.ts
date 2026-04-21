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

export function tokenize(text: string): readonly string[] {
  const words = text
    .replace(/[^a-zA-Z0-9\s_]/g, " ")
    .split(/[\s_]+/)
    .flatMap(splitCamelCase);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 2) continue;
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }

  return result;
}
