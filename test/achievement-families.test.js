'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseSnapshot}=require('../lib/steam-protocol'),{prepare}=require('../lib/achievement-writer'),{classify}=require('../public/achievement-availability');
function kv(obj){const parts=[];for(const[k,v]of Object.entries(obj))parts.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));parts.push(Buffer.from([8]));return Buffer.concat(parts);}
function fixture({bit={},block={},counter={},extraBits={},extraStats={},personal,crc=123,progress=false,mask=0}={}){
  return {eresult:1,game_id:'550',...(crc===null?{}:{crc_stats:crc}),schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'TARGET',...(progress?{progress:{max_val:'10',value:{operation:'statvalue',operand1:'COUNT'}}}:{}),...bit},...extraBits},...block},'9':{name:'COUNT',type:'INT',min:'0',max:'100',...counter},...extraStats}}}),stats:personal||[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:3}]};
}
const cases=[
  ['ordinary bit',{},'eligible',true],
  ['hidden bit',{bit:{hidden:'1'}},'eligible',true],
  ['visible bit',{bit:{hidden:'0'}},'eligible',true],
  ['server-controlled bit',{bit:{permission:'2'}},'protected',false],
  ['server-controlled block',{block:{permission:'2'}},'protected',false],
  ['trusted-server bit',{bit:{bSetByTrustedGS:'1'}},'protected',false],
  ['trusted-server block',{block:{bSetByTrustedGS:'true'}},'protected',false],
  ['unknown trusted-server declaration',{bit:{bSetByTrustedGS:'unexpected'}},'unknown',false],
  ['other unsupported permission',{bit:{permission:'1'}},'unsupported',false],
  ['missing CRC',{crc:null},'unknown',false],
  ['invalid CRC',{crc:-1},'unknown',false],
  ['missing personal bitmask',{personal:[{stat_id:9,stat_value:3}]},'unknown',false],
  ['duplicate personal bitmask',{personal:[{stat_id:7,stat_value:0},{stat_id:7,stat_value:1}]},'unknown',false],
  ['duplicate API name',{extraBits:{'1':{name:'TARGET'}}},'unknown',false],
  ['exclusive INT progress',{progress:true},'progress',true],
  ['hidden INT progress',{progress:true,bit:{hidden:'1'}},'progress',true],
  ['already-reached counter',{progress:true,personal:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:15}]},'progress',true],
  ['FLOAT progress',{progress:true,counter:{type:'FLOAT'}},'unsupported',false],
  ['AVGRATE progress',{progress:true,counter:{type:'AVGRATE'}},'unsupported',false],
  ['aggregated counter',{progress:true,counter:{aggregated:'1'}},'unsupported',false],
  ['protected counter',{progress:true,counter:{permission:'2'}},'protected',false],
  ['trusted-server counter',{progress:true,counter:{bSetByTrustedGS:'1'}},'protected',false],
  ['progress in trusted-server block',{progress:true,block:{bSetByTrustedGS:'1'}},'protected',false],
  ['progress with unknown trusted flag',{progress:true,block:{bSetByTrustedGS:'maybe'}},'unknown',false],
  ['missing progress value',{progress:true,personal:[{stat_id:7,stat_value:0}]},'unknown',false],
  ['duplicate progress value',{progress:true,personal:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:3},{stat_id:9,stat_value:4}]},'unknown',false],
  ['ambiguous linked counter',{progress:true,extraStats:{'10':{name:'COUNT',type:'INT'}}},'unknown',false],
  ['counter upper bound',{progress:true,counter:{max:'9'}},'unsupported',false],
  ['counter maximum change',{progress:true,counter:{maxchange:'2'}},'unsupported',false],
  ['invalid counter constraints',{progress:true,counter:{min:'invalid'}},'unknown',false],
  ['complex progress expression',{progress:true,bit:{progress:{max_val:'10',value:{operation:'add',operand1:'COUNT',operand2:'OTHER'}}}},'unsupported',false],
  ['shared counter',{progress:true,extraBits:{'1':{name:'OTHER',progress:{max_val:'20',value:{operation:'statvalue',operand1:'COUNT'}}}}},'review',false],
  ['progress without CRC',{progress:true,crc:null},'unknown',false],
  ['duplicate progress API name',{progress:true,extraBits:{'1':{name:'TARGET'}}},'unknown',false]
];
for(const[name,options,status,canAttempt]of cases)test('actual parser, classifier and writer agree: '+name,()=>{
  const snapshot=fixture(options),row=parseSnapshot(snapshot,550).achievements[0],availability=classify(row,{method:'protocol'});
  assert.equal(availability.status,status);assert.equal(availability.canAttempt,canAttempt);
  if(canAttempt){const plan=prepare(snapshot,550,'TARGET',{allowProgress:Boolean(options.progress)});assert.ok(plan.payload);assert.equal(plan.payload.explicit_reset,false);}
  else assert.throws(()=>prepare(snapshot,550,'TARGET',{allowProgress:Boolean(options.progress)}));
});
test('already unlocked never produces another write plan',()=>{const snapshot=fixture({mask:1}),row=parseSnapshot(snapshot,550).achievements[0];assert.equal(classify(row,{method:'protocol'}).status,'unlocked');assert.equal(prepare(snapshot,550,'TARGET').payload,null);});
test('bit 31 is classified and planned without changing neighboring bits',()=>{const snapshot=fixture({extraBits:{'31':{name:'LAST'}},mask:1}),row=parseSnapshot(snapshot,550).achievements.find(a=>a.apiname==='LAST');assert.equal(classify(row,{method:'protocol'}).canAttempt,true);assert.equal(prepare(snapshot,550,'LAST').payload.stats[0].stat_value,0x80000001);});
