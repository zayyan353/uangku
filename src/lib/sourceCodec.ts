import {
  validateSourceDocument, sourceDocumentUsesMovement, sourceDocumentUsesCurrencyFeatures, canonicalSource, assertSourceJsonBudget, sourceCheck, sourceKeys, sourceRecord,
  hasOwn, utf8Size, SOURCE_LIMIT, SOURCE_RAW_LIMIT, SOURCE_EXPANDED_LIMIT, SOURCE_REFERENCE_LIMIT,
  type JsonRecord, type SourceDocument, type SourceMetadata, type TransferPairing,
} from './sourceModel';

export const LEGACY_SOURCE_CODEC = 'table-tuples-v1' as const;
export const SOURCE_CODEC = 'table-tuples-v2' as const;
export const E5_SOURCE_CODEC = 'table-tuples-v3' as const;
export const MOVEMENT_SOURCE_CODEC = 'table-tuples-v4' as const;
export const WALLET_ARCHIVE_SOURCE_CODEC = 'table-tuples-v5' as const;
export const MULTICURRENCY_SOURCE_CODEC = 'table-tuples-v6' as const;
export type SourceCodec = typeof LEGACY_SOURCE_CODEC | typeof SOURCE_CODEC | typeof E5_SOURCE_CODEC | typeof MOVEMENT_SOURCE_CODEC | typeof WALLET_ARCHIVE_SOURCE_CODEC | typeof MULTICURRENCY_SOURCE_CODEC;
type FieldKind = 's' | 's?' | 'n' | 'o' | 'rw' | 're' | 'rf' | 'rt' | 'rb' | 'arf';
const SCHEMAS = {
  wallets: { id:'s',name:'s',currency:'s',kind:'s',openingBalance:'n' },
  entries: { id:'s',date:'s',type:'s',walletId:'rw',amount:'n',category:'s',note:'s',toWalletId:'rw',toAmount:'n',rate:'n',fee:'n',sourceKey:'s',toSourceKey:'s',importBatch:'s' },
  facts: { id:'s',walletId:'rw',currency:'s',postedOn:'s',signedAmount:'n',balanceAfter:'n',description:'s',reference:'s',fingerprintVersion:'s',fingerprint:'s' },
  links: { entryId:'re',source:'rf',destination:'rf',postingDates:'o',pairing:'o' },
  statements: { id:'s',walletId:'rw',currency:'s',periodStart:'s',periodEnd:'s',openingBalance:'n',closingBalance:'n',rowIds:'arf' },
  annotations: { sourceId:'rf',category:'s',note:'s',confirmedType:'s',importBatch:'s' },
  overrides: { entryId:'re',reason:'s',at:'s' },
  dispositions: { sourceId:'rf',kind:'s',reason:'s',at:'s' },
  baselines: { id:'s',walletId:'rw',boundary:'o',origin:'s',status:'s' },
  completions: { statementId:'rt',baselineId:'rb',sourceIds:'arf',at:'s' },
  creationOrigins: { entryId:'re',origin:'s' },
  transfers: { entryId:'re',sourceDate:'s?',destinationDate:'s?',pairing:'o',decision:'o' },
  unpairings: { id:'s',sourceEntryId:'s',destinationEntryId:'s',sourceWalletId:'rw',destinationWalletId:'rw',sourceDate:'s',destinationDate:'s',principal:'n',toAmount:'n',rate:'n',fee:'n',reason:'s',at:'s',groupNote:'s',pairing:'o',source:'rf',destination:'rf',groupOrigin:'s',groupDecision:'o' },
  deletedTransfers: { entry:'o',context:'o',link:'o',override:'o',origin:'s',reason:'s',at:'s' },
  baselineDecisions: { baselineId:'rb',reason:'s',at:'s' },
  walletArchives: { walletId:'rw',at:'s' },
  currencies: { code:'s' },
} satisfies Record<string, Record<string, FieldKind>>;
type TableName = keyof typeof SCHEMAS;
type RefKind = 'rw' | 're' | 'rf' | 'rt' | 'rb';
const META_TABLES = ['facts','links','statements','annotations','overrides','dispositions','baselines','completions','creationOrigins','transfers','unpairings','deletedTransfers','baselineDecisions','walletArchives','currencies'] as const;
const TABLES: readonly TableName[] = ['wallets','entries',...META_TABLES];
const REF_TARGETS: Record<RefKind, TableName> = { rw:'wallets', re:'entries', rf:'facts', rt:'statements', rb:'baselines' };
const schema = (name: TableName): Record<string, FieldKind> => SCHEMAS[name];
const isRef = (kind: FieldKind): kind is RefKind => hasOwn(REF_TARGETS, kind);
const isString = (kind: FieldKind): boolean => kind === 's' || kind === 's?';
const jsonBytes = (value: unknown): number => utf8Size(JSON.stringify(value));
interface SourceTable { k: string[]; d: JsonRecord; r: unknown[][] }
export interface SourceWire {
  app: 'uangku'; version: 2; codec: SourceCodec; demo: boolean;
  d: string[]; t: Partial<Record<TableName, SourceTable>>; policy: 'unverified-unless-linked';
}
type TableArrays = Partial<Record<TableName, JsonRecord[]>>;
function arraysFor(data: SourceDocument): TableArrays {
  return { wallets:data.state.wallets, entries:data.state.entries, ...data.metadata } as unknown as TableArrays;
}
function pack(data: SourceDocument): Partial<Record<TableName, SourceTable>> {
  const arrays = arraysFor(data);
  const references = Object.fromEntries(Object.entries(REF_TARGETS).map(([kind,name]) => [kind,new Map((arrays[name] ?? []).map((row,index) => [row.id as string,index]))])) as Record<RefKind, Map<string, number>>;
  const tables: Partial<Record<TableName, SourceTable>> = {};
  for (const name of TABLES) {
    if (!hasOwn(arrays,name)) continue;
    const values = arrays[name]!; const fields = Object.keys(schema(name)).filter(key => values.some(row => hasOwn(row,key)));
    const defaults: JsonRecord = {};
    for (const field of fields) if (values.length && values.every(row => hasOwn(row,field) && JSON.stringify(row[field]) === JSON.stringify(values[0][field]))) defaults[field] = values[0][field];
    // Identity values always remain explicit, even in one-row tables.
    delete defaults.id;
    const transform = (field: string, value: unknown): unknown => {
      const kind = schema(name)[field];
      if (isRef(kind)) { sourceCheck(typeof value === 'string' && references[kind].has(value),'Referensi encode tidak ditemukan.'); return references[kind].get(value); }
      if (kind === 'arf') { sourceCheck(Array.isArray(value),'Daftar referensi encode tidak valid.'); return value.map(ref => { sourceCheck(typeof ref === 'string' && references.rf.has(ref),'Referensi row encode tidak ditemukan.'); return references.rf.get(ref); }); }
      return canonicalSource(value);
    };
    const rows = values.map(row => {
      let mask = 0; const cells: unknown[] = [];
      fields.forEach((field,index) => { if (hasOwn(row,field) && !hasOwn(defaults,field)) { mask |= 2 ** index; cells.push(transform(field,row[field])); } });
      return [mask,...cells];
    });
    tables[name] = { k:fields, d:Object.fromEntries(Object.entries(defaults).map(([key,value]) => [key,transform(key,value)])), r:rows };
  }
  return tables;
}
function intern(tables: Partial<Record<TableName, SourceTable>>): string[] {
  const counts = new Map<string, number>();
  for (const [name,table] of Object.entries(tables) as [TableName,SourceTable][]) {
    const add = (field: string, value: unknown) => { if (isString(schema(name)[field])) { if (schema(name)[field] === 's?' && value === null) return; sourceCheck(typeof value === 'string','String encode tidak valid.'); counts.set(value,(counts.get(value) ?? 0) + 1); } };
    for (const [field,value] of Object.entries(table.d)) add(field,value);
    for (const row of table.r) { let cell = 1; table.k.forEach((field,index) => { if ((row[0] as number) & 2 ** index) add(field,row[cell++]); }); }
  }
  const dictionary = [...counts].filter(([value,count]) => count * (jsonBytes(value) - 6) > jsonBytes(value) + 1).map(([value]) => value).sort();
  const positions = new Map(dictionary.map((value,index) => [value,index]));
  for (const [name,table] of Object.entries(tables) as [TableName,SourceTable][]) {
    const encode = (field: string, value: unknown) => isString(schema(name)[field]) && typeof value === 'string' && positions.has(value) ? positions.get(value) : value;
    for (const key of Object.keys(table.d)) table.d[key] = encode(key,table.d[key]);
    for (const row of table.r) { let cell = 1; table.k.forEach((field,index) => { if ((row[0] as number) & 2 ** index) { row[cell] = encode(field,row[cell]); cell++; } }); }
  }
  return dictionary;
}

/** Produces a diagnostic wire too; the normal serializer separately enforces 8 MiB. */
function requiresE5Codec(metadata: SourceMetadata): boolean {
  const extendedPairing = (pairing: TransferPairing | undefined): boolean =>
    (pairing?.sourceAnnotation?.note.length ?? 0) > 2_000 || (pairing?.destinationAnnotation?.note.length ?? 0) > 2_000;
  return metadata.deletedTransfers !== undefined || metadata.baselineDecisions !== undefined
    || (metadata.transfers ?? []).some(context => extendedPairing(context.pairing))
    || (metadata.unpairings ?? []).some(witness => witness.groupNote.length > 2_000 || extendedPairing(witness.pairing));
}
function packValidatedDocument(data: SourceDocument, codec?: SourceCodec): SourceWire {
  sourceCheck(data.metadata,'Format baru memerlukan metadata; ledger tanpa metadata harus tetap v1.');
  const usesTransfers = data.metadata.transfers !== undefined || data.metadata.unpairings !== undefined || data.metadata.links.some(link => link.postingDates !== undefined || link.pairing !== undefined);
  const usesWalletArchives = hasOwn(data.metadata,'walletArchives');
  const selectedCodec = codec ?? (sourceDocumentUsesCurrencyFeatures(data) ? MULTICURRENCY_SOURCE_CODEC : usesWalletArchives ? WALLET_ARCHIVE_SOURCE_CODEC : sourceDocumentUsesMovement(data) ? MOVEMENT_SOURCE_CODEC : requiresE5Codec(data.metadata) ? E5_SOURCE_CODEC : usesTransfers ? SOURCE_CODEC : LEGACY_SOURCE_CODEC);
  sourceCheck(selectedCodec === MULTICURRENCY_SOURCE_CODEC || !sourceDocumentUsesCurrencyFeatures(data), 'Mata uang tambahan, konfigurasi, atau sumber impor umum memerlukan codec sumber table-tuples-v6.');
  sourceCheck(selectedCodec === MULTICURRENCY_SOURCE_CODEC || selectedCodec === WALLET_ARCHIVE_SOURCE_CODEC || !usesWalletArchives, 'Arsip dompet memerlukan codec sumber table-tuples-v5.');
  sourceCheck(selectedCodec === MULTICURRENCY_SOURCE_CODEC || selectedCodec === WALLET_ARCHIVE_SOURCE_CODEC || selectedCodec === MOVEMENT_SOURCE_CODEC || !sourceDocumentUsesMovement(data), 'Perpindahan tercatat memerlukan codec sumber table-tuples-v4.');
  sourceCheck(selectedCodec === MULTICURRENCY_SOURCE_CODEC || selectedCodec === WALLET_ARCHIVE_SOURCE_CODEC || selectedCodec === E5_SOURCE_CODEC || selectedCodec === MOVEMENT_SOURCE_CODEC || !requiresE5Codec(data.metadata), 'Fitur metadata E5 memerlukan codec baru.');
  sourceCheck(selectedCodec !== LEGACY_SOURCE_CODEC || data.metadata.transfers === undefined && data.metadata.unpairings === undefined, 'Codec lama tidak dapat memuat konteks transfer E4.');
  const tables = pack(data); const dictionary = intern(tables);
  return canonicalSource({ app:'uangku',version:2,codec:selectedCodec,demo:data.demo,d:dictionary,t:tables,policy:data.metadata.policy }) as SourceWire;
}

function encodeWithCodec(value: SourceDocument, codec?: SourceCodec): SourceWire {
  return packValidatedDocument(validateSourceDocument(value),codec);
}

export function encodeSourceWire(value: SourceDocument): SourceWire { return encodeWithCodec(value); }

function unpack(value: unknown): { arrays: TableArrays; demo: boolean; policy: unknown; codec: SourceCodec } {
  const wire = sourceKeys(value,['app','version','codec','demo','d','t','policy'],['app','version','codec','demo','d','t','policy'],'format v2');
  sourceCheck(wire.app === 'uangku' && wire.version === 2 && (wire.codec === MULTICURRENCY_SOURCE_CODEC || wire.codec === WALLET_ARCHIVE_SOURCE_CODEC || wire.codec === MOVEMENT_SOURCE_CODEC || wire.codec === E5_SOURCE_CODEC || wire.codec === SOURCE_CODEC || wire.codec === LEGACY_SOURCE_CODEC),'Versi/codec format sumber belum didukung.');
  sourceCheck(typeof wire.demo === 'boolean','Penanda demo format sumber tidak valid.');
  sourceCheck(Array.isArray(wire.d) && wire.d.length <= 200_000 && wire.d.every(item => typeof item === 'string') && new Set(wire.d).size === wire.d.length,'Dictionary tidak valid atau berulang.');
  const dictionary = wire.d as string[]; const rawTables = sourceRecord(wire.t,'tabel v2');
  sourceCheck(wire.codec === MULTICURRENCY_SOURCE_CODEC || !hasOwn(rawTables,'currencies'), 'Pengelolaan mata uang memerlukan codec sumber table-tuples-v6.');
  sourceCheck(wire.codec === MULTICURRENCY_SOURCE_CODEC || wire.codec === WALLET_ARCHIVE_SOURCE_CODEC || !hasOwn(rawTables,'walletArchives'), 'Arsip dompet memerlukan codec sumber table-tuples-v5.');
  sourceCheck(wire.codec === MULTICURRENCY_SOURCE_CODEC || wire.codec === WALLET_ARCHIVE_SOURCE_CODEC || wire.codec === E5_SOURCE_CODEC || wire.codec === MOVEMENT_SOURCE_CODEC || !hasOwn(rawTables,'deletedTransfers'), 'Tombstone transfer E5 tidak didukung codec lama.');
  sourceCheck(wire.codec === MULTICURRENCY_SOURCE_CODEC || wire.codec === WALLET_ARCHIVE_SOURCE_CODEC || wire.codec === E5_SOURCE_CODEC || wire.codec === MOVEMENT_SOURCE_CODEC || !hasOwn(rawTables,'baselineDecisions'), 'Keputusan baseline E5 tidak didukung codec lama.');
  sourceCheck(wire.codec !== LEGACY_SOURCE_CODEC || !hasOwn(rawTables,'transfers') && !hasOwn(rawTables,'unpairings'), 'Tabel transfer E4 tidak didukung codec lama.');
  sourceCheck(Object.keys(rawTables).every(name => hasOwn(SCHEMAS,name)),'Nama tabel tidak didukung.');
  sourceCheck(hasOwn(rawTables,'wallets') && hasOwn(rawTables,'entries'),'Tabel finansial tidak lengkap.');
  const tables: Partial<Record<TableName, SourceTable>> = {};
  // Validate every table before traversing references or repeating defaults.
  for (const [name,raw] of Object.entries(rawTables) as [TableName,unknown][]) {
    const table = sourceKeys(raw,['k','d','r'],['k','d','r'],`tabel ${name}`);
    sourceCheck(Array.isArray(table.k) && table.k.length < 31 && table.k.every(key => typeof key === 'string' && hasOwn(schema(name),key)) && new Set(table.k).size === table.k.length,'Kolom tidak valid/berulang.');
    const fields = table.k as string[]; const defaults = sourceRecord(table.d,`defaults ${name}`);
    sourceCheck(Object.keys(defaults).every(key => fields.includes(key)),'Default di luar kolom.');
    const max = name === 'wallets' || name === 'baselineDecisions' || name === 'walletArchives' ? 100 : name === 'currencies' ? 200 : name === 'entries' ? 100_000 : name === 'statements' ? 10_000 : 200_000;
    sourceCheck(Array.isArray(table.r) && table.r.length <= max,`Jumlah row tabel ${name} melebihi batas ${max}.`);
    for (const candidate of table.r) {
      sourceCheck(Array.isArray(candidate) && typeof candidate[0] === 'number' && Number.isSafeInteger(candidate[0]) && candidate[0] >= 0 && candidate[0] < 2 ** fields.length,'Presence mask tidak valid.');
      let count = 1; fields.forEach((field,index) => { if (candidate[0] & 2 ** index) { sourceCheck(!hasOwn(defaults,field),'Field row menggandakan default.'); count++; } });
      sourceCheck(count === candidate.length,'Panjang tuple tidak cocok dengan presence mask.');
    }
    tables[name] = { k:fields, d:defaults, r:table.r as unknown[][] };
  }
  const valueAt = (name: TableName, row: unknown[], field: string): unknown => {
    const table = tables[name]!; const index = table.k.indexOf(field);
    if (hasOwn(table.d,field)) return table.d[field];
    if (index < 0 || !((row[0] as number) & 2 ** index)) return undefined;
    let cell = 1; for (let before = 0; before < index; before++) if ((row[0] as number) & 2 ** before) cell++;
    return row[cell];
  };
  const scalar = (name: TableName, field: string, cell: unknown): unknown => {
    if (isString(schema(name)[field]) && typeof cell === 'number') { sourceCheck(Number.isSafeInteger(cell) && cell >= 0 && cell < dictionary.length,'Indeks dictionary di luar batas.'); return dictionary[cell]; }
    return cell;
  };
  const reference = (kind: RefKind, position: unknown): string => {
    const name = REF_TARGETS[kind]; const target = tables[name];
    sourceCheck(target && typeof position === 'number' && Number.isSafeInteger(position) && position >= 0 && position < target.r.length,'Indeks referensi tidak ditemukan/di luar batas.');
    const id = scalar(name,'id',valueAt(name,target.r[position],'id')); sourceCheck(typeof id === 'string','Target referensi tidak memiliki ID.'); return id;
  };
  const stringCosts = new Map<string,number>(); const objectCosts = new WeakMap<object,number>();
  const cost = (item: unknown): number => {
    if (typeof item === 'string') { let count = stringCosts.get(item); if (count === undefined) { count = jsonBytes(item); stringCosts.set(item,count); } return count; }
    if (item !== null && typeof item === 'object') { let count = objectCosts.get(item); if (count === undefined) { count = jsonBytes(item); objectCosts.set(item,count); } return count; }
    sourceCheck(item !== undefined,'Nilai tuple JSON tidak valid.'); return jsonBytes(item);
  };
  const arrayCosts: Partial<Record<TableName,number>> = {}; const refCosts = new WeakMap<object,number>();
  let rowRefs = 0, completionRefs = 0, totalRowsBytes = 0;
  for (const [name,table] of Object.entries(tables) as [TableName,SourceTable][]) {
    let arrayCost = 2 + Math.max(0,table.r.length - 1);
    for (const row of table.r) {
      let itemCost = 2, fields = 0;
      for (const field of table.k) {
        const raw = valueAt(name,row,field); if (raw === undefined) continue;
        fields++; itemCost += cost(field) + 1; const kind = schema(name)[field];
        if (kind === 'arf') {
          sourceCheck(Array.isArray(raw),'Daftar referensi row tidak valid.');
          if (name === 'statements') { rowRefs += raw.length; sourceCheck(rowRefs <= SOURCE_REFERENCE_LIMIT,'Total referensi statement melebihi batas sebelum materialisasi.'); }
          if (name === 'completions') { completionRefs += raw.length; sourceCheck(completionRefs <= SOURCE_REFERENCE_LIMIT,'Total referensi completion melebihi batas sebelum materialisasi.'); }
          let count = refCosts.get(raw);
          if (count === undefined) { count = 2 + Math.max(0,raw.length - 1); for (const ref of raw) count += cost(reference('rf',ref)); refCosts.set(raw,count); }
          itemCost += count;
        } else itemCost += cost(isRef(kind) ? reference(kind,raw) : scalar(name,field,raw));
      }
      itemCost += Math.max(0,fields - 1); arrayCost += itemCost;
      sourceCheck(totalRowsBytes + arrayCost <= SOURCE_EXPANDED_LIMIT,'Ekspansi semantic melebihi 64 MiB sebelum materialisasi.');
      if (name === 'wallets' || name === 'entries') sourceCheck(arrayCost <= SOURCE_LIMIT,'Proyeksi finansial melebihi 8 MiB sebelum materialisasi.');
    }
    arrayCosts[name] = arrayCost; totalRowsBytes += arrayCost;
  }
  const financialCost = jsonBytes({app:'uangku',version:1,demo:wire.demo,state:{version:1,wallets:[],entries:[]}}) - 4 + arrayCosts.wallets! + arrayCosts.entries!;
  sourceCheck(financialCost <= SOURCE_LIMIT,'Proyeksi finansial melebihi 8 MiB sebelum materialisasi.');
  let metadataCost = jsonBytes({policy:wire.policy});
  for (const name of META_TABLES) if (hasOwn(arrayCosts,name)) metadataCost += 1 + cost(name) + 1 + arrayCosts[name]!;
  sourceCheck(financialCost + 1 + cost('metadata') + 1 + metadataCost <= SOURCE_EXPANDED_LIMIT,'Ekspansi semantic melebihi 64 MiB sebelum materialisasi.');
  const arrays: TableArrays = {};
  for (const [name,table] of Object.entries(tables) as [TableName,SourceTable][]) arrays[name] = table.r.map(row => Object.fromEntries(table.k.filter(field => valueAt(name,row,field) !== undefined).map(field => {
    const raw = valueAt(name,row,field); const kind = schema(name)[field];
    const item = kind === 'arf' ? (raw as unknown[]).map(ref => reference('rf',ref)) : isRef(kind) ? reference(kind,raw) : structuredClone(scalar(name,field,raw));
    return [field,item];
  })));
  return { arrays, demo:wire.demo, policy:wire.policy, codec: wire.codec as SourceCodec };
}

export function decodeSourceWire(value: unknown, { enforceLimit = true }: { enforceLimit?: boolean } = {}): SourceDocument {
  assertSourceJsonBudget(value,SOURCE_RAW_LIMIT,'Input format baru');
  const {arrays,demo,policy,codec} = unpack(value);
  const metadata: JsonRecord = {policy}; for (const name of META_TABLES) if (hasOwn(arrays,name)) metadata[name] = arrays[name];
  const data = validateSourceDocument({ app:'uangku',version:1,demo,state:{version:1,wallets:arrays.wallets,entries:arrays.entries},metadata }, {allowMovement:codec === MOVEMENT_SOURCE_CODEC || codec === WALLET_ARCHIVE_SOURCE_CODEC || codec === MULTICURRENCY_SOURCE_CODEC,allowWalletArchives:codec === WALLET_ARCHIVE_SOURCE_CODEC || codec === MULTICURRENCY_SOURCE_CODEC,allowExtendedCurrencies:codec === MULTICURRENCY_SOURCE_CODEC,allowGenericFacts:codec === MULTICURRENCY_SOURCE_CODEC,allowCurrencyConfiguration:codec === MULTICURRENCY_SOURCE_CODEC});
  const encoded = packValidatedDocument(data, codec);
  sourceCheck(JSON.stringify(canonicalSource(value)) === JSON.stringify(encoded),'Representasi format v2 tidak canonical; tidak ada data yang dibuang otomatis.');
  if (enforceLimit) sourceCheck(jsonBytes(encoded) <= SOURCE_LIMIT,'Ukuran format sumber melebihi 8 MiB (8.388.608 byte UTF-8).');
  return data;
}
/** Object-level decoder alias for storage dispatch; JSON/raw-size checks remain in storage. */
export const parseSourceWire = decodeSourceWire;
/** One validation/encoding boundary; the private packer never trusts caller objects. */
export function prepareSourceBackup(value: unknown): {data:SourceDocument;raw:string} {
  const data=validateSourceDocument(value);
  const raw = JSON.stringify(packValidatedDocument(data));
  sourceCheck(utf8Size(raw) <= SOURCE_LIMIT,'Ukuran format sumber melebihi 8 MiB (8.388.608 byte UTF-8).');
  return {data,raw};
}
export function serializeSourceWire(value: SourceDocument): string {
  return prepareSourceBackup(value).raw;
}
