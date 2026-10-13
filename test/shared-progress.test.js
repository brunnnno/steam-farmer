'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {sharedPreview}=require('../lib/achievement-progress');const {prepare}=require('../lib/achievement-writer');
function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
function snapshot({complex=false,protectedRow=false,unknown=false}={}){
  const achievement=(name,goal,extra={})=>({name,display:{name:{english:name}},progress:{max_val:String(goal),value:{operation:'statvalue',operand1:'COUNT'}},...extra});
  return {eresult:1,game_id:'550',crc_stats:1,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':achievement('TARGET',100),'1':achievement('EARLY',10),'2':achievement('LATER',1000),'3':achievement('ALREADY',1),'4':achievement('SPECIAL',50,complex?{progress:{max_val:'50',value:{operation:'add',operand1:'COUNT',operand2:'ANOTHER'}}}:protectedRow?{permission:'2'}:{})}},'9':{type:'INT',name:'COUNT'},...(unknown?{'11':{type:'4',bits:{'0':achievement('UNKNOWN',30)}}}:{})}}}),stats:[{stat_id:7,stat_value:8},{stat_id:9,stat_value:5}]};
}
test('shared preview names every related achievement and distinguishes unlocks, progress-only and existing unlocks',()=>{
  const s=snapshot(),p=sharedPreview(s,550,'TARGET');assert.equal(p.counter.before,5);assert.equal(p.counter.after,100);assert.equal(p.effects.length,5);assert.equal(p.effects.find(e=>e.apiname==='EARLY').effect,'would_unlock');assert.equal(p.effects.find(e=>e.apiname==='LATER').effect,'progress_only');assert.equal(p.effects.find(e=>e.apiname==='ALREADY').effect,'already_unlocked');assert.equal(p.completeImpact,true);assert.equal(p.canActivate,false);assert.throws(()=>prepare(s,550,'TARGET',{allowProgress:true}),/shared/);
});
test('complex, protected and missing personal states stay explicitly uncertain in the impact review',()=>{
  for(const [options,code]of [[{complex:true},'unknown'],[{protectedRow:true},'restricted'],[{unknown:true},'unknown']]){const p=sharedPreview(snapshot(options),550,'TARGET');assert.ok(p.effects.some(e=>e.effect===code));assert.equal(p.completeImpact,false);assert.equal(p.canActivate,false);}
});
