import { describe, expect, it } from 'vitest';
import type { Wallet } from './finance';
import { walletBalance } from './finance';
import { parseJagoStatement } from './jagoStatement';
import { inspectSourcedImport, prepareSourcedImport } from './sourceCommands';
import type { SourceDocument } from './sourceModel';
import { parseBackupText, serializeBackup } from './storage';
import { syntheticJagoPdf, syntheticPdf, type SyntheticJagoRow } from './testing/syntheticPdf';

const at = '2026-11-12T12:00:00Z';
const wallet = (patch: Partial<Wallet> = {}): Wallet => ({ id: 'jago', name: 'Jago contoh', currency: 'IDR', kind: 'bank', openingBalance: 0, ...patch });
const document = (): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet()], entries: [] } });

// Synthetic people, accounts and IDs. Layout follows the bank's PDF.
const ROWS: SyntheticJagoRow[] = [
  { date: '01 Jan 2026', time: '08.00', party: ['Pemindahan dari Akun', 'Lama'], title: ['Pemindahan dari Akun', 'Lama'], id: ['11111111'], amount: '+1.000,50', balance: '1.000,50' },
  { date: '02 Jan 2026', time: '09.15', party: ['BUDI CONTOH SANT'], partyDetail: ['ALTOPay 9990001112'], title: ['Transfer Masuk'], id: ['900000000001_20260102_', '9990001112'], note: ['BUDI CONTOH SANT'], amount: '+500.000,00', balance: '501.000,50' },
  { date: '02 Jan 2026', time: '09.20', party: ['Budi Contoh'], partyDetail: ['Pindah uang antar Kantong'], title: ['Tambah Uang Kantong'], id: ['22222222'], amount: '-100.000', balance: '401.000,50' },
  { date: '03 Jan 2026', time: '10.05', party: ['PENJUAL CONTOH'], partyDetail: ['BCA 0000111122'], title: ['Transfer Keluar'], id: ['26003T000001'], note: ['bayar kursus ﬁsika'], amount: '-49.500', balance: '351.500,50' },
  { date: '04 Feb 2026', time: '12.30', party: ['GoPay'], partyDetail: ['0320260204000001AbCdEf', 'GhID-1'], title: ['Pembayaran dengan', 'Jago Pay'], id: ['0320260204000001AbCd', 'EfGhID-1'], note: ['004 - GO-FOODWarung Contoh,', 'Malang #F-0000000001'], amount: '-60.000', balance: '291.500,50' },
  { date: '04 Feb 2026', time: '12.31', party: ['Investasi Contoh'], partyDetail: ['PI0000000ABC'], title: ['Pembayaran dengan', 'Jago Pay'], id: ['PI0000000ABC'], note: ['Pembelian Reksa Dana'], amount: '-100.000', balance: '191.500,50' },
  { date: '05 Feb 2026', time: '06.48', party: ['TOKO.CONTOH', 'KOTA XX'], partyDetail: ['•••• •••• •••• 0000'], title: ['Transaksi POS'], id: ['600000000001', 'kartu digital •••• •••• •••• 0000'], amount: '-20.864,10', balance: '170.636,40' },
  { date: '05 Feb 2026', time: '07.02', party: ['TOKO.CONTOH', 'KOTA XX'], partyDetail: ['Jago'], title: ['Transaksi POS'], id: ['600000000001', 'kartu digital •••• •••• •••• 0000'], amount: '+20.864,10', balance: '191.500,50' },
  { date: '06 Feb 2026', time: '18.27', party: ['Budi Contoh Santoso'], partyDetail: ['ShopeePay 0800000000'], title: ['Isi Saldo Dompet Digital'], id: ['260206SYATIDJ10000000', '1'], amount: '-91.500', balance: '100.000,50' },
  { date: '07 Mar 2026', time: '22.20', party: ['Bonus Jago Debit Card'], title: ['Bonus'], id: ['260307-ABCD-EFGH12'], note: ['Promo Debit Card - Feb', '2026'], amount: '+10.000,00', balance: '110.000,50' },
  { date: '08 Mar 2026', time: '07.00', party: ['Layanan Contoh'], title: ['Biaya Layanan Contoh'], id: ['260308-ZZZZ-000001'], amount: '-5.000', balance: '105.000,50' },
  { date: '09 Mar 2026', time: '07.00', party: ['ORANG LAIN'], partyDetail: ['BNI 0000000000'], title: ['Transfer Masuk'], id: ['260309-ZZZZ-000002'], note: ['-'], amount: '+5.000,00', balance: '110.000,50' },
];

const statement = (rows = ROWS, options: Parameters<typeof syntheticJagoPdf>[1] = {}) => syntheticJagoPdf(rows, { perPage: 5, ...options });

describe('Bank Jago PDF statement', () => {
  it('reads every row across pages, oldest first, with the balance chain proving nothing is missing', () => {
    const preview = parseJagoStatement(statement(), wallet(), []);
    expect(preview.rows).toHaveLength(ROWS.length);
    expect(preview).toMatchObject({ sourceOrder: 'oldest', currency: 'IDR', openingBalance: 0, closingBalance: 11_000_050,
      period: { start: '2026-01-01', end: '2026-03-09' } });
    expect(preview.rows.map(row => [row.date, row.amount, row.balance])).toEqual([
      ['2026-01-01', 100_050, 100_050], ['2026-01-02', 50_000_000, 50_100_050], ['2026-01-02', -10_000_000, 40_100_050],
      ['2026-01-03', -4_950_000, 35_150_050], ['2026-02-04', -6_000_000, 29_150_050], ['2026-02-04', -10_000_000, 19_150_050],
      ['2026-02-05', -2_086_410, 17_063_640], ['2026-02-05', 2_086_410, 19_150_050], ['2026-02-06', -9_150_000, 10_000_050],
      ['2026-03-07', 1_000_000, 11_000_050], ['2026-03-08', -500_000, 10_500_050], ['2026-03-09', 500_000, 11_000_050],
    ]);
    expect(preview.rows.every(row => row.fingerprintVersion === 'generic-v1' && /^generic:[a-f0-9]{16}$/.test(row.sourceKey) && row.selected && !row.duplicate)).toBe(true);
    expect(preview.warnings.at(-1)).toContain('PDF Bank Jago');
  });

  it('keeps the bank wording readable: wrapped names joined, wrapped IDs rejoined, ligatures unfolded', () => {
    const rows = parseJagoStatement(statement(), wallet(), []).rows;
    expect(rows[0]).toMatchObject({ description: 'Pemindahan dari Akun Lama', reference: '11111111' });
    expect(rows[1]).toMatchObject({ description: 'Transfer Masuk · BUDI CONTOH SANT · ALTOPay 9990001112', reference: '900000000001_20260102_9990001112' });
    expect(rows[3].description).toBe('Transfer Keluar · PENJUAL CONTOH · BCA 0000111122 · bayar kursus fisika');
    expect(rows[4]).toMatchObject({ reference: '0320260204000001AbCdEfGhID-1',
      description: 'Pembayaran dengan Jago Pay · GoPay · 004 - GO-FOODWarung Contoh, Malang #F-0000000001' });
    expect(rows[6]).toMatchObject({ reference: '600000000001',
      description: 'Transaksi POS · TOKO.CONTOH KOTA XX · •••• •••• •••• 0000 · kartu digital •••• •••• •••• 0000' });
    expect(rows[8].reference).toBe('260206SYATIDJ100000001');
    expect(rows[11].description).toBe('Transfer Masuk · ORANG LAIN · BNI 0000000000');
  });

  it('decides types only from the bank operation wording and leaves the rest for review', () => {
    const rows = parseJagoStatement(statement(), wallet(), []).rows;
    expect(rows.map(row => [row.classification, row.category])).toEqual([
      ['movement', 'Transfer'], ['movement', 'Transfer'], ['movement', 'Transfer'], ['movement', 'Transfer'],
      ['expense', 'Makan & minum'], ['expense', 'Belum dikategorikan'], ['expense', 'Belum dikategorikan'],
      ['income', 'Pengembalian dana'], ['movement', 'Transfer'], ['income', 'Cashback'],
      ['unreviewed', 'Belum dikategorikan'], ['movement', 'Transfer'],
    ]);
    expect(rows[1].warning).toContain('atas namamu sendiri');
    expect(rows[3].warning).toContain('Ubah jenisnya bila ini pembayaran');
    expect(rows[8].warning).toContain('e-wallet');
    expect(rows[10].warning).toContain('belum dikenali');
  });

  it('does not confirm a type when the amount runs against the operation', () => {
    const rows: SyntheticJagoRow[] = [
      { date: '01 Jan 2026', time: '08.00', party: ['BUDI CONTOH'], title: ['Transfer Masuk'], id: ['1'], amount: '-1.000', balance: '9.000,00' },
      { date: '02 Jan 2026', time: '08.00', party: ['Bonus Jago'], title: ['Bonus'], id: ['2'], amount: '-1.000', balance: '8.000,00' },
      { date: '03 Jan 2026', time: '08.00', party: ['TOKO'], title: ['Transaksi POS'], id: ['3'], amount: '+1.000,00', balance: '9.000,00' },
      { date: '04 Jan 2026', time: '08.00', party: ['TOKO'], title: ['Pembayaran dengan', 'Jago Pay'], id: ['4'], amount: '+1.000,00', balance: '10.000,00' },
    ];
    const parsed = parseJagoStatement(statement(rows), wallet(), []);
    expect(parsed.rows.map(row => row.classification)).toEqual(['unreviewed', 'unreviewed', 'unreviewed', 'unreviewed']);
    expect(parsed.openingBalance).toBe(1_000_000);
  });

  it('reads a statement listed newest first', () => {
    const newest = [...ROWS].reverse().map(row => ({ ...row }));
    const parsed = parseJagoStatement(statement(newest), wallet(), []);
    expect(parsed).toMatchObject({ sourceOrder: 'newest', openingBalance: 0, closingBalance: 11_000_050 });
  });

  it('cancels instead of importing a filtered or incomplete statement', () => {
    const missing = ROWS.filter((_, index) => index !== 3);
    expect(() => parseJagoStatement(statement(missing), wallet(), [])).toThrow('Saldo antarbaris tidak cocok');
    const noBalance = ROWS.map((row, index) => index === 2 ? { ...row, balance: '' } : row);
    expect(() => parseJagoStatement(statement(noBalance), wallet(), [])).toThrow('Jumlah dan saldo transaksi 2026-01-02 tidak terbaca');
    const badAmount = ROWS.map((row, index) => index === 2 ? { ...row, amount: '-100.00' } : row);
    expect(() => parseJagoStatement(statement(badAmount), wallet(), [])).toThrow('Nominal transaksi 2026-01-02 09.20 tidak valid');
    const badDate = ROWS.map((row, index) => index === 2 ? { ...row, date: '02 Xyz 2026' } : row);
    expect(() => parseJagoStatement(statement(badDate, { months: false }), wallet(), [])).toThrow('Tanggal "02 Xyz 2026"');
  });

  it('matches the statement currency to the wallet and refuses other documents', () => {
    expect(() => parseJagoStatement(statement(), wallet({ currency: 'TRY' }), [])).toThrow('PDF ini memakai IDR');
    expect(() => parseJagoStatement(statement(), wallet({ kind: 'cash' }), [])).toThrow('cash tidak digunakan');
    const other = syntheticPdf([[{ x: 20, y: 700, size: 10, text: 'Rekening koran bank contoh' }]]);
    expect(() => parseJagoStatement(other, wallet(), [])).toThrow('bukan PDF riwayat transaksi Bank Jago');
    const noTable = syntheticPdf([[{ x: 20, y: 700, size: 10, text: 'www.jago.com' }]]);
    expect(() => parseJagoStatement(noTable, wallet(), [])).toThrow('bukan PDF riwayat transaksi Bank Jago');
    const empty = syntheticPdf([[{ x: 20, y: 700, size: 10, text: 'Jago' }, ...['Tanggal & Waktu', 'Sumber/Tujuan', 'Rincian Transaksi', 'Catatan', 'Jumlah', 'Saldo'].map((text, index) => ({ x: [24, 86, 186, 290, 457, 551][index], y: 640, size: 9, text }))]]);
    expect(() => parseJagoStatement(empty, wallet(), [])).toThrow('Mata uang di PDF tidak ditemukan');
  });

  it('notes when the latest balance printed above the table differs from the last row', () => {
    const parsed = parseJagoStatement(statement(ROWS, { latest: '999,00' }), wallet(), []);
    expect(parsed.warnings.some(text => text.includes('Saldo terbaru'))).toBe(true);
    expect(parseJagoStatement(statement(), wallet(), []).warnings.some(text => text.includes('Saldo terbaru'))).toBe(false);
  });

  it('saves through the source model, survives a backup round trip, and recognises the same file again', () => {
    const data = document();
    const preview = parseJagoStatement(statement(ROWS, { pdf: { objectStream: true } }), data.state.wallets[0], []);
    const prepared = prepareSourcedImport(data, data.state.wallets[0], preview, {}, true, 'jago-batch', at);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') throw new Error('Expected a ready import');
    const saved = prepared.data;
    expect(saved.state.entries).toHaveLength(ROWS.length);
    expect(walletBalance(saved.state, 'jago', saved.metadata)).toBe(11_000_050);
    expect(saved.metadata!.facts.every(fact => fact.fingerprintVersion === 'generic-v1')).toBe(true);
    const restored = parseBackupText(serializeBackup(saved));
    expect(restored.state).toEqual(saved.state);
    const again = parseJagoStatement(statement(), restored.state.wallets[0], restored.state.entries);
    expect(again.rows.every(row => row.duplicate && !row.selected)).toBe(true);
    expect(again.warnings[0]).toBe(`${ROWS.length} transaksi kemungkinan sudah ada dan tidak dipilih.`);
    expect(inspectSourcedImport(restored, restored.state.wallets[0], again).needsReview).toBe(false);
  });
});
