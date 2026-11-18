import {randomBytes} from 'node:crypto';

export interface ConnectionVerification {
  code:string;
  toolName:string|null;
  localVerifiedAt:string|null;
  targetVerifiedAt:string|null;
}

export function createConnectionVerification(){
  const code=randomBytes(8).toString('hex');
  let localVerifiedAt:string|null=null;
  let targetVerifiedAt:string|null=null;
  return {
    code,
    snapshot:(toolName:string|null):ConnectionVerification=>({code,toolName,localVerifiedAt,targetVerifiedAt}),
    complete(kind:'local'|'target'){
      const at=new Date().toISOString();
      if(kind==='local')localVerifiedAt=at;
      else targetVerifiedAt??=at;
    }
  };
}
