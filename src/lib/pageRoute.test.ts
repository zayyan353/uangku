import { describe, expect, it } from 'vitest';
import { addressForPage, hashForPage, pageFromHash, type RoutePage } from './pageRoute';

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
  it('writes the page into the address it is given, whatever the path looks like', () => {
    expect(addressForPage('https://zayyan353.github.io/uangku/', 'wallets')).toBe('https://zayyan353.github.io/uangku/#/dompet');
    expect(addressForPage('https://zayyan353.github.io/uangku/index.html?x=%23y#/dompet', 'import')).toBe('https://zayyan353.github.io/uangku/index.html?x=%23y#/impor');
    // Ringkasan has the plain address: the hash goes, the query stays.
    expect(addressForPage('http://127.0.0.1:4180/?a=1#/transaksi', 'overview')).toBe('http://127.0.0.1:4180/?a=1');
    // A path that starts with two slashes stays on this host. Joined from the path alone it read as "http://index.html/…".
    expect(addressForPage('http://127.0.0.1:4180//', 'wallets')).toBe('http://127.0.0.1:4180//#/dompet');
    expect(addressForPage('http://127.0.0.1:4180//index.html', 'transactions')).toBe('http://127.0.0.1:4180//index.html#/transaksi');
    expect(new URL(addressForPage('http://127.0.0.1:4180//index.html', 'transactions')).host).toBe('127.0.0.1:4180');
    expect(addressForPage('file:///C:/Uangku/index.html', 'import')).toBe('file:///C:/Uangku/index.html#/impor');
  });
});
