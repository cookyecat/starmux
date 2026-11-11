import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ListResourceTemplatesRequestSchema,ReadResourceRequestSchema,ListPromptsRequestSchema,GetPromptRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const marker=process.argv[2]??'first';
const server=new Server({name:'gateway-upgrade-fixture',version:'1'},{capabilities:{tools:{},resources:{},prompts:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['echo','wait','ask','progress'].map(name=>({name,inputSchema:{type:'object'},...(name==='echo'?{_meta:{ui:{resourceUri:'ui://fixture/app.html'}}}:{})}))}));
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
 const {name,arguments:args={}}=request.params;
 if(name==='wait')await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,args.delay??120);extra.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});
 if(name==='ask'&&args.kind==='roots'){const result=await server.listRoots();return {content:[{type:'text',text:result.roots[0].uri}]};}
 if(name==='ask'&&args.kind==='elicitation'){const result=await server.elicitInput({mode:'form',message:'Fixture input',requestedSchema:{type:'object',properties:{answer:{type:'string'}}}});return {content:[{type:'text',text:result.content.answer}]};}
 if(name==='ask'){
  const response=await server.createMessage({messages:[{role:'user',content:{type:'text',text:'Which client?'}}],maxTokens:32});
  return {content:[response.content]};
 }
 if(name==='progress'&&request.params._meta?.progressToken!==undefined){await extra.sendNotification({method:'notifications/progress',params:{progressToken:request.params._meta.progressToken,progress:1,total:2}});await new Promise(r=>setTimeout(r,40));}
 return {content:[{type:'text',text:marker}],structuredContent:{marker,args},_meta:{fixture:true}};
});
server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:'ui://fixture/app.html',name:'app',mimeType:'text/html'}]}));
server.setRequestHandler(ListResourceTemplatesRequestSchema,async()=>({resourceTemplates:[{uriTemplate:'fixture://docs/{name}',name:'docs'}]}));
server.setRequestHandler(ReadResourceRequestSchema,async r=>({contents:[{uri:r.params.uri,mimeType:'text/plain',text:marker}]}));
server.setRequestHandler(ListPromptsRequestSchema,async()=>({prompts:[{name:'hello'}]}));
server.setRequestHandler(GetPromptRequestSchema,async()=>({messages:[{role:'user',content:{type:'text',text:marker}}]}));
await server.connect(new StdioServerTransport());
