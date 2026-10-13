'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
function ui(t, responder) {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),{url:'https://panel.example',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.AbortSignal=AbortSignal;w.intervals=[];w.setInterval=(callback,delay)=>{w.intervals.push({callback,delay});return w.intervals.length;};
  w.fetch=async(url)=>url==='/api/panel/session'?new Promise(()=>{}):({ok:true,status:200,json:async()=>responder(url)});
  w.eval(fs.readFileSync(path.join(__dirname,'../public/achievement-availability.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8')+`\nwindow.testUI={load:loadStatus,authenticate:()=>{csrf='test';},open:openAchModal,close:closeAchModal,filter:setFilter,search:onSearchInput,refresh:forceRefreshAchievements,select:id=>{activeAccountId=id;},activate:a=>{active=a;},unlock:unlockIndividualAchievement,completeProgress:completeAchievementProgress,reviewShared:reviewSharedProgress,history:refreshWriteHistory};`);
  w.testUI.select('a');return w;
}
const response=rows=>({achievements:rows,source:'Steam test',checkedAt:new Date().toISOString()});
test('game banners use bounded alternate sources and a designed placeholder after exhaustion',async t=>{
  const account={id:'a',name:'Main',games:[550],gameNames:{550:'Left 4 Dead 2'},connected:true,tokenSource:'environment',cardDropGames:[],sleepMode:{}};
  const w=ui(t,()=>({accounts:[account],presets:[],timezone:'UTC'}));w.testUI.authenticate();await w.testUI.load();const img=w.document.querySelector('.card-banner');
  assert.match(img.src,/store_item_assets.*header.jpg/);img.dispatchEvent(new w.Event('error'));assert.match(img.src,/cdn.akamai.*header.jpg/);assert.equal(img.hidden,false);
  img.dispatchEvent(new w.Event('error'));assert.match(img.src,/library_hero.jpg/);img.dispatchEvent(new w.Event('error'));assert.equal(img.hidden,true);const last=img.src;img.dispatchEvent(new w.Event('error'));assert.equal(img.src,last);
  assert.match(w.document.querySelector('.game-art-placeholder').textContent,/Left 4 Dead 2/);assert.equal(w.document.querySelector('.game-art').querySelectorAll('img').length,1);
});
test('reading alternatives stay in a closed options menu and selection still requests direct verification',async t=>{
  const calls=[],w=ui(t,url=>{calls.push(url);return response([{name:'Real',unlocked:false}]);});await w.testUI.open(550,'Game',false,'auto');
  const menu=w.document.getElementById('achReadingOptions'),select=w.document.getElementById('achReadMode');assert.equal(menu.open,false);assert.equal(select.closest('details'),menu);assert.equal(select.value,'auto');
  assert.ok(w.document.querySelector('.ach-header [data-event-4]'));assert.ok(w.document.querySelector('.ach-header [data-event-5]'));
  menu.open=true;select.value='protocol';select.dispatchEvent(new w.Event('change'));await new Promise(r=>setImmediate(r));assert.equal(menu.open,false);assert.ok(calls.some(url=>url.includes('method=protocol')));
});
test('Steam date and panel operation time stay distinct without replacing old Steam metadata',async t=>{
  const row={name:'Doctor',unlocked:true,unlockTimestamp:1643673600,panelOperationAt:'2026-10-13T19:25:50.878Z',lastWriteOutcome:'confirmed',compatibility:{status:'dependency'}};
  const w=ui(t,()=>response([row]));await w.testUI.open(440,'TF2',false,'protocol');const text=w.document.getElementById('achListContainer').textContent;
  assert.match(text,/Steam-reported unlock date:.*2022/);assert.match(text,/Panel operation recorded:.*2026/);assert.match(text,/predates this panel operation/);
  assert.match(w.document.querySelector('.ach-availability').textContent,/Confirmed on this account/);
});
test('shared review cards distinguish planned unlock from locked progress and use accurate accessible bars',async t=>{
  const row={name:'Doctor',apiname:'DOCTOR',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewShared:true}};
  const preview={appid:440,apiname:'DOCTOR',canActivate:true,revision:'a'.repeat(64),counter:{statName:'HEALED',before:0,after:25000},effects:[{name:'Doctor',apiname:'DOCTOR',before:0,after:25000,goal:25000,effect:'would_unlock'},{name:'Chief',apiname:'CHIEF',before:0,after:25000,goal:1000000,effect:'progress_only'}],message:'Reviewed.'};
  const w=ui(t,url=>url.includes('shared-progress-preview')?preview:response([row]));w.testUI.activate({tokenSource:'environment'});await w.testUI.open(440,'TF2',false,'protocol');await w.testUI.reviewShared(row);
  assert.equal(w.document.querySelectorAll('.shared-effect-card').length,2);assert.match(w.document.querySelector('.shared-effect-card.progress_only').textContent,/Stays locked.*25,000 \/ 1,000,000 · 2.5%/);
  const bar=w.document.querySelector('.shared-effect-card.progress_only [role="progressbar"]');assert.equal(bar.getAttribute('aria-valuenow'),'25000');assert.equal(bar.getAttribute('aria-valuemax'),'1000000');assert.equal(bar.firstChild.style.width,'2.5%');
  assert.ok(w.document.querySelector('#sharedProgressActions .shared-confirm'));assert.equal(w.document.querySelector('#sharedProgressEffects button'),null);
});
test('rarity buttons fetch missing direct-read percentages once and use the latest selected tier',async t=>{
  const calls=[],rows=['Zero','Epic','Epic upper','Rare','Rare upper','Common','Unknown'].map((name,i)=>({apiname:'A'+i,name,unlocked:i===0,percent:null}));
  let resolveLookup;const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const w=ui(t,url=>{calls.push(url);return url.includes('/percentages?')?lookup:response(rows);});await w.testUI.open(440,'TF2',false,'protocol');
  w.document.querySelector('[data-val="epic"]').click();assert.match(w.document.getElementById('achListContainer').textContent,/Loading rarity/);
  w.document.querySelector('[data-val="rare"]').click();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(url=>url.includes('/percentages?')).length,1);
  resolveLookup({percentages:{A0:0,A1:5,A2:14.999,A3:15,A4:39.999,A5:40}});await new Promise(r=>setImmediate(r));
  const names=()=>[...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent);
  assert.deepEqual(names(),['Rare','Rare upper']);w.document.querySelector('[data-val="epic"]').click();assert.deepEqual(names(),['Epic','Epic upper']);
  w.document.querySelector('[data-val="mythic"]').click();assert.deepEqual(names(),['Zero']);assert.equal(w.document.querySelectorAll('.verified').length,1);
  assert.equal(calls.filter(url=>url.includes('/api/achievements?')).length,1);assert.ok(!calls.some(url=>url.includes('/unlock')));
});
test('missing global percentages explain empty rarity results without inventing zero rarity',async t=>{
  const w=ui(t,url=>url.includes('/percentages?')?{percentages:{}}:response([{apiname:'UNKNOWN',name:'Real achievement',unlocked:true,percent:null}]));
  await w.testUI.open(550,'Game',false,'protocol');w.document.querySelector('[data-val="mythic"]').click();await new Promise(r=>setImmediate(r));
  assert.equal(w.document.querySelectorAll('.ach-title').length,0);assert.match(w.document.getElementById('achListContainer').textContent,/has not supplied rarity percentages/);
  assert.equal(w.document.getElementById('achRarityMessage').hidden,false);assert.match(w.document.getElementById('achRarityMessage').textContent,/not treated as 0%/);
  w.document.querySelector('[data-val="mythic"]').click();assert.equal(w.document.querySelectorAll('.ach-title').length,1);assert.match(w.document.getElementById('achListContainer').textContent,/Unknown rarity/);
});
test('stale percentage lookup never populates a different game after using rarity filters',async t=>{
  let resolveLookup;const lookup=new Promise(resolve=>{resolveLookup=resolve;});
  const w=ui(t,url=>url.includes('/percentages?')?lookup:response([{apiname:'SAME',name:url.includes('appid=440')?'Old game':'New game',unlocked:false,percent:null}]));
  await w.testUI.open(440,'Old',false,'protocol');w.document.querySelector('[data-val="rare"]').click();await w.testUI.open(550,'New',false,'protocol');
  resolveLookup({percentages:{SAME:20}});await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('achListContainer').textContent,/New game/);assert.match(w.document.getElementById('achListContainer').textContent,/Unknown rarity/);
});
test('shared update displays every effect and cancellation never sends a write',async t=>{
  const calls=[],row={name:'Doctor',apiname:'DOCTOR',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewShared:true}};
  const preview={appid:440,apiname:'DOCTOR',name:'Doctor',canActivate:true,revision:'a'.repeat(64),counter:{statName:'HEALED',before:0,after:25000},effects:[{apiname:'DOCTOR',name:'Doctor',goal:25000,effect:'would_unlock'},{apiname:'CHIEF',name:'Chief',goal:1000000,effect:'progress_only'}],message:'Review all effects.'};
  const w=ui(t,url=>{calls.push(url);return url.includes('shared-progress-preview')?preview:response([row]);});w.testUI.activate({tokenSource:'environment'});await w.testUI.open(440,'TF2',false,'protocol');await w.testUI.reviewShared(row);
  let confirmation;w.confirm=message=>{confirmation=message;return false;};w.document.querySelector('#sharedProgressActions button').click();
  assert.match(confirmation,/Chief: progress_only/);assert.match(confirmation,/0 → 25000/);assert.ok(!calls.includes('/api/achievement/unlock'));
});
test('shared update submission uses only the reviewed revision and requires explicit confirmation',async t=>{
  const row={name:'Doctor',apiname:'DOCTOR',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewShared:true}};
  const preview={appid:440,apiname:'DOCTOR',canActivate:true,revision:'a'.repeat(64),counter:{statName:'HEALED',before:0,after:25000},effects:[{name:'Doctor',goal:25000,effect:'would_unlock'},{name:'Chief',goal:1000000,effect:'progress_only'}],message:'Reviewed.'};
  const w=ui(t,url=>url.includes('shared-progress-preview')?preview:response([row]));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment'});await w.testUI.open(440,'TF2',false,'protocol');await w.testUI.reviewShared(row);w.confirm=()=>true;
  let submitted;w.fetch=async(url,options)=>{if(url==='/api/achievement/unlock')submitted=JSON.parse(options.body);return {ok:true,json:async()=>url==='/api/achievement/unlock'?{message:'Confirmed.'}:response([row])};};
  w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.deepEqual(submitted,{accountId:'a',appid:440,apiname:'DOCTOR',mode:'shared',revision:'a'.repeat(64)});
});
test('compatibility filter includes bit and progress attempts but excludes protected, shared and unknown',async t=>{
  const calls=[],rows=[
    {name:'Normal',apiname:'BIT',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}},
    {name:'Progress',apiname:'INT',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canComplete:true}},
    {name:'Protected',unlocked:false,serverControlled:true,compatibility:{status:'restricted',code:'server_controlled'}},
    {name:'Shared',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewShared:true}},
    {name:'Unknown',unlocked:null,compatibility:{status:'insufficient_data'}},
    {name:'Recorded',unlocked:true,lastWriteOutcome:'confirmed',compatibility:{validatedOnAccount:true}},
    {name:'Existing',unlocked:true,compatibility:{canUnlock:false}}];
  const w=ui(t,url=>{calls.push(url);return response(rows);});w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');
  const select=w.document.getElementById('achCompatibilityFilter'),names=()=>[...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent),filter=value=>{select.value=value;select.dispatchEvent(new w.Event('change'));};
  filter('attemptable');assert.deepEqual(names(),['Normal','Progress']);
  filter('unavailable');assert.deepEqual(names(),['Protected']);
  filter('all');assert.match(w.document.querySelector('.ach-availability.confirmed').textContent,/Confirmed on this account/);
  filter('unknown');assert.deepEqual(names(),['Shared','Unknown']);
  assert.match(w.document.getElementById('achCompatibilitySummary').textContent,/2 eligible to attempt/);
  assert.equal(calls.filter(url=>/unlock|complete-progress/.test(url)).length,0);
  await w.testUI.open(240,'Other game',false,'protocol');assert.equal(select.value,'all');
});
test('standard reading does not claim activation compatibility and show-all resets combined filters',async t=>{
  const w=ui(t,()=>response([{name:'Only',unlocked:false,compatibility:{canUnlock:true}}]));w.testUI.activate({tokenSource:'environment'});await w.testUI.open(550,'Game');
  assert.match(w.document.querySelector('.ach-availability').textContent,/unknown/i);
  const select=w.document.getElementById('achCompatibilityFilter');select.value='attemptable';select.dispatchEvent(new w.Event('change'));
  assert.equal(w.document.querySelectorAll('.ach-title').length,0);
  [...w.document.querySelectorAll('#achListContainer button')].find(b=>b.textContent==='Show all').click();
  assert.equal(select.value,'all');assert.equal(w.document.querySelectorAll('.ach-title').length,1);
});
test('account options hide unsupported main-account actions and restore them for additional profiles',async t=>{
  const accounts=[{id:'a',name:'Main',tokenSource:'environment',games:[],cardDropGames:[],sleepMode:{}},{id:'b',name:'Other',tokenSource:'local',games:[],cardDropGames:[],sleepMode:{}}];
  const w=ui(t,()=>({accounts,presets:[],timezone:'UTC'}));w.testUI.authenticate();await w.testUI.load();
  for(const id of [17,18])assert.equal(w.document.querySelector('[data-event-'+id+']').hidden,true);
  assert.equal(w.document.getElementById('managedAccountNote').hidden,false);
  w.testUI.select('b');await w.testUI.load();
  for(const id of [17,18])assert.equal(w.document.querySelector('[data-event-'+id+']').hidden,false);
  assert.equal(w.document.getElementById('managedAccountNote').hidden,true);
});
test('secondary controls are collapsed, unique and preserve their original handlers',async t=>{
  const w=ui(t,()=>response([])),d=w.document;
  for(const id of [20,22,25,27])assert.equal(d.querySelectorAll('[data-event-'+id+']').length,1);
  for(const id of [20,22])assert.ok(d.querySelector('[data-event-'+id+']').closest('.advanced-settings'));
  assert.ok(d.querySelector('[data-event-25]').closest('details'));
  assert.equal(d.querySelector('.quick-presets').open,false);
  assert.match(d.querySelector('[data-event-27]').textContent,/Save & test/);
  assert.equal(d.querySelectorAll('#achReadMode').length,1);
});
test('reading selector keeps automatic mode on refresh and exposes direct activation compatibility',async t=>{
  const calls=[],target={name:'Target',apiname:'REAL',unlocked:false,compatibility:{canUnlock:true,status:'provisional',reason:'Eligible'}};
  const w=ui(t,url=>{calls.push(url);return {...response([target]),readingMethod:'protocol'};});w.testUI.activate({tokenSource:'environment'});
  await w.testUI.open(550,'Game',false,'auto');assert.equal(w.document.getElementById('achReadMode').value,'auto');
  await w.testUI.refresh();assert.ok(calls.at(-1).includes('method=auto'));assert.match(w.document.querySelector('.ach-info button').textContent,/Unlock achievement/);
  const mode=w.document.getElementById('achReadMode');mode.value='protocol';mode.dispatchEvent(new w.Event('change'));await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(url=>url.includes('method=protocol')));assert.ok(!calls.some(url=>url.includes('/unlock')));
});
test('percentage descending sort puts most obtained first, keeps genuine zero and places unknowns last',async t=>{const w=ui(t,()=>response([{name:'Unknown A',unlocked:false},{name:'Rare',unlocked:false,percent:1},{name:'Common',unlocked:false,percent:90},{name:'Unknown B',unlocked:false},{name:'Zero',unlocked:false,percent:0}]));await w.testUI.open(550,'Game');const select=w.document.getElementById('achSortSelect');select.value='percentage_desc';select.dispatchEvent(new w.Event('change'));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent),['Common','Rare','Zero','Unknown A','Unknown B']);});
test('percentage sort enriches a direct read without changing its verified states',async t=>{const calls=[],w=ui(t,url=>{calls.push(url);return url.includes('/percentages?')?{percentages:{ONE:80,TWO:10}}:response([{apiname:'TWO',name:'Two',unlocked:true,percent:null},{apiname:'ONE',name:'One',unlocked:false,percent:null}]);});await w.testUI.open(550,'Game',false,'protocol');const select=w.document.getElementById('achSortSelect');select.value='percentage_desc';select.dispatchEvent(new w.Event('change'));await new Promise(r=>setImmediate(r));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent),['One','Two']);assert.equal(calls.filter(url=>url.includes('/api/achievements?')).length,1);assert.equal(calls.filter(url=>url.includes('/percentages?')).length,1);assert.equal(w.document.querySelectorAll('.verified').length,1);});
test('resume control is in the header and card disclosure uses an inline animated SVG indicator',async t=>{const w=ui(t,()=>response([]));assert.ok(w.document.querySelector('header #playBtn'));assert.equal(w.document.querySelectorAll('#playBtn').length,1);assert.ok(w.document.querySelector('#cardsPanel summary .cards-disclosure svg path'));assert.ok(w.document.querySelector('#achReadMode option[value="web"]'));});
test('connected game card opens automatic direct-first reading while standard reading remains available',async t=>{const calls=[],account={id:'a',name:'Owner',games:[550],gameNames:{550:'L4D2'},connected:true,tokenSource:'environment',cardDropGames:[],sleepMode:{enabled:false,start:3,end:8}};const w=ui(t,url=>{calls.push(url);return url==='/api/status'?{accounts:[account],presets:[],timezone:'UTC'}:{...response([{name:'Real',unlocked:true}]),readingMethod:url.includes('method=auto')?'protocol':'web'};});w.testUI.authenticate();await w.testUI.load();w.document.querySelector('.btn-card-ach').click();await new Promise(r=>setImmediate(r));assert.ok(calls.some(url=>url.includes('method=auto')));const mode=w.document.getElementById('achReadMode');mode.value='web';mode.dispatchEvent(new w.Event('change'));await new Promise(r=>setImmediate(r));assert.ok(calls.some(url=>url.includes('/api/achievements?')&&url.includes('refresh=1')&&!url.includes('method=')));});
test('compact Cards panel shows automatic games, pending drops, active status and keeps the manual list',async t=>{
  const account={id:'a',name:'Owner',games:[220],gameNames:{220:'Manual game'},connected:true,cardFarming:true,cardsReady:true,isFarming:true,runningGames:[240],sleepMode:{enabled:false,start:3,end:8},cardDropGames:[{appid:240,name:'Counter-Strike: Source',remaining:3},{appid:550,name:'<img src=x onerror=alert(1)>',remaining:5}],cardScanAt:'2026-10-13T16:00:00Z'};
  const w=ui(t,()=>({accounts:[account],presets:[],timezone:'America/Montevideo'}));w.testUI.authenticate();await w.testUI.load();
  const panel=w.document.getElementById('cardsPanel');assert.equal(panel.tagName,'DETAILS');assert.equal(panel.open,false);assert.equal(panel.hidden,false);panel.open=true;assert.match(w.document.getElementById('cardsSummary').textContent,/1\/2 active.*8 pending/);assert.equal(w.document.querySelector('#cardsList .cards-game-state').textContent,'Active');assert.match(w.document.getElementById('cardsList').textContent,/Counter-Strike: Source/);assert.equal(w.document.querySelectorAll('#cardsList img').length,0);assert.match(w.document.getElementById('gamesGrid').textContent,/Manual game/);
  const row=w.document.querySelector('#cardsList .cards-game');await w.testUI.load();assert.equal(w.document.querySelector('#cardsList .cards-game'),row);assert.equal(panel.open,true);
  account.isPaused=true;account.isFarming=false;account.runningGames=[];await w.testUI.load();assert.match(w.document.getElementById('cardsSummary').textContent,/0\/2 active/);assert.equal(w.document.querySelector('#cardsList .cards-game-state').textContent,'Paused');
  account.cardFarming=false;await w.testUI.load();assert.equal(w.document.getElementById('cardsPanel').hidden,true);assert.equal(w.document.querySelectorAll('#cardsList .cards-game').length,0);assert.match(w.document.getElementById('gamesGrid').textContent,/Manual game/);
});
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
test('large achievement lists render only 200 rows per page and closing releases DOM',async t=>{const w=ui(t,()=>response(Array.from({length:650},(_,i)=>({name:'Achievement '+i,unlocked:false}))));await w.testUI.open(550,'Large game');assert.equal(w.document.querySelectorAll('.ach-item').length,200);assert.match(w.document.querySelector('.ach-pagination').textContent,/Page 1 of 4/);[...w.document.querySelectorAll('.ach-pagination button')].find(b=>b.textContent==='Next').click();assert.equal(w.document.querySelector('.ach-title').textContent,'Achievement 200');assert.equal(w.document.querySelectorAll('.ach-item').length,200);w.testUI.close();assert.equal(w.document.querySelectorAll('.ach-item').length,0);});
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
  await w.testUI.open(550,'A game',true,'protocol');assert.match(w.document.getElementById('achListContainer').textContent,/Unlock achievement/);assert.match(w.document.getElementById('achListContainer').textContent,/Eligible to attempt/);
  w.testUI.activate({tokenSource:'local'});await w.testUI.refresh();assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/Unlock achievement/);
  w.testUI.activate({tokenSource:'environment'});target.compatibility={status:'dependency',canUnlock:false,reason:'Progress stat'};await w.testUI.refresh();assert.equal(w.document.querySelector('.ach-info button'),null);assert.match(w.document.getElementById('achListContainer').textContent,/Progress stat/);
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
test('unknown personal states display the reason and next step without requiring hover or an unlock button',async t=>{
  const w=ui(t,()=>response([{name:'Unknown',unlocked:null,compatibility:{status:'insufficient_data',canUnlock:false,reason:'No personal state from Steam',action:'Open the official game and refresh'}}]));
  await w.testUI.open(123,'Game',true,'protocol');const text=w.document.getElementById('achListContainer').textContent;assert.match(text,/No personal state from Steam/);assert.match(text,/official game/);assert.doesNotMatch(text,/Unlock achievement/);
});
test('progress completion previews exact counter changes and cancellation sends no write',async t=>{
  const target={name:'Progress',apiname:'TARGET',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false,status:'dependency'},progressSupport:{canComplete:true}};
  const urls=[];const w=ui(t,url=>{urls.push(url);return url.startsWith('/api/achievement/progress-preview')?{name:'Progress',revision:'a'.repeat(64),progressChanges:[{statName:'COUNT',before:3,after:10}],message:'Changes Steam statistics.'}:response([target]);});w.testUI.authenticate();w.testUI.activate({tokenSource:'environment'});let confirmation;w.confirm=text=>{confirmation=text;return false;};
  await w.testUI.open(550,'Game',true,'protocol');await w.testUI.completeProgress(target);assert.match(confirmation,/COUNT: 3 → 10/);assert.ok(!urls.includes('/api/achievement/unlock'));
});
test('confirmed progress completion submits the selected target and reviewed revision only',async t=>{
  const target={name:'Progress',apiname:'TARGET',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false,status:'dependency'},progressSupport:{canComplete:true}};
  const w=ui(t,()=>response([target]));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment'});w.confirm=()=>true;await w.testUI.open(550,'Game',true,'protocol');let submitted;
  w.fetch=async(url,options)=>({ok:true,json:async()=>url.startsWith('/api/achievement/progress-preview')?{name:'Progress',revision:'b'.repeat(64),progressChanges:[{statName:'COUNT',before:3,after:10}],message:'Changes Steam stats.'}:url==='/api/achievement/unlock'?(submitted=JSON.parse(options.body),{message:'Verified'}):response([target])});
  await w.testUI.completeProgress(target);assert.deepEqual(submitted,{accountId:'a',appid:550,apiname:'TARGET',mode:'progress',revision:'b'.repeat(64)});
});
test('shared impact review displays all effect types as text and never submits an activation',async t=>{
  const urls=[];const row={name:'Shared',apiname:'TARGET',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false},progressSupport:{canPreviewShared:true,canComplete:false}};
  const w=ui(t,url=>{urls.push(url);return url.startsWith('/api/achievement/shared-progress-preview')?{counter:{statName:'COUNT',before:5,after:100},effects:[{name:'<img src=x>',goal:10,effect:'would_unlock'},{name:'Later',goal:1000,effect:'progress_only'},{name:'Complex',effect:'unknown'}],message:'Read-only review.'}:response([row]);});w.testUI.activate({tokenSource:'environment'});await w.testUI.open(550,'Game',true,'protocol');await w.testUI.reviewShared(row);const panel=w.document.getElementById('sharedProgressReview');assert.equal(panel.hidden,false);assert.match(panel.textContent,/Would unlock/);assert.match(panel.textContent,/Impact unknown/);assert.equal(panel.querySelector('img'),null);assert.ok(!urls.includes('/api/achievement/unlock'));
});
test('write history renders receipts as text and does not infer unrecorded historical attempts',async t=>{
  const w=ui(t,()=>({entries:[{name:'<script>secret</script>',outcome:'requested',progressChanges:[{statName:'COUNT',before:0,after:1}]}]}));await w.testUI.history();const list=w.document.getElementById('historyList');assert.match(list.textContent,/COUNT: 0 → 1/);assert.equal(list.querySelector('script'),null);
});
