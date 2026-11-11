let calls=0;
export default {
 apiVersion:1,
 async request(context){
  const o=context.options;
  if(o.loop)for(;;){}
  if(o.crash)process.exit(7);
  if(o.crashAfterRequest)setTimeout(()=>process.exit(7),30);
  if(o.delay)await new Promise(r=>setTimeout(r,o.delay));
  if(o.reject)return {action:'reject',reason:'Fixture denied this call'};
  if(o.respond)return {action:'respond',result:{content:[{type:'text',text:'synthetic'}],_meta:{fixture:true}}};
  return {action:'continue',arguments:{...context.arguments,tag:o.tag??'plugin',...(o.counter?{sequence:++calls}:{})}};
 },
 response(context,result){
  if(context.options.failResponse)throw Error('fixture failure');
  return {...result,content:[...result.content,{type:'text',text:context.options.tag??'plugin'}]};
 },
 observe(context){if(context.options?.observeFailure)throw Error('observer');}
};
