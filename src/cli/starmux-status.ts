import {createAccessControl} from '../access-control.js';
import type {instanceStatus} from '../instance-runtime.js';
import {exists,instancePaths,type Instance,type InstanceConfig} from '../instance-store.js';
import {shellQuote} from '../platform.js';

type Status=Awaited<ReturnType<typeof instanceStatus>>;
type AuthMode='ingress'|'api-key'|'oauth';
type OAuthSummary={issuer:string;resource:string;clientId:string;scope:string;tokenAuth:string};
type AuthSummary={mode:AuthMode|null;activeKeys:number;oauth:OAuthSummary|null;problem:string|null};

async function authentication(instance:Instance,status:Status):Promise<AuthSummary>{
  const file=instancePaths(instance).access;
  try{
    const state=await (await createAccessControl(file,{initialize:false})).snapshot();
    if(status.phase==='running'&&status.health==='ok'&&status.accessMode!==state.mode){
      return {mode:null,activeKeys:0,oauth:null,problem:'Authentication changed while checking. Run status again.'};
    }
    const incomplete=status.phase!=='running'&&instance.requiredAccess!=='ingress'&&state.mode!==instance.requiredAccess;
    return {mode:state.mode,activeKeys:state.credentials.filter(c=>c.status==='active').length,
      oauth:state.oauth?{issuer:state.oauth.issuer,resource:state.oauth.resource,clientId:state.oauth.clientId,scope:state.oauth.scope,tokenAuth:state.oauth.tokenEndpointAuthMethod}:null,
      problem:incomplete?`This instance requires ${instance.requiredAccess} authentication before starting.`:null};
  }catch(error){
    // A new, never-started instance has an ingress default, but a lost store must
    // never be presented as an intentional switch to unauthenticated access.
    if((error as NodeJS.ErrnoException).code==='ENOENT'&&status.phase==='stopped'&&instance.requiredAccess==='ingress'&&!await exists(file+'.initialized')){
      return {mode:'ingress',activeKeys:0,oauth:null,problem:null};
    }
    return {mode:null,activeKeys:0,oauth:null,problem:'Authentication settings are unavailable. Inspect them with the Auth command below.'};
  }
}

export async function formatStarmuxStatus(instance:Instance,status:Status,config:InstanceConfig|undefined,options:{isDefault?:boolean}={}){
  const auth=await authentication(instance,status);
  // Omit `-i default` for the default instance to keep everyday single-instance output clean.
  const omitSelector=options.isDefault===true&&instance.name==='default';
  const selector=/^[A-Za-z0-9_.-]+$/.test(instance.name)&&!instance.name.startsWith('-')?instance.name:shellQuote(instance.name);
  const flag=omitSelector?'':(instance.name.startsWith('-')?` --instance=${selector}`:` -i ${selector}`);
  const command=(action:string)=>`starmux ${action}${flag}`;
  const ready=status.phase==='running'&&status.health==='ok';
  const hasProblem=Boolean(status.configProblem||status.runtimeProblem||auth.problem);
  const indicator=hasProblem?'!':ready?'●':status.phase==='running'?'◐':'○';
  const labels={
    ingress:'None (no token required)',
    'api-key':`API key (Bearer token; ${auth.activeKeys} active ${auth.activeKeys===1?'key':'keys'})`,
    oauth:'OAuth (browser sign-in)'
  };
  const saved=status.phase==='running'?' (saved; live state unavailable)':' (saved for next start)';
  const row=(label:string,value:string)=>'  '+label.padEnd(16)+value;
  const codingCmd=command('up --code');
  const mode=!config
    ?'Unavailable'
    :config.accessRole==='trusted'
    ?(config.writeScope==='home-only'?'Coding (Home sandbox · edits, shell & git)':'Coding (OS account · edits, shell & git)')
    :config.mode==='read-write'
    ?'File writes (restricted)'
    :`Read-only  (run '${codingCmd}' to enable edits & shell)`;
  const runtime=status.executionMode==='background'
    ?'Background · continues after this terminal closes'
    :status.executionMode==='foreground-owned'
    ?(status.runtime?.launcher==='app'?'App-owned · stops when the app closes':'Foreground · Ctrl+C stops this instance')
    :'Stopped';
  const title=omitSelector
    ?`${indicator} Starmux is ${status.phase}`
    :`${indicator} Starmux is ${status.phase}  (instance: ${instance.name})`;
  const lines=['',title];
  if(ready&&status.port){
    lines.push(row('Listen',`http://127.0.0.1:${status.port}/mcp  (this computer only)`));
  }
  lines.push(
    row('Workspace',config?.projectRoot??'Unavailable'),
    row('Mode',mode),
    row('Auth',auth.mode?labels[auth.mode]+(ready?'':saved):'Unavailable'),
    row('Runtime',runtime)
  );
  if(ready&&status.port&&auth.mode==='oauth'&&auth.oauth){
    lines.push(row('Client URL',auth.oauth.resource),row('Issuer',auth.oauth.issuer));
  }
  if(status.configProblem||status.runtimeProblem)lines.push(row('Problem',status.configProblem??status.runtimeProblem!));
  if(auth.problem)lines.push(row('Auth issue',auth.problem));

  const keyCommand=command('auth key "My AI Client"');
  if(ready&&!auth.problem){
    lines.push('','Connect an AI client (MCP settings)');
    lines.push(row('Transport','Streamable HTTP'));
    if(auth.mode==='ingress'){
      lines.push(
        row('URL (Local)',`http://127.0.0.1:${status.port}/mcp  (AI client on this computer)`),
        row('URL (Remote)',`https://<your-domain-or-tunnel>/mcp  (via protected HTTPS proxy or tunnel -> 127.0.0.1:${status.port})`),
        row('Authentication',`None  (optional Bearer API key: ${keyCommand})`)
      );
    }else if(auth.mode==='api-key'){
      lines.push(
        row('URL (Local)',`http://127.0.0.1:${status.port}/mcp  (AI client on this computer)`),
        row('URL (Remote)',`https://<your-domain-or-tunnel>/mcp  (via protected HTTPS proxy or tunnel -> 127.0.0.1:${status.port})`),
        row('Authentication',`Bearer API key  (${auth.activeKeys} active ${auth.activeKeys===1?'key':'keys'})`),
        row('Header','Authorization: Bearer <YOUR_API_KEY>')
      );
      if(!auth.activeKeys){
        lines.push(row('Create key',`${keyCommand}  (no active keys; required before connecting)`));
      }
    }else if(auth.mode==='oauth'&&auth.oauth){
      lines.push(
        row('URL (Remote)',auth.oauth.resource),
        row('Authentication','OAuth (browser sign-in)'),
        row('Issuer',auth.oauth.issuer),
        row('Client ID',`${auth.oauth.clientId}  (Scope: ${auth.oauth.scope} · Token auth: ${auth.oauth.tokenAuth})`)
      );
    }
  }

  lines.push('','Commands');
  if(auth.problem){
    lines.push(row('Check auth',command('auth')));
  }else if(!ready){
    if(status.phase==='stopped'&&!status.configProblem&&!status.runtimeProblem){
      if(auth.mode==='api-key'&&!auth.activeKeys)lines.push(row('Create key',keyCommand));
      lines.push(row('Start',command('up')),row('Start coding',codingCmd));
    }else{
      lines.push(row('Diagnose',command('doctor')));
    }
  }else{
    if(auth.mode==='api-key'&&auth.activeKeys){
      lines.push(
        row('Verify',`STARMUX_TOKEN=<key> ${command('verify')}`),
        row('New API key',keyCommand)
      );
    }else if(auth.mode==='oauth'){
      lines.push(
        row('Check OAuth',command('auth oauth doctor')),
        row('Verify',command('verify'))
      );
    }else{
      lines.push(row('Verify',command('verify')));
    }
  }
  if(status.configState==='pending')lines.push(row('Apply config',command('config apply')));
  lines.push(row('Auth & keys',command('auth')));
  if(ready)lines.push(row('Dashboard',`${command('dashboard')}  (view & copy settings in browser)`));
  lines.push(row('Logs',command('logs -f')));
  if(status.phase==='running')lines.push(row('Stop',command('down')));
  return lines.join('\n')+'\n';
}
