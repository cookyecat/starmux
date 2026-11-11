import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=process.env.STARMUX_TEST_VENDOR_ROOT??path.join(root,'dist/vendor/desktop-commander');
const guard=fileURLToPath(new URL('fixtures/deny-network.cjs',import.meta.url));
const execute=promisify(execFile);
async function fixture(t){
  await mkdir(path.join(root,'.internal'),{recursive:true});
  const home=await mkdtemp(path.join(root,'.internal/vendor-telemetry-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const log=path.join(home,'network-attempts.log');await writeFile(log,'');
  return {home,log,env:{...process.env,HOME:home,USERPROFILE:home,
    DESKTOP_COMMANDER_DISABLE_TELEMETRY:'0',STARMUX_TEST_NETWORK_LOG:log}};
}

test('vendored assets contain no upstream collectors, installers, or cloud relay',async()=>{
  const manifest=JSON.parse(await readFile(path.join(vendor,'package.json'),'utf8'));
  assert.equal(manifest.scripts,undefined);
  for(const name of ['remote-device','npm-scripts','track-installation.js','setup-claude-server.js','uninstall-claude-server.js']){
    await assert.rejects(access(path.join(vendor,'dist',name)),{code:'ENOENT'});
  }
  // Include HTML/CSS and minified widget bundles, not just server-side modules.
  for(const relative of await readdir(vendor,{recursive:true})){
    if(!/\.(js|json|html|css)$/.test(relative))continue;
    const text=await readFile(path.join(vendor,relative),'utf8');
    assert.doesNotMatch(text,/desktopcommander\.app|dc-telemetry-proxy|tally\.so|supabase|posthog|sentry\.io|google-analytics\.com/i,relative);
  }
});

test('telemetry and feature-flag entrypoints remain offline with telemetry enabled',{timeout:15000},async t=>{
  const {home,log,env}=await fixture(t);
  // Positive control: a swallowed network error must still be observable.
  await execute(process.execPath,['--require',guard,'--input-type=module','--eval',
    "try { await fetch('https://example.invalid'); } catch {}"],{env});
  assert.equal(await readFile(log,'utf8'),'fetch\n');await writeFile(log,'');
  const base=pathToFileURL(path.join(vendor,'dist')+path.sep).href;
  await execute(process.execPath,['--require',guard,'--input-type=module','--eval',`
    import assert from 'node:assert/strict';
    const capture=await import(${JSON.stringify(base)}+'utils/capture.js');
    assert.equal(capture.isTelemetryDisabledByEnv(),true);
    await capture.captureBase('https://example.invalid','test',{});
    for(const name of ['capture','captureTransport','capture_call_tool','capture_ui_event','captureRemote'])await capture[name]('test',{});
    const {featureFlagManager:flags}=await import(${JSON.stringify(base)}+'utils/feature-flags.js');
    await flags.initialize();await flags.refresh();await flags.waitForFreshFlags();
    assert.deepEqual(flags.getAll(),{});flags.destroy();
    const {openBrowser,openWelcomePage}=await import(${JSON.stringify(base)}+'utils/open-browser.js');
    await openBrowser('https://example.invalid');await openWelcomePage();
    const {usageTracker}=await import(${JSON.stringify(base)}+'utils/usageTracker.js');
    assert.equal(await usageTracker.shouldPromptForFeedback(),false);
    assert.equal(await usageTracker.shouldPromptForErrorFeedback(),false);
    assert.equal((await usageTracker.getFeedbackPromptMessage()).message,'');
    process.exit(0);
  `],{env,cwd:home,timeout:10000});
  assert.equal(await readFile(log,'utf8'),'');
});

test('real vendored MCP startup, tools, UI events and errors make no network attempts',{timeout:25000},async t=>{
  const {home,log,env}=await fixture(t);
  await mkdir(path.join(home,'.claude-server-commander'));
  // Model a pre-existing upstream installation with telemetry explicitly on.
  await writeFile(path.join(home,'.claude-server-commander/config.json'),JSON.stringify({telemetryEnabled:true,allowedDirectories:[home]}));
  const client=new Client({name:'offline-telemetry-regression',version:'1'},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--require',guard,path.join(vendor,'dist/index.js')],env,cwd:home,stderr:'pipe'});
  try{
    await client.connect(transport);transport.stderr?.resume();
    assert.ok((await client.listTools()).tools.length>0);
    const call=(name,args={})=>client.callTool({name,arguments:args});
    const config=await call('get_config');
    assert.equal(config.structuredContent.config.telemetryEnabled,true);
    const file=path.join(home,'中文.txt'),content='“我”🙂\n';
    assert.notEqual((await call('write_file',{path:file,content})).isError,true);
    assert.equal(await readFile(file,'utf8'),content);
    assert.notEqual((await call('read_file',{path:file})).isError,true);
    assert.equal((await call('read_file',{path:path.join(home,'missing.txt')})).isError,true);
    assert.notEqual((await call('track_ui_event',{event:'preview_opened',component:'file_preview'})).isError,true);
    const feedback=await call('give_feedback_to_desktop_commander');
    assert.match(JSON.stringify(feedback),/disabled in Starmux/);
    for(const value of [false,true])assert.notEqual((await call('set_config_value',{key:'telemetryEnabled',value})).isError,true);
    for(const resource of (await client.listResources()).resources){
      const html=await client.readResource({uri:resource.uri});
      assert.match(html.contents[0].text,/connect-src 'none'/);
    }
  }finally{await client.close();await transport.close();}
  assert.equal(await readFile(log,'utf8'),'','Including errors caught internally by upstream');
});
