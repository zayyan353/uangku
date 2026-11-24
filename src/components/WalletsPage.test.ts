import { describe, expect, it } from 'vitest';
import { freshnessText } from './WalletsPage';

describe('MW-129b wallet freshness line', () => {
  const today = '2026-11-19';
  it('names the latest record and how far the stored statements reach', () => {
    expect(freshnessText({ hasRecords: true, lastRecordOn: '2026-11-12', statementThrough: '2026-10-19' }, today)).toBe('Catatan terakhir 12 Nov · mutasi bank sampai 19 Okt');
  });
  it('says nothing about statements for a wallet that has none stored', () => {
    expect(freshnessText({ hasRecords: true, lastRecordOn: '2026-11-12', statementThrough: null }, today)).toBe('Catatan terakhir 12 Nov');
  });
  it('keeps the year when it is not this year', () => {
    expect(freshnessText({ hasRecords: true, lastRecordOn: '2025-12-30', statementThrough: '2025-11-30' }, today)).toBe('Catatan terakhir 30 Des 2025 · mutasi bank sampai 30 Nov 2025');
    expect(freshnessText({ hasRecords: true, lastRecordOn: '2026-01-02', statementThrough: '2025-12-31' }, today)).toBe('Catatan terakhir 2 Jan · mutasi bank sampai 31 Des 2025');
  });
  it('says so when the wallet has no record', () => {
    expect(freshnessText({ hasRecords: false, lastRecordOn: null, statementThrough: null }, today)).toBe('Belum ada catatan.');
    expect(freshnessText(undefined, today)).toBe('Belum ada catatan.');
    expect(freshnessText({ hasRecords: true, lastRecordOn: null, statementThrough: null }, today))
      .toBe('Tanggal catatan terakhir belum tersedia.');
    expect(freshnessText({ hasRecords: false, lastRecordOn: null, statementThrough: '2026-10-19' }, today)).toBe('Belum ada catatan · mutasi bank sampai 19 Okt');
  });
});
