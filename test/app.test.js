'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createApp } = require('../bot');
const { atomicWrite, Vault, appId, hour, sleepNow } = require('../lib/core');
const { parseXml, parseHtml, parseCards } = require('../lib/steam-data');
const PASSWORD = 'panel-test-password-123';
test('live readings coalesce, use scoped revisions, detect external changes and never send writes',async t=>{
  let reads=0,unlocked=false,progress=1,writes=0;
  const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{protocolReader:async()=>{reads++;return {source:'Steam synthetic',verified:true,checkedAt:new Date().toISOString(),achievements:[{apiname:'A',name:'A',unlocked,compatibility:{status:'provisional',canUnlock:!unlocked},progressDetails:{statName:'COUNT',type:'1',maximum:10,currentValue:progress}}]};},individualWriter:async()=>{writes++;},changesWriter:async()=>{writes++;}});
  await f.login();await f.request('/api/status');f.app.states.get('a').connected=true;f.app.clients.set('a',new FakeUser({}));
  const path='/api/achievements?accountId=a&appid=550&method=protocol',first=await f.request(path+'&live=1');assert.match(first.data.stateRevision,/^[a-f0-9]{64}$/);assert.equal(reads,1);
  const same=await f.request(path+'&live=1&revision='+first.data.stateRevision);assert.equal(same.data.unchanged,true);assert.equal(same.data.achievements,undefined);assert.equal(reads,1);
  const forced=await f.request(path+'&live=1&refresh=1&revision='+first.data.stateRevision);assert.equal(forced.data.unchanged,true);assert.equal(reads,2);
  unlocked=true;progress=2;const changed=await f.request(path+'&refresh=1&revision='+first.data.stateRevision);assert.notEqual(changed.data.stateRevision,first.data.stateRevision);assert.equal(changed.data.achievements[0].unlocked,true);assert.equal(changed.data.observedChanges.counts.unlock,1);assert.equal(changed.data.observedChanges.counts.progress,1);
  unlocked=false;const removed=await f.request(path+'&refresh=1&revision='+changed.data.stateRevision);assert.equal(removed.data.observedChanges.counts.remove,1);
  const other=await f.request(path.replace('550','240')+'&live=1&revision='+removed.data.stateRevision);assert.notEqual(other.data.stateRevision,removed.data.stateRevision);assert.equal(other.data.unchanged,undefined);
  assert.equal((await f.request(path+'&revision=not-a-revision')).response.status,400);assert.equal(writes,0);
});

test('real-format unrecorded unlocked bits expose removal and preview without reservations or Steam writes',async t=>{
  function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
  const snapshot={game_id:'550',eresult:1,crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'NATURAL',progress:{max_val:'10',value:{operation:'statvalue',operand1:'COUNT'}}},1:{name:'NATURAL_BIT'}}},9:{type:'INT',name:'COUNT'}}}}),stats:[{stat_id:7,stat_value:3},{stat_id:9,stat_value:0}]};
  const receipts=new Map(),operations={latest:async()=>receipts,schema:async()=>true,list:async()=>[],reserve:async()=>{throw Error('A preview must not reserve');}};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{operationsJournal:operations,protocolReader:async()=>require('../lib/steam-protocol').parseSnapshot(snapshot,550),progressSnapshotReader:async()=>snapshot,changesWriter:async()=>{throw Error('A preview must not write');},individualWriter:async(_,id,name,options)=>{await options.beforeSend({appid:id,apiname:name});throw Error('A pending removal must not write');}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const read=await f.request('/api/achievements?accountId=main&appid=550&method=protocol');assert.equal(read.data.achievements.every(a=>a.batchSupport.canRemove),true);assert.equal(read.data.achievements.some(a=>a.panelOperationAt),false);
  const preview=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,selection:[{apiname:'NATURAL',action:'remove'},{apiname:'NATURAL_BIT',action:'remove'}]});assert.equal(preview.response.status,200);assert.equal(preview.data.canActivate,true);assert.equal(preview.data.effects.length,2);assert.deepEqual(preview.data.progressChanges,[]);assert.match(preview.data.effects.find(e=>e.apiname==='NATURAL').warning,/unchanged/);
  receipts.set('NATURAL',{outcome:'unknown'});const blocked=await f.request('/api/achievements?accountId=main&appid=550&method=protocol&refresh=1');assert.equal(blocked.data.achievements[0].batchSupport.canRemove,false);assert.match(blocked.data.achievements[0].batchSupport.removalReason,/previous attempt/);
  snapshot.librarySummary={total:2,unlocked:1,cacheTime:Math.floor(Date.now()/1000)};
  const conflict=await f.request('/api/achievements?accountId=main&appid=550&method=auto&refresh=1');assert.equal(conflict.data.readingMethod,'protocol');assert.equal(conflict.data.stateConflict,true);assert.ok(conflict.data.achievements.every(a=>a.unlocked===null&&!a.batchSupport.canRemove));
  const conflictPreview=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,selection:[{apiname:'NATURAL_BIT',action:'remove'}]});assert.equal(conflictPreview.response.status,409);
  snapshot.librarySummary.cacheTime=123;receipts.set('NATURAL',{outcome:'confirmed',action:'remove',before:true,after:false,checkedAt:new Date().toISOString()});
  const stale=await f.request('/api/achievements?accountId=main&appid=550&method=auto&refresh=1');assert.equal(stale.data.staleLibrarySummary,true);assert.equal(stale.data.stateConflict,false);assert.doesNotMatch(stale.data.message,/70|71|conflict/);assert.equal(stale.data.achievements[0].unlocked,null);assert.equal(stale.data.achievements[0].batchSupport.canReactivate,false);assert.equal(stale.data.achievements[1].unlocked,true);assert.equal(stale.data.achievements[1].batchSupport.canRemove,true);
  const unaffected=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,selection:[{apiname:'NATURAL_BIT',action:'remove'}]});assert.equal(unaffected.response.status,200);
  const pending=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,selection:[{apiname:'NATURAL',action:'remove'}]});assert.equal(pending.response.status,409);
  const bypass=await f.request('/api/achievement/unlock',{confirmed:true,accountId:'main',appid:550,apiname:'NATURAL'});assert.equal(bypass.response.status,409);assert.match(bypass.data.error,/reviewed selection/);
});

test('a successful Steam login cancels stale reconnect work; rejected credentials cancel any earlier transient retry',async t=>{
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[],paused:true}]},{connect:true});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const client=f.app.clients.get('main'),st=f.app.states.get('main');client.emit('error',Object.assign(new Error('Transient'),{eresult:2}));assert.ok(st.reconnectTimer);
  client.emit('loggedOn');assert.equal(st.reconnectTimer,null);assert.equal(st.connected,true);assert.equal(st.isPaused,true);
  client.emit('error',Object.assign(new Error('Transient'),{eresult:2}));assert.ok(st.reconnectTimer);client.emit('error',Object.assign(new Error('Rejected'),{eresult:5}));assert.equal(st.reconnectTimer,null);assert.equal(st.connected,false);assert.match(st.error,/rejected/);
});
test('shared API stays read-only without persistent reservations and never bypasses them',async t=>{
  function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
  const bit=(name,goal)=>({name,progress:{max_val:String(goal),value:{operation:'statvalue',operand1:'HEALED'}}});
  const snapshot={eresult:1,game_id:'440',crc_stats:12,schema:kv({'440':{stats:{'7':{type:'4',bits:{'0':bit('DOCTOR',25000),'1':bit('CHIEF',1000000)}},'9':{type:'INT',name:'HEALED'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0}]};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,writes=0;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>snapshot,individualWriter:async(_,id,name,options)=>{
    assert.equal(options.sharedProgress,true);const plan=require('../lib/achievement-writer').prepareShared(snapshot,id,name,{expectedRevision:options.expectedRevision});
    await options.beforeSend({appid:id,apiname:name,checkedAt:new Date().toISOString(),sharedEffects:plan.sharedEffects,groupMembers:plan.groupMembers});writes++;return {outcome:'confirmed'};
  }});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/shared-progress-preview?accountId=main&appid=440&apiname=DOCTOR';assert.equal((await f.request(route)).response.status,401);
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.canActivate,false);assert.equal(preview.data.effects.length,2);
  const body={accountId:'main',appid:440,apiname:'DOCTOR',mode:'shared'};assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true})).response.status,400);
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,revision:preview.data.revision})).response.status,503);assert.equal(writes,0);
});
const TOKEN_EXPIRY=Math.floor(Date.now()/1000)+3600;
test('reviewed selections require authentication, CSRF, main identity, migration and exact confirmation',async t=>{
  function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
  const snapshot={game_id:'550',eresult:1,crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'A'},1:{name:'B'}}}}}}),stats:[{stat_id:7,stat_value:0}]};
  let ready=true,writes=0,finish=0,reservations=0,failReservation=false,failFinish=false;const receipts=new Map();
  const operations={schema:async()=>ready,latest:async()=>receipts,list:async()=>[],reserve:async plan=>{if(failReservation)throw Object.assign(Error('Intent unavailable'),{status:503});reservations++;return require('../lib/achievement-operations').cleanOperation({...plan,operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',checkedAt:new Date().toISOString(),outcome:'requested'});},finish:async(_,result)=>{if(failFinish)throw Error('Result unavailable');finish++;for(const e of result.effects)receipts.set(e.apiname,{...e,operationId:result.operationId,outcome:result.outcome,checkedAt:result.checkedAt});}};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{operationsJournal:{...operations,reserve:(_,plan)=>operations.reserve(plan)},progressSnapshotReader:async()=>snapshot,changesWriter:async(client,id,selected,options)=>{let reads=0;return require('../lib/achievement-writer').applyChanges(client,id,selected,{...options,read:async()=>++reads===1?snapshot:{...snapshot,crc_stats:13,stats:[{stat_id:7,stat_value:3}]},send:async()=>{writes++;return {game_id:'550',eresult:1};}});}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const selection=[{apiname:'A',action:'unlock'},{apiname:'B',action:'unlock'}],body={accountId:'main',appid:550,selection},previewRoute='/api/achievement/change-preview',writeRoute='/api/achievement/change';
  assert.equal((await f.request(previewRoute,body)).response.status,401);await f.login();await f.request('/api/status');assert.equal((await f.request(previewRoute,body,{csrf:false})).response.status,403);
  Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});const client=new FakeUser({});client._send=()=>{};f.app.clients.set('main',client);
  const review=await f.request(previewRoute,body);assert.equal(review.data.canActivate,true);assert.equal(writes,0);assert.equal(reservations,0);assert.equal(review.data.effects.length,2);assert.equal('payload'in review.data,false);assert.equal('view'in review.data,false);
  assert.equal((await f.request(writeRoute,{...body,revision:review.data.revision})).response.status,400);
  assert.equal((await f.request(writeRoute,{...body,revision:'b'.repeat(64),confirmed:true})).response.status,409);assert.equal(writes,0);
  ready=false;assert.equal((await f.request(previewRoute,body)).data.canActivate,false);assert.equal((await f.request(writeRoute,{...body,revision:review.data.revision,confirmed:true})).response.status,503);ready=true;
  failReservation=true;assert.equal((await f.request(writeRoute,{...body,revision:review.data.revision,confirmed:true})).response.status,503);assert.equal(writes,0);failReservation=false;
  const result=await f.request(writeRoute,{...body,revision:review.data.revision,confirmed:true});assert.equal(result.data.outcome,'confirmed');assert.equal(writes,1);assert.equal(reservations,1);assert.equal(finish,1);
});
test('chunked oversized JSON returns a structured 413 and coercible nonnumeric IDs are rejected',async t=>{
  const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]});await f.login();
  for(const appid of [true,false,[550],{value:550},'0x226','5.5e2'])assert.equal((await f.request('/api/add',{accountId:'a',appid})).response.status,400);
  const http=require('node:http'),token=[...f.app.sessions.keys()][0],csrf=f.app.sessions.get(token).csrf;
  const response=await new Promise((resolve,reject)=>{const req=http.request(f.base+'/api/add',{method:'POST',headers:{Cookie:'sf_session='+token,'X-CSRF-Token':csrf,'Content-Type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write('{"accountId":"a","value":"'+'x'.repeat(40000));req.end('x'.repeat(40000)+'"}');});assert.equal(response.status,413);assert.match(response.body,/Request too large/);
});
test('API readings disable HTTP caching of private state',async t=>{
  const f=await fixture(t);await f.login();assert.equal((await f.request('/api/status')).response.headers.get('cache-control'),'no-store');
});
test('free-license requests cannot overlap and a late response cannot be assigned to another Steam identity',async t=>{
  const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]});await f.login();await f.request('/api/status');Object.assign(f.app.states.get('a'),{connected:true});const client=new FakeUser({});let callback,calls=0;client.requestFreeLicense=(_,cb)=>{calls++;callback=cb;};f.app.clients.set('a',client);
  const first=f.request('/api/claim-free',{accountId:'a'});await new Promise(r=>setTimeout(r,20));assert.equal((await f.request('/api/claim-free',{accountId:'a'})).response.status,429);assert.equal(calls,1);
  client.steamID={toString:()=> '76561198000000002'};callback(null,[10],[730]);assert.equal((await first).response.status,409);assert.equal(f.app.states.get('a').claimPending,false);
});
test('rarity metadata cache does not substitute an API-only result for a title-enriched XML lookup',async t=>{
  const modes=[];const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{percentagesReader:async(id,options)=>{modes.push(options.includeTitles);return {appid:id,percentages:{API:10},...(options.includeTitles?{titlePercentages:{title:10}}:{})};}});
  await f.login();const route='/api/achievement/percentages?accountId=a&appid=550';await f.request(route);
  assert.equal((await f.request(route+'&titles=1')).data.titlePercentages.title,10);await f.request(route+'&titles=1');assert.deepEqual(modes,[false,true]);
});
test('decimal library search is authenticated, owned-only, cached and bound to its library revision',async t=>{
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,ownedCalls=0,reads=0;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{protocolReader:async()=>{reads++;return {achievements:[]};}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/float-search?accountId=main';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');assert.equal((await f.request(route)).response.status,409);
  const client=new FakeUser({});client.getUserOwnedApps=async()=>{ownedCalls++;return {apps:Array.from({length:10},(_,i)=>({appid:i+1,name:'Owned '+i}))};};Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true});f.app.clients.set('main',client);
  const first=await f.request(route);assert.equal(first.response.status,200);assert.equal(first.data.nextCursor,8);assert.equal(first.data.writesSent,0);assert.equal(reads,8);
  assert.equal((await f.request(route+'&cursor=8&revision=wrong')).response.status,409);assert.equal(reads,8);
  const last=await f.request(route+'&cursor=8&revision='+first.data.revision);assert.equal(last.data.complete,true);assert.equal(last.data.nextCursor,10);assert.equal(ownedCalls,1);assert.equal(reads,10);
  assert.equal((await f.request(route+'&cursor=-1')).response.status,400);
  assert.equal((await f.request(route+'&cursor=1000&revision='+first.data.revision)).response.status,400);
});
test('decimal preview requires the connected main account, rejects session changes and never writes',async t=>{
  function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
  const snapshot={eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'DECIMAL',progress:{max_val:'10.5',value:{operation:'statvalue',operand1:'DISTANCE'}}}}},'9':{type:'FLOAT',name:'DISTANCE'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0x3fa00000}]};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,writes=0,change=false;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>{if(change)f.app.states.get('main').connected=false;return snapshot;},individualWriter:async()=>{writes++;}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/float-progress-preview?accountId=main&appid=550&apiname=DECIMAL';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');assert.equal((await f.request(route)).response.status,409);
  Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.counter.before,1.25);assert.equal(preview.data.counter.after,10.5);assert.equal(preview.data.canActivate,false);
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,accountId:'main',appid:550,apiname:'DECIMAL',mode:'float',revision:preview.data.revision})).response.status,503);
  change=true;assert.equal((await f.request(route)).response.status,409);assert.equal(writes,0);
});
test('persistent history starts concurrently with Steam reading and failures still block activation',async t=>{
  let releaseSteam,historyStarted=false;
  const steam=new Promise(resolve=>releaseSteam=resolve);
  const journal={ready:async()=>{},status:()=>({available:false}),forGame:async()=>{historyStarted=true;throw Error('Unavailable');},close:async()=>{}};
  const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{achievementJournal:journal,protocolReader:async()=>{
    await steam;return {verified:true,achievements:[{apiname:'REAL',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}}]};
  }});
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('a'),{connected:true});f.app.clients.set('a',new FakeUser({}));
  const pending=f.request('/api/achievements?accountId=a&appid=550&method=protocol');
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(historyStarted,true);releaseSteam();
  const {data}=await pending;assert.equal(data.achievements[0].compatibility.canUnlock,false);assert.match(data.historyWarning,/activation is blocked/);assert.ok(Number.isFinite(data.readDurationMs));
});
test('decimal API binds the review to fresh data and reserves persistent evidence before one typed write',async t=>{
  function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
  const snapshot={eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'DECIMAL',progress:{max_val:'10.5',value:{operation:'statvalue',operand1:'DISTANCE'}}}}},9:{type:'FLOAT',name:'DISTANCE'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0x3fa00000}]};
  let intent,result,writes=0,failHistory=false;const order=[];
  const journal={ready:async()=>{},close:async()=>{},status:()=>({persistent:true,available:!failHistory}),get:async()=>{if(failHistory)throw Object.assign(Error('Unavailable'),{status:503});return intent;},reserve:async(_,id,name,evidence)=>{order.push('reserve');intent={...evidence,outcome:'requested'};},finish:async(_,id,name,value)=>{order.push('finish');result=value;}};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{achievementJournal:journal,operationsJournal:{latest:async()=>new Map()},progressSnapshotReader:async()=>snapshot,individualWriter:async(client,id,name,options)=>{
    assert.equal(options.floatProgress,true);assert.equal(options.allowProgress,false);
    let reads=0;return require('../lib/achievement-writer').unlockAchievement(client,id,name,{...options,read:async()=>{order.push('read');return ++reads===1?snapshot:{...snapshot,crc_stats:13,stats:[{stat_id:7,stat_value:1},{stat_id:9,stat_value:0x41280000}]};},send:async(_,payload)=>{assert.ok(intent);assert.deepEqual(payload.stats,[{stat_id:9,stat_value:0x41280000}]);order.push('send');writes++;return {game_id:'550',eresult:1};}});
  }});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();await f.request('/api/status');const client=new FakeUser({});client._send=()=>{};f.app.clients.set('main',client);Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});
  const route='/api/achievement/float-progress-preview?accountId=main&appid=550&apiname=DECIMAL';let preview=await f.request(route);assert.equal(preview.data.canActivate,true);assert.equal(writes,0);
  const body={accountId:'main',appid:550,apiname:'DECIMAL',mode:'float'};assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true})).response.status,400);
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,revision:'b'.repeat(64)})).response.status,409);assert.equal(writes,0);order.length=0;
  failHistory=true;assert.equal((await f.request(route)).data.canActivate,false);assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,revision:preview.data.revision})).response.status,503);assert.equal(writes,0);assert.equal(intent,undefined);order.length=0;
  failHistory=false;const write=await f.request('/api/achievement/unlock',{confirmed:true,...body,revision:preview.data.revision});assert.equal(write.response.status,200);assert.equal(write.data.outcome,'confirmed');assert.equal(result.progressVerification[0].observedRaw,0x41280000);assert.equal(writes,1);assert.deepEqual(order,['read','reserve','send','read','finish']);assert.equal((await f.request(route)).data.canActivate,false);
});
function token() { return `test.${Buffer.from(JSON.stringify({iss:'steam',sub:'76561198000000001',aud:['client','web'],exp:TOKEN_EXPIRY})).toString('base64url')}.signature`; }
test('hours reject coercible values and cached time-zone formatters preserve cross-midnight schedules',()=>{
  for(const value of [true,false,null,[],[0],'','0x10','1e1'])assert.throws(()=>hour(value));assert.equal(hour('00'),0);assert.equal(hour('23'),23);
  const schedule={enabled:true,start:22,end:3},date=new Date('2026-10-13T03:30:00Z');assert.equal(sleepNow(schedule,'America/Montevideo',date),true);assert.equal(sleepNow(schedule,'UTC',date),false);assert.equal(sleepNow(schedule,'America/Montevideo',date),true);
});
class FakeLogin extends EventEmitter {
  static latest;
  constructor(){super();FakeLogin.latest=this;this.steamID={toString:()=> '76561198000000001'};this.accountName='owner';this.refreshToken=token();}
  async startWithCredentials(details){this.details=details;return {actionRequired:true,validActions:[{type:2,detail:'example.test'}]};}
  async submitSteamGuardCode(code){if(code!=='ABCDE')throw Error();this.emit('authenticated');}
  cancelLoginAttempt(){this.cancelled=true;}
}
class FakeUser extends EventEmitter {
  static latest;
  constructor(options){super();this.options=options;FakeUser.latest=this;this.steamID={toString:()=> '76561198000000001'};this.playingState={blocked:false};this.calls=[];}
  logOn(details){this.details=details;queueMicrotask(()=>this.emit('loggedOn'));}
  gamesPlayed(list){this.calls.push([...list]);}
  setPersona(){} logOff(){} webLogOn(){}
  requestFreeLicense(ids,cb){cb(null,[10],[730]);}
}
async function fixture(t, config = {}, options = {}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'steamfarmer-test-'));
  atomicWrite(path.join(directory,'config.json'),{timezone:'America/Montevideo',accounts:[],discordWebhook:'',...config});
  const prev=process.env.PANEL_PASSWORD;process.env.PANEL_PASSWORD=PASSWORD;
  const app=createApp({directory,silent:true,connect:false,SteamUser:FakeUser,LoginSession:FakeLogin,achievements:async()=>({achievements:[{apiname:'REAL',unlocked:false}],verified:true}),...options});
  if(prev===undefined)delete process.env.PANEL_PASSWORD;else process.env.PANEL_PASSWORD=prev;
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='',csrf='';
  async function request(route,body,opts={}) {
    const headers={...(opts.auth===false?{}:{Cookie:cookie}),...opts.headers};
    if(body!==undefined){headers['Content-Type']='application/json';if(opts.csrf!==false)headers['X-CSRF-Token']=csrf;}
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();return {response,data};
  }
  async function login(){const r=await request('/api/panel/login',{password:PASSWORD});assert.equal(r.response.status,200);cookie=r.response.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;return r;}
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {app,request,login,directory,base};
}
test('validación de IDs y horario de Montevideo, incluido 00:00 y desactivación',()=>{
  assert.throws(()=>appId(-1));assert.throws(()=>appId('1x'));assert.throws(()=>hour(24));assert.equal(hour(0),0);
  assert.equal(sleepNow({enabled:true,start:23,end:2},'America/Montevideo',new Date('2026-10-13T03:30:00Z')),true);
  assert.equal(sleepNow({enabled:false,start:23,end:2},'America/Montevideo',new Date('2026-10-13T03:30:00Z')),false);
  assert.equal(sleepNow({enabled:true,start:0,end:0},'UTC'),false);
});
test('heavy work is bounded, identical reads join, and status remains available while busy',async t=>{let release,calls=0;const gate=new Promise(r=>release=r);const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{achievements:async()=>{calls++;await gate;return {achievements:[],verified:false}}});await f.login();const first=f.request('/api/achievements?accountId=a&appid=240');while(calls!==1)await new Promise(r=>setImmediate(r));const joined=f.request('/api/achievements?accountId=a&appid=240');const busy=await f.request('/api/achievements?accountId=a&appid=550');assert.equal(busy.response.status,429);assert.equal(busy.response.headers.get('retry-after'),'3');assert.equal((await f.request('/api/status')).response.status,200);release();assert.equal((await first).response.status,200);assert.equal((await joined).response.status,200);assert.equal(calls,1);assert.equal((await f.request('/api/achievements?accountId=a&appid=550')).response.status,200);});
test('manual pause survives a Steam reconnect within the same process',async t=>{const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[220],paused:true}]});await f.login();assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,true);f.app.states.delete('a');assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,true);await f.request('/api/toggle',{accountId:'a'});f.app.states.delete('a');assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,false);});
test('automatic achievement reading prefers verified protocol and skips community requests',async t=>{let webCalls=0,timeout;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{protocolReader:async(_,id,opts)=>{timeout=opts.timeoutMs;return {verified:true,achievements:[{apiname:'REAL',unlocked:false}]};},achievements:async()=>{webCalls++;return {verified:true,achievements:[]};}});await f.login();await f.request('/api/status');f.app.states.get('a').connected=true;f.app.clients.set('a',new FakeUser({}));const result=await f.request('/api/achievements?accountId=a&appid=550&method=auto');assert.equal(result.response.status,200);assert.equal(result.data.readingMethod,'protocol');assert.equal(webCalls,0);assert.equal(timeout,2500);});
test('automatic reading falls back to standard sources if protocol cannot verify the list',async t=>{let webCalls=0;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{protocolReader:async()=>({verified:false,achievements:[{unlocked:null}]}),achievements:async()=>{webCalls++;return {verified:true,achievements:[{name:'Verified web result',unlocked:true}]};}});await f.login();await f.request('/api/status');f.app.states.get('a').connected=true;f.app.clients.set('a',new FakeUser({}));const result=await f.request('/api/achievements?accountId=a&appid=550&method=auto');assert.equal(result.response.status,200);assert.equal(result.data.readingMethod,'web');assert.equal(webCalls,1);assert.equal(result.data.achievements[0].unlocked,true);});
test('percentage lookup is private, selected-account scoped and cached without achievement writes',async t=>{let reads=0;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{percentagesReader:async id=>{reads++;return {appid:id,percentages:{REAL:95}};}});const route='/api/achievement/percentages?accountId=a&appid=550';assert.equal((await f.request(route)).response.status,401);await f.login();assert.equal((await f.request('/api/achievement/percentages?appid=550')).response.status,400);assert.equal((await f.request(route)).data.percentages.REAL,95);assert.equal((await f.request(route)).response.status,200);assert.equal(reads,1);});
test('UTF-8 JSON split across request chunks preserves emoji in saved status',async t=>{const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]});const login=await f.login(),cookie=login.response.headers.get('set-cookie').split(';')[0],body=Buffer.from(JSON.stringify({accountId:'a',status:'Testing 😀'})),split=body.indexOf(Buffer.from('😀'))+2;const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(f.base+'/api/custom-status',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':login.data.csrf}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.write(body.subarray(0,split));setTimeout(()=>req.end(body.subarray(split)),5);});assert.equal(response,200);assert.equal(f.app.cfg.accounts[0].customStatus,'Testing 😀');});
test('sesiones cifradas sobreviven reinicio y detectan manipulación',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vault-test-'));try{const v=new Vault(dir);v.set('id','sensitive-token');assert.ok(!fs.readFileSync(v.file,'utf8').includes('sensitive-token'));assert.equal(new Vault(dir).get('id'),'sensitive-token');v.records.id.tag='00'.repeat(16);assert.throws(()=>v.get('id'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('lectura no inventa apiname, conserva 0% y estados desconocidos',()=>{
  const xml='<playerstats><achievements><achievement closed="0"><apiname>REAL</apiname><name>Real</name></achievement></achievements></playerstats>';
  assert.equal(parseXml(xml,{REAL:0})[0].percent,0);assert.equal(parseXml(xml)[0].unlocked,false);
  const list=parseHtml('<div class="achieveRow"><h3>Some title</h3><div class="achieveUnlockTime">Unlocked yesterday</div></div>',false);
  assert.equal(list[0].apiname,null);assert.equal(list[0].unlocked,null);
});
test('cromos: solo juegos con drops pendientes',()=>{
  const html='<div class="badge_row"><a class="badge_row_overlay" href="https://steamcommunity.com/my/gamecards/730/"></a><span class="progress_info_bold">3 card drops remaining</span></div>';
  assert.deepEqual(parseCards(html),[{appid:730,remaining:3}]);
});
test('API privada, cookie HttpOnly, CSRF, origen y logout',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/api/status')).response.status,401);
  const login=await f.login();assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await f.request('/api/status')).response.status,200);
  assert.equal((await f.request('/api/steam/login',{user:'owner',password:'x'},{csrf:false})).response.status,403);
  assert.equal((await f.request('/api/status',undefined,{headers:{Origin:'https://evil.example'}})).response.status,403);
  assert.equal((await f.request('/api/unknown')).response.status,404);
  await f.request('/api/panel/logout',{});assert.equal((await f.request('/api/status')).response.status,401);
});
test('login Steam Guard, persistencia sin contraseña, renovación y anticolisión',async t=>{
  const f=await fixture(t);await f.login();
  const start=await f.request('/api/steam/login',{user:'owner',password:'never-save-this',name:'Cuenta'});assert.equal(start.data.phase,'guard');
  const id=start.data.attemptId;assert.equal((await f.request('/api/steam/guard',{attemptId:id,code:'WRONG'})).response.status,400);
  const done=await f.request('/api/steam/guard',{attemptId:id,code:'ABCDE'});assert.equal(done.data.phase,'authenticated');const aid=done.data.accountId;
  const disk=fs.readFileSync(path.join(f.directory,'config.json'),'utf8');assert.ok(!disk.includes('never-save-this'));assert.ok(!disk.includes('refreshToken'));assert.equal(f.app.vault.get(aid),token());
  await f.request('/api/add',{accountId:aid,appid:730});assert.deepEqual(FakeUser.latest.calls.at(-1),[730]);
  FakeUser.latest.emit('playingState',true,730);assert.deepEqual(FakeUser.latest.calls.at(-1),[]);
  await f.request('/api/toggle',{accountId:aid});await f.request('/api/toggle',{accountId:aid});assert.deepEqual(FakeUser.latest.calls.at(-1),[]);
  FakeUser.latest.emit('playingState',false,0);assert.deepEqual(FakeUser.latest.calls.at(-1),[730]);
  FakeUser.latest.emit('refreshToken',token()+'new');assert.equal(f.app.vault.get(aid),token()+'new');
  const licenses=await f.request('/api/claim-free',{accountId:aid});assert.deepEqual(licenses.data.granted,{packages:[10],apps:[730]});
  await f.request('/api/steam/logout',{accountId:aid});assert.equal(f.app.vault.get(aid),null);
});
test('selección explícita multicuenta, rechazo de escritura de logros y entradas inválidas',async t=>{
  const accounts=['a','b'].map(id=>({id,name:id,user:id,games:[],gameNames:{},sleepMode:{enabled:false,start:3,end:8}}));
  const f=await fixture(t,{accounts});await f.login();
  assert.equal((await f.request('/api/add',{appid:730})).response.status,400);
  await f.request('/api/add',{accountId:'b',appid:730});assert.deepEqual(f.app.cfg.accounts[0].games,[]);assert.deepEqual(f.app.cfg.accounts[1].games,[730]);
  assert.equal((await f.request('/api/add',{accountId:'a',appid:-1})).response.status,400);
  for(const route of ['/api/unlock-batch','/api/lock-batch','/api/queue-achievements'])assert.equal((await f.request(route,{accountId:'a',appid:730,items:[]})).response.status,501);
  const result=await f.request('/api/achievements?accountId=a&appid=730');assert.equal(result.data.achievements[0].unlocked,false);
  await f.request('/api/set-sleep',{accountId:'a',enabled:true,start:0,end:8});assert.equal(f.app.cfg.accounts[0].sleepMode.start,0);
  await f.request('/api/set-sleep',{accountId:'a',enabled:false,start:0,end:8});assert.equal(f.app.states.get('a').isSleepPaused,false);
  assert.equal((await f.request('/api/set-webhook',{webhook:'https://evil.example/api/webhooks/1/token'})).response.status,400);
});
test('login móvil asíncrono y cancelación impiden guardar una sesión tardía',async t=>{
  const f=await fixture(t);await f.login();const start=await f.request('/api/steam/login',{user:'owner',password:'pw'});
  const login=FakeLogin.latest;await f.request('/api/steam/cancel',{attemptId:start.data.attemptId});login.emit('authenticated');assert.equal(f.app.cfg.accounts.length,0);
  const next=await f.request('/api/steam/login',{user:'owner',password:'pw'});FakeLogin.latest.emit('authenticated');
  const status=await f.request('/api/steam/login-status?attemptId='+next.data.attemptId);assert.equal(status.data.phase,'authenticated');
});
test('límite de intentos del panel',async t=>{const f=await fixture(t);for(let i=0;i<5;i++)assert.equal((await f.request('/api/panel/login',{password:'bad'})).response.status,401);assert.equal((await f.request('/api/panel/login',{password:'bad'})).response.status,429);});
test('migración elimina secretos y marcas locales, conserva lista de juegos',async t=>{
  const f=await fixture(t,{user:'owner',pass:'old-password',refreshToken:token(),webPin:'1234',games:[730],unlockedAchievements:{730:['FAKE']},achievementQueue:[{apiname:'FAKE'}]});
  const disk=fs.readFileSync(path.join(f.directory,'config.json'),'utf8');
  for(const secret of ['old-password','refreshToken','webPin','FAKE','unlockedAchievements','achievementQueue'])assert.ok(!disk.includes(secret));
  assert.deepEqual(f.app.cfg.accounts[0].games,[730]);assert.equal(f.app.vault.get(f.app.cfg.accounts[0].id),token());
});
test('health público para Render/UptimeRobot sin revelar datos',async t=>{
  const f=await fixture(t);
  const r=await f.request('/healthz',undefined,{auth:false,headers:{Host:'internal-render-host'}});
  assert.equal(r.response.status,200);assert.deepEqual(r.data,{ok:true});
  const head=await fetch(f.base+'/healthz',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await f.request('/api/status',undefined,{auth:false})).response.status,401);
});
test('Render origen automático, Secure cookie y CSRF detrás del proxy',async t=>{
  const old=process.env.RENDER_EXTERNAL_URL;process.env.RENDER_EXTERNAL_URL='https://steamfarmer-test.onrender.com';
  let f;try{f=await fixture(t);}finally{if(old===undefined)delete process.env.RENDER_EXTERNAL_URL;else process.env.RENDER_EXTERNAL_URL=old;}
  const result=await f.request('/api/panel/login',{password:PASSWORD},{headers:{Origin:'https://steamfarmer-test.onrender.com'}});
  assert.equal(result.response.status,200);assert.match(result.response.headers.get('set-cookie'),/Secure/);
  assert.equal((await f.request('/api/panel/login',{password:PASSWORD},{headers:{Origin:'https://different.example'}})).response.status,403);
});
test('token privado de Render sobrevive recreación de datos sin renovación ni publicación',async t=>{
  const savedToken=token(), previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=savedToken;
  let f;try{f=await fixture(t,{}, {connect:true});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();assert.equal(FakeUser.latest.options.renewRefreshTokens,false);assert.equal(FakeUser.latest.details.refreshToken,savedToken);FakeUser.latest.emit('refreshToken','unexpected-new-token');assert.equal(f.app.vault.get('main'),null);const status=await f.request('/api/status');assert.equal(status.data.accounts[0].tokenSource,'environment');
  assert.ok(!JSON.stringify(status.data).includes(savedToken));
  assert.ok(!fs.readFileSync(path.join(f.directory,'config.json'),'utf8').includes(savedToken));
  assert.equal((await f.request('/api/steam/login',{accountId:'main',user:'owner',password:'pw'})).response.status,409);
  assert.equal((await f.request('/api/steam/logout',{accountId:'main'})).response.status,409);
  assert.equal((await f.request('/api/account/remove',{accountId:'main'})).response.status,409);
});
test('entrada desde ChatGPT permite el panel público pero rechaza API y POST externos',async t=>{
  const f=await fixture(t);const headers={'Sec-Fetch-Site':'cross-site',Origin:'https://chatgpt.com'};
  const root=await fetch(f.base+'/',{headers});assert.equal(root.status,200);assert.match(await root.text(),/\/app.js/);
  assert.equal((await fetch(f.base+'/app.js',{headers})).status,200);
  assert.equal((await fetch(f.base+'/manifest.json',{headers})).status,200);
  await f.login();assert.equal((await f.request('/api/status',undefined,{headers})).response.status,403);
  assert.equal((await f.request('/api/panel/login',{password:PASSWORD},{headers})).response.status,403);
  assert.equal((await f.request('/api/add',{accountId:'main',appid:730},{headers})).response.status,403);
  const badHost = await new Promise(resolve => require('node:http').get(f.base+'/', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }));
  assert.equal(badHost,403);
});
test('caché de logros por cuenta y actualización manual real',async t=>{
  let calls=0;const account={id:'a',name:'a',user:'a',games:[240],gameNames:{},sleepMode:{enabled:false,start:3,end:8}};
  const f=await fixture(t,{accounts:[account]},{achievements:async()=>{calls++;return{achievements:[{name:'One',unlocked:false}],checkedAt:new Date().toISOString()};}});await f.login();
  await f.request('/api/achievements?accountId=a&appid=240');await f.request('/api/achievements?accountId=a&appid=240');assert.equal(calls,1);
  await f.request('/api/achievements?accountId=a&appid=240&refresh=1');assert.equal(calls,2);
});
test('connection status confirms token account, persona and web session without returning cookies',async t=>{
  const f=await fixture(t);await f.login();const login=await f.request('/api/steam/login',{user:'owner',password:'pw'});const done=await f.request('/api/steam/guard',{attemptId:login.data.attemptId,code:'ABCDE'});
  FakeUser.latest.emit('accountInfo','Steam profile name');FakeUser.latest.emit('webSession','sid',['steamLoginSecure=SECRET; Path=/','sessionid=SECRET2']);
  const result=await f.request('/api/status');const a=result.data.accounts.find(a=>a.id===done.data.accountId);
  assert.equal(a.connected,true);assert.equal(a.tokenAccountMatches,true);assert.equal(a.webSessionReady,true);assert.equal(a.linkedSteamId,'76561198000000001');assert.equal(a.profileName,'Steam profile name');assert.ok(!JSON.stringify(result.data).includes('SECRET'));
  assert.equal((await f.request('/api/steam/web-session',{accountId:a.id})).response.status,200);
});
test('public static assets support conditional caching while private APIs stay uncached', async t => {
  const f = await fixture(t);
  const first = await fetch(f.base + '/app.js'); assert.equal(first.status, 200);
  const tag = first.headers.get('etag'); assert.ok(tag); assert.match(first.headers.get('cache-control'), /must-revalidate/);
  const second = await fetch(f.base + '/app.js', { headers: { 'If-None-Match': tag } });
  assert.equal(second.status, 304); assert.equal(await second.text(), '');
  await f.login(); const status = await f.request('/api/status'); assert.equal(status.response.headers.get('cache-control'), 'no-store');
});
test('direct verification requires a connected account and stays separate from web cache',async t=>{
  let calls=0;const f=await fixture(t,{accounts:[{id:'a',name:'Main',games:[]}]},{protocolReader:async()=>{calls++;return {achievements:[{name:'Native',unlocked:true}],verified:true,source:'Steam client protocol'};}});await f.login();
  const route='/api/achievements?accountId=a&appid=550&method=protocol';assert.equal((await f.request(route)).response.status,409);
  f.app.states.get('a').connected=true;
  assert.equal((await f.request(route)).data.source,'Steam client protocol');await f.request(route);assert.equal(calls,1);
  assert.equal((await f.request('/api/achievements?accountId=a&appid=550')).data.achievements[0].apiname,'REAL');
  assert.equal((await f.request('/api/achievements?accountId=a&appid=550&method=unknown')).response.status,400);
  const css=await fetch(f.base+'/style.css',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
});
test('single achievement experiment requires auth, CSRF, exact target and the verified main account',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();
  let calls=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{experimentWriter:async(_,options)=>{calls++;await options.beforeSend({appid:3764200,apiname:'MODEL_API',name:'Model Mania',before:false});return {outcome:'confirmed',appid:3764200,apiname:'MODEL_API',after:true};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const body={accountId:'main',appid:3764200,name:'Model Mania',apiname:'MODEL_API'};
  assert.equal((await f.request('/api/achievement-experiment',{...body,confirmed:true},{auth:false})).response.status,401);
  await f.login();assert.equal((await f.request('/api/achievement-experiment',{...body,confirmed:true},{csrf:false})).response.status,403);
  await f.request('/api/status');const st=f.app.states.get('main');st.connected=true;st.tokenAccountMatches=true;st.steamId64='76561198000000001';f.app.clients.set('main',new FakeUser({}));
  assert.equal((await f.request('/api/achievement-experiment',{confirmed:true,...body,appid:550})).response.status,400);assert.equal(calls,0);
  const first=await f.request('/api/achievement-experiment',{...body,confirmed:true});assert.equal(first.data.outcome,'confirmed');assert.equal(calls,1);
  assert.equal((await f.request('/api/achievement-experiment',{...body,confirmed:true})).response.status,409);
  assert.equal(f.app.cfg.achievementExperiments['76561198000000001:3764200'].outcome,'confirmed');
});
test('individual unlock API preserves authentication, one-target validation, journal and cooldown',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let calls=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{individualWriter:async(_,id,apiname,options)=>{
    calls++;await options.beforeSend({appid:id,apiname,name:'Chosen',before:false});return {appid:id,apiname,outcome:'confirmed',after:true};
  },protocolReader:async()=>({achievements:[{apiname:'FIRST',unlocked:true,compatibility:{status:'provisional',canUnlock:false}}],verified:true})});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const body={accountId:'main',appid:550,apiname:'FIRST'};
  assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true},{auth:false})).response.status,401);await f.login();
  assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true},{csrf:false})).response.status,403);
  await f.request('/api/status');const st=f.app.states.get('main');Object.assign(st,{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,achievements:['FIRST','SECOND']})).response.status,400);assert.equal(calls,0);
  assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true})).data.outcome,'confirmed');
  assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true})).response.status,409);
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,apiname:'SECOND'})).response.status,429);
  assert.ok(!f.app.cfg.achievementWrites['76561198000000001:550:SECOND']);
  const view=await f.request('/api/achievements?accountId=main&appid=550&method=protocol');assert.equal(view.data.achievements[0].compatibility.validatedOnAccount,true);
});
test('progress preview is authenticated and read-only; activation requires its revision and keeps the journal',async t=>{
  function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
  const snapshot={eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'TARGET',progress:{max_val:'1',value:{operation:'statvalue',operand1:'COUNT'}}}}},'9':{type:'INT',name:'COUNT'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0}]};
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0,received;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>snapshot,individualWriter:async(_,id,apiname,options)=>{writes++;received=options;await options.beforeSend({appid:id,apiname,progressChanges:[{statName:'COUNT',before:0,after:1}]});return {outcome:'confirmed',after:true};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const route='/api/achievement/progress-preview?accountId=main&appid=550&apiname=TARGET';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.progressChanges[0].after,1);assert.equal(writes,0);const body={accountId:'main',appid:550,apiname:'TARGET',mode:'progress'};
  assert.equal((await f.request('/api/achievement/unlock',{...body,confirmed:true})).response.status,400);assert.equal(writes,0);
  assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,...body,revision:preview.data.revision})).response.status,200);assert.equal(received.allowProgress,true);assert.equal(received.expectedRevision,preview.data.revision);assert.equal(writes,1);assert.equal((await f.request(route)).response.status,409);
});
test('post-reconnect persistence check reads Model Mania and sends no achievement write',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[550],gameNames:{550:'L4D2'}}]},{connect:true,startupDiagnostics:true,protocolReader:async(_,id)=>({achievements:id===3764200?[{apiname:'46',name:'Model Mania',unlocked:true}]:[],verified:true,diagnostics:{serverControlled:0}})});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const c=f.app.clients.get('main');c._send=()=>writes++;c.emit('webSession','unused',['sessionid=private']);await new Promise(resolve=>setImmediate(resolve));await f.login();
  const status=await f.request('/api/status');assert.equal(status.data.achievementPersistence.unlocked,true);assert.equal(status.data.achievementPersistence.afterReconnect,true);assert.equal(writes,0);
});
test('game requirements are authenticated, cached, and protocol errors preserve diagnostic actions',async t=>{
  let calls=0;const f=await fixture(t,{accounts:[{id:'a',name:'Main',games:[]}]},{requirementsReader:async id=>{calls++;return {appid:id,facts:['Requires publisher account'],externalAccountOrSoftware:true};},protocolReader:async()=>{throw Object.assign(new Error('No usable definitions'),{status:502,diagnostic:{code:'schema_unavailable',action:'Try the standard reading'}});}});
  assert.equal((await f.request('/api/game-requirements?appid=123')).response.status,401);await f.login();
  assert.equal((await f.request('/api/game-requirements?appid=123')).data.externalAccountOrSoftware,true);await f.request('/api/game-requirements?appid=123');assert.equal(calls,1);
  await f.request('/api/status');f.app.states.get('a').connected=true;
  const result=await f.request('/api/achievements?accountId=a&appid=123&method=protocol');assert.equal(result.response.status,502);assert.equal(result.data.diagnostic.code,'schema_unavailable');assert.equal(result.data.diagnostic.action,'Try the standard reading');
});
test('history is authenticated, scoped to the selected account and reports local storage honestly',async t=>{
  const owner='76561198000000001',other='76561198000000002';const f=await fixture(t,{accounts:[{id:'a',name:'Main',mySteamID:owner,games:[]}],achievementWrites:{[owner+':550:ONE']:{apiname:'ONE',name:'Owned receipt',outcome:'requested'},[other+':550:PRIVATE']:{apiname:'PRIVATE',name:'Other receipt',outcome:'requested'}}});
  assert.equal((await f.request('/api/achievement/history?accountId=a')).response.status,401);await f.login();const result=await f.request('/api/achievement/history?accountId=a&steamid='+other);assert.equal(result.data.storage.persistent,false);assert.equal(result.data.entries.length,1);assert.equal(result.data.entries[0].apiname,'ONE');assert.equal((await f.request('/api/achievement/history?accountId=a&before=bad')).response.status,400);
});
test('unavailable persistent history does not hide real Steam states and blocks writes before transport',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0;
  const unavailable=()=>{throw Object.assign(new Error('Persistent history unavailable'),{status:503});};
  const journal={ready:async()=>{},status:()=>({persistent:true,available:false}),get:async()=>unavailable(),forGame:async()=>unavailable(),reserve:async()=>unavailable(),finish:async()=>{},close:async()=>{}};
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{achievementJournal:journal,protocolReader:async()=>({achievements:[{apiname:'ONE',unlocked:false,compatibility:{status:'provisional',canUnlock:true}}],verified:true}),individualWriter:async(_,id,name,options)=>{await options.beforeSend({appid:id,apiname:name});writes++;return {outcome:'confirmed'};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const view=await f.request('/api/achievements?accountId=main&appid=550&method=protocol');assert.equal(view.response.status,200);assert.equal(view.data.achievements[0].unlocked,false);assert.equal(view.data.achievements[0].compatibility.canUnlock,false);assert.equal((await f.request('/api/achievement/unlock',{confirmed:true,accountId:'main',appid:550,apiname:'ONE'})).response.status,503);assert.equal(writes,0);
});

test('revoking the panel session during durable reservation blocks the Steam transport',async t=>{
  const kv=obj=>{const parts=[];for(const[k,v]of Object.entries(obj))parts.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));parts.push(Buffer.from([8]));return Buffer.concat(parts);};
  const snapshot={game_id:'550',eresult:1,crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'A'}}}}}}),stats:[{stat_id:7,stat_value:0}]};
  let f,reserved=0,sent=0;const operations={schema:async()=>true,latest:async()=>new Map(),list:async()=>[],reserve:async(_,plan)=>{reserved++;f.app.sessions.clear();return {...require('../lib/achievement-operations').cleanOperation(plan),operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',outcome:'requested'};},finish:async()=>assert.fail('No result may be confirmed after a blocked send.')};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{operationsJournal:operations,progressSnapshotReader:async()=>snapshot,changesWriter:async(client,id,selected,options)=>require('../lib/achievement-writer').applyChanges(client,id,selected,{...options,read:async()=>snapshot,send:async()=>{sent++;return {game_id:'550',eresult:1};}})});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});const client=new FakeUser({});client._send=()=>{};f.app.clients.set('main',client);
  const input={accountId:'main',appid:550,selection:[{apiname:'A',action:'unlock'}]};const review=await f.request('/api/achievement/change-preview',input);
  const result=await f.request('/api/achievement/change',{...input,revision:review.data.revision,confirmed:true});assert.equal(result.response.status,401);assert.equal(reserved,1);assert.equal(sent,0);
});

test('rarity retry bypasses stored percentages without making a Steam write',async t=>{
  let calls=0;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{percentagesReader:async()=>({percentages:{A:++calls===1?10:2}})});await f.login();const route='/api/achievement/percentages?accountId=a&appid=240';assert.equal((await f.request(route)).data.percentages.A,10);assert.equal((await f.request(route)).data.percentages.A,10);assert.equal((await f.request(route+'&refresh=1')).data.percentages.A,2);assert.equal(calls,2);
});
test('shared rarity parser is served with the other public static scripts',async t=>{const f=await fixture(t);const r=await fetch(f.base+'/achievement-rarity.js');assert.equal(r.status,200);assert.match(await r.text(),/AchievementRarity/);assert.match(r.headers.get('content-type'),/javascript/);});

test('bulk unlock_all and lock_all API routes preview and confirm full-game changes with optional counter reset',async t=>{
  function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
  const bits={};for(let i=0;i<36;i++)bits[i<32?i:i-32]={name:'ACH_'+i};
  const schema=kv({'550':{stats:{
    7:{type:'4',bits:Object.fromEntries(Array.from({length:32},(_,i)=>[i,{name:'ACH_'+i,...(i===0?{progress:{max_val:'10',value:{operation:'statvalue',operand1:'COUNT'}}}:{}) }]))},
    8:{type:'4',bits:{0:{name:'ACH_32'},1:{name:'ACH_33'},2:{name:'ACH_34'},3:{name:'ACH_35'},4:{name:'PROTECTED',permission:'2'}}},
    9:{type:'INT',name:'COUNT',min:'0',max:'100'}
  }}});
  let currentSnap={game_id:'550',eresult:1,crc_stats:12,schema,stats:[{stat_id:7,stat_value:0},{stat_id:8,stat_value:0},{stat_id:9,stat_value:0}]};
  const receipts=new Map();
  const operations={
    schema:async()=>true,
    latest:async()=>receipts,
    list:async()=>[],
    reserve:async(_,plan)=>require('../lib/achievement-operations').cleanOperation({...plan,operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',checkedAt:new Date().toISOString(),outcome:'requested'}),
    finish:async()=>{}
  };
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f;
  try{
    f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{
      operationsJournal:operations,
      progressSnapshotReader:async()=>currentSnap,
      changesWriter:async(client,id,selected,options)=>{
        let reads=0;
        return require('../lib/achievement-writer').applyChanges(client,id,selected,{
          ...options,
          read:async()=>{
            if(++reads===1)return currentSnap;
            return currentSnap;
          },
          send:async(_,payload)=>{
            const updated=new Map(currentSnap.stats.map(s=>[s.stat_id,s.stat_value]));
            for(const s of payload.stats)updated.set(s.stat_id,s.stat_value);
            const stats=[...updated].map(([stat_id,stat_value])=>({stat_id,stat_value}));
            const view=require('../lib/steam-protocol').parseSnapshot({...currentSnap,stats},550);
            currentSnap={...currentSnap,crc_stats:currentSnap.crc_stats+1,stats,librarySummary:{total:view.achievements.length,unlocked:view.achievements.filter(a=>a.unlocked===true).length,cacheTime:Math.floor(Date.now()/1000)}};
            return {game_id:'550',eresult:1};
          }
        });
      }
    });
  }finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();await f.request('/api/status');
  Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});
  const client=new FakeUser({});client._send=()=>{};f.app.clients.set('main',client);

  const previewUnlock=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,bulk:true,bulkAction:'unlock_all'});
  assert.equal(previewUnlock.response.status,200);
  assert.equal(previewUnlock.data.selection.length,36);
  assert.equal(previewUnlock.data.progressChanges.length,1);
  assert.equal(previewUnlock.data.progressChanges[0].after,10);

  const confirmUnlock=await f.request('/api/achievement/change',{accountId:'main',appid:550,bulk:true,bulkAction:'unlock_all',selection:previewUnlock.data.selection,revision:previewUnlock.data.revision,confirmed:true});
  assert.equal(confirmUnlock.response.status,200);
  assert.equal(confirmUnlock.data.outcome,'confirmed');

  const previewLock=await f.request('/api/achievement/change-preview',{accountId:'main',appid:550,bulk:true,bulkAction:'lock_all',resetCounters:true});
  assert.equal(previewLock.response.status,200);
  assert.equal(previewLock.data.selection.length,36);
  assert.equal(previewLock.data.progressChanges.length,1);
  assert.equal(previewLock.data.progressChanges[0].after,0);

  const confirmLock=await f.request('/api/achievement/change',{accountId:'main',appid:550,bulk:true,bulkAction:'lock_all',resetCounters:true,selection:previewLock.data.selection,revision:previewLock.data.revision,confirmed:true});
  assert.equal(confirmLock.response.status,200);
  assert.equal(confirmLock.data.outcome,'confirmed');
});

test('encrypted Vault accounts support >32 manual selections, live gamesPlayed emulation and protocol upgrade over 0-unlocked web reads',async t=>{
  function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
  const schema=kv({'34830':{stats:{
    1:{type:'4',bits:Object.fromEntries(Array.from({length:32},(_,i)=>[i,{name:'ACH_'+i}]))},
    2:{type:'4',bits:{0:{name:'ACH_32'},1:{name:'ACH_33'},2:{name:'ACH_34'},3:{name:'ACH_35'}}}
  }}});
  let currentSnap={game_id:'34830',eresult:1,crc_stats:12,schema,stats:[{stat_id:1,stat_value:0},{stat_id:2,stat_value:0}]};
  const operations={
    schema:async()=>true,
    latest:async()=>new Map(),
    list:async()=>[],
    reserve:async(_,plan)=>require('../lib/achievement-operations').cleanOperation({...plan,operationId:'cccccccc-cccc-cccc-cccc-cccccccccccc',checkedAt:new Date().toISOString(),outcome:'requested'}),
    finish:async()=>{}
  };
  const f=await fixture(t,{accounts:[{id:'user2',name:'Random User',games:[220]}]},{
    operationsJournal:operations,
    progressSnapshotReader:async()=>currentSnap,
    protocolReader:async()=>require('../lib/steam-protocol').parseSnapshot(currentSnap,34830),
    achievements:async()=>({verified:true,source:'Steam Community HTML',achievements:[{name:'Act 1',unlocked:false}]}),
    changesWriter:async(client,id,selected,options)=>require('../lib/achievement-writer').applyChanges(client,id,selected,{
      ...options,
      read:async()=>currentSnap,
      send:async(_,payload)=>{
        const updated=new Map(currentSnap.stats.map(s=>[s.stat_id,s.stat_value]));
        for(const s of payload.stats)updated.set(s.stat_id,s.stat_value);
        currentSnap={...currentSnap,crc_stats:currentSnap.crc_stats+1,stats:[...updated].map(([stat_id,stat_value])=>({stat_id,stat_value}))};
        return {game_id:'34830',eresult:1};
      }
    })
  });
  f.app.vault.set('user2',token());
  await f.login();
  const status=await f.request('/api/status');
  assert.equal(status.data.accounts[0].encryptedSession,true);
  Object.assign(f.app.states.get('user2'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});
  const client=new FakeUser({});client._send=()=>{};f.app.clients.set('user2',client);

  // Manual selection of 36 achievements (> 32) on an encrypted local Vault account
  const manual36=Array.from({length:36},(_,i)=>({apiname:'ACH_'+i,action:'unlock'}));
  const preview=await f.request('/api/achievement/change-preview',{accountId:'user2',appid:34830,selection:manual36});
  assert.equal(preview.response.status,200);
  assert.equal(preview.data.selection.length,36);

  const confirm=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,selection:manual36,revision:preview.data.revision,confirmed:true});
  assert.equal(confirm.response.status,200);
  assert.equal(confirm.data.outcome,'confirmed');
  // Verify gamesPlayed([34830]) was invoked during the write and farming([220]) was restored afterwards
  assert.ok(client.calls.some(c=>c.length===1&&c[0]===34830));
  assert.deepEqual(client.calls.at(-1),[220]);

  // Verify that even if method=web returns 0 unlocked achievements, connected session upgrades to protocol (36/36 unlocked)
  const readWeb=await f.request('/api/achievements?accountId=user2&appid=34830&method=web&refresh=1');
  assert.equal(readWeb.response.status,200);
  assert.equal(readWeb.data.readingMethod,'protocol');
  assert.equal(readWeb.data.achievements.filter(a=>a.unlocked===true).length,36);

  // Partial unlock of 2 achievements after lock_all preserves protocol reading and checkboxes on all remaining achievements across reloads
  const lockAll1P=await f.request('/api/achievement/change-preview',{accountId:'user2',appid:34830,bulk:true,bulkAction:'lock_all',resetCounters:true});
  await f.request('/api/achievement/change',{accountId:'user2',appid:34830,bulk:true,bulkAction:'lock_all',resetCounters:true,selection:lockAll1P.data.selection,revision:lockAll1P.data.revision,confirmed:true});
  const sel2=[{apiname:'ACH_0',action:'unlock'},{apiname:'ACH_1',action:'unlock'}];
  const prev2=await f.request('/api/achievement/change-preview',{accountId:'user2',appid:34830,selection:sel2,bulk:true});
  assert.equal(prev2.response.status,200);
  const conf2=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,selection:sel2,revision:prev2.data.revision,confirmed:true,bulk:true});
  assert.equal(conf2.data.outcome,'confirmed');
  for(const mode of ['protocol','auto','web']){
    const after2=await f.request(`/api/achievements?accountId=user2&appid=34830&method=${mode}&refresh=1`);
    assert.equal(after2.data.readingMethod,'protocol');
    assert.equal(after2.data.achievements.filter(a=>a.unlocked===true).length,2);
    assert.equal(after2.data.achievements.filter(a=>a.unlocked===true).every(a=>a.batchSupport?.canRemove===true),true);
    assert.equal(after2.data.achievements.filter(a=>a.unlocked===false).every(a=>a.batchSupport?.canReactivate===true),true);
  }
  // Unlock 2 MORE achievements immediately after the first 2
  const selNext2=[{apiname:'ACH_2',action:'unlock'},{apiname:'ACH_32',action:'unlock'}];
  const prevNext2=await f.request('/api/achievement/change-preview',{accountId:'user2',appid:34830,selection:selNext2,bulk:true});
  assert.equal(prevNext2.response.status,200);
  const confNext2=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,selection:selNext2,revision:prevNext2.data.revision,confirmed:true,bulk:true});
  assert.equal(confNext2.data.outcome,'confirmed');

    // When paused, completing an achievement operation immediately sends gamesPlayed([]) so Steam stops showing in-game
  await f.request('/api/toggle',{accountId:'user2'});
  assert.deepEqual(client.calls.at(-1),[]);
  const lockPreview=await f.request('/api/achievement/change-preview',{accountId:'user2',appid:34830,bulk:true,bulkAction:'lock_all',resetCounters:true});
  const lockConfirm=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,bulk:true,bulkAction:'lock_all',resetCounters:true,selection:lockPreview.data.selection,revision:lockPreview.data.revision,confirmed:true});
  assert.equal(lockConfirm.data.outcome,'confirmed');
  assert.deepEqual(client.calls.at(-1),[]);

  // Resume and add batch of 32 games simultaneously
  await f.request('/api/toggle',{accountId:'user2'});
  const batch32=Array.from({length:32},(_,i)=>1000+i);
  await f.request('/api/clear-all',{accountId:'user2'});
  await f.request('/api/add',{accountId:'user2',appids:batch32});
  assert.equal(f.app.cfg.accounts[0].games.length,32);
  assert.deepEqual(client.calls.at(-1),batch32);
});

test('PIN-free auto-session, direct 1-click unlock/remove, SamRewritten statistics editor, JSON export/import, and timed schedule',async t=>{
  function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
  const {floatBits}=require('../lib/float-progress');
  const schema=kv({'34830':{stats:{
    1:{type:'4',bits:{0:{name:'ACT_1'},1:{name:'ACT_2'},2:{name:'SNIPER_KILLER',progress:{max_val:'500',value:{operation:'statvalue',operand1:'SNIPER_KILLS'}}}}},
    2:{type:'INT',name:'SNIPER_KILLS',min:'0',max:'1000'},
    3:{type:'FLOAT',name:'HEADSHOT_DIST',min:'0',max:'1000'}
  }}});
  const stateStats=new Map([[1,0],[2,0],[3,floatBits(0)]]);
  let crc=200;
  const currentSnapshot=()=>({
    game_id:'34830',eresult:1,crc_stats:crc,schema,
    stats:[...stateStats].map(([stat_id,stat_value])=>({stat_id,stat_value}))
  });
  const f=await fixture(t,{accounts:[{id:'user2',name:'Secondary',user:'user2',games:[],gameNames:{}}]});
  f.app.vault.set('user2',token());

  // 1. Verify PIN-free auto-session via GET /api/panel/session without calling /api/panel/login
  const autoSess=await fetch(f.base+'/api/panel/session');
  assert.equal(autoSess.status,200);
  const autoCookie=autoSess.headers.get('set-cookie').split(';')[0];
  const autoCsrf=(await autoSess.json()).csrf;
  assert.ok(autoCookie.startsWith('sf_session='));
  assert.equal(typeof autoCsrf,'string');
  const autoStatus=await fetch(f.base+'/api/status',{headers:{Cookie:autoCookie}});
  assert.equal(autoStatus.status,200);

  await f.login();
  const client=new FakeUser({});
  client._send=(header,body,cb)=>{
    const Schema=require('steam-user/protobufs/generated/_load.js');
    const EMsg=require('steam-user/enums/EMsg');
    if(header.msg===EMsg.ClientGetUserStats){
      queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientGetUserStatsResponse.encode(currentSnapshot()).finish()),{msg:EMsg.ClientGetUserStatsResponse}));
    }else if(header.msg===EMsg.ClientStoreUserStats2){
      const decoded=Schema.CMsgClientStoreUserStats2.decode(body);
      if(decoded.explicit_reset&&(!decoded.stats||!decoded.stats.length)){
        for(const k of stateStats.keys())stateStats.set(k,0);
      }
      for(const s of decoded.stats||[])stateStats.set(Number(s.stat_id),Number(s.stat_value)>>>0);
      crc++;
      queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({game_id:'34830',eresult:1,crc_stats:crc,stats_out_of_date:false,stats_failed_validation:[]}).finish()),{msg:EMsg.ClientStoreUserStatsResponse}));
    }
  };
  f.app.clients.set('user2',client);
  Object.assign(f.app.states.get('user2'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});

  // 2. Direct 1-click unlock_all and partial removal without preview round-trip
  const directUnlockAll=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,confirmed:true,directApply:true,bulk:true,bulkAction:'unlock_all'});
  assert.equal(directUnlockAll.response.status,200);
  assert.equal(directUnlockAll.data.outcome,'confirmed');
  assert.equal(stateStats.get(1),7);

  const directRemoveOne=await f.request('/api/achievement/change',{accountId:'user2',appid:34830,confirmed:true,directApply:true,bulk:true,resetCounters:true,selection:[{apiname:'ACT_2',action:'remove'}]});
  assert.equal(directRemoveOne.response.status,200);
  assert.equal(directRemoveOne.data.outcome,'confirmed');
  assert.equal(stateStats.get(1),5); // ACT_1 (bit 0) + SNIPER_KILLER (bit 2) remain unlocked, ACT_2 (bit 1) is locked

  // 3. SamRewritten Statistics read, edit (INT + FLOAT), and resetAll preserving achievement blocks
  const statsRead=await f.request('/api/stats?accountId=user2&appid=34830');
  assert.equal(statsRead.response.status,200);
  assert.equal(statsRead.data.stats.length,2);
  const statsEdit=await f.request('/api/stats',{accountId:'user2',appid:34830,changes:[{statId:2,value:777},{statId:3,value:42.5}]});
  assert.equal(statsEdit.response.status,200);
  assert.equal(statsEdit.data.outcome,'confirmed');
  assert.equal(statsEdit.data.stats.find(s=>s.statId===2).value,777);
  assert.equal(statsEdit.data.stats.find(s=>s.statId===3).value,42.5);

  const statsReset=await f.request('/api/stats',{accountId:'user2',appid:34830,resetAll:true});
  assert.equal(statsReset.response.status,200);
  assert.equal(statsReset.data.stats.every(s=>s.value===0),true);
  assert.equal(stateStats.get(1),5); // Achievement bitmask preserved!

  // 4. SamRewritten JSON Export & Import
  const exported=await f.request('/api/achievement/export?accountId=user2&appid=34830');
  assert.equal(exported.response.status,200);
  assert.equal(exported.data.achievements.length,3);
  const imported=await f.request('/api/achievement/import',{
    accountId:'user2',
    appid:34830,
    achievements:[{apiname:'ACT_1',unlocked:false},{apiname:'ACT_2',unlocked:true},{apiname:'SNIPER_KILLER',unlocked:false}],
    stats:[{statId:2,value:123}]
  });
  assert.equal(imported.response.status,200);
  assert.equal(stateStats.get(1),2); // Only ACT_2 unlocked
  assert.equal(stateStats.get(2),123);

  // 5. SamRewritten Timed Modifications schedule start & cancel
  const timedStart=await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,bulkAction:'unlock_all',amount:10,units:'minutes',spacing:'random',order:'random'});
  assert.equal(timedStart.response.status,200);
  assert.equal(timedStart.data.active,true);
  assert.equal(timedStart.data.totalCount,2);
  const timedCancel=await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,action:'cancel'});
  assert.equal(timedCancel.response.status,200);
  assert.equal(timedCancel.data.active,false);

  // 6. SamRewritten Analytics, 1-click Undo, Copy User Timings, and Multi-Game Bulk
  const analyticsRes=await f.request('/api/achievement/analytics?accountId=user2&appid=34830');
  assert.equal(analyticsRes.response.status,200);
  assert.equal(analyticsRes.data.totalAchievements,3);
  assert.equal(analyticsRes.data.unlockedCount,1);

  const undoRes=await f.request('/api/achievement/undo',{accountId:'user2',appid:34830});
  assert.equal(undoRes.response.status,200);
  assert.equal(undoRes.data.outcome,'confirmed');

  // Lock all first so ACT_1 and ACT_2 are locked before copying user timings
  await f.request('/api/achievement/change',{accountId:'user2',appid:34830,confirmed:true,directApply:true,bulk:true,bulkAction:'lock_all',resetCounters:true});
  const copyXml='<playerstats><achievements><achievement closed="1"><apiname>ACT_1</apiname><unlockTimestamp>1700000100</unlockTimestamp></achievement><achievement closed="1"><apiname>ACT_2</apiname><unlockTimestamp>1700000200</unlockTimestamp></achievement></achievements></playerstats>';
  const copyRes=await f.request('/api/achievement/copy-timings',{accountId:'user2',appid:34830,source:copyXml,maxMinutes:1});
  assert.equal(copyRes.response.status,200);
  assert.equal(copyRes.data.copiedCount,2);
  await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,action:'cancel'});

  const bulkAppsUnlock=await f.request('/api/achievement/bulk-apps',{accountId:'user2',appids:[34830],bulkAction:'unlock_all'});
  assert.equal(bulkAppsUnlock.response.status,200);
  assert.equal(bulkAppsUnlock.data.updatedGames,1);
  assert.equal(stateStats.get(1),7);

  const bulkAppsLock=await f.request('/api/achievement/bulk-apps',{accountId:'user2',appids:[34830],bulkAction:'lock_all'});
  assert.equal(bulkAppsLock.response.status,200);
  assert.equal(bulkAppsLock.data.updatedGames,1);
  assert.equal(stateStats.get(1),0);

  // 7. Load owned Steam games in 1 click (/api/load-owned)
  client.getUserOwnedApps=async()=>({apps:[{appid:550,name:'Left 4 Dead 2',playtime_forever:120},{appid:730,name:'Counter-Strike 2',playtime_forever:500}]});
  const loadOwned=await f.request('/api/load-owned',{accountId:'user2'});
  assert.equal(loadOwned.response.status,200);
  assert.equal(loadOwned.data.added,2);
  assert.deepEqual(f.app.cfg.accounts[0].games,[550,730]);

  // 8. Box-Muller randomGaussian, natural spacing, playingState collision pause/resume, and rehydration
  const {randomGaussian,buildHumanizedOffsets,TimedModificationManager}=require('../lib/steam-protocol');
  const samples=Array.from({length:50},()=>randomGaussian(100,25));
  assert.ok(samples.every(x=>typeof x==='number'&&x>=0));
  const natOffsets=buildHumanizedOffsets(8,60000,'natural');
  assert.equal(natOffsets.length,8);
  assert.ok(natOffsets.every((v,i)=>i===0||v>=natOffsets[i-1]));

  const naturalStart=await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,bulkAction:'unlock_all',amount:10,units:'minutes',spacing:'natural',order:'random'});
  assert.equal(naturalStart.response.status,200);
  assert.equal(naturalStart.data.spacing,'natural');
  assert.equal(naturalStart.data.pausedByCollision,false);

  // Simulate playingState collision (user starts playing on PC) -> pauses timed job
  f.app.timedManager.pauseAccount('user2');
  const pausedStatus=await f.request('/api/achievement/timed?accountId=user2&appid=34830');
  assert.equal(pausedStatus.data.pausedByCollision,true);

  // Simulate user closing game on PC -> shifts runAt and resumes timed job
  f.app.timedManager.resumeAccount('user2');
  const resumedStatus=await f.request('/api/achievement/timed?accountId=user2&appid=34830');
  assert.equal(resumedStatus.data.pausedByCollision,false);
  assert.equal(resumedStatus.data.active,true);

  // Test PostgreSQL + local rehydration of TimedModificationManager
  const executedItems=[];
  const rehydratedMgr=new TimedModificationManager({file:f.app.timedManager.file});
  const restoredCount=await rehydratedMgr.rehydrate({
    accountId:'user2',
    executeItemFactory:()=>async item=>{executedItems.push(item.apiname);}
  });
  assert.equal(restoredCount,1);
  assert.equal(rehydratedMgr.status('user2',34830).active,true);
  rehydratedMgr.cancelAll();
  await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,action:'cancel'});

  // 9. Auto Discovery Queue (tralph3/Steam-Auto-Queue) & v0002 Rarity Categories
  const {exploreDiscoveryQueue}=require('../lib/steam-data');
  const dqCalls=[];
  const dqResult=await exploreDiscoveryQueue('sessionid=abc123xyz; steamLoginSecure=1',{
    queues:2,
    request:async(url,opts)=>{
      dqCalls.push({url,method:opts.method,body:opts.body});
      if(url.includes('generatenewdiscoveryqueue'))return {body:JSON.stringify({queue:[550,730]})};
      return {body:'{}'};
    }
  });
  assert.equal(dqResult.completedQueues,2);
  assert.equal(dqResult.totalCleared,4);
  assert.ok(dqCalls.some(c=>c.url==='https://store.steampowered.com/explore/generatenewdiscoveryqueue'&&c.body.includes('sessionid=abc123xyz')));
  assert.ok(dqCalls.some(c=>c.url==='https://store.steampowered.com/app/550'&&c.body.includes('appid_to_clear_from_queue=550')));

  const {tier}=require('../public/achievement-rarity');
  assert.equal(tier(4.9),'Mythic');
  assert.equal(tier(5),'Epic');
  assert.equal(tier(19.9),'Epic');
  assert.equal(tier(20),'Rare');
  assert.equal(tier(50),'Rare');
  assert.equal(tier(50.1),'Common');

  // 10. ASF 2-Hour Card Farming Rule & Anti-Ban Playtime-Sync
  const st2=f.app.states.get('user2');
  f.app.cfg.accounts[0].cardFarming=true;
  st2.cardsReady=true;
  // Two games < 2h (240, 440) and one game >= 2h (550) -> farms [240, 440] in parallel
  st2.cardDropGames=[
    {appid:240,name:'CS:S',remaining:3,hoursPlayed:0.8},
    {appid:440,name:'TF2',remaining:2,hoursPlayed:1.5},
    {appid:550,name:'L4D2',remaining:4,hoursPlayed:3.2}
  ];
  await f.request('/api/custom-status',{accountId:'user2',status:''});
  assert.deepEqual(client.calls.at(-1),[240,440]);

  // Once all remaining card-drop games have >= 2h -> farms 1 game at a time ([550])
  st2.cardDropGames=[
    {appid:550,name:'L4D2',remaining:4,hoursPlayed:2.5},
    {appid:620,name:'Portal 2',remaining:3,hoursPlayed:5.0}
  ];
  await f.request('/api/custom-status',{accountId:'user2',status:''});
  assert.deepEqual(client.calls.at(-1),[550]);

  // Anti-Ban Playtime-Sync: starting a non-stealth timed job switches gamesPlayed to [34830], cancelling restores [550]
  await f.request('/api/achievement/change',{accountId:'user2',appid:34830,confirmed:true,directApply:true,bulk:true,bulkAction:'lock_all',resetCounters:true});
  await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,bulkAction:'unlock_all',amount:10,units:'minutes',spacing:'natural',stealth:false});
  assert.deepEqual(client.calls.at(-1),[34830]);
  await f.request('/api/achievement/timed',{accountId:'user2',appid:34830,action:'cancel'});
  assert.deepEqual(client.calls.at(-1),[550]);

  // 11. Quick-Sell Market (fetchSellableCards + quickSellCards)
  const {quickSellCards,computeSellerPriceCents}=require('../lib/steam-data');
  assert.equal(computeSellerPriceCents(10),8);
  const marketCalls=[];
  const qsRes=await quickSellCards('76561198000000001','sessionid=sess999; steamLoginSecure=1',{
    request:async(url,opts)=>{
      marketCalls.push({url,method:opts.method||'GET',body:opts.body,referer:opts.referer});
      if(url.includes('/inventory/'))return {body:JSON.stringify({
        assets:[{assetid:'9001',classid:'100',instanceid:'0',amount:'1'}],
        descriptions:[{classid:'100',instanceid:'0',marketable:1,name:'Balkan (Trading Card)',market_hash_name:'730-Balkan (Trading Card)',type:'CS2 Trading Card',market_fee_app:730}]
      })};
      if(url.includes('/market/priceoverview/'))return {body:JSON.stringify({success:true,lowest_price:'$0.10',median_price:'$0.10'})};
      if(url.includes('/market/sellitem/'))return {body:JSON.stringify({success:true,requires_confirmation:1})};
      return {body:'{}'};
    }
  });
  assert.equal(qsRes.soldCount,1);
  assert.equal(qsRes.requiresConfirmationCount,1);
  assert.ok(marketCalls.some(c=>c.url==='https://steamcommunity.com/market/sellitem/'&&c.body.includes('assetid=9001')&&c.body.includes('price=8')));

  // 12. Audit Fixes: 429 rate-limit backoff + 1.8s-3.2s delay + 2FA mobileconf auto-confirm + minutes playtime parsing
  const minsHtml='<div class="badge_row"><a class="badge_row_overlay" href="https://steamcommunity.com/my/gamecards/440/"></a><div class="badge_title">TF2</div><div class="badge_title_stats_playtime">45 mins on record</div><span class="progress_info_bold">2 card drops remaining</span></div>';
  assert.equal(parseCards(minsHtml)[0].hoursPlayed,0.8);

  const {ownedFloatLibrary}=require('../lib/float-discovery');
  const libWithMins=await ownedFloatLibrary({steamID:{toString:()=>'76561198000000001'},_currentJobID:1,_jobs:{delete:()=>{}},getUserOwnedApps:async()=>({apps:[{appid:440,name:'TF2',playtime_forever:90}]})});
  assert.equal(libWithMins.games[0].playtimeMinutes,90);

  const delays=[];
  let sellAttempts9002=0;
  const qsRetryRes=await quickSellCards('76561198000000001','sessionid=sess999; steamLoginSecure=1',{
    identitySecret:Buffer.from('0123456789abcdef0123').toString('base64'),
    delayFn:async ms=>{delays.push(ms);},
    request:async(url,opts)=>{
      if(url.includes('/inventory/'))return {body:JSON.stringify({
        assets:[{assetid:'9001',classid:'100',instanceid:'0',amount:'1'},{assetid:'9002',classid:'100',instanceid:'0',amount:'1'}],
        descriptions:[{classid:'100',instanceid:'0',marketable:1,name:'Card',market_hash_name:'730-Card',type:'Trading Card',market_fee_app:730}]
      })};
      if(url.includes('/market/priceoverview/'))return {body:JSON.stringify({success:true,lowest_price:'$0.10'})};
      if(url.includes('/market/sellitem/')){
        if(opts.body.includes('assetid=9002')&&++sellAttempts9002===1)throw new Error('Steam/Discord returned HTTP 429.');
        return {body:JSON.stringify({success:true,requires_confirmation:1})};
      }
      if(url.includes('/mobileconf/getlist'))return {body:JSON.stringify({success:true,conf:[{id:'c1',key:'k1'},{id:'c2',key:'k2'}]})};
      if(url.includes('/mobileconf/ajaxop'))return {body:JSON.stringify({success:true})};
      return {body:'{}'};
    }
  });
  assert.equal(qsRetryRes.soldCount,2);
  assert.equal(qsRetryRes.rateLimitRetries,1);
  assert.equal(qsRetryRes.autoConfirmedCount,2);
  assert.ok(delays.some(d=>d>=1800&&d<=3200));
  assert.ok(delays.includes(15000));

  // 13. Bloque 1 & 3.2: Full DB persistence -> collision pause -> process restart (rehydrate) -> pausedDeltaMs shift -> smart exponential backoff retries
  const dbJobs = new Map();
  const dbQueue = new Map();
  const mockPool = {
    query: async (sql, params = []) => {
      const s = String(sql).trim();
      if (/CREATE TABLE/i.test(s)) return { rows: [] };
      if (/UPDATE steamfarmer_timed_jobs SET status = 'cancelled'/i.test(s)) {
        for (const j of dbJobs.values()) {
          if (j.account_id === params[0] && j.appid === params[1] && ["active", "paused_collision"].includes(j.status)) j.status = "cancelled";
        }
        return { rows: [] };
      }
      if (/INSERT INTO steamfarmer_timed_jobs/i.test(s)) {
        dbJobs.set(params[0], { job_id: params[0], account_id: params[1], appid: params[2], status: params[3], config: JSON.parse(params[4] || "{}"), started_at: params[5], created_at: new Date().toISOString() });
        return { rows: [] };
      }
      if (/INSERT INTO steamfarmer_timed_queue/i.test(s)) {
        const list = dbQueue.get(params[0]) || [];
        list.push({ job_id: params[0], item_index: params[1], apiname: params[2], action: params[3], run_at: params[4], completed: false, error: null });
        dbQueue.set(params[0], list);
        return { rows: [] };
      }
      if (/UPDATE steamfarmer_timed_jobs SET status = \$2, config = \$3/i.test(s)) {
        const j = dbJobs.get(params[0]);
        if (j) { j.status = params[1]; j.config = JSON.parse(params[2] || "{}"); }
        return { rows: [] };
      }
      if (/UPDATE steamfarmer_timed_jobs SET status = \$2 WHERE job_id = \$1/i.test(s)) {
        const j = dbJobs.get(params[0]);
        if (j) j.status = params[1];
        return { rows: [] };
      }
      if (/UPDATE steamfarmer_timed_jobs SET status = 'completed'/i.test(s)) {
        const j = dbJobs.get(params[0]);
        if (j) j.status = "completed";
        return { rows: [] };
      }
      if (/UPDATE steamfarmer_timed_queue SET run_at = \$3/i.test(s)) {
        const list = dbQueue.get(params[0]) || [];
        const item = list.find(x => x.item_index === params[1] && !x.completed);
        if (item) item.run_at = params[2];
        return { rows: [] };
      }
      if (/UPDATE steamfarmer_timed_queue SET completed = TRUE/i.test(s)) {
        const list = dbQueue.get(params[0]) || [];
        const item = list.find(x => x.item_index === params[1]);
        if (item) { item.completed = true; item.error = params[2]; }
        return { rows: [] };
      }
      if (/SELECT job_id, account_id, appid, status, config, started_at FROM steamfarmer_timed_jobs/i.test(s)) {
        const rows = [...dbJobs.values()].filter(j => ["active", "paused_collision"].includes(j.status) && (!params[0] || j.account_id === params[0]));
        return { rows };
      }
      if (/SELECT item_index, apiname, action, run_at, completed FROM steamfarmer_timed_queue/i.test(s)) {
        const rows = (dbQueue.get(params[0]) || []).slice().sort((a, b) => a.item_index - b.item_index);
        return { rows };
      }
      return { rows: [] };
    }
  };

  const mgr1 = new TimedModificationManager({ pool: mockPool, retryDelaysMs: [25, 50, 100] });
  const startRes = mgr1.start({
    accountId: "user2",
    appid: 440,
    items: [{ apiname: "ACH_RETRY_1", action: "unlock" }, { apiname: "ACH_RETRY_2", action: "unlock" }],
    customDelaysMs: [120, 220],
    executeItem: async () => {}
  });
  await mgr1.flush();
  assert.equal(dbJobs.size, 1);
  const origRunAt0 = Date.parse(startRes.remaining[0].runAt);

  // Trigger collision pause and persist to DB before simulated Render container restart
  mgr1.pauseAccount("user2");
  await mgr1.flush();
  const savedJobRow = dbJobs.get(startRes.jobId);
  assert.equal(savedJobRow.status, "paused_collision");
  assert.ok(Number(savedJobRow.config.pausedAt) > 0);
  mgr1.cancelAll();

  await new Promise(r => setTimeout(r, 70));

  // Simulate process restart with new TimedModificationManager instance rehydrating from PostgreSQL
  let attemptsForFirst = 0;
  const completedInRestart = [];
  const mgr2 = new TimedModificationManager({ pool: mockPool, retryDelaysMs: [25, 50, 100] });
  const rehydratedCount = await mgr2.rehydrate({
    accountId: "user2",
    isCollisionPaused: () => true,
    executeItemFactory: () => async item => {
      if (item.apiname === "ACH_RETRY_1" && ++attemptsForFirst < 3) {
        throw new Error("Transient Steam maintenance disconnect");
      }
      completedInRestart.push(item.apiname);
    }
  });
  assert.equal(rehydratedCount, 1);
  assert.equal(mgr2.status("user2", 440).pausedByCollision, true);

  // Resume from collision after restart -> verify pausedDeltaMs shifts timestamps without corruption
  mgr2.resumeAccount("user2");
  await mgr2.flush();
  const resumedAfterRestart = mgr2.status("user2", 440);
  assert.equal(resumedAfterRestart.pausedByCollision, false);
  for (const rem of resumedAfterRestart.remaining) {
    const parsedTs = Date.parse(rem.runAt);
    assert.ok(Number.isFinite(parsedTs), "Shifted timestamp must be valid ISO date");
  }
  assert.ok(Date.parse(resumedAfterRestart.remaining[0].runAt) >= origRunAt0 + 50);

  // Wait for items + smart exponential backoff retries (25ms + 50ms) to finish
  const deadline = Date.now() + 2500;
  while (completedInRestart.length < 2 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 30));
  }
  await mgr2.flush();
  assert.deepEqual(completedInRestart, ["ACH_RETRY_1", "ACH_RETRY_2"]);
  assert.equal(attemptsForFirst, 3);
  assert.equal(dbJobs.get(startRes.jobId).status, "completed");
  assert.ok((dbQueue.get(startRes.jobId) || []).every(q => q.completed === true));
  mgr2.cancelAll();

  // 14. Bloque 2, 3 & 4 API Routes: Demo Mode endpoints, Net Fee Estimator, Auto Badge Crafter & Multi-Account Idle Cluster
  const demoAchRes = await f.request("/api/achievements?accountId=demo&appid=440");
  assert.equal(demoAchRes.response.status, 200);
  assert.equal(demoAchRes.data.demoMode, true);
  assert.ok(demoAchRes.data.achievements.length >= 4);
  assert.match(demoAchRes.data.message, /Modo Demostración/);

  const demoStatsRes = await f.request("/api/stats?accountId=demo&appid=440");
  assert.equal(demoStatsRes.response.status, 200);
  assert.equal(demoStatsRes.data.demoMode, true);
  assert.ok(demoStatsRes.data.stats.some(s => s.type === "INT") && demoStatsRes.data.stats.some(s => s.type === "FLOAT"));

  const demoAnalyticsRes = await f.request("/api/achievement/analytics?accountId=demo&appid=440");
  assert.equal(demoAnalyticsRes.response.status, 200);
  assert.equal(demoAnalyticsRes.data.demoMode, true);

  const { computeFeeBreakdownCents, estimateCardBatchNet, parseCraftableBadges, craftSteamBadge } = require("../lib/steam-data");
  const feeBd = computeFeeBreakdownCents(20);
  assert.equal(feeBd.valveFeeCents, 1);
  assert.equal(feeBd.developerFeeCents, 2);
  assert.equal(feeBd.sellerNetCents, 17);

  const batchEst = estimateCardBatchNet([
    { appid: 730, name: "Card 1", marketHashName: "730-1", buyerCents: 10 },
    { appid: 730, name: "Card 2", marketHashName: "730-2", buyerCents: 10 },
    { appid: 730, name: "Card 3", marketHashName: "730-3", buyerCents: 10 },
    { appid: 730, name: "Card 4", marketHashName: "730-4", buyerCents: 10 },
    { appid: 730, name: "Card 5", marketHashName: "730-5", buyerCents: 10 }
  ]);
  assert.equal(batchEst.totalCards, 5);
  assert.equal(batchEst.grossBuyerCents, 50);
  assert.equal(batchEst.estimatedNetCents, 40);
  assert.equal(batchEst.craftableSets.length, 1);
  assert.equal(batchEst.craftableSets[0].appid, 730);

  const craftableHtml = '<div class="badge_row"><a class="badge_row_overlay" href="https://steamcommunity.com/my/gamecards/730/"></a><div class="badge_title">Counter-Strike 2</div><div class="badge_craft_button">Ready to craft</div></div>';
  assert.deepEqual(parseCraftableBadges(craftableHtml), [{ appid: 730, name: "Counter-Strike 2", craftable: true }]);

  const craftRes = await craftSteamBadge("76561198000000001", "sessionid=sess123; steamLoginSecure=1", {
    appid: 730,
    request: async (url, opts) => {
      assert.ok(url.includes("/ajaxcraftbadge/"));
      assert.ok(opts.body.includes("appid=730") && opts.body.includes("sessionid=sess123"));
      return { body: JSON.stringify({ success: 1, Badge: { title: "CS2 Soldier", xp: 100 }, playerlevel: 42, rgDroppedItems: [{ name: ":cs2_emoticon:", type: "Emoticon" }] }) };
    }
  });
  assert.equal(craftRes.success, true);
  assert.equal(craftRes.xpEarned, 100);
  assert.equal(craftRes.newLevel, 42);
  assert.equal(craftRes.unlockedItems.length, 1);

  const clusterStatus = await f.request("/api/cluster/status");
  assert.equal(clusterStatus.response.status, 200);
  assert.equal(clusterStatus.data.totalAccounts, 1);

  const clusterAction = await f.request("/api/cluster/action", { action: "start_all" });
  assert.equal(clusterAction.response.status, 200);
  assert.equal(clusterAction.data.affected, 1);

  // 15. SAM In-Game Mode (/api/game/inspect-start & /api/game/inspect-stop) with 32-Game Priority Rule
  const thirtyTwoGames = Array.from({ length: 32 }, (_, idx) => 1000 + idx);
  f.app.states.get("user2").playedGames = [...thirtyTwoGames];
  f.app.states.get("user2").inspectPreviousGames = null;
  f.app.states.get("user2").inspectingAppId = null;

  // Stealth mode does not alter playedGames
  const stealthInspect = await f.request("/api/game/inspect-start", { accountId: "user2", appid: 34830, stealth: true });
  assert.equal(stealthInspect.response.status, 200);
  assert.equal(stealthInspect.data.stealth, true);
  assert.deepEqual(f.app.states.get("user2").playedGames, thirtyTwoGames);

  // Non-stealth mode puts appid first and caps at 32 while preserving the other 31 games
  const liveInspect = await f.request("/api/game/inspect-start", { accountId: "user2", appid: 34830, stealth: false });
  assert.equal(liveInspect.response.status, 200);
  assert.equal(liveInspect.data.inspecting, true);
  assert.equal(liveInspect.data.playedGames.length, 32);
  assert.equal(liveInspect.data.playedGames[0], 34830);
  assert.deepEqual(liveInspect.data.playedGames.slice(1), thirtyTwoGames.slice(0, 31));
  assert.deepEqual(f.app.states.get("user2").inspectPreviousGames, thirtyTwoGames);

  // Unlocking an achievement while inspecting preserves all 32 games in gamesPlayed
  await f.request("/api/achievement/change", {
    accountId: "user2",
    appid: 34830,
    confirmed: true,
    directApply: true,
    bulk: true,
    selection: [{ apiname: "ACT_1", action: "unlock" }],
    stealth: false
  });
  assert.equal(f.app.states.get("user2").playedGames.length, 32);
  assert.equal(f.app.states.get("user2").playedGames[0], 34830);

  // Closing the modal (/api/game/inspect-stop) cleanly restores the original 32 farmed games
  const stopInspect = await f.request("/api/game/inspect-stop", { accountId: "user2" });
  assert.equal(stopInspect.response.status, 200);
  assert.equal(stopInspect.data.restored, true);
  assert.deepEqual(f.app.states.get("user2").playedGames, thirtyTwoGames);
  assert.equal(f.app.states.get("user2").inspectPreviousGames, null);
  assert.equal(f.app.states.get("user2").inspectingAppId, null);
});
