'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{AchievementJournal}=require('../lib/achievement-journal');
const account='76561198000000001',effects=[{apiname:'DOCTOR',unlocked:false,after:25000,effect:'would_unlock'},{apiname:'CHIEF',unlocked:false,after:25000,effect:'progress_only'}];
const evidence=()=>({appid:440,apiname:'DOCTOR',name:'Team Doctor',checkedAt:'2026-10-13T18:00:00Z',before:false,groupMembers:['DOCTOR','CHIEF'],sharedEffects:effects});
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
const confirmed=()=>({...evidence(),outcome:'confirmed',sharedVerification:effects.map(e=>({...e,verified:true,observedCounter:25000,observedUnlocked:e.apiname==='DOCTOR'}))});
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
