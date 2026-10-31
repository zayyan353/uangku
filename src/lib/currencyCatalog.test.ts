import { describe, expect, it } from 'vitest';
import { CURRENCY_CATALOG, CURRENCY_CATALOG_SOURCE, LEGACY_CURRENCY_CODES, convertMinorCurrency,
  currencyDigits, currencyInfo, currencyScale, deriveCurrencyRate, isCurrencyCode, isCurrencyConversionConsistent, type Currency } from './currencyCatalog';
import { CURRENCIES, formatMoney, parseMoney, validateEntry, validateWallet, type Entry, type State } from './finance';
import { formatMoneyInput } from './moneyFormatting';
import { createHistoryIndex, queryHistory } from './historyView';
import { buildCashflowReport } from './cashflowReport';
import { validateLegacyBackup } from './legacyValidation';

const wallet = (id: string, currency: Currency, openingBalance = 0) => ({ id, name: id, currency, openingBalance, kind: 'bank' as const });
const entry = (patch: Partial<Entry> = {}): Entry => ({ id: 'one', date: '2026-10-31', type: 'expense', walletId: 'source', amount: 100, category: 'Belanja', note: 'Synthetic', ...patch });
function state(from: Currency, to: Currency): State { return { version: 1, wallets: [wallet('source', from), wallet('destination', to)], entries: [] }; }

describe('deterministic ISO minor-unit catalog', () => {
  it('retains the source snapshot and rejects unconfigured tests/metals/unknown codes', () => {
    expect(CURRENCY_CATALOG).toHaveLength(165);
    expect(CURRENCY_CATALOG_SOURCE.published).toBe('2026-09-17');
    expect(CURRENCY_CATALOG_SOURCE.sha256).toBe('33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff');
    expect(new Set(CURRENCY_CATALOG.map(row => row.code)).size).toBe(CURRENCY_CATALOG.length);
    for (const row of CURRENCY_CATALOG) expect(currencyScale(row.code)).toBe(10 ** row.digits);
    for (const invalid of ['ZZZ', 'XTS', 'XXX', 'XAU', 'eur', '', null, {}, 123]) expect(isCurrencyCode(invalid)).toBe(false);
    expect(() => currencyInfo('ZZZ')).toThrow();
    expect(Object.isFrozen(CURRENCY_CATALOG)).toBe(true);
    expect(Object.isFrozen(currencyInfo('EUR'))).toBe(true);
  });
  it('retains the three original default labels and all original scales', () => {
    expect(LEGACY_CURRENCY_CODES).toEqual(['IDR', 'TRY', 'USD']);
    expect(CURRENCIES).toEqual([{ code: 'IDR', label: 'Rupiah', symbol: 'Rp' }, { code: 'TRY', label: 'Lira Turki', symbol: '₺' }, { code: 'USD', label: 'Dolar AS', symbol: '$' }]);
    expect(LEGACY_CURRENCY_CODES.map(code => currencyDigits(code))).toEqual([2, 2, 2]);
    expect(['JPY', 'EUR', 'KWD', 'CLF'].map(code => currencyDigits(code as Currency))).toEqual([0, 2, 3, 4]);
  });
  it('accepts catalog currencies in wallet commands but feature-gates old external ledgers', () => {
    expect(validateWallet(wallet('new-eur', 'EUR'))).toBeNull();
    const data = { app: 'uangku', version: 1, demo: false, state: state('EUR', 'JPY') };
    expect(() => validateLegacyBackup(data)).toThrow('multi-mata-uang');
    expect(validateLegacyBackup(data, { allowExtendedCurrencies: true }).state.wallets[1].currency).toBe('JPY');
  });
});

describe('currency-aware exact text parsing and formatting', () => {
  it.each([
    ['JPY', '1234', 1234], ['JPY', '1.234', 1234], ['JPY', '1,234', 1234],
    ['KWD', '1,234', 1234], ['KWD', '0,001', 1], ['KWD', '-0,001', -1],
    ['KWD', '1.234,567', 1_234_567], ['KWD', '1.234.567', 1_234_567_000],
    ['CLF', '1,2345', 12345], ['CLF', '0,0001', 1], ['CLF', '1.234,5678', 12_345_678],
    ['EUR', '1.234,56', 123456], ['EUR', '1,234.56', 123456],
  ] as const)('parses %s %s without floating scaling', (currency, text, expected) => {
    expect(parseMoney(text, currency)).toBe(expected);
  });
  it.each([
    ['JPY', '1,25'], ['JPY', '0,00'], ['JPY', '1.0'], ['JPY', '1,234.567'],
    ['KWD', '1.234'], ['KWD', '1.2'], ['KWD', '1,2345'], ['KWD', '1,234.567'],
    ['CLF', '1.2345'], ['CLF', '1,23456'], ['CLF', '1.234'],
    ['KWD', '1e3'], ['JPY', 'Infinity'], ['KWD', '1234,567,890'],
  ] as const)('rejects ambiguous/overprecision %s %s', (currency, text) => expect(parseMoney(text, currency)).toBeNull());
  it.each(['IDR', 'TRY', 'USD', 'EUR', 'JPY', 'KWD', 'CLF'] as const)('roundtrips safe limits and signs in %s exactly', currency => {
    for (const minor of [0, 1, -1, 99, -99, 100, 1234567, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(parseMoney(formatMoneyInput(minor, currency), currency)).toBe(minor);
    }
    expect(parseMoney(`${Number.MAX_SAFE_INTEGER}0`, currency)).toBeNull();
  });
  it('retains legacy defaults and displays the correct new fractions without Number rounding', () => {
    expect(parseMoney('1.000')).toBe(100000);
    expect(parseMoney('1,234')).toBe(123400);
    expect(formatMoneyInput(123)).toBe('1,23');
    expect(formatMoneyInput(123, 'JPY')).toBe('123');
    expect(formatMoney(1234, 'KWD')).toContain('1,234');
    expect(formatMoney(-1, 'KWD')).toContain('-');
    expect(formatMoney(-1, 'KWD')).toContain('0,001');
    expect(formatMoney(1, 'CLF')).toContain('0,0001');
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'JPY')).toContain('9.007.199.254.740.991');
  });
});

describe('FX rate semantics use major units across precision scales', () => {
  it.each([
    [10000, 'USD', 'JPY', 150, 15000],
    [15000, 'JPY', 'USD', 0.006666666666666667, 10000],
    [1000, 'KWD', 'USD', 3.25, 325],
    [325, 'USD', 'KWD', 0.3076923076923077, 1000],
    [12345, 'CLF', 'JPY', 150, 185],
    [101, 'IDR', 'TRY', 0.5, 51],
    [1, 'USD', 'JPY', 50, 1],
  ] as const)('converts %s %s minor to %s at %s', (amount, from, to, rate, expected) => {
    expect(convertMinorCurrency(amount, from, to, rate)).toBe(expected);
    if (expected > 0) {
      const derived = deriveCurrencyRate(amount, from, expected, to);
      expect(Math.abs(convertMinorCurrency(amount, from, to, derived) - expected)).toBeLessThanOrEqual(1);
    }
  });
  it('retains integer accuracy at large values and refuses unsafe/invalid conversions', () => {
    expect(convertMinorCurrency(Number.MAX_SAFE_INTEGER, 'USD', 'EUR', 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(convertMinorCurrency(Number.MAX_SAFE_INTEGER, 'USD', 'EUR', 0.5)).toBe(4503599627370496);
    for (const rate of [0, -1, Infinity, NaN]) expect(() => convertMinorCurrency(100, 'USD', 'JPY', rate)).toThrow();
    expect(() => convertMinorCurrency(Number.MAX_SAFE_INTEGER, 'JPY', 'KWD', 1)).toThrow('batas');
    expect(() => convertMinorCurrency(-100, 'USD', 'EUR', 1)).toThrow();
    expect(() => deriveCurrencyRate(0, 'USD', 10, 'JPY')).toThrow();
    expect(deriveCurrencyRate(1, 'JPY', Number.MAX_SAFE_INTEGER, 'CLF')).toBeGreaterThan(0);
  });
  it('retains a safe legacy explicit target within one minor unit of an overflowing exact expectation', () => {
    const amount = 8575606148499318, rate = 1.050328, destination = Number.MAX_SAFE_INTEGER;
    expect(Math.round(amount * rate)).toBe(destination);
    expect(() => convertMinorCurrency(amount, 'TRY', 'USD', rate)).toThrow('batas');
    expect(isCurrencyConversionConsistent(amount, 'TRY', 'USD', rate, destination)).toBe(true);
    expect(isCurrencyConversionConsistent(amount, 'TRY', 'USD', rate, destination - 1)).toBe(false);
    const data = state('TRY', 'USD');
    const transfer = entry({ type: 'transfer', amount, rate, toWalletId: 'destination', toAmount: destination });
    expect(validateEntry(data, transfer)).toBeNull();
    expect(isCurrencyConversionConsistent(amount, 'TRY', 'USD', deriveCurrencyRate(amount, 'TRY', destination, 'USD'), destination)).toBe(true);
  });
  it('validates stored transfers using the scale of each wallet and destination rounding tolerance', () => {
    const data = state('USD', 'JPY');
    const transfer = entry({ type: 'transfer', amount: 10000, toWalletId: 'destination', toAmount: 15000, rate: 150 });
    expect(validateEntry(data, transfer)).toBeNull();
    expect(validateEntry(data, { ...transfer, toAmount: 15001 })).toBeNull();
    expect(validateEntry(data, { ...transfer, toAmount: 15002 })).not.toBeNull();
    expect(validateEntry(data, { ...transfer, rate: 1.5 })).not.toBeNull();
  });
});

describe('all currencies remain independently reportable', () => {
  it('indexes nonlegacy currency history and keeps currency totals separate', () => {
    const data = state('JPY', 'KWD');
    data.wallets[0].openingBalance = 10000;
    data.wallets[1].openingBalance = 5000;
    data.entries = [entry({ id: 'yen', amount: 1234 }), entry({ id: 'dinars', walletId: 'destination', amount: 1234 })];
    const before = JSON.stringify(data), index = createHistoryIndex(data);
    expect(queryHistory(index, { currency: 'JPY', month: '2026-10', period: 'month', query: '', type: 'all' }).map(row => row.id)).toEqual(['yen']);
    const document = { app: 'uangku' as const, version: 1 as const, demo: false, state: data };
    const query = { month: '2026-10', today: '2026-10-31', period: 'all' as const };
    expect(buildCashflowReport(document, { ...query, currency: 'JPY' })).toMatchObject({ inflow: 0, outflow: 1234, closingBalance: 8766 });
    expect(buildCashflowReport(document, { ...query, currency: 'KWD' })).toMatchObject({ inflow: 0, outflow: 1234, closingBalance: 3766 });
    expect(JSON.stringify(data)).toBe(before);
  });
});
