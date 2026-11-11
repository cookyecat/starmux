import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUserError,withErrorGuidance} from '../dist/src/user-feedback.js';

test('actionable guidance preserves diagnostic details and handles localized conflict and timeout semantics',()=>{
 const original='CONFIG_REVISION_CONFLICT: revision changed';
 assert.ok(formatUserError(original,'zh').startsWith(original+'\n'));
 assert.match(formatUserError(original,'zh'),/复制保留未保存/);
 assert.match(formatUserError('INSTANCE_STOP_TIMEOUT'),/may still be running/);
 assert.match(formatUserError('MIDDLEWARE_TIMEOUT','zh'),/核实实际结果/);
 assert.equal(formatUserError('UNRECOGNIZED_ERROR: detail'),'UNRECOGNIZED_ERROR: detail');
 assert.equal(formatUserError('An existing useful explanation.'),'An existing useful explanation.');
});
test('structured failure results retain codes, IDs and state without mutating originals',()=>{
 const original={results:[{id:'remote',status:'UNAVAILABLE',error:'UPSTREAM_AUTH_REQUIRED'}],application:'pending',error:'GATEWAY_APPLY_TIMEOUT'};
 const enriched=withErrorGuidance(original);
 assert.equal(enriched.error,original.error);assert.equal(enriched.application,'pending');assert.ok(enriched.hint);
 assert.equal(enriched.results[0].id,'remote');assert.equal(enriched.results[0].error,'UPSTREAM_AUTH_REQUIRED');assert.match(enriched.results[0].hint,/credentials/);
 assert.equal(original.hint,undefined);assert.equal(original.results[0].hint,undefined);
 assert.deepEqual(withErrorGuidance({config:{error:'PORT_IN_USE'}}),{config:{error:'PORT_IN_USE'}});
});

 test('application feedback distinguishes active, deferred, failed and unknown states in both languages',async()=>{
 const {applicationFeedback}=await import('../dist/src/user-feedback.js');
 for(const language of ['en','zh']){
  assert.equal(applicationFeedback({application:'applied'},language).error,false);
  const deferred=applicationFeedback({application:'on-next-start'},language);
  assert.equal(deferred.error,false);assert.match(deferred.message,/when this instance starts|实例启动时/);
  for(const application of ['pending','unknown',undefined]){
   const feedback=applicationFeedback({application,error:'GATEWAY_APPLY_TIMEOUT'},language);
   assert.equal(feedback.error,true);assert.match(feedback.message,/GATEWAY_APPLY_TIMEOUT/);
   assert.doesNotMatch(feedback.message,/Saved and applied|已保存并应用/);
  }
  assert.equal(applicationFeedback({},language).error,true);
 }
});
