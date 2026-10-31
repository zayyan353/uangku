import { describe, expect, it, vi } from 'vitest';
import { interpretBankDescription, normalizeBankDescription } from './bankDescription';

describe('literal bank operation interpretation', () => {
  it.each(['ATM PARA ÇEKME', 'atm para cekme', '  ATM   PARA ÇEKME  REF 123  ',
    'YURTİÇİ ATM PARA ÇEKME KART 0000 **** 0000'])('marks withdrawal pending without creating an expense: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'atm-withdrawal', category: 'Tarik tunai', pending: true });
  });

  it.each(['ATM YATAN', 'ATM YATAN TUTAR', 'YURTİÇİ ATM P.Y.', 'YURTICI ATM P.Y.',
    'YURTİÇİ ATM P. Y. REF 123', 'ATM PARA YATIRMA'])('marks cash deposit pending without inventing income: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'atm-deposit', category: 'Setor tunai', pending: true });
  });

  it.each(['Referanslı Havale BSMV Tahsilatı', '123 Referansli Havale Komisyonu Tahsilati',
    'EFT KOMİSYON TAHSİLATI', 'FAST BSMV TAHSİLATI REF 123'])('recognizes fee before generic transfer: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'transfer-fee', category: 'Biaya bank', pending: false });
  });

  it.each(['Referanslı Havale', 'Referanslı Havale SENTETİK ALICI', 'FAST SENTETIK KISI',
    'EFT GONDERIMI', 'VİRMAN', 'TRANSFER'])('marks bank rails pending without guessing purpose/ownership: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'bank-transfer', category: 'Transfer', pending: true });
  });

  it.each(['PREPAID İADE', 'prepaid iade', 'PREPAID İADESİ',
    'PREPAID İADE SANAL POS ALIŞVERİŞ HOP SCOOTER'])('recognizes the user-confirmed cashback convention before merchant wording: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'cashback', category: 'Cashback', pending: true });
  });

  it.each(['SANAL POS ALIŞVERİŞ', 'SANAL POS ALISVERIS ISYERI S/GIB HARCLAR VERGI MUTABAKAT 123',
    'SANAL POS ALIŞVERİŞ İŞYERİ TRENDYOL YEMEK', 'SANAL POS ALIŞVERİŞ İŞYERİ FAST FOOD',
    'SANAL POS ALIŞVERİŞ İŞYERİ HAVALE HIRDAVAT'])('offers online fallback without overriding merchant decisions: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'online-purchase', category: 'Belanja online', pending: false });
  });

  it.each(['POS ALIŞVERİŞ İŞYERİ SENTETIK KISI', 'POS ALIŞVERİŞ İŞYERİ FAST FOOD',
    'POS ALIŞVERİŞ İŞYERİ HAVALE', 'POS HARCAMA İŞYERİ EFT'])('recognizes card channel without guessing purpose or direction: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'card-purchase', category: 'Belanja', pending: true });
  });

  it.each(['ATM ALIŞVERİŞ',
    'ATM PARA ÇEKMEK', 'YURTICI ATM P.YATM', 'SENTETIK KISI', 'GOOGLE YOUTUBE İADE',
    'BSMV TAHSİLATI', 'KOMİSYONU TAHSİLATI', 'HAVALECI', 'FASTFOOD', 'PREPAID IADELER', ''])('does not infer a transfer or online operation from unsupported context: %s', text => {
    expect(interpretBankDescription(text)).toEqual({ kind: 'none', label: '', warning: '', pending: false });
  });

  it('preserves raw source wording and returns independent decisions', () => {
    const text = 'ATM PARA ÇEKME [SYNTHETIC]';
    const before = text;
    const first = interpretBankDescription(text), second = interpretBankDescription(text);
    first.label = 'Modified presentation';
    expect(second.label).toBe('Tarik tunai ATM');
    expect(text).toBe(before);
    expect(Object.keys(second).sort()).toEqual(['category', 'kind', 'label', 'pending', 'warning']);
  });

  it('normalizes Turkish text and punctuation for policy lookup only', () => {
    expect(normalizeBankDescription('YURTİÇİ ATM P.Y.')).toBe('yurtici atm p y');
    expect(normalizeBankDescription('Referanslı Havale BSMV Tahsilatı')).toBe('referansli havale bsmv tahsilati');
  });

  it('does not use browser storage, financial documents, or external classification', () => {
    const getItem = vi.fn(() => { throw Error('must not access storage'); });
    vi.stubGlobal('localStorage', { getItem });
    try {
      expect(interpretBankDescription('ATM YATAN').kind).toBe('atm-deposit');
      expect(getItem).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
