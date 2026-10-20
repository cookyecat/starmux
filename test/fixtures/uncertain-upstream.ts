import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { appendFile } from 'node:fs/promises';
const marker = process.argv[2];
if (!marker) throw Error('MARKER_REQUIRED');
const server = new Server({name:'uncertain-fixture',version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async()=>({tools:[{name:'write',inputSchema:{type:'object'}}]}));
server.setRequestHandler(CallToolRequestSchema,async()=>{
  await appendFile(marker,'executed\n');
  process.exit(0); // side effect committed, response lost
});
await server.connect(new StdioServerTransport());
