import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const project = process.env.STARMUX_PROJECT_ROOT;
const settings = JSON.parse(await readFile(path.join(project, 'fixture.json'), 'utf8'));
await writeFile(path.join(project, 'worker.pid'), String(process.pid));
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(request.url === '/activity.json' ? {lastToolCallAt: null} : {
    status: 'ok',
    instanceId: process.env.STARMUX_INSTANCE_ID,
    accessMode: 'ingress',
    allowLan: process.env.STARMUX_ALLOW_LAN === '1'
  }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.STARMUX_PROJECT_PORT), process.env.STARMUX_ALLOW_LAN === '1' ? '0.0.0.0' : '127.0.0.1', resolve);
});
let closing = false;
function close(delay = 0) {
  if (closing) return;
  closing = true;
  setTimeout(() => {
    server.close(() => { if (process.connected) process.disconnect(); });
    server.closeAllConnections();
  }, delay);
}
process.on('message', message => {
  if (message?.type === 'gateway-stop' && !settings.ignoreStop) close(settings.stopDelay ?? 0);
});
process.on('SIGTERM', () => { if (!settings.ignoreStop) close(); });
process.on('disconnect', () => close());
process.send({type: 'gateway-ready'});
