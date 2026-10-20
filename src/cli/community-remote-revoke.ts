import { errorCode,errorMessage } from "../validation.js";
// Owner-local revocation operations. Never contacts an IdP or network, and
// never changes production Core, Tunnel, Bridge, Caddy, or login items.
import {
initializeRemoteRevocations,readRemoteRevocations,
revokeRemoteIdentity
} from "../community-remote-revocations.js";
const [command,...args]=process.argv.slice(2);
const file=process.env.MAC_MCP_REMOTE_REVOCATIONS_FILE;
if(!file)throw Error("REMOTE_REVOCATION_FILE_REQUIRED");
try {
  let result;
  if(command==="init"&&args.length===0)result=await initializeRemoteRevocations(file);
  else if(command==="status"&&args.length===0){
    const data=await readRemoteRevocations(file);
    result={ready:true,revokedSubjects:data.revokedSubjects.length,
      revokedJtis:data.revokedJtis.length};
  }else if(command==="revoke-subject"&&args.length===1)
    result=await revokeRemoteIdentity(file,{subject:args[0]});
  else if(command==="revoke-jti"&&args.length===1)
    result=await revokeRemoteIdentity(file,{jti:args[0]});
  else throw Error("USAGE_INIT_STATUS_REVOKE_SUBJECT_OR_JTI");
  process.stdout.write(JSON.stringify({event:"REMOTE_REVOCATION_OWNER_OPERATION",
    command,...result})+"\n");
}catch(error){
  process.stderr.write(JSON.stringify({event:"REMOTE_REVOCATION_OWNER_FAILED",
    reason:errorCode(error)||errorMessage(error)||"UNKNOWN"})+"\n");
  process.exitCode=1;
}
