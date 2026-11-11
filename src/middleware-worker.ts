import {pathToFileURL} from 'node:url';
import type {MiddlewareDefinition} from './middleware.js';
let plugin:MiddlewareDefinition|undefined;
const generation=process.argv[3];
process.on('message',async(value:unknown)=>{
 if(!value||typeof value!=='object')return;
 const message=value as {id:string;generation:string;stage:string;args:unknown[]};
 if(message.generation!==generation||typeof message.id!=='string')return;
 try{
  let result:unknown;
  if(message.stage==='initialize'){
   const module=await import(pathToFileURL(process.argv[2]!).href);plugin=module.default;
   if(!plugin||plugin.apiVersion!==1)throw Error('MIDDLEWARE_API_VERSION_UNSUPPORTED');
   result=['catalog','route','request','response','observe'].filter(k=>typeof plugin![k as keyof MiddlewareDefinition]==='function');
  }else{
   const fn=plugin?.[message.stage as keyof MiddlewareDefinition];
   if(typeof fn!=='function')throw Error('MIDDLEWARE_HOOK_MISSING');
   result=await (fn as (...args:unknown[])=>unknown)(...message.args);
  }
  process.send?.({id:message.id,generation,stage:message.stage,result:result??null});
 }catch{process.send?.({id:message.id,generation,stage:message.stage,error:'MIDDLEWARE_FAILED'});}
});
process.on('disconnect',()=>process.exit());
