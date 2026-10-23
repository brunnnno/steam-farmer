'use strict';
// Suite unificada de pruebas unitarias de protocolo, caché, rareza, flotantes y persistencia

// === [achievement-families.test.js] ===
(() => {
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
  ['FLOAT progress',{progress:true,counter:{type:'FLOAT'}},'review',false],
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

})();

// === [achievement-live.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const AchievementLive=require('../public/achievement-live');
function clock(){
  let serial=0;const timers=new Map();
  return {setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),size:()=>timers.size,delay:()=>[...timers.values()][0]?.delay,
    fire:async()=>{const [id,timer]=timers.entries().next().value||[];assert.ok(timer,'Expected a scheduled read.');timers.delete(id);return timer.callback();}};
}
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function fixture(t,options={}){
  const time=clock(),statuses=[];const live=AchievementLive.create({canRun:()=>true,poll:async()=>({}),intervalMs:10,maxDelayMs:60,...time,onStatus:(state,detail)=>statuses.push({state,...detail}),...options});
  t.after(()=>live.stop());return {time,statuses,live};
}
test('monitoring schedules one read, passes cancellation, and schedules the next read after completion',async t=>{
  let calls=0;const {live,time,statuses}=fixture(t,{poll:async(context,{signal})=>{calls++;assert.equal(context.game,550);assert.equal(signal.aborted,false);return {unlocked:70};}});
  live.start({game:550});assert.equal(calls,0);assert.equal(time.size(),1);assert.equal(time.delay(),10);await time.fire();assert.equal(calls,1);assert.equal(time.size(),1);assert.equal(time.delay(),10);assert.deepEqual(statuses.map(s=>s.state),['live','checking','live']);assert.equal(statuses.at(-1).result.unlocked,70);
});
test('concurrent ticks share one poll and wake coalesces to one follow-up',async t=>{
  const gate=deferred();let calls=0,active=0,peak=0;const {live,time}=fixture(t,{poll:async()=>{calls++;peak=Math.max(peak,++active);if(calls===1)await gate.promise;active--;return {calls};}});
  live.start({game:550});const first=live.tick(),second=live.tick(),third=live.wake();assert.equal(calls,1);assert.equal(time.size(),0);gate.resolve();await Promise.all([first,second,third]);assert.equal(peak,1);assert.equal(time.size(),1);assert.equal(time.delay(),0);await time.fire();assert.equal(calls,2);assert.equal(peak,1);assert.equal(time.size(),1);assert.equal(time.delay(),10);
});
test('stop aborts the current read, ignores its late success and leaves no timer',async t=>{
  const gate=deferred();let signal,calls=0;const {live,time,statuses}=fixture(t,{poll:async(_,options)=>{calls++;signal=options.signal;return gate.promise;}});
  live.start({game:550});const task=live.tick();live.stop();assert.equal(signal.aborted,true);const count=statuses.length;gate.resolve({stale:true});await task;assert.equal(statuses.length,count);assert.equal(time.size(),0);await live.tick();await live.wake();assert.equal(calls,1);
});
test('replacement waits for the aborted read to settle and an old response cannot update the new context',async t=>{
  const gate=deferred();let calls=0,oldSignal;const seen=[];const {live,time,statuses}=fixture(t,{poll:async(context,{signal})=>{seen.push(context.game);if(++calls===1){oldSignal=signal;return gate.promise;}return {game:context.game};}});
  live.start({game:550});const oldTask=live.tick();live.start({game:240});const replacement=live.wake();assert.equal(oldSignal.aborted,true);assert.equal(calls,1);assert.equal(time.size(),0);gate.resolve({game:550});await Promise.all([oldTask,replacement]);assert.ok(!statuses.some(s=>s.result?.game===550));assert.equal(time.delay(),0);await time.fire();assert.deepEqual(seen,[550,240]);assert.equal(statuses.at(-1).context.game,240);assert.equal(statuses.at(-1).result.game,240);assert.equal(time.size(),1);
});
test('old failures after replacement cannot back off the new context',async t=>{
  const gate=deferred();let calls=0;const {live,time,statuses}=fixture(t,{poll:async()=>++calls===1?gate.promise:{fresh:true}});
  live.start({game:550});const old=live.tick();live.start({game:240});gate.reject(Error('Old context failed'));await old;assert.equal(time.delay(),10);assert.ok(!statuses.some(s=>s.state==='retrying'));await time.fire();assert.equal(statuses.at(-1).result.fresh,true);assert.equal(time.delay(),10);
});
test('errors back off within the configured cap and one successful read resets the interval',async t=>{
  let fail=true;const {live,time,statuses}=fixture(t,{poll:async()=>{if(fail)throw Error('Steam busy');return {fresh:true};}});live.start({game:550});
  for(const delay of [20,40,60,60,60]){await live.tick();assert.equal(time.size(),1);assert.equal(time.delay(),delay);assert.equal(statuses.at(-1).state,'retrying');assert.equal(statuses.at(-1).delayMs,delay);}
  fail=false;await time.fire();assert.equal(time.delay(),10);assert.equal(statuses.at(-1).state,'live');
});
test('hidden, closed or review-paused availability skips network work and wake resumes immediately',async t=>{
  let allowed=false,calls=0;const {live,time,statuses}=fixture(t,{canRun:()=>allowed,poll:async()=>{calls++;return {};}});live.start({game:550});await live.tick();await time.fire();assert.equal(calls,0);assert.equal(time.delay(),10);assert.equal(statuses.at(-1).state,'paused');allowed=true;await live.wake();assert.equal(calls,1);assert.equal(statuses.at(-1).state,'live');assert.equal(time.delay(),10);live.stop();assert.equal(time.size(),0);
});
test('availability changes before the scheduled read and stopped timers never poll',async t=>{
  let allowed=true,calls=0;const {live,time}=fixture(t,{canRun:()=>allowed,poll:async()=>{calls++;}});live.start({game:550});allowed=false;await time.fire();assert.equal(calls,0);live.stop();assert.equal(time.size(),0);allowed=true;await live.wake();assert.equal(calls,0);
});
test('browser entry is dependency-free and enforces a maximum delay of sixty seconds',async t=>{
  const time=clock(),context={AbortController,...time};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/achievement-live.js'),'utf8'),context);assert.equal(typeof context.AchievementLive.create,'function');const live=context.AchievementLive.create({canRun:()=>true,poll:async()=>{throw Error('Busy');},intervalMs:10000,maxDelayMs:999999,...time,AbortController});t.after(()=>live.stop());live.start({game:550});for(let i=0;i<10;i++)await live.tick();assert.equal(time.delay(),60000);assert.equal(time.size(),1);
});

})();

// === [achievement-sync.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict');
const {revisionFor,changesBetween}=require('../lib/achievement-sync');

const row=(apiname,unlocked=false,extra={})=>({apiname,name:apiname,unlocked,...extra});
const view=achievements=>({achievements,readingMethod:'protocol',source:'Steam client protocol',outcome:'available',verified:true,message:'Read from Steam.'});
const progress=(currentValue,type='INT',extra={})=>({statName:'COUNT',type,currentValue,maximum:10,interpreted:true,...extra});

test('personal revision is order stable, including duplicate rows and nested object keys',()=>{
  const rows=[row('B',true,{compatibility:{canUnlock:false,status:'provisional'}}),row('A'),row('A',true)];
  assert.match(revisionFor(view(rows)),/^[0-9a-f]{64}$/);
  const reordered=[rows[2],rows[1],row('B',true,{compatibility:{status:'provisional',canUnlock:false}})];
  assert.equal(revisionFor(view(rows)),revisionFor(view(reordered)));
  assert.notEqual(revisionFor(view(rows)),revisionFor(view(rows.slice(0,2))));
});

test('read timing, rarity and icons do not change a personal revision',()=>{
  const original=view([row('A',true,{unlockTimestamp:123,percent:1,tier:'Mythic',iconOpen:'old',compatibility:{status:'provisional'}})]);
  const updated={...original,checkedAt:'2030-01-01',readDurationMs:321,rarityMessage:'new',achievements:[{...original.achievements[0],percent:70,tier:'Common',iconOpen:'new',iconClosed:'new',checkedAt:'later',compatibility:{status:'provisional',duration:42}}]};
  assert.equal(revisionFor(original),revisionFor(updated));
});

test('personal states, real timestamp evidence, permission and review eligibility change revision',()=>{
  const original=view([row('A',false,{statId:7,bitIndex:1,stateEvidence:{bitUnlocked:false,reportedUnlockTimestamp:123},compatibility:{canUnlock:true,status:'provisional'},removalSupport:{canRemove:false},batchSupport:{canReactivate:false}})]);
  for(const changed of [{unlockDate:'14 Oct, 2026 @ 12:00pm'},{unlocked:true},{statId:8},{permission:'2'},{stateEvidence:{bitUnlocked:false,reportedUnlockTimestamp:0}},{compatibility:{canUnlock:false,status:'restricted'}},{removalSupport:{canRemove:true}},{batchSupport:{canReactivate:true}}]){
    assert.notEqual(revisionFor(original),revisionFor({...original,achievements:[{...original.achievements[0],...changed}]}));
  }
});

test('progress values and support changes invalidate the revision independently of unlock state',()=>{
  const original=view([row('A',false,{progressDetails:progress(2),progressSupport:{canComplete:true}})]);
  for(const changed of [{progressDetails:progress(3)},{progressDetails:progress(2,'FLOAT')},{progressSupport:{canComplete:false,reason:'protected'}}])
    assert.notEqual(revisionFor(original),revisionFor({...original,achievements:[{...original.achievements[0],...changed}]}));
});

test('reading source, conflicts, history availability and messages invalidate revision',()=>{
  const original=view([row('A')]);
  for(const changed of [{readingMethod:'web'},{source:'Community'},{outcome:'catalog'},{verified:false},{message:'Not verified.'},{stateConflict:true},{historyWarning:'History unavailable.'}])
    assert.notEqual(revisionFor(original),revisionFor({...original,...changed}));
});

test('revision rejects oversized row sets and bounded source/row contexts without copying diagnostics',()=>{
  assert.throws(()=>revisionFor(view(Array.from({length:8193},(_,i)=>row(String(i))))),e=>e.status===413);
  assert.throws(()=>revisionFor({...view([]),message:'x'.repeat(65537)}),e=>e.status===413);
  assert.throws(()=>revisionFor(view([row('A',false,{description:'x'.repeat(16385)})])),e=>e.status===413);
  const harmless={...view([row('A')]),diagnostics:{unrelated:'x'.repeat(100000)}};
  assert.equal(revisionFor(harmless),revisionFor(view([row('A')])));
  assert.doesNotThrow(()=>revisionFor(view(Array.from({length:8192},(_,i)=>row(String(i))))));
});

test('revision rejects excessive canonical totals, cyclic structures and excessive depth',()=>{
  const description='x'.repeat(4096),large=Array.from({length:8192},(_,i)=>row(String(i),false,{description}));
  assert.throws(()=>revisionFor(view(large)),e=>e.status===413);
  const circular={};circular.self=circular;
  assert.throws(()=>revisionFor(view([row('A',false,{compatibility:circular})])),TypeError);
  let deep={};for(let i=0;i<15;i++)deep={child:deep};
  assert.throws(()=>revisionFor(view([row('A',false,{compatibility:deep})])),e=>e.status===413);
});

test('revision accepts maximal real-format protocol views beyond the serialized cache budget',t=>{
  const {parseSnapshot}=require('../lib/steam-protocol'),{floatBits}=require('../lib/float-progress');
  const kv=object=>{
    const parts=[];
    for(const [key,value]of Object.entries(object))parts.push(Buffer.from([typeof value==='object'?0:1]),Buffer.from(key+'\0'),typeof value==='object'?kv(value):Buffer.from(String(value)+'\0'));
    parts.push(Buffer.from([8]));return Buffer.concat(parts);
  };
  let sampledRss=process.memoryUsage.rss();const initialRss=sampledRss;
  const stats={},values=[];
  for(let block=0;block<256;block++){
    const id=100+block,bits={};
    for(let bit=0;bit<32;bit++){
      const index=block*32+bit;
      bits[bit]={name:'ACH_'+index,display:{name:{english:'Real-format achievement '+index},desc:{english:'An achievement from a maximal protocol fixture. '.repeat(3)},hidden:'0',icon:'open.jpg',icon_gray:'closed.jpg'}};
      if(index<64)bits[bit].progress={max_val:index<32?'10':'100',value:{operation:'statvalue',operand1:'COUNT_'+index%32}};
    }
    stats[id]={type:'4',bits};values.push({stat_id:id,stat_value:0});
  }
  for(let i=0;i<32;i++){const decimal=i===31;stats[1000+i]={type:decimal?'2':'1',name:'COUNT_'+i,min:'0',max:'1000'};values.push({stat_id:1000+i,stat_value:decimal?floatBits(1.25):3});}
  const parsed=parseSnapshot({eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats}}),stats:values},550);
  parsed.readingMethod='protocol';
  for(const achievement of parsed.achievements)achievement.batchSupport={canRemove:false,canReactivate:false,removalReason:achievement.removalSupport.reason};
  assert.equal(parsed.achievements.length,8192);assert.equal(parsed.verified,true);
  const serializedBytes=Buffer.byteLength(JSON.stringify(parsed));assert.ok(serializedBytes>2*1024*1024);
  sampledRss=Math.max(sampledRss,process.memoryUsage.rss());
  const revision=revisionFor(parsed);assert.match(revision,/^[0-9a-f]{64}$/);
  assert.equal(revision,revisionFor({...parsed,achievements:[...parsed.achievements].reverse(),checkedAt:'later',readDurationMs:999}));
  const progressRow=parsed.achievements[0];progressRow.progressDetails.currentValue++;
  assert.notEqual(revision,revisionFor(parsed));
  sampledRss=Math.max(sampledRss,process.memoryUsage.rss());
  t.diagnostic(JSON.stringify({mode:'local real-format 8192-row synchronization',serializedMiB:Number((serializedBytes/1048576).toFixed(1)),sampledRssMiB:Number((sampledRss/1048576).toFixed(1)),sampledRssGrowthMiB:Number(((sampledRss-initialRss)/1048576).toFixed(1)),steamWritesSent:0}));
  assert.ok(sampledRss<400*1048576,'Synthetic synchronization must retain headroom below 400 MiB.');
});

test('observed changes report exact unlocks, removals and finite linked progress without dates',()=>{
  const before=[row('UNLOCK'),row('REMOVE',true),row('PROGRESS',false,{progressDetails:progress(2)})];
  const after=[row('UNLOCK',true,{unlockTimestamp:123}),row('REMOVE',false),row('PROGRESS',false,{progressDetails:progress(4)})];
  assert.deepEqual(changesBetween(before,after),{
    changes:[{apiname:'PROGRESS',name:'PROGRESS',kind:'progress',before:2,after:4,statName:'COUNT',type:'INT',maximum:10},{apiname:'REMOVE',name:'REMOVE',kind:'remove',before:true,after:false},{apiname:'UNLOCK',name:'UNLOCK',kind:'unlock',before:false,after:true}],
    counts:{unlock:1,remove:1,progress:1},total:3,truncated:false
  });
  assert.deepEqual(changesBetween(after,before).counts,{unlock:1,remove:1,progress:1});
});

test('unknown, missing, new and disappeared states never create observed transitions',()=>{
  const before=[row('A',null),row('B',true),{apiname:'C'},row('GONE'),row('P',null,{progressDetails:progress(1)})];
  const after=[row('A',true),row('B',null),row('C',false),row('NEW',true),row('P',false,{progressDetails:progress(2)})];
  assert.deepEqual(changesBetween(before,after),{changes:[],counts:{unlock:0,remove:0,progress:0},total:0,truncated:false});
});

test('observed transitions require unique API names and never guess identifiers from aliases',()=>{
  const before=[row('DUP'),row('DUP'),row('OTHER'),{id:'ID_ONLY',name:'DISPLAY_ONLY',unlocked:false},row('lower')];
  const after=[row('DUP',true),row('OTHER',true),row('OTHER',true),{id:'ID_ONLY',name:'DISPLAY_ONLY',unlocked:true},row('LOWER',true)];
  assert.equal(changesBetween(before,after).total,0);
  assert.equal(changesBetween([row('A')],[row('A',true),row('A',true),row('A',true)]).total,0);
});

test('ambiguous physical aliases and changed bit locations are omitted as schema changes',()=>{
  const physical={statId:7,bitIndex:1};
  assert.equal(changesBetween([row('A',false,physical),row('B',false,physical)],[row('A',true,physical),row('B',true,physical)]).total,0);
  assert.equal(changesBetween([row('A',false,physical)],[row('A',true,{statId:8,bitIndex:1})]).total,0);
  assert.equal(changesBetween([row('A',false,physical)],[row('A',true)]).total,0);
});

test('FLOAT progress comparison follows representable IEEE-754 values without hiding real steps',()=>{
  const original=[row('A',false,{progressDetails:progress(1.25,'FLOAT')})];
  assert.equal(changesBetween(original,[row('A',false,{progressDetails:progress(1.250000001,'FLOAT')})]).total,0);
  const result=changesBetween(original,[row('A',false,{progressDetails:progress(1.2500001192092896,'FLOAT')})]);
  assert.equal(result.counts.progress,1);assert.equal(result.changes[0].after,Math.fround(1.2500001192092896));
});

test('numeric Steam schema type aliases compare the same counter and retain both simultaneous effects',()=>{
  const before=[row('A',false,{progressDetails:progress(1,'1')}),row('B',false,{progressDetails:progress(1.25,'2')})];
  const after=[row('A',true,{progressDetails:progress(10,'INT')}),row('B',false,{progressDetails:progress(1.5,'FLOAT')})];
  const result=changesBetween(before,after);
  assert.deepEqual(result.counts,{unlock:1,remove:0,progress:2});assert.equal(result.total,3);
  assert.deepEqual(result.changes.map(r=>[r.kind,r.type||null]),[['unlock',null],['progress','INT'],['progress','FLOAT']]);
});

test('counter identity/type/goal changes and unknown values do not become progress events',()=>{
  const original=[row('A',false,{progressDetails:progress(1)})];
  for(const next of [progress(2,'FLOAT'),progress(2,'INT',{statName:'DIFFERENT'}),progress(2,'INT',{maximum:20}),progress(2,'INT',{interpreted:false}),progress(null),progress(NaN),progress(Infinity),progress(2.5),progress(2,'AVGRATE')])
    assert.equal(changesBetween(original,[row('A',false,{progressDetails:next})]).total,0);
});

test('bounded event output retains complete totals and stable ordering',()=>{
  const before=Array.from({length:8192},(_,i)=>row(String(i).padStart(4,'0'))),after=before.map(r=>({...r,unlocked:true}));
  const result=changesBetween(before,after,{limit:3});
  assert.equal(result.changes.length,3);assert.deepEqual(result.changes.map(r=>r.apiname),['0000','0001','0002']);
  assert.deepEqual(result.counts,{unlock:8192,remove:0,progress:0});assert.equal(result.total,8192);assert.equal(result.truncated,true);
  assert.deepEqual(result,changesBetween([...before].reverse(),[...after].reverse(),{limit:3}));
  assert.equal(changesBetween(before,after,{limit:10000}).changes.length,32);
  assert.equal(changesBetween(before,after,{limit:0}).total,8192);
});

test('observed-change comparison rejects invalid limits and excessive input rows',()=>{
  for(const limit of [-1,1.5,NaN])assert.throws(()=>changesBetween([],[],{limit}),RangeError);
  assert.throws(()=>changesBetween([],Array.from({length:8193},()=>row('A'))),e=>e.status===413);
  assert.throws(()=>changesBetween([],null),TypeError);
});

})();

// === [achievements.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');
const {achievements,parseXml,parseHtml,remote,parseCards}=require('../lib/steam-data');
const sid='76561198000000001';
test('successful HTTP 204 webhook responses do not attempt to iterate a missing body',async()=>{
  let calls=0;const r=await remote('https://discord.com/api/webhooks/123/test-token',{method:'POST',body:'{}'},async()=>{calls++;return new Response(null,{status:204});});assert.equal(r.body,'');assert.equal(calls,1);
});
test('verified personal XML returns before a stalled optional source and aborts remaining fetches',async()=>{
  let signal,release;const stalled=new Promise(r=>release=r);
  const xml='<playerstats><steamID64>'+sid+'</steamID64><achievements><achievement closed="1"><apiname>REAL</apiname><name>One</name></achievement></achievements></playerstats>';
  const request=async(url,opts)=>{signal=opts.signal;if(url.includes('xml=1'))return {body:xml,finalUrl:url};return stalled;};
  const start=Date.now();const timeout=setTimeout(()=>release({body:'{}',finalUrl:'https://steamcommunity.com/'}),1000);
  try{const result=await achievements({}, {steamId64:sid},240,'',request);assert.equal(result.verified,true);assert.equal(result.source,'Steam Community XML');assert.ok(Date.now()-start<500);assert.equal(signal.aborted,true);assert.equal(result.achievements[0].percent,null);assert.equal(result.diagnostics.sources.global,'not_awaited');}finally{clearTimeout(timeout);release({body:'{}',finalUrl:'https://steamcommunity.com/'});}
});
test('catalog response waits for personal sources instead of returning a premature unknown state',async()=>{
  let release;const gate=new Promise(r=>release=r);const xml='<playerstats><achievements><achievement closed="0"><apiname>REAL</apiname><name>One</name></achievement></achievements></playerstats>';
  let finished=false;const request=async(url)=>{if(url.includes('xml=1')){await gate;return {body:xml,finalUrl:url};}if(url.includes('/stats/240/achievements/'))return {body:row('One'),finalUrl:url};throw Error('unavailable');};
  const pending=achievements({}, {steamId64:sid},240,'',request).then(r=>{finished=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(finished,false);release();const result=await pending;assert.equal(result.verified,true);assert.equal(result.achievements[0].unlocked,false);
});
test('caller cancellation reaches the actual remote request signal',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(remote('https://steamcommunity.com/',{signal:controller.signal},async(_,opts)=>{assert.equal(opts.signal.aborted,true);throw opts.signal.reason;}));});
test('badge parser reads real titles and remaining drops without view-details decoration',()=>{const html='<div class="badge_row"><a class="badge_row_overlay" href="https://steamcommunity.com/my/gamecards/240/"></a><div class="badge_title">Counter-Strike: Source<div class="badge_view_details">View details</div></div><span class="progress_info_bold">3 card drops remaining</span></div>';assert.deepEqual(parseCards(html),[{appid:240,remaining:3,name:'Counter-Strike: Source'}]);});
const row=(name,extra='')=>`<div class="achieveRow"><img src="https://example.test/icon.png"><h3>${name}</h3><h5>Description</h5>${extra}<div class="achievePercent">0.0%</div></div>`;
function source(name,url,body){return {body,finalUrl:url};}
test('fuentes paralelas toleran API caída y enriquecen HTML personal con rareza global',async()=>{
  const called=[];let release;const gate=new Promise(r=>release=r);
  const request=async(url,options)=>{called.push(url);assert.equal(options.timeoutMs,6000);await gate;
    if(url.includes('GetGlobal'))throw Error('API down');
    if(url.includes('appdetails'))return source('',url,JSON.stringify({240:{success:true,data:{categories:[{id:22}]}}}));
    if(url.includes('xml=1'))return source('',url,'<error>unavailable</error>');
    if(url.includes('/profiles/'))return source('',url,row('One','<div class="achieveUnlockTime">Unlocked yesterday</div>')+row('Two'));
    return source('',url,row('One')+row('Two'));
  };
  const pending=achievements({}, {steamId64:sid,webCookies:'session'},240,'',request);
  assert.equal(called.length,6);release();const result=await pending;
  assert.equal(result.verified,true);assert.equal(result.achievements.length,2);assert.equal(result.achievements[0].unlocked,true);assert.equal(result.achievements[1].unlocked,false);assert.equal(result.achievements[0].percent,0);
});
test('catálogo global funciona sin sesión y no inventa estados ni apinames',async()=>{
  const request=async(url)=>{if(url.includes('GetGlobal'))throw Error();if(url.includes('appdetails'))return source('',url,'{}');return source('',url,row('Global'))};
  const result=await achievements({}, {},240,'',request);assert.equal(result.outcome,'catalog');assert.equal(result.achievements[0].unlocked,null);assert.equal(result.achievements[0].apiname,null);
});
test('esquema API sigue disponible cuando Steam restringe el estado personal',async()=>{
  const request=async(url)=>{if(url.includes('GetSchema'))return source('',url,JSON.stringify({game:{availableGameStats:{achievements:[{name:'REAL',displayName:'One',icon:'',icongray:''}]}}}));if(url.includes('GetPlayer'))return source('',url,JSON.stringify({playerstats:{success:false}}));throw Error('unavailable');};
  const result=await achievements({}, {steamId64:sid},240,'key',request);assert.equal(result.outcome,'catalog');assert.equal(result.achievements[0].apiname,'REAL');assert.equal(result.achievements[0].unlocked,null);
});
test('fallo remoto no se confunde con ausencia de logros',async()=>{
  await assert.rejects(achievements({}, {steamId64:sid},240,'',async()=>{throw Error('timeout');}),e=>e.status===502 && e.message.includes('does not mean'));
});
test('ficha Steam que no declara logros se distingue de error de consulta',async()=>{
  const request=async(url)=>{if(url.includes('appdetails'))return source('',url,JSON.stringify({1118310:{success:true,data:{categories:[{id:2}]}}}));throw Error('unavailable');};
  const result=await achievements({}, {},1118310,'',request);assert.equal(result.outcome,'unsupported');assert.deepEqual(result.achievements,[]);
});
test('XML sin atributo closed se mantiene sin verificar',()=>{
  const xml='<playerstats><achievements><achievement><apiname>REAL</apiname><name>One</name></achievement></achievements></playerstats>';
  assert.equal(parseXml(xml)[0].unlocked,null);
});
test('XML from a different account never verifies the requested Steam identity',async()=>{const xml='<playerstats><steamID64>76561198000000002</steamID64><achievements><achievement closed="1"><apiname>REAL</apiname><name>One</name></achievement></achievements></playerstats>';const request=async url=>{if(url.includes('xml=1'))return {body:xml,finalUrl:url};if(url.includes('/stats/240/achievements/'))return source('',url,row('One'));throw Error('unavailable')};const result=await achievements({}, {steamId64:sid},240,'',request);assert.equal(result.verified,false);assert.equal(result.achievements[0].unlocked,null);});
test('remote rejects declared oversized responses before buffering',async()=>{let cancelled=false;const response={ok:true,status:200,headers:new Headers({'content-length':'9999999'}),body:{cancel:async()=>{cancelled=true}}};await assert.rejects(remote('https://steamcommunity.com/',{maxBytes:1024},async()=>response),/too large/);assert.equal(cancelled,true);});
test('unlocked por icono real de Steam y 0% se conservan',()=>{
  const rows=parseHtml(row('One','<div class="achieveImgHolderUnlocked"></div>'),true);assert.equal(rows[0].unlocked,true);assert.equal(rows[0].percent,0);
});
test('canonical vanity URL remains personal after Steam redirects the account stats request',async()=>{
  const request=async(url)=>{if(url.includes('/profiles/')&&!url.includes('xml=1'))return {body:row('One','<div class="achieveUnlockTime">Unlocked yesterday</div>'),finalUrl:'https://steamcommunity.com/id/owner-name/stats/L4D2/?tab=achievements&l=english'};if(url.includes('/stats/240/achievements/'))return source('',url,row('One'));throw Error('unavailable');};
  const result=await achievements({}, {steamId64:sid,webCookies:'session',connected:true},240,'',request);assert.equal(result.source,'Steam Community HTML');assert.equal(result.verified,true);assert.equal(result.achievements[0].unlocked,true);assert.equal(result.diagnostics.webSessionReady,true);
});
test('redirect to a different numeric profile cannot confirm the requested account achievements',async()=>{
  const request=async(url)=>{if(url.includes('/profiles/')&&!url.includes('xml=1'))return {body:row('One','<div class="achieveUnlockTime">Unlocked yesterday</div>'),finalUrl:'https://steamcommunity.com/profiles/76561198000000002/stats/L4D2/'};if(url.includes('/stats/240/achievements/'))return source('',url,row('One'));throw Error('unavailable');};
  const result=await achievements({}, {steamId64:sid},240,'',request);assert.equal(result.verified,false);assert.equal(result.achievements[0].unlocked,null);
});
test('private profile with vanity URL stays unknown',async()=>{
  const request=async(url)=>{if(url.includes('/profiles/')&&!url.includes('xml=1'))return {body:'<div class="profile_private">This profile is private</div>'+row('One'),finalUrl:'https://steamcommunity.com/id/owner-name/stats/L4D2/'};if(url.includes('/stats/240/achievements/'))return source('',url,row('One'));throw Error('unavailable');};
  const result=await achievements({}, {steamId64:sid},240,'',request);assert.equal(result.verified,false);assert.equal(result.achievements[0].unlocked,null);
});
test('Steam canonical redirects retain achievement tab, XML and English while dropping unrelated query values',async()=>{
  const seen=[];const fetcher=async(url,options)=>{seen.push({url:url.href,cookie:options.headers.Cookie});if(seen.length===1)return new Response('',{status:302,headers:{Location:'/id/owner/stats/L4D2'}});return new Response('<playerstats/>',{status:200});};
  const result=await remote('https://steamcommunity.com/profiles/76561198000000001/stats/550/?tab=achievements&xml=1&l=english&key=must-not-carry',{cookie:'session=private'},fetcher);
  const final=new URL(result.finalUrl);assert.equal(final.searchParams.get('tab'),'achievements');assert.equal(final.searchParams.get('xml'),'1');assert.equal(final.searchParams.get('l'),'english');assert.equal(final.searchParams.get('key'),null);assert.equal(seen[1].cookie,'session=private');
});
test('stats view parameters and cookies are not carried to another origin',async()=>{
  const seen=[];const fetcher=async(url,options)=>{seen.push({url:url.href,cookie:options.headers.Cookie});if(seen.length===1)return new Response('',{status:302,headers:{Location:'https://store.steampowered.com/stats/550/'}});return new Response('ok',{status:200});};
  await remote('https://steamcommunity.com/profiles/76561198000000001/stats/550/?tab=achievements&xml=1&l=english',{cookie:'session=private'},fetcher);assert.equal(new URL(seen[1].url).search,'');assert.equal(seen[1].cookie,undefined);
});

test('standard readings reject uniform 100% rarity while preserving exact personal states',async()=>{
  const html='<div class="achieveRow"><h3>One</h3><div class="achievePercent">100%</div></div><div class="achieveRow"><h3>Two</h3><div class="achievePercent">100%</div></div>';
  const request=async url=>{if(url.includes('GetGlobal'))return {body:'{"achievementpercentages":{"achievements":[{"name":"A","percent":100},{"name":"B","percent":100}]}}',finalUrl:url};if(url.includes('xml=1'))return {body:'<playerstats><achievements><achievement closed="1"><apiname>A</apiname><name>One</name></achievement><achievement closed="0"><apiname>B</apiname><name>Two</name></achievement></achievements></playerstats>',finalUrl:url};if(url.includes('steamcommunity'))return {body:html,finalUrl:url};throw Error('unavailable');};
  const result=await achievements({}, {steamId64:sid},550,'',request);assert.equal(result.verified,true);assert.deepEqual(result.achievements.map(a=>a.unlocked),[true,false]);assert.deepEqual(result.achievements.map(a=>a.percent),[null,null]);assert.equal(result.rarityStatus,'suspect_uniform_100');
});
test('standard readers do not arbitrarily match duplicate global titles or invalid percentages',async()=>{
  const html='<div class="achieveRow"><h3>Same</h3><div class="achievePercent">10%</div></div><div class="achieveRow"><h3>Same</h3><div class="achievePercent">20%</div></div>';
  const result=await achievements({}, {steamId64:sid},240,'',async url=>{if(url.includes('xml=1'))return {body:'<playerstats><achievements><achievement closed="1"><name>Same</name></achievement></achievements></playerstats>',finalUrl:url};if(url.includes('GetGlobal'))return {body:'{"achievementpercentages":{"achievements":[{"name":"INVALID","percent":-5}]}}',finalUrl:url};if(url.includes('/stats/240/achievements/'))return {body:html,finalUrl:url};throw Error('unavailable');});assert.equal(result.achievements[0].percent,null);assert.equal(result.achievements[0].unlocked,true);
});

})();

// === [app-state.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {AppState}=require('../lib/app-state');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPersistentApp}=require('../bot');const {atomicWrite,verifyPassword}=require('../lib/core');
function fake(){let row;return {query:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows:row?[structuredClone(row)]:[]};if(sql.startsWith('INSERT')){if(row)return {rowCount:0,rows:[]};row={version:1,encrypted:args[1]};return {rowCount:1,rows:[{version:1}]};}if(row.version!==args[2])return {rowCount:0,rows:[]};row={version:row.version+1,encrypted:args[1]};return {rowCount:1,rows:[{version:row.version}]};},end:async()=>{},peek:()=>row};}
const key=()=>crypto.randomBytes(32).toString('base64');
test('encrypted configuration and sessions restore independently of local files',async()=>{const pool=fake(),secret=key(),a=new AppState({pool,key:secret});assert.equal(await a.load(),null);a.save({accounts:[{id:'x',paused:true,games:[220]}],panelAuth:{hash:'private-hash'}},{records:{x:{}},get:()=> 'private-token'});await a.flush();assert.ok(!JSON.stringify(pool.peek()).includes('private-token'));assert.ok(!JSON.stringify(pool.peek()).includes('private-hash'));const b=new AppState({pool,key:secret});const restored=await b.load();assert.equal(restored.config.accounts[0].paused,true);assert.equal(restored.tokens.x,'private-token');assert.equal(b.status().restored,true);await b.close();await a.close();});
test('wrong key blocks restore without replacing stored configuration',async()=>{const pool=fake(),a=new AppState({pool,key:key()});a.save({accounts:[]},{records:{}});await a.flush();const before=structuredClone(pool.peek());const b=new AppState({pool,key:key()});await assert.rejects(b.load());assert.deepEqual(pool.peek(),before);await a.close();await b.close();});
test('stale server cannot overwrite newer state and loses mutation authority',async()=>{const pool=fake(),secret=key(),a=new AppState({pool,key:secret});a.save({accounts:[]},{records:{}});await a.flush();const b=new AppState({pool,key:secret});await b.load();b.save({accounts:[],newValue:true},{records:{}});await b.flush();a.save({accounts:[],oldValue:true},{records:{}});await assert.rejects(a.flush());assert.equal(a.status().available,false);assert.throws(()=>a.assert());const c=new AppState({pool,key:secret});assert.equal((await c.load()).config.newValue,true);await a.close().catch(()=>{});await b.close();await c.close();});
test('database failure is sticky; queued changes cannot fall back to local success',async()=>{const pool={query:async()=>{throw Error('offline')},end:async()=>{}},a=new AppState({pool,key:key()});a.save({accounts:[]},{records:{}});await assert.rejects(a.flush());assert.throws(()=>a.save({accounts:[]},{records:{}}));await a.close().catch(()=>{});});
test('slow database saves coalesce to one in-flight and one latest encrypted state',async()=>{const base=fake();let release,calls=0;const gate=new Promise(r=>release=r),pool={...base,query:async(...args)=>{calls++;if(calls===1)await gate;return base.query(...args)}};const a=new AppState({pool,key:key()}),vault={records:{}};for(let n=0;n<1000;n++)a.save({accounts:[],latest:n},vault);assert.equal(calls,1);assert.ok(a.nextEncrypted);release();await a.flush();assert.equal(calls,2);assert.equal((await new AppState({pool,key:a.key.toString('base64')}).load()).config.latest,999);await a.close();});
test('bootstrap restores settings, pause, panel hash and token into a completely fresh directory',async()=>{
  const pool=fake(),secret=key(),dirs=[fs.mkdtempSync(path.join(os.tmpdir(),'memory-first-')),fs.mkdtempSync(path.join(os.tmpdir(),'memory-restart-'))];
  const previous=process.env.PANEL_PASSWORD;process.env.PANEL_PASSWORD='persistent-panel-test-password';let a,b;
  try{
    atomicWrite(path.join(dirs[0],'config.json'),{accounts:[{id:'extra',user:'owner',name:'Owner',games:[220],paused:true,customStatus:'saved status',sleepMode:{enabled:true,start:23,end:7}}],timezone:'America/Montevideo'});
    a=await createPersistentApp({directory:dirs[0],silent:true,connect:false,persistence:new AppState({pool,key:secret})});
    a.vault.set('extra','private-restored-session');await a.persistence.flush();const checkpoint=a.cfg.persistenceCheckpoint;await a.close();a=null;
    process.env.PANEL_PASSWORD='different-environment-password';
    b=await createPersistentApp({directory:dirs[1],silent:true,connect:false,persistence:new AppState({pool,key:secret})});
    assert.equal(b.cfg.persistenceCheckpoint,checkpoint);assert.deepEqual(b.cfg.accounts[0].games,[220]);assert.equal(b.states.get('extra').isPaused,true);assert.equal(b.cfg.accounts[0].customStatus,'saved status');assert.equal(b.vault.get('extra'),'private-restored-session');assert.ok(verifyPassword('persistent-panel-test-password',b.cfg.panelAuth));assert.ok(!verifyPassword(process.env.PANEL_PASSWORD,b.cfg.panelAuth));assert.equal(b.clients.size,0);
  }finally{await a?.close();await b?.close();if(previous===undefined)delete process.env.PANEL_PASSWORD;else process.env.PANEL_PASSWORD=previous;for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});}
});

})();

// === [availability.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict'),{classify}=require('../public/achievement-availability');
const direct={method:'protocol'},base={unlocked:false,compatibility:{canUnlock:true,status:'provisional'}};
test('eligibility is provisional, read-only and account-limited',()=>{
  const frozen=Object.freeze({...base,compatibility:Object.freeze(base.compatibility)});
  assert.equal(classify(frozen,direct).status,'eligible');assert.equal(classify(frozen,direct).provisional,true);
  assert.equal(classify(frozen,{...direct,allowActivation:false}).canAttempt,false);
  assert.equal(classify(frozen).status,'unknown');
});
test('permissions, history and unknown personal state override optimistic eligibility',()=>{
  for(const [row,status] of [[{...base,serverControlled:true},'protected'],[{...base,unlocked:null},'unknown'],[{...base,compatibility:{...base.compatibility,status:'steam_rejected'}},'rejected'],[{...base,compatibility:{...base.compatibility,status:'pending_verification'}},'review'],[{...base,compatibility:{...base.compatibility,code:'history_unavailable'}},'unknown']]){
    const result=classify(row,direct);assert.equal(result.status,status);assert.equal(result.canAttempt,false);
  }
});
test('progress distinguishes supported exclusive counter, protection, unsupported and missing data',()=>{
  const row={...base,hasProgressDependency:true};
  for(const [progressSupport,status,canAttempt] of [[{canComplete:true},'progress',true],[{canPreviewShared:true},'review',false],[{code:'protected_progress_stat',canComplete:true},'protected',false],[{code:'complex_progress'},'unsupported',false],[{code:'progress_bounds'},'unsupported',false],[{code:'progress_value_unavailable'},'unknown',false],[{code:'insufficient_progress_data'},'unknown',false]]){
    const result=classify({...row,progressSupport},direct);assert.equal(result.status,status);assert.equal(result.canAttempt,canAttempt);
  }
});
test('an unlocked achievement is not proof of this panel granting it',()=>{
  assert.equal(classify({...base,unlocked:true},direct).status,'unlocked');
  assert.equal(classify({...base,unlocked:true,lastWriteOutcome:'confirmed'},direct).status,'confirmed');
  assert.notEqual(classify({...base,unlocked:false,lastWriteOutcome:'confirmed'},direct).status,'confirmed');
});

})();

// === [cache.test.js] ===
(() => {
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ResultCache } = require('../lib/cache');
test('cache expires and releases retained payloads', () => {
  let now = 0; const c = new ResultCache({ now: () => now, ttl: 10 });
  c.set('a', { rows: [1] }); assert.deepEqual(c.get('a'), { rows: [1] });
  now = 10; assert.equal(c.get('a'), undefined); assert.equal(c.bytes, 0);
  c.set('b', {}); now = 20; c.prune(); assert.equal(c.entries.size, 0);
});
test('cache evicts least recently read responses within both budgets', () => {
  const c = new ResultCache({ maxEntries: 2, maxBytes: 12 });
  c.set('a', 'a'); c.set('b', 'b'); c.get('a'); c.set('c', 'c');
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 'a');
  c.set('d', '1234567'); assert.ok(c.bytes <= 12); assert.equal(c.get('c'), undefined);
  c.set('d', 'x'.repeat(20)); assert.equal(c.get('d'), undefined);
  c.clear(); assert.equal(c.bytes, 0);
});

})();

// === [candidates.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {scanCandidates}=require('../lib/achievement-candidates');
test('candidate scan only inspects Steam-confirmed owned games and never calls a write transport',async()=>{
  const visited=[];const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async(_,options)=>{assert.deepEqual(options.filterAppids,[883710,550,3932890]);return {apps:[{appid:883710,name:'Owned hidden game'},{appid:550,name:'Owned progress game'},{appid:3932890,name:'Owned protected game'},{appid:999,name:'Not selected'}]};},_send:()=>{throw Error('No transport writes authorized');}};
  const report=await scanCandidates(client,[883710,550,3932890],{read:async(_,id)=>{visited.push(id);return {achievements:id===883710?[{apiname:'H',name:'Hidden',hidden:true,unlocked:false,compatibility:{canUnlock:true}}]:id===550?[{apiname:'P',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false},progressDetails:{currentValue:3,maximum:10}}]:[{apiname:'S',unlocked:false,compatibility:{code:'server_controlled',canUnlock:false}}]};}});
  assert.equal(report.hidden.length,1);assert.equal(report.progress.length,1);assert.equal(report.protected.length,1);assert.ok(!visited.includes(999));assert.equal(report.hidden[0].appid,883710);
});
test('already unlocked, unknown and ineligible hidden achievements are not activation candidates',async()=>{
  const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async()=>({apps:[{appid:550,name:'Owned'}]})};
  const report=await scanCandidates(client,[550],{read:async()=>({achievements:[{hidden:true,unlocked:true,compatibility:{canUnlock:false}},{hidden:true,unlocked:null,compatibility:{canUnlock:false}},{hidden:true,unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false}}]})});assert.deepEqual(report.hidden,[]);
});
test('account changes stop the read-only scan rather than attributing another library to this account',async()=>{
  const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async()=>{client.steamID=null;return {apps:[]};}};await assert.rejects(scanCandidates(client,[550]),/account changed/);
});
test('full-library mode inspects additional owned games and reports a bounded partial scope',async()=>{
  const visited=[];const client={steamID:{toString:()=> '76561198000000001'},getUserOwnedApps:async(_,options)=>{assert.ok(!Object.hasOwn(options,'filterAppids'));return {apps:[{appid:100,name:'Extra owned game'},{appid:101,name:'Another'}]};}};
  const report=await scanCandidates(client,[550],{fullLibrary:true,maxGames:1,read:async(_,id)=>{visited.push(id);return {achievements:[]};}});
  assert.deepEqual(visited,[100]);assert.equal(report.libraryGames,2);assert.equal(report.completeLibrary,false);assert.equal(report.stopReason,'game_limit');
});

})();

// === [changes.test.js] ===
(() => {
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

})();

// === [confirmation-auth.test.js] ===
(() => {
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createApp}=require('../bot');

const account='76561198000000001',password='local-confirmation-test-password';
class FakeSteam extends EventEmitter {
  constructor(){super();this.steamID={toString:()=>account};this.playingState={blocked:false};}
  _send(){assert.fail('Real Steam transport is forbidden in these tests.');}
  logOff(){}
}
async function fixture(t,{kind='individual',revokeBeforeReserve=false,revokeAfterReserve=false,expireBeforeReserve=false,revokeDuringFinalFlush=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'confirmation-auth-'));
  const calls={writers:0,reservations:0,transport:0,finishes:0};let app;
  const journal={
    persistent:false,ready:async()=>{},status:()=>({persistent:false,available:true,mode:'local'}),
    get:async()=>null,forGame:async()=>new Map(),list:async()=>[],close:async()=>{},
    reserve:async()=>{calls.reservations++;await new Promise(resolve=>setImmediate(resolve));if(revokeAfterReserve)app.sessions.clear();},
    finish:async()=>{calls.finishes++;}
  };
  const evidence={appid:kind==='experiment'?3764200:550,apiname:kind==='experiment'?'MODEL_API':'TARGET',name:kind==='experiment'?'Model Mania':'Target',checkedAt:new Date().toISOString(),before:false};
  const write=async options=>{
    calls.writers++;
    // A real writer awaits an independent Steam read before invoking beforeSend.
    await new Promise(resolve=>setImmediate(resolve));
    if(revokeBeforeReserve)app.sessions.clear();
    if(expireBeforeReserve)for(const session of app.sessions.values())session.expires=Date.now()-1;
    await options.beforeSend(evidence);
    calls.transport++;
    return {...evidence,outcome:'confirmed',after:true,message:'Synthetic confirmed result.'};
  };
  const persistence=revokeDuringFinalFlush?{available:true,assert(){},save(){},flush:async()=>{await new Promise(resolve=>setImmediate(resolve));if(calls.reservations)app.sessions.clear();}}:undefined;
  const previous={PANEL_PASSWORD:process.env.PANEL_PASSWORD,STEAM_REFRESH_TOKEN:process.env.STEAM_REFRESH_TOKEN,STEAM_ACCOUNT_ID:process.env.STEAM_ACCOUNT_ID};
  process.env.PANEL_PASSWORD=password;process.env.STEAM_ACCOUNT_ID='main';
  process.env.STEAM_REFRESH_TOKEN=`test.${Buffer.from(JSON.stringify({iss:'steam',sub:account,aud:['client'],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.synthetic`;
  try{
    app=createApp({directory,silent:true,connect:false,persistence,config:{timezone:'America/Montevideo',accounts:[{id:'main',name:'Main',games:[]}]},achievementJournal:journal,SteamUser:FakeSteam,
      individualWriter:async(_,id,apiname,options)=>write(options),experimentWriter:async(_,options)=>write(options)});
  }finally{for(const[name,value]of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;}
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const login=await fetch(base+'/api/panel/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  assert.equal(login.status,200);const csrf=(await login.json()).csrf,cookie=login.headers.get('set-cookie').split(';')[0];
  Object.assign(app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:account});app.clients.set('main',new FakeSteam());
  const route=kind==='experiment'?'/api/achievement-experiment':'/api/achievement/unlock';
  const input={accountId:'main',appid:evidence.appid,apiname:evidence.apiname,...(kind==='experiment'?{name:evidence.name}:{})};
  const request=async extra=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:cookie},body:JSON.stringify({...input,...extra})});return {status:response.status,body:await response.json()};};
  return {calls,request,app};
}

for(const kind of ['individual','experiment']){
  test(`${kind} API requires boolean explicit confirmation before starting its writer`,async t=>{
    const f=await fixture(t,{kind});
    const missing=await f.request({});assert.equal(missing.status,400);assert.equal(f.calls.writers,0);
    const falseConfirmation=await f.request({confirmed:false});assert.equal(falseConfirmation.status,400);assert.equal(f.calls.writers,0);
    const stringConfirmation=await f.request({confirmed:'true'});assert.equal(stringConfirmation.status,400);assert.equal(f.calls.writers,0);
  });
  test(`${kind} API accepts explicit confirmation for a synthetic reviewed write`,async t=>{
    const f=await fixture(t,{kind}),result=await f.request({confirmed:true});
    assert.equal(result.status,200);assert.equal(result.body.outcome,'confirmed');
    assert.deepEqual(f.calls,{writers:1,reservations:1,transport:1,finishes:1});
  });
  test(`${kind} API blocks a session revoked after an asynchronous initial read`,async t=>{
    const f=await fixture(t,{kind,revokeBeforeReserve:true}),result=await f.request({confirmed:true});
    assert.equal(result.status,401);assert.equal(f.calls.writers,1);assert.equal(f.calls.reservations,0);assert.equal(f.calls.transport,0);assert.equal(f.calls.finishes,0);
  });
  test(`${kind} API blocks a session revoked while durable intent is being reserved`,async t=>{
    const f=await fixture(t,{kind,revokeAfterReserve:true}),result=await f.request({confirmed:true});
    assert.equal(result.status,401);assert.equal(f.calls.writers,1);assert.equal(f.calls.reservations,1);assert.equal(f.calls.transport,0);assert.equal(f.calls.finishes,0);
  });
}
test('experiment API blocks expiration during its asynchronous initial read',async t=>{
  const f=await fixture(t,{kind:'experiment',expireBeforeReserve:true}),result=await f.request({confirmed:true});
  assert.equal(result.status,401);assert.equal(f.calls.reservations,0);assert.equal(f.calls.transport,0);assert.equal(f.calls.finishes,0);
});
test('experiment API rechecks session after its final asynchronous configuration flush',async t=>{
  const f=await fixture(t,{kind:'experiment',revokeDuringFinalFlush:true}),result=await f.request({confirmed:true});
  assert.equal(result.status,401);assert.equal(f.calls.reservations,1);assert.equal(f.calls.transport,0);assert.equal(f.calls.finishes,0);
  assert.equal(f.app.cfg.achievementExperiments[account+':3764200'].outcome,'requested');
});

})();

// === [dependencies.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict');
test('patched ZIP dependency supports the exact read path used by steam-user',()=>{const Zip=require('adm-zip'),zip=new Zip();zip.addFile('fixture',Buffer.from('Steam dependency smoke test'));const read=new Zip(zip.toBuffer());assert.equal(read.readFile(read.getEntries()[0]).toString(),'Steam dependency smoke test');});
test('patched protobuf runtime loads Steam app-ticket generated schema and round-trips',()=>{const schema=require('steam-appticket/protobufs/generated/_load').EncryptedAppTicket;const fixture=schema.fromObject({ticket_version_no:1,encrypted_ticket:Buffer.from('synthetic')});const decoded=schema.decode(schema.encode(fixture).finish());assert.deepEqual(schema.toObject(decoded,{bytes:String,longs:String}),schema.toObject(fixture,{bytes:String,longs:String}));});

})();

// === [draft-settings.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const fs=require('node:fs');const path=require('node:path');
const DraftSettings=require('../public/draft-settings');
function fixture(t){
  const dom=new JSDOM('<input id="start"><input id="end"><input id="enabled" type="checkbox"><input id="zone"><input id="status"><button id="save">Save</button>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());const document=dom.window.document,ids=['start','end','enabled','zone','status'];
  const drafts=DraftSettings.create({document,ids});t.after(()=>drafts.dispose());
  const edit=(id,value,event='input')=>{const input=document.getElementById(id);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new dom.window.Event(event,{bubbles:true}));};
  return {dom,document,drafts,ids,edit};
}
test('status polling preserves draft schedule and status while the user moves between fields',t=>{
  const {document,drafts,edit}=fixture(t);drafts.apply('start',3);drafts.apply('end',8);drafts.apply('enabled',false);drafts.apply('zone','America/Montevideo');drafts.apply('status','');
  document.getElementById('start').focus();edit('start','22');document.getElementById('end').focus();edit('enabled',true,'change');edit('zone','UTC');edit('status','My draft');document.getElementById('save').focus();
  for(let i=0;i<3;i++){drafts.apply('start',3);drafts.apply('end',8);drafts.apply('enabled',false);drafts.apply('zone','America/Montevideo');drafts.apply('status','');}
  assert.equal(document.getElementById('start').value,'22');assert.equal(document.getElementById('enabled').checked,true);assert.equal(document.getElementById('zone').value,'UTC');assert.equal(document.getElementById('status').value,'My draft');
  assert.equal(document.getElementById('end').value,'8');
});
test('focused untouched fields stay stable and successful save clears only the committed form',t=>{
  const {document,drafts,edit}=fixture(t);drafts.apply('start',3);drafts.apply('end',8);document.getElementById('end').focus();assert.equal(drafts.apply('end',9),false);assert.equal(document.getElementById('end').value,'8');
  edit('start','22');edit('status','Keep this draft');document.getElementById('save').focus();drafts.commit(['start']);assert.equal(drafts.apply('start',23),true);assert.equal(drafts.apply('status','Server status'),false);
  assert.equal(document.getElementById('start').value,'23');assert.equal(document.getElementById('status').value,'Keep this draft');assert.equal(drafts.apply('end',9),true);
});
test('an edit made while a save is pending survives its successful response and account reset clears it',t=>{
  const {document,drafts,edit,ids}=fixture(t);edit('start','22');edit('enabled',true,'change');const saved=drafts.snapshot(['start','enabled']);edit('start','23');
  drafts.commit(['start','enabled'],saved);assert.equal(drafts.apply('start',22),false);assert.equal(drafts.apply('enabled',true),true);assert.equal(document.getElementById('start').value,'23');
  const oldAccount=drafts.snapshot(ids);drafts.reset();edit('start','20');drafts.commit(ids,oldAccount);assert.equal(drafts.apply('start',3),false);drafts.reset();assert.equal(drafts.apply('start',3),true);assert.equal(document.getElementById('start').value,'3');assert.equal(drafts.apply('enabled',false),true);assert.equal(document.getElementById('enabled').checked,false);
});
test('field tracking is bounded and unknown IDs cannot mutate arbitrary controls',t=>{
  const {document,drafts,edit}=fixture(t);assert.throws(()=>DraftSettings.create({document,ids:Array(33).fill('start')}),/up to 32/);assert.throws(()=>DraftSettings.create({document,ids:['missing']}),/unavailable/);assert.throws(()=>DraftSettings.create({document,ids:[null]}),/Invalid/);
  assert.equal(drafts.apply('save','Changed'),false);edit('status','Draft');drafts.commit(['save']);assert.equal(drafts.apply('status','Server'),false);drafts.dispose();edit('status','After disposal');assert.equal(drafts.apply('status','Server'),false);
});
test('browser entry exposes the same draft protection without loading Node dependencies',t=>{
  const {dom,document}=fixture(t);dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/draft-settings.js'),'utf8'));const drafts=dom.window.DraftSettings.create({document,ids:['zone']});
  drafts.apply('zone','UTC');document.getElementById('zone').value='America/Montevideo';document.getElementById('zone').dispatchEvent(new dom.window.Event('input'));assert.equal(drafts.apply('zone','UTC'),false);assert.equal(document.getElementById('zone').value,'America/Montevideo');drafts.dispose();
});

})();

// === [experiment.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const Schema=require('steam-user/protobufs/generated/_load.js');const EMsg=require('steam-user/enums/EMsg');
const {TARGET,prepare,store,unlockModelMania}=require('../lib/achievement-experiment');
function kv(obj){const pieces=[];for(const [k,v]of Object.entries(obj)){pieces.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));}pieces.push(Buffer.from([8]));return Buffer.concat(pieces);}
function snapshot({value=0x80000000,bit={},block={},extra={}}={}){return {game_id:String(TARGET.appid),eresult:1,crc_stats:42,schema:kv({[TARGET.appid]:{stats:{'7':{type:'4',bits:{'0':{name:'MODEL_API',display:{name:{english:TARGET.name},desc:{english:TARGET.description}},...bit},'31':{name:'OTHER',display:{name:{english:'Other'}}}},...block}}}}),stats:[{stat_id:7,stat_value:value},{stat_id:9,stat_value:12}],...extra};}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{};c.playingState={blocked:false};return c;}
const ack=()=>({game_id:String(TARGET.appid),eresult:1,stats_out_of_date:false,stats_failed_validation:[]});
test('single target plan preserves every other achievement bit, numeric stats and CRC',()=>{const p=prepare(snapshot());assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:0x80000001}]);assert.equal(p.payload.crc_stats,42);assert.equal(p.payload.explicit_reset,false);});
test('permissions, dependencies, missing CRC and unverified initial state prevent sending',()=>{
  for(const input of [snapshot({bit:{permission:'1'}}),snapshot({block:{permission:'2'}}),snapshot({bit:{progress:{max_val:'44'}}}),snapshot({extra:{stats:[]}})])assert.throws(()=>prepare(input));
  const s=snapshot();delete s.crc_stats;assert.throws(()=>prepare(s),/statistics version/);
  assert.throws(()=>prepare(snapshot({bit:{display:{name:{english:'Wrong'},desc:{english:TARGET.description}}}})),/identified/);
});
test('only a clean acknowledgement plus a fresh exact state change is confirmed',async()=>{
  let reads=0,sends=0;const c=client();const r=await unlockModelMania(c,{read:async()=>snapshot({value:++reads===1?0x80000000:0x80000001}),send:async(_,p)=>{sends++;assert.equal(p.settor_steam_id,c.steamID.toString());assert.equal(p.settee_steam_id,c.steamID.toString());assert.equal(p.stats.length,1);return ack();}});
  assert.equal(r.outcome,'confirmed');assert.equal(reads,2);assert.equal(sends,1);assert.deepEqual(r.otherAchievementChanges,[]);
});
test('already unlocked and wrong frontend API identifiers never submit a write',async()=>{
  let sends=0;const send=async()=>{sends++;return ack();};const r=await unlockModelMania(client(),{read:async()=>snapshot({value:0x80000001}),send});assert.equal(r.outcome,'already_unlocked');
  await assert.rejects(unlockModelMania(client(),{read:async()=>snapshot(),send,expectedApiname:'WRONG'}),/identifier/);assert.equal(sends,0);
});
test('Steam rejection, stale CRC, partial validation and unrelated changes cannot claim success',async()=>{
  for(const response of [{...ack(),eresult:8},{...ack(),stats_out_of_date:true},{...ack(),stats_failed_validation:[{stat_id:7,reverted_stat_value:0x80000000}]}]){
    const r=await unlockModelMania(client(),{read:async()=>snapshot(),send:async()=>response});assert.equal(r.outcome,'rejected');
  }
  let reads=0;const r=await unlockModelMania(client(),{read:async()=>snapshot({value:++reads===1?0x80000000:1}),send:async()=>ack()});assert.equal(r.outcome,'unknown');assert.deepEqual(r.otherAchievementChanges,['OTHER']);
});
test('write timeout stays unknown and cannot trigger an automatic or duplicate write',async()=>{
  const c=client();let sends=0;const options={read:async()=>snapshot(),send:async()=>{sends++;throw Error('timeout');}};const r=await unlockModelMania(c,options);assert.equal(r.outcome,'unknown');await assert.rejects(unlockModelMania(c,options),/already attempted/);assert.equal(sends,1);
});
test('a missing acknowledgement can report observed unlock, never confirmed',async()=>{
  let reads=0;const r=await unlockModelMania(client(),{read:async()=>snapshot({value:++reads===1?0x80000000:0x80000001}),send:async()=>{throw Error('timeout');}});assert.equal(r.outcome,'observed_unlocked');
});
test('collision, audit failure and simultaneous requests prevent conflicting writes',async()=>{
  const c=client();c.playingState.blocked=true;await assert.rejects(unlockModelMania(c),/other device/);c.playingState.blocked=false;
  let sends=0;await assert.rejects(unlockModelMania(c,{read:async()=>snapshot(),send:async()=>{sends++;},beforeSend:()=>{throw Error('audit failed');}}),/audit failed/);assert.equal(sends,0);
  let release;const pending=unlockModelMania(c,{read:()=>new Promise(r=>{release=r;})});await assert.rejects(unlockModelMania(c),/already running/);release(snapshot({value:0x80000001}));await pending;
});
test('write transport checks response identity and frees pending jobs on timeout',async()=>{
  const c=client();c._jobs=new Map();c._currentJobID=0;c._send=(h,body,cb)=>{assert.equal(h.msg,EMsg.ClientStoreUserStats2);assert.equal(Schema.CMsgClientStoreUserStats2.decode(body).stats.length,1);const j=String(++c._currentJobID);c._jobs.set(j,cb);queueMicrotask(()=>cb(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({...ack(),game_id:'550'}).finish()),{msg:EMsg.ClientStoreUserStatsResponse}));};
  await assert.rejects(store(c,prepare(snapshot()).payload),/validated/);assert.equal(c._jobs.size,0);
  c._send=(_,__,cb)=>c._jobs.set(String(++c._currentJobID),cb);await assert.rejects(store(c,prepare(snapshot()).payload,{timeoutMs:5}),/unknown/);assert.equal(c._jobs.size,0);assert.equal(c.listenerCount('disconnected'),0);
});

})();

// === [float-discovery.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {ownedFloatLibrary,scanFloatBatch}=require('../lib/float-discovery');
const sid='76561198000000001';
test('decimal search retrieves only owned games, deduplicates IDs and prioritizes played titles',async()=>{
  let removed;const client={steamID:{toString:()=>sid},_currentJobID:12,_jobs:{delete:id=>removed=id},getUserOwnedApps:async(_,options)=>{assert.equal(options.includePlayedFreeGames,true);return {apps:[{appid:4,name:'Unplayed',playtime_forever:0},{appid:2,name:'Played',playtime_forever:1},{appid:2,name:'Duplicate'},{appid:-1}]};}};
  const library=await ownedFloatLibrary(client);assert.deepEqual(library.games,[{appid:2,name:'Played'},{appid:4,name:'Unplayed'}]);assert.equal(library.revision.length,64);assert.equal(removed,'12');
});
test('decimal batches bound reads, preserve unknown games and report eligible, protected and unlocked FLOATs',async()=>{
  const library={revision:'r',games:Array.from({length:12},(_,i)=>({appid:i+1,name:'Game '+i}))},visited=[];
  const row=(name,canPreview=false,unlocked=false)=>({name,apiname:name,unlocked,progressDetails:{type:'FLOAT',statName:'DISTANCE',currentValue:1.25,maximum:10.5},progressSupport:{canPreviewFloat:canPreview,reason:canPreview?'Read-only preview available':'Protected or not supported'}});
  const result=await scanFloatBatch({steamID:{toString:()=>sid}},library,0,{read:async(_,id,options)=>{visited.push(id);assert.equal(options.timeoutMs,1200);if(id===2)throw Error('Timeout');return {achievements:id===1?[row('Protected'),row('Already unlocked',false,true),row('Eligible',true),{progressDetails:{type:'INT'}}]:[]};}});
  assert.equal(visited.length,8);assert.equal(result.nextCursor,8);assert.equal(result.complete,false);assert.equal(result.candidates[0].name,'Eligible');assert.equal(result.candidates.length,3);assert.equal(result.games[1].readable,false);assert.equal(result.writesSent,0);
  const rest=await scanFloatBatch({steamID:{toString:()=>sid}},library,8,{read:async()=>({achievements:[]})});assert.equal(rest.nextCursor,12);assert.equal(rest.complete,true);
  await assert.rejects(scanFloatBatch({steamID:{toString:()=>sid}},library,-1));
});
test('decimal search stops when Steam identity changes and never attributes results to another account',async()=>{
  const client={steamID:{toString:()=>sid}},library={revision:'r',games:[{appid:1,name:'Owned'}]};
  await assert.rejects(scanFloatBatch(client,library,0,{read:async()=>{client.steamID=null;return {achievements:[]};}}),/Steam disconnected or changed/);
});

})();

// === [float-progress.test.js] ===
(() => {
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

})();

// === [float-writer.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {prepareFloat,unlockAchievement,store}=require('../lib/achievement-writer');
const {floatBits}=require('../lib/float-progress');
const {revision}=require('../lib/achievement-progress');
const Schema=require('steam-user/protobufs/generated/_load.js'),EMsg=require('steam-user/enums/EMsg');
function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
function snapshot({goal='10.5',value=1.25,stat={},bits={},stats,mask=2}={}){
  return {eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{7:{type:'4',bits:{0:{name:'DECIMAL',progress:{max_val:goal,value:{operation:'statvalue',operand1:'DISTANCE'}}},1:{name:'OTHER'},...bits}},9:{type:'FLOAT',name:'DISTANCE',min:'0',max:'100',...stat}}}}),stats:stats||[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:floatBits(value)},{stat_id:20,stat_value:123}]};
}
const client=()=>Object.assign(new EventEmitter(),{steamID:{toString:()=> '76561198000000001'},_send(){}});
const reviewed=s=>({expectedRevision:revision(s,550,'DECIMAL')});
const finalSnapshot=(s,raw=floatBits(10.5))=>({...s,crc_stats:13,stats:s.stats.map(p=>({...p,stat_value:p.stat_id===7?p.stat_value|1:p.stat_id===9?raw:p.stat_value}))});
async function attempt(s,final,ack={game_id:'550',eresult:1},options={}){
  let reads=0,sends=0;const c=client();
  const result=await unlockAchievement(c,550,'DECIMAL',{floatProgress:true,...reviewed(s),read:async()=>++reads===1?s:final,send:async(_,payload)=>{sends++;assert.deepEqual(payload.stats,[{stat_id:9,stat_value:prepareFloat(s,550,'DECIMAL',reviewed(s)).progressChanges[0].afterRaw}]);return ack;},...options});
  return {result,sends,c};
}
test('typed FLOAT plans send one exact IEEE-754 counter and no achievement bitmask',()=>{
  for(const [goal,value] of [['10.5',1.25],['1.00000003',0.5],['1e-46',0],['10.5',-0]]){
    const s=snapshot({goal,value}),plan=prepareFloat(s,550,'DECIMAL',reviewed(s)),p=plan.progressChanges[0];
    assert.equal(p.type,'FLOAT');assert.equal(p.beforeRaw,floatBits(value));assert.ok(p.after>=Number(goal));assert.deepEqual(plan.payload.stats,[{stat_id:9,stat_value:floatBits(p.after)}]);assert.equal(s.stats[0].stat_value,2);
    const decoded=Schema.CMsgClientStoreUserStats2.decode(Schema.CMsgClientStoreUserStats2.encode(plan.payload).finish());assert.equal(decoded.stats[0].stat_value,p.afterRaw);
  }
});
test('FLOAT plans reject stale revisions, completed locked counters and unsafe full snapshots',()=>{
  const s=snapshot();assert.throws(()=>prepareFloat(s,550,'DECIMAL'));assert.throws(()=>prepareFloat({...s,crc_stats:13},550,'DECIMAL',reviewed(s)),/changed/);
  for(const bad of [snapshot({value:12}),snapshot({stat:{permission:'2'}}),snapshot({stat:{type:'AVGRATE'}}),snapshot({stat:{maxchange:'1'}}),snapshot({stat:{max:'10'}}),snapshot({bits:{2:{name:'SHARED',progress:{max_val:'20',value:{operation:'statvalue',operand1:'DISTANCE'}}}}}),{...s,crc_stats:undefined},{...s,stats:[...s.stats,{stat_id:20,stat_value:123}]},{...s,stats:s.stats.map(p=>p.stat_id===20?{...p,stat_value:-1}:p)}])assert.throws(()=>prepareFloat(bad,550,'DECIMAL',reviewed(bad)));
  const implicit=Object.assign(Object.create({stat_value:0}),{stat_id:20});assert.throws(()=>prepareFloat({...s,stats:[...s.stats.slice(0,2),implicit]},550,'DECIMAL',reviewed(s)),/personal statistics/);
});
test('fresh acknowledgement and exact full read confirm the counter and automatic linked unlock',async()=>{
  const s=snapshot();let reserved=false;
  const {result,sends}=await attempt(s,finalSnapshot(s),undefined,{beforeSend:async evidence=>{assert.equal(evidence.progressChanges[0].afterRaw,floatBits(10.5));assert.equal(evidence.revision,revision(s,550,'DECIMAL'));reserved=true;}});
  assert.equal(reserved,true);assert.equal(sends,1);assert.equal(result.outcome,'confirmed');assert.equal(result.progressVerification[0].observedRaw,floatBits(10.5));assert.equal(result.progressVerification[0].verified,true);assert.deepEqual(result.unexpectedStatChanges,[]);assert.ok(result.verifiedAt);
});
test('FLOAT verification rejects raw rounding, absent unlock, extra bits/stats, duplicates and schema changes',async()=>{
  const s=snapshot(),good=finalSnapshot(s);
  const variants=[finalSnapshot(s,floatBits(10.5)-1),{...good,stats:good.stats.map(p=>p.stat_id===7?{...p,stat_value:2}:p)},{...good,stats:good.stats.map(p=>p.stat_id===7?{...p,stat_value:7}:p)},{...good,stats:good.stats.map(p=>p.stat_id===20?{...p,stat_value:124}:p)},{...good,stats:[...good.stats,{stat_id:20,stat_value:123}]},{...good,stats:good.stats.filter(p=>p.stat_id!==20)},{...good,crc_stats:undefined},{...good,schema:snapshot({goal:'10.6'}).schema}];
  for(const final of variants){const {result,sends}=await attempt(s,final);assert.notEqual(result.outcome,'confirmed');assert.equal(sends,1);assert.equal(result.diagnostic?.code,'verification_conflict');}
});
test('unclean FLOAT responses never confirm or retry, even when the desired value is observed',async()=>{
  const s=snapshot();
  for(const ack of [null,{game_id:'550',eresult:1,stats_out_of_date:true},{game_id:'550',eresult:1,stats_failed_validation:[{stat_id:9,reverted_stat_value:floatBits(1.25)}]},{game_id:'550',eresult:2},{game_id:'440',eresult:1}]){
    const {result,sends}=await attempt(s,finalSnapshot(s),ack);assert.notEqual(result.outcome,'confirmed');assert.equal(sends,1);
  }
});
test('missing or invalid independent FLOAT reads preserve an unconfirmed result',async()=>{
  const s=snapshot();
  for(const final of [{...finalSnapshot(s),game_id:'440'},{...finalSnapshot(s),schema:Buffer.alloc(0)},{...finalSnapshot(s),eresult:2}]){
    const {result,sends}=await attempt(s,final);assert.equal(sends,1);assert.equal(result.outcome,'unknown');assert.equal(result.diagnostic.code,'verification_unavailable');assert.equal(result.progressChanges[0].afterRaw,0x41280000);
  }
  const {result,sends}=await attempt(s,null,undefined,{read:async()=>{if(!s.used){s.used=true;return s;}throw Error('Disconnected');}});assert.equal(sends,1);assert.equal(result.outcome,'unknown');
});
test('failed persistent intent and changed identity prevent FLOAT transport; attempts cannot retry',async()=>{
  const s=snapshot(),c=client();let sends=0;
  const options={floatProgress:true,...reviewed(s),read:async()=>s,send:async()=>{sends++;return {eresult:1,game_id:'550'};}};
  await assert.rejects(unlockAchievement(c,550,'DECIMAL',{...options,beforeSend:async()=>{throw Error('Persistence unavailable');}}));assert.equal(sends,0);
  await assert.rejects(unlockAchievement(c,550,'DECIMAL',{...options,beforeSend:async()=>{c.steamID=null;}}));assert.equal(sends,0);
  const fresh=client();await unlockAchievement(fresh,550,'DECIMAL',options);await assert.rejects(unlockAchievement(fresh,550,'DECIMAL',options),/already attempted/);assert.equal(sends,1);
});
test('FLOAT uses the real store serializer without converting decimal values to integers',async()=>{
  const s=snapshot(),plan=prepareFloat(s,550,'DECIMAL',reviewed(s)),c=client();
  c._send=({msg},bytes,callback)=>{assert.equal(msg,EMsg.ClientStoreUserStats2);const p=Schema.CMsgClientStoreUserStats2.decode(bytes);assert.equal(p.stats[0].stat_value,0x41280000);assert.equal(p.stats.length,1);callback(Buffer.from(Schema.CMsgClientStoreUserStatsResponse.encode({game_id:'550',eresult:1}).finish()),{msg:EMsg.ClientStoreUserStatsResponse});};
  assert.equal((await store(c,plan.payload)).eresult,1);
});

})();

// === [journal.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {AchievementJournal}=require('../lib/achievement-journal');
const account='76561198000000001';
const evidence=(name='TARGET')=>({appid:550,apiname:name,name,checkedAt:'2026-10-13T12:00:00Z',before:false});
function database(){
  const records=new Map(),trace=[];let lock=Promise.resolve();
  const key=args=>args.slice(0,3).join(':');
  const execute=async(sql,args=[],transaction)=>{
    trace.push(sql);
    if(sql.startsWith('CREATE')||sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL'))return {rows:[]};
    if(sql.includes('pg_advisory_xact_lock')){const previous=lock;lock=new Promise(resolve=>{transaction.unlock=resolve;});await previous;return {rows:[]};}
    if(sql==='COMMIT'){if(transaction.insert){const [args]=transaction.insert;records.set(key(args),{receipt:structuredClone(args[3]),created_at:new Date('2026-10-13T12:00:00Z')});}transaction.unlock?.();return {rows:[]};}
    if(sql==='ROLLBACK'){transaction.insert=null;transaction.unlock?.();return {rows:[]};}
    if(sql.startsWith('INSERT')){if(sql.includes('ON CONFLICT')){if(!records.has(key(args)))records.set(key(args),{receipt:structuredClone(args[3]),created_at:new Date(args[4]||'2026-10-13T12:00:00Z')});}else transaction.insert=[args];return {rows:[]};}
    if(sql.startsWith('UPDATE')){const r=records.get(key(args));if(r)r.receipt={...r.receipt,...structuredClone(args[3])};return {rowCount:r?1:0,rows:[]};}
    if(sql.startsWith('SELECT COUNT'))return {rows:[{count:records.size}]};
    if(sql.includes("INTERVAL '1 minute'"))return {rows:[...records].filter(([k])=>k.startsWith(args[0]+':')).map(()=>({}))};
    if(sql.startsWith('SELECT 1'))return {rows:records.has(key(args))?[{}]:[]};
    if(sql.includes('apiname=$3'))return {rows:records.has(key(args))?[{receipt:records.get(key(args)).receipt}]:[]};
    return {rows:[...records].filter(([k])=>k.startsWith(args[0]+':')).map(([k,r])=>({apiname:k.split(':').slice(2).join(':'),...r}))};
  };
  const pool={on(){},query:(sql,args)=>execute(sql,args),connect:async()=>{const tx={};return {query:(sql,args)=>execute(sql,args,tx),release(){}};},end:async()=>{}};
  return {pool,records,trace};
}
test('local journal exposes its persistence limit and preserves unresolved reservations across reloads',async()=>{
  const cfg={},journal=new AchievementJournal({cfg,save(){},now:()=>Date.parse('2026-10-13T12:00:00Z')});await journal.reserve(account,550,'TARGET',evidence());
  const restored=new AchievementJournal({cfg:structuredClone(cfg),save(){}});assert.equal(restored.status().persistent,false);assert.equal((await restored.get(account,550,'TARGET')).outcome,'requested');await assert.rejects(restored.reserve(account,550,'TARGET',evidence()),/already attempted/);
});
test('Postgres intent survives a new journal instance and legacy migration never overwrites it',async()=>{
  const db=database(),first=new AchievementJournal({cfg:{},save(){},pool:db.pool});await first.reserve(account,550,'TARGET',evidence());
  const second=new AchievementJournal({cfg:{achievementWrites:{[account+':550:TARGET']:{...evidence(),outcome:'confirmed'}}},save(){},pool:db.pool});await second.ready();assert.equal((await second.get(account,550,'TARGET')).outcome,'requested');await assert.rejects(second.reserve(account,550,'TARGET',evidence()),/already attempted/);
  await second.finish(account,550,'TARGET',{...evidence(),after:true,outcome:'confirmed'});assert.equal((await first.list(account))[0].outcome,'confirmed');assert.equal(first.status().persistent,true);
});
test('transactional account locking prevents competing instances from reserving separate writes during cooldown',async()=>{
  const db=database(),a=new AchievementJournal({cfg:{},save(){},pool:db.pool}),b=new AchievementJournal({cfg:{},save(){},pool:db.pool});await Promise.all([a.ready(),b.ready()]);
  const results=await Promise.allSettled([a.reserve(account,550,'FIRST',evidence('FIRST')),b.reserve(account,550,'SECOND',evidence('SECOND'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.records.size,1);assert.ok(db.trace.includes('ROLLBACK'));assert.ok(db.trace.includes('COMMIT'));
});
test('database errors block intent without falling back locally or exposing connection secrets',async()=>{
  const cfg={},pool={on(){},query:async()=>{throw Error('postgres://private-password@host/database');},end:async()=>{}};const journal=new AchievementJournal({cfg,save(){throw Error('Local fallback forbidden');},pool});
  await assert.rejects(journal.reserve(account,550,'TARGET',evidence()),e=>e.status===503&&!e.message.includes('private-password'));assert.equal(journal.status().available,false);assert.deepEqual(cfg.achievementWrites,{});
});
test('journal stores receipt fields rather than credentials or arbitrary transport payloads',async()=>{
  const journal=new AchievementJournal({cfg:{},save(){}});await journal.reserve(account,550,'TARGET',{...evidence(),refreshToken:'secret',payload:{settor_steam_id:account},password:'secret'});const r=await journal.get(account,550,'TARGET');assert.ok(!('refreshToken'in r));assert.ok(!('payload'in r));assert.ok(!('password'in r));
});
test('decimal intents require persistent storage and retain typed values across journal instances',async()=>{
  const change={type:'FLOAT',statId:9,statName:'DISTANCE',before:1.25,after:10.5,beforeRaw:0x3fa00000,afterRaw:0x41280000};
  const intent={...evidence(),revision:'a'.repeat(64),progressChanges:[change]};
  const local=new AchievementJournal({cfg:{},save(){throw Error('No local fallback');}});await assert.rejects(local.reserve(account,550,'TARGET',intent),/persistent/);
  const db=database(),first=new AchievementJournal({cfg:{},save(){},pool:db.pool});await first.reserve(account,550,'TARGET',intent);
  const restored=new AchievementJournal({cfg:{},save(){},pool:db.pool});assert.deepEqual((await restored.get(account,550,'TARGET')).progressChanges,[change]);
  const result={...intent,outcome:'confirmed',after:true,acknowledgement:{result:1,stale:false,rejectedStats:[]},unexpectedStatChanges:[],otherAchievementChanges:[],progressVerification:[{type:'FLOAT',statId:9,observedRaw:change.afterRaw,verified:true}]};
  for(const bad of [{...result,progressVerification:undefined},{...result,progressVerification:[{...result.progressVerification[0],observedRaw:change.afterRaw-1}]},{...result,revision:'b'.repeat(64)},{...result,progressChanges:[{...change,afterRaw:123}]},{...result,acknowledgement:{result:1,stale:true,rejectedStats:[]}},{...result,otherAchievementChanges:['OTHER']}]){await assert.rejects(restored.finish(account,550,'TARGET',bad),/exact recorded/);assert.equal((await first.get(account,550,'TARGET')).outcome,'requested');}
  const persisted=db.records.get(account+':550:TARGET').receipt;persisted.progressChanges=persisted.progressChanges.map(p=>Object.fromEntries(Object.entries(p).reverse()));
  await restored.finish(account,550,'TARGET',result);assert.deepEqual((await first.get(account,550,'TARGET')).progressVerification,result.progressVerification);
});

})();

// === [percentages.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict');const {globalPercentages}=require('../lib/steam-percentages');
test('global percentages preserve genuine zero, reject missing/invalid values and ambiguous names',async()=>{const r=await globalPercentages(550,async(url,opts)=>{assert.match(url,/gameid=550/);assert.equal(opts.maxBytes,512*1024);return {body:JSON.stringify({achievementpercentages:{achievements:[{name:'COMMON',percent:95},{name:'ZERO',percent:0},{name:'UNKNOWN',percent:null},{name:'EMPTY',percent:''},{name:'INVALID',percent:101},{name:'DUP',percent:5},{name:'DUP',percent:10}]}})}});assert.equal(r.percentages.COMMON,95);assert.equal(r.percentages.ZERO,0);assert.deepEqual(Object.keys(r.percentages),['COMMON','ZERO']);});
test('missing percentage response stays unavailable, not an invented zero list',async()=>{await assert.rejects(globalPercentages(550,async()=>({body:'{}'})),e=>e.status===502);});
test('community percentages supply unique English title matches when XML identifiers are unavailable',async()=>{
  const row=(name,p)=>`<div class="achieveRow"><h3>${name}</h3><h5>description</h5><div class="achievePercent">${p}%</div></div>`;
  const result=await globalPercentages(550,async url=>({body:url.includes('api.steampowered')?'malformed':row('GNOME ALONE',69.8)+row('Zero',0)+row('Duplicate',5)+row('Duplicate',10)}),{includeTitles:true});
  assert.equal(Object.keys(result.percentages).length,0);assert.equal(result.titlePercentages['gnome alone'],69.8);assert.equal(result.titlePercentages.zero,0);assert.equal(Object.hasOwn(result.titlePercentages,'duplicate'),false);
});
test('direct ID lookup does not fetch community metadata and tolerates missing optional titles',async()=>{
  let calls=0;const result=await globalPercentages(550,async url=>{calls++;if(url.includes('steamcommunity'))throw Error('Unavailable');return {body:JSON.stringify({achievementpercentages:{achievements:[{name:'API',percent:10}]}})};},{includeTitles:true});assert.equal(calls,2);assert.equal(result.percentages.API,10);assert.deepEqual(Object.keys(result.titlePercentages),[]);
  calls=0;await globalPercentages(550,async()=>{calls++;return {body:'{"achievementpercentages":{"achievements":[]}}'};});assert.equal(calls,1);
});

test('uniform 100% API falls back to unique Community titles even for a direct lookup',async()=>{
  const calls=[],result=await globalPercentages(550,async url=>{calls.push(url);return {body:url.includes('api.steampowered')?JSON.stringify({achievementpercentages:{achievements:[{name:'A',percent:100},{name:'B',percent:100}]}}):'<div class="achieveRow"><h3>Epic</h3><div class="achievePercent">10%</div></div><div class="achieveRow"><h3>Mythic</h3><div class="achievePercent">2%</div></div>'};});assert.equal(calls.length,2);assert.deepEqual(Object.keys(result.percentages),[]);assert.equal(result.titlePercentages.epic,10);assert.equal(result.titlePercentages.mythic,2);assert.equal(result.rarityStatus,'available');
});
test('both official sources reporting every achievement at 100% are clearly marked unverified',async()=>{
  const result=await globalPercentages(550,async url=>({body:url.includes('api.steampowered')?'{"achievementpercentages":{"achievements":[{"name":"A","percent":100},{"name":"B","percent":100}]}}':'<div class="achieveRow"><h3>One</h3><div class="achievePercent">100%</div></div><div class="achieveRow"><h3>Two</h3><div class="achievePercent">100%</div></div>'}));assert.equal(result.rarityStatus,'suspect_uniform_100');assert.deepEqual(Object.keys(result.percentages),[]);assert.deepEqual(Object.keys(result.titlePercentages),[]);assert.match(result.rarityMessage,/100%/);
});
test('a genuine single 100% and a mixed distribution remain valid',async()=>{for(const entries of [[{name:'ONE',percent:100}],[{name:'ONE',percent:100},{name:'TWO',percent:10}]]){let calls=0;const result=await globalPercentages(240,async()=>{calls++;return {body:JSON.stringify({achievementpercentages:{achievements:entries}})};});assert.equal(calls,1);assert.equal(result.percentages.ONE,100);assert.equal(result.rarityStatus,'available');}});

test('missing percentages are distinct from a complete uniform 100% distribution',()=>{const {normalizeRows,uniformHundred}=require('../public/achievement-rarity');assert.equal(uniformHundred([100,100,null]),false);assert.equal(normalizeRows([{percent:100},{percent:100},{percent:null}])[0].percent,100);});

})();

// === [probes.test.js] ===
(() => {
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

})();

// === [progress.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {prepare,unlockAchievement}=require('../lib/achievement-writer');const {parseSnapshot}=require('../lib/steam-protocol');const {revision}=require('../lib/achievement-progress');
function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
function snapshot({counter=3,mask=0,stat={},value={},bit={},extraBits={},stats}={}){return {eresult:1,game_id:'550',crc_stats:123,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'TARGET',progress:{max_val:'10',value:{operation:'statvalue',operand1:'COUNT',...value}},...bit},'1':{name:'OTHER'},...extraBits}},'9':{type:'INT',name:'COUNT',min:'0',max:'100',...stat}}}}),stats:stats||[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:counter},{stat_id:10,stat_value:42}]};}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{throw Error('Unexpected transport');};return c;}
test('progress plans update only the selected bit and exclusive counter; plain activation remains blocked',()=>{const s=snapshot();assert.throws(()=>prepare(s,550,'TARGET'),/progress statistics/);const p=prepare(s,550,'TARGET',{allowProgress:true});assert.deepEqual(p.payload.stats,[{stat_id:7,stat_value:1},{stat_id:9,stat_value:10}]);assert.equal(p.progressChanges[0].before,3);assert.equal(p.revision,revision(s,550,'TARGET'));});
test('protected, shared, complex, noninteger, unavailable and constrained counters never get a plan',()=>{
  const inputs=[{stat:{permission:'2'}},{stat:{bSetByTrustedGS:'1'}},{stat:{aggregated:'1'}},{bit:{permission:'2'}},{value:{operation:'add',operand2:'2'}},{value:{operand2:'2'}},{stat:{type:'FLOAT'}},{stat:{max:'9'}},{stat:{maxchange:'2'}},{stat:{incrementonly:'unrecognized'}},{counter:0xffffffff},{stats:[{stat_id:7,stat_value:0}]},{stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:3},{stat_id:9,stat_value:4}]},{extraBits:{'2':{name:'SHARED',progress:{max_val:'20',value:{operation:'statvalue',operand1:'COUNT'}}}}}];
  for(const input of inputs){const s=snapshot(input);assert.equal(parseSnapshot(s,550).achievements[0].progressSupport.canComplete,false);assert.throws(()=>prepare(s,550,'TARGET',{allowProgress:true}));}
});
test('a preview is bound to schema, counter, bitmask and CRC; stale data is rejected before sending',async()=>{
  const initial=snapshot(),digest=revision(initial,550,'TARGET');
  for(const changed of [snapshot({counter:4}),snapshot({mask:2}),snapshot({stat:{max:'99'}}),{...snapshot(),crc_stats:124}])await assert.rejects(unlockAchievement(client(),550,'TARGET',{allowProgress:true,expectedRevision:digest,read:async()=>changed,send:async()=>{throw Error('Must not send');}}),/changed after/);
});
test('verified progress activation requires a clean ack and both expected changes with no unrelated changes',async()=>{
  const initial=snapshot();let reads=0,sends=0;const result=await unlockAchievement(client(),550,'TARGET',{allowProgress:true,expectedRevision:revision(initial,550,'TARGET'),read:async()=>reads++?snapshot({mask:1,counter:10}):initial,send:async(_,p)=>{sends++;assert.equal(p.stats.length,2);return {eresult:1,game_id:'550'};}});assert.equal(result.outcome,'confirmed');assert.equal(sends,1);assert.deepEqual(result.unexpectedStatChanges,[]);
  for(const final of [snapshot({mask:1,counter:3}),snapshot({mask:3,counter:10}),snapshot({mask:1,counter:10,stats:[{stat_id:7,stat_value:1},{stat_id:9,stat_value:10},{stat_id:10,stat_value:43}]})]){let n=0;const r=await unlockAchievement(client(),550,'TARGET',{allowProgress:true,read:async()=>n++?final:initial,send:async()=>({eresult:1,game_id:'550'})});assert.notEqual(r.outcome,'confirmed');}
});
test('completed counters are never decreased and only the missing achievement bit is sent',()=>{const p=prepare(snapshot({counter:15}),550,'TARGET',{allowProgress:true});assert.equal(p.payload.stats.length,1);assert.equal(p.progressChanges[0].after,15);});

})();

// === [protocol.test.js] ===
(() => {
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
  const r=parseSnapshot(snap({librarySummary:{unlocked:2,total:2,cacheTime:Math.floor(Date.now()/1000)}}),550);
  assert.equal(r.stateConflict,true);assert.equal(r.verified,false);assert.match(r.message,/statistics report 1\/2/);
  assert.ok(r.achievements.every(a=>a.unlocked===null&&!a.removalSupport.canRemove&&!a.compatibility.canUnlock));
  assert.equal(r.achievements[0].stateEvidence.bitUnlocked,false);
  assert.equal(r.achievements[0].compatibility.code,'library_state_conflict');assert.doesNotMatch(r.achievements[0].compatibility.action,/open it normally|publisher sign-in/);
});
test('an older disagreeing library cache does not erase current personal states or eligibility',()=>{
  const r=parseSnapshot(snap({crc_stats:12,librarySummary:{unlocked:2,total:2,cacheTime:123}}),550);
  assert.equal(r.staleLibrarySummary,true);assert.equal(r.stateConflict,false);assert.equal(r.verified,true);
  assert.deepEqual(r.achievements.map(a=>a.unlocked),[false,true]);assert.equal(r.achievements[0].compatibility.canUnlock,true);
  assert.doesNotMatch(r.message,/statistics report|conflict|blocked/);
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

})();

// === [rarity-history.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPercentageReader}=require('../lib/rarity-history');
const good=()=>({appid:550,percentages:{A:2,B:10,C:25},titlePercentages:{},checkedAt:'2026-10-14T04:00:00Z',source:'Steam API',rarityStatus:'available'});
const bad=()=>({appid:550,percentages:{},titlePercentages:{},rarityStatus:'suspect_uniform_100'});
test('an anomalous live response preserves the last valid percentages with explicit historical provenance',async()=>{
  let fail=false,time=Date.parse('2026-10-14T16:00:00Z');const reader=createPercentageReader({snapshots:[],now:()=>time,read:async()=>fail?bad():good()});
  const current=await reader(550);current.percentages.A=99;fail=true;const historic=await reader(550);
  assert.equal(historic.percentages.A,2);assert.equal(historic.rarityStatus,'historical');assert.equal(historic.checkedAt,'2026-10-14T04:00:00Z');assert.match(historic.rarityMessage,/Last known/);
  historic.percentages.A=80;assert.equal((await reader(550)).percentages.A,2);time+=8*86400000;assert.equal((await reader(550)).rarityStatus,'suspect_uniform_100');
});
test('the official L4D2 indexed fallback has all 101 unique titles, source and expiry, and live data wins',async()=>{
  const now=()=>Date.parse('2026-10-14T16:00:00Z');let live=false;const reader=createPercentageReader({now,read:async()=>live?good():bad()});const r=await reader(550);
  assert.equal(Object.keys(r.titlePercentages).length,101);assert.equal(r.titlePercentages.cl0wnd,9.8);assert.equal(r.titlePercentages['gnome alone'],69.6);assert.equal(r.rarityStatus,'historical');assert.match(r.sourceUrl,/steamcommunity.com/);assert.match(r.rarityMessage,/exact original date unavailable/);
  live=true;assert.equal((await reader(550)).rarityStatus,'available');await assert.rejects(reader(240),/different game/);
  const expired=createPercentageReader({now:()=>Date.parse('2026-11-05T00:00:00Z'),read:async()=>bad()});assert.equal((await expired(550)).rarityStatus,'suspect_uniform_100');
});
test('fallback does not transfer another game or retain invalid uniform data, and has a 256 KiB bound',async()=>{
  const reader=createPercentageReader({snapshots:[],read:async id=>({...good(),appid:id})});for(let id=1;id<=100;id++)await reader(id);assert.ok(reader.bytes()<=256*1024);reader.clear();assert.equal(reader.bytes(),0);
  const missing=createPercentageReader({now:()=>Date.parse('2026-10-14T16:00:00Z'),read:async()=>{throw Error('Unavailable');}});await assert.rejects(missing(240),/Unavailable/);assert.equal((await missing(550)).historical,true);
});

})();

// === [requirements.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseRequirements,gameRequirements}=require('../lib/game-requirements');
test('external launcher and publisher account requirements are context, not an activation ban',()=>{
  const result=parseRequirements(123,{123:{success:true,data:{categories:[{id:22}],ext_user_account_notice:'Publisher Account'}}},'<div class="DRM_notice">Requires Third Party Launcher</div>');
  assert.equal(result.externalAccountOrSoftware,true);assert.equal(result.launcherReported,true);assert.equal(result.steamAchievements,true);assert.match(result.explanation,/alone does not establish/);assert.equal(result.canUnlock,undefined);
});
test('unknown store data never invents a launcher restriction or absence of Steam achievements',()=>{
  const result=parseRequirements(123,{},'<html>Age verification</html>');assert.equal(result.metadataAvailable,false);assert.equal(result.launcherReported,false);assert.equal(result.steamAchievements,null);assert.match(result.explanation,/has not been established/);assert.deepEqual(result.facts,[]);
});
test('Tarkov context names the established Battlestate requirement without claiming publisher progress access',()=>{
  const result=parseRequirements(3932890,{});assert.match(result.facts[0],/Battlestate/);assert.match(result.explanation,/cannot verify account linking/);assert.equal(result.launcherReported,false);
});
test('metadata fetches run together, remain bounded and tolerate store unavailability',async()=>{
  const called=[];let release;const gate=new Promise(r=>release=r);
  const pending=gameRequirements(123,async(url,opts)=>{called.push(url);assert.equal(opts.timeoutMs,5000);assert.equal(opts.maxBytes,1024*1024);await gate;throw Error('unavailable');});assert.equal(called.length,2);release();assert.equal((await pending).metadataAvailable,false);
});
test('store markup is converted to bounded text without injecting HTML into the panel',()=>{
  const result=parseRequirements(123,{123:{success:true,data:{drm_notice:'<b>External DRM</b>'+('x'.repeat(1000))}}});assert.ok(result.facts[0].length<=400);assert.ok(!result.facts[0].includes('<b>'));
});

})();

// === [resources.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {ResourceBudget}=require('../lib/resources');
test('resource admission limits simultaneous work without retaining a waiting queue',()=>{const b=new ResourceBudget({rss:()=>0}),release=b.acquire();assert.throws(()=>b.acquire(),e=>e.status===429);const small=Array.from({length:4},()=>b.acquire('small'));assert.throws(()=>b.acquire('small'),e=>e.status===429);release();release();assert.equal(b.status().activeHeavy,0);small.forEach(r=>r());assert.equal(b.status().activeSmall,0);});
test('memory pressure blocks new heavy work but permits recovery after memory falls',()=>{let rss=450*1048576;const b=new ResourceBudget({rss:()=>rss});assert.throws(()=>b.acquire(),e=>e.status===429);rss=100*1048576;b.acquire()();});
test('failed work releases its admission slot',async()=>{const b=new ResourceBudget({rss:()=>0});await assert.rejects(b.run(async()=>{throw Error('failed')}));assert.equal(b.status().activeHeavy,0);assert.equal(await b.run(async()=>42),42);});

})();

// === [shared-journal.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict'),{AchievementJournal}=require('../lib/achievement-journal');
const account='76561198000000001',effects=[{apiname:'DOCTOR',unlocked:false,after:25000,effect:'would_unlock'},{apiname:'CHIEF',unlocked:false,after:25000,effect:'progress_only'}];
const evidence=()=>({appid:440,apiname:'DOCTOR',name:'Team Doctor',checkedAt:'2026-10-13T18:00:00Z',before:false,revision:'a'.repeat(64),progressChanges:[{statId:9,statName:'HEALING',before:0,after:25000}],groupMembers:['DOCTOR','CHIEF'],sharedEffects:effects});
function db(){
  let records=new Map(),members=new Map(),lock=Promise.resolve(),time=Date.parse('2026-10-13T18:00:00Z');
  const state={failInsert:false,installed:true,advance:()=>time+=61000};
  const clone=m=>new Map([...m].map(([k,v])=>[k,structuredClone(v)])),key=a=>a.slice(0,3).join(':');
  async function query(sql,args=[],tx){
    if(sql.startsWith('CREATE')||sql==='BEGIN'||sql.startsWith('SET LOCAL'))return {rows:[]};
    if(sql.includes('to_regclass'))return {rows:[{present:state.installed?'public.steamfarmer_shared_reservations':null}]};
    if(sql.includes('pg_advisory_xact_lock')){const before=lock;lock=new Promise(r=>{tx.unlock=r;});await before;tx.records=clone(records);tx.members=clone(members);return {rows:[]};}
    if(sql==='COMMIT'){records=tx.records;members=tx.members;tx.unlock();return {rows:[]};}
    if(sql==='ROLLBACK'){tx?.unlock?.();return {rows:[]};}
    const rs=tx?.records||records,ms=tx?.members||members;
    if(sql.startsWith('INSERT INTO steamfarmer_shared')){if(state.failInsert)throw Error('Database unavailable');if(ms.has(key(args)))throw Error('Unique violation');ms.set(key(args),{owner:args[3]});return {rows:[]};}
    if(sql.startsWith('INSERT INTO steamfarmer_achievement')){if(rs.has(key(args))&&!sql.includes('ON CONFLICT'))throw Error('Unique violation');if(!rs.has(key(args)))rs.set(key(args),{receipt:structuredClone(args[3]),created_at:new Date(time)});return {rows:[]};}
    if(sql.startsWith('UPDATE')){const r=rs.get(key(args));if(r)r.receipt={...r.receipt,...structuredClone(args[3])};return {rows:[],rowCount:r?1:0};}
    if(sql.startsWith('DELETE')){for(const[k,v]of ms)if(k.startsWith(args[0]+':'+args[1]+':')&&v.owner===args[2])ms.delete(k);return {rows:[]};}
    if(sql.startsWith('SELECT COUNT'))return {rows:[{count:[...rs.keys()].filter(k=>k.startsWith(args[0]+':')).length}]};
    if(sql.includes("INTERVAL '1 minute'"))return {rows:[...rs].filter(([k,r])=>k.startsWith(args[0]+':')&&time-r.created_at.getTime()<60000).map(()=>({}))};
    if(sql.startsWith('SELECT r.apiname'))return {rows:[...ms].filter(([k])=>k.startsWith(args[0]+':'+args[1]+':')).map(([k,v])=>({apiname:k.split(':').slice(2).join(':'),receipt:rs.get(args[0]+':'+args[1]+':'+v.owner).receipt}))};
    const store=sql.includes('FROM steamfarmer_shared')?ms:rs;
    let selected=[...store].filter(([k])=>k.startsWith(args[0]+':'+args[1]+':'));
    if(sql.includes('ANY'))selected=selected.filter(([k])=>args[2].includes(k.split(':').slice(2).join(':')));
    else if(sql.includes('apiname=$3'))selected=selected.filter(([k])=>k===key(args));
    return {rows:selected.map(([k,r])=>({apiname:k.split(':').slice(2).join(':'),...structuredClone(r)}))};
  }
  state.pool={on(){},query:(s,a)=>query(s,a),connect:async()=>{const tx={};return {query:(s,a)=>query(s,a,tx),release(){}};},end:async()=>{}};
  return state;
}
const journal=database=>new AchievementJournal({cfg:{},save(){throw Error('Local fallback forbidden');},pool:database.pool});
const confirmed=()=>({...evidence(),outcome:'confirmed',after:true,acknowledgement:{result:1,stale:false,rejectedStats:[]},unexpectedStatChanges:[],otherAchievementChanges:[],sharedVerification:effects.map(e=>({...e,verified:true,observedCounter:25000,observedUnlocked:e.apiname==='DOCTOR'}))});
test('group intent survives another instance and reserves the progress-only member against individual writes',async()=>{
  const database=db(),first=journal(database);await first.reserveShared(account,440,'DOCTOR',evidence());
  const restored=journal(database);assert.deepEqual(await restored.sharedBlocked(account,440,['DOCTOR','CHIEF']),['DOCTOR','CHIEF']);
  assert.equal((await restored.forGame(account,440)).get('CHIEF').outcome,'requested');
  database.advance();await assert.rejects(restored.reserve(account,440,'CHIEF',{...evidence(),apiname:'CHIEF'}),/shared-counter/);
});
test('unverified or incomplete results keep every reservation; confirmed effects release progress-only member',async()=>{
  const database=db(),j=journal(database);await j.reserveShared(account,440,'DOCTOR',evidence());
  await j.finishShared(account,440,'DOCTOR',{...evidence(),outcome:'unknown'});
  assert.equal((await j.sharedBlocked(account,440,['CHIEF'])).length,1);
  const incomplete=confirmed();incomplete.sharedVerification.pop();await assert.rejects(j.finishShared(account,440,'DOCTOR',incomplete),/could not be persisted/);
  assert.equal((await j.sharedBlocked(account,440,['CHIEF'])).length,1);
  await j.finishShared(account,440,'DOCTOR',confirmed());assert.deepEqual(await j.sharedBlocked(account,440,['DOCTOR','CHIEF']),[]);
  const receipt=await j.get(account,440,'DOCTOR');assert.equal(receipt.sharedEffects.length,2);assert.equal(receipt.sharedVerification.length,2);
  database.advance();await j.reserve(account,440,'CHIEF',{appid:440,apiname:'CHIEF',checkedAt:new Date().toISOString()});
});
test('partial group reservations roll back without local fallback and cannot be used without the migration',async()=>{
  const database=db(),j=journal(database);database.failInsert=true;await assert.rejects(j.reserveShared(account,440,'DOCTOR',evidence()),/No Steam write/);
  assert.equal(await j.get(account,440,'DOCTOR'),null);assert.deepEqual(await j.sharedBlocked(account,440,['CHIEF']),[]);
  database.installed=false;await assert.rejects(j.reserveShared(account,440,'DOCTOR',evidence()),/installed persistent/);
});
test('competing shared and individual reservations cannot both claim the same member',async()=>{
  const database=db(),a=journal(database),b=journal(database);await Promise.all([a.ready(),b.ready()]);
  const results=await Promise.allSettled([a.reserveShared(account,440,'DOCTOR',evidence()),b.reserve(account,440,'CHIEF',{appid:440,apiname:'CHIEF',checkedAt:new Date().toISOString()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('omitting a reviewed member is rejected before recording any intent',async()=>{
  const database=db(),j=journal(database),partial={...evidence(),groupMembers:['DOCTOR']};
  await assert.rejects(j.reserveShared(account,440,'DOCTOR',partial),/All reviewed effects/);assert.equal(await j.get(account,440,'DOCTOR'),null);
});

test('shared completion rejects changed intent, dirty acknowledgement and unrelated changes without releasing any member',async()=>{
  const database=db(),j=journal(database);await j.reserveShared(account,440,'DOCTOR',evidence());
  const good=confirmed(),badResults=[
    {...good,revision:'b'.repeat(64)},
    {...good,appid:550},
    {...good,apiname:'CHIEF'},
    {...good,before:true},
    {...good,after:false},
    {...good,progressChanges:[{...good.progressChanges[0],after:30000}]},
    {...good,sharedEffects:good.sharedEffects.map(e=>({...e,after:30000}))},
    {...good,groupMembers:['DOCTOR']},
    {...good,acknowledgement:null},
    {...good,acknowledgement:{result:2,stale:false,rejectedStats:[]}},
    {...good,acknowledgement:{result:1,stale:true,rejectedStats:[]}},
    {...good,acknowledgement:{result:1,stale:false,rejectedStats:[{statId:9}]}},
    {...good,unexpectedStatChanges:[99]},
    {...good,otherAchievementChanges:['UNREVIEWED']},
    {...good,sharedVerification:[good.sharedVerification[0],good.sharedVerification[0]]},
    {...good,sharedVerification:good.sharedVerification.map(e=>({...e,observedCounter:25001}))}
  ];
  for(const result of badResults){
    await assert.rejects(j.finishShared(account,440,'DOCTOR',result),/could not be persisted/);
    assert.deepEqual(await j.sharedBlocked(account,440,['DOCTOR','CHIEF']),['DOCTOR','CHIEF']);
    assert.equal((await j.get(account,440,'DOCTOR')).outcome,'requested');
  }
  // Actual JSONB key order must not invalidate identical reviewed values.
  const reordered=structuredClone(good);
  for(const field of ['progressChanges','sharedEffects'])reordered[field]=reordered[field].map(value=>Object.fromEntries(Object.entries(value).reverse()));
  await j.finishShared(account,440,'DOCTOR',reordered);
  assert.deepEqual(await j.sharedBlocked(account,440,['DOCTOR','CHIEF']),[]);
});

test('shared result updates preserve original evidence and cannot downgrade confirmed history',async()=>{
  const database=db(),j=journal(database);const original=evidence();await j.reserveShared(account,440,'DOCTOR',original);
  await j.finishShared(account,440,'DOCTOR',{outcome:'unknown',revision:'b'.repeat(64),sharedEffects:[],groupMembers:[],progressChanges:[],name:'Changed',message:'Verification was unavailable.'});
  const pending=await j.get(account,440,'DOCTOR');
  for(const field of ['revision','sharedEffects','groupMembers','progressChanges','name'])assert.deepEqual(pending[field],original[field]);
  assert.equal(pending.message,'Verification was unavailable.');
  assert.deepEqual(await j.sharedBlocked(account,440,['DOCTOR','CHIEF']),['DOCTOR','CHIEF']);
  await j.finishShared(account,440,'DOCTOR',confirmed());
  const completed=structuredClone(await j.get(account,440,'DOCTOR'));
  await assert.rejects(j.finishShared(account,440,'DOCTOR',{outcome:'unknown',message:'Late error'}),/could not be persisted/);
  assert.deepEqual(await j.get(account,440,'DOCTOR'),completed);
});

test('the real shared writer result satisfies immutable journal confirmation with a synthetic Steam transport',async()=>{
  const kv=value=>{const parts=[];for(const[key,item]of Object.entries(value))parts.push(Buffer.from([typeof item==='object'?0:1]),Buffer.from(key+'\0'),typeof item==='object'?kv(item):Buffer.from(String(item)+'\0'));parts.push(Buffer.from([8]));return Buffer.concat(parts);};
  const bit=(name,goal)=>({name,display:{name:{english:name}},progress:{max_val:String(goal),value:{operation:'statvalue',operand1:'HEALING'}}});
  const schema=kv({'440':{stats:{7:{type:'4',bits:{0:bit('DOCTOR',25000),1:bit('CHIEF',100000)}},9:{type:'INT',name:'HEALING'}}}});
  const initial={game_id:'440',eresult:1,crc_stats:12,schema,stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0}]};
  const final={...initial,stats:[{stat_id:7,stat_value:1},{stat_id:9,stat_value:25000}]};
  const database=db(),j=journal(database),client={steamID:{toString:()=>account},playingState:{blocked:false},_send:()=>assert.fail('A real Steam transport must never run.')};
  let reads=0,sends=0;
  const result=await require('../lib/achievement-writer').unlockAchievement(client,440,'DOCTOR',{
    sharedProgress:true,expectedRevision:require('../lib/achievement-progress').sharedPreview(initial,440,'DOCTOR').revision,
    read:async()=>reads++?final:initial,
    send:async()=>{sends++;return {game_id:'440',eresult:1};},
    beforeSend:receipt=>j.reserveShared(account,440,'DOCTOR',receipt)
  });
  assert.equal(result.outcome,'confirmed');assert.equal(sends,1);
  await j.finishShared(account,440,'DOCTOR',result);
  assert.deepEqual(await j.sharedBlocked(account,440,['DOCTOR','CHIEF']),[]);
  const receipt=await j.get(account,440,'DOCTOR');assert.equal(receipt.outcome,'confirmed');assert.equal(receipt.statId,7);assert.equal(receipt.bitIndex,0);assert.deepEqual(receipt.sharedEffects,result.sharedEffects);
});

})();

// === [shared-progress.test.js] ===
(() => {
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

})();

// === [shared-writer.test.js] ===
(() => {
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {prepareShared,unlockAchievement}=require('../lib/achievement-writer'),{sharedPreview}=require('../lib/achievement-progress');
function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
function snapshot({value=0,mask=0,goal=1000000,protectedRow=false,extraStat=false,missing=false}={}){
  const bit=(name,threshold,extra={})=>({name,progress:{max_val:String(threshold),value:{operation:'statvalue',operand1:'HEALED'}},...extra});
  return {eresult:1,game_id:'440',crc_stats:1,schema:kv({'440':{stats:{'7':{type:'4',bits:{'0':bit('TEAM_DOCTOR',25000),'1':bit('CHIEF',goal,protectedRow?{permission:'2'}:{})}},'9':{type:'INT',name:'HEALED',min:'0',max:'2000000'}}}}),stats:[{stat_id:7,stat_value:mask},...(!missing?[{stat_id:9,stat_value:value}]:[]),...(extraStat?[{stat_id:10,stat_value:1}]:[])]};
}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{throw Error('Real transport forbidden');};return c;}
test('shared plan changes only Team Doctor bit and counter, reserves and records both effects',()=>{
  const s=snapshot(),review=sharedPreview(s,440,'TEAM_DOCTOR'),plan=prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:review.revision});
  assert.deepEqual(plan.payload.stats,[{stat_id:7,stat_value:1},{stat_id:9,stat_value:25000}]);assert.deepEqual(plan.groupMembers,['TEAM_DOCTOR','CHIEF']);assert.equal(plan.sharedEffects.find(e=>e.apiname==='CHIEF').effect,'progress_only');
});
test('unreviewed, stale, protected, multiple-unlock and unavailable shared plans cannot be written',()=>{
  const initial=snapshot(),digest=sharedPreview(initial,440,'TEAM_DOCTOR').revision;
  assert.throws(()=>prepareShared(initial,440,'TEAM_DOCTOR'));
  for(const s of [snapshot({value:1}),snapshot({goal:100}),snapshot({protectedRow:true}),snapshot({missing:true})])assert.throws(()=>prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:digest}));
  for(const s of [snapshot({goal:100}),snapshot({protectedRow:true})])assert.throws(()=>prepareShared(s,440,'TEAM_DOCTOR',{expectedRevision:sharedPreview(s,440,'TEAM_DOCTOR').revision}));
});
test('clean acknowledgement and fresh complete effect verification confirm the shared change',async()=>{
  const initial=snapshot();let reads=0,sends=0,reserved=false;
  const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>reads++?snapshot({value:25000,mask:1}):initial,beforeSend:async e=>{assert.equal(e.sharedEffects.length,2);reserved=true;},send:async()=>{assert.equal(reserved,true);sends++;return {eresult:1,game_id:'440'};}});
  assert.equal(sends,1);assert.equal(result.outcome,'confirmed');assert.equal(result.sharedVerification.length,2);assert.ok(result.sharedVerification.every(e=>e.verified));assert.equal(result.sharedVerification.find(e=>e.apiname==='CHIEF').observedUnlocked,false);
});
test('unexpected unlock, incorrect counter, extra statistic or dirty ack never confirms shared operation',async()=>{
  const initial=snapshot();
  for(const [final,ack] of [[snapshot({value:25000,mask:3}),{eresult:1,game_id:'440'}],[snapshot({value:24999,mask:1}),{eresult:1,game_id:'440'}],[snapshot({value:25000,mask:1,extraStat:true}),{eresult:1,game_id:'440'}],[snapshot({value:25000,mask:1}),{eresult:1,game_id:'440',stats_out_of_date:true}]]){
    let reads=0;const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>reads++?final:initial,send:async()=>ack});
    assert.notEqual(result.outcome,'confirmed');
  }
});
test('failed durable reservation blocks transport and disconnected final read remains unknown',async()=>{
  const initial=snapshot(),options={sharedProgress:true,expectedRevision:sharedPreview(initial,440,'TEAM_DOCTOR').revision,read:async()=>initial,send:async()=>{throw Error('Must not send');},beforeSend:async()=>{throw Error('Reservation unavailable');}};
  await assert.rejects(unlockAchievement(client(),440,'TEAM_DOCTOR',options),/Reservation unavailable/);
  let reads=0;const result=await unlockAchievement(client(),440,'TEAM_DOCTOR',{...options,beforeSend:async()=>{},send:async()=>({eresult:1,game_id:'440'}),read:async()=>{if(reads++)throw Error('Offline');return initial;}});
  assert.equal(result.outcome,'unknown');assert.equal(result.sharedEffects.length,2);
});

})();

// === [writer.test.js] ===
(() => {
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {parseSnapshot}=require('../lib/steam-protocol');const {prepare,unlockAchievement}=require('../lib/achievement-writer');
function kv(obj){const pieces=[];for(const[k,v]of Object.entries(obj))pieces.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));pieces.push(Buffer.from([8]));return Buffer.concat(pieces);}
function snap(id=550,mask=0,{bit={},extra={},bits={}}={}){return {eresult:1,game_id:String(id),crc_stats:123,schema:kv({[id]:{stats:{'7':{type:'4',bits:{'0':{name:'FIRST',...bit},'1':{name:'SECOND'},'31':{name:'HIGH'},...bits}}}}}),stats:[{stat_id:7,stat_value:mask},{stat_id:9,stat_value:10}],...extra};}
function client(){const c=new EventEmitter();c.steamID={toString:()=> '76561198000000001'};c._send=()=>{};return c;}
const ack=id=>({game_id:String(id),eresult:1,stats_out_of_date:false,stats_failed_validation:[]});
test('individual plans use the requested game and API name, preserving bit 31',()=>{
  assert.equal(prepare(snap(730,0x80000000),730,'SECOND').payload.stats[0].stat_value,0x80000002);
  assert.equal(prepare(snap(550,1),550,'HIGH').payload.stats[0].stat_value,0x80000001);
  assert.throws(()=>prepare(snap(730),550,'FIRST'),/different game/);assert.throws(()=>prepare(snap(),550,'ABSENT'),/identified/);
});
test('classification distinguishes restrictions, dependencies, insufficient data and provisional compatibility',()=>{
  assert.equal(parseSnapshot(snap(),550).achievements[0].compatibility.status,'provisional');
  assert.equal(parseSnapshot(snap(550,0,{bit:{permission:'2'}}),550).achievements[0].compatibility.status,'restricted');
  assert.equal(parseSnapshot(snap(550,0,{bit:{progress:{max_val:'5'}}}),550).achievements[0].compatibility.status,'dependency');
  const missing=snap();delete missing.crc_stats;assert.equal(parseSnapshot(missing,550).achievements[0].compatibility.status,'insufficient_data');
  const noValue=snap(550,0,{extra:{stats:[{stat_id:7}]}});assert.equal(parseSnapshot(noValue,550).achievements[0].unlocked,null);
});
test('duplicate API names, alias bits and duplicate personal stat masks are never writable',()=>{
  for(const s of [snap(550,0,{bits:{'2':{name:'FIRST'}}}),snap(550,0,{bits:{'00':{name:'ALIAS'}}}),snap(550,0,{extra:{stats:[{stat_id:7,stat_value:0},{stat_id:7,stat_value:1}]}})]) {
    assert.equal(parseSnapshot(s,550).achievements[0].compatibility.canUnlock,false);assert.throws(()=>prepare(s,550,'FIRST'));
  }
});
test('general activation confirms a selected achievement in a second game with fresh reads',async()=>{
  let reads=0;const r=await unlockAchievement(client(),730,'SECOND',{read:async()=>snap(730,++reads===1?1:3),send:async(_,p)=>{assert.equal(p.game_id,'730');assert.deepEqual(p.stats,[{stat_id:7,stat_value:3}]);return ack(730);}});assert.equal(r.outcome,'confirmed');assert.equal(reads,2);
});
test('cooldown limits separate selections and permits the next explicit operation after a minute',async()=>{
  const c=client();let time=100000,value=0,sends=0;
  const options={now:()=>time,read:async()=>snap(550,value),send:async(_,p)=>{sends++;value=p.stats[0].stat_value;return ack(550);}};
  assert.equal((await unlockAchievement(c,550,'FIRST',options)).outcome,'confirmed');
  await assert.rejects(unlockAchievement(c,550,'SECOND',options),/one minute/);assert.equal(sends,1);
  time+=60000;assert.equal((await unlockAchievement(c,550,'SECOND',options)).outcome,'confirmed');assert.equal(sends,2);
});
test('changed schemas, extra stats and a mismatched write acknowledgement never confirm',async()=>{
  for(const final of [snap(550,1,{bits:{'2':{name:'ADDED'}}}),snap(550,1,{extra:{stats:[{stat_id:7,stat_value:1},{stat_id:9,stat_value:10},{stat_id:10,stat_value:1}]}})]){
    let reads=0;const r=await unlockAchievement(client(),550,'FIRST',{read:async()=>++reads===1?snap():final,send:async()=>ack(550)});assert.equal(r.outcome,'unknown');
  }
  let reads=0;const r=await unlockAchievement(client(),550,'FIRST',{read:async()=>snap(550,++reads===1?0:1),send:async()=>ack(730)});assert.notEqual(r.outcome,'confirmed');
});

})();
