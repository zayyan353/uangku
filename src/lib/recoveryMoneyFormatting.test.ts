import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './finance';
import { formatMinorMoney, formatMoneyInput } from './moneyFormatting';

const cases = [
  [9_007_199_254_740_991, '90.071.992.547.409,91', '90071992547409,91'],
  [9_007_199_254_740_990, '90.071.992.547.409,90', '90071992547409,90'],
  [9_007_199_254_740_901, '90.071.992.547.409,01', '90071992547409,01'],
  [9_007_199_254_740_900, '90.071.992.547.409', '90071992547409'],
  [9_007_199_254_740_899, '90.071.992.547.408,99', '90071992547408,99'],
] as const;

describe('exact restored money formatting', () => {
  for (const [currency, prefix] of [['IDR', 'Rp '], ['TRY', '₺'], ['USD', '$']] as const) {
    it.each(cases)(`${currency} preserves all cents of %i`, (minor, shown, editable) => {
      expect(formatMoney(minor, currency)).toBe(prefix + shown);
      expect(formatMoney(-minor, currency)).toBe('-' + prefix + shown);
      expect(formatMinorMoney(-minor, currency, 'unicode')).toBe('−' + prefix + shown);
      expect(formatMoneyInput(minor)).toBe(editable);
      expect(parseMoney(formatMoneyInput(minor))).toBe(minor);
      expect(parseMoney(formatMoneyInput(-minor))).toBe(-minor);
    });

    it(`${currency} preserves normal locale signs, subunits, and zero`, () => {
      for (const minor of [-2_550, -101, -100, -99, -1, -0, 0, 1, 10, 99, 100, 101, 2_550]) {
        const prior = new Intl.NumberFormat('id-ID', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
        expect(formatMoney(minor, currency)).toBe(prior);
      }
    });
  }

  it('roundtrips editable values across every cent around the safe-integer limit', () => {
    for (let offset = 0; offset < 2_048; offset++) {
      const minor = Number.MAX_SAFE_INTEGER - offset;
      expect(parseMoney(formatMoneyInput(minor))).toBe(minor);
      expect(parseMoney(formatMoneyInput(-minor))).toBe(-minor);
    }
  });

  it('preserves an exact BigInt display outside the stored-number bound', () => {
    expect(formatMinorMoney(9_007_199_254_740_992n, 'TRY')).toBe('₺90.071.992.547.409,92');
  });

  it.each([NaN, Infinity, -Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects already imprecise number %s', minor => {
    expect(() => formatMoney(minor, 'TRY')).toThrow(RangeError);
    expect(() => formatMoneyInput(minor)).toThrow(RangeError);
  });
});
