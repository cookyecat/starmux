/** Per-pipeline opt-in cache. No hint or upstream annotation enables caching. */
export class ReadCache<T> {
 readonly #entries=new Map<string,{expires:number;value:T;bytes:number}>();#bytes=0;
 constructor(private readonly maxEntries=100,private readonly maxBytes=1048576,private readonly now=()=>Date.now()){}
 get(key:string):T|undefined{const value=this.#entries.get(key);if(!value)return;if(value.expires<=this.now()){this.delete(key);return;}this.#entries.delete(key);this.#entries.set(key,value);return structuredClone(value.value);}
 set(key:string,value:T,ttlMs:number){const bytes=Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(value));if(bytes>this.maxBytes)return;this.delete(key);while(this.#entries.size>=this.maxEntries||this.#bytes+bytes>this.maxBytes){const oldest=this.#entries.keys().next().value;if(oldest===undefined)break;this.delete(oldest);}this.#entries.set(key,{value:structuredClone(value),expires:this.now()+ttlMs,bytes});this.#bytes+=bytes;}
 private delete(key:string){const entry=this.#entries.get(key);if(entry){this.#bytes-=entry.bytes;this.#entries.delete(key);}}
}
