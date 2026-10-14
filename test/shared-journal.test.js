'use strict';
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
