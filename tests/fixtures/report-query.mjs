import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

const reports=new Map([['active',7],['archived',3]]);
const server=new McpServer({name:'reports-fixture',version:'1'});
server.registerTool('query',{inputSchema:{status:z.string()}},({status})=>({
  content:[{type:'text',text:JSON.stringify({count:reports.get(status)??0})}]
}));
server.registerTool('list_all',{annotations:{readOnlyHint:true}},()=>({
  content:[{type:'text',text:JSON.stringify([...reports])}]
}));
await server.connect(new StdioServerTransport());
