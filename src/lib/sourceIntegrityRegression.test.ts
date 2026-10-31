import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {parseZiraatWorkbook,type ImportPreview} from './importer';
import {inspectSourcedImport,prepareSourcedImport,applySourcedEntryEdit,type SourcedImportDecisions} from './sourceCommands';
import {executeTransferCommand,getTransferUnpairProblem} from './transferCommands';
import {validateSourceDocument,type SourceDocument} from './sourceModel';
import {serializeBackup,parseBackupText} from './storage';
import {walletBalance,actualWalletBalance,type Entry,type Wallet} from './finance';
const at='2026-10-30T10:00:00.000Z';
const wallets:Wallet[]=[{id:'a',name:'Synthetic A',kind:'bank',currency:'TRY',openingBalance:50000},{id:'b',name:'Synthetic B',kind:'bank',currency:'TRY',openingBalance:0},{id:'c',name:'Synthetic cash',kind:'cash',currency:'TRY',openingBalance:0}];
function workbook(date:string,amount:number,balance:number,note:string):ArrayBuffer{
 const rows:unknown[][]=[['Synthetic only'],['Currency','TL'],...Array.from({length:9},()=>[]),['Tarih','Fiş No','Açıklama','İşlem Tutarı','Bakiye'],[date,'SYNTHETIC-REF',note,amount,balance]];
 const xml=rows.map((row,i)=>`<row>${row.map((v,j)=>typeof v==='number'?`<c r="${String.fromCharCode(65+j)}${i+1}" t="n"><v>${v}</v></c>`:`<c r="${String.fromCharCode(65+j)}${i+1}" t="str"><v>${v}</v></c>`).join('')}</row>`).join('');
 const zipped=zipSync({'xl/workbook.xml':strToU8('<workbook/>'),'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`)});
 return zipped.buffer.slice(zipped.byteOffset,zipped.byteOffset+zipped.byteLength) as ArrayBuffer;
}
function imported(){
 let data:SourceDocument={app:'uangku',version:1,demo:false,state:{version:1,wallets:structuredClone(wallets),entries:[]}};
 const a=parseZiraatWorkbook(workbook('31.10.2026',-102,398,'HAVALE SYNTHETIC DEBIT'),wallets[0],[]);
 const b=parseZiraatWorkbook(workbook('02.11.2026',100,100,'HAVALE SYNTHETIC CREDIT'),wallets[1],[]);
 for(const [i,preview] of [a,b].entries()){
  const result=prepareSourcedImport(data,wallets[i],preview,{},false,'source-'+i,at);expect(result.status).toBe('ready');if(result.status!=='ready')throw Error('Fixture import failed');data=result.data;
 }
 return {data,a,b};
}
function paired(){const fixture=imported();const source=fixture.data.state.entries.find(e=>e.walletId==='a')!,destination=fixture.data.state.entries.find(e=>e.walletId==='b')!;
 return {...fixture,source,destination,data:executeTransferCommand(fixture.data,{kind:'pair',debitId:source.id,creditId:destination.id,fee:200,reason:'Explicit synthetic pair',at})};}
function deleted(){const f=paired();return{...f,active:f.data,data:executeTransferCommand(f.data,{kind:'delete',entryId:f.source.id,reason:'Delete both postings as one group',at})};}
function reimport(data:SourceDocument,preview:ImportPreview,wallet:Wallet,resolution:'keep'|'restore'){
 const original={...preview,rows:preview.rows.map(row=>({...row,selected:resolution==='restore',duplicate:false}))};
 const inspected=inspectSourcedImport(data,wallet,original);
 const decisions:SourcedImportDecisions=Object.fromEntries(original.rows.map(row=>[row.id,{signature:inspected.sourceReviews[row.id].signature,resolution}]));
 const result=prepareSourcedImport(data,wallet,original,decisions,false,'reimport-'+wallet.id,at);
 expect(result.status).toBe('ready');if(result.status!=='ready')throw Error(result.status==='invalid'?result.message:'Unexpected review');return result.data;
}
function legacy(){const f=paired();delete f.data.metadata!.transfers![0].pairing;return {...f,data:validateSourceDocument(f.data)};}

describe('E5 FIN-002 source integrity commands',()=>{
 it('deletes both financial legs and one fee while moving their exact interpretation into one tombstone',()=>{
  const f=paired(),before=structuredClone(f.data);const result=executeTransferCommand(f.data,{kind:'delete',entryId:f.source.id,reason:'Delete both postings as one group',at});
  expect(f.data).toEqual(before);expect(result.state.entries).toHaveLength(0);expect(walletBalance(result.state,'a',result.metadata)).toBe(50000);expect(walletBalance(result.state,'b',result.metadata)).toBe(0);
  expect(result.metadata!.facts).toEqual(before.metadata!.facts);expect(result.metadata!.statements).toEqual(before.metadata!.statements);expect(result.metadata!.annotations).toEqual(before.metadata!.annotations);
  expect(result.metadata!.links).toEqual([]);expect(result.metadata!.transfers).toEqual([]);expect(result.metadata!.creationOrigins).toEqual([]);
  expect(result.metadata!.deletedTransfers).toHaveLength(1);expect(result.metadata!.deletedTransfers![0]).toMatchObject({entry:before.state.entries[0],context:before.metadata!.transfers![0],link:before.metadata!.links[0],origin:'bank',reason:'Delete both postings as one group',at});
  expect(result.metadata!.dispositions).toHaveLength(2);expect(result.metadata!.dispositions!.every(row=>row.kind==='deleted'&&row.reason==='Delete both postings as one group')).toBe(true);
  expect(parseBackupText(serializeBackup(result))).toEqual(result);
 });
 it.each([0,1])('restores the whole group explicitly from source side %i, with both dates and exactly one fee',side=>{
  const f=deleted();const kept=reimport(f.data,side?f.b:f.a,wallets[side],'keep');expect(kept.state.entries).toEqual([]);expect(kept.metadata!.deletedTransfers).toHaveLength(1);
  const result=reimport(kept,side?f.b:f.a,wallets[side],'restore');expect(result.state.entries).toEqual(f.active.state.entries);expect(result.metadata!.links).toEqual(f.active.metadata!.links);expect(result.metadata!.transfers).toEqual(f.active.metadata!.transfers);
  expect(result.metadata!.dispositions).toEqual([]);expect(result.metadata!.deletedTransfers).toEqual([]);expect(actualWalletBalance(result.state,'a','2026-11-01',result.metadata)).toBe(39800);expect(actualWalletBalance(result.state,'b','2026-11-01',result.metadata)).toBe(0);
  const inspected=inspectSourcedImport(result,wallets[side],side?f.b:f.a);expect(inspected.rows.every(row=>row.duplicate&&!row.selected)).toBe(true);expect(result.state.entries).toHaveLength(1);
 });
 it('restores the corrected current snapshot instead of resetting financial overrides to bank values',()=>{
  const f=paired();const changed=executeTransferCommand(f.data,{kind:'edit',entry:{...f.data.state.entries[0],walletId:'c',amount:11000,toAmount:11000,note:'Separate group memo'},sourceDate:'2026-11-01',destinationDate:'2026-11-03',reason:'Keep my current correction',at});
  const removed=executeTransferCommand(changed,{kind:'delete',entryId:f.source.id,reason:'Remove corrected group',at});
  expect(removed.metadata!.deletedTransfers![0].override).toEqual({reason:'Keep my current correction',at});
  const restored=reimport(removed,f.a,wallets[0],'restore');expect(restored.state.entries).toEqual(changed.state.entries);expect(restored.metadata!.overrides).toEqual(changed.metadata!.overrides);expect(restored.metadata!.facts).toEqual(changed.metadata!.facts);
 });
 it('blocks restoration on reused group/pair IDs and does not mutate the caller',()=>{
  const f=deleted(),collision=structuredClone(f.data);collision.state.entries.push({id:f.destination.id,type:'income',walletId:'b',date:'2026-11-04',amount:1,category:'',note:'Independent new entry'});
  const before=structuredClone(collision);expect(()=>executeTransferCommand(collision,{kind:'restore-deleted',entryId:f.source.id,reason:'Restore',at})).toThrow(/ID grup/);expect(collision).toEqual(before);
 });
 it('does not silently restore from a stale reimport decision after the tombstone changed',()=>{
  const f=deleted(),preview={...f.a,rows:f.a.rows.map(row=>({...row,selected:true,duplicate:false}))};const review=inspectSourcedImport(f.data,wallets[0],preview);
  const changed=structuredClone(f.data);changed.metadata!.deletedTransfers![0].reason='Changed deletion decision';changed.metadata!.dispositions!.forEach(row=>row.reason='Changed deletion decision');
  const result=prepareSourcedImport(changed,wallets[0],preview,{[preview.rows[0].id]:{resolution:'restore',signature:review.sourceReviews[preview.rows[0].id].signature}},false,'stale',at);
  expect(result.status).toBe('review');expect(changed.state.entries).toEqual([]);
 });
 it('retains opaque legacy aliases only in an inactive tombstone, without inventing immutable facts',()=>{
  const f=paired(),legacy:SourceDocument={...f.data,metadata:undefined};delete legacy.metadata;
  const before=structuredClone(legacy);const removed=executeTransferCommand(legacy,{kind:'delete',entryId:f.source.id,reason:'Delete uncertain legacy group',at});
  expect(legacy).toEqual(before);expect(removed.state.entries).toEqual([]);expect(removed.metadata!.facts).toEqual([]);expect(removed.metadata!.links).toEqual([]);expect(removed.metadata!.deletedTransfers![0].entry.sourceKey).toBe(f.source.sourceKey);
  const restored=executeTransferCommand(removed,{kind:'restore-deleted',entryId:f.source.id,reason:'Restore my saved legacy values only',at});expect(restored.state.entries).toEqual(legacy.state.entries);expect(restored.metadata!.facts).toEqual([]);
 });
 it('unpairs complete legacy facts without inventing lost original posting IDs',()=>{
  const f=legacy();expect(getTransferUnpairProblem(f.data,f.source.id)).toBeNull();
  const result=executeTransferCommand(f.data,{kind:'unpair',entryId:f.source.id,destinationEntryId:'declared-new-credit',reason:'Create new current postings from known legacy facts',at});
  expect(result.state.entries.map(e=>[e.id,e.date,e.amount,e.note])).toEqual([[f.source.id,'2026-10-31',-10200,f.source.note],['declared-new-credit','2026-11-02',10000,f.destination.note]]);
  expect(result.metadata!.creationOrigins?.find(row=>row.entryId===f.source.id)?.origin).toBe('bank');expect(result.metadata!.creationOrigins?.find(row=>row.entryId==='declared-new-credit')).toBeUndefined();
  expect(result.metadata!.unpairings![0].pairing).toBeUndefined();expect(result.metadata!.unpairings![0]).toMatchObject({principal:10000,toAmount:10000,fee:200,groupNote:f.data.state.entries[0].note});expect(result.metadata!.facts).toEqual(f.data.metadata!.facts);
 });
 it('requires explicit consent for NEW bank-based annotations, preserving every annotation field still known',()=>{
  const f=legacy();delete f.data.metadata!.annotations![0].note;delete f.data.metadata!.annotations![1].category;
  expect(getTransferUnpairProblem(f.data,f.source.id)).toMatch(/anotasi baru/);expect(getTransferUnpairProblem(f.data,f.source.id,{useBankAnnotations:true})).toBeNull();
  const before=structuredClone(f.data);expect(()=>executeTransferCommand(f.data,{kind:'unpair',entryId:f.source.id,destinationEntryId:'new-credit',reason:'Missing consent',at})).toThrow(/anotasi baru/);expect(f.data).toEqual(before);
  const result=executeTransferCommand(f.data,{kind:'unpair',entryId:f.source.id,destinationEntryId:'new-credit',useBankAnnotations:true,reason:'Explicitly use bank descriptions as new current annotations',at});
  expect(result.state.entries[0].note).toBe(f.data.metadata!.facts[0].description);expect(result.state.entries[0].category).toBe(f.source.category);expect(result.state.entries[1].note).toBe(f.destination.note);expect(result.state.entries[1].category).toBe('Belum dikategorikan');expect(result.state.entries.every(e=>e.type==='unreviewed')).toBe(true);
 });
 it('retains data and explains missing facts/dates instead of guessing for incomplete legacy',()=>{
  const f=legacy();delete f.data.metadata!.links[0].destination;
  expect(getTransferUnpairProblem(f.data,f.source.id,{useBankAnnotations:true})).toMatch(/Fakta bank debit dan kredit belum lengkap/);
  const before=structuredClone(f.data);expect(()=>executeTransferCommand(f.data,{kind:'unpair',entryId:f.source.id,destinationEntryId:'new-credit',useBankAnnotations:true,reason:'Attempt incomplete',at})).toThrow(/Fakta bank/);expect(f.data).toEqual(before);
  const dates=legacy();dates.data.metadata!.transfers![0].destinationDate=null;expect(getTransferUnpairProblem(dates.data,dates.source.id,{useBankAnnotations:true})).toMatch(/Tanggal kedua sisi/);
 });
 it('preserves current source edits through pair → edit → unpair → reimport keep',()=>{
  const f=paired();const changed=executeTransferCommand(f.data,{kind:'edit',entry:{...f.data.state.entries[0],amount:11000,toAmount:11000},sourceDate:'2026-11-01',destinationDate:'2026-11-03',reason:'Current effective amounts and dates',at});
  const split=executeTransferCommand(changed,{kind:'unpair',entryId:f.source.id,reason:'Retain current net postings',at});const keptA=reimport(split,f.a,wallets[0],'keep');const keptBoth=reimport(keptA,f.b,wallets[1],'keep');
  expect(keptBoth.state.entries).toEqual(split.state.entries);expect(keptBoth.metadata!.facts).toEqual(f.data.metadata!.facts);expect(keptBoth.state.entries.map(e=>e.amount)).toEqual([-11200,11000]);expect(parseBackupText(serializeBackup(keptBoth))).toEqual(keptBoth);
 });
 it('rejects invalid deletion/restoration reasons without caller mutation',()=>{
  const f=paired(),before=structuredClone(f.data);expect(()=>executeTransferCommand(f.data,{kind:'delete',entryId:f.source.id,reason:'',at})).toThrow(/alasan/);expect(f.data).toEqual(before);
  const d=deleted();expect(()=>executeTransferCommand(d.data,{kind:'restore-deleted',entryId:f.source.id,reason:'',at})).toThrow(/alasan/);
 });
});
