import {describe,it,expect,vi,afterEach} from 'vitest';
import {walletBalance,walletBalanceAt,summaryForCurrency,type Entry,type Wallet} from './finance';
import {inspectSourcedImport,prepareSourcedImport,applySourcedEntryEdit,deleteSourcedEntry,applySourcedBulkCategory,saveTransferEntry,type SourcedImportDecisions} from './sourceCommands';
import {executeTransferCommand,getTransferUnpairProblem} from './transferCommands';
import {inspectStoredStatement,prepareStatementCompletion} from './reconciliation';
import {serializeBackup,parseBackupText,readStored,validateBackup} from './storage';
import {type SourceDocument,SOURCE_POLICY} from './sourceModel';
import {type ImportPreview,type ImportRow} from './importer';

const at='2026-10-31T10:00:00.000Z';
const wallets:Wallet[]=[{id:'a',name:'Synthetic bank',kind:'bank',currency:'TRY',openingBalance:0},{id:'b',name:'Synthetic cash',kind:'cash',currency:'TRY',openingBalance:0}];
function empty():SourceDocument{return{app:'uangku',version:1,demo:false,state:{version:1,wallets:structuredClone(wallets),entries:[]}};}
function preview(amounts=[10000,-2000,-550],opening=10000):ImportPreview{
 let running=opening;
 const rows:ImportRow[]=amounts.map((amount,i)=>({id:`r${i}`,date:`2026-10-${String(i+1).padStart(2,'0')}`,amount,balance:running+=amount,description:`Synthetic row ${i}`,originalDescription:`  Raw Synthetic row ${i}  `,reference:`REF${i}`,originalReference:` REF${i} `,sourceKey:`ziraat:${(i+1).toString(16).padStart(16,'0')}`,classification:'unreviewed',category:'Belum dikategorikan',selected:true,duplicate:false}));
 return{currency:'TRY',openingBalance:opening,closingBalance:running,rows,period:{start:rows[0].date,end:rows.at(-1)!.date},warnings:[]};
}
function importNow(data:SourceDocument,p:ImportPreview,selected:number[]=p.rows.map((_,i)=>i),batch='initial',useOpening=true):SourceDocument{
 const value={...p,rows:p.rows.map((row,i)=>({...row,selected:selected.includes(i)}))};
 const result=prepareSourcedImport(data,data.state.wallets[0],value,{},useOpening,batch,at);
 if(result.status!=='ready')throw new Error(result.status==='invalid'?result.message:'Unexpected review');return result.data;
}
function reviewed(data:SourceDocument,p:ImportPreview,rowIndex:number,resolution:'keep'|'restore'){
 const current={...p,rows:p.rows.map((row,i)=>({...row,selected:i===rowIndex&&resolution==='restore'}))};
 const inspected=inspectSourcedImport(data,data.state.wallets[0],current);
 const decisions:SourcedImportDecisions=Object.fromEntries(Object.entries(inspected.sourceReviews).map(([id,r])=>[id,{signature:r.signature,resolution:id===current.rows[rowIndex].id?resolution:'keep'}]));
 const result=prepareSourcedImport(data,data.state.wallets[0],current,decisions,false,'reimport',at);
 if(result.status!=='ready')throw Error(result.status==='invalid'?result.message:'Unexpected review');return result.data;
}
afterEach(()=>vi.unstubAllGlobals());

describe('local source reconstruction and bounded compatibility',()=>{
 it('roundtrips a 65k ledger with 10 percent immutable Unicode source metadata within the wire capacity',()=>{
  const data=empty();data.state.wallets=[{...wallets[0],openingBalance:100000}];
  data.state.entries=Array.from({length:65000},(_,i)=>({id:`e${i}`,date:'2026-10-01',type:'expense',walletId:'a',amount:1,category:'',note:''}));
  const count=6500;
  data.metadata={policy:SOURCE_POLICY,facts:[],links:[],statements:[]};
  for(let i=0;i<count;i++){
    const fp=`ziraat:${(i+1).toString(16).padStart(16,'0')}`;data.state.entries[i].sourceKey=fp;
    data.metadata.facts.push({id:`f${i}`,walletId:'a',currency:'TRY',postedOn:'2026-10-01',signedAmount:-1,balanceAfter:99999-i,description:'İşlem 合成 💰',fingerprintVersion:'ziraat-v1',fingerprint:fp});
    data.metadata.links.push({entryId:`e${i}`,source:`f${i}`});
  }
  data.metadata.statements.push({id:'statement',walletId:'a',currency:'TRY',periodStart:'2026-10-01',periodEnd:'2026-10-01',openingBalance:100000,closingBalance:100000-count,rowIds:data.metadata.facts.map(f=>f.id)});
  const raw=serializeBackup(data);expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(8*1024*1024);
  const restored=parseBackupText(raw);expect(restored).toEqual(data);expect(walletBalance(restored.state,'a',restored.metadata)).toBe(35000);expect(walletBalanceAt(restored.state,'a','2026-10-01',restored.metadata)).toBe(35000);
 },60000);
 it('keeps legacy v1 unchanged and writes metadata documents as canonical v2 roundtrips',()=>{
  const legacy=empty();expect(JSON.parse(serializeBackup(legacy)).version).toBe(1);
  const data=importNow(legacy,preview());const wire=serializeBackup(data);expect(JSON.parse(wire).version).toBe(2);expect(parseBackupText(wire)).toEqual(data);
  const detached=validateBackup(data);detached.metadata!.facts[0].description='Changed copy';expect(data.metadata!.facts[0].description).toBe('  Raw Synthetic row 0  ');
  expect(data.metadata!.facts[0].reference).toBe(' REF0 ');
 });
 it('rejects unknown fields or invalid tuple references without any storage write',()=>{
  const data=importNow(empty(),preview());const wire=JSON.parse(serializeBackup(data));wire.t.links.r[0][1]=999999;
  const raw=JSON.stringify(wire),setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>raw,setItem});
  expect(()=>parseBackupText(raw)).toThrow();expect(readStored().blocked).toBe(true);expect(setItem).not.toHaveBeenCalled();
  expect(()=>validateBackup({...data,metadata:{...data.metadata,unsupported:true}})).toThrow();
 });
 it('completes the audit partial import 94.50 to three movements and 174.50 exactly once',()=>{
  const p=preview(),partial=importNow(empty(),p,[2]),before=structuredClone(partial);
  expect(walletBalance(partial.state,'a',partial.metadata)).toBe(9450);
  const id=partial.metadata!.statements[0].id;
  expect(inspectStoredStatement(partial,id).quality.missingSourceIds).toHaveLength(2);
  const completed=prepareStatementCompletion(partial,id,{reason:'Complete original file',at});
  expect(partial).toEqual(before);expect(completed.state.entries).toHaveLength(3);expect(walletBalance(completed.state,'a',completed.metadata)).toBe(17450);
  expect(inspectStoredStatement(completed,id)).toMatchObject({difference:0,quality:{status:'complete',comparable:true}});
  expect(prepareStatementCompletion(completed,id,{reason:'Repeat explicit check',at}).state.entries).toEqual(completed.state.entries);
  expect(parseBackupText(serializeBackup(completed))).toEqual(completed);
 });
 it('retains immutable bank facts through corrections, keeps explicit override on reimport and restores only by current decision',()=>{
  const p=preview(),original=importNow(empty(),p),entry=original.state.entries.find(e=>e.sourceKey===p.rows[2].sourceKey)!;
  const changed=applySourcedEntryEdit(original,{...entry,amount:-600,note:'User annotation'},[],{reason:'Correct effective value',at});
  expect(changed.metadata!.facts).toEqual(original.metadata!.facts);expect(walletBalance(changed.state,'a',changed.metadata)).toBe(17400);
  expect(reviewed(changed,p,2,'keep').state.entries.find(e=>e.id===entry.id)!.amount).toBe(-600);
  const restored=reviewed(changed,p,2,'restore');expect(restored.state.entries.find(e=>e.id===entry.id)!.amount).toBe(-550);
  expect(restored.state.entries.find(e=>e.id===entry.id)!.note).toBe('User annotation');expect(restored.metadata!.facts).toEqual(original.metadata!.facts);
 });
 it('requires a reason before financial source edits and deletion, and does not mutate its input',()=>{
  const data=importNow(empty(),preview()),before=structuredClone(data),entry=data.state.entries[0];
  expect(()=>applySourcedEntryEdit(data,{...entry,amount:entry.amount+1},[],{reason:'',at})).toThrow();
  expect(()=>deleteSourcedEntry(data,entry.id,{reason:'',at})).toThrow();expect(data).toEqual(before);
 });
 it('preserves source annotations through one atomic categorization without changing balances or facts',()=>{
  const data=importNow(empty(),preview()),before=structuredClone(data);
  const categorized=applySourcedBulkCategory(data,data.state.entries.map(e=>e.id),'Makan & minum',true);
  expect(data).toEqual(before);expect(categorized.metadata!.facts).toEqual(data.metadata!.facts);
  expect(walletBalance(categorized.state,'a',categorized.metadata)).toBe(17450);
  expect(categorized.state.entries.every(e=>e.type==='income'||e.type==='expense')).toBe(true);
  expect(categorized.metadata!.annotations!.every(a=>a.category==='Makan & minum')).toBe(true);
  expect(()=>applySourcedBulkCategory(data,['missing'],'Makan')).toThrow();
 });
 it('keeps deleted or excluded rows absent during completion unless exclusion is explicitly lifted',()=>{
  const p=preview(),data=importNow(empty(),p,[2]),deleted=deleteSourcedEntry(data,data.state.entries[0].id,{reason:'Intentional deletion',at});
  const id=data.metadata!.statements[0].id,completed=prepareStatementCompletion(deleted,id,{reason:'Complete deferred only',at});
  expect(completed.state.entries).toHaveLength(2);expect(completed.metadata!.dispositions!.find(d=>d.kind==='deleted')).toBeDefined();
  expect(inspectStoredStatement(completed,id).quality.status).toBe('incomplete');
 });
 it('requires explicit rebase to backfill earlier sources and preserves balance when the old anchor is witnessed',()=>{
  const full=preview(),last=full.rows[2],tail={...full,openingBalance:18000,rows:[{...last,id:'tail'}],period:{start:last.date,end:last.date}};
  const initial=importNow(empty(),tail,[0],'tail');expect(walletBalance(initial.state,'a',initial.metadata)).toBe(17450);
  const captured=importNow(initial,full,[],'full',false),id=captured.metadata!.statements.at(-1)!.id;
  expect(()=>prepareStatementCompletion(captured,id,{reason:'Backfill',at})).toThrow(/rebase/);
  const complete=prepareStatementCompletion(captured,id,{reason:'Adopt witnessed earlier boundary',at,rebase:true});
  expect(complete.state.entries).toHaveLength(3);expect(walletBalance(complete.state,'a',complete.metadata)).toBe(17450);expect(complete.state.wallets[0].openingBalance).toBe(10000);
  expect(()=>walletBalanceAt(complete.state,'a','2026-09-30',complete.metadata)).toThrow(/belum diketahui/);
 });
 it('rejects a rebase without overlap proof and does not alter the current baseline',()=>{
  const initial=importNow(empty(),preview([100],10000)),other=preview([100],9000);other.rows[0]={...other.rows[0],id:'older',date:'2026-09-01',sourceKey:'ziraat:ffffffffffffffff'};other.period={start:'2026-09-01',end:'2026-09-01'};
  const captured=importNow(initial,other,[],'older',false),before=structuredClone(captured);
  expect(()=>prepareStatementCompletion(captured,captured.metadata!.statements.at(-1)!.id,{reason:'No known continuity',at,rebase:true})).toThrow(/anchor/);expect(captured).toEqual(before);
 });
 it('does not replace a valid near-capacity document when completion exceeds the 8 MiB financial budget',()=>{
  const p=preview(Array(100).fill(1));p.rows=p.rows.map(row=>({...row,date:'2026-10-01',description:'x'.repeat(3900),originalDescription:'x'.repeat(3900)}));p.period={start:'2026-10-01',end:'2026-10-01'};
  const data=importNow(empty(),p,[0]);for(let i=0;i<2010;i++)data.state.entries.push({id:`manual-${i}`,walletId:'b',date:'2026-10-01',amount:1,type:'expense',category:'',note:'x'.repeat(3900)});
  const before=serializeBackup(data);expect(()=>prepareStatementCompletion(data,data.metadata!.statements[0].id,{reason:'Try complete',at})).toThrow(/8 MB|8 MiB|batas/);expect(serializeBackup(data)).toBe(before);
 });
});

describe('local two-date transfer reconstruction',()=>{
 it.each([undefined,'legacy-opaque-alias'])('converts legacy incoming without invented bank metadata or undefined persisted fields (%s)',fingerprint=>{
  const data=empty(),pending:Entry={id:'incoming',date:'2026-10-31',walletId:'a',type:'unreviewed',amount:10000,category:'',note:'Legacy incoming',...(fingerprint?{sourceKey:fingerprint}:{})};data.state.entries=[pending];
  const transfer:Entry={id:pending.id,date:pending.date,walletId:'b',toWalletId:'a',type:'transfer',amount:10000,toAmount:10000,fee:0,rate:1,category:'',note:pending.note,...(fingerprint?{toSourceKey:fingerprint}:{})};
  const converted=saveTransferEntry(data,transfer,[pending.id],{sourceDate:pending.date,destinationDate:pending.date,declareDates:true,reason:'Declare current legacy transfer interpretation',at});
  expect(converted.state.entries).toEqual([transfer]);expect(converted.metadata!.facts).toEqual([]);expect(converted.metadata!.links).toEqual([]);
  expect(parseBackupText(serializeBackup(converted))).toEqual(converted);
  expect(()=>validateBackup({...converted,metadata:{...converted.metadata,unknown:undefined}})).toThrow();
 });
 it.each(['2026-11-02',null])('checks the target wallet leg and binds overlap choices to date context (%s)',destinationDate=>{
  const original:Entry={id:'manual-transfer',type:'transfer',date:'2026-10-31',walletId:'a',toWalletId:'b',amount:100,toAmount:100,category:'',note:'Manual transfer'};
  const data=saveTransferEntry(empty(),original,[],{sourceDate:'2026-10-31',destinationDate,declareDates:true,reason:'Declare current dates',at});
  const p=preview([100],0);p.rows[0].date='2026-11-02';p.period={start:'2026-11-02',end:'2026-11-02'};
  const wallet=data.state.wallets[1],inspection=inspectSourcedImport(data,wallet,p);
  expect(inspection.needsReview).toBe(true);expect(inspection.overlaps.r0.candidates.map(e=>e.id)).toEqual(['manual-transfer']);
  const decisions:SourcedImportDecisions={r0:{signature:inspection.overlaps.r0.signature,resolution:'distinct'}};
  const changed=structuredClone(data);changed.metadata!.transfers![0].destinationDate='2026-11-03';
  expect(inspectSourcedImport(changed,wallet,p,decisions).needsReview).toBe(true);
  const prepared=prepareSourcedImport(data,wallet,p,decisions,false,'distinct-credit',at);expect(prepared.status).toBe('ready');
 });
 it('preserves source and destination dates, fee month, cutoff balance and delete/restore snapshot',()=>{
  const debitPreview=preview([-10200],50000);debitPreview.rows[0].date='2026-10-31';debitPreview.period={start:'2026-10-31',end:'2026-10-31'};
  let data=importNow(empty(),debitPreview,[0],'debit');
  const creditPreview=preview([10000],0);creditPreview.rows[0]={...creditPreview.rows[0],date:'2026-11-02',sourceKey:'ziraat:0000000000000002'};creditPreview.period={start:'2026-11-02',end:'2026-11-02'};
  const prepared=prepareSourcedImport(data,data.state.wallets[1],creditPreview,{},true,'credit',at);if(prepared.status!=='ready')throw Error('Fixture credit import failed');data=prepared.data;
  const debitId=data.state.entries.find(e=>e.walletId==='a')!.id,creditId=data.state.entries.find(e=>e.walletId==='b')!.id;
  const paired=executeTransferCommand(data,{kind:'pair',debitId,creditId,fee:200,reason:'Explicit pair',at});
  expect(walletBalanceAt(paired.state,'a','2026-11-01',paired.metadata)).toBe(39800);expect(()=>walletBalanceAt(paired.state,'b','2026-11-01',paired.metadata)).toThrow(/belum diketahui/);
  expect(walletBalanceAt(paired.state,'b','2026-11-02',paired.metadata)).toBe(10000);expect(summaryForCurrency(paired.state,'TRY','2026-10',undefined,paired.metadata).expense).toBe(200);
  const deleted=deleteSourcedEntry(paired,debitId,{reason:'Remove group',at});expect(deleted.state.entries).toHaveLength(0);
  const restored=executeTransferCommand(deleted,{kind:'restore-deleted',entryId:debitId,reason:'Restore group',at});expect(restored.state.entries).toEqual(paired.state.entries);expect(restored.metadata!.transfers).toEqual(paired.metadata!.transfers);
  const split=executeTransferCommand(restored,{kind:'unpair',entryId:debitId,reason:'Split current known postings',at});expect(split.state.entries.map(e=>e.date)).toEqual(['2026-10-31','2026-11-02']);
 });
 it.each([-10200,10000])('converts a single bank leg (%i) without inventing the other original source or date',amount=>{
  const p=preview([amount],50000),data=importNow(empty(),p),original=data.state.entries[0],outgoing=amount<0;
  const transfer:Entry={...original,type:'transfer',walletId:outgoing?'a':'b',toWalletId:outgoing?'b':'a',amount:10000,toAmount:10000,fee:outgoing?200:0};
  const converted=saveTransferEntry(data,transfer,[original.id],{sourceDate:outgoing?p.rows[0].date:null,destinationDate:outgoing?null:p.rows[0].date,declareDates:true,reason:'Declare current transfer with unknown other side',at});
  expect(converted.metadata!.facts).toEqual(data.metadata!.facts);expect(converted.metadata!.links[0]).toMatchObject(outgoing?{source:data.metadata!.facts[0].id}:{destination:data.metadata!.facts[0].id});
  expect(converted.metadata!.links[0][outgoing?'destination':'source']).toBeUndefined();
  expect(getTransferUnpairProblem(converted,original.id)).toMatch(/Tanggal kedua sisi/);
  expect(walletBalanceAt(converted.state,'a',p.rows[0].date,converted.metadata)).toBe(outgoing?39800:60000);
  expect(parseBackupText(serializeBackup(converted))).toEqual(converted);
 });
 it('retains unknown transfer dates across memo edits and does not infer bank facts for legacy entries',()=>{
  const data=empty(),entry:Entry={id:'legacy',date:'2026-10-01',walletId:'a',type:'transfer',toWalletId:'b',amount:100,toAmount:100,category:'',note:''};data.state.entries=[entry];
  expect(getTransferUnpairProblem(data,'legacy')).toMatch(/satu tanggal/);
  const declared=saveTransferEntry(data,entry,['legacy'],{sourceDate:'2026-10-01',destinationDate:null,declareDates:true,reason:'Other date unavailable',at});
  const edited=applySourcedEntryEdit(declared,{...entry,note:'Memo only'},[],{reason:'',at});
  expect(edited.metadata!.transfers![0].destinationDate).toBeNull();expect(edited.metadata!.facts).toEqual([]);
 });
});
