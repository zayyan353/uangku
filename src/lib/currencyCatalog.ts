import { CURRENCY_CATALOG_DATA } from './currencyCatalogData';
export { CURRENCY_CATALOG_SOURCE } from './currencyCatalogData';

export type Currency = typeof CURRENCY_CATALOG_DATA[number]['code'];
export interface CurrencyDefinition {
  readonly code: Currency;
  readonly label: string;
  readonly symbol: string;
  readonly digits: number;
}
export const LEGACY_CURRENCY_CODES = ['IDR', 'TRY', 'USD'] as const;
export const CURRENCY_CATALOG: readonly CurrencyDefinition[] = Object.freeze(CURRENCY_CATALOG_DATA.map(row => Object.freeze({ ...row })));
const BY_CODE = new Map<string, CurrencyDefinition>(CURRENCY_CATALOG.map(row => [row.code, row]));
export function isCurrencyCode(value: unknown): value is Currency { return typeof value === 'string' && BY_CODE.has(value); }
export function currencyInfo(code: string): CurrencyDefinition {
  const info = BY_CODE.get(code);
  if (!info) throw new RangeError('Kode mata uang belum didukung oleh katalog aplikasi.');
  return info;
}
export function currencyDigits(code: Currency): number { return currencyInfo(code).digits; }
export function currencyScale(code: Currency): number { return 10 ** currencyDigits(code); }

function checkedMinor(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Nominal konversi harus integer aman nol atau positif.');
  return BigInt(value);
}
function checkedNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Nominal konversi melebihi batas angka tepat.');
  return Number(value);
}
function rateFraction(rate: number): [bigint, bigint] {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Kurs harus positif dan terbatas.');
  const [mantissa, power = '0'] = rate.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const exponent = Number(power) - fraction.length;
  const numerator = BigInt(whole + fraction);
  return exponent >= 0 ? [numerator * 10n ** BigInt(exponent), 1n] : [numerator, 10n ** BigInt(-exponent)];
}

function convertedMinorInteger(amount: number, from: Currency, to: Currency, rate: number): bigint {
  const minor = checkedMinor(amount), [numerator, denominator] = rateFraction(rate);
  const top = minor * numerator * BigInt(currencyScale(to));
  const bottom = denominator * BigInt(currencyScale(from));
  return (top * 2n + bottom) / (bottom * 2n);
}

/** Rate is destination MAJOR units per source MAJOR unit, regardless of scales. */
export function convertMinorCurrency(amount: number, from: Currency, to: Currency, rate: number): number {
  // A newly computed amount must itself fit the stored safe-integer envelope.
  return checkedNumber(convertedMinorInteger(amount, from, to, rate));
}

/** Preserve the existing one-destination-minor-unit tolerance, including a
 * safe explicitly entered target one unit below an overflowing expectation.
 * The overflowing expectation stays BigInt and is never stored as Number.
 */
export function isCurrencyConversionConsistent(amount: number, from: Currency, to: Currency, rate: number, destinationMinor: number): boolean {
  try {
    const stored = checkedMinor(destinationMinor), expected = convertedMinorInteger(amount, from, to, rate);
    const difference = expected - stored;
    return difference >= -1n && difference <= 1n;
  } catch { return false; }
}

/** Derive a major-unit rate from explicitly entered source/destination amounts. */
export function deriveCurrencyRate(sourceMinor: number, from: Currency, destinationMinor: number, to: Currency): number {
  const source = checkedMinor(sourceMinor), destination = checkedMinor(destinationMinor);
  if (source === 0n || destination === 0n) throw new RangeError('Nominal asal dan tujuan harus lebih besar dari nol.');
  const numerator = destination * BigInt(currencyScale(from));
  const denominator = source * BigInt(currencyScale(to));
  // Decimal long division avoids first rounding large integer operands to Number.
  const unit = 10n ** 40n, scaled = numerator * unit / denominator;
  const rate = Number(`${scaled / unit}.${(scaled % unit).toString().padStart(40, '0')}`);
  if (!Number.isFinite(rate) || rate <= 0 || !isCurrencyConversionConsistent(sourceMinor, from, to, rate, destinationMinor)) {
    throw new RangeError('Kurs tidak dapat disimpan dengan ketepatan nominal yang diperlukan.');
  }
  return rate;
}
