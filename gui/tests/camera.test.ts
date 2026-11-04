import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, pickMimeType } from '../src/liveCapture.ts';
test('rear camera preferred without requiring specific physical hardware', async () => {
 let asked:any; const stream={} as MediaStream;
 const r=await openCamera({}, {isSecureContext:true,mediaDevices:{getUserMedia:async c=>{asked=c;return stream;}}});
 assert.equal(r.ok,true); assert.deepEqual(asked.video.facingMode,{ideal:'environment'});assert.equal(asked.audio,false);
});
test('plain mp4 supported as fallback for mobile recorders',()=>assert.equal(pickMimeType({isTypeSupported:t=>t==='video/mp4'}),'video/mp4'));
test('webm and default recorder fallback',()=>{assert.equal(pickMimeType({isTypeSupported:t=>t==='video/webm'}),'video/webm');assert.equal(pickMimeType({isTypeSupported:t=>false}),'');});
test('insecure phone URL and denied camera are actionable errors',async()=>{
 assert.equal((await openCamera({}, {isSecureContext:false})).ok,false);
 const r=await openCamera({}, {isSecureContext:true,mediaDevices:{getUserMedia:async()=>{throw {name:'NotAllowedError'};}}});
 assert.equal(r.ok,false);if(!r.ok)assert.equal(r.reason,'permission-denied');
});

import { savedClaimLabel } from '../src/probs.ts';
test('paused recap preserves multi-word saved prediction names without editing evidence',()=>{
 for (const key of ['No action','MeasureLiquid step','PhaseSeparation step']) {
  const note='UNVALIDATED model-predicted action claim: '+key+' (p=0.337) from clip run test.';
  assert.equal(savedClaimLabel(note),key==='No action'?'No action':key==='MeasureLiquid step'?'Measure liquid step':'Phase separation step');
  assert.ok(note.includes(key));
 }
});
