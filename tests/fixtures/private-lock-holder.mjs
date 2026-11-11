import {once} from 'node:events';
import {withPrivateLock} from '../../dist/src/private-store-lock.js';

await withPrivateLock(process.argv[2],async()=>{
  process.send({type:'locked'});
  await once(process,'message');
});
process.disconnect();
