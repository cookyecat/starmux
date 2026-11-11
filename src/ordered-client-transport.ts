import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {JSONRPCMessage,MessageExtraInfo} from '@modelcontextprotocol/sdk/types.js';
/** SDK notification handlers run in microtasks. Preserve notification-before-result
 * ordering even when a stdio read or SSE frame contains several messages. */
export function orderedClientTransport(inner:Transport):Transport{
 let closed=false,draining=false,bytes=0;
 const queue:{message:JSONRPCMessage;extra?:MessageExtraInfo;bytes:number}[]=[];
 const transport:Transport={
  async start(){
   inner.onclose=()=>{closed=true;queue.length=0;bytes=0;transport.onclose?.();};
   inner.onerror=error=>transport.onerror?.(error);
   inner.onmessage=(message,extra)=>{
    if(closed)return;const size=Buffer.byteLength(JSON.stringify(message));
    if(queue.length>=256||bytes+size>8388608){transport.onerror?.(Error('UPSTREAM_MESSAGE_QUEUE_LIMIT'));void transport.close();return;}
    queue.push({message,...(extra?{extra}:{}),bytes:size});bytes+=size;
    if(!draining)void drain();
   };
   await inner.start();
  },
  send:(message,options)=>inner.send(message,options),
  async close(){closed=true;queue.length=0;bytes=0;await inner.close();},
  setProtocolVersion:version=>inner.setProtocolVersion?.(version)
 };
 Object.defineProperty(transport,'sessionId',{get:()=>inner.sessionId});
 async function drain(){draining=true;try{while(!closed&&queue.length){const item=queue.shift()!;bytes-=item.bytes;transport.onmessage?.(item.message,item.extra);await Promise.resolve();}}catch(error){transport.onerror?.(error instanceof Error?error:Error('UPSTREAM_MESSAGE_FAILED'));}finally{draining=false;}}
 return transport;
}
