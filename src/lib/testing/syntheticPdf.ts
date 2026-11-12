import { zlibSync } from 'fflate';

/** Builds small PDFs for tests: Type0/Identity-H fonts with a ToUnicode CMap,
 * FlateDecode content and, optionally, dictionaries inside an object stream
 * (as modern bank exports do). All text is synthetic. */

export interface SyntheticText { x: number; y: number; size: number; text: string; font?: 'F1' | 'F2' | 'F3' }
export interface SyntheticPdfOptions {
  objectStream?: boolean;
  /** Draw "ft" as one ligature glyph: mapped by an array-form bfrange, or left out
   * of the ToUnicode map as the Bank Jago producer does. */
  ligature?: 'mapped' | 'unmapped';
  /** Base font name; the reader recognises some families' unmapped ligatures. */
  baseFont?: string;
  encrypt?: boolean;
  /** Extra raw content appended to the first page. */
  rawContent?: string;
}

const encoder = new TextEncoder();
const hex = (code: number) => code.toString(16).toUpperCase().padStart(4, '0');

function concat(parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map(part => typeof part === 'string' ? latin1Bytes(part) : part);
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 255;
  return out;
}

export function syntheticPdf(pages: SyntheticText[][], options: SyntheticPdfOptions = {}): Uint8Array {
  const ligatureCode = options.ligature === 'unmapped' ? 0x01e3 : 0xf000;
  const glyphs = (text: string): number[] => {
    const out: number[] = [];
    for (let index = 0; index < text.length; index++) {
      if (options.ligature && text.startsWith('ft', index)) { out.push(ligatureCode); index++; }
      else out.push(text.charCodeAt(index));
    }
    return out;
  };
  const used = new Set<number>();
  for (const page of pages) for (const item of page) for (const code of glyphs(item.text)) used.add(code);
  const mapped = [...used].filter(code => code !== ligatureCode || !options.ligature).sort((a, b) => a - b);
  // A bfrange for the printable ASCII block, bfchar for everything else, and
  // one array-form bfrange so each CMap form is read.
  const ascii = mapped.filter(code => code >= 0x41 && code <= 0x5a);
  const others = mapped.filter(code => !(code >= 0x41 && code <= 0x5a));
  const cmap = ['/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Synthetic-UCS def 1 begincodespacerange <0000> <FFFF> endcodespacerange',
    ascii.length ? `1 beginbfrange <0041> <005A> <0041> endbfrange` : '',
    `1 beginbfrange <F000> <F001> [<0066 0074> <0066 0068>] endbfrange`,
    `${others.length} beginbfchar ${others.map(code => `<${hex(code)}> <${hex(code)}>`).join(' ')} endbfchar`,
    'endcmap CMapName currentdict /CMap defineresource pop end end'].join('\n');

  const objects: { number: number; body: string | Uint8Array; inStream?: boolean }[] = [];
  let next = 1;
  const add = (body: string | Uint8Array, inStream = false) => { const number = next++; objects.push({ number, body, inStream }); return number; };
  const stream = (dict: string, data: Uint8Array, compress = true) => {
    const payload = compress ? zlibSync(data) : data;
    return concat([`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${payload.length} >>\nstream\n`, payload, '\nendstream']);
  };

  const catalog = add('', true);
  const pagesNumber = add('', true);
  const toUnicode = add(stream('', encoder.encode(cmap)));
  const fontNames = { F1: 'Synthetic-Bold', F2: options.baseFont ?? 'Synthetic-Regular', F3: 'Synthetic-Italic' };
  const fonts = Object.fromEntries(Object.entries(fontNames).map(([key, name]) => {
    const descendant = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>`, true);
    return [key, add(`<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`, true)];
  }));
  const pageNumbers: number[] = [];
  pages.forEach((page, index) => {
    const lines: string[] = ['q', '1 1 1 rg 20 100 555 40 re f', 'Q'];
    for (const item of page) {
      const encoded = glyphs(item.text).map(hex).join('');
      lines.push(`0 0 0 sc /${item.font ?? 'F2'} ${item.size} Tf BT ${item.x} ${item.y} Td <${encoded}> Tj ET`);
    }
    if (index === 0 && options.rawContent) lines.push(options.rawContent);
    const content = add(stream('', encoder.encode(lines.join('\n'))));
    const fontDict = Object.entries(fonts).map(([key, number]) => `/${key} ${number} 0 R`).join(' ');
    pageNumbers.push(add(`<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << ${fontDict} >> >> >>`, true));
  });
  objects.find(item => item.number === catalog)!.body = `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`;
  objects.find(item => item.number === pagesNumber)!.body = `<< /Type /Pages /Count ${pageNumbers.length} /Kids [${pageNumbers.map(number => `${number} 0 R`).join(' ')}] >>`;
  const encrypt = options.encrypt ? add('<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>') : undefined;

  const parts: (string | Uint8Array)[] = ['%PDF-1.6\n%\xe2\xe3\xcf\xd3\n'];
  const offsets = new Map<number, number>();
  let length = latin1Bytes(parts[0] as string).length;
  const push = (part: string | Uint8Array) => { parts.push(part); length += typeof part === 'string' ? latin1Bytes(part).length : part.length; };
  const direct = options.objectStream ? objects.filter(item => !item.inStream) : objects;
  for (const item of direct) {
    offsets.set(item.number, length);
    push(`${item.number} 0 obj\n`); push(item.body); push('\nendobj\n');
  }
  if (options.objectStream) {
    const packed = objects.filter(item => item.inStream);
    let header = '', body = '';
    for (const item of packed) { header += `${item.number} ${body.length} `; body += `${item.body as string}\n`; }
    const number = next++;
    offsets.set(number, length);
    push(`${number} 0 obj\n`);
    push(stream(`/Type /ObjStm /N ${packed.length} /First ${header.length}`, encoder.encode(header + body)));
    push('\nendobj\n');
    const xref = next++;
    offsets.set(xref, length);
    push(`${xref} 0 obj\n`);
    push(stream(`/Type /XRef /Size ${next} /W [1 4 2] /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ''}`, new Uint8Array(7 * next)));
    push(`\nendobj\nstartxref\n${offsets.get(xref)}\n%%EOF\n`);
    return concat(parts);
  }
  const xrefAt = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let number = 1; number < next; number++) table += `${String(offsets.get(number) ?? 0).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${next} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concat(parts);
}

export interface SyntheticJagoRow {
  date: string; time: string; party: string[]; partyDetail?: string[]; title: string[]; id: string[]; note?: string[];
  amount: string; balance: string;
}

/** Lays rows out like the Bank Jago "Pocket Transactions History" PDF. */
export function syntheticJagoPdf(rows: SyntheticJagoRow[], options: { owner?: string; currency?: string; latest?: string; perPage?: number; months?: boolean; pdf?: SyntheticPdfOptions } = {}): Uint8Array {
  const perPage = options.perPage ?? 10;
  const currency = options.currency ?? 'IDR';
  const pages: SyntheticText[][] = [];
  let page: SyntheticText[] = [];
  let y = 0, month = '';
  const startPage = (first: boolean) => {
    page = [{ x: 348, y: 809.89, size: 12, text: 'Pocket Transactions History', font: 'F1' }, { x: 496.2, y: 809.89, size: 12, text: 'Halaman 1 dari 1' }];
    let header = 717.74;
    if (first) {
      header = 647.74;
      page.push({ x: 20, y: 753.89, size: 16, text: options.owner ?? 'BUDI CONTOH SANTOSO', font: 'F1' },
        { x: 20, y: 735.89, size: 12, text: 'Kantong Utama 100200300400', font: 'F1' },
        { x: 469.58, y: 705.89, size: 10, text: 'Saldo terbaru 30 Nov 2026' },
        { x: 505.68, y: 691.89, size: 12, text: `${currency} ${options.latest ?? rows.at(-1)?.balance ?? '0'}`, font: 'F1' },
        { x: 20, y: 705.89, size: 10, text: `Menampilkan transaksi ${currency} dari` },
        { x: 20, y: 691.89, size: 12, text: '01 Jan 2026 - 30 Nov 2026', font: 'F1' });
    }
    for (const [x, text] of [[24, 'Tanggal & Waktu'], [86, 'Sumber/Tujuan'], [186, 'Rincian Transaksi'], [290, 'Catatan'], [457.08, 'Jumlah'], [551.29, 'Saldo']] as const) {
      page.push({ x, y: header, size: 9, text });
    }
    page.push({ x: 103, y: 31.7, size: 9, text: 'PT Bank Jago Tbk berizin dan diawasi oleh Otoritas Jasa Keuangan (OJK) dan Bank Indonesia,' },
      { x: 521.64, y: 27.7, size: 9, text: 'www.jago.com' });
    pages.push(page);
    y = header - 22;
  };
  startPage(true);
  rows.forEach((row, index) => {
    if (index && index % perPage === 0) startPage(false);
    const label = row.date.split(' ').slice(1).join(' ');
    if (options.months !== false && label !== month) {
      month = label;
      page.push({ x: 24, y, size: 9, text: monthName(label), font: 'F1' });
      y -= 20;
    }
    const top = y;
    page.push({ x: 24, y: top, size: 10, text: row.date }, { x: 24, y: top - 12, size: 8, text: row.time });
    let line = top + 0.25;
    for (const text of row.party) { page.push({ x: 86, y: line, size: 10, text }); line -= 12; }
    for (const text of row.partyDetail ?? []) { page.push({ x: 86, y: line, size: 8, text }); line -= 9.6; }
    let detail = top - 0.17;
    for (const text of row.title) { page.push({ x: 186, y: detail, size: 10, text }); detail -= 12; }
    row.id.forEach((text, part) => { page.push({ x: 186, y: detail, size: 8, text: part ? text : `ID# ${text}` }); detail -= 9.6; });
    let note = top;
    for (const text of row.note ?? []) { page.push({ x: 290, y: note, size: 9, text, font: 'F3' }); note -= 10.8; }
    page.push({ x: 500 - row.amount.length * 5, y: top - 0.5, size: 10, text: row.amount }, { x: 590 - row.balance.length * 5, y: top - 0.5, size: 10, text: row.balance });
    y = Math.min(line, detail, note, top - 12) - 18;
  });
  page.push({ x: 20, y: y - 20, size: 10, text: 'Info Penting', font: 'F1' },
    { x: 20, y: y - 42, size: 8, text: 'Dokumen ini adalah daftar Riwayat Transaksi Jago Anda. Contoh 12 Jan 2026 tidak dibaca.' });
  return syntheticPdf(pages, options.pdf);
}

function monthName(label: string): string {
  const [short, year] = label.split(' ');
  const names: Record<string, string> = { Jan: 'Januari', Feb: 'Februari', Mar: 'Maret', Apr: 'April', Mei: 'Mei', Jun: 'Juni', Jul: 'Juli', Agt: 'Agustus', Sep: 'September', Okt: 'Oktober', Nov: 'November', Des: 'Desember' };
  return `${names[short] ?? short} ${year}`;
}
