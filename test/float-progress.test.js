'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {decodeFloat,floatBits}=require('../lib/float-progress');
const {parseSnapshot}=require('../lib/steam-protocol');const {floatPreview}=require('../lib/achievement-progress');
const {prepare,unlockAchievement}=require('../lib/achievement-writer');const {EventEmitter}=require('node:events');
function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
function snapshot({stat={},bit={},goal='10.5',raw=floatBits(1.25),extraBits={},stats}={}){return {eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'DECIMAL',progress:{max_val:goal,value:{operation:'statvalue',operand1:'DISTANCE'}},...bit},...extraBits}},'9':{type:'2',name:'DISTANCE',min:'0',max:'100',...stat}}}}),stats:stats||[{stat_id:7,stat_value:0},{stat_id:9,stat_value:raw}]};}
test('FLOAT bit patterns round-trip finite values without interpreting them as integer counters',()=>{
  assert.equal(floatBits(1.25),0x3fa00000);assert.equal(decodeFloat(0x3fa00000),1.25);
  for(const value of [0,-0,-1.25,0.1,3.4028234663852886e38,1.401298464324817e-45])assert.ok(Object.is(decodeFloat(floatBits(value)),Math.fround(value)));
  for(const raw of [0x7f800000,0xff800000,0x7fc00000,-1,0x100000000,1.2,undefined])assert.equal(decodeFloat(raw),null);
  for(const value of [NaN,Infinity,-Infinity,1e40])assert.equal(floatBits(value),null);
});
test('numeric and named FLOAT definitions expose real progress and read-only previews',()=>{
  for(const type of ['2','FLOAT']){
    const s=snapshot({stat:{type}}),row=parseSnapshot(s,550).achievements[0],preview=floatPreview(s,550,'DECIMAL');
    assert.equal(row.progressDetails.currentValue,1.25);assert.equal(row.progressDetails.interpreted,true);assert.equal(row.progressSupport.canComplete,false);assert.equal(row.progressSupport.canPreviewFloat,true);
    assert.equal(preview.counter.after,10.5);assert.equal(preview.counter.afterRaw,floatBits(10.5));assert.equal(preview.canActivate,false);assert.equal(preview.revision.length,64);
    assert.throws(()=>prepare(s,550,'DECIMAL',{allowProgress:true}));assert.throws(()=>prepare(s,550,'DECIMAL'));
  }
});
test('decimal targets round upward to a representable value and never decrease completed progress',()=>{
  const p=floatPreview(snapshot({goal:'1.00000003',raw:floatBits(0.5)}),550,'DECIMAL').counter;
  assert.equal(p.after,1.0000001192092896);assert.ok(p.after>=p.goal);assert.equal(decodeFloat(p.afterRaw),p.after);
  assert.equal(floatPreview(snapshot({raw:floatBits(15.5)}),550,'DECIMAL').counter.after,15.5);
  assert.equal(floatPreview(snapshot({goal:'1e-46',raw:0}),550,'DECIMAL').counter.after,1.401298464324817e-45);
});
test('protected, shared, malformed and out-of-bounds decimal counters cannot be previewed or written',()=>{
  const cases=[{stat:{permission:'2'}},{stat:{bSetByTrustedGS:'1'}},{stat:{bSetByTrustedGS:'unknown'}},{bit:{permission:'2'}},{stat:{aggregated:'1'}},{stat:{incrementonly:'unknown'}},{stat:{maxchange:'2.5'}},{stat:{max:'10'}},{stat:{min:'2'}},{stat:{max:'Infinity'}},{stat:{min:''}},{goal:'0x10'},{goal:'NaN'},{goal:'0'},{raw:floatBits(-1)},{raw:0x7f800000},{raw:0x7fc00000},{goal:'1.00000003',raw:floatBits(0.5),stat:{max:'1.00000004'}},{stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:floatBits(1)},{stat_id:9,stat_value:floatBits(2)}]},{extraBits:{'1':{name:'SHARED',progress:{max_val:'20',value:{operation:'statvalue',operand1:'DISTANCE'}}}}},{bit:{progress:{max_val:'10',value:{operation:'add',operand1:'DISTANCE',operand2:'1'}}}}];
  for(const input of cases){const s=snapshot(input);assert.notEqual(parseSnapshot(s,550).achievements[0].progressSupport.canPreviewFloat,true,JSON.stringify(input));assert.throws(()=>floatPreview(s,550,'DECIMAL'));assert.throws(()=>prepare(s,550,'DECIMAL',{allowProgress:true}));}
  for(const type of ['3','AVGRATE'])assert.equal(parseSnapshot(snapshot({stat:{type}}),550).achievements[0].progressSupport.code,'unsupported_progress_type');
  assert.throws(()=>floatPreview({...snapshot(),crc_stats:undefined},550,'DECIMAL'));
});
test('FLOAT support never reaches the Steam write transport',async()=>{
  const client=new EventEmitter();client.steamID={toString:()=> '76561198000000001'};client._send=()=>{throw Error('Must not send');};let writes=0;
  await assert.rejects(unlockAchievement(client,550,'DECIMAL',{allowProgress:true,read:async()=>snapshot(),send:async()=>{writes++;}}));assert.equal(writes,0);
});
