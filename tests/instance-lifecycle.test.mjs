import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {instanceStatus, runtimePaths, stopInstance} from '../dist/src/instance-runtime.js';
import {atomicPrivate, availablePort, createInstance, instanceConfigSchema, instancePaths, loadInstanceConfig, patchInstanceConfig} from '../dist/src/instance-store.js';
import {controlPaths} from '../dist/src/global-core-control.js';
import {controlRoot, createPrivateDirectory} from '../dist/src/platform.js';

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function waitFor(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(25); }
  throw Error('Timed out waiting for fixture condition');
}
async function fixture(t, settings = {}) {
  const home = await mkdtemp(path.join(await realpath(tmpdir()), 'starmux-lifecycle-'));
  const project = path.join(home, 'project');
  await mkdir(project, {mode: 0o700});
  await writeFile(path.join(project, 'fixture.json'), JSON.stringify(settings));
  const port = await freePort();
  const instance = await createInstance('fixture', {config: instanceConfigSchema.parse({
    schemaVersion: 1, projectRoot: project, port
  })}, home);
  const children = [];
  createPrivateDirectory(controlRoot());
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    await waitFor(() => children.every(child => child.exitCode !== null || child.signalCode !== null), 2500).catch(() => {});
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
    // Only remove records allocated for this test's UUID and port. Never reset the shared control root.
    await rm(runtimePaths(instance.id).root, {recursive: true, force: true});
    const lease = controlPaths(port);
    try {
      const owner = JSON.parse(await readFile(lease.meta, 'utf8'));
      if (children.some(child => child.pid === owner.pid)) await rm(lease.lock, {recursive: true, force: true});
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rm(home, {recursive: true, force: true});
  });
  async function start() {
    const child = fork(new URL('./fixtures/instance-supervisor.mjs', import.meta.url), [home, instance.id], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error('Supervisor readiness timed out: ' + output)), 15000);
      const ready = message => { if (message?.type === 'ready') finish(); };
      const exit = () => finish(Error('Supervisor exited before ready: ' + output));
      const finish = error => {
        clearTimeout(timer); child.off('message', ready); child.off('exit', exit);
        if (error) reject(error); else resolve();
      };
      child.on('message', ready); child.once('exit', exit); child.once('error', finish);
    });
    return child;
  }
  return {home, project, port, instance, start};
}
async function writeOwner(instance, overrides = {}) {
  const paths = runtimePaths(instance.id);
  createPrivateDirectory(paths.root);
  const owner = {
    protocolVersion: 1, instanceId: instance.id, port: (await loadInstanceConfig(instance)).config.port, runId: randomBytes(16).toString('hex'),
    pid: process.pid, token: randomBytes(32).toString('hex'), launcher: 'cli', appParentPid: null,
    ...overrides
  };
  await atomicPrivate(paths.meta, JSON.stringify(owner));
  return owner;
}

test('start, confirmed stop, repeated stop, and restart use distinct runs', async t => {
  const f = await fixture(t);
  await f.start();
  const running = await instanceStatus(f.instance, f.home);
  assert.equal(running.phase, 'running');
  assert.equal(running.health, 'ok');
  assert.equal(running.active.config.port, f.port);
  const stopped = await stopInstance(f.instance, f.home);
  assert.equal(stopped.result, 'STOPPED');
  assert.equal(stopped.restarted, false);
  assert.equal(await availablePort(f.port), true);
  assert.equal((await instanceStatus(f.instance, f.home)).phase, 'stopped');
  assert.equal((await stopInstance(f.instance, f.home)).result, 'ALREADY_STOPPED');
  await f.start();
  const restarted = await instanceStatus(f.instance, f.home);
  assert.equal(restarted.phase, 'running');
  assert.notEqual(restarted.runtime.runId, running.runtime.runId);
  await stopInstance(f.instance, f.home);
});

test('occupied configured port without control is unknown, and down refuses success', async t => {
  const f = await fixture(t);
  const blocker = createServer();
  await listen(blocker, f.port);
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'unknown');
  assert.ok(status.runtimeProblem);
  await assert.rejects(stopInstance(f.instance, f.home));
  assert.equal(await availablePort(f.port), false);
});

test('historical configuration and error never masquerade as live state', async t => {
  const f = await fixture(t);
  const loaded = await loadInstanceConfig(f.instance);
  const active = {config: loaded.config, revision: loaded.revision, effectiveRevision: loaded.effectiveRevision, sourcePath: loaded.source.path};
  const paths = instancePaths(f.instance, f.home);
  await atomicPrivate(path.join(paths.snapshots, 'active.json'), JSON.stringify(active));
  await atomicPrivate(path.join(paths.snapshots, 'last-runtime.json'), JSON.stringify({
    protocolVersion: 1, instanceId: f.instance.id, runId: randomBytes(16).toString('hex'), pid: 12345,
    launcher: 'cli', appParentPid: null, phase: 'error', port: null, active,
    problem: 'OLD_START_FAILURE', coreProgram: 'fixture', buildVersion: 'fixture'
  }));
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'stopped');
  assert.equal(status.active, null);
  assert.equal(status.runtimeProblem, null);
  assert.equal(status.lastActive.config.port, f.port);
  assert.equal(status.lastRun.problem, 'OLD_START_FAILURE');
});

test('unsupported owner protocol is unknown and cannot be stopped', async t => {
  const f = await fixture(t);
  await writeOwner(f.instance, {protocolVersion: 999});
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'unknown');
  assert.match(status.runtimeProblem, /PROTOCOL/i);
  await assert.rejects(stopInstance(f.instance, f.home), /PROTOCOL/i);
});

test('live owner with missing socket is unknown, not stopped', async t => {
  const f = await fixture(t);
  await writeOwner(f.instance);
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'unknown');
  assert.ok(status.runtimeProblem);
  await assert.rejects(stopInstance(f.instance, f.home));
  assert.equal(isAlive(process.pid), true);
});

test('two concurrent stop callers confirm the same shutdown', async t => {
  const f = await fixture(t, {stopDelay: 250});
  await f.start();
  const results = await Promise.all([stopInstance(f.instance, f.home), stopInstance(f.instance, f.home)]);
  for (const result of results) assert.equal(result.result, 'STOPPED');
  assert.equal(results[0].runId, results[1].runId);
  assert.equal(await availablePort(f.port), true);
});

test('stop acknowledgement is not success when cleanup exceeds caller deadline', async t => {
  const f = await fixture(t, {stopDelay: 800});
  await f.start();
  await assert.rejects(stopInstance(f.instance, f.home, {timeoutMs: 100}), /TIMEOUT/i);
  assert.equal(await availablePort(f.port), false);
  await waitFor(async () => (await instanceStatus(f.instance, f.home)).phase === 'stopped');
  assert.equal(await availablePort(f.port), true);
});

test('unresponsive worker is terminated before stop reports success', {timeout: 20000}, async t => {
  const f = await fixture(t, {ignoreStop: true});
  await f.start();
  const pid = Number(await readFile(path.join(f.project, 'worker.pid'), 'utf8'));
  const result = await stopInstance(f.instance, f.home);
  assert.equal(result.result, 'STOPPED');
  assert.equal(isAlive(pid), false);
  assert.equal(await availablePort(f.port), true);
});

test('supervisor death closes the worker and allows safe stale-record recovery', async t => {
  const f = await fixture(t);
  const supervisor = await f.start();
  const before = await instanceStatus(f.instance, f.home);
  const workerPid = Number(await readFile(path.join(f.project, 'worker.pid'), 'utf8'));
  const exited = once(supervisor, 'exit');
  supervisor.kill('SIGKILL');
  await exited;
  await waitFor(() => !isAlive(workerPid));
  await waitFor(async () => (await instanceStatus(f.instance, f.home)).phase === 'stopped');
  await f.start();
  const recovered = await instanceStatus(f.instance, f.home);
  assert.equal(recovered.phase, 'running');
  assert.notEqual(recovered.runtime.runId, before.runtime.runId);
  await stopInstance(f.instance, f.home);
});

test('malformed control metadata is preserved and reported as unknown', async t => {
  const f = await fixture(t);
  const paths = runtimePaths(f.instance.id);
  createPrivateDirectory(paths.root);
  await atomicPrivate(paths.meta, '{broken json');
  assert.equal((await instanceStatus(f.instance, f.home)).phase, 'unknown');
  await assert.rejects(stopInstance(f.instance, f.home));
  assert.equal(await readFile(paths.meta, 'utf8'), '{broken json');
});


test('saved changes remain pending while active configuration describes the live worker', async t => {
  const f = await fixture(t);
  await f.start();
  const nextPort = await freePort();
  const loaded = await loadInstanceConfig(f.instance);
  await patchInstanceConfig(f.instance, {port: nextPort}, loaded.revision, f.home);
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'running');
  assert.equal(status.configState, 'pending');
  assert.equal(status.active.config.port, f.port);
  assert.equal(status.saved.config.port, nextPort);
  await stopInstance(f.instance, f.home);
  const stopped = await instanceStatus(f.instance, f.home);
  assert.equal(stopped.active, null);
  assert.equal(stopped.lastActive.config.port, f.port);
  assert.equal(stopped.saved.config.port, nextPort);
});

test('live port lease without an instance socket is unknown even on a free port', async t => {
  const f = await fixture(t);
  const lease = controlPaths(f.port);
  createPrivateDirectory(lease.lock);
  await atomicPrivate(lease.meta, JSON.stringify({version:1,port:f.port,pid:process.pid,launcher:'cli',
    runId:randomBytes(16).toString('hex'),token:randomBytes(24).toString('hex')}));
  t.after(() => rm(lease.lock, {recursive:true,force:true}));
  assert.equal(await availablePort(f.port), true);
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'unknown');
  assert.match(status.runtimeProblem, /live port lease/);
  await assert.rejects(stopInstance(f.instance, f.home));
});

test('resource cleanup failure is reported instead of a successful stop', async t => {
  const f = await fixture(t);
  await f.start();
  const lease = controlPaths(f.port);
  // Model a resource the lease cannot remove, without changing any production permissions.
  await mkdir(path.join(lease.lock,'unexpected-directory'));
  await assert.rejects(stopInstance(f.instance, f.home, {timeoutMs:5000}), /STOP_FAILED/);
  const status = await instanceStatus(f.instance, f.home);
  assert.equal(status.phase, 'error');
  assert.match(status.runtime.problem, /STOP_FAILED/);
  assert.equal(await availablePort(f.port), true);
});
