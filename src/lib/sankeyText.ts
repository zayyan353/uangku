import type { CashflowReport } from './cashflowReport';
import { currencyDigits, type Currency } from './currencyCatalog';

const CENTRAL_NODE = 'Kas bulan ini';
const RESERVED = [CENTRAL_NODE, 'Pemasukan', 'Dari saldo', 'Sisa'];

function cleanLabel(label: string): string {
  return label.replace(/[\[\]\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?::|\/\/)\s*)+/, '')
    // A trailing hex colour or opacity would change the flow style and truncate its target name.
    .replace(/\s(#(?:[a-f\d]{3,6}(?:\.\d{1,4})?|\.\d{1,4}))$/i, ' ($1)') || 'Kategori';
}

function exactMinor(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError('Nominal ekspor SankeyMATIC harus berupa bilangan bulat aman.');
  return BigInt(value);
}

export function sankeyText(report: Pick<CashflowReport, 'incomeTotal' | 'categoryTotals'>, currency: Currency, month: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Bulan ekspor SankeyMATIC tidak valid.');
  const digits = currencyDigits(currency);
  const income = exactMinor(report.incomeTotal);
  if (income < 0n) throw new RangeError('Pemasukan terkonfirmasi tidak boleh negatif.');
  const lines = [`// Uangku · ${month} · ${currency}`];
  function flow(from: string, minor: bigint, to: string) {
    const number = minor.toString().padStart(digits + 1, '0');
    const major = digits ? number.slice(0, -digits) + '.' + number.slice(-digits) : number;
    lines.push(`${from} [${major}] ${to}`);
  }

  const categories = report.categoryTotals.map(([name, value]) => ({ label: cleanLabel(name), amount: exactMinor(value) }));
  const originalLabels = new Set(categories.map(category => category.label));
  const used = new Set(RESERVED);
  const suffixes = new Map<string, number>();
  let spending = 0n;
  if (income > 0n) flow('Pemasukan', income, CENTRAL_NODE);
  for (const { label, amount } of categories) {
    if (amount <= 0n) {
      lines.push(`// Dilewati karena nominalnya nol atau negatif: ${label}`);
      continue;
    }
    let name = label;
    if (used.has(name)) {
      let suffix = suffixes.get(label) ?? 2;
      do { name = `${label} (${suffix++})`; } while (originalLabels.has(name) || used.has(name));
      suffixes.set(label, suffix);
    }
    used.add(name);
    flow(CENTRAL_NODE, amount, name);
    spending += amount;
  }
  if (spending > income) flow('Dari saldo', spending - income, CENTRAL_NODE);
  if (income > spending) flow(CENTRAL_NODE, income - spending, 'Sisa');
  if (income === 0n && spending === 0n) lines.push('// Belum ada pemasukan atau pengeluaran positif.');
  return lines.join('\n');
}
