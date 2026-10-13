'use strict';
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
