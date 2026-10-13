'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createApp } = require('../bot');
const { atomicWrite, Vault, appId, hour, sleepNow } = require('../lib/core');
const { parseXml, parseHtml, parseCards } = require('../lib/steam-data');
const PASSWORD = 'panel-test-password-123';
test('shared API stays read-only without persistent reservations and never bypasses them',async t=>{
  function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
  const bit=(name,goal)=>({name,progress:{max_val:String(goal),value:{operation:'statvalue',operand1:'HEALED'}}});
  const snapshot={eresult:1,game_id:'440',crc_stats:12,schema:kv({'440':{stats:{'7':{type:'4',bits:{'0':bit('DOCTOR',25000),'1':bit('CHIEF',1000000)}},'9':{type:'INT',name:'HEALED'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0}]};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,writes=0;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>snapshot,individualWriter:async(_,id,name,options)=>{
    assert.equal(options.sharedProgress,true);const plan=require('../lib/achievement-writer').prepareShared(snapshot,id,name,{expectedRevision:options.expectedRevision});
    await options.beforeSend({appid:id,apiname:name,checkedAt:new Date().toISOString(),sharedEffects:plan.sharedEffects,groupMembers:plan.groupMembers});writes++;return {outcome:'confirmed'};
  }});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/shared-progress-preview?accountId=main&appid=440&apiname=DOCTOR';assert.equal((await f.request(route)).response.status,401);
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.canActivate,false);assert.equal(preview.data.effects.length,2);
  const body={accountId:'main',appid:440,apiname:'DOCTOR',mode:'shared'};assert.equal((await f.request('/api/achievement/unlock',body)).response.status,400);
  assert.equal((await f.request('/api/achievement/unlock',{...body,revision:preview.data.revision})).response.status,503);assert.equal(writes,0);
});
const TOKEN_EXPIRY=Math.floor(Date.now()/1000)+3600;
test('decimal library search is authenticated, owned-only, cached and bound to its library revision',async t=>{
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,ownedCalls=0,reads=0;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{protocolReader:async()=>{reads++;return {achievements:[]};}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/float-search?accountId=main';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');assert.equal((await f.request(route)).response.status,409);
  const client=new FakeUser({});client.getUserOwnedApps=async()=>{ownedCalls++;return {apps:Array.from({length:10},(_,i)=>({appid:i+1,name:'Owned '+i}))};};Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true});f.app.clients.set('main',client);
  const first=await f.request(route);assert.equal(first.response.status,200);assert.equal(first.data.nextCursor,8);assert.equal(first.data.writesSent,0);assert.equal(reads,8);
  assert.equal((await f.request(route+'&cursor=8&revision=wrong')).response.status,409);assert.equal(reads,8);
  const last=await f.request(route+'&cursor=8&revision='+first.data.revision);assert.equal(last.data.complete,true);assert.equal(last.data.nextCursor,10);assert.equal(ownedCalls,1);assert.equal(reads,10);
  assert.equal((await f.request(route+'&cursor=-1')).response.status,400);
  assert.equal((await f.request(route+'&cursor=1000&revision='+first.data.revision)).response.status,400);
});
test('decimal preview requires the connected main account, rejects session changes and never writes',async t=>{
  function kv(obj){const chunks=[];for(const[k,v]of Object.entries(obj))chunks.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));chunks.push(Buffer.from([8]));return Buffer.concat(chunks);}
  const snapshot={eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'DECIMAL',progress:{max_val:'10.5',value:{operation:'statvalue',operand1:'DISTANCE'}}}}},'9':{type:'FLOAT',name:'DISTANCE'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0x3fa00000}]};
  const previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let f,writes=0,change=false;
  try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>{if(change)f.app.states.get('main').connected=false;return snapshot;},individualWriter:async()=>{writes++;}});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  const route='/api/achievement/float-progress-preview?accountId=main&appid=550&apiname=DECIMAL';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');assert.equal((await f.request(route)).response.status,409);
  Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.counter.before,1.25);assert.equal(preview.data.counter.after,10.5);assert.equal(preview.data.canActivate,false);
  assert.equal((await f.request('/api/achievement/unlock',{accountId:'main',appid:550,apiname:'DECIMAL',mode:'float',revision:preview.data.revision})).response.status,400);
  change=true;assert.equal((await f.request(route)).response.status,409);assert.equal(writes,0);
});
test('persistent history starts concurrently with Steam reading and failures still block activation',async t=>{
  let releaseSteam,historyStarted=false;
  const steam=new Promise(resolve=>releaseSteam=resolve);
  const journal={ready:async()=>{},status:()=>({available:false}),forGame:async()=>{historyStarted=true;throw Error('Unavailable');},close:async()=>{}};
  const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{achievementJournal:journal,protocolReader:async()=>{
    await steam;return {verified:true,achievements:[{apiname:'REAL',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}}]};
  }});
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('a'),{connected:true});f.app.clients.set('a',new FakeUser({}));
  const pending=f.request('/api/achievements?accountId=a&appid=550&method=protocol');
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(historyStarted,true);releaseSteam();
  const {data}=await pending;assert.equal(data.achievements[0].compatibility.canUnlock,false);assert.match(data.historyWarning,/activation is blocked/);assert.ok(Number.isFinite(data.readDurationMs));
});
function token() { return `test.${Buffer.from(JSON.stringify({iss:'steam',sub:'76561198000000001',aud:['client','web'],exp:TOKEN_EXPIRY})).toString('base64url')}.signature`; }
class FakeLogin extends EventEmitter {
  static latest;
  constructor(){super();FakeLogin.latest=this;this.steamID={toString:()=> '76561198000000001'};this.accountName='owner';this.refreshToken=token();}
  async startWithCredentials(details){this.details=details;return {actionRequired:true,validActions:[{type:2,detail:'example.test'}]};}
  async submitSteamGuardCode(code){if(code!=='ABCDE')throw Error();this.emit('authenticated');}
  cancelLoginAttempt(){this.cancelled=true;}
}
class FakeUser extends EventEmitter {
  static latest;
  constructor(options){super();this.options=options;FakeUser.latest=this;this.steamID={toString:()=> '76561198000000001'};this.playingState={blocked:false};this.calls=[];}
  logOn(details){this.details=details;queueMicrotask(()=>this.emit('loggedOn'));}
  gamesPlayed(list){this.calls.push([...list]);}
  setPersona(){} logOff(){} webLogOn(){}
  requestFreeLicense(ids,cb){cb(null,[10],[730]);}
}
async function fixture(t, config = {}, options = {}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'steamfarmer-test-'));
  atomicWrite(path.join(directory,'config.json'),{timezone:'America/Montevideo',accounts:[],discordWebhook:'',...config});
  const prev=process.env.PANEL_PASSWORD;process.env.PANEL_PASSWORD=PASSWORD;
  const app=createApp({directory,silent:true,connect:false,SteamUser:FakeUser,LoginSession:FakeLogin,achievements:async()=>({achievements:[{apiname:'REAL',unlocked:false}],verified:true}),...options});
  if(prev===undefined)delete process.env.PANEL_PASSWORD;else process.env.PANEL_PASSWORD=prev;
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='',csrf='';
  async function request(route,body,opts={}) {
    const headers={...(opts.auth===false?{}:{Cookie:cookie}),...opts.headers};
    if(body!==undefined){headers['Content-Type']='application/json';if(opts.csrf!==false)headers['X-CSRF-Token']=csrf;}
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();return {response,data};
  }
  async function login(){const r=await request('/api/panel/login',{password:PASSWORD});assert.equal(r.response.status,200);cookie=r.response.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;return r;}
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {app,request,login,directory,base};
}
test('validación de IDs y horario de Montevideo, incluido 00:00 y desactivación',()=>{
  assert.throws(()=>appId(-1));assert.throws(()=>appId('1x'));assert.throws(()=>hour(24));assert.equal(hour(0),0);
  assert.equal(sleepNow({enabled:true,start:23,end:2},'America/Montevideo',new Date('2026-10-13T03:30:00Z')),true);
  assert.equal(sleepNow({enabled:false,start:23,end:2},'America/Montevideo',new Date('2026-10-13T03:30:00Z')),false);
  assert.equal(sleepNow({enabled:true,start:0,end:0},'UTC'),false);
});
test('heavy work is bounded, identical reads join, and status remains available while busy',async t=>{let release,calls=0;const gate=new Promise(r=>release=r);const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{achievements:async()=>{calls++;await gate;return {achievements:[],verified:false}}});await f.login();const first=f.request('/api/achievements?accountId=a&appid=240');while(calls!==1)await new Promise(r=>setImmediate(r));const joined=f.request('/api/achievements?accountId=a&appid=240');const busy=await f.request('/api/achievements?accountId=a&appid=550');assert.equal(busy.response.status,429);assert.equal(busy.response.headers.get('retry-after'),'3');assert.equal((await f.request('/api/status')).response.status,200);release();assert.equal((await first).response.status,200);assert.equal((await joined).response.status,200);assert.equal(calls,1);assert.equal((await f.request('/api/achievements?accountId=a&appid=550')).response.status,200);});
test('manual pause survives a Steam reconnect within the same process',async t=>{const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[220],paused:true}]});await f.login();assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,true);f.app.states.delete('a');assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,true);await f.request('/api/toggle',{accountId:'a'});f.app.states.delete('a');assert.equal((await f.request('/api/status')).data.accounts[0].isPaused,false);});
test('automatic achievement reading prefers verified protocol and skips community requests',async t=>{let webCalls=0,timeout;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{protocolReader:async(_,id,opts)=>{timeout=opts.timeoutMs;return {verified:true,achievements:[{apiname:'REAL',unlocked:false}]};},achievements:async()=>{webCalls++;return {verified:true,achievements:[]};}});await f.login();await f.request('/api/status');f.app.states.get('a').connected=true;f.app.clients.set('a',new FakeUser({}));const result=await f.request('/api/achievements?accountId=a&appid=550&method=auto');assert.equal(result.response.status,200);assert.equal(result.data.readingMethod,'protocol');assert.equal(webCalls,0);assert.equal(timeout,2500);});
test('automatic reading falls back to standard sources if protocol cannot verify the list',async t=>{let webCalls=0;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{protocolReader:async()=>({verified:false,achievements:[{unlocked:null}]}),achievements:async()=>{webCalls++;return {verified:true,achievements:[{name:'Verified web result',unlocked:true}]};}});await f.login();await f.request('/api/status');f.app.states.get('a').connected=true;f.app.clients.set('a',new FakeUser({}));const result=await f.request('/api/achievements?accountId=a&appid=550&method=auto');assert.equal(result.response.status,200);assert.equal(result.data.readingMethod,'web');assert.equal(webCalls,1);assert.equal(result.data.achievements[0].unlocked,true);});
test('percentage lookup is private, selected-account scoped and cached without achievement writes',async t=>{let reads=0;const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]},{percentagesReader:async id=>{reads++;return {appid:id,percentages:{REAL:95}};}});const route='/api/achievement/percentages?accountId=a&appid=550';assert.equal((await f.request(route)).response.status,401);await f.login();assert.equal((await f.request('/api/achievement/percentages?appid=550')).response.status,400);assert.equal((await f.request(route)).data.percentages.REAL,95);assert.equal((await f.request(route)).response.status,200);assert.equal(reads,1);});
test('UTF-8 JSON split across request chunks preserves emoji in saved status',async t=>{const f=await fixture(t,{accounts:[{id:'a',name:'A',games:[]}]});const login=await f.login(),cookie=login.response.headers.get('set-cookie').split(';')[0],body=Buffer.from(JSON.stringify({accountId:'a',status:'Testing 😀'})),split=body.indexOf(Buffer.from('😀'))+2;const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(f.base+'/api/custom-status',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':login.data.csrf}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.write(body.subarray(0,split));setTimeout(()=>req.end(body.subarray(split)),5);});assert.equal(response,200);assert.equal(f.app.cfg.accounts[0].customStatus,'Testing 😀');});
test('sesiones cifradas sobreviven reinicio y detectan manipulación',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vault-test-'));try{const v=new Vault(dir);v.set('id','sensitive-token');assert.ok(!fs.readFileSync(v.file,'utf8').includes('sensitive-token'));assert.equal(new Vault(dir).get('id'),'sensitive-token');v.records.id.tag='00'.repeat(16);assert.throws(()=>v.get('id'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('lectura no inventa apiname, conserva 0% y estados desconocidos',()=>{
  const xml='<playerstats><achievements><achievement closed="0"><apiname>REAL</apiname><name>Real</name></achievement></achievements></playerstats>';
  assert.equal(parseXml(xml,{REAL:0})[0].percent,0);assert.equal(parseXml(xml)[0].unlocked,false);
  const list=parseHtml('<div class="achieveRow"><h3>Some title</h3><div class="achieveUnlockTime">Unlocked yesterday</div></div>',false);
  assert.equal(list[0].apiname,null);assert.equal(list[0].unlocked,null);
});
test('cromos: solo juegos con drops pendientes',()=>{
  const html='<div class="badge_row"><a class="badge_row_overlay" href="https://steamcommunity.com/my/gamecards/730/"></a><span class="progress_info_bold">3 card drops remaining</span></div>';
  assert.deepEqual(parseCards(html),[{appid:730,remaining:3}]);
});
test('API privada, cookie HttpOnly, CSRF, origen y logout',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/api/status')).response.status,401);
  const login=await f.login();assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await f.request('/api/status')).response.status,200);
  assert.equal((await f.request('/api/steam/login',{user:'owner',password:'x'},{csrf:false})).response.status,403);
  assert.equal((await f.request('/api/status',undefined,{headers:{Origin:'https://evil.example'}})).response.status,403);
  assert.equal((await f.request('/api/unknown')).response.status,404);
  await f.request('/api/panel/logout',{});assert.equal((await f.request('/api/status')).response.status,401);
});
test('login Steam Guard, persistencia sin contraseña, renovación y anticolisión',async t=>{
  const f=await fixture(t);await f.login();
  const start=await f.request('/api/steam/login',{user:'owner',password:'never-save-this',name:'Cuenta'});assert.equal(start.data.phase,'guard');
  const id=start.data.attemptId;assert.equal((await f.request('/api/steam/guard',{attemptId:id,code:'WRONG'})).response.status,400);
  const done=await f.request('/api/steam/guard',{attemptId:id,code:'ABCDE'});assert.equal(done.data.phase,'authenticated');const aid=done.data.accountId;
  const disk=fs.readFileSync(path.join(f.directory,'config.json'),'utf8');assert.ok(!disk.includes('never-save-this'));assert.ok(!disk.includes('refreshToken'));assert.equal(f.app.vault.get(aid),token());
  await f.request('/api/add',{accountId:aid,appid:730});assert.deepEqual(FakeUser.latest.calls.at(-1),[730]);
  FakeUser.latest.emit('playingState',true,730);assert.deepEqual(FakeUser.latest.calls.at(-1),[]);
  await f.request('/api/toggle',{accountId:aid});await f.request('/api/toggle',{accountId:aid});assert.deepEqual(FakeUser.latest.calls.at(-1),[]);
  FakeUser.latest.emit('playingState',false,0);assert.deepEqual(FakeUser.latest.calls.at(-1),[730]);
  FakeUser.latest.emit('refreshToken',token()+'new');assert.equal(f.app.vault.get(aid),token()+'new');
  const licenses=await f.request('/api/claim-free',{accountId:aid});assert.deepEqual(licenses.data.granted,{packages:[10],apps:[730]});
  await f.request('/api/steam/logout',{accountId:aid});assert.equal(f.app.vault.get(aid),null);
});
test('selección explícita multicuenta, rechazo de escritura de logros y entradas inválidas',async t=>{
  const accounts=['a','b'].map(id=>({id,name:id,user:id,games:[],gameNames:{},sleepMode:{enabled:false,start:3,end:8}}));
  const f=await fixture(t,{accounts});await f.login();
  assert.equal((await f.request('/api/add',{appid:730})).response.status,400);
  await f.request('/api/add',{accountId:'b',appid:730});assert.deepEqual(f.app.cfg.accounts[0].games,[]);assert.deepEqual(f.app.cfg.accounts[1].games,[730]);
  assert.equal((await f.request('/api/add',{accountId:'a',appid:-1})).response.status,400);
  for(const route of ['/api/unlock-batch','/api/lock-batch','/api/queue-achievements'])assert.equal((await f.request(route,{accountId:'a',appid:730,items:[]})).response.status,501);
  const result=await f.request('/api/achievements?accountId=a&appid=730');assert.equal(result.data.achievements[0].unlocked,false);
  await f.request('/api/set-sleep',{accountId:'a',enabled:true,start:0,end:8});assert.equal(f.app.cfg.accounts[0].sleepMode.start,0);
  await f.request('/api/set-sleep',{accountId:'a',enabled:false,start:0,end:8});assert.equal(f.app.states.get('a').isSleepPaused,false);
  assert.equal((await f.request('/api/set-webhook',{webhook:'https://evil.example/api/webhooks/1/token'})).response.status,400);
});
test('login móvil asíncrono y cancelación impiden guardar una sesión tardía',async t=>{
  const f=await fixture(t);await f.login();const start=await f.request('/api/steam/login',{user:'owner',password:'pw'});
  const login=FakeLogin.latest;await f.request('/api/steam/cancel',{attemptId:start.data.attemptId});login.emit('authenticated');assert.equal(f.app.cfg.accounts.length,0);
  const next=await f.request('/api/steam/login',{user:'owner',password:'pw'});FakeLogin.latest.emit('authenticated');
  const status=await f.request('/api/steam/login-status?attemptId='+next.data.attemptId);assert.equal(status.data.phase,'authenticated');
});
test('límite de intentos del panel',async t=>{const f=await fixture(t);for(let i=0;i<5;i++)assert.equal((await f.request('/api/panel/login',{password:'bad'})).response.status,401);assert.equal((await f.request('/api/panel/login',{password:'bad'})).response.status,429);});
test('migración elimina secretos y marcas locales, conserva lista de juegos',async t=>{
  const f=await fixture(t,{user:'owner',pass:'old-password',refreshToken:token(),webPin:'1234',games:[730],unlockedAchievements:{730:['FAKE']},achievementQueue:[{apiname:'FAKE'}]});
  const disk=fs.readFileSync(path.join(f.directory,'config.json'),'utf8');
  for(const secret of ['old-password','refreshToken','webPin','FAKE','unlockedAchievements','achievementQueue'])assert.ok(!disk.includes(secret));
  assert.deepEqual(f.app.cfg.accounts[0].games,[730]);assert.equal(f.app.vault.get(f.app.cfg.accounts[0].id),token());
});
test('health público para Render/UptimeRobot sin revelar datos',async t=>{
  const f=await fixture(t);
  const r=await f.request('/healthz',undefined,{auth:false,headers:{Host:'internal-render-host'}});
  assert.equal(r.response.status,200);assert.deepEqual(r.data,{ok:true});
  const head=await fetch(f.base+'/healthz',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await f.request('/api/status',undefined,{auth:false})).response.status,401);
});
test('Render origen automático, Secure cookie y CSRF detrás del proxy',async t=>{
  const old=process.env.RENDER_EXTERNAL_URL;process.env.RENDER_EXTERNAL_URL='https://steamfarmer-test.onrender.com';
  let f;try{f=await fixture(t);}finally{if(old===undefined)delete process.env.RENDER_EXTERNAL_URL;else process.env.RENDER_EXTERNAL_URL=old;}
  const result=await f.request('/api/panel/login',{password:PASSWORD},{headers:{Origin:'https://steamfarmer-test.onrender.com'}});
  assert.equal(result.response.status,200);assert.match(result.response.headers.get('set-cookie'),/Secure/);
  assert.equal((await f.request('/api/panel/login',{password:PASSWORD},{headers:{Origin:'https://different.example'}})).response.status,403);
});
test('token privado de Render sobrevive recreación de datos sin renovación ni publicación',async t=>{
  const savedToken=token(), previous=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=savedToken;
  let f;try{f=await fixture(t,{}, {connect:true});}finally{if(previous===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=previous;}
  await f.login();assert.equal(FakeUser.latest.options.renewRefreshTokens,false);assert.equal(FakeUser.latest.details.refreshToken,savedToken);FakeUser.latest.emit('refreshToken','unexpected-new-token');assert.equal(f.app.vault.get('main'),null);const status=await f.request('/api/status');assert.equal(status.data.accounts[0].tokenSource,'environment');
  assert.ok(!JSON.stringify(status.data).includes(savedToken));
  assert.ok(!fs.readFileSync(path.join(f.directory,'config.json'),'utf8').includes(savedToken));
  assert.equal((await f.request('/api/steam/login',{accountId:'main',user:'owner',password:'pw'})).response.status,409);
  assert.equal((await f.request('/api/steam/logout',{accountId:'main'})).response.status,409);
  assert.equal((await f.request('/api/account/remove',{accountId:'main'})).response.status,409);
});
test('entrada desde ChatGPT permite el panel público pero rechaza API y POST externos',async t=>{
  const f=await fixture(t);const headers={'Sec-Fetch-Site':'cross-site',Origin:'https://chatgpt.com'};
  const root=await fetch(f.base+'/',{headers});assert.equal(root.status,200);assert.match(await root.text(),/\/app.js/);
  assert.equal((await fetch(f.base+'/app.js',{headers})).status,200);
  assert.equal((await fetch(f.base+'/manifest.json',{headers})).status,200);
  await f.login();assert.equal((await f.request('/api/status',undefined,{headers})).response.status,403);
  assert.equal((await f.request('/api/panel/login',{password:PASSWORD},{headers})).response.status,403);
  assert.equal((await f.request('/api/add',{accountId:'main',appid:730},{headers})).response.status,403);
  const badHost = await new Promise(resolve => require('node:http').get(f.base+'/', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }));
  assert.equal(badHost,403);
});
test('caché de logros por cuenta y actualización manual real',async t=>{
  let calls=0;const account={id:'a',name:'a',user:'a',games:[240],gameNames:{},sleepMode:{enabled:false,start:3,end:8}};
  const f=await fixture(t,{accounts:[account]},{achievements:async()=>{calls++;return{achievements:[{name:'One',unlocked:false}],checkedAt:new Date().toISOString()};}});await f.login();
  await f.request('/api/achievements?accountId=a&appid=240');await f.request('/api/achievements?accountId=a&appid=240');assert.equal(calls,1);
  await f.request('/api/achievements?accountId=a&appid=240&refresh=1');assert.equal(calls,2);
});
test('connection status confirms token account, persona and web session without returning cookies',async t=>{
  const f=await fixture(t);await f.login();const login=await f.request('/api/steam/login',{user:'owner',password:'pw'});const done=await f.request('/api/steam/guard',{attemptId:login.data.attemptId,code:'ABCDE'});
  FakeUser.latest.emit('accountInfo','Steam profile name');FakeUser.latest.emit('webSession','sid',['steamLoginSecure=SECRET; Path=/','sessionid=SECRET2']);
  const result=await f.request('/api/status');const a=result.data.accounts.find(a=>a.id===done.data.accountId);
  assert.equal(a.connected,true);assert.equal(a.tokenAccountMatches,true);assert.equal(a.webSessionReady,true);assert.equal(a.linkedSteamId,'76561198000000001');assert.equal(a.profileName,'Steam profile name');assert.ok(!JSON.stringify(result.data).includes('SECRET'));
  assert.equal((await f.request('/api/steam/web-session',{accountId:a.id})).response.status,200);
});
test('public static assets support conditional caching while private APIs stay uncached', async t => {
  const f = await fixture(t);
  const first = await fetch(f.base + '/app.js'); assert.equal(first.status, 200);
  const tag = first.headers.get('etag'); assert.ok(tag); assert.match(first.headers.get('cache-control'), /must-revalidate/);
  const second = await fetch(f.base + '/app.js', { headers: { 'If-None-Match': tag } });
  assert.equal(second.status, 304); assert.equal(await second.text(), '');
  await f.login(); const status = await f.request('/api/status'); assert.equal(status.response.headers.get('cache-control'), 'no-store');
});
test('direct verification requires a connected account and stays separate from web cache',async t=>{
  let calls=0;const f=await fixture(t,{accounts:[{id:'a',name:'Main',games:[]}]},{protocolReader:async()=>{calls++;return {achievements:[{name:'Native',unlocked:true}],verified:true,source:'Steam client protocol'};}});await f.login();
  const route='/api/achievements?accountId=a&appid=550&method=protocol';assert.equal((await f.request(route)).response.status,409);
  f.app.states.get('a').connected=true;
  assert.equal((await f.request(route)).data.source,'Steam client protocol');await f.request(route);assert.equal(calls,1);
  assert.equal((await f.request('/api/achievements?accountId=a&appid=550')).data.achievements[0].apiname,'REAL');
  assert.equal((await f.request('/api/achievements?accountId=a&appid=550&method=unknown')).response.status,400);
  const css=await fetch(f.base+'/style.css',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
});
test('single achievement experiment requires auth, CSRF, exact target and the verified main account',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();
  let calls=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{experimentWriter:async(_,options)=>{calls++;await options.beforeSend({appid:3764200,apiname:'MODEL_API',name:'Model Mania',before:false});return {outcome:'confirmed',appid:3764200,apiname:'MODEL_API',after:true};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const body={accountId:'main',appid:3764200,name:'Model Mania',apiname:'MODEL_API'};
  assert.equal((await f.request('/api/achievement-experiment',body,{auth:false})).response.status,401);
  await f.login();assert.equal((await f.request('/api/achievement-experiment',body,{csrf:false})).response.status,403);
  await f.request('/api/status');const st=f.app.states.get('main');st.connected=true;st.tokenAccountMatches=true;st.steamId64='76561198000000001';f.app.clients.set('main',new FakeUser({}));
  assert.equal((await f.request('/api/achievement-experiment',{...body,appid:550})).response.status,400);assert.equal(calls,0);
  const first=await f.request('/api/achievement-experiment',body);assert.equal(first.data.outcome,'confirmed');assert.equal(calls,1);
  assert.equal((await f.request('/api/achievement-experiment',body)).response.status,409);
  assert.equal(f.app.cfg.achievementExperiments['76561198000000001:3764200'].outcome,'confirmed');
});
test('individual unlock API preserves authentication, one-target validation, journal and cooldown',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let calls=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{individualWriter:async(_,id,apiname,options)=>{
    calls++;await options.beforeSend({appid:id,apiname,name:'Chosen',before:false});return {appid:id,apiname,outcome:'confirmed',after:true};
  },protocolReader:async()=>({achievements:[{apiname:'FIRST',unlocked:true,compatibility:{status:'provisional',canUnlock:false}}],verified:true})});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const body={accountId:'main',appid:550,apiname:'FIRST'};
  assert.equal((await f.request('/api/achievement/unlock',body,{auth:false})).response.status,401);await f.login();
  assert.equal((await f.request('/api/achievement/unlock',body,{csrf:false})).response.status,403);
  await f.request('/api/status');const st=f.app.states.get('main');Object.assign(st,{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  assert.equal((await f.request('/api/achievement/unlock',{...body,achievements:['FIRST','SECOND']})).response.status,400);assert.equal(calls,0);
  assert.equal((await f.request('/api/achievement/unlock',body)).data.outcome,'confirmed');
  assert.equal((await f.request('/api/achievement/unlock',body)).response.status,409);
  assert.equal((await f.request('/api/achievement/unlock',{...body,apiname:'SECOND'})).response.status,429);
  assert.ok(!f.app.cfg.achievementWrites['76561198000000001:550:SECOND']);
  const view=await f.request('/api/achievements?accountId=main&appid=550&method=protocol');assert.equal(view.data.achievements[0].compatibility.validatedOnAccount,true);
});
test('progress preview is authenticated and read-only; activation requires its revision and keeps the journal',async t=>{
  function kv(obj){const p=[];for(const[k,v]of Object.entries(obj))p.push(Buffer.from([typeof v==='object'?0:1]),Buffer.from(k+'\0'),typeof v==='object'?kv(v):Buffer.from(String(v)+'\0'));p.push(Buffer.from([8]));return Buffer.concat(p);}
  const snapshot={eresult:1,game_id:'550',crc_stats:12,schema:kv({'550':{stats:{'7':{type:'4',bits:{'0':{name:'TARGET',progress:{max_val:'1',value:{operation:'statvalue',operand1:'COUNT'}}}}},'9':{type:'INT',name:'COUNT'}}}}),stats:[{stat_id:7,stat_value:0},{stat_id:9,stat_value:0}]};
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0,received;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{progressSnapshotReader:async()=>snapshot,individualWriter:async(_,id,apiname,options)=>{writes++;received=options;await options.beforeSend({appid:id,apiname,progressChanges:[{statName:'COUNT',before:0,after:1}]});return {outcome:'confirmed',after:true};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const route='/api/achievement/progress-preview?accountId=main&appid=550&apiname=TARGET';assert.equal((await f.request(route)).response.status,401);await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const preview=await f.request(route);assert.equal(preview.response.status,200);assert.equal(preview.data.progressChanges[0].after,1);assert.equal(writes,0);const body={accountId:'main',appid:550,apiname:'TARGET',mode:'progress'};
  assert.equal((await f.request('/api/achievement/unlock',body)).response.status,400);assert.equal(writes,0);
  assert.equal((await f.request('/api/achievement/unlock',{...body,revision:preview.data.revision})).response.status,200);assert.equal(received.allowProgress,true);assert.equal(received.expectedRevision,preview.data.revision);assert.equal(writes,1);assert.equal((await f.request(route)).response.status,409);
});
test('post-reconnect persistence check reads Model Mania and sends no achievement write',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0;
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[550],gameNames:{550:'L4D2'}}]},{connect:true,startupDiagnostics:true,protocolReader:async(_,id)=>({achievements:id===3764200?[{apiname:'46',name:'Model Mania',unlocked:true}]:[],verified:true,diagnostics:{serverControlled:0}})});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  const c=f.app.clients.get('main');c._send=()=>writes++;c.emit('webSession','unused',['sessionid=private']);await new Promise(resolve=>setImmediate(resolve));await f.login();
  const status=await f.request('/api/status');assert.equal(status.data.achievementPersistence.unlocked,true);assert.equal(status.data.achievementPersistence.afterReconnect,true);assert.equal(writes,0);
});
test('game requirements are authenticated, cached, and protocol errors preserve diagnostic actions',async t=>{
  let calls=0;const f=await fixture(t,{accounts:[{id:'a',name:'Main',games:[]}]},{requirementsReader:async id=>{calls++;return {appid:id,facts:['Requires publisher account'],externalAccountOrSoftware:true};},protocolReader:async()=>{throw Object.assign(new Error('No usable definitions'),{status:502,diagnostic:{code:'schema_unavailable',action:'Try the standard reading'}});}});
  assert.equal((await f.request('/api/game-requirements?appid=123')).response.status,401);await f.login();
  assert.equal((await f.request('/api/game-requirements?appid=123')).data.externalAccountOrSoftware,true);await f.request('/api/game-requirements?appid=123');assert.equal(calls,1);
  await f.request('/api/status');f.app.states.get('a').connected=true;
  const result=await f.request('/api/achievements?accountId=a&appid=123&method=protocol');assert.equal(result.response.status,502);assert.equal(result.data.diagnostic.code,'schema_unavailable');assert.equal(result.data.diagnostic.action,'Try the standard reading');
});
test('history is authenticated, scoped to the selected account and reports local storage honestly',async t=>{
  const owner='76561198000000001',other='76561198000000002';const f=await fixture(t,{accounts:[{id:'a',name:'Main',mySteamID:owner,games:[]}],achievementWrites:{[owner+':550:ONE']:{apiname:'ONE',name:'Owned receipt',outcome:'requested'},[other+':550:PRIVATE']:{apiname:'PRIVATE',name:'Other receipt',outcome:'requested'}}});
  assert.equal((await f.request('/api/achievement/history?accountId=a')).response.status,401);await f.login();const result=await f.request('/api/achievement/history?accountId=a&steamid='+other);assert.equal(result.data.storage.persistent,false);assert.equal(result.data.entries.length,1);assert.equal(result.data.entries[0].apiname,'ONE');assert.equal((await f.request('/api/achievement/history?accountId=a&before=bad')).response.status,400);
});
test('unavailable persistent history does not hide real Steam states and blocks writes before transport',async t=>{
  const prev=process.env.STEAM_REFRESH_TOKEN;process.env.STEAM_REFRESH_TOKEN=token();let writes=0;
  const unavailable=()=>{throw Object.assign(new Error('Persistent history unavailable'),{status:503});};
  const journal={ready:async()=>{},status:()=>({persistent:true,available:false}),get:async()=>unavailable(),forGame:async()=>unavailable(),reserve:async()=>unavailable(),finish:async()=>{},close:async()=>{}};
  let f;try{f=await fixture(t,{accounts:[{id:'main',name:'Main',games:[]}]},{achievementJournal:journal,protocolReader:async()=>({achievements:[{apiname:'ONE',unlocked:false,compatibility:{status:'provisional',canUnlock:true}}],verified:true}),individualWriter:async(_,id,name,options)=>{await options.beforeSend({appid:id,apiname:name});writes++;return {outcome:'confirmed'};}});}finally{if(prev===undefined)delete process.env.STEAM_REFRESH_TOKEN;else process.env.STEAM_REFRESH_TOKEN=prev;}
  await f.login();await f.request('/api/status');Object.assign(f.app.states.get('main'),{connected:true,tokenAccountMatches:true,steamId64:'76561198000000001'});f.app.clients.set('main',new FakeUser({}));
  const view=await f.request('/api/achievements?accountId=main&appid=550&method=protocol');assert.equal(view.response.status,200);assert.equal(view.data.achievements[0].unlocked,false);assert.equal(view.data.achievements[0].compatibility.canUnlock,false);assert.equal((await f.request('/api/achievement/unlock',{accountId:'main',appid:550,apiname:'ONE'})).response.status,503);assert.equal(writes,0);
});
