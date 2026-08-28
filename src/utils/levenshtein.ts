// \u00danico punto de la app que quita acentos para comparar texto sin
// importar may\u00fasculas/tilde -- antes esta misma l\u00f3gica de 4 l\u00edneas
// estaba copiada 9 veces en 5 archivos (levenshtein.ts, SmartImporter.tsx,
// InventoryModule.tsx x4, POSModule.tsx, smartVolumeDiscount.ts), cada
// una arriesgando divergir con el tiempo (ej. alguna con .trim(), otra
// sin \u00e9l, como pasaba aqu\u00ed).
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function levenshteinDistance(aStr: string, bStr: string): number {
  // Array.from() itera por punto de código Unicode, no por unidad UTF-16 como
  // charAt()/length. Sin esto, un solo emoji (par subrogado) en un nombre de
  // producto se contaba como 2 "caracteres" distintos, inflando la distancia
  // calculada y arruinando la búsqueda difusa para esos productos.
  const a = Array.from(aStr);
  const b = Array.from(bStr);
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
      if (b[i - 1] === a[j - 1]) {
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
