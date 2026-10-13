'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {runReadOnlyProbes}=require('../lib/achievement-probes');
function kv(obj){const pieces=[];for(const[k,v]of Object.entries(obj))pieces.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));pieces.push(Buffer.from([8]));return Buffer.concat(pieces);}
function snap({permission,progress,mask=0}={}){return {eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'TARGET',...(permission?{permission}:{}),...(progress?{progress:{max_val:'10',value:{operand1:'COUNT'}}}:{})}}},'8':{type:'INT',name:'COUNT'}}}}),stats:[{stat_id:7,stat_value:mask},{stat_id:8,stat_value:3}]};}
const client=()=>({steamID:{toString:()=> '76561198000000001'},_send:()=>{throw Error('Writes forbidden');}});
test('live-style probes exercise actual preparation guards and verify unchanged stats without writes',async()=>{
  for(const [code,options] of [['server_controlled',{permission:'2'}],['progress_dependency',{progress:true}]]){
    let reads=0;const result=await runReadOnlyProbes(client(),{targets:[{appid:550,apiname:'TARGET',expectedCode:code}],read:async()=>{reads++;return snap(options);}});
    assert.equal(result.results[0].outcome,'passed');assert.equal(result.results[0].writesSent,0);assert.equal(reads,2);
  }
});
test('probes do not report a pass when state changed or preparation would allow activation',async()=>{
  let reads=0;const changed=await runReadOnlyProbes(client(),{targets:[{appid:550,apiname:'TARGET',expectedCode:'server_controlled'}],read:async()=>snap({permission:'2',mask:reads++?1:0})});
  assert.equal(changed.results[0].outcome,'inconclusive');
  const eligible=await runReadOnlyProbes(client(),{targets:[{appid:550,apiname:'TARGET',expectedCode:'server_controlled'}],read:async()=>snap()});assert.equal(eligible.results[0].outcome,'inconclusive');assert.equal(eligible.results[0].writesSent,0);
});
test('already unlocked progress is observed without offering another completion plan or write',async()=>{
  const result=await runReadOnlyProbes(client(),{targets:[{appid:550,apiname:'TARGET',expectedCode:'progress_dependency'}],read:async()=>snap({progress:true,mask:1})});
  assert.equal(result.results[0].outcome,'observed_unlocked');assert.equal(result.results[0].progressPreview.supported,false);assert.equal(result.results[0].progressPreview.code,'already_unlocked');assert.equal(result.results[0].writesSent,0);
});
