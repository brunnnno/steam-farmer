'use strict';
// No Steam transport or credentials: exercise repeated full-size local readings.
const {parseSnapshot}=require('../lib/steam-protocol');
const {revisionFor,changesBetween}=require('../lib/achievement-sync');
const {ResultCache}=require('../lib/cache');
function kv(obj){const parts=[];for(const[key,value]of Object.entries(obj))parts.push(Buffer.from([typeof value==='object'?0:1]),Buffer.from(key+'\0'),typeof value==='object'?kv(value):Buffer.from(String(value)+'\0'));parts.push(Buffer.from([8]));return Buffer.concat(parts);}
const stats={},values=[];
for(let block=0;block<256;block++){
  const bits={};for(let bit=0;bit<32;bit++){const index=block*32+bit;bits[bit]={name:'ACH_'+index,display:{name:{english:'Synthetic achievement '+index},desc:{english:'Bounded synchronization fixture. '.repeat(8)}}};}
  stats[100+block]={type:'4',bits};values.push({stat_id:100+block,stat_value:0});
}
const schema=kv({'550':{stats}}),cache=new ResultCache({maxBytes:2*1024*1024,maxEntries:24});
let previous=null,peak=process.memoryUsage.rss(),revision='',fullBytes=0;
for(let pass=0;pass<12;pass++){
  const changed=values.map((s,i)=>i===0?{...s,stat_value:pass%2}:s);
  const view=parseSnapshot({eresult:1,game_id:'550',crc_stats:pass+1,schema,stats:changed},550);view.readingMethod='protocol';revision=revisionFor(view);
  if(previous){const delta=changesBetween(previous.achievements,view.achievements);if(delta.total!==1)throw Error('An observed bit transition was lost.');}
  cache.set('account:550',view);fullBytes=Buffer.byteLength(JSON.stringify(view));previous=view;peak=Math.max(peak,process.memoryUsage.rss());
}
const unchangedBytes=Buffer.byteLength(JSON.stringify({unchanged:true,stateRevision:revision,checkedAt:new Date().toISOString(),readingMethod:'protocol',source:'Steam client protocol',verified:true}));
console.log(JSON.stringify({mode:'local synthetic maximum live synchronization',achievements:8192,iterations:12,peakRssMiB:Number((peak/1048576).toFixed(1)),cacheBytes:cache.bytes,fullBytes,unchangedBytes,steamWritesSent:0}));
if(peak>=400*1048576)throw Error('Synchronization exceeds the memory headroom target.');
