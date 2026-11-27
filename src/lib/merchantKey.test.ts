import { describe, expect, it } from 'vitest';
import { merchantKey } from './merchantKey';

describe('merchantKey', () => {
  const name = 'KEDAI CONTOH 24';
  it('recognises the same merchant in a Jago POS row and an explicitly labelled Ziraat sale', () => {
    const jago = `Transaksi POS · ${name} · •••• •••• •••• 4321 · kartu digital •••• 4321`;
    const ziraat = `POS ALIŞVERİŞ KART NO: 1111 **** **** 1234 İŞYERİ: ${name} MUTABAKAT: 998877`;
    expect(merchantKey(jago)).toBe('kedai contoh 24');
    expect(merchantKey(ziraat)).toBe(merchantKey(jago));
    expect(merchantKey(jago.replace('24', '25'))).not.toBe(merchantKey(jago));
  });
  it('keeps GoFood merchants distinct even when both payments went through GoPay', () => {
    const payment = 'Pembayaran dengan Jago Pay · GoPay · 004 - GO-FOODWarung Contoh, Malang #F-0000000001';
    expect(merchantKey(payment)).toBe('warung contoh malang');
    expect(merchantKey(payment.replace('0000000001', '0000099999'))).toBe(merchantKey(payment));
    expect(merchantKey(payment.replace('Warung', 'Toko'))).not.toBe(merchantKey(payment));
  });
  it('removes changing reference, card, date and time fields from plain descriptions', () => {
    expect(merchantKey('Kios Çontoh 2026-10-09 19:42:03 •••• 1234 #F-0000000007 12345678')).toBe('kios contoh');
    expect(merchantKey('Kios Contoh 09/11/2026 07.34')).toBe('kios contoh');
  });
  it('does not group rows whose wording contains only variable fields or no merchant', () => {
    expect(merchantKey('2026-10-08 11:30 #F-123456789 •••• 5678')).toBe('');
    expect(merchantKey('POS ALIŞVERİŞ İŞYERİ: MUTABAKAT: 123')).toBe('');
    expect(merchantKey('Pembayaran dengan Jago Pay · GoPay')).toBe('');
  });
});
