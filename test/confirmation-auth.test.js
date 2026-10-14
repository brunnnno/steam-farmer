'use strict';
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
