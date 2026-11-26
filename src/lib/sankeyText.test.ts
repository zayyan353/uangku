import { describe, expect, it } from 'vitest';
import { sankeyText } from './sankeyText';
import { buildCashflowReport } from './cashflowReport';
import type { Currency } from './finance';
import type { SourceDocument } from './sourceModel';

const text = (incomeTotal: number, categoryTotals: Array<[string, number]>, currency: Currency = 'USD') =>
  sankeyText({ incomeTotal, categoryTotals }, currency, '2026-10');

describe('SankeyMATIC monthly cashflow export', () => {
  it('exports the confirmed monthly report, balancing leftover income at the central node', () => {
    const source: SourceDocument = { app: 'uangku', version: 1, demo: false, state: { version: 1,
      wallets: [{ id: 'a', name: 'Sintetis', currency: 'USD', kind: 'bank', openingBalance: 0 }],
      entries: [
        { id:'income', date:'2026-10-01', type:'income', walletId:'a', amount:123456, category:'Pemasukan', note:'' },
        { id:'spent', date:'2026-10-02', type:'expense', walletId:'a', amount:40025, fee:10005, category:'Belanja', note:'' },
        { id:'next', date:'2026-11-01', type:'expense', walletId:'a', amount:100, category:'Lain', note:'' },
      ] } };
    const month = '2026-10';
    const result = buildCashflowReport(source, { currency:'USD', month, period:'month', today:'2026-11-26' });
    expect(sankeyText(result, 'USD', month)).toBe([
      '// Uangku · 2026-10 · USD', 'Pemasukan [1234.56] Kas bulan ini',
      'Kas bulan ini [400.25] Belanja', 'Kas bulan ini [100.05] Biaya transfer', 'Kas bulan ini [734.26] Sisa',
    ].join('\n'));
  });

  it('covers deficits using only the exported positive flows and comments on skipped categories', () => {
    const result = text(0, [['Food', 500], ['Nol', 0], ['Minus', -299]], 'IDR').split('\n');
    expect(result).toContain('Kas bulan ini [5.00] Food');
    expect(result).toContain('Dari saldo [5.00] Kas bulan ini');
    expect(result.filter(line => line.startsWith('//')).join(' ')).toMatch(/Nol/);
    expect(result.filter(line => line.startsWith('//')).join(' ')).toMatch(/Minus/);
    expect(result.some(line => line.includes('[-'))).toBe(false);
    expect(text(0, []).split('\n').every(line => line.startsWith('//'))).toBe(true);
    expect(text(500, [['Food', 500]], 'IDR')).not.toMatch(/Sisa|Dari saldo/);
  });

  it.each([
    ['IDR', '90071992547409.91'], ['JPY', '9007199254740991'], ['EUR', '90071992547409.91'],
    ['KWD', '9007199254740.991'], ['CLF', '900719925474.0991'],
  ] as const)('uses exact major units for the full safe range in %s', (currency, expected) => {
    expect(text(Number.MAX_SAFE_INTEGER, [], currency)).toContain(`Kas bulan ini [${expected}] Sisa`);
  });

  it('keeps each category distinct after cleaning, including control prefixes and colour directives', () => {
    const labels = [':: // [Kas bulan\nini]', 'Pemasukan', 'Sisa', 'Dari saldo',
      'Belanja', '[Belanja]', 'Belanja (2)', '[]', '// :', 'Kas bulan ini #abc.2'];
    const exported = text(10, labels.map(label => [label, 1]), 'JPY').split('\n');
    const targets = exported.filter(line => line.startsWith('Kas bulan ini [1] ')).map(line => line.slice('Kas bulan ini [1] '.length));
    expect(targets).toHaveLength(labels.length);
    expect(new Set(targets).size).toBe(labels.length);
    for (const target of targets) {
      expect(target).not.toMatch(/^(?::|\/\/|$)|[\[\]\n]|\s#\S+$/);
      expect(['Kas bulan ini', 'Pemasukan', 'Sisa', 'Dari saldo']).not.toContain(target);
    }
    expect(targets).toContain('Belanja (2)');
  });

  it('rejects unsafe numbers and invalid month headers', () => {
    expect(() => text(1.5, [])).toThrow(RangeError);
    expect(() => text(1, [['Bad', Number.MAX_SAFE_INTEGER + 1]])).toThrow(RangeError);
    expect(() => sankeyText({ incomeTotal: 0, categoryTotals: [] }, 'IDR', '2026-10\n: Bad')).toThrow(RangeError);
  });
});
