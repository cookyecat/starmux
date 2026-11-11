import {verifyInternalSetupWorker} from './global-core-control.js';
import {runGateway} from './dc-workspace-http.js';
if(!process.send)throw Error('INSTANCE_WORKER_REQUIRES_SUPERVISOR');
verifyInternalSetupWorker({port:Number(process.env.STARMUX_PROJECT_PORT),ownerPid:Number(process.env.STARMUX_INTERNAL_SETUP_OWNER_PID),
  runId:process.env.STARMUX_INTERNAL_SETUP_RUN_ID,token:process.env.STARMUX_INTERNAL_SETUP_TOKEN});
const gateway=await runGateway();
process.on('message',(message:unknown)=>{
 if(!message||typeof message!=='object')return;const m=message as Record<string,unknown>;
 if(m.type!=='gateway-apply'||typeof m.id!=='string')return;
 void gateway.apply(typeof m.upstreamFile==='string'?m.upstreamFile:undefined,typeof m.middlewareFile==='string'?m.middlewareFile:undefined,typeof m.forceId==='string'?m.forceId:undefined,typeof m.deadline==='number'?m.deadline:undefined).then(()=>process.send?.({type:'gateway-applied',id:m.id}),error=>process.send?.({type:'gateway-applied',id:m.id,error:error?.pluginId?error.message:error?.code??'GATEWAY_APPLY_FAILED'}));
});
process.send({type:'gateway-ready',localApply:true});
