import { describe, expect, it, vi } from 'vitest';
import { extractPdfText } from './pdfText';
import { syntheticPdf, type SyntheticText } from './testing/syntheticPdf';

// Small budgets exercise the same extraction path without large PDF files or allocations.
vi.mock('./importLimits', () => ({ MAX_PDF_FONT_MAPPINGS: 8, MAX_PDF_DOCUMENT_MAPPINGS: 12 }));

const a = { x: 0, y: 0, size: 8, text: 'A' };
const mapError = 'Peta karakter PDF tidak valid.';
const pair = '1 beginbfchar <0041> <0041> endbfchar';
const range = '1 beginbfrange <0041> <0042> <0041> endbfrange';
const array = '1 beginbfrange <0041> <0042> [<0041> <0042>] endbfrange';

function read(mappings: string[], pages: SyntheticText[][] = [[a]]) {
  return extractPdfText(syntheticPdf(pages, { toUnicode: mappings.join('\n') }));
}

describe('PDF font mapping budgets', () => {
  it('accepts the last mapping, including overlapping scalar and array ranges and single codes', () => {
    expect(read([pair, pair, range, array, range])[0][0].text).toBe('A');
  });
  it.each([pair, range, array])('counts repeated mappings before adding %s beyond a full font', extra => {
    expect(() => read([range, range, range, range, extra])).toThrow(mapError);
  });
  it('rejects a glyph code outside the PDF range of one to four bytes', () => {
    expect(() => read(['1 beginbfchar <0000000041> <0041> endbfchar'])).toThrow(mapError);
  });
  it('charges distinct fonts across pages but reuses a previously decoded font', () => {
    const six = [range, array, range];
    const pages: SyntheticText[][] = [[a], [{ ...a, font: 'F1' }], [a]];
    expect(read(six, pages).map(runs => runs[0].text)).toEqual(['A', 'A', 'A']);
    expect(() => read(six, [...pages, [{ ...a, font: 'F3' }]])).toThrow(mapError);
    expect(read(six, pages)).toHaveLength(3);
  });
});
