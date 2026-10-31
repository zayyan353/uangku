import { currencyDigits, currencyScale, type Currency } from './currencyCatalog';

function exactInteger(minor: number | bigint): bigint {
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) {
    throw new RangeError('Nominal tampilan harus berupa integer yang tepat.');
  }
  return BigInt(minor);
}

/** Format stored minor units without rounding through a major-unit Number. */
export function formatMinorMoney(minor: number | bigint, currency: Currency, minus: 'locale' | 'unicode' = 'locale'): string {
  const value = exactInteger(minor), magnitude = value < 0n ? -value : value;
  const digits = currencyDigits(currency), scale = BigInt(currencyScale(currency));
  const fraction = magnitude % scale;
  const formatter = new Intl.NumberFormat('id-ID', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: fraction ? digits : 0, maximumFractionDigits: digits,
  });
  const whole = (minus === 'unicode' ? magnitude : value) / scale;
  // BigInt has no negative zero. Keep the locale's sign for -1..-99 minor
  // units, and preserve the pre-existing standard formatter's Number -0.
  const negative = value < 0n || (typeof minor === 'number' && Object.is(minor, -0));
  const signedWhole = minus === 'locale' && negative && whole === 0n ? -0 : whole;
  const text = formatter.formatToParts(signedWhole)
    .map(part => part.type === 'fraction' ? fraction.toString().padStart(digits, '0') : part.value).join('');
  return `${minus === 'unicode' && value < 0n ? '−' : ''}${text}`;
}

/** Exact editable decimal, accepted by parseMoney; no grouping or currency. */
export function formatMoneyInput(minor: number, currency: Currency = 'IDR'): string {
  const value = exactInteger(minor), magnitude = value < 0n ? -value : value;
  const digits = currencyDigits(currency), scale = BigInt(currencyScale(currency));
  const fraction = magnitude % scale;
  return `${value < 0n ? '-' : ''}${magnitude / scale}${fraction ? `,${fraction.toString().padStart(digits, '0')}` : ''}`;
}

