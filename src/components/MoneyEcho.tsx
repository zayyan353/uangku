import { formatMoney, parseMoney, type Currency } from '../lib/finance';

/**
 * Reads back what was typed in an amount field with thousands separators
 * ("Rp 2.400.000"), so a long number can be checked at a glance. It only
 * displays: the field keeps the typed text and parseMoney decides validity.
 * Nothing is shown for an empty, invalid or short (under 1.000) amount.
 */
export default function MoneyEcho({ text, currency }: { text: string; currency?: Currency }) {
  if (!currency || !text.trim()) return null;
  const minor = parseMoney(text, currency);
  if (minor === null || !Number.isSafeInteger(minor) || text.replace(/[^\d]/g, '').length < 4) return null;
  return <span className="field-help money-echo" data-testid="money-echo">Terbaca: {formatMoney(minor, currency)}</span>;
}
