import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { confirmedBankEntryType } from './bankDescription';
import { entryPostings, entrySignedAmount, summaryForCurrency, validateEntry, walletBalance, walletBalanceAt, type Entry, type Wallet } from './finance';
import { entriesFromImport, parseZiraatWorkbook, type ImportPreview } from './importer';
import { validateLegacyBackup } from './legacyValidation';
import { prepareStatementCompletion } from './reconciliation';
import { decodeSourceWire, encodeSourceWire, MOVEMENT_SOURCE_CODEC } from './sourceCodec';
import { applySourcedEntryEdit, deleteSourcedEntry, inspectSourcedImport, prepareSourcedImport } from './sourceCommands';
import { SOURCE_POLICY, sourceDocumentUsesMovement, type SourceDocument } from './sourceModel';
import { MAX_BACKUP_BYTES, parseBackupText, prepareBackup, readStored, serializeBackup, STORAGE_KEY, validateBackup } from './storage';
import { executeTransferCommand } from './transferCommands';

const at = '2026-10-31T10:00:00.000Z';
const decision = {reason:'Synthetic explicit decision',at};
const bank: Wallet = {id:'bank',name:'Synthetic bank',kind:'bank',currency:'TRY',openingBalance:10_000};
const destination: Wallet = {id:'ewallet',name:'Synthetic e-wallet',kind:'ewallet',currency:'TRY',openingBalance:0};
function empty(): SourceDocument { return {app:'uangku',version:1,demo:false,state:{version:1,wallets:[{...bank},{...destination}],entries:[]}}; }
function movement(overrides: Partial<Entry> = {}): Entry { return {id:'movement',date:'2026-10-31',type:'movement',walletId:bank.id,amount:-2_000,category:'Transfer',note:'HAVALE SYNTHETIC',...overrides}; }
function document(...entries: Entry[]): SourceDocument { const data=empty();data.state.entries=entries;return data; }
function workbook(description: string, amount: number): ArrayBuffer {
  const rows: unknown[][] = [['Synthetic'],['Currency','TL'],...Array.from({length:9},()=>[]),['Tarih','Fiş No','Açıklama','İşlem Tutarı','Bakiye'],['31.10.2026','SYNTHETIC',description,amount,100+amount]];
  const escape=(value:unknown)=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cells=rows.map((row,i)=>`<row>${row.map((value,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="${typeof value==='number'?'n':'str'}"><v>${escape(value)}</v></c>`).join('')}</row>`).join('');
  const packed=zipSync({'xl/workbook.xml':strToU8('<workbook/>'),'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${cells}</sheetData></worksheet>`)});
  return packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength) as ArrayBuffer;
}
function imported(description='HAVALE SYNTHETIC',amount=-20) {
  const preview=parseZiraatWorkbook(workbook(description,amount),bank,[]);
  const result=prepareSourcedImport(empty(),bank,preview,{},false,'synthetic',at);
  if(result.status!=='ready')throw new Error(result.status==='invalid'?result.message:'Unexpected review');
  return {data:result.data,preview};
}
function restore(data:SourceDocument,preview:ImportPreview):SourceDocument {
  const reviewed={...preview,rows:preview.rows.map(row=>({...row,selected:true,duplicate:false}))};
  const inspection=inspectSourcedImport(data,bank,reviewed);
  const choices=Object.fromEntries(reviewed.rows.map(row=>[row.id,{signature:inspection.sourceReviews[row.id].signature,resolution:'restore' as const}]));
  const result=prepareSourcedImport(data,bank,reviewed,choices,false,'restored',at);
  if(result.status!=='ready')throw new Error(result.status==='invalid'?result.message:'Unexpected review');
  return result.data;
}
afterEach(()=>vi.unstubAllGlobals());

describe('confirmed single-account movement financial model',()=>{
  it.each([-2_000,2_000])('keeps signed amount %i in one wallet, outside income/expense and review counts',amount=>{
    const data=document(movement({amount}));
    expect(validateEntry({...data.state,entries:[]},data.state.entries[0])).toBeNull();
    expect(entrySignedAmount(data.state.entries[0])).toBe(amount);
    expect(entryPostings(data.state.entries[0])).toEqual([{walletId:bank.id,date:'2026-10-31',signedAmount:amount,role:'ordinary',basis:'entry'}]);
    expect(walletBalance(data.state,bank.id)).toBe(10_000+amount);
    expect(walletBalance(data.state,destination.id)).toBe(0);
    expect(summaryForCurrency(data.state,'TRY','2026-10')).toEqual({balance:10_000+amount,income:0,expense:0,uncategorized:0});
    expect(walletBalanceAt(data.state,bank.id,'2026-10-30')).toBe(10_000);
    expect(walletBalanceAt(data.state,bank.id,'2026-10-31')).toBe(10_000+amount);
  });
  it.each([0,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects nonzero unsafe movement amount %s',amount=>{
    expect(validateEntry(empty().state,movement({amount}))).not.toBeNull();
  });
  it.each([{fee:0},{fee:1},{toWalletId:destination.id},{toAmount:1},{rate:1}])('rejects counterpart/fee fields even if zero: %o',extra=>{
    expect(validateEntry(empty().state,movement(extra))).toMatch(/satu rekening/);
  });
  it('rejects a cash wallet for new movement while preserving legacy cash schema',()=>{
    const data=empty();data.state.wallets[0].kind='cash';
    expect(validateEntry(data.state,movement())).toMatch(/bank atau e-wallet/);
    expect(validateBackup({...data,state:{...data.state,entries:[movement({type:'expense',amount:2_000})]}}).state.wallets[0].kind).toBe('cash');
  });
  it('checks exact final signed balances, including cancelling large movements and overflow',()=>{
    const data=document(movement({amount:Number.MAX_SAFE_INTEGER}),movement({id:'negative',amount:-Number.MAX_SAFE_INTEGER}));
    expect(prepareBackup(data).data.state.entries).toHaveLength(2);
    expect(walletBalance(data.state,bank.id)).toBe(10_000);
    expect(()=>prepareBackup(document(movement({amount:Number.MAX_SAFE_INTEGER})))).toThrow(/besar/);
  });
});

describe('bank semantics use one explicit financial policy',()=>{
  it.each([
    ['ATM PARA ÇEKME',-2_000,'expense'],['ATM YATAN',2_000,'income'],['YURTİÇİ ATM P.Y.',2_000,'income'],
    ['ATM PARA YATIRMA',2_000,'income'],['Referanslı Havale SENT',-2_000,'movement'],['GELEN EFT',2_000,'movement'],
    ['FAST PAYMENT',-2_000,'movement'],['VIRMAN',2_000,'movement'],['HAVALE BSMV Tahsilatı',-20,'expense'],
    ['HAVALE Komisyonu Tahsilatı',-20,'expense'],['PREPAID bonus',20,'income'],['PREPAID İADE',20,'income'],
    ['PREPAID HAVALE REVERSAL ATM PARA ÇEKME',20,'income'],
  ] as const)('%s / %i confirms %s',(description,amount,type)=>{
    expect(confirmedBankEntryType(description,amount)).toBe(type);
    const preview=parseZiraatWorkbook(workbook(description,amount/100),bank,[]);
    expect(preview.rows[0].classification).toBe(type);
    expect(entriesFromImport(preview.rows,bank.id,'policy')[0]).toMatchObject({type,amount:type==='expense'?Math.abs(amount):amount});
  });
  it.each([
    ['ATM PARA ÇEKME',20],['ATM YATAN',-20],['HAVALE IADE',20],['HAVALE REVERSAL',-20],
    ['SANAL POS ALIŞVERİŞ HAVALE SHOP',-20],['PREPAID',-20],['XPREPAID',20],['PREPAIDIZED',20],
    ['HAVALE BSMV Tahsilatı',20],['ATM PARA ÇEKME ATM YATAN',-20],['ATM PARA ÇEKME ATM YATAN',20],
    ['ATM PARA ÇEKME İADE',-20],['ATM YATAN REVERSAL',20],['Unidentified credit',20],
  ] as const)('does not infer a confirmed operation for %s / %i',(description,amount)=>{
    expect(confirmedBankEntryType(description,amount)).toBeUndefined();
  });
  it('keeps raw import fingerprints stable after changing only the policy result',()=>{
    const preview=parseZiraatWorkbook(workbook('HAVALE Synthetic',20),bank,[]);
    const fingerprint=preview.rows[0].sourceKey;
    const existing=entriesFromImport(preview.rows,bank.id,'first');
    const second=parseZiraatWorkbook(workbook('HAVALE Synthetic',20),bank,existing);
    expect(second.rows[0]).toMatchObject({sourceKey:fingerprint,duplicate:true,selected:false,classification:'movement'});
  });
  it('keeps unknown credits pending and refuses cash-wallet imports',()=>{
    expect(parseZiraatWorkbook(workbook('Unknown incoming amount',20),bank,[]).rows[0].classification).toBe('unreviewed');
    expect(()=>parseZiraatWorkbook(workbook('ATM YATAN',20),{...bank,kind:'cash'},[])).toThrow(/bank atau e-wallet/);
  });
});

describe('movement storage feature gates',()=>{
  it('writes plain movement as version 3, returns version 1 memory, and detaches it',()=>{
    const data=document(movement()),raw=serializeBackup(data),wire=JSON.parse(raw);
    expect(wire.version).toBe(3);expect(wire.state.version).toBe(1);expect(wire.metadata).toBeUndefined();
    const restored=parseBackupText(raw);expect(restored).toEqual(data);expect(restored).not.toBe(data);
    expect(restored.state.entries[0]).not.toBe(data.state.entries[0]);
    expect(prepareBackup(data).data).toEqual(restored);
  });
  it('refuses movement mislabeled as old v1, while legacy v1 nonmovement remains valid',()=>{
    const data=document(movement());
    expect(()=>validateLegacyBackup(data)).toThrow(/versi 3/);
    expect(()=>validateBackup(data)).toThrow(/versi 3/);
    expect(()=>parseBackupText(JSON.stringify(data))).toThrow(/versi 3/);
    expect(validateLegacyBackup(data,{allowMovement:true})).toEqual(data);
    const legacy=document(movement({type:'unreviewed'}));
    expect(JSON.parse(serializeBackup(legacy)).version).toBe(1);
    expect(validateBackup(legacy)).toEqual(legacy);
  });
  it('does not upgrade the file format because a note contains the word movement',()=>{
    const legacy=document(movement({type:'expense',amount:1,note:'type movement is only user text'}));
    expect(JSON.parse(serializeBackup(legacy)).version).toBe(1);
  });
  it('rejects root accessors without executing them during format dispatch',()=>{
    const input=document(movement()),getter=vi.fn(()=>3);
    Object.defineProperty(input,'version',{enumerable:true,get:getter});
    expect(()=>validateBackup(input)).toThrow(/accessor/);
    expect(()=>prepareBackup(input)).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([{unknown:true},{metadata:{policy:SOURCE_POLICY,facts:[],links:[],statements:[]}},{version:4}])('rejects extra or conflicting plain version3 fields %o',extra=>{
    expect(()=>validateBackup({...document(movement()),version:3,...extra})).toThrow();
  });
  it('reads movement wire from storage without migration or write',()=>{
    const data=document(movement()),raw=serializeBackup(data),setItem=vi.fn();
    vi.stubGlobal('localStorage',{getItem:vi.fn(key=>key===STORAGE_KEY?raw:null),setItem});
    expect(readStored()).toMatchObject({data,blocked:false,persisted:true,token:raw,error:null});
    expect(setItem).not.toHaveBeenCalled();
  });
  it('preserves old raw data when an invalid movement format blocks storage',()=>{
    const raw=JSON.stringify(document(movement())),setItem=vi.fn();
    vi.stubGlobal('localStorage',{getItem:()=>raw,setItem});
    expect(readStored()).toMatchObject({blocked:true,persisted:false,token:raw});
    expect(setItem).not.toHaveBeenCalled();
  });
  it('rejects capacity before returning a candidate, preserving its original input',()=>{
    const data=document(...Array.from({length:2_100},(_,i)=>movement({id:`large-${i}`,amount:i%2?1:-1,note:'x'.repeat(4_000)})));
    const originalFirst=data.state.entries[0].note;
    expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeGreaterThan(MAX_BACKUP_BYTES);
    expect(()=>prepareBackup(data)).toThrow(/8 MB/);
    expect(data.state.entries).toHaveLength(2_100);expect(data.state.entries[0].note).toBe(originalFirst);
  });
});

describe('movement source facts and retained annotations',()=>{
  it('roundtrips a linked movement with codec4 and rejects all older source markers',()=>{
    const {data}=imported(),wire=encodeSourceWire(data);
    expect(wire.codec).toBe(MOVEMENT_SOURCE_CODEC);expect(decodeSourceWire(wire)).toEqual(data);
    expect(parseBackupText(serializeBackup(data))).toEqual(data);
    for(const codec of ['table-tuples-v1','table-tuples-v2','table-tuples-v3'])expect(()=>decodeSourceWire({...wire,codec})).toThrow(/versi 3|table-tuples-v4/);
    expect(()=>validateBackup(data)).toThrow(/versi 3/);
  });
  it.each([['ATM PARA ÇEKME',-20,'expense'],['ATM YATAN',20,'income'],['PREPAID PAYMENT',20,'income']] as const)('preserves %s confirmation, source facts and user annotations through delete and explicit restore',(description,amount,type)=>{
    const {data,preview}=imported(description,amount),entry=data.state.entries[0];
    const edited=applySourcedEntryEdit(data,{...entry,category:'Manual category',note:'Manual note'},[],decision);
    const removed=deleteSourcedEntry(edited,entry.id,decision),restored=restore(removed,preview);
    expect(restored.state.entries[0]).toMatchObject({type,amount:Math.abs(amount*100),category:'Manual category',note:'Manual note'});
    expect(restored.metadata!.facts).toEqual(data.metadata!.facts);expect(restored.metadata!.statements).toEqual(data.metadata!.statements);
    expect(restored.metadata!.annotations![0]).toMatchObject({confirmedType:type,category:'Manual category',note:'Manual note'});
    expect(data.state.entries[0].note).toBe(description);
  });
  it('keeps codec4 when only an inactive source annotation still records movement',()=>{
    const {data}=imported(),removed=deleteSourcedEntry(data,data.state.entries[0].id,decision);
    expect(removed.state.entries).toEqual([]);expect(sourceDocumentUsesMovement(removed)).toBe(true);
    expect(encodeSourceWire(removed).codec).toBe(MOVEMENT_SOURCE_CODEC);
    expect(()=>decodeSourceWire({...encodeSourceWire(removed),codec:'table-tuples-v3'})).toThrow(/table-tuples-v4/);
  });
  it('reconstructs signed movement and saved user notes during explicit completion',()=>{
    const {data}=imported(),removed=deleteSourcedEntry(data,data.state.entries[0].id,decision);
    removed.metadata!.dispositions![0].kind='deferred';
    const restored=prepareStatementCompletion(removed,removed.metadata!.statements[0].id,{...decision,rebase:true});
    expect(restored.state.entries[0]).toMatchObject({type:'movement',amount:-2_000,note:'HAVALE SYNTHETIC'});
    expect(restored.metadata!.facts).toEqual(data.metadata!.facts);
    expect(walletBalance(restored.state,bank.id,restored.metadata)).toBe(8_000);
  });
  it('preserves movement leg semantics through manual pair and unpair without changing balances',()=>{
    const original=document(movement({id:'debit'}),movement({id:'credit',walletId:destination.id,amount:2_000,date:'2026-11-02'}));
    const paired=executeTransferCommand(original,{kind:'pair',debitId:'debit',creditId:'credit',fee:0,...decision});
    expect(paired.state.entries[0].type).toBe('transfer');expect(encodeSourceWire(paired).codec).toBe(MOVEMENT_SOURCE_CODEC);
    expect(paired.metadata!.transfers![0].pairing!.sourceAnnotation!.type).toBe('movement');
    for(const wallet of original.state.wallets)expect(walletBalance(paired.state,wallet.id,paired.metadata)).toBe(walletBalance(original.state,wallet.id));
    const split=executeTransferCommand(paired,{kind:'unpair',entryId:'debit',...decision});
    expect(split.state.entries.map(entry=>[entry.id,entry.type,entry.amount,entry.date])).toEqual([['debit','movement',-2_000,'2026-10-31'],['credit','movement',2_000,'2026-11-02']]);
    expect(parseBackupText(serializeBackup(split))).toEqual(split);expect(original.state.entries).toHaveLength(2);
    expect(()=>decodeSourceWire({...encodeSourceWire(paired),codec:'table-tuples-v3'})).toThrow(/table-tuples-v4/);
  });
  it('retains codec4 for movement annotations inside a deleted transfer snapshot alone',()=>{
    const original=document(movement({id:'debit',sourceKey:'legacy-synthetic-debit'}),movement({id:'credit',walletId:destination.id,amount:2_000,sourceKey:'legacy-synthetic-credit'}));
    const paired=executeTransferCommand(original,{kind:'pair',debitId:'debit',creditId:'credit',fee:0,...decision});
    const removed=executeTransferCommand(paired,{kind:'delete',entryId:'debit',...decision});
    expect(removed.state.entries).toEqual([]);expect(removed.metadata!.annotations).toBeUndefined();
    expect(removed.metadata!.deletedTransfers![0].context!.pairing!.sourceAnnotation!.type).toBe('movement');
    const wire=encodeSourceWire(removed);expect(wire.codec).toBe(MOVEMENT_SOURCE_CODEC);expect(decodeSourceWire(wire)).toEqual(removed);
    expect(()=>decodeSourceWire({...wire,codec:'table-tuples-v3'})).toThrow(/table-tuples-v4/);
    const restored=executeTransferCommand(removed,{kind:'restore-deleted',entryId:'debit',...decision});
    expect(restored.state.entries).toEqual(paired.state.entries);
  });
  it('does not silently upgrade older source formats that contain no movement',()=>{
    const data=document(movement({type:'unreviewed'}));data.metadata={policy:SOURCE_POLICY,facts:[],links:[],statements:[]};
    const wire=encodeSourceWire(data);expect(wire.codec).toBe('table-tuples-v1');expect(decodeSourceWire(wire)).toEqual(data);
  });
});
