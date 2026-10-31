import {describe,it,expect} from 'vitest';
import {prepareBackup,parseBackupText,validateBackup,type StoredData} from './storage';
import {assertJsonBudget} from './jsonBudget';
import {validateSourceDocument,SOURCE_POLICY} from './sourceModel';

function fixture():StoredData{return{app:'uangku',version:1,demo:false,state:{version:1,wallets:[{id:'a',name:'Synthetic',kind:'bank',currency:'TRY',openingBalance:100}],entries:[{id:'e',date:'2026-10-31',walletId:'a',type:'expense',amount:1,category:'',note:'İşlem 合成 💰'}]}};}
type Part='document'|'state'|'wallet'|'entry';
function part(data:StoredData,where:Part):Record<string,unknown>{return(where==='document'?data:where==='state'?data.state:where==='wallet'?data.state.wallets[0]:data.state.entries[0])as unknown as Record<string,unknown>;}

describe('optimized validation boundary retains closed schemas and resource limits',()=>{
 it.each<Part>(['document','state','wallet','entry'])('rejects unsupported fields at %s without normalizing them away',where=>{
  const data=fixture(),selected=part(data,where);selected.unrecognized={retained:'Do not discard'};const before=JSON.stringify(data);
  expect(()=>prepareBackup(data)).toThrow(/tidak didukung/);expect(JSON.stringify(data)).toBe(before);
 });
 it.each<Part>(['document','state','wallet','entry'])('rejects undefined unknown fields at %s',where=>{
  const data=fixture();part(data,where).unrecognized=undefined;expect(()=>prepareBackup(data)).toThrow();expect(Object.hasOwn(part(data,where),'unrecognized')).toBe(true);
 });
 it.each(['toWalletId','toAmount','rate','fee','sourceKey','toSourceKey','importBatch'])('does not silently drop present-but-undefined optional %s',key=>{
  const data=fixture();part(data,'entry')[key]=undefined;expect(()=>prepareBackup(data)).toThrow(/undefined|JSON/);expect(Object.hasOwn(data.state.entries[0],key)).toBe(true);
 });
 it.each<Part>(['document','state','wallet','entry'])('rejects hidden financial fields at %s',where=>{
  const data=fixture();Object.defineProperty(part(data,where),'unrecognized',{value:'Do not discard',enumerable:false});expect(()=>prepareBackup(data)).toThrow();
 });
 it.each<Part>(['document','state','wallet','entry'])('rejects symbol financial fields at %s',where=>{
  const data=fixture();Object.defineProperty(part(data,where),Symbol('unknown'),{value:'Do not discard',enumerable:true});expect(()=>prepareBackup(data)).toThrow();
 });
 it('retains metadata unknown/undefined rejection and does not confuse absent metadata with metadata:undefined',()=>{
  const data=fixture();(data as unknown as Record<string,unknown>).metadata=undefined;expect(()=>prepareBackup(data)).toThrow();
  const metadata={policy:SOURCE_POLICY,facts:[],links:[],statements:[],unknown:undefined};
  expect(()=>prepareBackup({...fixture(),metadata})).toThrow();
 });
 it.each<Part>(['document','state','wallet','entry'])('rejects accessor fields at %s so resource counts cannot describe different values from the copy',where=>{
  const data=fixture(),selected=part(data,where),key=where==='document'?'demo':where==='state'?'version':where==='wallet'?'name':'note';
  const value=selected[key];Object.defineProperty(selected,key,{enumerable:true,configurable:true,get:()=>value});
  expect(()=>prepareBackup(data)).toThrow(/accessor/);
 });
 it('does not let changing getter values evade the financial budget',()=>{
  const data=fixture();let reads=0;Object.defineProperty(data.state.entries[0],'note',{enumerable:true,get:()=>++reads<=1?'':'x'.repeat(4000)});
  expect(()=>prepareBackup(data)).toThrow(/accessor/);
 });
 it('detaches one preparation, and revalidates a mutable caller object on the next preparation',()=>{
  const original=fixture(),prepared=prepareBackup(original);original.state.entries[0].note='Changed original';
  expect(prepared.data.state.entries[0].note).toBe('İşlem 合成 💰');expect(parseBackupText(prepared.raw)).toEqual(prepared.data);
  prepared.data.state.entries[0].amount=1.5;expect(()=>prepareBackup(prepared.data)).toThrow();
 });
 it('accepts equivalent property order without sorting the whole financial ledger',()=>{
  const data=fixture(),entry=data.state.entries[0];
  const reordered={state:{entries:[{note:entry.note,category:entry.category,amount:entry.amount,walletId:entry.walletId,type:entry.type,date:entry.date,id:entry.id}],wallets:data.state.wallets,version:1},demo:false,version:1,app:'uangku'};
  expect(validateBackup(reordered)).toEqual(data);
 });
 it.each([false,true])('keeps the 8 MiB financial budget before detached allocation, metadata=%s',metadata=>{
  const data=fixture(),entry={...data.state.entries[0],note:'x'.repeat(3900)};data.state.entries=Array(2300).fill(entry);
  if(metadata)data.metadata={policy:SOURCE_POLICY,facts:[],links:[],statements:[]};
  expect(()=>prepareBackup(data)).toThrow(/8 MB/);expect(data.state.entries).toHaveLength(2300);expect(data.state.entries[0]).toBe(entry);
 });
 it('retains the independent 64 MiB expanded semantic metadata bound',()=>{
  const data=fixture(),fact={id:'f',walletId:'a',currency:'TRY',postedOn:'2026-10-31',signedAmount:-1,balanceAfter:99,description:'x'.repeat(4000),fingerprintVersion:'ziraat-v1',fingerprint:'ziraat:0000000000000001'};
  const raw={...data,metadata:{policy:SOURCE_POLICY,facts:Array(17000).fill(fact),links:[],statements:[]}};
  expect(()=>validateSourceDocument(raw)).toThrow(/Data sumber terurai.*batas/);expect(raw.metadata.facts).toHaveLength(17000);expect(raw.metadata.facts[0]).toBe(fact);
 });
 it('counts UTF-8 JSON bytes exactly across ASCII escapes, Unicode, astral characters and lone surrogates',()=>{
  const input={ascii:'a"\\\n',unicode:'İşlem 合成 💰',lone:'\ud800',negative:-123,rate:1e-8,empty:null,flag:true,list:[0,false,'x']};
  const expected=new TextEncoder().encode(JSON.stringify(input)).byteLength;
  expect(assertJsonBudget(input,expected,'test')).toBe(expected);expect(()=>assertJsonBudget(input,expected-1,'test')).toThrow(/batas/);
 });
 it('retains depth/cycle and unsupported JSON value guards',()=>{
  const cyclic:Record<string,unknown>={};cyclic.self=cyclic;expect(()=>assertJsonBudget(cyclic,1000,'test')).toThrow(/siklus/);
  let deep:unknown=0;for(let i=0;i<66;i++)deep=[deep];expect(()=>assertJsonBudget(deep,1000,'test')).toThrow(/Kedalaman/);
  for(const bad of [undefined,()=>0,1n,Infinity,NaN])expect(()=>assertJsonBudget({bad},1000,'test')).toThrow();
 });
});
