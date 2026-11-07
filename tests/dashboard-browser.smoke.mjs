// Run after npm run build. CI installs Playwright; local runs may provide its module path.
import assert from 'node:assert/strict';
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
 browser=await chromium.launch({headless:true,...(process.env.STARMUX_CHROMIUM_PATH?{executablePath:process.env.STARMUX_CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#token='+record.token);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'');
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/dashboard-light.png',fullPage:true});
 await page.locator('#theme').selectOption('dark');await page.screenshot({path:'output/playwright/dashboard-dark.png',fullPage:true});
 await page.locator('[data-page="config"]').click();await page.locator('#draft').waitFor();const original=await page.locator('#draft').inputValue();await page.locator('#draft').fill(original+'\n// retained comment');await page.locator('[data-action="validate"]').click();await page.locator('#diff:not([hidden])').waitFor();assert.match(await page.locator('#draft').inputValue(),/retained comment/);
 page.on('dialog',d=>d.accept());await page.locator('[data-page="access"]').click();await page.getByText('Create credential',{exact:true}).click();await page.locator('[name="name"]').fill('Browser credential');await page.locator('[data-action="create-key"]').click();await page.locator('#new-key code').waitFor();assert.match(await page.locator('#new-key code').textContent(),/^smx_/);
 await page.locator('#language').selectOption('zh');await page.getByRole('heading',{name:'连接与访问',exact:true}).waitFor();assert.equal(await page.locator('#new-key').textContent(),'');
 await page.setViewportSize({width:390,height:844});
 await page.locator('#menu').click();await page.locator('aside.open').waitFor();assert.equal(await page.locator('#menu').getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Escape');assert.equal(await page.locator('aside').evaluate(el=>el.classList.contains('open')),false);
 await page.locator('#menu').click();await page.locator('#menu-close').click();assert.equal(await page.locator('#menu').getAttribute('aria-expanded'),'false');
 await page.locator('#menu').click();await page.locator('[data-page="overview"]').click();assert.equal(await page.locator('aside').evaluate(el=>el.classList.contains('open')),false);
 await page.screenshot({path:'output/playwright/dashboard-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1024,height:900});await page.screenshot({path:'output/playwright/dashboard-tablet.png',fullPage:true});assert.deepEqual(errors,[]);console.log('Browser smoke passed: themes, bilingual UI, config draft, key creation, responsive layout.');
}finally{await browser?.close();manager.kill();await new Promise(r=>manager.exitCode!==null?r():manager.once('exit',r));await rm(home,{recursive:true,force:true});}
