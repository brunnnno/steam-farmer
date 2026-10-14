'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {prepareChanges,verifyChanges,selection,historyRevision}=require('../lib/achievement-changes');
const {applyChanges}=require('../lib/achievement-writer');const {floatBits}=require('../lib/float-progress');
function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
const progress=goal=>({max_val:String(goal),value:{operation:'statvalue',operand1:'COUNT'}});
function snapshot({bits={0:{name:'A'},1:{name:'B'},2:{name:'OTHER'}},mask=4,value=0,type='INT',stat={},block={},extraStats={},stats}={}){
  return {game_id:'550',eresult:1,crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits,...block},9:{type,name:'COUNT',min:'0',max:'100',...stat},...extraStats}}}),stats:stats||[{stat_id:7,stat_value:mask>>>0},{stat_id:9,stat_value:type==='FLOAT'?floatBits(value):value>>>0},{stat_id:20,stat_value:123}]};
}
const choose=(...names)=>names.map(apiname=>({apiname,action:'unlock'})),remove=(...names)=>names.map(apiname=>({apiname,action:'remove'}));
const evidence=(apiname,bitIndex,change)=>({appid:550,apiname,statId:7,bitIndex,before:false,after:true,outcome:'confirmed',checkedAt:'2026-10-13T12:00:00Z',...(change?{progressChanges:[{statId:9,statName:'COUNT',type:'INT',...change}]}:{})});
const final=(s,plan)=>({...s,crc_stats:13,stats:[...plan.expectedValues].map(([stat_id,stat_value])=>({stat_id,stat_value})),librarySummary:{total:plan.view.achievements.length,unlocked:plan.view.achievements.filter(r=>{const effect=plan.effects.find(e=>e.apiname===r.apiname);return effect?effect.after:r.unlocked;}).length,cacheTime:Math.floor(Date.now()/1000)}});
const ack={result:1,gameId:'550',stale:false,rejectedStats:[]};
test('a cleared bit cannot confirm removal with missing, older or conflicting Steam library evidence',()=>{
  const s=snapshot({mask:7}),p=prepareChanges(s,550,remove('A')),good=final(s,p);
  for(const librarySummary of [null,{...good.librarySummary,cacheTime:1},{...good.librarySummary,unlocked:3},{...good.librarySummary,total:4}])assert.equal(verifyChanges(s,{...good,librarySummary},p,ack).confirmed,false);
  assert.equal(verifyChanges(s,good,p,ack).confirmed,true);
  assert.throws(()=>prepareChanges({...s,librarySummary:{total:3,unlocked:2,cacheTime:1}},550,remove('A')),/complete/);
});
test('multiple selected bits combine into one mask while preserving every unrelated bit/statistic',()=>{
  const s=snapshot(),plan=prepareChanges(s,550,choose('B','A'));assert.deepEqual(plan.selection,choose('A','B'));assert.deepEqual(plan.payload.stats,[{stat_id:7,stat_value:7}]);assert.equal(s.stats[0].stat_value,4);assert.equal(verifyChanges(s,final(s,plan),plan,ack).confirmed,true);
  const edge=snapshot({bits:{0:{name:'A'},31:{name:'HIGH'}},mask:1});const p=prepareChanges(edge,550,choose('HIGH'));assert.equal(p.payload.stats[0].stat_value,0x80000001);
});
test('any verified unrestricted unlock can be removed while unresolved attempts remain blocked',()=>{
  const s=snapshot({mask:7}),p=prepareChanges(s,550,remove('A','B'));assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:4}]);assert.equal(p.payload.explicit_reset,false);assert.equal(verifyChanges(s,final(s,p),p,ack).confirmed,true);
  for(const outcome of ['unknown','requested','rejected'])assert.throws(()=>prepareChanges(s,550,remove('A'),new Map([['A',{...evidence('A',0),outcome}]])),/unresolved/);
  assert.ok(prepareChanges(s,550,remove('A'),new Map([['A',{...evidence('A',31),before:true}]])));
});

test('confirmed removal allows a separately reviewed new activation while unresolved history blocks it',()=>{
  const s=snapshot(),removed={...evidence('A',0),action:'remove',before:true,after:false};assert.ok(prepareChanges(s,550,choose('A'),new Map([['A',removed]])).payload);
  for(const receipt of [evidence('A',0),{...removed,outcome:'requested'},{...removed,outcome:'unknown'}])assert.throws(()=>prepareChanges(s,550,choose('A'),new Map([['A',receipt]])));
});
test('a shared counter requires selecting all newly crossed unlocks and reviews still-locked progress',()=>{
  const bits={0:{name:'A',progress:progress(10)},1:{name:'B',progress:progress(20)},2:{name:'OTHER',progress:progress(100)}},s=snapshot({bits,mask:0}),p=prepareChanges(s,550,choose('A','B'));
  assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:3},{stat_id:9,stat_value:20}]);assert.equal(p.effects.length,3);assert.equal(p.effects.find(e=>e.apiname==='OTHER').after,false);assert.throws(()=>prepareChanges(s,550,choose('B')),/Add it to the selection/);
  const receipts=new Map([['A',evidence('A',0,{before:0,after:20})],['B',evidence('B',1,{before:0,after:20})]]);const current=final(s,p),undo=prepareChanges(current,550,remove('A','B'),receipts);assert.deepEqual(undo.progressChanges,[]);assert.equal(undo.expectedValues.get(9),20);assert.equal(verifyChanges(current,final(current,undo),undo,ack).confirmed,true);
});
test('removing progressed achievements preserves later gameplay, shared and increment-only counters',()=>{
  const bits={0:{name:'A',progress:progress(10)},1:{name:'B',progress:progress(20)},2:{name:'OTHER',progress:progress(100)}};
  for(const value of [0,20,21,100])for(const stat of [{},{incrementonly:'1'}]){
    const s=snapshot({bits,mask:7,value,stat}),p=prepareChanges(s,550,remove('A','B'));
    assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:4}]);assert.deepEqual(p.progressChanges,[]);assert.equal(p.expectedValues.get(9),value);assert.equal(p.effects.length,2);assert.match(p.effects[0].warning,/unchanged/);assert.equal(verifyChanges(s,final(s,p),p,ack).confirmed,true);
  }
});

test('decimal unlocks review raw values and removals preserve all decimal progress',()=>{
  const bits={0:{name:'A',progress:progress(10.5)}},s=snapshot({bits,type:'FLOAT',value:1.25,mask:0}),p=prepareChanges(s,550,choose('A'));assert.deepEqual(p.payload.stats,[{stat_id:9,stat_value:floatBits(10.5)}]);assert.equal(verifyChanges(s,final(s,p),p,ack).confirmed,true);
  const receipts=new Map([['A',{...evidence('A',0),progressChanges:p.progressChanges}]]),current=final(s,p),undo=prepareChanges(current,550,remove('A'),receipts);assert.deepEqual(undo.payload.stats,[{stat_id:7,stat_value:0}]);assert.equal(undo.expectedValues.get(9),floatBits(10.5));assert.equal(verifyChanges(current,final(current,undo),undo,ack).confirmed,true);
  assert.equal(prepareChanges(snapshot({bits,type:'FLOAT',value:11,mask:1}),550,remove('A'),receipts).expectedValues.get(9),floatBits(11));
});
test('invalid selections, ambiguous bits and restricted or complex dependencies cannot write',()=>{
  for(const input of [[],Array.from({length:33},(_,i)=>({apiname:String(i),action:'unlock'})),[...choose('A'),...remove('A')],[{apiname:'A',action:'reset'}],[{apiname:'A',action:'unlock',all:true}]])assert.throws(()=>selection(input));
  const s=snapshot();assert.throws(()=>prepareChanges(s,550,choose('UNKNOWN')));assert.throws(()=>prepareChanges({...s,crc_stats:undefined},550,choose('A')));assert.throws(()=>prepareChanges({...s,stats:[...s.stats,s.stats[2]]},550,choose('A')));
  for(const block of [{permission:'2'},{bSetByTrustedGS:'1'},{bSetByTrustedGS:'unknown'}])assert.throws(()=>prepareChanges(snapshot({block}),550,choose('A')));
  assert.throws(()=>prepareChanges(snapshot({bits:{0:{name:'A'},'00':{name:'B'}},mask:0}),550,choose('A')));
  assert.throws(()=>prepareChanges(snapshot({bits:{0:{name:'A',progress:{...progress(10),value:{operation:'add',operand1:'COUNT',operand2:'1'}}}},mask:0}),550,choose('A')));
});
test('every reviewed raw value, achievement state, schema and clean acknowledgement must verify',()=>{
  const s=snapshot(),p=prepareChanges(s,550,choose('A','B')),good=final(s,p);
  for(const bad of [{...good,crc_stats:undefined},{...good,schema:snapshot({bits:{0:{name:'A'},1:{name:'B'},3:{name:'OTHER'}}}).schema},{...good,stats:good.stats.map(v=>v.stat_id===7?{...v,stat_value:15}:v)},{...good,stats:[...good.stats,good.stats[2]]},{...good,stats:good.stats.map(v=>v.stat_id===20?{...v,stat_value:124}:v)}])assert.equal(verifyChanges(s,bad,p,ack).confirmed,false);
  for(const bad of [null,{...ack,stale:true},{...ack,rejectedStats:[{statId:7}]},{...ack,gameId:'440'},{...ack,result:2}])assert.equal(verifyChanges(s,good,p,bad).confirmed,false);
});

test('removal fails closed on missing versions, ambiguous raw stats and protected bits; mixed shared-counter removal is separate',()=>{
  const s=snapshot({mask:7});for(const bad of [{...s,crc_stats:undefined},{...s,stats:[...s.stats,s.stats[0]]},snapshot({mask:7,block:{permission:'2'}}),snapshot({mask:7,block:{bSetByTrustedGS:'1'}})])assert.throws(()=>prepareChanges(bad,550,remove('A')));
  const bits={0:{name:'A',progress:progress(10)},1:{name:'B',progress:progress(20)}};assert.throws(()=>prepareChanges(snapshot({bits,mask:1}),550,[...remove('A'),...choose('B')]),/separately/);
  const initial=snapshot({bits,mask:3,value:20}),p=prepareChanges(initial,550,remove('A')),changed=final(initial,p);changed.stats=changed.stats.map(v=>v.stat_id===9?{...v,stat_value:0}:v);assert.equal(verifyChanges(initial,changed,p,ack).confirmed,false);
});
test('reviews bind both current Steam data and persistent history independently of JSONB key order',()=>{
  const s=snapshot(),r=evidence('A',0),reversed=Object.fromEntries(Object.entries(r).reverse());assert.equal(historyRevision(new Map([['A',r]]),['A']),historyRevision(new Map([['A',reversed]]),['A']));
  const p=prepareChanges(s,550,choose('A'));assert.throws(()=>prepareChanges({...s,crc_stats:13},550,choose('A'),new Map(),p.revision),/changed/);assert.throws(()=>prepareChanges(s,550,choose('A'),new Map([['A',r]]),p.revision));
});
test('typed executor sends once after durable reservation, verifies removals and cannot retry an uncertain operation',async()=>{
  const s=snapshot({mask:7}),receipts=new Map([['A',evidence('A',0)],['B',evidence('B',1)]]),p=prepareChanges(s,550,remove('A','B'),receipts),client=Object.assign(new EventEmitter(),{steamID:{toString:()=> '76561198000000001'},_send(){}});let sends=0,reads=0,reserved=false;
  const options={expectedRevision:p.revision,readHistory:async()=>receipts,read:async()=>++reads===1?s:final(s,p),beforeSend:async()=>{reserved=true;return {operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',...p};},send:async(_,payload)=>{assert.equal(reserved,true);assert.deepEqual(payload.stats,[{stat_id:7,stat_value:4}]);sends++;return {game_id:'550',eresult:1};}};
  const result=await applyChanges(client,550,remove('A','B'),options);assert.equal(result.outcome,'confirmed');assert.equal(sends,1);
  const pending=Object.assign(new EventEmitter(),{steamID:client.steamID,_send(){}});const unknown={...options,read:async()=>s,send:async()=>{sends++;throw Error('Timeout');}};assert.equal((await applyChanges(pending,550,remove('A','B'),unknown)).outcome,'unknown');await assert.rejects(applyChanges(pending,550,remove('A','B'),unknown),/already attempted/);assert.equal(sends,2);
  const fresh=Object.assign(new EventEmitter(),{steamID:client.steamID,_send(){}});await assert.rejects(applyChanges(fresh,550,remove('A','B'),{...unknown,beforeSend:async()=>{throw Error('History unavailable');}}));assert.equal(sends,2);
});
