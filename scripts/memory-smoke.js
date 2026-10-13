'use strict';
// Local-only synthetic load: no Steam credentials, no external writes, no live database.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {createApp}=require('../bot');const {atomicWrite}=require('../lib/core');const {achievements}=require('../lib/steam-data');
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'steam-memory-smoke-'));let app;
  const old={token:process.env.STEAM_REFRESH_TOKEN,password:process.env.PANEL_PASSWORD,db:process.env.ACHIEVEMENT_DATABASE_URL};
  delete process.env.STEAM_REFRESH_TOKEN;delete process.env.ACHIEVEMENT_DATABASE_URL;process.env.PANEL_PASSWORD='synthetic-memory-test-password';
  let peak=0,reads=0;const sample=()=>peak=Math.max(peak,process.memoryUsage.rss());const sampler=setInterval(sample,5);
  try{
    atomicWrite(path.join(dir,'config.json'),{accounts:[{id:'test',name:'Synthetic',games:[],mySteamID:'76561198000000001'}],timezone:'America/Montevideo'});
    const html=Array.from({length:1400},(_,i)=>'<div class="achieveRow"><h3>Achievement '+i+'</h3><h5>'+('Synthetic description '.repeat(8))+'</h5><div class="achievePercent">25.0%</div></div>').join('');
    app=createApp({directory:dir,silent:true,connect:false,achievements:async(acc,st,id)=>{reads++;return achievements(acc,st,id,'',async url=>{await new Promise(r=>setTimeout(r,10));sample();if(url.includes('GetGlobal'))return {body:'{}',finalUrl:url};if(url.includes('appdetails'))return {body:'{}',finalUrl:url};if(url.includes('xml=1'))return {body:'<error/>',finalUrl:url};return {body:html,finalUrl:url};});}});
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
    const login=await fetch(base+'/api/panel/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.PANEL_PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0];await login.json();
    let rejected=0,success=0;
    for(let batch=0;batch<8;batch++){const results=await Promise.all(Array.from({length:8},async(_,i)=>{const r=await fetch(base+'/api/achievements?accountId=test&appid='+(240+i)+'&refresh=1',{headers:{Cookie:cookie}});await r.json();return r.status;}));for(const status of results){if(status===429)rejected++;else if(status===200)success++;else throw Error('Unexpected status '+status);}sample();}
    console.log(JSON.stringify({mode:'local synthetic HTML stress; not a live Steam load test',requests:64,accepted:success,busyResponses:rejected,upstreamReads:reads,peakRssMiB:Number((peak/1048576).toFixed(1)),heapLimitMiB:Math.round(require('node:v8').getHeapStatistics().heap_size_limit/1048576),writesSent:0}));
    if(peak>=400*1048576)throw Error('Synthetic memory peak exceeds target headroom');
  }finally{clearInterval(sampler);await app?.close();for(const [env,value]of [['STEAM_REFRESH_TOKEN',old.token],['PANEL_PASSWORD',old.password],['ACHIEVEMENT_DATABASE_URL',old.db]])if(value===undefined)delete process.env[env];else process.env[env]=value;fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
