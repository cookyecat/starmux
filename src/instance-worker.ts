import {verifyInternalSetupWorker} from './global-core-control.js';
import {runGateway} from './dc-workspace-http.js';
if(!process.send)throw Error('INSTANCE_WORKER_REQUIRES_SUPERVISOR');
verifyInternalSetupWorker({port:Number(process.env.STARMUX_PROJECT_PORT),ownerPid:Number(process.env.STARMUX_INTERNAL_SETUP_OWNER_PID),
  runId:process.env.STARMUX_INTERNAL_SETUP_RUN_ID,token:process.env.STARMUX_INTERNAL_SETUP_TOKEN});
await runGateway();
process.send({type:'gateway-ready'});
