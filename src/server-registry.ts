import {ConfiguredUpstream,validateConfiguredUpstreams} from './configured-mcp-upstreams.js';
import type {AuditSink,RouteDefinition} from './contracts.js';
import {GatewayError,errorCode} from './validation.js';

/** Configured services survive failed discovery. A router consumes a catalog snapshot. */
export class ServerRegistry {
  onCatalogChanged:((id:string)=>void)|undefined;
  readonly #services=new Map<string,ConfiguredUpstream>();
  #readOnlyGrants=new Map<string,Set<string>>();
  #closed=false;
  #starting:Promise<void>|null=null;
  constructor(definitions:unknown,private readonly audit:AuditSink=()=>{}){
    for(const definition of validateConfiguredUpstreams(definitions)){const service=new ConfiguredUpstream(definition);this.attach(service);this.#services.set(definition.id,service);this.#readOnlyGrants.set(definition.id,new Set(definition.allowToolsInReadOnly));}
  }
  private attach(service:ConfiguredUpstream){service.onCatalogChanged=()=>{if(this.#services.get(service.id)===service)this.onCatalogChanged?.(service.id);};}
  get upstreams(){return [...this.#services.values()];}
  status(){return this.upstreams.map(service=>service.statusWithGrants(this.#readOnlyGrants.get(service.id)!));}
  revokeReadOnlyTool(id:string,tool:string){this.#readOnlyGrants.get(id)?.delete(tool);}
  async prepare(definitions:unknown,forceId?:string,signal?:AbortSignal,catalogRefresh=false){
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
      // Catalog refreshes share the live grant sets so even a revoke during discovery survives commit.
      const grants=catalogRefresh?this.#readOnlyGrants:new Map(next.map(def=>[def.id,new Set(def.allowToolsInReadOnly)]));
      return {services,created,routes:this.routes(services,grants),commit:()=>{
        if(this.#closed)throw new GatewayError('UPSTREAM_CLOSED');
        this.#services.clear();
        for(const service of services)this.#services.set(service.id,service);
        this.#readOnlyGrants=grants;
      }};
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
  routes(services=this.upstreams,grants=this.#readOnlyGrants):RouteDefinition[]{
    return services.filter(s=>s.definition.enabled!==false&&s.status.status==='READY').map(upstream=>({id:upstream.id,upstream,allowToolsInReadOnly:grants.get(upstream.id)!,authorize:(name,args)=>{
      if(!upstream.definition.allowTools.includes(name))throw new GatewayError('UPSTREAM_TOOL_NOT_GRANTED');return args;
    }}));
  }
  async close(){this.#closed=true;await Promise.allSettled(this.upstreams.map(service=>service.close()));await this.#starting;}
}
