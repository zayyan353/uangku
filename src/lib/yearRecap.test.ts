import { describe, expect, it } from 'vitest';
import { buildYearRecap, isYearRecapVisible } from './yearRecap';
import type { Entry } from './finance';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';

function entry(id: string, date: string, amount: number, extra: Partial<Entry> = {}): Entry {
  return { id, date, amount, type: 'expense', walletId: 'a', note: 'Warung Utama', category: 'Makan', ...extra };
}
function data(...entries: Entry[]): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1, entries, wallets: [
    { id:'a', name:'A', kind:'bank', currency:'IDR', openingBalance:0 },
    { id:'b', name:'B', kind:'ewallet', currency:'USD', openingBalance:0 },
    { id:'cash', name:'Kas', kind:'cash', currency:'IDR', openingBalance:0 },
  ] } };
}
const recap = (source: SourceDocument, today = '2027-01-05') => buildYearRecap(source, 'IDR', today);

describe('2026 year recap', () => {
  it('offers the recap from December 1 until January 31 inclusive', () => {
    expect(['2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01', '2027-01-31', '2027-02-01'].map(isYearRecapVisible))
      .toEqual([false, true, true, true, true, false]);
  });

  it('uses only the reporting period, confirmed income, confirmed spending and dated fees in the selected currency', () => {
    const source = data(entry('prior', '2025-12-31', 50), entry('later', '2027-01-01', 99),
      entry('salary', '2026-01-01', 600, { type:'income' }), entry('refund', '2026-02-01', 18, { type:'income' }),
      entry('spent', '2026-01-01', 100, { fee: 5 }), entry('last', '2026-12-31', 4),
      entry('usd', '2026-01-02', 15, { walletId:'b' }), entry('cash', '2026-01-02', 22, { walletId:'cash' }),
      ...(['unreviewed', 'movement', 'adjustment'] as const).map(type => entry(type, '2026-01-02', -99, { type })),
      entry('fx', '2026-01-05', 40, { type:'transfer', toWalletId:'b', toAmount:20, fee:9 }),
      entry('undated', '2026-01-02', 30, { type:'transfer', toWalletId:'b', toAmount:15, fee:7 }));
    source.metadata = { policy:SOURCE_POLICY, facts:[], links:[], statements:[], transfers:[
      { entryId:'fx', sourceDate:'2026-01-03', destinationDate:'2026-01-15' },
      { entryId:'undated', sourceDate:null, destinationDate:'2026-01-05' },
    ] };
    const before = structuredClone(source);
    expect(recap(source)).toMatchObject({ through:'2026-12-31', income:618, spending:118,
      topCategories:[{name:'Makan',total:104},{name:'Biaya transfer',total:14}],
      topMerchants:[{name:'warung utama',total:104}], peakDay:{period:'2026-01-01',total:105},
      peakMonth:{period:'2026-01',total:114}, ageDays:null });
    expect(recap(source,'2026-01-02')).toMatchObject({ through:'2026-01-02', income:600, spending:105 });
    expect(buildYearRecap(source,'USD','2026-12-15')).toMatchObject({ through:'2026-12-15', income:0, spending:15 });
    expect(source).toEqual(before);
  });

  it('ranks at most five categories and merchants by total with deterministic ties, using immutable linked bank wording', () => {
    const source = data(...['F','E','D','C','B','A'].map(key => entry(key,'2026-01-01',10,{note:'Toko '+key,category:key})),
      entry('extra','2026-02-01',22,{note:'Manually edited',category:'F'}));
    source.metadata = { policy:SOURCE_POLICY, statements:[], links:[{entryId:'extra',source:'raw'}], facts:[
      {id:'raw',walletId:'a',currency:'IDR',postedOn:'2026-02-01',signedAmount:-22,balanceAfter:100,
        description:'Toko F #F-00000001',fingerprint:'synthetic:extra',fingerprintVersion:'generic-v1'},
    ] };
    const result = recap(source);
    expect(result.topMerchants.map(x => x.name)).toEqual(['toko f','toko a','toko b','toko c','toko d']);
    expect(result.topCategories.map(x => x.name)).toEqual(['F','A','B','C','D']);
    expect(result.topMerchants[0].total).toBe(32);
    source.state.entries.reverse();
    expect(recap(source)).toEqual(result);
  });

  it('compares streaks at both boundaries and between purchases, preferring the earliest on ties', () => {
    const source = data(entry('after-four','2026-01-05',10),entry('after-five','2026-01-11',10));
    expect(recap(source,'2026-01-08').longestNoSpend).toEqual({start:'2026-01-01',end:'2026-01-04',days:4});
    expect(recap(source,'2026-01-16').longestNoSpend).toEqual({start:'2026-01-06',end:'2026-01-10',days:5});
    expect(recap(source,'2026-01-17').longestNoSpend).toEqual({start:'2026-01-12',end:'2026-01-17',days:6});
    expect(recap(source,'2026-01-11').peakDay?.period).toBe('2026-01-05');
    source.state.entries.push(entry('feb','2026-02-10',20));
    expect(recap(source).peakMonth?.period).toBe('2026-01');
  });

  it('distinguishes no elapsed days, no recorded spending, and spending every elapsed day', () => {
    expect(recap(data(),'2025-12-31')).toMatchObject({spending:0,peakDay:null,longestNoSpend:null,ageDays:null});
    expect(recap(data())).toMatchObject({peakDay:null,peakMonth:null,topCategories:[],topMerchants:[],
      longestNoSpend:{start:'2026-01-01',end:'2026-12-31',days:365}});
    expect(recap(data(entry('today','2026-01-01',10)),'2026-01-01').longestNoSpend).toBeNull();
  });

  it('uses FIFO age at the reporting cutoff, including receipts from the preceding year', () => {
    const source = data(entry('salary','2025-12-01',20,{type:'income'}),
      ...Array.from({length:10},(_,i)=>entry(String(i),'2026-12-01',1)),
      entry('next','2027-01-01',1));
    expect(recap(source,'2026-11-30').ageDays).toBeNull();
    expect(recap(source).ageDays).toBe(365);
    expect(recap(source).income).toBe(0);
  });

  it('rejects cross-day or cross-month totals beyond exact minor units', () => {
    const source = data(entry('max','2026-01-01',Number.MAX_SAFE_INTEGER),entry('extra','2026-02-01',1));
    expect(() => recap(source)).toThrow(RangeError);
    source.state.entries.forEach(row => { row.type = 'income'; });
    expect(() => recap(source)).toThrow(RangeError);
    expect(() => recap(data(),'2026-02-29')).toThrow(RangeError);
  });
});
