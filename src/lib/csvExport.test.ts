import { describe, expect, it } from 'vitest';
import { escapeCsvText, formatMinorPlain, historyCsv, HISTORY_CSV_HEADER, type HistoryCsvRow } from './csvExport';
import type { Currency } from './finance';

describe('formatMinorPlain', () => {
  it('uses each currency\'s fraction digits', () => {
    expect(formatMinorPlain(1250050, 'IDR')).toBe('12500.50');
    expect(formatMinorPlain(-1250050, 'IDR')).toBe('-12500.50');
    expect(formatMinorPlain(1999, 'TRY')).toBe('19.99');
    expect(formatMinorPlain(1500, 'JPY' as Currency)).toBe('1500');
    expect(formatMinorPlain(-1500, 'JPY' as Currency)).toBe('-1500');
    expect(formatMinorPlain(12345, 'KWD' as Currency)).toBe('12.345');
    expect(formatMinorPlain(12345, 'CLF' as Currency)).toBe('1.2345');
  });

  it('pads small and zero amounts', () => {
    expect(formatMinorPlain(5, 'IDR')).toBe('0.05');
    expect(formatMinorPlain(-5, 'IDR')).toBe('-0.05');
    expect(formatMinorPlain(0, 'IDR')).toBe('0.00');
    expect(formatMinorPlain(7, 'KWD' as Currency)).toBe('0.007');
    expect(formatMinorPlain(0, 'JPY' as Currency)).toBe('0');
  });

  it('keeps large amounts exact', () => {
    expect(formatMinorPlain(900719925474099, 'IDR')).toBe('9007199254740.99');
    expect(() => formatMinorPlain(1.5, 'IDR')).toThrow();
    expect(() => formatMinorPlain(Number.MAX_SAFE_INTEGER + 1, 'IDR')).toThrow();
  });
});

describe('escapeCsvText', () => {
  it('leaves plain text alone', () => {
    expect(escapeCsvText('Makan & minum')).toBe('Makan & minum');
    expect(escapeCsvText('')).toBe('');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(escapeCsvText('Kopi, roti')).toBe('"Kopi, roti"');
    expect(escapeCsvText('Toko "Maju"')).toBe('"Toko ""Maju"""');
    expect(escapeCsvText('baris 1\nbaris 2')).toBe('"baris 1\nbaris 2"');
    expect(escapeCsvText('a\r\nb')).toBe('"a\r\nb"');
  });

  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(escapeCsvText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvText('+62 812')).toBe("'+62 812");
    expect(escapeCsvText('-biaya')).toBe("'-biaya");
    expect(escapeCsvText('@kasir')).toBe("'@kasir");
    expect(escapeCsvText('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(escapeCsvText('Biaya = 5')).toBe('Biaya = 5');
  });
});

describe('historyCsv', () => {
  const row = (overrides: Partial<HistoryCsvRow> = {}): HistoryCsvRow => ({
    date: '2026-11-09', wallet: 'BCA', type: 'Pengeluaran', category: 'Makan & minum',
    amountMinor: -2500000, currency: 'IDR', note: 'Makan siang', ...overrides,
  });

  it('writes a header and one CRLF line per row', () => {
    const csv = historyCsv([row(), row({ type: 'Pemasukan', category: 'Gaji', amountMinor: 1000000000, note: 'Gaji, November' })]);
    expect(csv).toBe([
      HISTORY_CSV_HEADER.join(','),
      '2026-11-09,BCA,Pengeluaran,Makan & minum,-25000.00,IDR,Makan siang',
      '2026-11-09,BCA,Pemasukan,Gaji,10000000.00,IDR,"Gaji, November"',
      '',
    ].join('\r\n'));
  });

  it('writes only the header for no rows', () => {
    expect(historyCsv([])).toBe(`${HISTORY_CSV_HEADER.join(',')}\r\n`);
  });

  it('keeps multi-line notes and mixed currencies intact', () => {
    const csv = historyCsv([
      row({ note: 'baris 1\nbaris 2' }),
      row({ wallet: 'Ziraat', currency: 'TRY', amountMinor: -1999, note: 'Café ₺' }),
    ]);
    expect(csv).toContain('"baris 1\nbaris 2"\r\n');
    expect(csv).toContain('Ziraat,Pengeluaran,Makan & minum,-19.99,TRY,Café ₺\r\n');
    expect(csv.split('\r\n')).toHaveLength(4);
  });
});
