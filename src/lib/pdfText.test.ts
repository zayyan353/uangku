import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { extractPdfText } from './pdfText';
import { syntheticPdf } from './testing/syntheticPdf';

const text = (pages: ReturnType<typeof extractPdfText>) => pages.map(runs => runs.map(run => run.text));
const latin1 = (value: string) => Uint8Array.from(value, char => char.charCodeAt(0));

describe('PDF text reader', () => {
  it('reads positioned text through a ToUnicode CMap, in drawing order per page', () => {
    const pages = extractPdfText(syntheticPdf([
      [{ x: 24, y: 700, size: 10, text: 'Tanggal & Waktu' }, { x: 86.5, y: 688.25, size: 8, text: 'café – ID# 7' }],
      [{ x: 30, y: 500, size: 12, text: 'Halaman kedua', font: 'F1' }],
    ]));
    expect(pages).toEqual([
      [{ x: 24, y: 700, size: 10, text: 'Tanggal & Waktu' }, { x: 86.5, y: 688.25, size: 8, text: 'café – ID# 7' }],
      [{ x: 30, y: 500, size: 12, text: 'Halaman kedua' }],
    ]);
  });

  it('opens dictionaries stored in an object stream with a cross-reference stream', () => {
    const pages = extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'OBJEK GABUNGAN' }]], { objectStream: true }));
    expect(text(pages)).toEqual([['OBJEK GABUNGAN']]);
  });

  it('maps ligatures from an array-form bfrange and known glyphs left out of the CMap', () => {
    expect(text(extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'daftar' }]], { ligature: 'mapped' })))).toEqual([['daftar']]);
    expect(text(extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'daftar' }]], { ligature: 'unmapped', baseFont: 'TTCommons-Regular' })))).toEqual([['daftar']]);
    // Another font family gets no guess: the glyph stays visibly unknown.
    expect(text(extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'daftar' }]], { ligature: 'unmapped' })))).toEqual([['da�ar']]);
  });

  it('follows text matrices, TJ arrays, escapes in literal strings, and skips inline images', () => {
    const raw = [
      'q 2 0 0 2 10 20 cm BT /F2 5 Tf 1 0 0 1 3 4 Tm <0041> Tj ET Q',
      'BT /F2 10 Tf 100 200 Td [<0042> -400 <0043>] TJ 12 TL T* <0044> Tj ET',
      'BI /W 1 /H 1 /BPC 8 /CS /G ID \x00\xff EI',
      'BT /F2 10 Tf 0 0 Td (\\(x\\)\\101) Tj ET',
    ].join('\n');
    const pages = extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: '()xABCD' }]], { rawContent: raw }));
    expect(pages[0].slice(1).map(({ x, y, size, text }) => ({ x, y, size, text }))).toEqual([
      { x: 16, y: 28, size: 10, text: 'A' },
      { x: 100, y: 200, size: 10, text: 'B C' },
      { x: 100, y: 188, size: 10, text: 'D' },
      // Two-byte codes: "(x" is 0x2878 and ")A" is 0x2941, neither in the map.
      { x: 0, y: 0, size: 10, text: '��' },
    ]);
  });

  it('refuses files that are not readable statements instead of guessing', () => {
    expect(() => extractPdfText(new Uint8Array())).toThrow('File kosong');
    expect(() => extractPdfText(latin1('PK\x03\x04 bukan pdf'))).toThrow('bukan PDF');
    expect(() => extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'X' }]], { encrypt: true }))).toThrow('terenkripsi');
    expect(() => extractPdfText(syntheticPdf([[{ x: 1, y: 2, size: 9, text: 'X' }]], { encrypt: true, objectStream: true }))).toThrow('terenkripsi');
    expect(() => extractPdfText(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow('terlalu besar');
  });

  it('stops a small compressed stream that would expand beyond the budget', () => {
    const bomb = zlibSync(new Uint8Array(49 * 1024 * 1024));
    const pdf = latin1(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Contents 4 0 R >> endobj\n4 0 obj << /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`);
    const bytes = new Uint8Array(pdf.length + bomb.length + 20);
    bytes.set(pdf); bytes.set(bomb, pdf.length); bytes.set(latin1('\nendstream endobj\n'), pdf.length + bomb.length);
    expect(() => extractPdfText(bytes)).toThrow('terlalu besar');
  });

  it('rejects compression it cannot decode', () => {
    const pdf = latin1('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Contents 4 0 R >> endobj\n4 0 obj << /Filter /LZWDecode /Length 1 >>\nstream\nx\nendstream endobj\n');
    expect(() => extractPdfText(pdf)).toThrow('belum didukung');
  });
});
