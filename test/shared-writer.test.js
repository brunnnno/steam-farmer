'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {prepareShared,unlockAchievement}=require('../lib/achievement-writer'),{sharedPreview}=require('../lib/achievement-progress');
function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
function snapshot({value=0,mask=0,goal=1000000,protectedRow=false,extraStat=false,missing=false}={}){
  const bit=(name,threshold,extra={})=>({name,progress:{max_val:String(threshold),value:{operation:'statvalue',operand1:'HEALED'}},...extra});
  return {eresult:1,game_id:'440',crc_stats:1,schema:kv({'440':{stats:{'7':{type:'4',bits:{'0':bit('TEAM_DOCTOR',25000),'1':bit('CHIEF',goal,protectedRow?{permission:'2'}:{})}},'9':{type:'INT',name:'HEALED',min:'0',max:'2000000'}}}}),stats:[{stat_id:7,stat_value:mask},...(!missing?[{stat_id:9,stat_value:value}]:[]),...(extraStat?[{stat_id:10,stat_value:1}]:[])]};
}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{throw Error('Real transport forbidden');};return c;}
test('shared plan changes only Team Doctor bit and counter, reserves and records both effects',()=>{
  const s=snapshot(),review=sharedPreview(s,440,'TEAM_DOCTOR'),plan=prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:review.revision});
  assert.deepEqual(plan.payload.stats,[{stat_id:7,stat_value:1},{stat_id:9,stat_value:25000}]);assert.deepEqual(plan.groupMembers,['TEAM_DOCTOR','CHIEF']);assert.equal(plan.sharedEffects.find(e=>e.apiname==='CHIEF').effect,'progress_only');
});
test('unreviewed, stale, protected, multiple-unlock and unavailable shared plans cannot be written',()=>{
  const initial=snapshot(),digest=sharedPreview(initial,440,'TEAM_DOCTOR').revision;
  assert.throws(()=>prepareShared(initial,440,'TEAM_DOCTOR'));
  for(const s of [snapshot({value:1}),snapshot({goal:100}),snapshot({protectedRow:true}),snapshot({missing:true})])assert.throws(()=>prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:digest}));
  for(const s of [snapshot({goal:100}),snapshot({protectedRow:true})])assert.throws(()=>prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:sharedPreview(s,440,'TEAM_DOCTOR').revision}));
});
test('clean acknowledgement and fresh complete effect verification confirm the shared change',async()=>{
  const initial=snapshot();let reads=0,sends=0,reserved=false;
  const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>reads++?snapshot({value:25000,mask:1}):initial,beforeSend:async e=>{assert.equal(e.sharedEffects.length,2);reserved=true;},send:async()=>{assert.equal(reserved,true);sends++;return {eresult:1,game_id:'440'};}});
  assert.equal(sends,1);assert.equal(result.outcome,'confirmed');assert.equal(result.sharedVerification.length,2);assert.ok(result.sharedVerification.every(e=>e.verified));assert.equal(result.sharedVerification.find(e=>e.apiname==='CHIEF').observedUnlocked,false);
});
test('unexpected unlock, incorrect counter, extra statistic or dirty ack never confirms shared operation',async()=>{
  const initial=snapshot();
  for(const [final,ack] of [[snapshot({value:25000,mask:3}),{eresult:1,game_id:'440'}],[snapshot({value:24999,mask:1}),{eresult:1,game_id:'440'}],[snapshot({value:25000,mask:1,extraStat:true}),{eresult:1,game_id:'440'}],[snapshot({value:25000,mask:1}),{eresult:1,game_id:'440',stats_out_of_date:true}]]){
    let reads=0;const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>reads++?final:initial,send:async()=>ack});
    assert.notEqual(result.outcome,'confirmed');
  }
});
test('failed durable reservation blocks transport and disconnected final read remains unknown',async()=>{
  const initial=snapshot(),options={sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>initial,send:async()=>{throw Error('Must not send');},beforeSend:async()=>{throw Error('Reservation unavailable');}};
  await assert.rejects(unlockAchievement(client(),440,'TEAM_DOCTOR',options),/Reservation unavailable/);
  let reads=0;const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{...options,beforeSend:async()=>{},send:async()=>({eresult:1,game_id:'440'}),read:async()=>{if(reads++)throw Error('Offline');return initial;}});
  assert.equal(result.outcome,'unknown');assert.equal(result.sharedEffects.length,2);
});
