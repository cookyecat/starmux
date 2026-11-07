import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import test from 'node:test';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {mcpHttpBodyLimit} from '../dist/src/mcp-http-limits.js';

for (const chunked of [false, true]) {
  test('MCP rejects oversized ' + (chunked ? 'chunked' : 'content-length') + ' bodies before protocol handling', async t => {
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true, maxRequestBodySize: mcpHttpBodyLimit
    });
    const server = createServer((req, res) => {
      void transport.handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      await transport.close();
      await new Promise(resolve => server.close(resolve));
    });
    const body = JSON.stringify({jsonrpc:'2.0', id:1, method:'ping', params:{padding:'x'.repeat(mcpHttpBodyLimit)}});
    const status = await new Promise((resolve,reject) => {
      const req = request({
        hostname:'127.0.0.1', port:server.address().port, method:'POST', path:'/mcp',
        headers:{'content-type':'application/json',accept:'application/json, text/event-stream',
          ...(chunked ? {'transfer-encoding':'chunked'} : {'content-length':Buffer.byteLength(body)})}
      }, res => {res.resume();res.on('end',()=>resolve(res.statusCode));});
      req.on('error',reject);
      req.write(body.slice(0,100));req.end(body.slice(100));
    });
    assert.equal(status, 413);
  });
}
