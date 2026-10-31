import { createPostingDateIndex, entryPostings, walletBalanceAt, type Entry } from './finance';
import { serializeSourceWire } from './sourceCodec';
import { validateSourceDocument, type SourceDocument, type SourceFact, type SourceStatement } from './sourceModel';
import { manualSourceCandidates } from './sourceCommands';

export interface CompletionDecision { reason: string; at: string; rebase?: boolean; includeExcluded?: boolean }
export interface StatementInspection {
  statementId: string; statementClosing: number; projectedBalance: number | null; difference: number | null;
  baseline: { status: 'approved' | 'unverified'; id?: string; date?: string };
  quality: { status: 'complete' | 'incomplete' | 'unverified'; comparable: boolean; missingSourceIds: string[]; overriddenSourceIds: string[]; extraEntryIds: string[]; reasons: string[] };
}
const refs = (link: { source?: string; destination?: string }) => [link.source,link.destination].filter((id): id is string => !!id);

function requiredStatement(data: SourceDocument,id: string): SourceStatement {
  const statement=data.metadata?.statements.find(row=>row.id===id);
  if(!statement)throw new Error('File sumber tersimpan tidak ditemukan.');
  return statement;
}
/** Coverage is relative to witnessed files, never a claim about all bank history. */
function witnessedChain(data: SourceDocument,target: SourceStatement,anchor: string): SourceStatement[] | null {
  const statements=(data.metadata?.statements??[]).filter(row=>row.walletId===target.walletId);
  const chain:SourceStatement[]=[],reached=new Set<string>(),knownFacts=new Set<string>();
  for(const statement of statements)if(statement.rowIds.includes(anchor)){chain.push(statement);reached.add(statement.id);statement.rowIds.forEach(id=>knownFacts.add(id));}
  let changed=true;
  while(changed){changed=false;for(const statement of statements){if(reached.has(statement.id))continue;
    const shared=statement.rowIds.some(id=>knownFacts.has(id));
    const adjacent=chain.some(previous=>{
      const nextDay=new Date(previous.periodEnd+'T12:00:00Z');nextDay.setUTCDate(nextDay.getUTCDate()+1);
      return previous.periodEnd<=statement.periodStart&&statement.periodStart<=nextDay.toISOString().slice(0,10)&&previous.closingBalance===statement.openingBalance;
    });
    if(shared||adjacent){chain.push(statement);reached.add(statement.id);statement.rowIds.forEach(id=>knownFacts.add(id));changed=true;}
  }}
  return reached.has(target.id)?chain.filter(statement=>statement.periodStart<=target.periodEnd):null;
}

export function inspectStoredStatement(data: SourceDocument,statementId: string): StatementInspection {
  const statement=requiredStatement(data,statementId),metadata=data.metadata!;
  const baseline=metadata.baselines?.find(row=>row.walletId===statement.walletId);
  const approved=baseline?.status==='confirmed'&&baseline.boundary.kind==='before-source'&&metadata.baselineDecisions?.some(row=>row.baselineId===baseline.id);
  const chain=approved&&baseline?.boundary.sourceId?witnessedChain(data,statement,baseline.boundary.sourceId):null;
  const requiredSources=new Set((chain??[statement]).flatMap(row=>row.rowIds));
  const facts=new Map(metadata.facts.map(row=>[row.id,row])),entries=new Map(data.state.entries.map(row=>[row.id,row]));
  const represented=new Set<string>(),overridden=new Set<string>();
  const linksByEntry=new Map(metadata.links.map(link=>[link.entryId,link]));
  const dates=createPostingDateIndex(metadata);
  for(const link of metadata.links){const entry=entries.get(link.entryId);if(!entry)continue;const postings=entryPostings(entry,dates);
    for(const role of ['source','destination'] as const){const fact=facts.get(link[role]??'');if(!fact)continue;
      const relevant=postings.filter(p=>entry.type==='transfer'?role==='source'?p.role==='source'||p.role==='fee':p.role==='destination':p.role==='ordinary');
      const total=relevant.reduce((sum,p)=>sum+BigInt(p.signedAmount),0n);
      if(relevant.length&&relevant.every(p=>p.walletId===fact.walletId&&p.date===fact.postedOn)&&total===BigInt(fact.signedAmount))represented.add(fact.id);else overridden.add(fact.id);
    }
  }
  const missing=[...requiredSources].filter(id=>!represented.has(id));
  const overriddenIds=[...requiredSources].filter(id=>overridden.has(id));
  const extra:string[]=[];
  const start=approved&&baseline?baseline.boundary.date:statement.periodStart;
  for(const entry of data.state.entries){
    const relevant=entryPostings(entry,dates).filter(p=>p.walletId===statement.walletId&&(p.date===null||p.date>=start&&p.date<=statement.periodEnd));
    if(!relevant.length)continue;
    const link=linksByEntry.get(entry.id);
    if(!link||!refs(link).some(id=>requiredSources.has(id)))extra.push(entry.id);
  }
  let balance:number|null=null;
  try{balance=walletBalanceAt(data.state,statement.walletId,statement.periodEnd,dates);}catch{/* An unknown baseline is reported, not replaced with zero. */}
  const reasons:string[]=[];
  if(!approved)reasons.push('Saldo awal belum mempunyai keputusan batas sumber yang disetujui.');
  if(approved&&!chain)reasons.push('File ini belum mempunyai rantai bukti tersambung dari batas saldo awal. Kesamaan saldo tidak membuktikan kelengkapan.');
  if(missing.length)reasons.push(`${missing.length} sumber dalam cakupan belum terwakili tepat oleh catatan aktif.`);
  if(overriddenIds.length)reasons.push(`${overriddenIds.length} sumber mempunyai koreksi nilai, dompet, atau tanggal.`);
  if(extra.length)reasons.push(`${extra.length} catatan tambahan atau tanggal belum diketahui berada dalam cakupan.`);
  if(balance===null)reasons.push('Saldo pada penutupan belum dapat dihitung dengan bukti batas yang tersedia.');
  const comparable=!!approved&&!!chain&&missing.length===0&&extra.length===0&&balance!==null;
  const delta=balance===null?null:BigInt(balance)-BigInt(statement.closingBalance);
  const difference=delta!==null&&delta<=BigInt(Number.MAX_SAFE_INTEGER)&&delta>=BigInt(Number.MIN_SAFE_INTEGER)?Number(delta):null;
  if(delta!==null&&difference===null)reasons.push('Selisih saldo melebihi batas angka tepat.');
  return{statementId,statementClosing:statement.closingBalance,projectedBalance:balance,difference,
    baseline:{status:approved?'approved':'unverified',...(baseline?{id:baseline.id,date:baseline.boundary.date}:{})},
    quality:{status:comparable&&difference===0?'complete':approved?'incomplete':'unverified',comparable:comparable&&difference!==null,missingSourceIds:missing,overriddenSourceIds:overriddenIds,extraEntryIds:extra,reasons}};
}

/** Explicit proposal; caller commits this whole document through the guarded writer. */
export function prepareStatementCompletion(data: SourceDocument,statementId: string,decision: CompletionDecision): SourceDocument {
  if(!decision.reason.trim()||!Number.isFinite(Date.parse(decision.at)))throw new Error('Isi alasan dan waktu keputusan pelengkapan.');
  const next=structuredClone(data),statement=requiredStatement(next,statementId),m=next.metadata!;
  const wallet=next.state.wallets.find(row=>row.id===statement.walletId)!;
  const facts=new Map(m.facts.map(row=>[row.id,row])),first=facts.get(statement.rowIds[0]);
  if(!first)throw new Error('File sumber tidak memiliki anchor awal yang dapat dibuktikan.');
  let baseline=m.baselines?.find(row=>row.walletId===wallet.id);
  const baselineApproved=baseline?.status==='confirmed'&&m.baselineDecisions?.some(row=>row.baselineId===baseline!.id);
  const needsEarlierBoundary=!!baseline&&first.postedOn<baseline.boundary.date;
  if(!baselineApproved||needsEarlierBoundary){
    if(!decision.rebase)throw new Error('Pelengkapan ini memerlukan keputusan eksplisit memakai batas saldo awal dari file (rebase).');
    if(baselineApproved&&baseline?.boundary.sourceId&&!statement.rowIds.includes(baseline.boundary.sourceId))throw new Error('Backfill harus memuat anchor baseline lama agar kesinambungan bukti dapat diperiksa. Unggah file dengan periode tumpang tindih; celah histori tidak ditebak.');
    if(baselineApproved&&baseline?.boundary.kind!=='before-source')throw new Error('Baseline lama belum memiliki anchor sumber untuk backfill yang dapat dibuktikan.');
    const dates=createPostingDateIndex(m);
    if(next.state.entries.some(entry=>entryPostings(entry,dates).some(p=>p.walletId===wallet.id&&(p.date===null||p.date<first.postedOn))))throw new Error('Ada posting sebelum batas baru atau tanpa tanggal. Rebase tidak boleh menghitung ulang saldo awal secara diam-diam.');
    const opening=BigInt(first.balanceAfter)-BigInt(first.signedAmount);
    if(opening>BigInt(Number.MAX_SAFE_INTEGER)||opening<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Saldo awal melampaui batas angka tepat.');
    wallet.openingBalance=Number(opening);
    const previousId=baseline?.id;
    baseline={id:previousId??`base:${statement.id}`,walletId:wallet.id,boundary:{kind:'before-source',date:first.postedOn,sourceId:first.id},origin:'bank',status:'confirmed'};
    m.baselines=[...(m.baselines??[]).filter(row=>row.walletId!==wallet.id),baseline];
    m.baselineDecisions=[...(m.baselineDecisions??[]).filter(row=>row.baselineId!==baseline!.id),{baselineId:baseline.id,reason:decision.reason.trim(),at:decision.at}];
  }
  const claims=new Set(m.links.flatMap(refs));
  const aliases=new Set(next.state.entries.flatMap(entry=>[entry.sourceKey,entry.toSourceKey]).filter((fp):fp is string=>!!fp));
  const dispositions=new Map((m.dispositions??[]).map(row=>[row.sourceId,row]));
  const annotations=new Map((m.annotations??[]).map(row=>[row.sourceId,row]));
  const ids=new Set(next.state.entries.map(entry=>entry.id));m.creationOrigins??=[];
  const manual=manualSourceCandidates(data);
  for(const sourceId of statement.rowIds){
    if(claims.has(sourceId))continue;
    const fact=facts.get(sourceId)!;const disposition=dispositions.get(sourceId);
    if(disposition?.kind==='deleted'||disposition?.kind==='excluded'&&!decision.includeExcluded)continue;
    if(m.deletedTransfers?.some(row=>refs(row.link??{}).includes(sourceId)))continue;
    if(aliases.has(fact.fingerprint))throw new Error('Fingerprint legacy atau sumber lain sudah memakai mutasi ini. Tinjau asosiasinya melalui impor ulang sebelum pelengkapan.');
    if(manual.has(`${fact.walletId}:${fact.postedOn}:${fact.signedAmount}`)||manual.has(`${fact.walletId}:?:${fact.signedAmount}`))throw new Error('Ada kandidat catatan manual pada tanggal dan nominal sumber yang sama, atau transfer dengan tanggal sisi terkait belum diketahui. Tinjau impor ulang dan pilih transaksi berbeda secara eksplisit bila ini mutasi lain; asosiasi tidak ditebak.');
    if(fact.postedOn<baseline!.boundary.date)throw new Error('Sumber sebelum batas saldo awal memerlukan backfill eksplisit.');
    let id=`complete:${sourceId}`;for(let suffix=1;ids.has(id);suffix++)id=`complete:${sourceId}:${suffix}`;
    const saved=annotations.get(sourceId),chosen=saved?.confirmedType??'unreviewed';
    const type=chosen==='income'&&fact.signedAmount<0||chosen==='expense'&&fact.signedAmount>0?'unreviewed':chosen;
    const entry:Entry={id,date:fact.postedOn,type,walletId:fact.walletId,amount:type==='unreviewed'||type==='movement'?fact.signedAmount:Math.abs(fact.signedAmount),category:saved?.category??'Belum dikategorikan',note:saved?.note??fact.description,sourceKey:fact.fingerprint,importBatch:saved?.importBatch??`completion:${statement.id}`};
    next.state.entries.push(entry);m.links.push({entryId:id,source:sourceId});m.creationOrigins.push({entryId:id,origin:'bank'});claims.add(sourceId);ids.add(id);aliases.add(fact.fingerprint);dispositions.delete(sourceId);
    annotations.set(sourceId,{sourceId,category:entry.category,note:entry.note,confirmedType:entry.type as 'income'|'expense'|'unreviewed'|'movement',importBatch:entry.importBatch});
  }
  m.dispositions=[...dispositions.values()];m.annotations=[...annotations.values()];
  m.completions=[...(m.completions??[]).filter(row=>row.statementId!==statement.id),{statementId:statement.id,baselineId:baseline!.id,sourceIds:statement.rowIds.filter(id=>claims.has(id)),at:decision.at}];
  const normalized=validateSourceDocument(next);serializeSourceWire(normalized);return normalized;
}

export function statementFacts(data:SourceDocument,statementId:string):SourceFact[]{
  const statement=requiredStatement(data,statementId),facts=new Map(data.metadata!.facts.map(row=>[row.id,row]));return statement.rowIds.map(id=>structuredClone(facts.get(id)!));
}
