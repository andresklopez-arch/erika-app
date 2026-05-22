export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  let i, j;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          ),
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function fuzzySearch<T>(
  query: string,
  items: T[],
  keySelector: (item: T) => string,
  maxDistance: number = 3,
): T[] {
  if (!query.trim()) return [];
  const normalizedQuery = normalizeText(query);
  const queryTerms = normalizedQuery.split(" ").filter((t) => t.length > 0);

  return items.filter((item) => {
    const itemText = normalizeText(keySelector(item));
    const itemWords = itemText.split(" ");

    return queryTerms.every((term) => {
      if (itemText.includes(term)) return true;
      return itemWords.some(
        (word) => levenshteinDistance(term, word) <= maxDistance,
      );
    });
  });
}
