import { describe, expect, it } from 'vitest';
import { guessCsvSeparator, guessDecimalSeparator, guessStatementOrder } from './genericImportHints';

describe('guessCsvSeparator', () => {
  it('picks the one separator every line agrees on', () => {
    expect(guessCsvSeparator('date,description,amount\n2026-01-01,Kopi,10\n')).toBe(',');
    expect(guessCsvSeparator('﻿tanggal;keterangan;nominal\r\n01/01/2026;"Kopi; susu";10,50\r\n')).toBe(';');
    expect(guessCsvSeparator('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(guessCsvSeparator('Mutasi rekening sintetis\n\ntanggal;keterangan;saldo\n01/01/2026;Kopi;10')).toBe(';');
  });
  it('gives no suggestion when the evidence is mixed or missing', () => {
    expect(guessCsvSeparator('a,b;c\n1,2;3')).toBeNull();
    expect(guessCsvSeparator('satu kolom\nsaja')).toBeNull();
    expect(guessCsvSeparator('a,b\n1,2,3')).toBeNull();
    expect(guessCsvSeparator('')).toBeNull();
  });
});

describe('guessDecimalSeparator', () => {
  it('reads the mark before one or two trailing digits', () => {
    expect(guessDecimalSeparator(['1.234,56', '10,5', 12])).toBe(',');
    expect(guessDecimalSeparator(['1,234.56', '-7.25 EUR'])).toBe('.');
  });
  it('ignores ambiguous thousands and refuses mixed evidence', () => {
    expect(guessDecimalSeparator(['1.234', '2,500', 1000])).toBeNull();
    expect(guessDecimalSeparator(['1.50', '2,50'])).toBeNull();
    expect(guessDecimalSeparator([])).toBeNull();
  });
});

describe('guessStatementOrder', () => {
  it('reports the direction only for monotonic dates', () => {
    expect(guessStatementOrder(['2026-01-01', '2026-01-01', '2026-01-03'], 'iso')).toBe('oldest');
    expect(guessStatementOrder(['03/01/2026', '02/01/2026'], 'dmy')).toBe('newest');
    expect(guessStatementOrder(['2026-01-02', '2026-01-01', '2026-01-03'], 'iso')).toBeNull();
    expect(guessStatementOrder(['2026-01-01', '2026-01-01'], 'iso')).toBeNull();
    expect(guessStatementOrder(['2026-01-01', 'bukan tanggal'], 'iso')).toBeNull();
    expect(guessStatementOrder(['2026-01-01'], 'iso')).toBeNull();
  });
});
