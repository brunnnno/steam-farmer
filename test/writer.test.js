'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {parseSnapshot}=require('../lib/steam-protocol');const {prepare,unlockAchievement}=require('../lib/achievement-writer');
function kv(obj){const pieces=[];for(const[k,v]of Object.entries(obj))pieces.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));pieces.push(Buffer.from([8]));return Buffer.concat(pieces);}
function snap(id=550,mask=0,{bit={},extra={},bits={}}={}){return {eresult:1,game_id:String(id),crc_stats:123,schema:kv({[id]:{stats:{'7':{type:'4',bits:{'0':{name:'FIRST',...bit},'1':{name:'SECOND'},'31':{name:'HIGH'},...bits}}}}}),stats:[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:10}],...extra};}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{};return c;}
const ack=id=>({game_id:String(id),eresult:1,stats_out_of_date:false,stats_failed_validation:[]});
test('individual plans use the requested game and API name, preserving bit 31',()=>{
  assert.equal(prepare(snap(730,0x80000000),730,'SECOND').payload.stats[0].stat_value,0x80000002);
  assert.equal(prepare(snap(550,1),550,'HIGH').payload.stats[0].stat_value,0x80000001);
  assert.throws(()=>prepare(snap(730),550,'FIRST'),/different game/);assert.throws(()=>prepare(snap(),550,'ABSENT'),/identified/);
});
test('classification distinguishes restrictions, dependencies, insufficient data and provisional compatibility',()=>{
  assert.equal(parseSnapshot(snap(),550).achievements[0].compatibility.status,'provisional');
  assert.equal(parseSnapshot(snap(550,0,{bit:{permission:'2'}}),550).achievements[0].compatibility.status,'restricted');
  assert.equal(parseSnapshot(snap(550,0,{bit:{progress:{max_val:'5'}}}),550).achievements[0].compatibility.status,'dependency');
  const missing=snap();delete missing.crc_stats;assert.equal(parseSnapshot(missing,550).achievements[0].compatibility.status,'insufficient_data');
  const noValue=snap(550,0,{extra:{stats:[{stat_id:7}]}});assert.equal(parseSnapshot(noValue,550).achievements[0].unlocked,null);
});
test('duplicate API names, alias bits and duplicate personal stat masks are never writable',()=>{
  for(const s of [snap(550,0,{bits:{'2':{name:'FIRST'}}}),snap(550,0,{bits:{'00':{name:'ALIAS'}}}),snap(550,0,{extra:{stats:[{stat_id:7,stat_value:0},{stat_id:7,stat_value:1}]}})]) {
    assert.equal(parseSnapshot(s,550).achievements[0].compatibility.canUnlock,false);assert.throws(()=>prepare(s,550,'FIRST'));
  }
});
test('general activation confirms a selected achievement in a second game with fresh reads',async()=>{
  let reads=0;const r=await unlockAchievement(client(),730,'SECOND',{read:async()=>snap(730,++reads===1?1:3),send:async(_,p)=>{assert.equal(p.game_id,'730');assert.deepEqual(p.stats,[{stat_id:7,stat_value:3}]);return ack(730);}});assert.equal(r.outcome,'confirmed');assert.equal(reads,2);
});
test('cooldown limits separate selections and permits the next explicit operation after a minute',async()=>{
  const c=client();let time=100000,value=0,sends=0;
  const options={now:()=>time,read:async()=>snap(550,value),send:async(_,p)=>{sends++;value=p.stats[0].stat_value;return ack(550);}};
  assert.equal((await unlockAchievement(c,550,'FIRST',options)).outcome,'confirmed');
  await assert.rejects(unlockAchievement(c,550,'SECOND',options),/one minute/);assert.equal(sends,1);
  time+=60000;assert.equal((await unlockAchievement(c,550,'SECOND',options)).outcome,'confirmed');assert.equal(sends,2);
});
test('changed schemas, extra stats and a mismatched write acknowledgement never confirm',async()=>{
  for(const final of [snap(550,1,{bits:{'2':{name:'ADDED'}}}),snap(550,1,{extra:{stats:[{stat_id:7,stat_value:1},{stat_id:9,stat_value:10},{stat_id:10,stat_value:1}]}})]){
    let reads=0;const r=await unlockAchievement(client(),550,'FIRST',{read:async()=>++reads===1?snap():final,send:async()=>ack(550)});assert.equal(r.outcome,'unknown');
  }
  let reads=0;const r=await unlockAchievement(client(),550,'FIRST',{read:async()=>snap(550,++reads===1?0:1),send:async()=>ack(730)});assert.notEqual(r.outcome,'confirmed');
});
