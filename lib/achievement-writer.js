'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const { requestSnapshot, parseSnapshot } = require('./steam-protocol');
const { appId } = require('./core');
const { uint } = require('./achievement-compatibility');
const fail = (message,status=409) => Object.assign(new Error(message),{status});
function prepare(snapshot,id,apiname) {
  id=appId(id);
  if(typeof apiname!=='string'||!apiname||apiname.length>256) throw fail('Select one real Steam achievement identifier.');
  const view=parseSnapshot(snapshot,id);
  const matches=view.achievements.filter(a=>a.apiname===apiname);
  if(matches.length!==1) throw fail('The selected achievement could not be identified uniquely in Steam.');
  const target=matches[0];
  if(target.unlocked===true) return {target,view,payload:null};
  if(target.unlocked!==false) throw fail('Steam did not verify the initial achievement state.');
  if(!target.compatibility.canUnlock) throw fail(target.compatibility.reason);
  const entries=(snapshot.stats||[]).filter(s=>s.stat_id===target.statId);
  if(entries.length!==1 || !uint(entries[0].stat_value)) throw fail('Steam did not return a unique valid achievement bitmask.');
  if(!Object.hasOwn(snapshot,'crc_stats') || !uint(snapshot.crc_stats)) throw fail('Steam did not return a valid statistics CRC.');
  const mask=(1<<target.bitIndex)>>>0;
  const next=(entries[0].stat_value|mask)>>>0;
  if(((entries[0].stat_value^next)>>>0)!==mask) throw fail('The change would modify an unexpected achievement.');
  return {target,view,payload:{game_id:String(id),crc_stats:snapshot.crc_stats,explicit_reset:false,stats:[{stat_id:target.statId,stat_value:next}]}};
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
async function unlockAchievement(client,id,apiname,{read=requestSnapshot,send=store,beforeSend=()=>{},validateTarget=()=>{},selectTarget,timeoutMs=8000,cooldownMs=60000,now=Date.now}={}) {
  id=appId(id);

  if(!client?.steamID || typeof client._send!=='function') throw fail('Connect to Steam before unlocking an achievement.');
  if(client.playingState?.blocked) throw fail('Stop playing on the other device before unlocking an achievement.');
  if(busy.has(client)) throw fail('An achievement activation is already running.');
  busy.add(client);
  try {
    const identity=client.steamID.toString();
    const current=()=>{if(client.steamID?.toString()!==identity||client.playingState?.blocked)throw fail('The Steam account or playing session changed.');};
    const initial=await read(client,id,{timeoutMs});current();
    const selected=selectTarget?selectTarget(initial):apiname;
    const plan=prepare(initial,id,selected);
    const key=id+':'+plan.target.apiname;
    validateTarget(plan.target);
    const evidence={appid:id,apiname:plan.target.apiname,name:plan.target.name,checkedAt:new Date().toISOString(),before:plan.target.unlocked};
    if(!plan.payload) return {...evidence,outcome:'already_unlocked',after:true,changed:false,message:'Steam already reports this achievement as unlocked. No write was sent.'};
    if(attempted.get(client)?.has(key)) throw fail('This achievement was already attempted in this session. Refresh to check its result; automatic retries are disabled.');
    if(lastSent.has(client)&&now()-lastSent.get(client)<cooldownMs) throw fail('Wait one minute between achievement writes.',429);
    const payload={...plan.payload,settor_steam_id:identity,settee_steam_id:identity};
    await beforeSend({...evidence,statId:plan.target.statId,bitIndex:plan.target.bitIndex});current();
    if(!attempted.has(client))attempted.set(client,new Set());
    attempted.get(client).add(key);lastSent.set(client,now());
    let acknowledgement=null,writeError='';
    try {acknowledgement=await send(client,payload,{timeoutMs});}catch(err){writeError=err.message;}
    const ack=acknowledgement?{result:Number(acknowledgement.eresult),stale:Boolean(acknowledgement.stats_out_of_date),rejectedStats:(acknowledgement.stats_failed_validation||[]).map(s=>({statId:s.stat_id,revertedValue:s.reverted_stat_value}))}:null;
    let final;
    try {current();final=await read(client,id,{timeoutMs});current();}catch{return {...evidence,outcome:'unknown',after:null,acknowledgement:ack,message:writeError||'The write result could not be re-read from Steam. No automatic retry was sent.'};}
    const afterView=parseSnapshot(final,id);
    const targetMatches=afterView.achievements.filter(a=>a.apiname===plan.target.apiname);
    const target=targetMatches.length===1?targetMatches[0]:null;
    const afterValues=new Map((final.stats||[]).map(s=>[s.stat_id,s.stat_value]));
    const expectedValues=new Map((initial.stats||[]).map(s=>[s.stat_id,s.stat_id===plan.target.statId?payload.stats[0].stat_value:s.stat_value]));
    const differences=[...new Set([...expectedValues.keys(),...afterValues.keys()])].filter(statId=>expectedValues.get(statId)!==afterValues.get(statId));
    const otherChanges=afterView.achievements.filter(a=>a.apiname!==plan.target.apiname && plan.view.achievements.find(b=>b.apiname===a.apiname)?.unlocked!==a.unlocked).map(a=>a.apiname);
    const accepted=ack?.result===1 && String(acknowledgement?.game_id)===String(id) && !ack.stale && !ack.rejectedStats.length;
    const schemaUnchanged=Buffer.from(initial.schema).equals(Buffer.from(final.schema)) && target?.statId===plan.target.statId && target?.bitIndex===plan.target.bitIndex;
    const outcome=target?.unlocked===true && schemaUnchanged && !differences.length && !otherChanges.length ? (accepted?'confirmed':'observed_unlocked') : ack && !accepted ? 'rejected' : 'unknown';
    return {...evidence,outcome,after:target?.unlocked??null,changed:target?.unlocked===true,acknowledgement:ack,unexpectedStatChanges:differences,otherAchievementChanges:otherChanges,message:outcome==='confirmed'?'Steam accepted the write and a fresh read confirms only the selected achievement changed.':outcome==='observed_unlocked'?'A fresh Steam read shows the achievement unlocked, but the write acknowledgement was not clean.':outcome==='rejected'?'Steam rejected the write. No automatic retry was sent.':'Steam has not confirmed the exact requested change. No automatic retry was sent.'};
  } finally {busy.delete(client);}
}
module.exports={prepare,store,unlockAchievement};
