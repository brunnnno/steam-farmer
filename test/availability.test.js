'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{classify}=require('../public/achievement-availability');
const direct={method:'protocol'},base={unlocked:false,compatibility:{canUnlock:true,status:'provisional'}};
test('eligibility is provisional, read-only and account-limited',()=>{
  const frozen=Object.freeze({...base,compatibility:Object.freeze(base.compatibility)});
  assert.equal(classify(frozen,direct).status,'eligible');assert.equal(classify(frozen,direct).provisional,true);
  assert.equal(classify(frozen,{...direct,allowActivation:false}).canAttempt,false);
  assert.equal(classify(frozen).status,'unknown');
});
test('permissions, history and unknown personal state override optimistic eligibility',()=>{
  for(const [row,status] of [[{...base,serverControlled:true},'protected'],[{...base,unlocked:null},'unknown'],[{...base,compatibility:{...base.compatibility,status:'steam_rejected'}},'rejected'],[{...base,compatibility:{...base.compatibility,status:'pending_verification'}},'review'],[{...base,compatibility:{...base.compatibility,code:'history_unavailable'}},'unknown']]){
    const result=classify(row,direct);assert.equal(result.status,status);assert.equal(result.canAttempt,false);
  }
});
test('progress distinguishes supported exclusive counter, protection, unsupported and missing data',()=>{
  const row={...base,hasProgressDependency:true};
  for(const [progressSupport,status,canAttempt] of [[{canComplete:true},'progress',true],[{canPreviewShared:true},'review',false],[{code:'protected_progress_stat',canComplete:true},'protected',false],[{code:'complex_progress'},'unsupported',false],[{code:'progress_bounds'},'unsupported',false],[{code:'progress_value_unavailable'},'unknown',false],[{code:'insufficient_progress_data'},'unknown',false]]){
    const result=classify({...row,progressSupport},direct);assert.equal(result.status,status);assert.equal(result.canAttempt,canAttempt);
  }
});
test('an unlocked achievement is not proof of this panel granting it',()=>{
  assert.equal(classify({...base,unlocked:true},direct).status,'unlocked');
  assert.equal(classify({...base,unlocked:true,lastWriteOutcome:'confirmed'},direct).status,'confirmed');
  assert.notEqual(classify({...base,unlocked:false,lastWriteOutcome:'confirmed'},direct).status,'confirmed');
});
