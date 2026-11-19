import { describe, expect, it } from 'vitest';
import { hashForPage, pageFromHash, type RoutePage } from './pageRoute';

describe('MW-113a page routes', () => {
  it('gives each page its own address and Ringkasan the plain one', () => {
    expect((['overview', 'wallets', 'transactions', 'import'] as RoutePage[]).map(hashForPage)).toEqual(['', '#/dompet', '#/transaksi', '#/impor']);
  });
  it('reads a page back from its hash', () => {
    for (const page of ['overview', 'wallets', 'transactions', 'import'] as RoutePage[]) expect(pageFromHash(hashForPage(page))).toBe(page);
  });
  it('opens Ringkasan for an empty, bare or unknown hash instead of failing', () => {
    for (const hash of ['', '#', '#/', '#/tidak-ada', '#dompet', '#/dompet/', '#/Dompet', '#/transaksi?x=1', '#/constructor', '#/__proto__']) expect(pageFromHash(hash), hash).toBe('overview');
  });
});
