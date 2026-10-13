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
function token() { return `test.${Buffer.from(JSON.stringify({iss:'steam',sub:'76561198000000001',aud:['client','web'],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`; }
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
