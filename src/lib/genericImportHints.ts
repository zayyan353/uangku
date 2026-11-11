import { parseStatementDate, type GenericMapping } from './genericImport';

export type CsvSeparator = ',' | ';' | '\t';

/**
 * Which separator the first lines of a CSV most plausibly use. Counts each
 * candidate outside quotes, skipping lines that hold none of them (a title
 * above the table); a candidate wins only if every sampled line has the same
 * non-zero count and no other candidate does. Otherwise null: the
 * caller keeps the user's choice. This is a starting suggestion, not a parse.
 */
export function guessCsvSeparator(text: string): CsvSeparator | null {
  // Title or note lines above the table usually hold none of the separators; they say nothing either way.
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(line => /[,;\t]/.test(line)).slice(0, 10);
  if (!lines.length) return null;
  const consistent = ([',', ';', '\t'] as const).filter(separator => {
    const counts = lines.map(line => {
      let quoted = false, count = 0;
      for (const char of line) { if (char === '"') quoted = !quoted; else if (char === separator && !quoted) count++; }
      return count;
    });
    return counts[0] > 0 && counts.every(count => count === counts[0]);
  });
  return consistent.length === 1 ? consistent[0] : null;
}

/**
 * Which decimal mark the text amounts use, judged only from values that end in
 * one or two digits after a mark ("1.234,56", "12.5"). Three digits after a
 * mark are ambiguous (thousands or decimals) and are ignored. Mixed evidence
 * or no evidence gives null.
 */
export function guessDecimalSeparator(values: readonly unknown[]): '.' | ',' | null {
  let dot = 0, comma = 0;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = /([.,])\d{1,2}$/.exec(value.trim().replace(/[^\d.,]+$/, ''));
    if (match) { if (match[1] === '.') dot++; else comma++; }
  }
  return dot > 0 && comma === 0 ? '.' : comma > 0 && dot === 0 ? ',' : null;
}

/** Whether dated rows run oldest-first or newest-first; null when dates are unreadable, equal, or not monotonic. */
export function guessStatementOrder(values: readonly unknown[], format: GenericMapping['dateFormat']): 'oldest' | 'newest' | null {
  const dates: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    try { dates.push(parseStatementDate(value, format)); } catch { return null; }
  }
  if (dates.length < 2) return null;
  let rising = false, falling = false;
  for (let index = 1; index < dates.length; index++) {
    if (dates[index] > dates[index - 1]) rising = true; else if (dates[index] < dates[index - 1]) falling = true;
  }
  return rising && !falling ? 'oldest' : falling && !rising ? 'newest' : null;
}
