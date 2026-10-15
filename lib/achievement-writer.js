'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const { requestSnapshot, parseSnapshot } = require('./steam-protocol');
const { appId } = require('./core');
const { uint } = require('./achievement-compatibility');
const {revision,sharedPreview}=require('./achievement-progress');
const {prepareChanges,verifyChanges}=require('./achievement-changes');
const fail = (message,status=409) => Object.assign(new Error(message),{status});
function prepare(snapshot,id,apiname,{allowProgress=false,expectedRevision}={}) {
  id=appId(id);
  if(typeof apiname!=='string'||!apiname||apiname.length>256) throw fail('Select one real Steam achievement identifier.');
  const view=parseSnapshot(snapshot,id);
  const matches=view.achievements.filter(a=>a.apiname===apiname);
  if(matches.length!==1) throw fail('The selected achievement could not be identified uniquely in Steam.');
  const target=matches[0];
  if(target.unlocked===true) return {target,view,payload:null};
  if(target.unlocked!==false) throw fail('Steam did not verify the initial achievement state.');
  if(allowProgress&&(!target.hasProgressDependency||!target.progressSupport?.canComplete))throw Object.assign(fail(target.progressSupport?.reason||'This achievement does not have supported progress.'),{diagnostic:{code:target.progressSupport?.code||'unsupported_progress'}});
  if(allowProgress&&expectedRevision!==undefined&&expectedRevision!==revision(snapshot,id,apiname))throw fail('Steam data changed after the progress preview. Review a fresh preview before confirming.');
  if(!target.compatibility.canUnlock&&!allowProgress) throw Object.assign(fail(target.compatibility.reason),{diagnostic:{code:target.compatibility.code,action:target.compatibility.action}});
  const entries=(snapshot.stats||[]).filter(s=>s.stat_id===target.statId);
  if(entries.length!==1 || !uint(entries[0].stat_value)) throw fail('Steam did not return a unique valid achievement bitmask.');
  if(!Object.hasOwn(snapshot,'crc_stats') || !uint(snapshot.crc_stats)) throw fail('Steam did not return a valid statistics CRC.');
  const mask=(1<<target.bitIndex)>>>0;
  const next=(entries[0].stat_value|mask)>>>0;
  if(((entries[0].stat_value^next)>>>0)!==mask) throw fail('The change would modify an unexpected achievement.');
  const stats=[{stat_id:target.statId,stat_value:next}],progressChanges=[];
  if(allowProgress){const p=target.progressSupport;progressChanges.push({statId:p.statId,statName:p.statName,before:p.before,after:p.after});if(p.before!==p.after)stats.push({stat_id:p.statId,stat_value:p.after>>>0});}
  return {target,view,progressChanges,revision:revision(snapshot,id,apiname),payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats}};
}
function prepareShared(snapshot,id,apiname,{expectedRevision}={}) {
  id=appId(id);
  if(typeof apiname!=='string'||!apiname||apiname.length>256)throw fail('Select one real achievement identifier.');
  const review=sharedPreview(snapshot,id,apiname),view=parseSnapshot(snapshot,id),target=view.achievements.find(a=>a.apiname===apiname);
  if(!expectedRevision||review.revision!==expectedRevision)throw fail('Steam data changed or no reviewed revision was supplied. Review the shared counter again.');
  if(!review.completeImpact)throw fail('Every shared-counter effect must be known and unrestricted before writing.');
  const unlocks=review.effects.filter(e=>e.effect==='would_unlock');
  if(unlocks.length!==1||unlocks[0].apiname!==apiname)throw fail('Initial shared-counter support allows exactly one reviewed unlock. Multiple unlocks remain disabled.');
  if(!view.achievements.every(r=>review.effects.every(e=>e.apiname!==r.apiname)||r.compatibility?.status!=='insufficient_data'))throw fail('A related achievement has insufficient verified data.');
  const values=(snapshot.stats||[]).filter(s=>s.stat_id===target.statId);
  if(values.length!==1||!uint(values[0].stat_value)||!uint(snapshot.crc_stats))throw fail('Steam did not return a valid unique bitmask and statistics version.');
  const value=(values[0].stat_value|(1<<target.bitIndex))>>>0;
  const stats=[{stat_id:target.statId,stat_value:value}];
  if(review.counter.before!==review.counter.after)stats.push({stat_id:review.counter.statId,stat_value:review.counter.after>>>0});
  return {target,view,revision:review.revision,sharedEffects:review.effects,groupMembers:review.effects.filter(e=>e.unlocked===false).map(e=>e.apiname),progressChanges:[review.counter],payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats}};
}
function prepareFloat(snapshot,id,apiname,{expectedRevision}={}) {
  id=appId(id);
  if(typeof apiname!=='string'||!apiname||apiname.length>256)throw fail('Select one real achievement identifier.');
  const view=parseSnapshot(snapshot,id),matches=view.achievements.filter(a=>a.apiname===apiname);
  const target=matches.length===1?matches[0]:null,p=target?.progressSupport;
  if(!target||target.unlocked!==false||p?.canPreviewFloat!==true||p.type!=='FLOAT')throw fail(p?.reason||'A unique, locked achievement with an exclusive writable decimal counter is required.');
  if(!view.verified||new Set((snapshot.stats||[]).map(s=>s.stat_id)).size!==snapshot.stats.length||!snapshot.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value')&&uint(s.stat_id)&&uint(s.stat_value)))throw fail('All personal statistics must be unique and valid before a decimal write.');
  const reviewedRevision=revision(snapshot,id,apiname);
  if(!expectedRevision||expectedRevision!==reviewedRevision)throw fail('Steam data changed or no reviewed revision was supplied. Review the progress again.');
  if(p.beforeRaw===p.afterRaw)throw fail('The counter already reaches its goal while the achievement is locked. Review this inconsistent Steam state; no write is permitted.');
  // The wire field is uint32: send IEEE-754 bits, never a truncated decimal or an achievement bitmask.
  const change={type:'FLOAT',statId:p.statId,statName:p.statName,before:p.before,after:p.after,beforeRaw:p.beforeRaw,afterRaw:p.afterRaw,goal:p.goal};
  return {target,view,revision:reviewedRevision,progressChanges:[change],payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats:[{stat_id:p.statId,stat_value:p.afterRaw}]}};
}
function store(client,payload,{timeoutMs=10000}={}) {
  return new Promise((resolve,reject)=>{
    let done=false,job;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(job)client._jobs?.delete?.(job);client.removeListener('disconnected',offline);client.removeListener('error',offline);error?reject(error):resolve(value);};
    const offline=()=>finish(fail('Steam disconnected after the write was requested. The result is unknown.'));
    const timer=setTimeout(()=>finish(fail('Steam did not acknowledge the write. The result is unknown.')),timeoutMs);
    client.once('disconnected',offline);client.once('error',offline);
    try {
      client._send({msg:EMsg.ClientStoreUserStats2,proto:{}},Buffer.from(Schema.CMsgClientStoreUserStats2.encode(payload).finish()),(body,header)=>{
        if(done)return;
        try {
          if(header?.msg!==EMsg.ClientStoreUserStatsResponse) throw fail('Unexpected Steam write response.');
          const buffer=body?.toBuffer?body.toBuffer():body;
          if(!Buffer.isBuffer(buffer)||buffer.length>65536) throw fail('Invalid Steam write response.');
          const response=Schema.CMsgClientStoreUserStatsResponse.decode(buffer);
          if(String(response.game_id)!==String(payload.game_id)) throw fail('Steam acknowledged a different game.');
          finish(null,response);
        } catch { finish(fail('The Steam write response could not be validated.')); }
      });
      job=String(client._currentJobID);if(done)client._jobs?.delete?.(job);
    } catch { finish(fail('Steam could not send the write. The result is unknown.')); }
  });
}
const busy=new WeakSet(), attempted=new WeakMap(), lastSent=new WeakMap();
async function unlockAchievement(client,id,apiname,{read=requestSnapshot,send=store,beforeSend=()=>{},validateTarget=()=>{},selectTarget,allowProgress=false,sharedProgress=false,floatProgress=false,expectedRevision,timeoutMs=8000,cooldownMs=60000,now=Date.now}={}) {
  id=appId(id);

  if(!client?.steamID || typeof client._send!=='function') throw fail('Connect to Steam before unlocking an achievement.');
  if(client.playingState?.blocked) throw fail('Stop playing on the other device before unlocking an achievement.');
  if([allowProgress,sharedProgress,floatProgress].filter(Boolean).length>1)throw fail('Select exactly one progress operation.');
  if(busy.has(client)) throw fail('An achievement activation is already running.');
  busy.add(client);
  try {
    const identity=client.steamID.toString();
    const current=()=>{if(client.steamID?.toString()!==identity||client.playingState?.blocked)throw fail('The Steam account or playing session changed.');};
    const initial=await read(client,id,{timeoutMs});current();
    const selected=selectTarget?selectTarget(initial):apiname;
    const plan=floatProgress?prepareFloat(initial,id,selected,{expectedRevision}):sharedProgress?prepareShared(initial,id,selected,{expectedRevision}):prepare(initial,id,selected,{allowProgress,expectedRevision});
    const key=id+':'+plan.target.apiname;
    validateTarget(plan.target);
    const evidence={appid:id,apiname:plan.target.apiname,name:plan.target.name,checkedAt:new Date().toISOString(),before:plan.target.unlocked,...(allowProgress||sharedProgress||floatProgress?{progressChanges:plan.progressChanges,revision:plan.revision}: {}),...(sharedProgress?{sharedEffects:plan.sharedEffects,groupMembers:plan.groupMembers}: {})};
    if(!plan.payload) return {...evidence,outcome:'already_unlocked',after:true,changed:false,message:'Steam already reports this achievement as unlocked. No write was sent.'};
    if(attempted.get(client)?.has(key)) throw fail('This achievement was already attempted in this session. Refresh to check its result; automatic retries are disabled.');
    if(lastSent.has(client)&&now()-lastSent.get(client)<cooldownMs) throw fail('Wait one minute between achievement writes.',429);
    const payload={...plan.payload,settor_steam_id:identity,settee_steam_id:identity};
    await beforeSend({...evidence,statId:plan.target.statId,bitIndex:plan.target.bitIndex});current();
    if(!attempted.has(client))attempted.set(client,new Set());
    attempted.get(client).add(key);lastSent.set(client,now());
    let acknowledgement=null,writeError='';
    try{if(typeof client.gamesPlayed==='function')client.gamesPlayed([id]);}catch{}
    try {acknowledgement=await send(client,payload,{timeoutMs});}catch(err){writeError=err.message;}
    const ack=acknowledgement?{result:Number(acknowledgement.eresult),stale:Boolean(acknowledgement.stats_out_of_date),rejectedStats:(acknowledgement.stats_failed_validation||[]).map(s=>({statId:s.stat_id,revertedValue:s.reverted_stat_value}))}:null;
    let final;
    try {current();final=await read(client,id,{timeoutMs});current();}catch{return {...evidence,outcome:'unknown',after:null,acknowledgement:ack,diagnostic:{code:'verification_unavailable',action:'A write was requested, but Steam could not be read afterwards. The result is unknown. Refresh to verify; no automatic retry was sent.'},message:writeError||'The write result could not be re-read from Steam. No automatic retry was sent.'};}
    let afterView;
    try{afterView=parseSnapshot(final,id);}catch{return {...evidence,outcome:'unknown',after:null,acknowledgement:ack,diagnostic:{code:'verification_unavailable',action:'The fresh Steam response could not be validated. Review the recorded attempt; no automatic retry is permitted.'},message:'Steam did not provide a valid independent verification. The write remains unconfirmed.'};}
    const targetMatches=afterView.achievements.filter(a=>a.apiname===plan.target.apiname);
    const target=targetMatches.length===1?targetMatches[0]:null;
    const afterValues=new Map((final.stats||[]).map(s=>[s.stat_id,s.stat_value]));
    const updates=new Map(payload.stats.map(s=>[s.stat_id,s.stat_value]));
    // Steam may unlock the one linked achievement after updating its counter. It is never sent by the FLOAT writer.
    if(floatProgress)updates.set(plan.target.statId,((initial.stats.find(s=>s.stat_id===plan.target.statId).stat_value)|(1<<plan.target.bitIndex))>>>0);
    const expectedValues=new Map((initial.stats||[]).map(s=>[s.stat_id,updates.has(s.stat_id)?updates.get(s.stat_id):s.stat_value]));
    const differences=[...new Set([...expectedValues.keys(),...afterValues.keys()])].filter(statId=>expectedValues.get(statId)!==afterValues.get(statId));
    const beforeAchievements=new Map(plan.view.achievements.map(a=>[a.apiname,a.unlocked]));
    const otherChanges=afterView.achievements.filter(a=>a.apiname!==plan.target.apiname && beforeAchievements.get(a.apiname)!==a.unlocked).map(a=>a.apiname);
    const accepted=ack?.result===1 && String(acknowledgement?.game_id)===String(id) && !ack.stale && !ack.rejectedStats.length;
    const schemaUnchanged=Buffer.from(initial.schema).equals(Buffer.from(final.schema)) && target?.statId===plan.target.statId && target?.bitIndex===plan.target.bitIndex && new Set((final.stats||[]).map(s=>s.stat_id)).size===(final.stats||[]).length && (final.stats||[]).every(s=>uint(s.stat_id)&&uint(s.stat_value));
    const sharedVerification=sharedProgress?plan.sharedEffects.map(effect=>{const matches=afterView.achievements.filter(a=>a.apiname===effect.apiname),row=matches.length===1?matches[0]:null;return {...effect,observedUnlocked:row?.unlocked??null,observedCounter:row?.progressDetails?.currentValue??null,verified:Boolean(row)&&row.unlocked===(effect.effect==='would_unlock'||effect.unlocked===true)&&row.progressDetails?.currentValue===effect.after};}):[];
    if(sharedVerification.some(e=>!e.verified))differences.push('shared_effect_mismatch');
    const progressVerification=floatProgress?plan.progressChanges.map(change=>{
      const entries=(final.stats||[]).filter(s=>s.stat_id===change.statId),raw=entries.length===1&&uint(entries[0].stat_value)?entries[0].stat_value:null;
      return {statId:change.statId,type:'FLOAT',observedRaw:raw,verified:raw===change.afterRaw&&target?.progressDetails?.type==='FLOAT'&&target?.progressDetails?.currentValue===change.after};
    }):[];
    if(floatProgress&&(!Object.hasOwn(final,'crc_stats')||!uint(final.crc_stats)||!final.stats.every(s=>Object.hasOwn(s,'stat_id')&&Object.hasOwn(s,'stat_value'))))differences.push('float_snapshot_unavailable');
    if(progressVerification.some(p=>!p.verified))differences.push('float_value_mismatch');
    const outcome=target?.unlocked===true && schemaUnchanged && !differences.length && !otherChanges.length ? (accepted?'confirmed':'observed_unlocked') : ack && !accepted ? 'rejected' : 'unknown';
    if(outcome==='confirmed')evidence.verifiedAt=new Date().toISOString();
    const diagnostic=ack?.stale?{code:'stale_stats',action:'Steam says the statistics changed during the request. Refresh to see the current state; no automatic retry was sent.'}:ack?.rejectedStats.length?{code:'stats_validation_failed',action:'Steam rejected one or more statistic values. The response does not establish a launcher-related cause. Use the official game for this achievement.'}:ack&&ack.result!==1?{code:'write_rejected',action:`Steam rejected the write with result ${ack.result}. A specific publisher or launcher restriction cannot be inferred from this result alone.`}:differences.length||otherChanges.length||!schemaUnchanged?{code:'verification_conflict',action:'Statistics or definitions changed during verification. Check the actual Steam state; this panel did not confirm a single isolated change.'}:outcome==='unknown'?{code:'write_not_confirmed',action:'Steam has not confirmed the requested state. Refresh to verify; do not assume failure or submit an automatic retry.'}:null;
    return {...evidence,...(sharedProgress?{sharedVerification}:{}),...(floatProgress?{progressVerification}:{}),outcome,diagnostic,after:target?.unlocked??null,changed:target?.unlocked===true,acknowledgement:ack,unexpectedStatChanges:differences,otherAchievementChanges:otherChanges,message:outcome==='confirmed'?(sharedProgress?'Steam confirmed the reviewed shared-counter update and every related effect, with no unrelated changes.':floatProgress?'Steam confirmed the exact decimal counter and the linked achievement, with no unrelated changes.':allowProgress?'Steam confirmed the selected achievement and the reviewed counter update, with no unrelated changes.':'Steam accepted the write and a fresh read confirms only the selected achievement changed.'):outcome==='observed_unlocked'?'A fresh Steam read shows the achievement unlocked, but the write acknowledgement was not clean.':outcome==='rejected'?'Steam rejected the write. No automatic retry was sent.':'Steam has not confirmed the exact requested change. No automatic retry was sent.'};
  } finally {busy.delete(client);}
}
async function applyChanges(client,id,selection,{read=requestSnapshot,send=store,readHistory,beforeSend,expectedRevision,bulk=false,resetCounters=false,allowRetoggle=false,overrideCooldown=false,timeoutMs=8000,now=Date.now,cooldownMs=60000}={}){
  id=appId(id);
  if(!client?.steamID||typeof client._send!=='function'||client.playingState?.blocked)throw fail('An available connected Steam session is required.');
  if(typeof readHistory!=='function'||typeof beforeSend!=='function'||typeof expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(expectedRevision))throw fail('Review the exact changes and verify persistent history before confirming.');
  if(busy.has(client))throw fail('An achievement operation is already running.');busy.add(client);
  const identity=client.steamID.toString(),current=()=>{if(client.steamID?.toString()!==identity||client.playingState?.blocked)throw fail('The Steam account or playing session changed.');};
  try{
    const [initial,receipts]=await Promise.all([read(client,id,{timeoutMs}),readHistory(identity,id)]);current();
    const plan=prepareChanges(initial,id,selection,receipts,expectedRevision,{bulk,resetCounters,allowRetoggle}),key='operation:'+expectedRevision;
    if(attempted.get(client)?.has(key))throw fail('This reviewed operation was already attempted. Automatic retries are disabled.');
    if(!overrideCooldown&&lastSent.has(client)&&now()-lastSent.get(client)<cooldownMs)throw fail('Wait one minute between achievement operations.',429);
    const intent=await beforeSend(plan);current();
    if(!intent?.operationId||!/^[a-f0-9-]{36}$/i.test(intent.operationId))throw fail('The persistent operation intent could not be verified.');
    if(!attempted.has(client))attempted.set(client,new Set());attempted.get(client).add(key);lastSent.set(client,now());
    try{if(typeof client.gamesPlayed==='function')client.gamesPlayed([id]);}catch{}
    const hasRemovals=plan.effects.some(e=>e.action==='remove');
    const hasUnlocks=plan.effects.some(e=>e.action==='unlock');
    const checkFinalBits=snap=>{
      if(!snap||!Array.isArray(snap.stats))return false;
      const map=new Map(snap.stats.map(s=>[s.stat_id,s.stat_value]));
      return plan.effects.every(e=>{
        if(e.action!=='unlock'&&e.action!=='remove')return true;
        const mask=(1<<e.bitIndex)>>>0,val=map.get(e.statId)??0;
        return e.action==='unlock'?Boolean(val&mask):(val&mask)===0;
      });
    };
    const isCleanAck=res=>Number(res?.eresult)===1&&!res?.stats_out_of_date&&!(res?.stats_failed_validation||[]).length;
    let activePayload={...plan.payload,settor_steam_id:identity,settee_steam_id:identity};
    if(send===store&&hasRemovals&&!hasUnlocks){
      activePayload={...activePayload,explicit_reset:true,stats:plan.resetAllStats||plan.payload.stats};
    }
    let response=null;try{response=await send(client,activePayload,{timeoutMs});}catch{}
    let final=null;try{current();final=await read(client,id,{timeoutMs});current();}catch{}
    if(send===store&&final&&(!checkFinalBits(final)||!isCleanAck(response))){
      // Tier 2: Standard explicit_reset:false write with non-incrementonly stats
      try{
        const crc=uint(final.crc_stats)?final.crc_stats:activePayload.crc_stats;
        response=await send(client,{...plan.payload,crc_stats:crc,explicit_reset:false,settor_steam_id:identity,settee_steam_id:identity},{timeoutMs});
        current();final=await read(client,id,{timeoutMs});current();
      }catch{}
      // Tier 3: Pure achievement bitmask-only write if any progress stat caused validation rejection
      if(final&&(!checkFinalBits(final)||!isCleanAck(response))){
        const achStatIds=new Set(plan.effects.map(e=>e.statId));
        const bitOnlyStats=plan.payload.stats.filter(s=>achStatIds.has(s.stat_id));
        if(bitOnlyStats.length&&bitOnlyStats.length<plan.payload.stats.length){
          try{
            const crc=uint(final.crc_stats)?final.crc_stats:activePayload.crc_stats;
            response=await send(client,{game_id:String(id),crc_stats:crc,explicit_reset:false,settor_steam_id:identity,settee_steam_id:identity,stats:bitOnlyStats},{timeoutMs});
            current();final=await read(client,id,{timeoutMs});current();
          }catch{}
        }
      }
    }
    const acknowledgement=response?{result:Number(response.eresult),gameId:String(response.game_id),stale:Boolean(response.stats_out_of_date),rejectedStats:(response.stats_failed_validation||[]).map(s=>({statId:s.stat_id,revertedValue:s.reverted_stat_value}))}:null;
    let verification;
    try{
      if(!final)throw fail('Verification unavailable');
      current();verification=verifyChanges(initial,final,plan,acknowledgement);
    }catch{verification={confirmed:false,diagnostic:'verification_unavailable',effects:[],progress:[]};}
    const outcome=verification.confirmed?'confirmed':'unknown';
    if(outcome==='confirmed'||bulk||allowRetoggle)attempted.get(client)?.delete(key);
    return {...intent,outcome,acknowledgement,verification,...(verification.confirmed?{verifiedAt:new Date().toISOString()}:{}),message:verification.confirmed?'Steam confirmed every reviewed achievement and counter change, with no unrelated changes.':'The exact reviewed operation remains unconfirmed. Its reservation is retained; no automatic retry will be sent.'};
  }finally{busy.delete(client);}
}
module.exports={prepare,prepareShared,prepareFloat,store,unlockAchievement,applyChanges};
