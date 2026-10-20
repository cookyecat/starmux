import { GatewayError,currentUid,errorCode } from "./validation.js";
// Opt-in Seatbelt restriction for the Desktop Commander subprocess tree.
// Permits reads subject to TCC/POSIX, but grants file-write only under Home.
// sandbox-exec is a deprecated macOS API: fail closed if it is missing or
// cannot launch. Never advertise this as absolute isolation from all IPC.
import { constants } from "node:fs";
import { access,lstat,realpath } from "node:fs/promises";
import path from "node:path";

function denied(reason: string): never{const e=new GatewayError(reason);throw e;}
export function homeWriteProfile(home: unknown){
  if(typeof home!=="string"||!path.isAbsolute(home)||home.includes("\0")||
     home.includes("\n")||home.includes("\r")||home.length>1024||
     ["/","/Users","/Volumes","/private","/private/tmp"].includes(home))
    denied("HOME_WRITE_SANDBOX_UNSAFE_HOME");
  const segments=home.split("/").filter(Boolean);
  if(segments.length<2)denied("HOME_WRITE_SANDBOX_UNSAFE_HOME");
  // Seatbelt SBPL uses double-quoted string literals.
  const quoted=home.replaceAll("\\","\\\\").replaceAll('"','\\"');
  return `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath "${quoted}"))\n`;
}
export async function sandboxedDesktopSpawn({
  home, nodeBinary, entryArgs,
  binary="/usr/bin/sandbox-exec"
}: {home?: string|undefined; nodeBinary?: string; entryArgs?: string[]; binary?: string}={}){
  if(typeof nodeBinary!=="string"||!path.isAbsolute(nodeBinary)||
     !Array.isArray(entryArgs)||entryArgs.some(a=>typeof a!=="string"))
    denied("HOME_WRITE_SANDBOX_INVALID_EXEC");
  let h;
  try{
    if(typeof home!=="string")denied("HOME_WRITE_SANDBOX_UNAVAILABLE");
    h=await realpath(home);
    const stat=await lstat(home);
    if(stat.isSymbolicLink()||!stat.isDirectory()||stat.uid!==currentUid())
      denied("HOME_WRITE_SANDBOX_HOME_OWNER");
    if(path.resolve(home)!==h)denied("HOME_WRITE_SANDBOX_NOT_CANONICAL");
    await access(binary,constants.X_OK);
  }catch(error){
    if(errorCode(error)?.startsWith("HOME_WRITE_SANDBOX_"))throw error;
    denied("HOME_WRITE_SANDBOX_UNAVAILABLE");
  }
  return {
    command:binary,
    args:["-p",homeWriteProfile(h),nodeBinary,...entryArgs]
  };
}
