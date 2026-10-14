'use strict';
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
