import {createInterface} from 'node:readline';
import {writeFile} from 'node:fs/promises';

const [mode,pidFile]=process.argv.slice(2);
await writeFile(pidFile,String(process.pid));
// Exercise cleanup even for children which ignore graceful shutdown.
if(mode==='stubborn')process.on('SIGTERM',()=>{});
const lines=createInterface({input:process.stdin});
lines.on('close',()=>{if(mode!=='stubborn')process.exit();});
if(mode==='stubborn')setInterval(()=>{},1000);
for await(const line of lines){
  const request=JSON.parse(line);
  const reply=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  if(request.method==='initialize'&&!['silent','stubborn'].includes(mode)){
    if(mode==='delayed')await new Promise(resolve=>setTimeout(resolve,750));
    if(mode==='slow-catalog')await new Promise(resolve=>setTimeout(resolve,4500));
    reply({protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
  }
  if(request.method==='tools/list'&&['healthy','delayed','hanging-call'].includes(mode))reply({tools:[{name:'echo',inputSchema:{type:'object'}}]});
  if(request.method==='tools/call'&&mode!=='hanging-call')reply({content:[{type:'text',text:'healthy'}]});
}
