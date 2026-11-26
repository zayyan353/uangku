import { describe, expect, it } from 'vitest';
import { escapeCsvText, formatMinorPlain, historyCsv, historyCsvRows, HISTORY_CSV_HEADER, type HistoryCsvRow } from './csvExport';
import type { Currency, Entry, Wallet } from './finance';

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

describe('MW-89: transfer rows in a filtered history export', () => {
  const wallet = (id: string, name: string, currency: Currency): Wallet => ({ id, name, currency, kind: 'bank', openingBalance: 0 });
  const wallets = [wallet('jago', 'Bank Jago', 'IDR'), wallet('ziraat', 'Ziraat', 'TRY'), wallet('other', '@Rekening, B', 'IDR')];
  const transfer: Entry = { id: 'fx', date: '2026-10-31', type: 'transfer', walletId: 'jago', toWalletId: 'ziraat',
    amount: 100_000_000, toAmount: 250_000, fee: 650_000, note: 'pindah', category: '' };
  const title = () => '=Uji';
  const dates = { transfers: [{ entryId: 'fx', sourceDate: '2026-10-31', destinationDate: '2026-11-01' }] };

  it('uses each wallet’s currency and posting date, including the fee once in the debit', () => {
    const rows = (currency: Currency) => historyCsvRows([transfer], wallets, { currency, title, postingContext: dates });
    expect(rows('IDR')).toEqual([{ date: '2026-10-31', wallet: 'Bank Jago', type: 'Transfer', category: '',
      amountMinor: -100_650_000, currency: 'IDR', note: '=Uji' }]);
    expect(rows('TRY')).toEqual([{ date: '2026-11-01', wallet: 'Ziraat', type: 'Transfer', category: '',
      amountMinor: 250_000, currency: 'TRY', note: '=Uji' }]);
  });

  it('exports both wallets of a same-currency transfer only when their dates and wallet filter match', () => {
    const local = { ...transfer, toWalletId: 'other', toAmount: transfer.amount };
    const options = { currency: 'IDR' as const, title, postingContext: dates };
    const rows = historyCsvRows([local], wallets, options);
    expect(rows.map(row => row.amountMinor)).toEqual([-100_650_000, 100_000_000]);
    expect(historyCsv(rows)).toContain(`2026-11-01,"'@Rekening, B",Transfer,,1000000.00,IDR,'=Uji\r\n`);
    expect(historyCsvRows([local], wallets, { ...options, month: '2026-10' })).toEqual([rows[0]]);
    expect(historyCsvRows([local], wallets, { ...options, walletId: 'other' })).toEqual([rows[1]]);
  });

  it('keeps an undated side findable without assigning it a calendar date', () => {
    const postingContext = { links: [{ entryId: 'fx', postingDates: { source: null, destination: '2026-11-01' } }] };
    const rows = historyCsvRows([transfer], wallets, { currency: 'IDR', month: '2026-10', title, postingContext });
    expect(rows.map(row => row.date)).toEqual(['']);
  });

  it('keeps ordinary entries in the mixed-currency review queue and preserves the existing signs and labels', () => {
    const ordinary: Entry[] = [
      { id: 'a', date: '2026-10-31', type: 'expense', walletId: 'jago', note: 'makan', amount: 25, category: '' },
      { id: 'b', date: '2026-10-30', type: 'unreviewed', walletId: 'ziraat', note: 'periksa', amount: -75, category: '' },
    ];
    const rows = historyCsvRows(ordinary, wallets, { title: entry => entry.note });
    expect(rows.map(row => [row.wallet, row.type, row.amountMinor, row.currency, row.note])).toEqual([
      ['Bank Jago', 'Pengeluaran', -25, 'IDR', 'makan'], ['Ziraat', 'Perlu dicek', -75, 'TRY', 'periksa'],
    ]);
  });
});
