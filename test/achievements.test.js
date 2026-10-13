'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {achievements,parseXml,parseHtml,remote}=require('../lib/steam-data');
const sid='76561198000000001';
const row=(name,extra='')=>`<div class="achieveRow"><img src="https://example.test/icon.png"><h3>${name}</h3><h5>Description</h5>${extra}<div class="achievePercent">0.0%</div></div>`;
function source(name,url,body){return {body,finalUrl:url};}
test('fuentes paralelas toleran API caída y enriquecen HTML personal con rareza global',async()=>{
  const called=[];let release;const gate=new Promise(r=>release=r);
  const request=async(url,options)=>{called.push(url);assert.equal(options.timeoutMs,12000);await gate;
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
