/** Command verbs and very common choice words that are worth biasing the recognizer toward. */
export const COMMAND_HOTWORDS = [
  'poll',
  'predict',
  'prediction',
  'end',
  'cancel',
  'lock',
  'repeat',
  'options',
  'wins',
  'win',
  'loss',
];

/**
 * Build a sherpa-onnx hotwords file for an English BPE model without needing a bpe.vocab file:
 * each word is split greedily into the longest pieces present in tokens.txt, and the pieces are written
 * space-separated so sherpa looks them up directly in the symbol table.
 */
export function parseTokens(tokensTxt: string): Set<string> {
  const pieces = new Set<string>();
  for (const line of tokensTxt.split(/\r?\n/)) {
    const piece = line.trim().split(/\s+/)[0];
    if (piece) pieces.add(piece);
  }
  return pieces;
}

export function tokenizeWord(word: string, pieces: Set<string>): string[] | null {
  const upper = word.toUpperCase().replace(/[^A-Z']/g, '');
  if (!upper) return null;
  const text = `▁${upper}`;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let found: string | null = null;
    for (let j = text.length; j > i; j--) {
      const cand = text.slice(i, j);
      if (pieces.has(cand)) {
        found = cand;
        break;
      }
    }
    if (!found) return null;
    out.push(found);
    i += found.length;
  }
  return out;
}

export function buildHotwordsFile(phrases: string[], tokensTxt: string): string {
  const pieces = parseTokens(tokensTxt);
  const lines = new Set<string>();
  for (const phrase of phrases) {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    const encoded = words.map((w) => tokenizeWord(w, pieces));
    if (encoded.length && encoded.every((e) => e)) lines.add(encoded.flat().join(' '));
  }
  return [...lines].join('\n') + '\n';
}
