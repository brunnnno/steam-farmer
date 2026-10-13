'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
function ui(t, responder) {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),{url:'https://panel.example',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.AbortSignal=AbortSignal;w.intervals=[];w.setInterval=(callback,delay)=>{w.intervals.push({callback,delay});return w.intervals.length;};
  w.fetch=async(url)=>url==='/api/panel/session'?new Promise(()=>{}):({ok:true,status:200,json:async()=>responder(url)});
  w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8')+`\nwindow.testUI={load:loadStatus,authenticate:()=>{csrf='test';},open:openAchModal,close:closeAchModal,filter:setFilter,search:onSearchInput,refresh:forceRefreshAchievements,select:id=>{activeAccountId=id;},activate:a=>{active=a;},unlock:unlockIndividualAchievement};`);
  w.testUI.select('a');return w;
}
const response=rows=>({achievements:rows,source:'Steam test',checkedAt:new Date().toISOString()});
test('cambiar de juego limpia filtros y búsquedas que ocultaban logros',async t=>{
  const w=ui(t,()=>response([{name:'First',description:'',unlocked:false,percent:25}]));
  await w.testUI.open(240,'One');w.testUI.search('nothing');assert.equal(w.document.querySelectorAll('.ach-item').length,0);
  w.testUI.filter('status','unlocked');await w.testUI.open(550,'Two');assert.equal(w.document.querySelectorAll('.ach-item').length,1);assert.equal(w.document.getElementById('achSearchInput').value,'');
});
test('Actualización manual evita caché y no arrastra respuestas de otros juegos',async t=>{
  const urls=[];const w=ui(t,url=>{urls.push(url);return response([{name:'One',unlocked:false,percent:null}]);});
  await w.testUI.open(240,'One');w.testUI.search('One');await w.testUI.refresh();assert.ok(urls.at(-1).includes('refresh=1'));assert.equal(w.document.querySelectorAll('.ach-item').length,1);
});
test('normaliza rareza ausente o texto y conserva estado sin verificar',async t=>{
  const w=ui(t,()=>response([{name:'Unknown',unlocked:null},{name:'String percent',unlocked:false,percent:'0.0'}]));await w.testUI.open(240,'One');
  assert.equal(w.document.querySelectorAll('.ach-item').length,2);assert.match(w.document.getElementById('achListContainer').textContent,/Unknown rarity/);assert.match(w.document.getElementById('achListContainer').textContent,/0.0%/);assert.match(w.document.getElementById('achProgressText').textContent,/1 not verified/);
});
test('modal permite cerrar con Escape y restaura scroll del documento',async t=>{
  const w=ui(t,()=>response(Array.from({length:200},(_,i)=>({name:`Achievement ${i}`,unlocked:false,percent:null}))));await w.testUI.open(240,'Many');assert.equal(w.document.querySelectorAll('.ach-item').length,200);assert.ok(w.document.body.classList.contains('achievement-open'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(w.document.getElementById('achModal').style.display,'none');assert.ok(!w.document.body.classList.contains('achievement-open'));
});
test('respuesta lenta anterior no reemplaza el juego recién abierto',async t=>{
  let release;const w=ui(t,url=>url.includes('appid=240')?new Promise(r=>release=r):response([{name:'New game',unlocked:false,percent:null}]));
  const old=w.testUI.open(240,'Old');await w.testUI.open(550,'New');release(response([{name:'Stale',unlocked:false,percent:null}]));await old;assert.equal(w.document.querySelector('.ach-title').textContent,'New game');
});
test('catalog with only unknown personal states does not claim zero unlocked achievements',async t=>{
  const w=ui(t,()=>response([{name:'One',unlocked:null,percent:null}]));await w.testUI.open(550,'Left 4 Dead 2');assert.match(w.document.getElementById('achProgressText').textContent,/Personal state not verified/);assert.doesNotMatch(w.document.getElementById('achProgressText').textContent,/0\/1/);
});
test('built-in panel options and messages are in English',()=>{
  const root=path.join(__dirname,'../public');for(const file of ['index.html','app.js']){const content=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(content,/Horas estimadas|no verificadas|Sin verificar|Pausado|Contraseña|desbloqueados|Cromos|Reanudar|Catálogo|Ingresá|Guardar|Cuenta principal/);}
});
test('polling skips hidden tabs and unchanged game cards keep their DOM nodes', async t => {
  let requests=0;
  const w=ui(t,()=>{requests++;return {accounts:[{id:'a',name:'Main',games:[550],gameNames:{550:'Left 4 Dead 2'},cardDropGames:[],sleepMode:{enabled:false,start:3,end:8}}],presets:[],timezone:'UTC'};});
  w.testUI.authenticate(); await w.testUI.load();
  const first=w.document.querySelector('#gamesGrid .card'); assert.ok(first);
  const poll=w.intervals.find(i=>i.delay===10000); assert.ok(poll);
  Object.defineProperty(w.document,'hidden',{configurable:true,value:true}); await poll.callback(); assert.equal(requests,1);
  Object.defineProperty(w.document,'hidden',{configurable:true,value:false}); await poll.callback();
  assert.equal(requests,2); assert.equal(w.document.querySelector('#gamesGrid .card'),first);
});
test('direct verification uses the protocol endpoint and preserves it when refreshing',async t=>{
  const urls=[];const w=ui(t,url=>{urls.push(url);return response([{name:'Direct',unlocked:true,serverControlled:true}]);});
  await w.testUI.open(550,'Left 4 Dead 2',true,'protocol');assert.ok(urls.at(-1).includes('method=protocol'));
  await w.testUI.refresh();assert.ok(urls.at(-1).includes('method=protocol'));assert.match(w.document.getElementById('achListContainer').textContent,/Server-controlled/);
});

test('individual activation requires direct reading, eligible schema and the main account',async t=>{
  const target={name:'Any achievement',description:'A description',apiname:'REAL',unlocked:false,compatibility:{status:'provisional',canUnlock:true,reason:'Provisional'}};
  const w=ui(t,()=>response([target]));w.testUI.activate({tokenSource:'environment'});
  await w.testUI.open(550,'A game');assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/Unlock achievement/);
  await w.testUI.open(550,'A game',true,'protocol');assert.match(w.document.getElementById('achListContainer').textContent,/Unlock achievement/);assert.match(w.document.getElementById('achListContainer').textContent,/Provisional compatibility/);
  w.testUI.activate({tokenSource:'local'});await w.testUI.refresh();assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/Unlock achievement/);
  w.testUI.activate({tokenSource:'environment'});target.compatibility={status:'dependency',canUnlock:false,reason:'Progress stat'};await w.testUI.refresh();assert.equal(w.document.querySelector('.ach-info button').disabled,true);assert.match(w.document.getElementById('achListContainer').textContent,/Progress stat/);
});
test('cancelling individual activation sends no write request',async t=>{
  const urls=[];const target={name:'One',apiname:'ONE',unlocked:false,compatibility:{status:'provisional',canUnlock:true}};
  const w=ui(t,url=>{urls.push(url);return response([target]);});w.testUI.activate({tokenSource:'environment'});w.confirm=()=>false;
  await w.testUI.open(550,'Game',true,'protocol');await w.testUI.unlock(target);assert.ok(!urls.includes('/api/achievement/unlock'));
});
test('individual activation submits only the chosen account, game and API name',async t=>{
  const target={name:'One',apiname:'FIRST',unlocked:false,compatibility:{status:'provisional',canUnlock:true}};
  const w=ui(t,()=>response([target]));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment'});w.confirm=()=>true;
  await w.testUI.open(550,'Game',true,'protocol');let submitted;
  w.fetch=async(url,options)=>{if(url==='/api/achievement/unlock'){submitted=JSON.parse(options.body);return {ok:true,json:async()=>({outcome:'unknown',message:'Not confirmed'})};}return {ok:true,json:async()=>response([target])};};
  await w.testUI.unlock(target);assert.deepEqual(submitted,{accountId:'a',appid:550,apiname:'FIRST'});assert.equal(w.document.querySelector('.ach-item').textContent.includes('Locked'),true);
});
test('publisher requirements show explanatory context as text without inventing an activation restriction',async t=>{
  const w=ui(t,url=>url.startsWith('/api/game-requirements')?{facts:['<b>Publisher account</b>'],explanation:'An external launcher alone does not establish writability.',action:'Check the official game.',metadataAvailable:true,externalAccountOrSoftware:true,sourceUrl:'https://store.steampowered.com/app/123/'}:response([{name:'One',unlocked:false}]));
  await w.testUI.open(123,'Game');await new Promise(resolve=>setImmediate(resolve));
  const context=w.document.getElementById('gameRequirements');assert.equal(context.hidden,false);assert.equal(context.open,true);assert.match(context.textContent,/does not establish/);assert.equal(context.querySelector('b'),null);
});
