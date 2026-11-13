import type { Entry, Wallet } from './finance';
import type { ImportPreview, ImportRow } from './importer';
import { genericFingerprint, parseStatementMoney } from './genericImport';
import { extractPdfText, type PdfTextRun } from './pdfText';

/** Reader for the "Riwayat Transaksi" / "Pocket Transactions History" PDF that
 * the Bank Jago app exports for one Kantong. The PDF is a fixed table: date and
 * time, counterparty, operation with its ID#, note, signed amount and running
 * balance. Rows are kept only when the balance chain proves none is missing.
 *
 * Rows are stored as general-format bank facts (generic-v1), so saved data and
 * backups keep their existing format. Money in is income and money out is
 * expense; every row can still be changed in preview.
 */

const UNCATEGORIZED = 'Belum dikategorikan';
const MAX_ROWS = 50_000;
const TOLERANCE = 3;

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agt: 8, agu: 8, ags: 8, agus: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

function fail(message: string): never { throw new Error(message); }

/** Display text: compatibility forms (ligatures), no-break spaces and runs of spaces folded. */
function clean(text: string): string {
  return text.normalize('NFKC').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Comparison text: lower case, letters and digits only. */
function folded(text: string): string {
  return clean(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function parseDate(text: string): string | undefined {
  const match = /^(\d{1,2}) (\p{L}{3,9})\.? (\d{4})$/u.exec(clean(text));
  if (!match) return undefined;
  const day = Number(match[1]), month = MONTHS[match[2].toLowerCase()], year = Number(match[3]);
  if (!month || year < 1900 || year > 2199) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const looksLikeDate = (text: string): boolean => /^\d{1,2}\s+\S+\s+\d{4}$/.test(clean(text));
const isMonthHeader = (text: string): boolean => /^\p{L}+ \d{4}$/u.test(clean(text)) && !!MONTHS[clean(text).split(' ')[0].toLowerCase()];
const isTime = (text: string): boolean => /^\d{1,2}[.:]\d{2}$/.test(clean(text));

interface Columns { header: number; date: number; source: number; detail: number; note: number; amounts: number }
interface RawRow { page: number; anchor: PdfTextRun; date: string; runs: PdfTextRun[] }

function findColumns(runs: PdfTextRun[]): Columns | undefined {
  const header = runs.find(run => folded(run.text) === 'tanggal waktu');
  if (!header) return undefined;
  const same = runs.filter(run => Math.abs(run.y - header.y) <= TOLERANCE);
  const at = (label: string) => same.find(run => folded(run.text) === label)?.x;
  const source = at('sumber tujuan'), detail = at('rincian transaksi'), note = at('catatan'), amount = at('jumlah'), balance = at('saldo');
  if ([source, detail, note, amount, balance].some(value => value === undefined)) return fail('Kolom tabel Jago tidak lengkap. Dibutuhkan Tanggal & Waktu, Sumber/Tujuan, Rincian Transaksi, Catatan, Jumlah, dan Saldo.');
  if (!(header.x < source! && source! < detail! && detail! < note! && note! < amount! && amount! < balance!)) return fail('Urutan kolom tabel Jago tidak dikenali.');
  return { header: header.y, date: header.x, source: source!, detail: detail!, note: note!, amounts: note! + (amount! - note!) / 2 };
}

/** Lines of one cell, top to bottom. */
function lines(runs: PdfTextRun[]): PdfTextRun[] {
  return [...runs].sort((a, b) => b.y - a.y || a.x - b.x).map(run => ({ ...run, text: clean(run.text) })).filter(run => run.text);
}
/** Bank IDs and codes wrap mid-token; words wrap at spaces. */
function joinWrapped(parts: string[]): string {
  let text = '', last = '';
  for (const part of parts) {
    text = !text ? part : !/\s/.test(last) && !/\s/.test(part) && last.length >= 12 ? text + part : `${text} ${part}`;
    last = part;
  }
  return text;
}

interface JagoRow {
  date: string; time: string; title: string; party: string; partyDetail: string; reference: string;
  detail: string; note: string; amountText: string; balanceText: string;
}

function readRow(raw: RawRow, columns: Columns): JagoRow {
  const cell = (from: number, to: number) => lines(raw.runs.filter(run => run.x >= from - 4 && run.x < to - 4));
  const where = `transaksi ${raw.date}`;
  const dateCell = cell(-Infinity, columns.source);
  const time = dateCell.find(run => isTime(run.text))?.text.replace(':', '.') ?? '';
  const sourceCell = cell(columns.source, columns.detail);
  const detailCell = cell(columns.detail, columns.note);
  const noteCell = cell(columns.note, columns.amounts + 4);
  const amountCell = cell(columns.amounts + 4, Infinity);

  const largest = (items: PdfTextRun[]) => Math.max(0, ...items.map(run => run.size));
  const sourceSize = largest(sourceCell);
  const party = sourceCell.filter(run => run.size >= sourceSize - 0.5).map(run => run.text).join(' ');
  const partyDetail = joinWrapped(sourceCell.filter(run => run.size < sourceSize - 0.5).map(run => run.text));

  const idIndex = detailCell.findIndex(run => /^ID\s*#/i.test(run.text));
  const beforeId = idIndex < 0 ? detailCell : detailCell.slice(0, idIndex);
  const titleSize = largest(beforeId);
  const title = beforeId.filter(run => run.size >= titleSize - 0.5).map(run => run.text).join(' ');
  const extra = beforeId.filter(run => run.size < titleSize - 0.5).map(run => run.text);
  let reference = '';
  if (idIndex >= 0) {
    reference = detailCell[idIndex].text.replace(/^ID\s*#\s*/i, '');
    let index = idIndex + 1;
    for (; index < detailCell.length && !/\s/.test(detailCell[index].text); index++) reference += detailCell[index].text;
    extra.push(...detailCell.slice(index).map(run => run.text));
  }
  const note = noteCell.map(run => run.text).join(' ');

  const signed = amountCell.filter(run => /^[+\-−]/.test(run.text));
  const unsigned = amountCell.filter(run => !/^[+\-−]/.test(run.text));
  if (signed.length !== 1 || unsigned.length !== 1 || signed[0].x >= unsigned[0].x) fail(`Jumlah dan saldo ${where} tidak terbaca. Impor dibatalkan agar tidak ada transaksi yang terlewat.`);
  if (!title) fail(`Rincian ${where} kosong. Unduh ulang PDF dari aplikasi Jago.`);
  return { date: raw.date, time, title, party, partyDetail, reference, detail: extra.join(' '), note: note === '-' ? '' : note,
    amountText: signed[0].text, balanceText: unsigned[0].text };
}

/** The statement's own sections, in order, split into raw transaction rows. */
function collectRows(pages: PdfTextRun[][]): { rows: (RawRow & { columns: Columns })[]; header: PdfTextRun[] } {
  const rows: (RawRow & { columns: Columns })[] = [];
  let header: PdfTextRun[] = [];
  let seenTable = false;
  pages.forEach((runs, page) => {
    const columns = findColumns(runs);
    if (!columns) {
      if (runs.some(run => looksLikeDate(run.text) && run.x < 80)) fail(`Halaman ${page + 1} tidak memiliki judul kolom tabel Jago. Unduh ulang PDF tanpa mengubahnya.`);
      return;
    }
    if (!seenTable) header = runs.filter(run => run.y > columns.header + TOLERANCE);
    seenTable = true;
    const stop = runs.filter(run => folded(run.text) === 'info penting' && run.y < columns.header).reduce((top, run) => Math.max(top, run.y), -Infinity);
    const footer = runs.filter(run => run.y < columns.header && /pt bank jago tbk|jago com|halaman \d+ dari \d+|lembaga penjamin/.test(folded(run.text)))
      .reduce((top, run) => Math.max(top, run.y), -Infinity);
    const floor = Math.max(stop, footer) + TOLERANCE;
    const body = runs.filter(run => run.y < columns.header - TOLERANCE && run.y > floor);
    const dateColumn = (run: PdfTextRun) => run.x < columns.source - 4;
    const anchors = body.filter(run => dateColumn(run) && parseDate(run.text)).sort((a, b) => b.y - a.y);
    for (const run of body) {
      if (dateColumn(run) && looksLikeDate(run.text) && !parseDate(run.text)) fail(`Tanggal "${clean(run.text)}" di halaman ${page + 1} tidak dikenali. Impor dibatalkan agar tidak ada transaksi yang terlewat.`);
    }
    const pageRows = anchors.map(anchor => ({ page, anchor, date: parseDate(anchor.text)!, runs: [] as PdfTextRun[], columns }));
    for (const run of body) {
      if (anchors.includes(run) || dateColumn(run) && isMonthHeader(run.text)) continue;
      // Rows are top-down; a cell line belongs to the nearest date at or above it.
      let target: typeof pageRows[number] | undefined;
      for (const row of pageRows) { if (row.anchor.y + TOLERANCE >= run.y) target = row; else break; }
      if (target) target.runs.push(run);
      else if (rows.length) rows[rows.length - 1].runs.push({ ...run }); // continued from the previous page
      else if (/\d/.test(run.text) && run.x >= columns.amounts) fail(`Ada nominal di luar baris transaksi pada halaman ${page + 1}.`);
    }
    rows.push(...pageRows);
  });
  if (!seenTable) fail('Ini bukan PDF riwayat transaksi Bank Jago. Unduh PDF "Riwayat Transaksi" dari aplikasi Jago (bukan tangkapan layar atau e-statement bank lain).');
  return { rows, header };
}

type Operation = Pick<ImportRow, 'classification' | 'category' | 'warning'>;

/** The owner's own accounts are recognised from the account-holder name the bank prints:
 * - the name at the top of the statement, matched in the counterparty name (exact, or masked
 *   with the visible letters in order, e.g. a DANA top-up account printed as "ZAYXXX SYA");
 * - the bank's own wording for moves to or from their own Kantong and e-wallet top-ups.
 * An account number alone is not proof: a virtual account can be issued to the owner's
 * phone for a payment to someone else. Shopee and ShopeePay are never treated as own: the
 * owner cannot export their statement, so money to them is expense and money from them is
 * income (owner's decision, 13 Nov 2026). */
const OWN_TITLES = ['tambah uang kantong', 'tarik uang kantong', 'pemindahan dari akun lama', 'isi saldo dompet digital'];
const OWN_WARNING = 'Dikenali sebagai rekening atau e-wallet milikmu (nama di rekening sama dengan nama pemilik di PDF). Hanya perubahan saldo yang dicatat; bukan pemasukan atau pengeluaran. Ubah jenisnya bila keliru.';

function ownerNameFrom(pages: PdfTextRun[][]): string | undefined {
  const top = (pages[0] ?? []).filter(run => run.y > 700 && clean(run.text)).sort((a, b) => b.size - a.size || b.y - a.y)[0];
  const tokens = top ? folded(top.text).split(' ').filter(Boolean) : [];
  return tokens.length >= 2 ? tokens.slice(0, 2).join(' ') : undefined;
}

/** Shopee and ShopeePay statements cannot be exported, so the bank's wording decides
 * only the sign: money out is expense, money in is income. */
const isShopee = (row: JagoRow): boolean => /shopee/.test(folded(row.party)) || /shopee/.test(folded(row.partyDetail));

/** Counterparty name is the owner's: the name in full, or masked with its visible letters
 * matching the owner's name words in order (at least three visible letters each). */
function nameIsOwner(party: string, owner: string): boolean {
  const text = folded(party).replace(/^(?:dana|danatopup|go pay|gopay|ovo|linkaja)\s+/, '');
  if (!owner) return false;
  if (text.includes(owner)) return true;
  const tokens = text.split(' ').filter(Boolean), names = owner.split(' ');
  if (!tokens.some(token => /x{3,}/.test(token)) || tokens.length < 2 || tokens.length > names.length) return false;
  return tokens.every((token, index) => {
    const visible = token.replace(/x{3,}.*$/, '');
    return visible.length >= 3 && names[index].startsWith(visible);
  });
}

function isOwnAccount(row: JagoRow, owner: string | undefined): boolean {
  if (isShopee(row)) return false;
  if (OWN_TITLES.includes(folded(row.title))) return true;
  return !!owner && nameIsOwner(row.party, owner);
}

/** Owner's rule (12 Nov 2026, revised): money from other people is income and money
 * to other people is expense. Moves to or from the owner's own accounts only change
 * balances and are not counted in either total. */
function classify(row: JagoRow, amount: number, own: boolean, earlier: readonly { row: JagoRow; amount: number }[]): Operation {
  if (own) return { classification: 'movement', category: 'Transfer', warning: OWN_WARNING };
  const operation = folded(row.title);
  const classification = amount > 0 ? 'income' : 'expense';
  let category = UNCATEGORIZED;
  let warning: string | undefined;
  if (operation === 'pembayaran dengan jago pay' && amount < 0 && /\bgo ?food/.test(folded(row.note))) {
    category = 'Makan & minum';
  } else if (operation === 'transaksi pos' && amount > 0 && row.reference
    && earlier.some(item => folded(item.row.title) === 'transaksi pos' && item.row.reference === row.reference && item.amount === -amount)) {
    category = 'Pengembalian dana';
    warning = 'Pembayaran kartu dengan ID dan nominal yang sama dikembalikan.';
  } else if (operation === 'bonus' && amount > 0) {
    category = 'Cashback';
  }
  return { classification, category, warning };
}

function describe(row: JagoRow): string {
  const parts = [row.title, folded(row.party) === folded(row.title) ? '' : row.party, row.partyDetail === row.reference ? '' : row.partyDetail, row.detail,
    folded(row.note) === folded(row.party) ? '' : row.note];
  return parts.filter(Boolean).join(' · ');
}

export function parseJagoStatement(data: ArrayBuffer | Uint8Array, wallet: Wallet, existing: readonly Entry[]): ImportPreview {
  if (wallet.kind === 'cash') fail('Pilih rekening bank atau e-wallet untuk impor mutasi. Pembukuan cash tidak digunakan.');
  const pages = extractPdfText(data);
  const all = pages.flat();
  if (!all.length) fail('PDF ini tidak memuat teks (mungkin hasil pindai atau foto). Unduh PDF "Riwayat Transaksi" langsung dari aplikasi Jago.');
  if (!all.some(run => /\bjago\b/.test(folded(run.text)))) fail('Ini bukan PDF riwayat transaksi Bank Jago. Untuk bank lain, pilih format lain di atas.');
  const { rows: rawRows, header } = collectRows(pages);
  const readRows = rawRows.map(raw => readRow(raw, raw.columns));
  const ownerName = ownerNameFrom(pages);
  const headerText = header.map(run => clean(run.text));
  const currency = headerText.map(text => /\btransaksi ([A-Z]{3}) dari\b/i.exec(text)?.[1]?.toUpperCase()).find(Boolean)
    ?? headerText.map(text => /^([A-Z]{3}) [\d.,]+$/.exec(text)?.[1]).find(Boolean);
  if (!currency) fail('Mata uang di PDF tidak ditemukan. Unduh ulang PDF dari aplikasi Jago.');
  if (currency !== wallet.currency) fail(`PDF ini memakai ${currency}. Pilih dompet dengan mata uang ${currency}.`);
  if (!rawRows.length) fail('Tidak ada transaksi di PDF ini. Pilih periode yang berisi transaksi.');
  if (rawRows.length > MAX_ROWS) fail('Terlalu banyak transaksi. Unduh periode yang lebih singkat.');

  const known = new Set(existing.flatMap(entry => [entry.sourceKey, entry.toSourceKey]).filter(Boolean));
  const seen = new Set<string>();
  const parsed: { row: JagoRow; amount: number }[] = [];
  const rows: ImportRow[] = readRows.map((row, index) => {
    const where = `transaksi ${row.date}${row.time ? ` ${row.time}` : ''}`;
    let amount: number, balance: number;
    try {
      amount = parseStatementMoney(row.amountText, wallet.currency, ',');
      balance = parseStatementMoney(row.balanceText, wallet.currency, ',');
    } catch (error) { return fail(`Nominal ${where} tidak valid: ${error instanceof Error ? error.message : ''}`.trim()); }
    if (!amount) fail(`Nominal nol pada ${where} perlu diperiksa sebelum impor.`);
    const description = describe(row);
    const reference = row.reference || row.time;
    const sourceKey = `generic:${genericFingerprint(JSON.stringify([wallet.id, wallet.currency, row.date, amount, balance, description.normalize('NFC').trim(), reference.normalize('NFC').trim()]))}`;
    if (seen.has(sourceKey)) fail(`Dua transaksi identik pada ${where}. Unduh ulang PDF dari aplikasi Jago.`);
    seen.add(sourceKey);
    const duplicate = known.has(sourceKey);
    const operation = classify(row, amount, isOwnAccount(row, ownerName), parsed);
    parsed.push({ row, amount });
    return { id: `${sourceKey}:${index}`, date: row.date, description, originalDescription: description, amount, balance,
      reference, originalReference: reference, sourceKey, fingerprintVersion: 'generic-v1', ...operation,
      selected: !duplicate, duplicate, warning: duplicate ? 'Sudah ada atau identik dengan baris lain. Tidak dipilih.' : operation.warning };
  });

  const ascending = rows.every((row, i) => i === 0 || rows[i - 1].date <= row.date);
  const descending = rows.every((row, i) => i === 0 || rows[i - 1].date >= row.date);
  const chainForward = rows.every((row, i) => i === 0 || BigInt(rows[i - 1].balance) + BigInt(row.amount) === BigInt(row.balance));
  const chainBackward = rows.every((row, i) => i === rows.length - 1 || BigInt(rows[i + 1].balance) + BigInt(row.amount) === BigInt(row.balance));
  const oldestFirst = ascending && chainForward, newestFirst = descending && chainBackward;
  if (!oldestFirst && !newestFirst) {
    fail('Saldo antarbaris tidak cocok dengan jumlah transaksi. Mungkin PDF memakai filter (mis. hanya uang masuk) atau ada halaman yang hilang. Unduh ulang tanpa filter.');
  }
  const order = oldestFirst ? 'oldest' : 'newest';
  const oldest = order === 'oldest' ? rows[0] : rows[rows.length - 1];
  const newest = order === 'oldest' ? rows[rows.length - 1] : rows[0];
  const openingBalance = oldest.balance - oldest.amount;
  if (!Number.isSafeInteger(openingBalance)) fail('Saldo awal di luar rentang angka yang didukung.');

  const warnings: string[] = [];
  const duplicateCount = rows.filter(row => row.duplicate).length;
  if (duplicateCount) warnings.push(`${duplicateCount} transaksi kemungkinan sudah ada dan tidak dipilih.`);
  const latest = headerText.map(text => /^[A-Z]{3} ([\d.,]+)$/.exec(text)?.[1]).find(Boolean);
  if (latest) {
    try {
      if (parseStatementMoney(latest, wallet.currency, ',') !== newest.balance) warnings.push('Saldo terbaru di bagian atas PDF berbeda dengan saldo transaksi terakhir. Mungkin ada transaksi sesudah periode yang dipilih.');
    } catch { /* the header figure is informational only */ }
  }
  if (!ownerName) warnings.push('Nama pemilik rekening tidak terbaca di bagian atas PDF. Transfer ke rekening sendiri hanya dikenali dari jenis operasinya; periksa jenis baris yang dicatat sebagai pemasukan atau pengeluaran.');
  warnings.push('PDF Bank Jago dibaca untuk satu Kantong. Uang dari orang lain dicatat sebagai pemasukan dan uang ke orang lain sebagai pengeluaran. Pindah Kantong dan transfer ke atau dari rekening atau e-wallet milikmu hanya mengubah saldo dan tidak dihitung sebagai pemasukan atau pengeluaran.');
  return { rows, sourceOrder: order, currency: wallet.currency, openingBalance, closingBalance: newest.balance, warnings,
    period: { start: oldest.date, end: newest.date } };
}
