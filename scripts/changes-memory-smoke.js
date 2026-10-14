'use strict';
// Local-only worst-size planning: 8,192 synthetic achievements, 32 selected counters, 64 effects.
const {prepareChanges,verifyChanges}=require('../lib/achievement-changes');
function kv(obj){const a=[];for(const[k,v]of Object.entries(obj))a.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));a.push(Buffer.from([8]));return Buffer.concat(a);}
const stats={},values=[],selection=[];
for(let block=0;block<256;block++){
  const id=100+block,bits={};for(let bit=0;bit<32;bit++){const index=block*32+bit;bits[bit]={name:'ACH_'+index,display:{name:{english:'Synthetic achievement '+index},desc:{english:'Synthetic bounded-memory fixture. '.repeat(8)}}};if(index<64){const counter=index%32;bits[bit].progress={max_val:index<32?'10':'100',value:{operation:'statvalue',operand1:'COUNT_'+counter}};if(index<32)selection.push({apiname:bits[bit].name,action:'unlock'});}}stats[id]={type:'4',bits};values.push({stat_id:id,stat_value:0});
}
for(let i=0;i<32;i++){stats[1000+i]={type:'INT',name:'COUNT_'+i,min:'0',max:'1000'};values.push({stat_id:1000+i,stat_value:0});}
const schema=kv({'550':{stats}}),snapshot={eresult:1,game_id:'550',crc_stats:12,schema,stats:values};let peak=0;
for(let i=0;i<8;i++){const plan=prepareChanges(snapshot,550,selection);if(plan.effects.length!==64)throw Error('Incomplete impact');const final={...snapshot,crc_stats:13,stats:[...plan.expectedValues].map(([stat_id,stat_value])=>({stat_id,stat_value}))};if(!verifyChanges(snapshot,final,plan,{result:1,gameId:'550',stale:false,rejectedStats:[]}).confirmed)throw Error('Synthetic verification failed');peak=Math.max(peak,process.memoryUsage.rss());}
console.log(JSON.stringify({mode:'local synthetic maximum achievement list',achievements:8192,selected:32,effects:64,iterations:8,peakRssMiB:Number((peak/1048576).toFixed(1)),heapLimitMiB:Math.round(require('node:v8').getHeapStatistics().heap_size_limit/1048576),steamWritesSent:0}));if(peak>=400*1048576)throw Error('Synthetic memory peak exceeds target headroom');
