import {ConfiguredUpstream,validateConfiguredUpstreams} from './configured-mcp-upstreams.js';
import type {AuditSink,RouteDefinition} from './contracts.js';
import {GatewayError,errorCode} from './validation.js';

/** Configured services survive failed discovery. A router consumes a catalog snapshot. */
export class ServerRegistry {
  onCatalogChanged:((id:string)=>void)|undefined;
  readonly #services=new Map<string,ConfiguredUpstream>();
  #closed=false;
  #starting:Promise<void>|null=null;
  constructor(definitions:unknown,private readonly audit:AuditSink=()=>{}){
    for(const definition of validateConfiguredUpstreams(definitions)){const service=new ConfiguredUpstream(definition);this.attach(service);this.#services.set(definition.id,service);}
  }
  private attach(service:ConfiguredUpstream){service.onCatalogChanged=()=>{if(this.#services.get(service.id)===service)this.onCatalogChanged?.(service.id);};}
  get upstreams(){return [...this.#services.values()];}
  status(){return this.upstreams.map(service=>service.status);}
  async prepare(definitions:unknown,forceId?:string,signal?:AbortSignal){
    if(this.#closed)throw new GatewayError('UPSTREAM_CLOSED');
    const next=validateConfiguredUpstreams(definitions);const created:ConfiguredUpstream[]=[];const abort=()=>{for(const service of created)void service.close();};signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted)throw new GatewayError('UPSTREAM_CLOSED');
      const services=await Promise.all(next.map(async definition=>{
        const old=this.#services.get(definition.id);
        if(old&&definition.id!==forceId&&JSON.stringify(old.definition)===JSON.stringify(definition))return old;
        const service=new ConfiguredUpstream(definition);this.attach(service);created.push(service);
        if(definition.enabled!==false)await service.connect();return service;
      }));
      if(this.#closed||signal?.aborted)throw new GatewayError('UPSTREAM_CLOSED');
      return {services,created,commit:()=>{if(this.#closed)throw new GatewayError('UPSTREAM_CLOSED');this.#services.clear();for(const service of services)this.#services.set(service.id,service);}};
    }catch(error){await Promise.allSettled(created.map(service=>service.close()));throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  async connectAll(){
    if(this.#closed)throw new GatewayError('UPSTREAM_CLOSED');
    if(this.#starting)return this.#starting;
    this.#starting=Promise.allSettled(this.upstreams.filter(s=>s.definition.enabled!==false).map(async service=>{
      try{await service.connect();this.audit({event:'UPSTREAM_DISCOVERED',route:service.id,tools:service.status.toolCount});}
      catch(error){this.audit({event:'UPSTREAM_STARTUP_UNAVAILABLE',route:service.id,code:errorCode(error)||'UPSTREAM_CONNECT_FAILED'});}
    })).then(()=>{}).finally(()=>{this.#starting=null;});
    return this.#starting;
  }
  routes(services=this.upstreams):RouteDefinition[]{
    return services.filter(s=>s.definition.enabled!==false&&s.status.status==='READY').map(upstream=>({id:upstream.id,upstream,authorize:(name,args)=>{
      if(!upstream.definition.allowTools.includes(name))throw new GatewayError('UPSTREAM_TOOL_NOT_GRANTED');return args;
    }}));
  }
  async close(){this.#closed=true;await Promise.allSettled(this.upstreams.map(service=>service.close()));await this.#starting;}
}
