import { Inflate, Unzlib } from 'fflate';

/** A piece of text the page draws from one position, in PDF user space
 * (points, origin bottom-left). Widths are not computed: callers place text by
 * where it starts, which is all a fixed bank layout needs. */
export interface PdfTextRun { x: number; y: number; size: number; text: string }

/** Small reader for text in unencrypted, machine-made PDFs such as bank
 * statements. It locates objects by scanning (no xref needed), opens object
 * streams, decodes FlateDecode content, and maps glyph codes through each
 * font's ToUnicode CMap. Anything it cannot read with certainty is an error,
 * never a guess. Images, vector paths and forms are skipped. */

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DECODED_BYTES = 48 * 1024 * 1024;
const MAX_OBJECTS = 200_000;
const MAX_PAGES = 500;
const MAX_RUNS = 400_000;
const MAX_DEPTH = 64;

function fail(message: string): never { throw new Error(message); }

type PdfName = { name: string };
type PdfRef = { ref: number; gen: number };
type PdfString = { bytes: Uint8Array };
type PdfDict = Map<string, PdfValue>;
type PdfStream = { dict: PdfDict; start: number; end: number; source: Uint8Array };
type PdfValue = number | boolean | null | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict | PdfStream;

const isName = (value: unknown): value is PdfName => !!value && typeof value === 'object' && 'name' in value;
const isRef = (value: unknown): value is PdfRef => !!value && typeof value === 'object' && 'ref' in value;
const isString = (value: unknown): value is PdfString => !!value && typeof value === 'object' && 'bytes' in value;
const isDict = (value: unknown): value is PdfDict => value instanceof Map;
const isStream = (value: unknown): value is PdfStream => !!value && typeof value === 'object' && 'dict' in value && 'source' in value;

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const isRegular = (byte: number): boolean => !WHITESPACE.has(byte) && !DELIMITERS.has(byte);

/** Tokens of the PDF object syntax and of content streams (which add operators). */
class Lexer {
  pos: number;
  constructor(readonly bytes: Uint8Array, start = 0, readonly end = bytes.length) { this.pos = start; }

  skipSpace(): void {
    const { bytes } = this;
    while (this.pos < this.end) {
      const byte = bytes[this.pos];
      if (WHITESPACE.has(byte)) { this.pos++; continue; }
      if (byte === 37) { // % comment to end of line
        while (this.pos < this.end && bytes[this.pos] !== 10 && bytes[this.pos] !== 13) this.pos++;
        continue;
      }
      break;
    }
  }

  word(): string {
    const start = this.pos;
    while (this.pos < this.end && isRegular(this.bytes[this.pos])) this.pos++;
    let text = '';
    for (let index = start; index < this.pos; index++) text += String.fromCharCode(this.bytes[index]);
    return text;
  }

  name(): PdfName {
    this.pos++; // '/'
    const raw = this.word();
    return { name: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) };
  }

  literalString(): PdfString {
    const { bytes } = this;
    const out: number[] = [];
    let depth = 1;
    this.pos++; // '('
    while (this.pos < this.end) {
      const byte = bytes[this.pos++];
      if (byte === 92) { // backslash
        if (this.pos >= this.end) break;
        const next = bytes[this.pos++];
        const simple: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (next in simple) out.push(simple[next]);
        else if (next >= 48 && next <= 55) {
          let value = next - 48;
          for (let count = 0; count < 2 && this.pos < this.end && bytes[this.pos] >= 48 && bytes[this.pos] <= 55; count++) value = value * 8 + bytes[this.pos++] - 48;
          out.push(value & 255);
        } else if (next === 13) { if (bytes[this.pos] === 10) this.pos++; }
        else if (next !== 10) out.push(next);
        continue;
      }
      if (byte === 40) depth++;
      else if (byte === 41 && --depth === 0) return { bytes: Uint8Array.from(out) };
      out.push(byte);
    }
    return fail('Teks di dalam PDF terpotong.');
  }

  hexString(): PdfString {
    const { bytes } = this;
    this.pos++; // '<'
    let digits = '';
    while (this.pos < this.end && bytes[this.pos] !== 62) {
      const byte = bytes[this.pos++];
      if (WHITESPACE.has(byte)) continue;
      if (!/[0-9A-Fa-f]/.test(String.fromCharCode(byte))) fail('Teks heksadesimal di dalam PDF rusak.');
      digits += String.fromCharCode(byte);
    }
    if (this.pos >= this.end) fail('Teks heksadesimal di dalam PDF terpotong.');
    this.pos++;
    if (digits.length % 2) digits += '0';
    const out = new Uint8Array(digits.length / 2);
    for (let index = 0; index < out.length; index++) out[index] = parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    return { bytes: out };
  }
}

/** Parses one object value. Operators (content streams) come back as `{ op }`. */
type Token = PdfValue | { op: string } | { end: string };
const isOp = (value: unknown): value is { op: string } => !!value && typeof value === 'object' && 'op' in value;
const isEnd = (value: unknown): value is { end: string } => !!value && typeof value === 'object' && 'end' in value;

function readToken(lexer: Lexer, depth = 0): Token | undefined {
  if (depth > MAX_DEPTH) fail('Struktur PDF terlalu dalam.');
  lexer.skipSpace();
  if (lexer.pos >= lexer.end) return undefined;
  const { bytes } = lexer;
  const byte = bytes[lexer.pos];
  if (byte === 47) return lexer.name();
  if (byte === 40) return lexer.literalString();
  if (byte === 60) {
    if (bytes[lexer.pos + 1] === 60) {
      lexer.pos += 2;
      const dict: PdfDict = new Map();
      for (;;) {
        const key = readToken(lexer, depth + 1);
        if (key === undefined) fail('Kamus PDF terpotong.');
        if (isEnd(key) && key.end === '>>') return dict;
        if (!isName(key)) fail('Kunci kamus PDF tidak valid.');
        const value = readValue(lexer, depth + 1);
        dict.set(key.name, value);
      }
    }
    return lexer.hexString();
  }
  if (byte === 62 && bytes[lexer.pos + 1] === 62) { lexer.pos += 2; return { end: '>>' }; }
  if (byte === 91) {
    lexer.pos++;
    const items: PdfValue[] = [];
    for (;;) {
      const item = readToken(lexer, depth + 1);
      if (item === undefined) fail('Larik PDF terpotong.');
      if (isEnd(item) && item.end === ']') return items;
      if (isOp(item) || isEnd(item)) fail('Isi larik PDF tidak valid.');
      items.push(item);
    }
  }
  if (byte === 93) { lexer.pos++; return { end: ']' }; }
  if (byte === 123 || byte === 125) { lexer.pos++; return { op: String.fromCharCode(byte) }; }
  if (byte === 41 || byte === 62) { lexer.pos++; return fail('Tanda kurung PDF tidak seimbang.'); }
  const word = lexer.word();
  if (!word) { lexer.pos++; return { op: '' }; }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
    const number = Number(word);
    // An indirect reference "12 0 R" is three tokens; join them here.
    if (/^\d+$/.test(word)) {
      const save = lexer.pos;
      lexer.skipSpace();
      const generation = lexer.word();
      if (/^\d+$/.test(generation)) {
        lexer.skipSpace();
        if (lexer.bytes[lexer.pos] === 82 && !isRegular(lexer.bytes[lexer.pos + 1] ?? 32)) {
          lexer.pos++;
          return { ref: number, gen: Number(generation) };
        }
      }
      lexer.pos = save;
    }
    return number;
  }
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (word === 'null') return null;
  return { op: word };
}

function readValue(lexer: Lexer, depth = 0): PdfValue {
  const token = readToken(lexer, depth);
  if (token === undefined || isOp(token) || isEnd(token)) return fail('Nilai PDF tidak valid.');
  return token;
}

/** Decompresses with a running output budget so a small file cannot expand without limit. */
function inflate(data: Uint8Array, budget: { left: number }): Uint8Array {
  const attempt = (zlib: boolean): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const ondata = (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > budget.left) fail('Isi PDF terlalu besar setelah dibuka. Unduh periode yang lebih singkat.');
      chunks.push(chunk);
    };
    const stream = zlib ? new Unzlib(ondata) : new Inflate(ondata);
    stream.push(data, true);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    budget.left -= total;
    return out;
  };
  try { return attempt(true); }
  catch (error) {
    if (error instanceof Error && /terlalu besar/.test(error.message)) throw error;
    try { return attempt(false); }
    catch (inner) {
      if (inner instanceof Error && /terlalu besar/.test(inner.message)) throw inner;
      return fail('Bagian terkompresi di dalam PDF rusak. Unduh ulang PDF dari aplikasi bank.');
    }
  }
}

class PdfDocument {
  private offsets = new Map<number, number>();
  private compressed = new Map<number, { stream: number; index: number }>();
  private cache = new Map<number, PdfValue>();
  private objectStreams = new Map<number, Map<number, PdfValue>>();
  private budget = { left: MAX_DECODED_BYTES };
  private resolving = new Set<number>();
  catalog?: PdfDict;

  constructor(readonly bytes: Uint8Array) {
    const head = latin1(bytes.subarray(0, Math.min(1024, bytes.length)));
    if (!/%PDF-\d/.test(head)) fail('File ini bukan PDF. Pilih file PDF riwayat transaksi dari aplikasi bank.');
    this.scanObjects();
    if (!this.offsets.size) fail('Isi PDF tidak ditemukan. Unduh ulang PDF dari aplikasi bank.');
    // Object streams (PDF 1.5+) hold most small dictionaries, including fonts and pages.
    for (const number of [...this.offsets.keys()]) {
      const value = this.get(number);
      if (isStream(value) && nameOf(value.dict.get('Type')) === 'ObjStm') this.indexObjectStream(number, value);
    }
    for (const number of [...this.offsets.keys(), ...this.compressed.keys()]) {
      const value = this.get(number);
      const dict = isStream(value) ? value.dict : isDict(value) ? value : undefined;
      if (!dict) continue;
      if (dict.has('Encrypt') && (isStream(value) ? nameOf(dict.get('Type')) === 'XRef' : true)) fail('PDF ini terkunci atau terenkripsi. Unduh PDF tanpa kata sandi dari aplikasi bank.');
      if (nameOf(dict.get('Type')) === 'Catalog') this.catalog = dict;
    }
    if (/\/Encrypt\s/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 4096))))) fail('PDF ini terkunci atau terenkripsi. Unduh PDF tanpa kata sandi dari aplikasi bank.');
    if (!this.catalog) fail('Struktur halaman PDF tidak ditemukan.');
  }

  /** Finds "N G obj" headers in file order; streams are skipped by their length so binary data is not scanned. */
  private scanObjects(): void {
    const { bytes } = this;
    let pos = 0;
    while (pos < bytes.length) {
      const found = indexOfObj(bytes, pos);
      if (!found) break;
      const { number, bodyStart } = found;
      if (this.offsets.size >= MAX_OBJECTS) fail('PDF memuat terlalu banyak objek.');
      this.offsets.set(number, bodyStart);
      this.cache.delete(number);
      pos = bodyStart;
      // Skip past stream data so bytes inside it are never read as objects.
      const lexer = new Lexer(bytes, bodyStart);
      try {
        const value = readToken(lexer);
        if (isDict(value)) {
          lexer.skipSpace();
          if (latin1(bytes.subarray(lexer.pos, lexer.pos + 6)) === 'stream') {
            const dataStart = streamDataStart(bytes, lexer.pos + 6);
            const length = value.get('Length');
            const end = typeof length === 'number' && Number.isInteger(length) && length >= 0 && dataStart + length <= bytes.length
              ? dataStart + length : findBytes(bytes, 'endstream', dataStart);
            pos = end < 0 ? bytes.length : end;
            continue;
          }
        }
        pos = Math.max(lexer.pos, bodyStart + 1);
      } catch { pos = bodyStart + 1; }
    }
  }

  private indexObjectStream(number: number, stream: PdfStream): void {
    const count = stream.dict.get('N'), first = stream.dict.get('First');
    if (typeof count !== 'number' || typeof first !== 'number' || count < 0 || count > MAX_OBJECTS || first < 0) fail('Objek gabungan PDF tidak valid.');
    const data = this.decode(stream);
    const lexer = new Lexer(data, 0, Math.min(first, data.length));
    const values = new Map<number, PdfValue>();
    const pairs: [number, number][] = [];
    for (let index = 0; index < count; index++) {
      const objectNumber = readValue(lexer), offset = readValue(lexer);
      if (typeof objectNumber !== 'number' || typeof offset !== 'number') fail('Daftar objek gabungan PDF rusak.');
      pairs.push([objectNumber, offset]);
    }
    pairs.forEach(([objectNumber, offset], index) => {
      const end = index + 1 < pairs.length ? first + pairs[index + 1][1] : data.length;
      const value = readValue(new Lexer(data, first + offset, Math.min(end, data.length)));
      values.set(objectNumber, value);
      if (!this.offsets.has(objectNumber)) this.compressed.set(objectNumber, { stream: number, index });
    });
    this.objectStreams.set(number, values);
  }

  get(number: number): PdfValue {
    if (this.cache.has(number)) return this.cache.get(number)!;
    if (this.resolving.has(number)) fail('Referensi PDF melingkar.');
    this.resolving.add(number);
    try {
      let value: PdfValue = null;
      const offset = this.offsets.get(number);
      if (offset !== undefined) value = this.parseAt(offset);
      else {
        const compressed = this.compressed.get(number);
        if (compressed) value = this.objectStreams.get(compressed.stream)?.get(number) ?? null;
      }
      this.cache.set(number, value);
      return value;
    } finally { this.resolving.delete(number); }
  }

  private parseAt(offset: number): PdfValue {
    const { bytes } = this;
    const lexer = new Lexer(bytes, offset);
    const value = readValue(lexer);
    if (!isDict(value)) return value;
    lexer.skipSpace();
    if (latin1(bytes.subarray(lexer.pos, lexer.pos + 6)) !== 'stream') return value;
    const start = streamDataStart(bytes, lexer.pos + 6);
    const length = this.resolve(value.get('Length'));
    let end: number;
    if (typeof length === 'number' && Number.isInteger(length) && length >= 0 && start + length <= bytes.length) end = start + length;
    else {
      end = findBytes(bytes, 'endstream', start);
      if (end < 0) fail('Aliran data PDF terpotong.');
      if (bytes[end - 1] === 10) end--;
      if (bytes[end - 1] === 13) end--;
    }
    return { dict: value, start, end, source: bytes };
  }

  resolve(value: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (depth > MAX_DEPTH) fail('Referensi PDF terlalu dalam.');
    return isRef(value) ? this.resolve(this.get(value.ref), depth + 1) : value;
  }

  dict(value: PdfValue | undefined): PdfDict | undefined {
    const resolved = this.resolve(value);
    return isDict(resolved) ? resolved : isStream(resolved) ? resolved.dict : undefined;
  }

  decode(stream: PdfStream): Uint8Array {
    let data = stream.source.subarray(stream.start, stream.end);
    const filter = this.resolve(stream.dict.get('Filter'));
    const filters = filter === undefined || filter === null ? [] : Array.isArray(filter) ? filter.map(item => this.resolve(item)) : [filter];
    const parms = this.resolve(stream.dict.get('DecodeParms'));
    for (const [index, item] of filters.entries()) {
      const name = nameOf(item);
      const parm = this.dict(Array.isArray(parms) ? parms[index] : parms);
      const predictor = parm ? this.resolve(parm.get('Predictor')) : undefined;
      if (typeof predictor === 'number' && predictor > 1) fail('Kompresi PDF ini belum didukung.');
      if (name === 'FlateDecode' || name === 'Fl') data = inflate(data, this.budget);
      else fail(`Kompresi PDF ${name ?? ''} belum didukung.`.replace('  ', ' '));
    }
    if (!filters.length) {
      if (data.length > this.budget.left) fail('Isi PDF terlalu besar. Unduh periode yang lebih singkat.');
      this.budget.left -= data.length;
    }
    return data;
  }

  pages(): { dict: PdfDict; resources?: PdfDict }[] {
    const root = this.dict(this.catalog!.get('Pages'));
    if (!root) fail('Daftar halaman PDF tidak ditemukan.');
    const pages: { dict: PdfDict; resources?: PdfDict }[] = [];
    const visit = (node: PdfDict, inherited: PdfDict | undefined, depth: number, seen: Set<PdfDict>) => {
      if (depth > MAX_DEPTH || seen.has(node)) fail('Pohon halaman PDF tidak valid.');
      seen.add(node);
      const resources = this.dict(node.get('Resources')) ?? inherited;
      const kids = this.resolve(node.get('Kids'));
      if (nameOf(node.get('Type')) === 'Page' || !Array.isArray(kids)) {
        if (pages.length >= MAX_PAGES) fail('PDF memiliki terlalu banyak halaman. Unduh periode yang lebih singkat.');
        pages.push({ dict: node, resources });
        return;
      }
      for (const kid of kids) {
        const child = this.dict(kid);
        if (child) visit(child, resources, depth + 1, seen);
      }
    };
    visit(root, undefined, 0, new Set());
    return pages;
  }
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
}
function nameOf(value: PdfValue | undefined): string | undefined { return isName(value) ? value.name : undefined; }
function findBytes(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let index = from; index <= bytes.length - needle.length; index++) {
    if (bytes[index] !== first) continue;
    for (let offset = 1; offset < needle.length; offset++) if (bytes[index + offset] !== needle.charCodeAt(offset)) continue outer;
    return index;
  }
  return -1;
}
function streamDataStart(bytes: Uint8Array, afterKeyword: number): number {
  let pos = afterKeyword;
  if (bytes[pos] === 13) pos++;
  if (bytes[pos] === 10) pos++;
  return pos;
}
/** The next "N G obj" header at or after `from`, preceded by whitespace or the file start. */
function indexOfObj(bytes: Uint8Array, from: number): { number: number; bodyStart: number } | undefined {
  for (let index = findBytes(bytes, 'obj', from); index >= 0; index = findBytes(bytes, 'obj', index + 3)) {
    if (isRegular(bytes[index + 3] ?? 32)) continue;
    let cursor = index - 1;
    while (cursor >= 0 && WHITESPACE.has(bytes[cursor])) cursor--;
    const genEnd = cursor + 1;
    while (cursor >= 0 && bytes[cursor] >= 48 && bytes[cursor] <= 57) cursor--;
    if (cursor + 1 === genEnd || cursor < 0 || !WHITESPACE.has(bytes[cursor])) continue;
    while (cursor >= 0 && WHITESPACE.has(bytes[cursor])) cursor--;
    const numberEnd = cursor + 1;
    while (cursor >= 0 && bytes[cursor] >= 48 && bytes[cursor] <= 57) cursor--;
    if (cursor + 1 === numberEnd || cursor >= 0 && !WHITESPACE.has(bytes[cursor])) continue;
    const number = Number(latin1(bytes.subarray(cursor + 1, numberEnd)));
    if (!Number.isSafeInteger(number)) continue;
    return { number, bodyStart: index + 3 };
  }
  return undefined;
}

/** Glyph-code → text for one font, from its ToUnicode CMap. */
interface FontDecoder { decode(bytes: Uint8Array): string }

function utf16(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  return text;
}
const toNumber = (bytes: Uint8Array): number => bytes.reduce((value, byte) => value * 256 + byte, 0);

/** Glyphs some producers draw but leave out of the font's ToUnicode CMap. Only
 * ligatures confirmed against the printed page of a known font are listed. */
const UNMAPPED_LIGATURES: Record<string, Record<number, string>> = {
  TTCommons: { 0x01e3: 'ft', 0x01e4: 'fh' },
};

function fontDecoder(document: PdfDocument, font: PdfDict): FontDecoder {
  const subtype = nameOf(document.resolve(font.get('Subtype')));
  const composite = subtype === 'Type0';
  const map = new Map<number, string>();
  let widths: number[] = composite ? [2] : [1];
  const toUnicode = document.resolve(font.get('ToUnicode'));
  if (isStream(toUnicode)) {
    const cmap = document.decode(toUnicode);
    const lexer = new Lexer(cmap);
    const ranges: number[] = [];
    let mode = '';
    const pending: PdfValue[] = [];
    for (let token = readToken(lexer); token !== undefined; token = readToken(lexer)) {
      if (isOp(token)) {
        const op = token.op;
        if (['begincodespacerange', 'beginbfchar', 'beginbfrange'].includes(op)) { mode = op; pending.length = 0; }
        else if (op.startsWith('end')) mode = '';
        continue;
      }
      if (isEnd(token)) continue;
      if (!mode) continue;
      pending.push(token);
      if (mode === 'begincodespacerange' && pending.length === 2) {
        if (isString(pending[0])) ranges.push(pending[0].bytes.length);
        pending.length = 0;
      } else if (mode === 'beginbfchar' && pending.length === 2) {
        const [code, target] = pending;
        if (isString(code) && isString(target)) map.set(toNumber(code.bytes), utf16(target.bytes));
        pending.length = 0;
      } else if (mode === 'beginbfrange' && pending.length === 3) {
        const [low, high, target] = pending;
        pending.length = 0;
        if (!isString(low) || !isString(high)) continue;
        const from = toNumber(low.bytes), to = toNumber(high.bytes);
        if (to < from || to - from > 65_535) fail('Peta karakter PDF tidak valid.');
        if (Array.isArray(target)) {
          target.forEach((item, offset) => { if (isString(item) && from + offset <= to) map.set(from + offset, utf16(item.bytes)); });
        } else if (isString(target)) {
          const base = target.bytes;
          for (let code = from; code <= to; code++) {
            const bytes = base.slice();
            let carry = code - from;
            for (let index = bytes.length - 1; index >= 0 && carry; index--) {
              const sum = bytes[index] + carry;
              bytes[index] = sum & 255;
              carry = sum >> 8;
            }
            map.set(code, utf16(bytes));
          }
        }
      }
    }
    if (ranges.length) widths = [...new Set(ranges)].sort((a, b) => a - b);
  }
  const baseFont = nameOf(document.resolve(font.get('BaseFont'))) ?? '';
  const family = Object.keys(UNMAPPED_LIGATURES).find(key => baseFont.replace(/^[A-Z]{6}\+/, '').startsWith(key));
  const extras = family ? UNMAPPED_LIGATURES[family] : {};
  if (composite) {
    const encoding = nameOf(document.resolve(font.get('Encoding')));
    if (encoding !== 'Identity-H' && encoding !== 'Identity-V') fail('Pengodean huruf PDF ini belum didukung.');
    if (!map.size) fail('Huruf di PDF ini tidak memiliki peta teks. Unduh ulang PDF dari aplikasi bank.');
  }
  const width = composite ? 2 : widths[0];
  return {
    decode(bytes: Uint8Array): string {
      let text = '';
      for (let index = 0; index + width <= bytes.length; index += width) {
        const code = toNumber(bytes.subarray(index, index + width));
        const mapped = map.get(code) ?? extras[code];
        if (mapped !== undefined) text += mapped;
        else if (!composite && code >= 32 && code < 127) text += String.fromCharCode(code);
        else if (!composite && code === 160) text += ' ';
        else text += '�';
      }
      return text;
    },
  };
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const round = (value: number): number => Math.round(value * 100) / 100;

function pageRuns(document: PdfDocument, page: { dict: PdfDict; resources?: PdfDict }, total: { runs: number }): PdfTextRun[] {
  const contents = document.resolve(page.dict.get('Contents'));
  const streams = (Array.isArray(contents) ? contents.map(item => document.resolve(item)) : [contents]).filter(isStream);
  const parts = streams.map(stream => document.decode(stream));
  const data = new Uint8Array(parts.reduce((sum, part) => sum + part.length + 1, 0));
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; data[offset++] = 10; }

  const fonts = document.dict(page.resources?.get('Font'));
  const decoders = new Map<string, FontDecoder>();
  const decoderFor = (name: string): FontDecoder => {
    let decoder = decoders.get(name);
    if (!decoder) {
      const font = document.dict(fonts?.get(name));
      if (!font) fail('Huruf yang dipakai PDF tidak ditemukan.');
      decoder = fontDecoder(document, font);
      decoders.set(name, decoder);
    }
    return decoder;
  };

  const runs: PdfTextRun[] = [];
  type State = { ctm: Matrix; font?: string; size: number; leading: number };
  let state: State = { ctm: [1, 0, 0, 1, 0, 0], size: 0, leading: 0 };
  const stack: State[] = [];
  let tm: Matrix = [1, 0, 0, 1, 0, 0], tlm: Matrix = [1, 0, 0, 1, 0, 0];
  let current: PdfTextRun | undefined;
  const flush = () => {
    if (current && current.text) {
      if (++total.runs > MAX_RUNS) fail('PDF memuat terlalu banyak teks.');
      runs.push(current);
    }
    current = undefined;
  };
  const moveTo = (matrix: Matrix) => { flush(); tm = matrix; tlm = matrix; };
  const show = (text: string) => {
    if (!current) {
      const [a, b, c, d, e, f] = multiply(tm, state.ctm);
      const scale = Math.hypot(c, d) || Math.hypot(a, b) || 1;
      current = { x: round(e), y: round(f), size: round(state.size * scale), text: '' };
    }
    current.text += text;
  };
  const decodeShow = (value: PdfValue | undefined): string => {
    if (!state.font) fail('Teks PDF ditulis tanpa huruf.');
    return isString(value) ? decoderFor(state.font).decode(value.bytes) : '';
  };

  const lexer = new Lexer(data);
  const operands: PdfValue[] = [];
  for (let token = readToken(lexer); token !== undefined; token = readToken(lexer)) {
    if (!isOp(token)) {
      if (isEnd(token)) continue;
      operands.push(token);
      if (operands.length > 64) operands.shift();
      continue;
    }
    const op = token.op;
    const num = (index: number): number => { const value = operands[operands.length - (index + 1)]; return typeof value === 'number' ? value : 0; };
    switch (op) {
      case 'q': if (stack.length < 256) stack.push({ ...state, ctm: [...state.ctm] as Matrix }); break;
      case 'Q': state = stack.pop() ?? state; break;
      case 'cm': state.ctm = multiply([num(5), num(4), num(3), num(2), num(1), num(0)], state.ctm); break;
      case 'BT': flush(); tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'ET': flush(); break;
      case 'Tf': { const font = operands[operands.length - 2]; if (isName(font)) state.font = font.name; state.size = num(0); flush(); break; }
      case 'TL': state.leading = num(0); break;
      case 'Td': moveTo(multiply([1, 0, 0, 1, num(1), num(0)], tlm)); break;
      case 'TD': state.leading = -num(0); moveTo(multiply([1, 0, 0, 1, num(1), num(0)], tlm)); break;
      case 'Tm': moveTo([num(5), num(4), num(3), num(2), num(1), num(0)]); break;
      case 'T*': moveTo(multiply([1, 0, 0, 1, 0, -state.leading], tlm)); break;
      case 'Tj': show(decodeShow(operands[operands.length - 1])); break;
      case "'": moveTo(multiply([1, 0, 0, 1, 0, -state.leading], tlm)); show(decodeShow(operands[operands.length - 1])); break;
      case '"': moveTo(multiply([1, 0, 0, 1, 0, -state.leading], tlm)); show(decodeShow(operands[operands.length - 1])); break;
      case 'TJ': {
        const items = operands[operands.length - 1];
        if (Array.isArray(items)) {
          let text = '';
          for (const item of items) {
            if (typeof item === 'number') { if (item < -250 && text && !text.endsWith(' ')) text += ' '; }
            else text += decodeShow(item);
          }
          show(text);
        }
        break;
      }
      case 'BI': { // inline image: skip to "EI"
        const end = findBytes(data, 'EI', lexer.pos);
        lexer.pos = end < 0 ? data.length : end + 2;
        break;
      }
      default: break;
    }
    operands.length = 0;
  }
  flush();
  return runs;
}

/** Text runs per page, in drawing order. */
export function extractPdfText(data: ArrayBuffer | Uint8Array): PdfTextRun[][] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length) fail('File kosong.');
  if (bytes.length > MAX_FILE_BYTES) fail('File terlalu besar. Unduh riwayat dengan periode yang lebih singkat (maksimal 8 MB).');
  const document = new PdfDocument(bytes);
  const total = { runs: 0 };
  return document.pages().map(page => pageRuns(document, page, total));
}
