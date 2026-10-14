'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const {readProtocol, parseSnapshot,readLibrarySummary} = require('../lib/steam-protocol');
// Minimal real-format binary KeyValues fixture, including a bit at the signed-int boundary.
function kv(obj) {
  const pieces=[];
  for(const [key,value] of Object.entries(obj)) {
    pieces.push(Buffer.from([typeof value==='object'?0:1]),Buffer.from(key+'\0'));
    pieces.push(typeof value==='object'?kv(value):Buffer.from(String(value)+'\0'));
  }
  pieces.push(Buffer.from([8]));return Buffer.concat(pieces);
}
const schema=kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'ONE',display:{name:{english:'First',spanish:'Primero'},desc:{english:'Description'}}},'31':{name:'LAST',permission:'2',display:{name:{english:'Last'}}},'32':{name:'BAD'} }},'9':{type:'INT',name:'NUMERIC'}}}});
const snap=extra=>({eresult:1,game_id:'550',schema,stats:[{stat_id:7,stat_value:0x80000000}],achievement_blocks:[],...extra});
test('protocol schema preserves signed-boundary bits, English names and server control',()=>{
  const r=parseSnapshot(snap(),550);assert.equal(r.achievements.length,2);assert.equal(r.achievements[0].name,'First');assert.equal(r.achievements[0].unlocked,false);assert.equal(r.achievements[1].unlocked,true);assert.equal(r.achievements[1].serverControlled,true);assert.equal(r.verified,true);
});
test('missing personal stat blocks stay unknown even with achievement timestamps',()=>{
  const r=parseSnapshot(snap({stats:[]}),550);assert.equal(r.verified,false);assert.equal(r.achievements[0].unlocked,null);
  const timed=parseSnapshot(snap({stats:[],achievement_blocks:[{achievement_id:7,unlock_time:[123456]}]}),550);
  assert.equal(timed.achievements[0].unlockTimestamp,0);assert.equal(timed.achievements[0].unlocked,null);assert.equal(timed.achievements[1].unlocked,null);
});
test('timestamps never override locked bitmasks and future dates are not displayed',()=>{
  const r=parseSnapshot(snap({achievement_blocks:[{achievement_id:7,unlock_time:Array(32).fill(0xffffffff)}]}),550);
  assert.equal(r.achievements[0].unlocked,false);assert.equal(r.achievements[0].unlockTimestamp,0);
  assert.equal(r.achievements[1].unlocked,true);assert.equal(r.achievements[1].unlockTimestamp,0);
});
test('cleared bits retain separate timestamp evidence without inventing a displayed unlock date',()=>{
  const r=parseSnapshot(snap({achievement_blocks:[{achievement_id:7,unlock_time:[123456]}]}),550);
  assert.equal(r.achievements[0].unlocked,false);
  assert.equal(r.achievements[0].unlockTimestamp,0);
  assert.deepEqual(r.achievements[0].stateEvidence,{bitUnlocked:false,unlockTimePresent:true,reportedUnlockTimestamp:123456});
  assert.equal(r.diagnostics.retainedUnlockDateCount,1);
  assert.equal(r.diagnostics.retainedUnlockDates[0].apiname,'ONE');
  const missing=parseSnapshot(snap(),550).achievements[0].stateEvidence;
  assert.deepEqual(missing,{bitUnlocked:false,unlockTimePresent:false,reportedUnlockTimestamp:null});
});
test('wrong-game, rejected and malformed protocol responses cannot verify achievements',()=>{
  assert.throws(()=>parseSnapshot(snap({game_id:'240'}),550),/different game/);
  assert.throws(()=>parseSnapshot(snap({eresult:15}),550),/rejected/);
  assert.throws(()=>parseSnapshot(snap({schema:Buffer.from([0])}),550));
});
function client(respond) { const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._currentJobID=0;c._jobs=new Map();c._send=(header,body,cb)=>{const job=String(++c._currentJobID);c._jobs.set(job,cb);respond?.(header,body,cb);};return c; }
test('library corroboration is read-only, validates identity/game/count and cleans timeouts',async()=>{
  const c=client(),row={appid:550,unlocked:1,total:2,cache_time:123};
  const respond=(row,cb)=>cb(Buffer.from(Schema.CPlayer_GetAchievementsProgress_Response.encode({achievement_progress:[row]}).finish()),{msg:EMsg.ServiceMethodResponse,proto:{eresult:1,target_job_name:'Player.GetAchievementsProgress#1'}});
  c._send=(header,bytes,cb)=>{assert.equal(header.msg,EMsg.ServiceMethodCallFromClient);assert.equal(header.proto.target_job_name,'Player.GetAchievementsProgress#1');const input=Schema.CPlayer_GetAchievementsProgress_Request.decode(bytes);assert.deepEqual(input.appids,[550]);assert.equal(input.steamid.toString(),c.steamID.toString());respond(row,cb);};
  assert.deepEqual(await readLibrarySummary(c,550),{unlocked:1,total:2,cacheTime:123});
  for(const bad of [{...row,appid:440},{...row,unlocked:3},{...row,total:undefined},{...row,total:9000}]){c._send=(_,__,cb)=>respond(bad,cb);assert.equal(await readLibrarySummary(c,550),null);}
  c._send=()=>{};assert.equal(await readLibrarySummary(c,550,{timeoutMs:5}),null);assert.equal(c.listenerCount('error'),0);assert.equal(c.listenerCount('disconnected'),0);
});
test('a library/statistics disagreement exposes unknown state and prevents write eligibility',()=>{
  const r=parseSnapshot(snap({librarySummary:{unlocked:2,total:2,cacheTime:123}}),550);
  assert.equal(r.stateConflict,true);assert.equal(r.verified,false);assert.match(r.message,/statistics report 1\/2/);
  assert.ok(r.achievements.every(a=>a.unlocked===null&&!a.removalSupport.canRemove&&!a.compatibility.canUnlock));
  assert.equal(r.achievements[0].stateEvidence.bitUnlocked,false);
});
test('direct transport sends only read message and cleans callbacks after completion',async()=>{
  const messages=[];const c=client((header,body,cb)=>{messages.push(header.msg);if(header.msg===EMsg.ServiceMethodCallFromClient)return queueMicrotask(()=>cb(Buffer.from(Schema.CPlayer_GetAchievementsProgress_Response.encode({achievement_progress:[{appid:550,total:2,unlocked:1,cache_time:123}]}).finish()),{msg:EMsg.ServiceMethodResponse,proto:{target_job_name:'Player.GetAchievementsProgress#1',eresult:1}}));assert.equal(header.msg,EMsg.ClientGetUserStats);const req=Schema.CMsgClientGetUserStats.decode(body);assert.equal(req.game_id.toString(),'550');assert.equal(req.steam_id_for_user.toString(),c.steamID.toString());queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientGetUserStatsResponse.encode(snap()).finish()),{msg:EMsg.ClientGetUserStatsResponse}));});
  const r=await readProtocol(c,550);assert.equal(r.verified,true);assert.equal(c._jobs.size,0);assert.equal(c.listenerCount('disconnected'),0);
  assert.deepEqual(messages,[EMsg.ClientGetUserStats,EMsg.ServiceMethodCallFromClient]);assert.equal(r.diagnostics.librarySummary.unlocked,1);
});
test('protocol timeout and disconnection release pending callbacks',async()=>{
  const c=client();await assert.rejects(readProtocol(c,550,{timeoutMs:10}),/in time/);assert.equal(c._jobs.size,0);
  const pending=readProtocol(c,550);c.emit('disconnected');await assert.rejects(pending,/disconnected/);assert.equal(c._jobs.size,0);
});
test('hidden attributes and numeric progress are read independently from write permissions',()=>{
  const data=kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'HIDDEN',display:{hidden:'1',name:{english:'Hidden'}},progress:{max_val:'10',value:{operation:'statvalue',operand1:'COUNTER'}}}}},'9':{type:'INT',name:'COUNTER'}}}});
  const r=parseSnapshot(snap({schema:data,stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:3}]}),550);const a=r.achievements[0];
  assert.equal(a.hidden,true);assert.equal(a.serverControlled,false);assert.equal(a.compatibility.status,'dependency');assert.equal(a.progressDetails.currentValue,3);assert.equal(a.progressDetails.maximum,10);
});
