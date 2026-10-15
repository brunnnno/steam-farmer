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
  assert.throws(()=>prepareChanges({...s,librarySummary:{total:3,unlocked:2,cacheTime:Math.floor(Date.now()/1000)}},550,remove('A')),/complete/);
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
  const s=snapshot(),removed={...evidence('A',0),action:'remove',before:true,after:false};assert.throws(()=>prepareChanges(s,550,choose('A'),new Map([['A',removed]])),/awaiting/);s.librarySummary={total:3,unlocked:1,cacheTime:Math.floor(Date.now()/1000)};assert.ok(prepareChanges(s,550,choose('A'),new Map([['A',removed]])).payload);
  for(const librarySummary of [null,{...s.librarySummary,cacheTime:1},{...s.librarySummary,unlocked:2}])assert.throws(()=>prepareChanges({...s,librarySummary},550,choose('A'),new Map([['A',removed]])));
  assert.ok(prepareChanges({...s,librarySummary:{total:3,unlocked:2,cacheTime:1}},550,choose('B'),new Map([['A',removed]])).payload);
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

test('bulk unlock_all and lock_all handle >32 achievements, mixed FLOAT/bit blocks, counter resets and retoggling',()=>{
  const {buildBulkSelection}=require('../lib/achievement-changes');
  const {cleanOperation}=require('../lib/achievement-operations');
  const bits={
    0:{name:'BIT_0'},
    1:{name:'INT_SHARED_1',progress:progress(10)},
    2:{name:'INT_SHARED_2',progress:progress(50)},
    3:{name:'FLOAT_1',progress:{max_val:'12.5',value:{operation:'statvalue',operand1:'DIST'}}},
    4:{name:'SERVER_PROTECTED',permission:'2'}
  };
  for(let i=5;i<32;i++)bits[i]={name:'EXTRA_'+i};
  const extraBlocks={};
  for(let b=1;b<=3;b++){
    const bBits={};
    for(let i=0;i<20;i++)bBits[i]={name:`BULK_${b}_${i}`};
    extraBlocks[100+b]={type:'4',bits:bBits};
  }
  const s={
    game_id:'550',eresult:1,crc_stats:55,
    schema:kv({'550':{stats:{
      7:{type:'4',bits},
      ...extraBlocks,
      9:{type:'INT',name:'COUNT',min:'0',max:'100'},
      10:{type:'FLOAT',name:'DIST',min:'0',max:'100'}
    }}}),
    stats:[
      {stat_id:7,stat_value:0},
      {stat_id:101,stat_value:0},
      {stat_id:102,stat_value:0},
      {stat_id:103,stat_value:0},
      {stat_id:9,stat_value:0},
      {stat_id:10,stat_value:floatBits(1.5)}
    ]
  };
  const unlockSel=buildBulkSelection(s,550,'unlock_all');
  assert.equal(unlockSel.length,91);
  assert.ok(!unlockSel.some(x=>x.apiname==='SERVER_PROTECTED'));
  const unlockPlan=prepareChanges(s,550,unlockSel,new Map(),undefined,{bulk:true});
  assert.equal(unlockPlan.bulk,true);
  assert.equal(unlockPlan.effects.length,91);
  assert.equal(unlockPlan.progressChanges.length,2);
  const unlockedSnap=final(s,unlockPlan);
  assert.equal(verifyChanges(s,unlockedSnap,unlockPlan,ack).confirmed,true);

  const lockSel=buildBulkSelection(unlockedSnap,550,'lock_all');
  assert.equal(lockSel.length,91);
  const lockPreserve=prepareChanges(unlockedSnap,550,lockSel,new Map(),undefined,{bulk:true,resetCounters:false});
  assert.equal(lockPreserve.progressChanges.length,0);
  const lockReset=prepareChanges(unlockedSnap,550,lockSel,new Map(),undefined,{bulk:true,resetCounters:true});
  assert.equal(lockReset.progressChanges.length,2);
  assert.equal(lockReset.progressChanges.find(p=>p.statName==='COUNT').after,0);
  assert.equal(lockReset.progressChanges.find(p=>p.statName==='DIST').after,0);
  const lockedSnap=final(unlockedSnap,lockReset);
  assert.equal(verifyChanges(unlockedSnap,lockedSnap,lockReset,ack).confirmed,true);

  // Retoggling after previous confirmed unlock/remove receipts works in bulk/retoggle mode
  const priorReceipts=new Map(unlockSel.map(item=>[item.apiname,evidence(item.apiname,0)]));
  const retogglePlan=prepareChanges(s,550,unlockSel,priorReceipts,undefined,{bulk:true,allowRetoggle:true});
  assert.equal(retogglePlan.effects.length,91);

  // Large bulk receipt compaction stays within the 64 KiB JSONB budget
  const hugeEffects=Array.from({length:500},(_,i)=>({apiname:'ACH_'+i,name:'Achievement title '+i+' '.repeat(8),statId:100,bitIndex:i%32,action:'unlock',before:false,after:true,progressChanges:[]}));
  const cleaned=cleanOperation({...unlockPlan,bulk:true,effects:hugeEffects,selection:hugeEffects.map(e=>({apiname:e.apiname,action:'unlock'}))});
  assert.ok(JSON.stringify(cleaned).length<=65536);
  assert.equal(cleaned.effectsTruncated,true);
  assert.equal(cleaned.totalEffects,500);
  assert.equal(cleaned.effects.length,64);
});

test('Sniper Ghost Warrior 24-achievement scenario: unlocks remaining 10 progress achievements of all types and locks all 24 even when librarySummary lags',()=>{
  const {buildBulkSelection}=require('../lib/achievement-changes');
  const bits={};
  for(let i=0;i<14;i++)bits[i]={name:'ACT_'+(i+1)};
  bits[14]={name:'ELECTRICIAN',progress:{max_val:'5',value:{operation:'statvalue',operand1:'CABLES'}}};
  bits[15]={name:'FALLEN_EAGLE',progress:{max_val:'10.000000',value:{operation:'statvalue',operand1:'BIRDS'}}};
  bits[16]={name:'CLOSE_RANGE',progress:{max_val:'250',value:{operation:'statvalue',operand1:'PISTOL_KILLS'}}};
  bits[17]={name:'SNIPER_EXPERT',progress:{max_val:'250',value:{operation:'statvalue',operand1:'SNIPER_KILLS'}}};
  bits[18]={name:'SNIPER_MASTER',progress:{max_val:'500',value:{operation:'statvalue',operand1:'SNIPER_KILLS'}}};
  bits[19]={name:'COMPLEX_PROG',progress:{max_val:'50',value:{operation:'add',operand1:'CABLES',operand2:'BIRDS'}}};
  bits[20]={name:'FLOAT_UNBOUNDED',progress:{max_val:'100.5',value:{operation:'statvalue',operand1:'HEADSHOT_DIST'}}};
  bits[21]={name:'AGGREGATED_PROG',progress:{max_val:'25',value:{operation:'statvalue',operand1:'AGG_STAT'}}};
  bits[22]={name:'PERMISSION_ONE',permission:'1'};
  bits[23]={name:'TRUSTED_UNKNOWN',bSetByTrustedGS:'maybe'};

  const s={
    game_id:'34830',eresult:1,crc_stats:77,
    schema:kv({'34830':{stats:{
      1:{type:'4',bits},
      2:{type:'INT',name:'CABLES',min:'0',max:'0',maxchange:'1'},
      3:{type:'INT',name:'BIRDS',min:'0',max:'0'},
      4:{type:'INT',name:'PISTOL_KILLS',min:'0',max:'0'},
      5:{type:'INT',name:'SNIPER_KILLS',min:'0',max:'0',maxchange:'5'},
      6:{type:'FLOAT',name:'HEADSHOT_DIST',min:'0.000000',max:'0.000000'},
      7:{type:'INT',name:'AGG_STAT',aggregated:'1'}
    }}}),
    // First 14 bits are already unlocked (0x3fff), PISTOL_KILLS (stat 4) omitted by Steam
    stats:[{stat_id:1,stat_value:0x3fff},{stat_id:2,stat_value:0},{stat_id:3,stat_value:0},{stat_id:5,stat_value:0},{stat_id:6,stat_value:0},{stat_id:7,stat_value:0}],
    librarySummary:{total:24,unlocked:14,cacheTime:Math.floor(Date.now()/1000)}
  };

  // Unlock all remaining 10 achievements (indices 14..23)
  const unlockSel=buildBulkSelection(s,34830,'unlock_all');
  assert.equal(unlockSel.length,10);
  const unlockPlan=prepareChanges(s,34830,unlockSel,new Map(),undefined,{bulk:true});
  assert.equal(unlockPlan.effects.length,10);
  assert.equal(unlockPlan.payload.explicit_reset,false);
  const allUnlockedSnap={
    ...final(s,unlockPlan),
    // Simulate lagging Steam librarySummary still reporting 14/24
    librarySummary:{total:24,unlocked:14,cacheTime:100}
  };
  assert.equal(verifyChanges(s,allUnlockedSnap,unlockPlan,{...ack,gameId:'34830'}).confirmed,true);

  // Lock all 24 unlocked achievements even while librarySummary lags at 14/24
  const lockSel=buildBulkSelection(allUnlockedSnap,34830,'lock_all');
  assert.equal(lockSel.length,24);
  const lockPlan=prepareChanges(allUnlockedSnap,34830,lockSel,new Map(),undefined,{bulk:true,resetCounters:true});
  assert.equal(lockPlan.effects.length,24);
  assert.equal(lockPlan.payload.explicit_reset,false);
  assert.ok(Array.isArray(lockPlan.resetAllStats));
  assert.ok(lockPlan.progressChanges.every(p=>p.after===0));
  const allLockedSnap={
    ...final(allUnlockedSnap,lockPlan),
    // Simulate lagging Steam librarySummary still reporting 14/24
    librarySummary:{total:24,unlocked:14,cacheTime:100}
  };
  assert.equal(verifyChanges(allUnlockedSnap,allLockedSnap,lockPlan,{...ack,gameId:'34830'}).confirmed,true);
});

test('real store transport adaptive 3-tier removal falls back cleanly when explicit_reset or incrementonly reset is rejected and never sets 0 bits to 1',async()=>{
  const Schema=require('steam-user/protobufs/generated/_load.js');
  const EMsg=require('steam-user/enums/EMsg');
  const {parseSnapshot}=require('../lib/steam-protocol');
  const {buildBulkSelection}=require('../lib/achievement-changes');
  const {AchievementJournal}=require('../lib/achievement-journal');
  const {AchievementOperations}=require('../lib/achievement-operations');
  const bits={0:{name:'ACT_1'},1:{name:'ACT_2'},2:{name:'SNIPER_KILLER',progress:{max_val:'500',value:{operation:'statvalue',operand1:'SNIPER_KILLS'}}},3:{name:'HEADSHOT_PRO',progress:{max_val:'250',value:{operation:'statvalue',operand1:'HEADSHOTS'}}}};
  const gameSchema=kv({'34830':{stats:{
    1:{type:'4',bits},
    2:{type:'INT',name:'SNIPER_KILLS',min:'0',max:'1000',incrementonly:'1'},
    3:{type:'INT',name:'HEADSHOTS',min:'0',max:'1000',incrementonly:'0'}
  }}});
  // Verify parseSnapshot never marks locked bits as unlocked even when achievement_blocks has timestamps and librarySummary has advisory=true & unlocked>0
  const summary={unlocked:2,total:4,cacheTime:Math.floor(Date.now()/1000)};
  Object.defineProperty(summary,'advisory',{value:true});
  const partialSnap={
    game_id:'34830',eresult:1,crc_stats:50,schema:gameSchema,
    stats:[{stat_id:1,stat_value:3},{stat_id:2,stat_value:10},{stat_id:3,stat_value:5}],
    achievement_blocks:[{achievement_id:1,unlock_time:[1700000000,1700000000,1700000000,1700000000]}],
    librarySummary:summary
  };
  const parsedPartial=parseSnapshot(partialSnap,34830);
  assert.deepEqual(parsedPartial.achievements.map(a=>a.unlocked),[true,true,false,false]);

  // Simulate full unlock followed immediately (< 1 minute) by full lock with real AchievementOperations + guardOperations
  const opsRows=[],targetRows=[];
  const pool={
    on(){},
    async query(sql,args=[]){return this._exec(sql,args);},
    async connect(){return {query:(sql,args=[])=>this._exec(sql,args),release(){}};},
    async _exec(sql,args=[]){
      if(sql.includes('to_regclass'))return {rows:[{operations:'t',targets:'t',reservations:'t',present:'t'}]};
      if(sql.startsWith('BEGIN')||sql.startsWith('COMMIT')||sql.startsWith('ROLLBACK')||sql.startsWith('SET LOCAL')||sql.includes('pg_advisory_xact_lock')||sql.startsWith('CREATE'))return {rows:[]};
      if(sql.startsWith('UPDATE steamfarmer_operation_targets SET reserved=FALSE')){for(const r of targetRows)if(r.account_id===args[0])r.reserved=false;return {rows:[]};}
      if(sql.startsWith('UPDATE steamfarmer_achievement_operations')){for(const r of opsRows)if(r.account_id===args[0]&&(args.length<3||r.operation_id===args[1]))r.receipt=args[2]||r.receipt;return {rows:[]};}
      if(sql.startsWith('INSERT INTO steamfarmer_achievement_operations')){opsRows.push({account_id:args[0],operation_id:args[1],appid:args[2],receipt:structuredClone(args[3]),created_at:new Date()});return {rows:[]};}
      if(sql.startsWith('INSERT INTO steamfarmer_operation_targets')){for(const e of JSON.parse(args[3]))targetRows.push({account_id:args[0],operation_id:args[1],appid:args[2],apiname:e.apiname,receipt:e,reserved:true,created_at:new Date()});return {rows:[]};}
      if(sql.includes('SELECT receipt FROM steamfarmer_achievement_operations WHERE account_id=$1 AND operation_id=$2')){const f=opsRows.find(r=>r.account_id===args[0]&&r.operation_id===args[1]);return {rows:f?[{receipt:structuredClone(f.receipt)}]:[]};}
      if(sql.includes("INTERVAL '1 minute'"))return {rows:opsRows.filter(r=>r.account_id===args[0]).map(()=>({}))};
      if(sql.includes('WHERE account_id= AND reserved'))return {rows:targetRows.filter(r=>r.account_id===args[0]&&r.reserved)};
      if(sql.startsWith('SELECT COUNT')||sql.includes('SELECT (SELECT COUNT(*)'))return {rows:[{count:opsRows.length}]};
      return {rows:[]};
    }
  };
  const journal=new AchievementJournal({cfg:{},save(){},pool});
  const operations=new AchievementOperations(journal);
  let serverStats=new Map([[1,15],[2,500],[3,250]]),crc=100;
  const sentPayloads=[];
  const client=Object.assign(new EventEmitter(),{
    steamID:{toString:()=>'76561198000000001'},
    _currentJobID:0,
    _jobs:new Map(),
    gamesPlayed(){},
    _send(header,body,cb){
      const job=String(++this._currentJobID);
      this._jobs.set(job,cb);
      if(header.msg===EMsg.ClientStoreUserStats2){
        const decoded=Schema.CMsgClientStoreUserStats2.decode(body);
        sentPayloads.push(decoded);
        // Simulate Steam rejecting explicit_reset:true when incrementonly stat (stat_id:2) is decreased to 0
        if(decoded.explicit_reset||decoded.stats.some(s=>s.stat_id===2&&s.stat_value<500)){
          queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({
            game_id:'34830',eresult:1,crc_stats:++crc,stats_out_of_date:false,
            stats_failed_validation:[{stat_id:2,reverted_stat_value:500}]
          }).finish()),{msg:EMsg.ClientStoreUserStatsResponse}));
          return;
        }
        for(const s of decoded.stats)serverStats.set(s.stat_id,s.stat_value>>>0);
        queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({
          game_id:'34830',eresult:1,crc_stats:++crc,stats_out_of_date:false,stats_failed_validation:[]
        }).finish()),{msg:EMsg.ClientStoreUserStatsResponse}));
      }
    }
  });
  const readSnap=async()=>({
    game_id:'34830',eresult:1,crc_stats:crc,schema:gameSchema,
    stats:[...serverStats].map(([stat_id,stat_value])=>({stat_id,stat_value})),
    achievement_blocks:[{achievement_id:1,unlock_time:[1700000000,1700000000,1700000000,1700000000]}],
    librarySummary:summary
  });
  const initSnap=await readSnap();
  const lockSel=buildBulkSelection(initSnap,34830,'lock_all');
  assert.equal(lockSel.length,4);
  const previewPlan=prepareChanges(initSnap,34830,lockSel,new Map(),undefined,{bulk:true,resetCounters:true});
  // Seed an existing operation 5 seconds ago to prove guardOperations does not throw 429 when overrideCooldown/bulk is true
  opsRows.push({account_id:'76561198000000001',operation_id:'11111111-1111-1111-1111-111111111111',appid:34830,receipt:{outcome:'confirmed',checkedAt:new Date().toISOString()},created_at:new Date()});
  const res=await applyChanges(client,34830,lockSel,{
    expectedRevision:previewPlan.revision,
    bulk:true,resetCounters:true,allowRetoggle:true,overrideCooldown:true,
    read:readSnap,
    readHistory:()=>operations.latest('76561198000000001',34830),
    beforeSend:plan=>operations.reserve('76561198000000001',plan,{overrideCooldown:true})
  });
  await operations.finish('76561198000000001',res);
  assert.equal(res.outcome,'confirmed');
  assert.equal(serverStats.get(1),0);
  assert.equal(serverStats.get(3),0);
  // Ensure no payload ever set achievement bits (stat_id:1) to non-zero during lock_all
  assert.ok(sentPayloads.every(p=>p.stats.filter(s=>s.stat_id===1).every(s=>s.stat_value===0)));
});
