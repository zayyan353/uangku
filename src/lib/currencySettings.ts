import { isCurrencyCode, LEGACY_CURRENCY_CODES, type Currency } from './currencyCatalog';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';
import { prepareBackup } from './storage';

/** Availability only: removing a tab does not change wallets or stored money. */
export function visibleCurrencyCodes(data: SourceDocument): Currency[] {
  return data.metadata?.currencies?.map(row => row.code)
    ?? [...new Set<Currency>([...LEGACY_CURRENCY_CODES, ...data.state.wallets.map(wallet => wallet.currency)])];
}

export function setVisibleCurrencies(data: SourceDocument, codes: readonly string[]): SourceDocument {
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 200) throw new Error('Pilih setidaknya satu mata uang; maksimal 200.');
  if (!codes.every(isCurrencyCode)) throw new Error('Kode mata uang tidak didukung. Pilih dari katalog mata uang.');
  if (new Set(codes).size !== codes.length) throw new Error('Daftar mata uang tidak boleh berulang.');
  const current = visibleCurrencyCodes(data);
  if (current.length === codes.length && current.every((code, index) => code === codes[index])) return data;
  const metadata = data.metadata ?? { policy: SOURCE_POLICY, facts: [], links: [], statements: [] };
  return prepareBackup({ ...data, metadata: { ...metadata, currencies: codes.map(code => ({ code })) } }).data;
}

export function addVisibleCurrency(data: SourceDocument, code: string): SourceDocument {
  if (!isCurrencyCode(code)) throw new Error('Kode mata uang tidak didukung. Pilih dari katalog mata uang.');
  const visible = visibleCurrencyCodes(data);
  return visible.includes(code) ? data : setVisibleCurrencies(data, [...visible, code]);
}

export function removeVisibleCurrency(data: SourceDocument, code: string): SourceDocument {
  if (!isCurrencyCode(code)) throw new Error('Kode mata uang tidak didukung.');
  return setVisibleCurrencies(data, visibleCurrencyCodes(data).filter(existing => existing !== code));
}
