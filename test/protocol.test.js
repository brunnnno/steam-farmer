'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const {readProtocol, parseSnapshot} = require('../lib/steam-protocol');
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
test('wrong-game, rejected and malformed protocol responses cannot verify achievements',()=>{
  assert.throws(()=>parseSnapshot(snap({game_id:'240'}),550),/different game/);
  assert.throws(()=>parseSnapshot(snap({eresult:15}),550),/rejected/);
  assert.throws(()=>parseSnapshot(snap({schema:Buffer.from([0])}),550));
});
function client(respond) { const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._currentJobID=0;c._jobs=new Map();c._send=(header,body,cb)=>{const job=String(++c._currentJobID);c._jobs.set(job,cb);respond?.(header,body,cb);};return c; }
test('direct transport sends only read message and cleans callbacks after completion',async()=>{
  const c=client((header,body,cb)=>{assert.equal(header.msg,EMsg.ClientGetUserStats);const req=Schema.CMsgClientGetUserStats.decode(body);assert.equal(req.game_id.toString(),'550');assert.equal(req.steam_id_for_user.toString(),c.steamID.toString());queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientGetUserStatsResponse.encode(snap()).finish()),{msg:EMsg.ClientGetUserStatsResponse}));});
  const r=await readProtocol(c,550);assert.equal(r.verified,true);assert.equal(c._jobs.size,0);assert.equal(c.listenerCount('disconnected'),0);
});
test('protocol timeout and disconnection release pending callbacks',async()=>{
  const c=client();await assert.rejects(readProtocol(c,550,{timeoutMs:10}),/in time/);assert.equal(c._jobs.size,0);
  const pending=readProtocol(c,550);c.emit('disconnected');await assert.rejects(pending,/disconnected/);assert.equal(c._jobs.size,0);
});
