// Host integration for the shared CLI. macOS App and legacy paths stay stable.
import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync,type Stats} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const windows=process.platform==='win32';
export function supportedHost(){
  if(!['darwin','linux','win32'].includes(process.platform)||Number(process.versions.node.split('.')[0])<22)
    throw Error('REQUIRES_SUPPORTED_OS_NODE_22');
}
function powershell(script:string,file=''){
  return execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from('$ErrorActionPreference="Stop"; '+script,'utf16le').toString('base64')],
    {encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,GATEWAY_ACL_PATH:file}}).trim();
}
// Paths are passed as data, never interpolated into a PowerShell program.
export function ownedByUser(file:string,stat:Stats,privateMode=false):boolean{
  if(stat.isSymbolicLink())return false;
  if(!windows)return stat.uid===process.getuid?.()&&(!privateMode||(stat.mode&0o077)===0);
  try{
    return powershell(`$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl=Get-Acl -LiteralPath $env:GATEWAY_ACL_PATH;
      # Elevated Windows processes may create files owned by Administrators.
      # These privileged principals can already override a user's ACL.
      if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin @($me.Value,'S-1-5-18','S-1-5-32-544')){exit 1};
      ${privateMode?`$hasOwnerRule=$false; foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
        if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -eq $me.Value){$hasOwnerRule=$true};
        if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($me.Value,'S-1-5-18','S-1-5-32-544')){exit 1}
      }; if(-not $hasOwnerRule){exit 1}`:''}
      Write-Output 'OK'`,file)==='OK';
  }catch{return false;}
}
export function createPrivateDirectory(folder:string){
  try{const st=lstatSync(folder);if(!st.isDirectory()||!ownedByUser(folder,st,true))throw Error('PRIVATE_DIRECTORY_UNSAFE');return;}
  catch(e){if(!(e instanceof Error&&'code' in e&&e.code==='ENOENT'))throw e;}
  mkdirSync(folder,{recursive:true,mode:0o700});
  if(windows){
    if(!ownedByUser(folder,lstatSync(folder)))throw Error('PRIVATE_DIRECTORY_UNSAFE');
    powershell(`$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl=New-Object System.Security.AccessControl.DirectorySecurity;
      $acl.SetOwner($me);$acl.SetAccessRuleProtection($true,$false);
      $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
      $acl.AddAccessRule($rule);Set-Acl -LiteralPath $env:GATEWAY_ACL_PATH -AclObject $acl`,folder);
  }
  if(!ownedByUser(folder,lstatSync(folder),true))throw Error('PRIVATE_DIRECTORY_UNSAFE');
}
export function controlRoot(){
  if(process.platform==='darwin')return `/private/tmp/mac-mcp-gateway-${process.getuid!()}`;
  const id=windows?createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0,16):String(process.getuid!());
  return path.join(tmpdir(),`mac-mcp-gateway-${id}`);
}
export function within(candidate:string,root:string){
  const relative=path.relative(root,candidate);
  return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));
}
export const childEnvKeys=['PATH','Path','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATHEXT','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE','USER','USERNAME','LOGNAME','TERM','COLORTERM'];
export function shellQuote(value:string){
  if(/[\r\n\0]/.test(value))throw Error('SHELL_ARGUMENT_INVALID');
  return windows?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'";
}
export function commandOptions(command:string){return windows?{command,shell:'powershell.exe'}:{command};}
export function inDirectory(root:string,command:string){
  return windows?`Set-Location -LiteralPath ${shellQuote(root)} -ErrorAction Stop; ${command}`:`cd ${shellQuote(root)} && ${command}`;
}
export const gitBinary=process.platform==='darwin'?'/usr/bin/git':'git';
export const systemNameCommand=windows?'[System.Environment]::OSVersion.Platform.ToString()':'/usr/bin/uname -s';
// Windows reports logical KiB; Unix du reports allocated KiB. Neither follows
// reparse points/symlinks into unapproved trees. This command only reads sizes.
export function diskUsageCommand(target:string,depth:number){
  if(!windows)return (depth===0?'/usr/bin/du -sk -- ':'/usr/bin/du -k -d 1 -- ')+shellQuote(target);
  return `$ErrorActionPreference='Stop';
    function Measure-Tree($item){
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return [long]0};
      if(-not $item.PSIsContainer){return [long]$item.Length};
      [long]$bytes=0;
      foreach($child in Get-ChildItem -LiteralPath $item.FullName -Force){$bytes+=Measure-Tree $child};
      return $bytes
    };
    $root=Get-Item -LiteralPath ${shellQuote(target)} -Force;
    ${depth===1?`foreach($entry in Get-ChildItem -LiteralPath $root.FullName -Force -Directory){
      '{0} {1}' -f [math]::Ceiling((Measure-Tree $entry)/1024),$entry.FullName
    };`:''}
    '{0} {1}' -f [math]::Ceiling((Measure-Tree $root)/1024),$root.FullName`;
}
