'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {prepareFloat,unlockAchievement,store}=require('../lib/achievement-writer');
const {floatBits}=require('../lib/float-progress');
const {revision}=require('../lib/achievement-progress');
const Schema=require('steam-user/protobufs/generated/_load.js'),EMsg=require('steam-user/enums/EMsg');
function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
function snapshot({goal='10.5',value=1.25,stat={},bits={},stats,mask=2}={}){
  return {eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'DECIMAL',progress:{max_val:goal,value:{operation:'statvalue',operand1:'DISTANCE'}}},1:{name:'OTHER'},...bits}},9:{type:'FLOAT',name:'DISTANCE',min:'0',max:'100',...stat}}}}),stats:stats||[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:floatBits(value)},{stat_id:20,stat_value:123}]};
}
const client=()=>Object.assign(new EventEmitter(),{steamID:{toString:()=> '76561198000000001'},_send(){}});
const reviewed=s=>({expectedRevision:revision(s,550,'DECIMAL')});
const finalSnapshot=(s,raw=floatBits(10.5))=>({...s,crc_stats:13,stats:s.stats.map(p=>({...p,stat_value:p.stat_id===7?p.stat_value|1:p.stat_id===9?raw:p.stat_value}))});
async function attempt(s,final,ack={game_id:'550',eresult:1},options={}){
  let reads=0,sends=0;const c=client();
  const result=await unlockAchievement(c,550,'DECIMAL',{floatProgress:true,...reviewed(s),read:async()=>++reads===1?s:final,send:async(_,payload)=>{sends++;assert.deepEqual(payload.stats,[{stat_id:9,stat_value:prepareFloat(s,550,'DECIMAL',reviewed(s)).progressChanges[0].afterRaw}]);return ack;},...options});
  return {result,sends,c};
}
test('typed FLOAT plans send one exact IEEE-754 counter and no achievement bitmask',()=>{
  for(const [goal,value] of [['10.5',1.25],['1.00000003',0.5],['1e-46',0],['10.5',-0]]){
    const s=snapshot({goal,value}),plan=prepareFloat(s,550,'DECIMAL',reviewed(s)),p=plan.progressChanges[0];
    assert.equal(p.type,'FLOAT');assert.equal(p.beforeRaw,floatBits(value));assert.ok(p.after>=Number(goal));assert.deepEqual(plan.payload.stats,[{stat_id:9,stat_value:floatBits(p.after)}]);assert.equal(s.stats[0].stat_value,2);
    const decoded=Schema.CMsgClientStoreUserStats2.decode(Schema.CMsgClientStoreUserStats2.encode(plan.payload).finish());assert.equal(decoded.stats[0].stat_value,p.afterRaw);
  }
});
test('FLOAT plans reject stale revisions, completed locked counters and unsafe full snapshots',()=>{
  const s=snapshot();assert.throws(()=>prepareFloat(s,550,'DECIMAL'));assert.throws(()=>prepareFloat({...s,crc_stats:13},550,'DECIMAL',reviewed(s)),/changed/);
  for(const bad of [snapshot({value:12}),snapshot({stat:{permission:'2'}}),snapshot({stat:{type:'AVGRATE'}}),snapshot({stat:{maxchange:'1'}}),snapshot({stat:{max:'10'}}),snapshot({bits:{2:{name:'SHARED',progress:{max_val:'20',value:{operation:'statvalue',operand1:'DISTANCE'}}}}}),{...s,crc_stats:undefined},{...s,stats:[...s.stats,{stat_id:20,stat_value:123}]},{...s,stats:s.stats.map(p=>p.stat_id===20?{...p,stat_value:-1}:p)}])assert.throws(()=>prepareFloat(bad,550,'DECIMAL',reviewed(bad)));
  const implicit=Object.assign(Object.create({stat_value:0}),{stat_id:20});assert.throws(()=>prepareFloat({...s,stats:[...s.stats.slice(0,2),implicit]},550,'DECIMAL',reviewed(s)),/personal statistics/);
});
test('fresh acknowledgement and exact full read confirm the counter and automatic linked unlock',async()=>{
  const s=snapshot();let reserved=false;
  const {result,sends}=await attempt(s,finalSnapshot(s),undefined,{beforeSend:async evidence=>{assert.equal(evidence.progressChanges[0].afterRaw,floatBits(10.5));assert.equal(evidence.revision,revision(s,550,'DECIMAL'));reserved=true;}});
  assert.equal(reserved,true);assert.equal(sends,1);assert.equal(result.outcome,'confirmed');assert.equal(result.progressVerification[0].observedRaw,floatBits(10.5));assert.equal(result.progressVerification[0].verified,true);assert.deepEqual(result.unexpectedStatChanges,[]);assert.ok(result.verifiedAt);
});
test('FLOAT verification rejects raw rounding, absent unlock, extra bits/stats, duplicates and schema changes',async()=>{
  const s=snapshot(),good=finalSnapshot(s);
  const variants=[finalSnapshot(s,floatBits(10.5)-1),{...good,stats:good.stats.map(p=>p.stat_id===7?{...p,stat_value:2}:p)},{...good,stats:good.stats.map(p=>p.stat_id===7?{...p,stat_value:7}:p)},{...good,stats:good.stats.map(p=>p.stat_id===20?{...p,stat_value:124}:p)},{...good,stats:[...good.stats,{stat_id:20,stat_value:123}]},{...good,stats:good.stats.filter(p=>p.stat_id!==20)},{...good,crc_stats:undefined},{...good,schema:snapshot({goal:'10.6'}).schema}];
  for(const final of variants){const {result,sends}=await attempt(s,final);assert.notEqual(result.outcome,'confirmed');assert.equal(sends,1);assert.equal(result.diagnostic?.code,'verification_conflict');}
});
test('unclean FLOAT responses never confirm or retry, even when the desired value is observed',async()=>{
  const s=snapshot();
  for(const ack of [null,{game_id:'550',eresult:1,stats_out_of_date:true},{game_id:'550',eresult:1,stats_failed_validation:[{stat_id:9,reverted_stat_value:floatBits(1.25)}]},{game_id:'550',eresult:2},{game_id:'440',eresult:1}]){
    const {result,sends}=await attempt(s,finalSnapshot(s),ack);assert.notEqual(result.outcome,'confirmed');assert.equal(sends,1);
  }
});
test('missing or invalid independent FLOAT reads preserve an unconfirmed result',async()=>{
  const s=snapshot();
  for(const final of [{...finalSnapshot(s),game_id:'440'},{...finalSnapshot(s),schema:Buffer.alloc(0)},{...finalSnapshot(s),eresult:2}]){
    const {result,sends}=await attempt(s,final);assert.equal(sends,1);assert.equal(result.outcome,'unknown');assert.equal(result.diagnostic.code,'verification_unavailable');assert.equal(result.progressChanges[0].afterRaw,0x41280000);
  }
  const {result,sends}=await attempt(s,null,undefined,{read:async()=>{if(!s.used){s.used=true;return s;}throw Error('Disconnected');}});assert.equal(sends,1);assert.equal(result.outcome,'unknown');
});
test('failed persistent intent and changed identity prevent FLOAT transport; attempts cannot retry',async()=>{
  const s=snapshot(),c=client();let sends=0;
  const options={floatProgress:true,...reviewed(s),read:async()=>s,send:async()=>{sends++;return {eresult:1,game_id:'550'};}};
  await assert.rejects(unlockAchievement(c,550,'DECIMAL',{...options,beforeSend:async()=>{throw Error('Persistence unavailable');}}));assert.equal(sends,0);
  await assert.rejects(unlockAchievement(c,550,'DECIMAL',{...options,beforeSend:async()=>{c.steamID=null;}}));assert.equal(sends,0);
  const fresh=client();await unlockAchievement(fresh,550,'DECIMAL',options);await assert.rejects(unlockAchievement(fresh,550,'DECIMAL',options),/already attempted/);assert.equal(sends,1);
});
test('FLOAT uses the real store serializer without converting decimal values to integers',async()=>{
  const s=snapshot(),plan=prepareFloat(s,550,'DECIMAL',reviewed(s)),c=client();
  c._send=({msg},bytes,callback)=>{assert.equal(msg,EMsg.ClientStoreUserStats2);const p=Schema.CMsgClientStoreUserStats2.decode(bytes);assert.equal(p.stats[0].stat_value,0x41280000);assert.equal(p.stats.length,1);callback(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({game_id:'550',eresult:1}).finish()),{msg:EMsg.ClientStoreUserStatsResponse});};
  assert.equal((await store(c,plan.payload)).eresult,1);
});
