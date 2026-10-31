/** UTF-8 JSON resource accounting shared by legacy and metadata boundaries. */
const encoder = new TextEncoder();
export function utf8Bytes(value: string): number { return encoder.encode(value).byteLength; }

/** Bound expansion before creating another full JSON string or financial copy. */
export function assertJsonBudget(value: unknown, limit: number, label: string): number {
  let total=0;
  const costs=new Map<string,number>(),active=new WeakSet<object>();
  const fail=(message:string):never=>{throw new Error(`Metadata sumber tidak valid: ${label}: ${message}`);};
  const add=(count:number)=>{total+=count;if(total>limit)fail('batas ukuran UTF-8 terlampaui sebelum materialisasi.');};
  const stringSize=(text:string)=>{let size=costs.get(text);if(size===undefined){const json=JSON.stringify(text);size=/^[\x00-\x7f]*$/.test(json)?json.length:utf8Bytes(json);costs.set(text,size);}return size;};
  function walk(current:unknown,depth=0):void{
    if(depth>64)fail('Kedalaman JSON melebihi 64.');
    if(typeof current==='string'){add(stringSize(current));return;}
    if(current===null||typeof current==='boolean'||typeof current==='number'){
      if(typeof current==='number'&&!Number.isFinite(current))fail('Angka JSON tidak finite.');
      // JSON numbers, booleans and null are ASCII, so UTF-8 needs no allocation.
      add(JSON.stringify(current).length);return;
    }
    if(current===undefined||typeof current!=='object')fail('Nilai JSON tidak didukung.');
    const object=current as object;
    if(active.has(object))fail('JSON mengandung siklus.');active.add(object);
    if(Array.isArray(current)){add(2+Math.max(0,current.length-1));for(const child of current)walk(child,depth+1);}
    else{
      if(![Object.prototype,null].includes(Object.getPrototypeOf(current)))fail('Objek JSON harus berupa record biasa.');
      const record=current as Record<string,unknown>,keys=Object.keys(record);
      add(2+Math.max(0,keys.length-1));for(const key of keys){add(stringSize(key)+1);walk(record[key],depth+1);}
    }
    active.delete(object);
  }
  walk(value);return total;
}
