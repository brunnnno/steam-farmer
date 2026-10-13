'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const Schema=require('steam-user/protobufs/generated/_load.js');const EMsg=require('steam-user/enums/EMsg');
const {TARGET,prepare,store,unlockModelMania}=require('../lib/achievement-experiment');
function kv(obj){const pieces=[];for(const [k,v]of Object.entries(obj)){pieces.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));}pieces.push(Buffer.from([8]));return Buffer.concat(pieces);}
function snapshot({value=0x80000000,bit={},block={},extra={}}={}){return {game_id:String(TARGET.appid),eresult:1,crc_stats:42,schema:kv({[TARGET.appid]:{stats:{'7':{type:'4',bits:{'0':{name:'MODEL_API',display:{name:{english:TARGET.name},desc:{english:TARGET.description}},...bit},'31':{name:'OTHER',display:{name:{english:'Other'}}}},...block}}}}),stats:[{stat_id:7,stat_value:value},{stat_id:9,stat_value:12}],...extra};}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{};c.playingState={blocked:false};return c;}
const ack=()=>({game_id:String(TARGET.appid),eresult:1,stats_out_of_date:false,stats_failed_validation:[]});
test('single target plan preserves every other achievement bit, numeric stats and CRC',()=>{const p=prepare(snapshot());assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:0x80000001}]);assert.equal(p.payload.crc_stats,42);assert.equal(p.payload.explicit_reset,false);});
test('permissions, dependencies, missing CRC and unverified initial state prevent sending',()=>{
  for(const input of [snapshot({bit:{permission:'1'}}),snapshot({block:{permission:'2'}}),snapshot({bit:{progress:{max_val:'44'}}}),snapshot({extra:{stats:[]}})])assert.throws(()=>prepare(input));
  const s=snapshot();delete s.crc_stats;assert.throws(()=>prepare(s),/statistics version/);
  assert.throws(()=>prepare(snapshot({bit:{display:{name:{english:'Wrong'},desc:{english:TARGET.description}}}})),/identified/);
});
test('only a clean acknowledgement plus a fresh exact state change is confirmed',async()=>{
  let reads=0,sends=0;const c=client();const r=await unlockModelMania(c,{read:async()=>snapshot({value:++reads===1?0x80000000:0x80000001}),send:async(_,p)=>{sends++;assert.equal(p.settor_steam_id,c.steamID.toString());assert.equal(p.settee_steam_id,c.steamID.toString());assert.equal(p.stats.length,1);return ack();}});
  assert.equal(r.outcome,'confirmed');assert.equal(reads,2);assert.equal(sends,1);assert.deepEqual(r.otherAchievementChanges,[]);
});
test('already unlocked and wrong frontend API identifiers never submit a write',async()=>{
  let sends=0;const send=async()=>{sends++;return ack();};const r=await unlockModelMania(client(),{read:async()=>snapshot({value:0x80000001}),send});assert.equal(r.outcome,'already_unlocked');
  await assert.rejects(unlockModelMania(client(),{read:async()=>snapshot(),send,expectedApiname:'WRONG'}),/identifier/);assert.equal(sends,0);
});
test('Steam rejection, stale CRC, partial validation and unrelated changes cannot claim success',async()=>{
  for(const response of [{...ack(),eresult:8},{...ack(),stats_out_of_date:true},{...ack(),stats_failed_validation:[{stat_id:7,reverted_stat_value:0x80000000}]}]){
    const r=await unlockModelMania(client(),{read:async()=>snapshot(),send:async()=>response});assert.equal(r.outcome,'rejected');
  }
  let reads=0;const r=await unlockModelMania(client(),{read:async()=>snapshot({value:++reads===1?0x80000000:1}),send:async()=>ack()});assert.equal(r.outcome,'unknown');assert.deepEqual(r.otherAchievementChanges,['OTHER']);
});
test('write timeout stays unknown and cannot trigger an automatic or duplicate write',async()=>{
  const c=client();let sends=0;const options={read:async()=>snapshot(),send:async()=>{sends++;throw Error('timeout');}};const r=await unlockModelMania(c,options);assert.equal(r.outcome,'unknown');await assert.rejects(unlockModelMania(c,options),/already attempted/);assert.equal(sends,1);
});
test('a missing acknowledgement can report observed unlock, never confirmed',async()=>{
  let reads=0;const r=await unlockModelMania(client(),{read:async()=>snapshot({value:++reads===1?0x80000000:0x80000001}),send:async()=>{throw Error('timeout');}});assert.equal(r.outcome,'observed_unlocked');
});
test('collision, audit failure and simultaneous requests prevent conflicting writes',async()=>{
  const c=client();c.playingState.blocked=true;await assert.rejects(unlockModelMania(c),/other device/);c.playingState.blocked=false;
  let sends=0;await assert.rejects(unlockModelMania(c,{read:async()=>snapshot(),send:async()=>{sends++;},beforeSend:()=>{throw Error('audit failed');}}),/audit failed/);assert.equal(sends,0);
  let release;const pending=unlockModelMania(c,{read:()=>new Promise(r=>{release=r;})});await assert.rejects(unlockModelMania(c),/already running/);release(snapshot({value:0x80000001}));await pending;
});
test('write transport checks response identity and frees pending jobs on timeout',async()=>{
  const c=client();c._jobs=new Map();c._currentJobID=0;c._send=(h,body,cb)=>{assert.equal(h.msg,EMsg.ClientStoreUserStats2);assert.equal(Schema.CMsgClientStoreUserStats2.decode(body).stats.length,1);const j=String(++c._currentJobID);c._jobs.set(j,cb);queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({...ack(),game_id:'550'}).finish()),{msg:EMsg.ClientStoreUserStatsResponse}));};
  await assert.rejects(store(c,prepare(snapshot()).payload),/validated/);assert.equal(c._jobs.size,0);
  c._send=(_,__,cb)=>c._jobs.set(String(++c._currentJobID),cb);await assert.rejects(store(c,prepare(snapshot()).payload,{timeoutMs:5}),/unknown/);assert.equal(c._jobs.size,0);assert.equal(c.listenerCount('disconnected'),0);
});
