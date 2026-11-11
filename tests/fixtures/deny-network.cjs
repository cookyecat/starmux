// Record attempts before throwing: telemetry often swallows transport failures.
// Loaded only in the isolated Desktop Commander regression-test subprocess.
const {appendFileSync} = require('node:fs');
const {syncBuiltinESMExports} = require('node:module');
function deny(api) {
  return function () {
    appendFileSync(process.env.STARMUX_TEST_NETWORK_LOG, api + '\n');
    throw new Error('TEST_NETWORK_FORBIDDEN: ' + api);
  };
}
for (const name of ['http', 'https']) {
  const module = require('node:' + name);
  for (const method of ['request', 'get']) module[method] = deny(name + '.' + method);
}
require('node:net').Socket.prototype.connect = deny('net.Socket.connect');
require('node:tls').connect = deny('tls.connect');
require('node:dgram').Socket.prototype.send = deny('dgram.send');
globalThis.fetch = deny('fetch');
globalThis.WebSocket = deny('WebSocket');
syncBuiltinESMExports();
