'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {achievements,parseXml,parseHtml}=require('../lib/steam-data');
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
  assert.equal(called.length,5);release();const result=await pending;
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
  await assert.rejects(achievements({}, {steamId64:sid},240,'',async()=>{throw Error('timeout');}),e=>e.status===502 && e.message.includes('No significa'));
});
test('ficha Steam que no declara logros se distingue de error de consulta',async()=>{
  const request=async(url)=>{if(url.includes('appdetails'))return source('',url,JSON.stringify({1118310:{success:true,data:{categories:[{id:2}]}}}));throw Error('unavailable');};
  const result=await achievements({}, {},1118310,'',request);assert.equal(result.outcome,'unsupported');assert.deepEqual(result.achievements,[]);
});
test('XML sin atributo closed se mantiene sin verificar',()=>{
  const xml='<playerstats><achievements><achievement><apiname>REAL</apiname><name>One</name></achievement></achievements></playerstats>';
  assert.equal(parseXml(xml)[0].unlocked,null);
});
test('unlocked por icono real de Steam y 0% se conservan',()=>{
  const rows=parseHtml(row('One','<div class="achieveImgHolderUnlocked"></div>'),true);assert.equal(rows[0].unlocked,true);assert.equal(rows[0].percent,0);
});
