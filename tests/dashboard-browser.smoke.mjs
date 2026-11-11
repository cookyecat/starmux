// Run after npm run build. CI installs Playwright; local runs may provide its module path.
import assert from 'node:assert/strict';
import {parse} from 'jsonc-parser';
import {mkdtemp,realpath,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
const {chromium}=await import(process.env.STARMUX_PLAYWRIGHT_MODULE||'playwright');
const home=await realpath(await mkdtemp(path.join(tmpdir(),'starmux-browser-')));
await mkdir(path.join(home,'project'));
const manager=fork(new URL('../dist/src/cli/dashboard-worker.js',import.meta.url),[],{env:{...process.env,HOME:home,USERPROFILE:home},stdio:['ignore','ignore','inherit','ipc']});
let browser;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('manager timeout')),15000);manager.once('message',()=>{clearTimeout(timer);resolve();});manager.once('exit',()=>{clearTimeout(timer);reject(Error('manager exited'));});});
 const record=JSON.parse(await readFile(path.join(home,'.config/starmux/dashboard/manager.json'),'utf8'));const base=`http://127.0.0.1:${record.port}`;
 const response=await fetch(base+'/api/v1/instances',{method:'POST',headers:{authorization:'Bearer '+record.token,origin:base,'content-type':'application/json'},body:JSON.stringify({name:'Design workspace',config:{schemaVersion:1,projectRoot:path.join(home,'project'),port:19879}})});assert.equal(response.status,200);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#token='+record.token);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'');
 await mkdir('.internal/playwright',{recursive:true});await page.screenshot({path:'.internal/playwright/dashboard-light.png',fullPage:true});
 await page.locator('#theme').selectOption('dark');await page.screenshot({path:'.internal/playwright/dashboard-dark.png',fullPage:true});
 await page.locator('[data-page="config"]').click();await page.locator('#draft').waitFor();const original=await page.locator('#draft').inputValue();await page.locator('#draft').fill(original+'\n// retained comment');await page.locator('[data-action="validate"]').click();await page.locator('#diff:not([hidden])').waitFor();assert.match(await page.locator('#draft').inputValue(),/retained comment/);
 assert.doesNotMatch(original,/gitMode|worktreeMode/);assert.equal(await page.locator('#config-warnings').isHidden(),true);
 const configured={...parse(original),mode:'read-write',accessRole:'trusted',gitMode:'review',worktreeMode:'linked'};
 await page.locator('#draft').fill(JSON.stringify(configured,null,2)+'\n// retained compatibility values');
 await page.locator('[data-action="validate"]').click();
 await page.getByText(/Git remains available through the terminal/).waitFor();
 assert.match(await page.locator('#config-warnings').textContent(),/worktreeMode/);
 await page.locator('#language').selectOption('zh');await page.getByText(/AI 仍可通过终端执行 Git/).waitFor();
 assert.match(await page.locator('#draft').inputValue(),/retained compatibility values/);
 await page.screenshot({path:'.internal/playwright/config-ignored-zh.png',fullPage:true});
 page.on('dialog',d=>d.accept());
 await page.locator('[data-action="save"]').click();await page.getByText('已保存；应用后更新运行实例。',{exact:true}).waitFor();
 assert.match(await page.locator('#draft').inputValue(),/"gitMode": "review"/);
 assert.equal(await page.locator('#config-warnings').isVisible(),true);
 await page.locator('#draft').fill(original);await page.locator('[data-action="validate"]').click();await page.locator('#diff:not([hidden])').waitFor();
 // Returning to the simple configuration clears notices and requires no extra confirmation.
 await page.locator('[data-action="save"]').click();await page.getByText('已保存；应用后更新运行实例。',{exact:true}).waitFor();
 assert.equal(await page.locator('#config-warnings').isHidden(),true);
 await page.locator('#language').selectOption('en');
 await page.locator('[data-page="access"]').click();await page.getByText('Create credential',{exact:true}).click();await page.locator('[name="name"]').fill('Browser credential');await page.locator('[data-action="create-key"]').click();await page.locator('#new-key code').waitFor();assert.match(await page.locator('#new-key code').textContent(),/^smx_/);
 // Test each address using a deterministic LAN/public access response and captured clipboard.
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedConfiguration=text;}}});});
 const urls=['http://127.0.0.1:19879/mcp','http://192.168.50.114:19879/mcp','https://mcp.example.test/mcp'];
 await page.route('**/api/v1/instances/*/access',async route=>{
   const response=await route.fetch();const body=await response.json();
   await route.fulfill({response,json:{...body,mode:'api-key',urls}});
 });
 await page.locator('[data-page="overview"]').click();await page.locator('[data-page="access"]').click();
 for(const url of urls){
   await page.locator('[data-copy-config]').filter({hasText:'Copy configuration'}).nth(urls.indexOf(url)).click();
   const config=JSON.parse(await page.evaluate(()=>window.copiedConfiguration));
   assert.equal(config.mcpServers.starmux.url,url);
   assert.equal(config.mcpServers.starmux.headers.Authorization,'Bearer <YOUR_API_KEY>');
 }
 await page.unroute('**/api/v1/instances/*/access');
 await page.locator('#language').selectOption('zh');await page.getByRole('heading',{name:'连接与访问',exact:true}).waitFor();assert.equal(await page.locator('#new-key').textContent(),'');
 let calls={available:true,detailed:false,entries:[{id:'one',tool:'read_file',route:'desktop',at:new Date().toISOString(),status:'complete',durationMs:12},{id:'two',tool:'extra__write',route:'extra',at:new Date().toISOString(),status:'uncertain',durationMs:321,code:'UPSTREAM_CALL_UNCERTAIN',details:{arguments:'{"path":"<img src=x onerror=alert(1)>"}',result:'{"error":"UPSTREAM_CALL_UNCERTAIN"}'}}]};
 await page.route('**/api/v1/instances/*/calls',async route=>{
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();if(body.op==='details')calls.detailed=body.enabled;if(body.op==='clear')calls.entries=[];}
   await route.fulfill({json:calls});
 });
 await page.locator('[data-page="logs"]').click();await page.getByText('read_file',{exact:true}).waitFor();
 await page.locator('[data-id="one"] summary').click();await page.getByText(/此调用仅有摘要/).waitFor();
 await page.locator('[data-action="call-details"]').click();await page.getByText('关闭详细记录',{exact:true}).waitFor();
 await page.locator('[data-id="two"] summary').click();assert.equal(await page.locator('#call-list img').count(),0);
 await page.screenshot({path:'.internal/playwright/tool-calls-zh.png',fullPage:true});
 await page.locator('#call-status').selectOption('error');assert.equal(await page.locator('#call-list details').count(),1);
 await page.locator('#call-search').fill('missing');assert.equal(await page.locator('#call-list details').count(),0);
 await page.locator('#call-search').fill('');await page.locator('#call-status').selectOption('all');
 await page.locator('[data-action="show-system"]').click();await page.locator('#log-kind').waitFor();
 await page.locator('[data-action="show-calls"]').click();await page.locator('[data-id="two"]').waitFor();
 await page.locator('[data-page="servers"]').click();await page.locator('[name="serverId"]').fill('browser-fixture');
 await page.locator('[name="serverInput"]').fill(JSON.stringify({command:process.execPath,args:[path.resolve('tests/fixtures/gateway-upstream.mjs'),'browser']}));
 await page.locator('[data-action="server-preview"]').click();await page.waitForFunction(()=>document.querySelector('#server-preview')?.textContent.includes('previewId'));
 await page.locator('[data-action="server-test-preview"]').click();await page.waitForFunction(()=>document.querySelector('#server-preview')?.textContent.includes('READY'));
 await page.locator('[data-action="server-save"]').click();await page.locator('[data-server-test="browser-fixture"]').waitFor();
 await page.screenshot({path:'.internal/playwright/gateway-servers-zh.png',fullPage:true});
 await page.locator('[data-server-toggle="browser-fixture"]').click();await page.waitForFunction(()=>document.querySelector('[data-server-toggle="browser-fixture"]')?.getAttribute('data-enabled')==='false');
 await page.locator('[data-server-remove="browser-fixture"]').click();await page.locator('[data-server-test="browser-fixture"]').waitFor({state:'detached'});
 await page.locator('[data-page="middlewares"]').click();await page.locator('[name="middlewareId"]').fill('defaults');await page.locator('[name="middlewareOptions"]').fill('{"defaults":{"example":"value"}}');
 await page.locator('[data-action="middleware-save"]').click();await page.locator('[data-middleware-edit="defaults"]').waitFor();
 await page.locator('[data-action="middleware-test"]').click();await page.waitForFunction(()=>document.querySelector('#middleware-result')?.textContent.includes('sampleOnly'));
 await page.screenshot({path:'.internal/playwright/gateway-middleware-zh.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.internal/playwright/gateway-middleware-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('[data-middleware-toggle="defaults"]').click();await page.waitForFunction(()=>document.querySelector('[data-middleware-toggle="defaults"]')?.textContent==='启用');
 await page.locator('[data-middleware-remove="defaults"]').click();await page.locator('[data-middleware-edit="defaults"]').waitFor({state:'detached'});
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-page="logs"]').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.internal/playwright/dashboard-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1024,height:900});await page.screenshot({path:'.internal/playwright/dashboard-tablet.png',fullPage:true});await page.locator('[data-action="call-clear"]').click();await page.getByText(/暂无匹配调用/).waitFor();assert.deepEqual(errors,[]);console.log('Browser smoke passed: themes, bilingual UI, config draft, key creation, responsive layout.');
}finally{await browser?.close();manager.kill();await new Promise(r=>manager.exitCode!==null?r():manager.once('exit',r));await rm(home,{recursive:true,force:true});}
