import {randomUUID} from 'node:crypto';
import type {UpstreamRouter} from './contracts.js';
import type {MiddlewareEngine} from './middleware-engine.js';
interface Closeable {close():Promise<void>}
const owners=new WeakMap<Closeable,number>();
/** One immutable routing/catalog/pipeline generation pinned through complete calls. */
export class GatewaySnapshot {
 readonly version=randomUUID();#references=1;#retired=false;#closed=false;
 constructor(readonly router:UpstreamRouter,readonly middleware:MiddlewareEngine|undefined,private readonly resources:Closeable[]){
  for(const resource of resources)owners.set(resource,(owners.get(resource)??0)+1);
 }
 retain(){if(this.#closed)throw Error('GATEWAY_SNAPSHOT_RETIRED');this.#references++;let released=false;return ()=>{if(!released){released=true;this.release();}};}
 retire(){if(this.#retired)return;this.#retired=true;this.release();}
 private release(){
  if(--this.#references!==0)return;this.#closed=true;
  for(const resource of this.resources){const count=(owners.get(resource)??1)-1;if(count)owners.set(resource,count);else{owners.delete(resource);void resource.close().catch(()=>{});}}
 }
}
