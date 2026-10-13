'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const { requestSnapshot, parseSnapshot } = require('./steam-protocol');
const TARGET = Object.freeze({ appid:3764200, name:'Model Mania', description:'View all models.' });
const fail = (message,status=409) => Object.assign(new Error(message),{status});
const uint = value => Number.isInteger(value) && value>=0 && value<=0xffffffff;
function prepare(snapshot) {
  const view=parseSnapshot(snapshot,TARGET.appid);
  const matches=view.achievements.filter(a=>a.name===TARGET.name && a.description===TARGET.description);
  if(matches.length!==1) throw fail('The selected achievement could not be identified uniquely in Steam.');
  const target=matches[0];
  if(target.unlocked===true) return {target,view,payload:null};
  if(target.unlocked!==false) throw fail('Steam did not verify the initial achievement state.');
  if(target.hasProgressDependency) throw fail('This experiment does not modify progress statistics. This achievement has a dependency.');
  for(const permission of [target.permission,target.blockPermission]) {
    if(permission!==null && String(permission)!=='0') throw fail('This achievement has restricted or unsupported write permissions.');
  }
  const entries=(snapshot.stats||[]).filter(s=>s.stat_id===target.statId);
  if(entries.length!==1 || !uint(entries[0].stat_value)) throw fail('Steam did not return a unique valid achievement bitmask.');
  if(!Object.hasOwn(snapshot,'crc_stats') || !uint(snapshot.crc_stats)) throw fail('Steam did not return a valid statistics CRC.');
  const mask=(1<<target.bitIndex)>>>0;
  const next=(entries[0].stat_value|mask)>>>0;
  if(((entries[0].stat_value^next)>>>0)!==mask) throw fail('The change would modify an unexpected achievement.');
  return {target,view,payload:{game_id:String(TARGET.appid),crc_stats:snapshot.crc_stats,explicit_reset:false,stats:[{stat_id:target.statId,stat_value:next}]}};
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
          if(String(response.game_id)!==String(TARGET.appid)) throw fail('Steam acknowledged a different game.');
          finish(null,response);
        } catch { finish(fail('The Steam write response could not be validated.')); }
      });
      job=String(client._currentJobID);if(done)client._jobs?.delete?.(job);
    } catch { finish(fail('Steam could not send the write. The result is unknown.')); }
  });
}
const busy=new WeakSet(), attempted=new WeakSet();
async function unlockModelMania(client,{read=requestSnapshot,send=store,beforeSend=()=>{},expectedApiname,timeoutMs=10000}={}) {
  if(!client?.steamID || typeof client._send!=='function') throw fail('Connect to Steam before the experiment.');
  if(client.playingState?.blocked) throw fail('Stop playing on the other device before the experiment.');
  if(busy.has(client)) throw fail('An achievement experiment is already running.');
  busy.add(client);
  try {
    const identity=client.steamID.toString();
    const current=()=>{if(client.steamID?.toString()!==identity||client.playingState?.blocked)throw fail('The Steam account or playing session changed.');};
    const initial=await read(client,TARGET.appid,{timeoutMs});current();
    const plan=prepare(initial);
    if(expectedApiname && plan.target.apiname!==expectedApiname) throw fail('The achievement identifier changed. Refresh before the experiment.');
    const evidence={appid:TARGET.appid,apiname:plan.target.apiname,name:TARGET.name,checkedAt:new Date().toISOString(),before:plan.target.unlocked};
    if(!plan.payload) return {...evidence,outcome:'already_unlocked',after:true,changed:false,message:'Steam already reports this achievement as unlocked. No write was sent.'};
    if(attempted.has(client)) throw fail('One write was already attempted in this session. Refresh to check its result; automatic retries are disabled.');
    const payload={...plan.payload,settor_steam_id:identity,settee_steam_id:identity};
    await beforeSend({...evidence,statId:plan.target.statId,bitIndex:plan.target.bitIndex});current();
    attempted.add(client);
    let acknowledgement=null,writeError='';
    try {acknowledgement=await send(client,payload,{timeoutMs});}catch(err){writeError=err.message;}
    const ack=acknowledgement?{result:Number(acknowledgement.eresult),stale:Boolean(acknowledgement.stats_out_of_date),rejectedStats:(acknowledgement.stats_failed_validation||[]).map(s=>({statId:s.stat_id,revertedValue:s.reverted_stat_value}))}:null;
    let final;
    try {current();final=await read(client,TARGET.appid,{timeoutMs});current();}catch{return {...evidence,outcome:'unknown',after:null,acknowledgement:ack,message:writeError||'The write result could not be re-read from Steam. No automatic retry was sent.'};}
    const afterView=parseSnapshot(final,TARGET.appid);
    const target=afterView.achievements.find(a=>a.apiname===plan.target.apiname);
    const afterValues=new Map((final.stats||[]).map(s=>[s.stat_id,s.stat_value]));
    const differences=(initial.stats||[]).filter(s=>afterValues.get(s.stat_id)!==(s.stat_id===plan.target.statId?payload.stats[0].stat_value:s.stat_value)).map(s=>s.stat_id);
    const otherChanges=afterView.achievements.filter(a=>a.apiname!==plan.target.apiname && plan.view.achievements.find(b=>b.apiname===a.apiname)?.unlocked!==a.unlocked).map(a=>a.apiname);
    const accepted=ack?.result===1 && !ack.stale && !ack.rejectedStats.length;
    const outcome=target?.unlocked===true && !differences.length && !otherChanges.length ? (accepted?'confirmed':'observed_unlocked') : ack && !accepted ? 'rejected' : 'unknown';
    return {...evidence,outcome,after:target?.unlocked??null,changed:target?.unlocked===true,acknowledgement:ack,unexpectedStatChanges:differences,otherAchievementChanges:otherChanges,message:outcome==='confirmed'?'Steam accepted the write and a fresh read confirms only the selected achievement changed.':outcome==='observed_unlocked'?'A fresh Steam read shows the achievement unlocked, but the write acknowledgement was not clean.':outcome==='rejected'?'Steam rejected the write. No automatic retry was sent.':'Steam has not confirmed the exact requested change. No automatic retry was sent.'};
  } finally {busy.delete(client);}
}
module.exports={TARGET,prepare,store,unlockModelMania};
