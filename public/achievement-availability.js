'use strict';
(function(root){
  function classify(row,{method='web',allowActivation=true}={}){
    const c=row.compatibility||{},p=row.progressSupport||{};
    const result=(status,label,reason,action=null)=>({status,label,reason,action,canAttempt:Boolean(action)&&allowActivation,provisional:Boolean(action)});
    if(row.unlocked===true)return method==='protocol'&&(c.validatedOnAccount===true||row.lastWriteOutcome==='confirmed')?result('confirmed','Confirmed on this account','A recorded activation and the current Steam reading confirm this achievement.'):result('unlocked','Already unlocked','Steam reports this achievement unlocked. This does not establish that this panel activated it.');
    if(method!=='protocol')return result('unknown','Compatibility unknown','Choose Direct verification to inspect Steam permissions and progress requirements.');
    if(c.status==='steam_rejected')return result('rejected','Steam rejected the attempt',c.reason||'Steam rejected a previous attempt; the exact restriction is not established.');
    if(['pending_verification','attempted'].includes(c.status))return result('review','Previous attempt needs review',c.reason||'Refresh and review the recorded attempt. No automatic retry is permitted.');
    if(c.code==='history_unavailable')return result('unknown','Activation temporarily blocked',c.reason);
    if(row.serverControlled||c.code==='server_controlled'||['protected_progress','protected_progress_stat'].includes(p.code))return result('protected','Protected by Steam permissions',p.reason||c.reason||'The returned permissions do not allow this client operation.');
    if(c.status==='restricted')return result('unsupported','Unsupported write permissions',c.reason);
    if(c.status==='insufficient_data')return result('unknown','Compatibility unknown',c.reason||'Steam did not provide sufficient verified definitions and personal state.');
    if(row.unlocked!==false)return result('unknown','Compatibility unknown',c.reason||'Steam did not return a verified locked personal state.');
    if(row.hasProgressDependency){
      if(p.canPreviewFloat===true)return result('review','Decimal counter: read-only preview',p.reason);
      if(p.canComplete===true)return result('progress','Progress eligible for preview',p.reason||'The current schema supports a single-counter preview. Steam must still accept and verify the update.','progress');
      if(p.canPreviewShared===true)return row.sharedSupport?.canComplete===true?result('progress','Shared progress eligible after review','The reviewed effects and persistent reservations allow an attempt. Steam must still accept and verify every effect.','shared'):result('review','Shared counter: review required',p.reason||'Review every related effect and persistent reservation availability before a shared update.');
      if(['complex_progress','unsupported_progress_type','aggregated_progress','progress_bounds','shared_progress_stat','shared_float_progress','float_progress_bounds'].includes(p.code))return result('unsupported','Progress not supported yet',p.reason);
      return result('unknown','Progress compatibility unknown',p.reason||c.reason||'The linked progress counter has not been verified.');
    }
    if(c.canUnlock===true)return result('eligible','Eligible to attempt',c.reason||'Eligible according to the current schema, not guaranteed until Steam accepts and verifies the write.','unlock');
    return result('unknown','Compatibility unknown',c.reason||'Steam has not provided sufficient compatibility information.');
  }
  if(typeof module==='object'&&module.exports)module.exports={classify};
  else root.AchievementAvailability={classify};
})(typeof globalThis!=='undefined'?globalThis:this);
