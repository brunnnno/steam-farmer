'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
function ui(t, responder,initialSession=()=>new Promise(()=>{})) {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),{url:'https://panel.example',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.AbortSignal=AbortSignal;w.AbortController=AbortController;w.intervals=[];w.setInterval=(callback,delay)=>{w.intervals.push({callback,delay});return w.intervals.length;};
  w.fetch=async(url)=>url==='/api/panel/session'?initialSession():({ok:true,status:200,json:async()=>responder(url)});
  w.eval(fs.readFileSync(path.join(__dirname,'../public/achievement-rarity.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../public/achievement-availability.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../public/draft-settings.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../public/achievement-live.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8')+`\nwindow.testUI={load:loadStatus,authenticate:()=>{csrf='test';},lock:showLock,open:openAchModal,close:closeAchModal,filter:setFilter,search:onSearchInput,refresh:forceRefreshAchievements,select:id=>{activeAccountId=id;},activate:a=>{active=a;},unlock:unlockIndividualAchievement,completeProgress:completeAchievementProgress,reviewShared:reviewSharedProgress,history:refreshWriteHistory,live:achievementLive,saveSleep,saveCustomStatus,api,checkAuth,panelUnlock:unlock,csrf:()=>csrf};`);
  w.testUI.select('a');return w;
}
const response=rows=>({achievements:rows,source:'Steam test',checkedAt:new Date().toISOString()});

test('a late startup session success or 401 cannot replace a subsequent panel sign-in',async t=>{
  for(const success of [true,false])await t.test(success?'old successful session':'old expired session',async t=>{
    let resolveInitial,logins=0;const initial=new Promise(resolve=>resolveInitial=resolve),account={id:'a',name:'Synthetic account',games:[],sleepMode:{}};
    const w=ui(t,url=>{
      if(url==='/api/panel/login'){logins++;return {csrf:'new-panel-session'};}
      if(url==='/api/status')return {accounts:[account],presets:[],timezone:'UTC'};
      return response([]);
    },()=>initial);
    w.document.getElementById('pinInput').value='synthetic-panel-password';await w.testUI.panelUnlock();
    assert.equal(logins,1);assert.equal(w.testUI.csrf(),'new-panel-session');assert.equal(w.document.getElementById('lockModal').style.display,'none');
    resolveInitial({ok:success,status:success?200:401,json:async()=>success?{csrf:'old-startup-session'}:{error:'Expired startup session'}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(w.testUI.csrf(),'new-panel-session');assert.equal(w.document.getElementById('lockModal').style.display,'none');assert.match(w.document.getElementById('userLabel').textContent,/Synthetic account/);
  });
});
test('live read detects external unlocks and removals, retains rarity and never calls a write',async t=>{
  let stage=0;const urls=[];const row=()=>({apiname:'A',name:'One',unlocked:stage===1,percent:stage?null:10,compatibility:{status:'provisional',canUnlock:stage!==1},batchSupport:{canRemove:stage===1}});
  const w=ui(t,url=>{urls.push(url);return {...response([row()]),readingMethod:'protocol',stateRevision:String(stage+1).repeat(64),...(stage?{observedChanges:{changes:[{apiname:'A',name:'One',kind:stage===1?'unlock':'remove',before:stage!==1,after:stage===1}],total:1,observedAt:new Date().toISOString()}}:{})};});
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');
  stage=1;await w.testUI.live.tick();assert.match(w.document.getElementById('achProgressText').textContent,/1\/1/);assert.match(w.document.getElementById('achListContainer').textContent,/Epic · 10.0%/);assert.match(w.document.getElementById('achievementObservedList').textContent,/Unlocked/);
  stage=2;await w.testUI.live.tick();assert.match(w.document.getElementById('achProgressText').textContent,/0\/1/);assert.match(w.document.getElementById('achievementObservedList').textContent,/Locked/);assert.ok(urls.slice(1).every(url=>url.includes('revision=')));
  const requests=urls.length,check=w.document.querySelector('.ach-select');check.checked=true;check.dispatchEvent(new w.Event('change'));await w.testUI.live.tick();assert.equal(urls.length,requests);assert.ok(!urls.some(url=>url.includes('/unlock')||url.includes('/change')));
});
test('unchanged live results retain DOM, position and filter while a late read cannot reopen a closed game',async t=>{
  let next,resolve;const rows=[{apiname:'A',name:'One',unlocked:false,percent:2}],w=ui(t,()=>next||{...response(rows),readingMethod:'protocol',stateRevision:'a'.repeat(64)});
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');w.testUI.filter('rarity','mythic');const item=w.document.querySelector('.ach-item');w.document.getElementById('achListContainer').scrollTop=67;
  next={unchanged:true,checkedAt:new Date().toISOString(),source:'Steam test',readingMethod:'protocol',stateRevision:'a'.repeat(64)};await w.testUI.live.tick();assert.equal(w.document.querySelector('.ach-item'),item);assert.equal(w.document.getElementById('achListContainer').scrollTop,67);
  next=new Promise(r=>resolve=r);const pending=w.testUI.live.tick();w.testUI.close();resolve({...response([{...rows[0],unlocked:true}]),stateRevision:'b'.repeat(64)});await pending;assert.equal(w.document.getElementById('achModal').style.display,'none');assert.equal(w.document.querySelectorAll('.ach-item').length,0);
});
test('status polling preserves unfocused drafts and an old 401 does not lock the new session',async t=>{
  const account={id:'a',name:'A',connected:true,games:[],sleepMode:{enabled:false,start:3,end:8},customStatus:''};const w=ui(t,()=>({accounts:[account],presets:[],timezone:'America/Montevideo'}));w.testUI.authenticate();w.testUI.activate(account);await w.testUI.load();
  for(const [id,value]of [['sleepStart','22'],['timezoneInput','UTC'],['customStatusInput','Draft']]){const input=w.document.getElementById(id);input.value=value;input.dispatchEvent(new w.Event('input'));}
  w.document.getElementById('sleepEnabled').checked=true;w.document.getElementById('sleepEnabled').dispatchEvent(new w.Event('change'));await w.testUI.load();assert.equal(w.document.getElementById('sleepStart').value,'22');assert.equal(w.document.getElementById('timezoneInput').value,'UTC');assert.equal(w.document.getElementById('customStatusInput').value,'Draft');assert.equal(w.document.getElementById('sleepEnabled').checked,true);
  let resolve;w.fetch=()=>new Promise(r=>resolve=r);const old=w.testUI.api('/api/status');w.testUI.lock();w.testUI.authenticate();w.document.getElementById('lockModal').style.display='none';resolve({ok:false,status:401,json:async()=>({error:'Expired old session'})});await assert.rejects(old);assert.equal(w.document.getElementById('lockModal').style.display,'none');
});
test('late rarity enrichment keeps the current page and explicit search resets it',async t=>{
  let resolve;const rows=Array.from({length:201},(_,i)=>({apiname:'A'+i,name:'Achievement '+i,unlocked:false,percent:null}));const w=ui(t,url=>url.includes('/percentages?')?new Promise(r=>resolve=r):{...response(rows),readingMethod:'protocol'});await w.testUI.open(550,'Game',false,'protocol');
  await new Promise(r=>setImmediate(r));[...w.document.querySelectorAll('.ach-pagination button')].find(b=>b.textContent==='Next').click();assert.equal(w.document.querySelector('.ach-title').textContent,'Achievement 200');resolve({percentages:Object.fromEntries(rows.map(r=>[r.apiname,2]))});await new Promise(r=>setImmediate(r));assert.equal(w.document.querySelector('.ach-title').textContent,'Achievement 200');w.testUI.search('Achievement 0');assert.equal(w.document.querySelector('.ach-title').textContent,'Achievement 0');
});

test('a pending or failed new game never displays the previous game rarity or reading message',async t=>{
  let reject;const pending=new Promise((_,r)=>{reject=r;});const w=ui(t,url=>url.includes('appid=240')?pending:{...response([{name:'Previous',apiname:'P',unlocked:true,percent:10}]),rarityMessage:'Historical L4D2 message',message:'Previous private reading'});
  await w.testUI.open(550,'First',false,'protocol');assert.match(w.document.getElementById('achRarityMessage').textContent,/Historical L4D2/);
  const opening=w.testUI.open(240,'Second',false,'protocol');assert.equal(w.document.getElementById('achRarityMessage').hidden,true);assert.equal(w.document.getElementById('achRarityMessage').textContent,'');assert.equal(w.document.getElementById('achReadMessage').textContent,'');assert.equal(w.document.querySelectorAll('.ach-item').length,0);
  reject(Error('Second unavailable'));await opening;assert.doesNotMatch(w.document.getElementById('achModal').textContent,/Historical L4D2|Previous private reading/);
});

test('natural unlock selection, preserved-progress warning and historical rarity work together without a write',async t=>{
  const calls=[],rows=[{name:'Natural progress',apiname:'N',unlocked:true,batchSupport:{canRemove:true}},{name:'Natural bit',apiname:'B',unlocked:true,batchSupport:{canRemove:true}}],preview={selection:rows.map(r=>({apiname:r.apiname,action:'remove'})),effects:rows.map(r=>({apiname:r.apiname,name:r.name,action:'remove',warning:'Linked progress is unchanged.'})),progressChanges:[],revision:'a'.repeat(64),canActivate:true,message:'Review'};
  const w=ui(t,url=>{calls.push(url);return url==='/api/achievement/change-preview'?preview:url.includes('/percentages?')?{percentages:{N:2,B:10},rarityStatus:'historical',rarityMessage:'Historical Steam percentages; current data unavailable.'}:response(rows);});w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');await new Promise(r=>setImmediate(r));assert.equal(w.document.querySelectorAll('.ach-select').length,2);assert.match(w.document.getElementById('achRarityMessage').textContent,/Historical/);w.testUI.filter('rarity','mythic');assert.match(w.document.getElementById('achListContainer').textContent,/Mythic · 2.0%/);w.testUI.filter('rarity','all');
  for(const check of w.document.querySelectorAll('.ach-select')){check.checked=true;check.dispatchEvent(new w.Event('change'));}w.document.getElementById('reviewAchievementSelection').click();await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('sharedProgressSummary').textContent,/Gameplay counters stay unchanged/);assert.match(w.document.getElementById('sharedProgressEffects').textContent,/Linked progress is unchanged/);assert.ok(!calls.includes('/api/achievement/change'));
});
test('selection spans filters, reviews mixed unlocks/removals and sends only after exact confirmation',async t=>{
  const rows=[{name:'New',apiname:'A',unlocked:false,compatibility:{status:'provisional',canUnlock:true}},{name:'Panel granted',apiname:'B',unlocked:true,lastWriteOutcome:'confirmed',batchSupport:{canRemove:true}},{name:'Natural unlock',apiname:'OTHER',unlocked:true}];
  const selected=[{apiname:'A',action:'unlock'},{apiname:'B',action:'remove'}],preview={selection:selected,effects:[{apiname:'A',name:'New',action:'unlock',progressChanges:[]},{apiname:'B',name:'Panel granted',action:'remove',progressChanges:[]}],progressChanges:[],canActivate:true,revision:'a'.repeat(64),message:'Review every effect.'};
  const w=ui(t,url=>url==='/api/achievement/change-preview'?preview:response(rows));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');assert.equal(w.document.querySelectorAll('.ach-select').length,2);
  for(const check of w.document.querySelectorAll('.ach-select')){check.checked=true;check.dispatchEvent(new w.Event('change'));}w.testUI.filter('status','locked');assert.match(w.document.getElementById('achievementSelectionSummary').textContent,/1 to unlock · 1 to remove/);
  w.document.getElementById('reviewAchievementSelection').click();await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('sharedProgressReview').textContent,/Will unlock/);assert.match(w.document.getElementById('sharedProgressReview').textContent,/Will remove/);
  let submitted;w.fetch=async(url,options)=>{if(url==='/api/achievement/change')submitted=JSON.parse(options.body);return {ok:true,json:async()=>url==='/api/achievement/change'?{message:'Confirmed.'}:response(rows)};};
  let confirmation;w.confirm=text=>{confirmation=text;return false;};w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.equal(submitted,undefined);assert.match(confirmation,/New: unlock/);assert.match(confirmation,/Panel granted: remove/);
  w.confirm=()=>true;w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.deepEqual(submitted,{confirmed:true,accountId:'a',appid:550,selection:selected,revision:'a'.repeat(64),confirmed:true});assert.equal(w.document.getElementById('achievementSelectionBar').hidden,false);assert.equal(w.document.getElementById('reviewAchievementSelection').disabled,true);
});
test('selection is capped, invalidated by edits or refresh, and absent from cached readings',async t=>{
  const rows=Array.from({length:40},(_,i)=>({name:'Target '+i,apiname:'A'+i,unlocked:false,compatibility:{status:'provisional',canUnlock:true}})),w=ui(t,()=>response(rows));w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');
  for(const check of [...w.document.querySelectorAll('.ach-select')]){check.checked=true;check.dispatchEvent(new w.Event('change'));}assert.equal(w.document.querySelectorAll('.ach-select:disabled').length,0);assert.match(w.document.getElementById('achievementSelectionSummary').textContent,/40 to unlock/);
  w.document.getElementById('clearAchievementSelection').click();assert.equal(w.document.querySelectorAll('.ach-select:checked').length,0);assert.equal(w.document.getElementById('achievementSelectionBar').hidden,false);assert.equal(w.document.getElementById('reviewAchievementSelection').disabled,true);
  await w.testUI.refresh();assert.equal(w.document.querySelectorAll('.ach-select:checked').length,0);w.testUI.close();assert.equal(w.document.querySelectorAll('.ach-select').length,0);assert.equal(w.document.getElementById('sharedProgressActions').childElementCount,0);
});
test('game requirements load only when expanded and do not repeat or fetch after closing',async t=>{
  const calls=[],w=ui(t,url=>{calls.push(url);return url.includes('game-requirements')?{facts:[],explanation:'Read-only context.',action:'Review the official game.',sourceUrl:'https://store.steampowered.com/app/550/'}:response([{name:'A',unlocked:false}]);});
  await w.testUI.open(550,'Game');assert.equal(calls.filter(url=>url.includes('game-requirements')).length,0);const details=w.document.getElementById('gameRequirements');details.open=true;details.dispatchEvent(new w.Event('toggle'));await new Promise(r=>setImmediate(r));details.open=false;details.open=true;details.dispatchEvent(new w.Event('toggle'));await new Promise(r=>setImmediate(r));assert.equal(calls.filter(url=>url.includes('game-requirements')).length,1);
  await w.testUI.open(550,'Game');w.testUI.close();details.open=true;details.dispatchEvent(new w.Event('toggle'));await new Promise(r=>setImmediate(r));assert.equal(calls.filter(url=>url.includes('game-requirements')).length,1);
});
test('locking clears history and ignores status/history responses that were already in flight',async t=>{
  let resolveStatus,resolveHistory;const status=new Promise(r=>resolveStatus=r),history=new Promise(r=>resolveHistory=r);
  const w=ui(t,url=>url==='/api/status'?status:url.startsWith('/api/achievement/history')?history:response([]));w.testUI.authenticate();w.document.getElementById('historyList').textContent='Old personal history';
  const statusTask=w.testUI.load(),historyTask=w.testUI.history();w.testUI.lock();assert.equal(w.document.getElementById('historyList').childElementCount,0);
  resolveStatus({accounts:[{id:'a',name:'Stale private account',connected:true,games:[],sleepMode:{},cardDropGames:[]}],presets:[],timezone:'UTC'});resolveHistory({entries:[{name:'Stale private history',outcome:'confirmed'}]});await Promise.all([statusTask,historyTask]);assert.equal(w.document.getElementById('historyList').childElementCount,0);assert.doesNotMatch(w.document.getElementById('userLabel').textContent,/Stale private/);
});
test('a slow progress preview cannot confirm after closing and reopening the same game',async t=>{
  let release;const preview=new Promise(r=>release=r),target={name:'Progress',apiname:'P',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canComplete:true}};
  const w=ui(t,url=>url.includes('/progress-preview?')?preview:response([target]));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');const operation=w.testUI.completeProgress(target);w.testUI.close();await w.testUI.open(550,'Game',false,'protocol');w.confirm=()=>{throw Error('A stale preview must not confirm');};release({name:'Progress',revision:'a'.repeat(64),progressChanges:[],message:'Review'});await operation;
});
test('disconnecting disables selected changes until a fresh Steam reading completes',async t=>{
  const account={id:'a',name:'A',connected:true,tokenSource:'environment',linkedSteamId:'76561198000000001',games:[],sleepMode:{},cardDropGames:[]};let disconnected=false;
  const w=ui(t,url=>url==='/api/status'?{accounts:[{...account,connected:!disconnected}],presets:[],timezone:'UTC'}:response([{name:'A',apiname:'A',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}}]));w.testUI.authenticate();w.testUI.activate(account);await w.testUI.open(550,'Game',false,'protocol');const check=w.document.querySelector('.ach-select');check.checked=true;check.dispatchEvent(new w.Event('change'));disconnected=true;await w.testUI.load();assert.equal(w.document.getElementById('achievementSelectionBar').hidden,false);assert.equal(w.document.getElementById('reviewAchievementSelection').disabled,true);assert.equal(w.document.querySelectorAll('.ach-select').length,0);assert.match(w.document.getElementById('achReadMessage').textContent,/disconnected/);
});
test('operation history expands bounded effect details on demand and releases them on collapse',async t=>{
  const effects=Array.from({length:64},(_,i)=>({apiname:'A'+i,name:'Achievement '+i,action:i?'unlock':'remove',before:false,after:true})),w=ui(t,()=>({entries:[{operationId:'test',outcome:'confirmed',effects,progressChanges:[]}]}));w.testUI.authenticate();await w.testUI.history();const details=w.document.querySelector('#historyList details');assert.ok(details);assert.equal(details.querySelectorAll('p').length,0);details.open=true;details.dispatchEvent(new w.Event('toggle'));assert.equal(details.querySelectorAll('p').length,64);details.open=false;details.dispatchEvent(new w.Event('toggle'));assert.equal(details.querySelectorAll('p').length,0);
});
test('polling closes stale achievement context when a profile disappears or its Steam identity changes',async t=>{
  const account={id:'a',name:'A',connected:true,tokenSource:'environment',linkedSteamId:'76561198000000001',games:[],sleepMode:{},cardDropGames:[]};let next={...account};
  const w=ui(t,url=>url==='/api/status'?{accounts:[next],presets:[],timezone:'UTC'}:response([{name:'A',apiname:'A',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}}]));w.testUI.authenticate();w.testUI.activate(account);await w.testUI.open(550,'Game',false,'protocol');next={...account,linkedSteamId:'76561198000000002'};await w.testUI.load();assert.equal(w.document.getElementById('achModal').style.display,'none');assert.equal(w.document.querySelectorAll('.ach-item').length,0);
  await w.testUI.open(550,'Game',false,'protocol');next={...next,id:'replacement'};await w.testUI.load();assert.equal(w.document.getElementById('achModal').style.display,'none');
});
test('XML-style lists use unique titles and case-insensitive API names for rarity without changing personal states',async t=>{
  const calls=[],rows=[{name:'GNOME ALONE',apiname:'global_gnome_alone',unlocked:true,percent:null},{name:'An Epic',apiname:null,unlocked:false,percent:null},{name:'Duplicate',apiname:null,unlocked:false,percent:null},{name:'Duplicate',apiname:null,unlocked:true,percent:null}];
  const w=ui(t,url=>{calls.push(url);return url.includes('/percentages?')?{percentages:{GLOBAL_GNOME_ALONE:69.8},titlePercentages:{'an epic':10,duplicate:5}}:response(rows);});await w.testUI.open(550,'Left 4 Dead 2',false,'web');w.testUI.filter('rarity','epic');await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(url=>url.includes('/percentages?')&&url.includes('titles=1')));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent),['An Epic']);assert.equal(w.document.querySelectorAll('.verified').length,0);
  w.testUI.filter('rarity','epic');assert.equal(w.document.querySelectorAll('.verified').length,2);assert.match(w.document.getElementById('achListContainer').textContent,/69.8%/);assert.equal(calls.filter(url=>url.includes('/api/achievements?')).length,1);assert.ok(!calls.some(url=>url.includes('/unlock')));
});
test('rarity API case collisions remain unknown instead of choosing an arbitrary percentage',async t=>{
  const w=ui(t,url=>url.includes('/percentages?')?{percentages:{API:5,Api:10}}:response([{name:'Ambiguous',apiname:'api',unlocked:false,percent:null}]));await w.testUI.open(550,'Game',false,'protocol');w.testUI.filter('rarity','epic');await new Promise(resolve=>setImmediate(resolve));assert.equal(w.document.querySelectorAll('.ach-title').length,0);
});
test('one progress action dispatches supported and shared counters to their existing review flows',async t=>{
  for(const shared of [false,true]){
    const calls=[],row={name:'Progress target',apiname:'TARGET',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency',canUnlock:false},progressSupport:shared?{canPreviewShared:true}:{canComplete:true}};
    const endpoint=shared?'/shared-progress-preview?':'/progress-preview?';
    const w=ui(t,url=>{calls.push(url);if(url.includes(endpoint))return shared?{counter:{statName:'COUNT',before:0,after:10},effects:[],canActivate:false,message:'Review only.'}:{name:'Progress target',progressChanges:[{statName:'COUNT',before:0,after:10}],message:'Review only.'};return response([row]);});
    w.testUI.activate({tokenSource:'environment',connected:true});w.confirm=()=>false;await w.testUI.open(550,'Game',false,'protocol');
    const actions=[...w.document.querySelectorAll('#achListContainer button')];assert.equal(actions.length,1);assert.equal(actions[0].textContent,'Review progress');actions[0].click();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
    assert.ok(calls.some(url=>url.includes(endpoint)));assert.ok(!calls.some(url=>url.includes('/unlock')));
  }
});
test('decimal preview shows decoded values and schema limits without confirmation or write controls',async t=>{
  const calls=[],row={apiname:'DECIMAL',name:'Distance',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency',canUnlock:false},progressSupport:{canPreviewFloat:true,canComplete:false,code:'float_review_only'},progressDetails:{currentValue:1.25,maximum:10.5}};
  const w=ui(t,url=>{calls.push(url);return url.includes('/float-progress-preview?')?{name:'Distance',counter:{statName:'DISTANCE',before:1.25,after:10.5,goal:10.5,min:0,max:100,maxChange:0},canActivate:false,message:'Read-only progress review. No changes.'}:response([row]);});
  w.testUI.activate({tokenSource:'environment',connected:true});w.confirm=()=>{throw Error('Read-only review must not ask for confirmation');};await w.testUI.open(550,'Game',false,'protocol');
  const button=[...w.document.querySelectorAll('#achListContainer button')].find(b=>b.textContent==='Review progress');assert.ok(button);button.click();await new Promise(resolve=>setImmediate(resolve));
  const panel=w.document.getElementById('sharedProgressReview');assert.equal(panel.hidden,false);assert.match(panel.textContent,/Review progress/);assert.match(panel.textContent,/1.25/);assert.match(panel.textContent,/10.5/);assert.match(panel.textContent,/Allowed range: 0 to 100/);assert.doesNotMatch(panel.textContent,/FLOAT|decimal/i);assert.equal(w.document.getElementById('floatSearchStart'),null);assert.equal(w.document.getElementById('sharedProgressActions').childElementCount,0);assert.ok(!calls.some(url=>url.includes('/unlock')));
});
test('reopening shows bounded previous reading immediately but blocks writes until fresh verification',async t=>{
  const row={apiname:'REAL',name:'Old reading',unlocked:false,compatibility:{canUnlock:true,status:'provisional'}};
  let resolveRead,reads=0;const pending=new Promise(resolve=>resolveRead=resolve);
  const w=ui(t,url=>url.includes('/api/achievements?')?(++reads===1?response([row]):pending):{});
  w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');w.testUI.close();
  const fresh=w.testUI.open(550,'Game',true,'protocol');
  assert.match(w.document.getElementById('achListContainer').textContent,/Old reading/);
  assert.match(w.document.getElementById('achProgressText').textContent,/Previous reading/);
  w.confirm=()=>{throw Error('Stale data must not allow confirmation');};await w.testUI.unlock(row);await w.testUI.completeProgress({...row,progressSupport:{canComplete:true}});
  resolveRead(response([{...row,name:'Fresh reading'}]));await fresh;
  assert.match(w.document.getElementById('achListContainer').textContent,/Fresh reading/);assert.doesNotMatch(w.document.getElementById('achProgressText').textContent,/Previous/);
});
test('failed verification retains previous list with blocked actions and never crosses account boundaries',async t=>{
  let reads=0;const w=ui(t,url=>{if(!url.includes('/api/achievements?'))return {};if(++reads===1)return response([{name:'Private previous list',apiname:'REAL',unlocked:true}]);throw Error('Steam unavailable');});
  await w.testUI.open(550,'Game',false,'protocol');w.testUI.close();await w.testUI.open(550,'Game',true,'protocol');
  assert.match(w.document.getElementById('achListContainer').textContent,/Private previous list/);assert.match(w.document.getElementById('achReadMessage').textContent,/verification failed/);
  w.testUI.select('b');await w.testUI.open(550,'Game',false,'protocol');assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/Private previous list/);
});
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
  resolveLookup({percentages:{A0:0,A1:5,A2:19.999,A3:20,A4:50,A5:50.1}});await new Promise(r=>setImmediate(r));
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
  const w=ui(t,url=>url.includes('/percentages?')?(url.includes('appid=440')?lookup:{percentages:{SAME:10}}):response([{apiname:'SAME',name:url.includes('appid=440')?'Old game':'New game',unlocked:false,percent:null}]));
  await w.testUI.open(440,'Old',false,'protocol');w.document.querySelector('[data-val="rare"]').click();await w.testUI.open(550,'New',false,'protocol');
  resolveLookup({percentages:{SAME:20}});await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('achListContainer').textContent,/New game/);assert.match(w.document.getElementById('achListContainer').textContent,/Epic · 10.0%/);assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/20.0%/);
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
  w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.deepEqual(submitted,{confirmed:true,accountId:'a',appid:440,apiname:'DOCTOR',mode:'shared',revision:'a'.repeat(64)});
});
test('decimal update requires an exact review, respects cancellation and posts only the reviewed revision',async t=>{
  const row={name:'Distance',apiname:'DECIMAL',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewFloat:true}};
  const preview={appid:550,apiname:'DECIMAL',name:'Distance',canActivate:true,revision:'b'.repeat(64),counter:{statName:'DISTANCE',before:1.25,after:10.5,goal:10.5,min:0,max:100,maxChange:0},message:'Review the exact counter change.'};
  const w=ui(t,url=>url.includes('float-progress-preview')?preview:response([row]));w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');
  const review=w.document.querySelector('#achListContainer button');assert.equal(review.textContent,'Review progress');review.click();await new Promise(r=>setImmediate(r));
  let submitted,count=0,confirmation='';w.fetch=async(url,options)=>{if(url==='/api/achievement/unlock'){submitted=JSON.parse(options.body);count++;}return {ok:true,json:async()=>url==='/api/achievement/unlock'?{message:'Confirmed.'}:response([row])};};
  w.confirm=text=>{confirmation=text;return false;};w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.equal(count,0);assert.match(confirmation,/DISTANCE: 1.25 → 10.5/);assert.match(confirmation,/Only this counter will be sent/);assert.match(confirmation,/Steam may unlock this linked achievement/);
  w.confirm=()=>true;w.document.querySelector('#sharedProgressActions button').click();await new Promise(r=>setImmediate(r));assert.equal(count,1);assert.deepEqual(submitted,{confirmed:true,accountId:'a',appid:550,apiname:'DECIMAL',mode:'float',revision:'b'.repeat(64)});
});
test('decimal confirmation cannot submit after account or reading context changes',async t=>{
  const row={name:'Distance',apiname:'DECIMAL',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency'},progressSupport:{canPreviewFloat:true}};
  const preview={appid:550,apiname:'DECIMAL',name:'Distance',canActivate:true,revision:'b'.repeat(64),counter:{statName:'DISTANCE',before:1.25,after:10.5,goal:10.5,min:0,max:100,maxChange:0}};
  const w=ui(t,url=>url.includes('float-progress-preview')?preview:response([row]));w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');w.document.querySelector('#achListContainer button').click();await new Promise(r=>setImmediate(r));
  const confirm=w.document.querySelector('#sharedProgressActions button');w.testUI.select('other');w.confirm=()=>{throw Error('Stale review cannot confirm');};confirm.click();await new Promise(r=>setImmediate(r));
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
test('percentage descending sort puts most obtained first, keeps genuine zero and places unknowns last',async t=>{const w=ui(t,url=>url.includes('/percentages?')?{percentages:{},titlePercentages:{}}:response([{name:'Unknown A',unlocked:false},{name:'Rare',unlocked:false,percent:1},{name:'Common',unlocked:false,percent:90},{name:'Unknown B',unlocked:false},{name:'Zero',unlocked:false,percent:0}]));await w.testUI.open(550,'Game');const select=w.document.getElementById('achSortSelect');select.value='percentage_desc';select.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(el=>el.textContent),['Common','Rare','Zero','Unknown A','Unknown B']);});
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
test('one pending removal keeps the total, other status filters and eligible selections usable',async t=>{
  const rows=[{name:'Unlocked',apiname:'A',unlocked:true,percent:10,batchSupport:{canRemove:true}},{name:'Locked',apiname:'B',unlocked:false,percent:2,compatibility:{status:'provisional',canUnlock:true}},{name:'Pending removal',apiname:'C',unlocked:null,percent:4,compatibility:{status:'insufficient_data',code:'removal_library_pending',canUnlock:false,reason:'Awaiting removal confirmation.'},batchSupport:{canRemove:false,canReactivate:false}}];
  const w=ui(t,()=>({...response(rows),readingMethod:'protocol'}));w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'L4D2',false,'protocol');
  assert.match(w.document.getElementById('achProgressText').textContent,/1\/3 verified.*1 not verified/);assert.equal(w.document.querySelectorAll('.ach-select').length,2);
  w.testUI.filter('status','unlocked');assert.equal(w.document.querySelector('.ach-title').textContent,'Unlocked');w.testUI.filter('status','locked');assert.equal(w.document.querySelector('.ach-title').textContent,'Locked');
  w.testUI.filter('status','all');w.testUI.search('Pending removal');assert.equal(w.document.querySelectorAll('.ach-select').length,0);assert.equal(w.document.querySelectorAll('.ach-item button').length,0);
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
test('built-in panel supports English default and dynamic Spanish i18n switching',t=>{
  const w=ui(t,()=>response([]));
  const langSelect=w.document.getElementById('langSelect');
  assert.ok(langSelect);
  langSelect.value='es';
  langSelect.dispatchEvent(new w.Event('change'));
  assert.match(w.document.querySelector('.dashboard-panel .section-heading h2').textContent,/Resumen de sesión/);
  assert.match(w.document.getElementById('unlockAllAchievements').textContent,/Desbloquear todo/);
  langSelect.value='en';
  langSelect.dispatchEvent(new w.Event('change'));
  assert.match(w.document.querySelector('.dashboard-panel .section-heading h2').textContent,/Session overview/);
  assert.match(w.document.getElementById('unlockAllAchievements').textContent,/Unlock all/);
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
  await w.testUI.unlock(target);assert.deepEqual(submitted,{confirmed:true,accountId:'a',appid:550,apiname:'FIRST'});assert.equal(w.document.querySelector('.ach-item').textContent.includes('Locked'),true);
});
test('publisher requirements show explanatory context as text without inventing an activation restriction',async t=>{
  const w=ui(t,url=>url.startsWith('/api/game-requirements')?{facts:['<b>Publisher account</b>'],explanation:'An external launcher alone does not establish writability.',action:'Check the official game.',metadataAvailable:true,externalAccountOrSoftware:true,sourceUrl:'https://store.steampowered.com/app/123/'}:response([{name:'One',unlocked:false}]));
  await w.testUI.open(123,'Game');w.document.getElementById('gameRequirements').open=true;w.document.getElementById('gameRequirements').dispatchEvent(new w.Event('toggle'));await new Promise(resolve=>setImmediate(resolve));
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
  await w.testUI.completeProgress(target);assert.deepEqual(submitted,{confirmed:true,accountId:'a',appid:550,apiname:'TARGET',mode:'progress',revision:'b'.repeat(64)});
});
test('shared impact review displays all effect types as text and never submits an activation',async t=>{
  const urls=[];const row={name:'Shared',apiname:'TARGET',unlocked:false,hasProgressDependency:true,compatibility:{canUnlock:false},progressSupport:{canPreviewShared:true,canComplete:false}};
  const w=ui(t,url=>{urls.push(url);return url.startsWith('/api/achievement/shared-progress-preview')?{counter:{statName:'COUNT',before:5,after:100},effects:[{name:'<img src=x>',goal:10,effect:'would_unlock'},{name:'Later',goal:1000,effect:'progress_only'},{name:'Complex',effect:'unknown'}],message:'Read-only review.'}:response([row]);});w.testUI.activate({tokenSource:'environment'});await w.testUI.open(550,'Game',true,'protocol');await w.testUI.reviewShared(row);const panel=w.document.getElementById('sharedProgressReview');assert.equal(panel.hidden,false);assert.match(panel.textContent,/Would unlock/);assert.match(panel.textContent,/Impact unknown/);assert.equal(panel.querySelector('img'),null);assert.ok(!urls.includes('/api/achievement/unlock'));
});
test('write history renders receipts as text and does not infer unrecorded historical attempts',async t=>{
  const w=ui(t,()=>({entries:[{name:'<script>secret</script>',outcome:'requested',progressChanges:[{statName:'COUNT',before:0,after:1}]}]}));w.testUI.authenticate();await w.testUI.history();const list=w.document.getElementById('historyList');assert.match(list.textContent,/COUNT: 0 → 1/);assert.equal(list.querySelector('script'),null);
});

test('community fallback exposes an explicit read-only entry to achievement changes',async t=>{
  const calls=[],w=ui(t,url=>{calls.push(url);return {...response([{name:'Target',apiname:'A',unlocked:false,compatibility:{status:'provisional',canUnlock:true}}]),readingMethod:url.includes('method=protocol')?'protocol':'web'};});w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'auto');
  const bar=w.document.getElementById('achievementSelectionBar'),verify=w.document.getElementById('verifyAchievementChanges'),review=w.document.getElementById('reviewAchievementSelection');assert.equal(bar.hidden,false);assert.equal(verify.hidden,false);assert.equal(verify.disabled,false);assert.match(w.document.getElementById('achievementSelectionHint').textContent,/selection boxes/);assert.equal(w.document.querySelectorAll('.ach-select').length,0);
  verify.click();await new Promise(r=>setImmediate(r));assert.ok(calls.some(u=>u.includes('method=protocol')&&u.includes('refresh=1')));assert.equal(verify.hidden,true);assert.equal(review.hidden,false);assert.equal(review.disabled,true);const check=w.document.querySelector('.ach-select');check.checked=true;check.dispatchEvent(new w.Event('change'));assert.equal(review.disabled,false);assert.ok(!calls.some(u=>u.includes('/change')||u.includes('/unlock')));
});
test('unlocked achievements have explicit removal review and unavailable reads explain the actual reason',async t=>{
  const calls=[],rows=[{name:'Panel unlock',apiname:'B',unlocked:true,batchSupport:{canRemove:true},lastWriteOutcome:'confirmed'},{name:'Natural',apiname:'C',unlocked:true,batchSupport:{canRemove:false,removalReason:'Statistics version is unavailable.'}}],w=ui(t,url=>{calls.push(url);return url==='/api/achievement/change-preview'?{selection:[{apiname:'B',action:'remove'}],effects:[{apiname:'B',name:'Panel unlock',action:'remove'}],progressChanges:[],canActivate:true,message:'Reviewed',revision:'a'.repeat(64)}:{...response(rows),readingMethod:'protocol'};});w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(550,'Game',false,'protocol');
  const controls=[...w.document.querySelectorAll('#achListContainer button')].filter(b=>b.textContent==='Review removal');assert.equal(controls.length,1);assert.match(w.document.getElementById('achListContainer').textContent,/Statistics version is unavailable/);controls[0].click();await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('sharedProgressEffects').textContent,/Will remove/);assert.ok(calls.includes('/api/achievement/change-preview'));assert.ok(!calls.includes('/api/achievement/change'));
});
test('disconnected or additional accounts do not expose an enabled verification shortcut',async t=>{
  for(const profile of [{tokenSource:'environment',connected:false},{tokenSource:'saved',connected:true}]){const w=ui(t,()=>({...response([{name:'A',unlocked:false}]),readingMethod:'web'}));w.testUI.activate(profile);await w.testUI.open(550,'Game',false,'web');const button=w.document.getElementById('verifyAchievementChanges');assert.ok(button.hidden||button.disabled);assert.match(w.document.getElementById('achievementSelectionHint').textContent,/main account/);}
});

test('direct readings automatically load global rarity without clicking a filter and preserve selection',async t=>{
  let release;const lookup=new Promise(r=>release=r),calls=[],w=ui(t,url=>{calls.push(url);return url.includes('/percentages?')?lookup:response([{name:'Epic',apiname:'A',unlocked:false,compatibility:{status:'provisional',canUnlock:true}},{name:'Mythic',apiname:'B',unlocked:true}]);});w.testUI.activate({tokenSource:'environment',connected:true});await w.testUI.open(240,'Game',false,'protocol');await new Promise(r=>setImmediate(r));assert.equal(calls.filter(u=>u.includes('/percentages?')).length,1,w.document.getElementById('achListContainer').textContent);const check=w.document.querySelector('.ach-select');check.checked=true;check.dispatchEvent(new w.Event('change'));release({percentages:{A:10,B:2}});await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('achListContainer').textContent,/Epic · 10.0%/);assert.equal(w.document.querySelector('.ach-select').checked,true);assert.equal(w.document.querySelectorAll('.verified').length,1);assert.ok(!calls.some(u=>u.includes('/change')));
});
test('uniform 100% is unverified, never all common; explicit retry recovers Mythic and Epic',async t=>{
  let retries=0;const calls=[],w=ui(t,url=>{calls.push(url);if(url.includes('/percentages?'))return url.includes('refresh=1')?(retries++,{percentages:{A:2,B:10}}):{percentages:{A:100,B:100},rarityStatus:'suspect_uniform_100',rarityMessage:'Steam returned 100% for every achievement. Rarity cannot be verified.'};return response([{name:'One',apiname:'A',unlocked:true,percent:100,tier:'Common'},{name:'Two',apiname:'B',unlocked:false,percent:100,tier:'Common'}]);});await w.testUI.open(550,'L4D2',false,'protocol');await new Promise(r=>setImmediate(r));assert.doesNotMatch(w.document.getElementById('achListContainer').textContent,/Common|100.0%/);assert.match(w.document.getElementById('achRarityMessage').textContent,/100%/);w.document.getElementById('retryAchievementRarity').click();await new Promise(r=>setImmediate(r));assert.equal(retries,1);w.testUI.filter('rarity','mythic');assert.equal(w.document.querySelector('.ach-title').textContent,'One');w.testUI.filter('rarity','epic');assert.equal(w.document.querySelector('.ach-title').textContent,'Two');assert.equal(calls.filter(u=>u.includes('/api/achievements?')).length,1);
});
test('percentage formatting rejects coercible or out-of-range data and derives its tier',async t=>{
  const w=ui(t,()=>response([{name:'Bad boolean',percent:true,unlocked:false},{name:'Bad negative',percent:-1,unlocked:false},{name:'Bad high',percent:101,unlocked:false},{name:'Bad blank',percent:' ',unlocked:false},{name:'Epic',percent:'10',tier:'Common',unlocked:false}]));await w.testUI.open(240,'Game',false,'web');assert.equal([...w.document.querySelectorAll('.ach-info small')].filter(e=>e.textContent==='Unknown rarity').length,4);assert.match(w.document.getElementById('achListContainer').textContent,/Epic · 10.0%/);
});
test('status sorts keep unknown personal states last and preserve order within each state',async t=>{
  const w=ui(t,()=>response([{name:'Locked 1',unlocked:false,percent:10},{name:'Unknown',unlocked:null,percent:20},{name:'Unlocked 1',unlocked:true,percent:30},{name:'Unlocked 2',unlocked:true,percent:40},{name:'Locked 2',unlocked:false,percent:50}]));await w.testUI.open(240,'Game',false,'web');const sort=w.document.getElementById('achSortSelect');sort.value='unlocked_first';sort.dispatchEvent(new w.Event('change'));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(e=>e.textContent),['Unlocked 1','Unlocked 2','Locked 1','Locked 2','Unknown']);sort.value='locked_first';sort.dispatchEvent(new w.Event('change'));assert.deepEqual([...w.document.querySelectorAll('.ach-title')].map(e=>e.textContent),['Locked 1','Locked 2','Unlocked 1','Unlocked 2','Unknown']);
});

test('Unlock all, Lock all with counter reset toggle, and Select page buttons review and submit bulk operations',async t=>{
  const rows=[
    {name:'Locked One',apiname:'L1',unlocked:false,compatibility:{status:'provisional',canUnlock:true}},
    {name:'Locked Two',apiname:'L2',unlocked:false,hasProgressDependency:true,compatibility:{status:'dependency',canUnlock:false},progressSupport:{canComplete:true}},
    {name:'Unlocked One',apiname:'U1',unlocked:true,batchSupport:{canRemove:true},removalSupport:{canRemove:true}}
  ];
  const calls=[];
  const unlockPreview={bulk:true,bulkAction:'unlock_all',selection:[{apiname:'L1',action:'unlock'},{apiname:'L2',action:'unlock'}],effects:[{apiname:'L1',name:'Locked One',action:'unlock',progressChanges:[]},{apiname:'L2',name:'Locked Two',action:'unlock',progressChanges:[{statName:'COUNT',before:0,after:10}]}],progressChanges:[{statName:'COUNT',before:0,after:10}],canActivate:true,revision:'c'.repeat(64),message:'Review unlock all.'};
  const lockPreview=(reset)=>({bulk:true,bulkAction:'lock_all',resetCounters:reset,selection:[{apiname:'U1',action:'remove'}],effects:[{apiname:'U1',name:'Unlocked One',action:'remove',progressChanges:reset?[{statName:'COUNT',before:10,after:0}]:[]}],progressChanges:reset?[{statName:'COUNT',before:10,after:0}]:[],canActivate:true,revision:(reset?'d':'e').repeat(64),message:'Review lock all.'});
  const w=ui(t,url=>({...response(rows),readingMethod:'protocol'}));
  w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});
  await w.testUI.open(550,'Game',false,'protocol');

  const unlockAllBtn=w.document.getElementById('unlockAllAchievements');
  const lockAllBtn=w.document.getElementById('lockAllAchievements');
  const selectPageBtn=w.document.getElementById('selectPageAchievements');
  assert.equal(unlockAllBtn.hidden,false);assert.equal(unlockAllBtn.disabled,false);
  assert.equal(lockAllBtn.hidden,false);assert.equal(lockAllBtn.disabled,false);
  assert.equal(selectPageBtn.hidden,false);assert.equal(selectPageBtn.disabled,false);

  // Select page selects all 3 eligible rows and clicking again clears selection
  selectPageBtn.click();
  assert.equal(w.document.querySelectorAll('.ach-select:checked').length,3);
  selectPageBtn.click();
  assert.equal(w.document.querySelectorAll('.ach-select:checked').length,0);

  let lastPayload;
  w.fetch=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):undefined;
    calls.push({url,body});
    if(url==='/api/achievement/change-preview'){
      if(body.bulkAction==='unlock_all')return {ok:true,status:200,json:async()=>unlockPreview};
      if(body.bulkAction==='lock_all')return {ok:true,status:200,json:async()=>lockPreview(Boolean(body.resetCounters))};
    }
    if(url==='/api/achievement/change'){lastPayload=body;return {ok:true,status:200,json:async()=>({message:'Bulk confirmed.'})};}
    return {ok:true,status:200,json:async()=>({...response(rows),readingMethod:'protocol'})};
  };

  unlockAllBtn.click();
  await new Promise(r=>setImmediate(r));
  assert.match(w.document.querySelector('#sharedProgressReview h3').textContent,/Unlock all/);
  assert.match(w.document.getElementById('sharedProgressSummary').textContent,/2 to unlock · 0 to remove/);
  w.confirm=()=>true;
  w.document.querySelector('#sharedProgressActions button').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(lastPayload.bulk,true);
  assert.equal(lastPayload.bulkAction,'unlock_all');
  assert.equal(lastPayload.revision,'c'.repeat(64));

  lockAllBtn.click();
  await new Promise(r=>setImmediate(r));
  assert.match(w.document.querySelector('#sharedProgressReview h3').textContent,/Lock all/);
  const resetToggle=w.document.getElementById('bulkResetCountersToggle');
  assert.ok(resetToggle);
  assert.equal(resetToggle.checked,false);
  resetToggle.checked=true;
  resetToggle.dispatchEvent(new w.Event('change'));
  await new Promise(r=>setImmediate(r));
  assert.match(w.document.getElementById('sharedProgressSummary').textContent,/COUNT: 10 → 0/);
  w.document.querySelector('#sharedProgressActions button').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(lastPayload.bulk,true);
  assert.equal(lastPayload.bulkAction,'lock_all');
  assert.equal(lastPayload.resetCounters,true);
  assert.equal(lastPayload.revision,'d'.repeat(64));
});

test('SamRewritten tabs, live 1-click controls, Invert page, Statistics editor, Timed schedule, Copy Timings, Undo, and Multi-Game bulk buttons work end-to-end',async t=>{
  const liveRows=[
    {name:'First',apiname:'A1',unlocked:false,statId:1,bitIndex:0,compatibility:{status:'provisional',canUnlock:true}},
    {name:'Second',apiname:'A2',unlocked:true,statId:1,bitIndex:1,batchSupport:{canRemove:true},removalSupport:{canRemove:true}}
  ];
  const calls=[];
  const w=ui(t,url=>({...response(liveRows),readingMethod:'protocol',statistics:[{statId:2,name:'KILLS',type:'INT',value:15,min:0,max:100,incrementOnly:false,permission:0,writable:true}]}));
  w.testUI.authenticate();w.testUI.activate({tokenSource:'environment',connected:true});
  w.fetch=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):undefined;
    calls.push({url,method:options?.method||'GET',body});
    if(url.startsWith('/api/stats')&&(!options?.method||options.method==='GET'))return {ok:true,status:200,json:async()=>({stats:[{statId:2,name:'KILLS',type:'INT',value:15,min:0,max:100,incrementOnly:false,permission:0,writable:true}]})};
    if(url==='/api/stats'&&options?.method==='POST')return {ok:true,status:200,json:async()=>({outcome:'confirmed',message:'Updated 1 statistic.',stats:[{statId:2,name:'KILLS',type:'INT',value:99,min:0,max:100,incrementOnly:false,permission:0,writable:true}]})};
    if(url.startsWith('/api/achievement/timed')&&(!options?.method||options.method==='GET'))return {ok:true,status:200,json:async()=>({active:false})};
    if(url==='/api/achievement/timed'&&options?.method==='POST')return {ok:true,status:200,json:async()=>({active:body.action!=='cancel',completedCount:0,totalCount:2,bulkAction:'unlock_all',nextAt:new Date().toISOString()})};
    if(url.startsWith('/api/achievement/analytics'))return {ok:true,status:200,json:async()=>({analytics:{total:2,unlocked:1,locked:1,completionPercent:50,datedUnlockedCount:1,undatedUnlockedCount:0,firstUnlockTimestamp:1700000000,lastUnlockTimestamp:1700000000,averageHoursBetweenUnlocks:0,bursts:[],timeline:[{date:'2023-11-14',count:1}]}})};
    if(url==='/api/achievement/undo')return {ok:true,status:200,json:async()=>({outcome:'confirmed',message:'Last operation reverted.'})};
    if(url==='/api/achievement/copy-timings')return {ok:true,status:200,json:async()=>({outcome:'confirmed',matchedCount:2,message:'Unlocked 2 achievements.'})};
    if(url==='/api/achievement/change')return {ok:true,status:200,json:async()=>({outcome:'confirmed',message:'Applied.'})};
    if(url==='/api/achievement/bulk-apps')return {ok:true,status:200,json:async()=>({succeeded:1,total:1,message:'Completed.'})};
    return {ok:true,status:200,json:async()=>({...response(liveRows),readingMethod:'protocol',statistics:[{statId:2,name:'KILLS',type:'INT',value:15,min:0,max:100,incrementOnly:false,permission:0,writable:true}]})};
  };
  await w.testUI.open(550,'Game',false,'protocol');

  // Verify live protocol mode renders simplified 1-click Unlock & Lock buttons
  const rowButtons=[...w.document.querySelectorAll('#achListContainer .ach-item button')].map(b=>b.textContent);
  assert.ok(rowButtons.includes('Unlock'));
  assert.ok(rowButtons.includes('Lock'));

  // Verify 0ms Optimistic UI: clicking Unlock immediately flips row to Verified & Lock button in 0ms without waiting for network or calling openAchModal
  let resolveChange;
  const prevFetch = w.fetch;
  const achCallsDuringApply = [];
  w.fetch = (url, options) => {
    if (url.startsWith('/api/achievements')) achCallsDuringApply.push(url);
    if (url === '/api/achievement/change') {
      return new Promise(r => {
        resolveChange = () => r({ ok: true, status: 200, json: async () => ({ outcome: 'confirmed', message: 'Applied in background.' }) });
      });
    }
    return prevFetch(url, options);
  };
  const unlockBtn = [...w.document.querySelectorAll('#achListContainer .ach-item button')].find(b => b.textContent === 'Unlock');
  unlockBtn.click();
  // Immediately (0 ms, before resolveChange is called!), the first row is already unlocked and shows 'Lock' (never stuck in 'Applying…')
  const immediateButtons = [...w.document.querySelectorAll('#achListContainer .ach-item button')].map(b => b.textContent);
  assert.ok(!immediateButtons.includes('Applying…'), 'Buttons must not freeze in Applying…');
  assert.deepEqual(immediateButtons, ['Lock', 'Lock']);
  resolveChange();
  await new Promise(r => setImmediate(r));
  assert.equal(achCallsDuringApply.length, 0, 'directApplyChanges must not re-download the achievement list via openAchModal');
  // Restore A1 to locked for the next assertions in this test
  const firstLockBtn = w.document.querySelector('#achListContainer .ach-item button');
  w.fetch = prevFetch;
  firstLockBtn.click();
  await new Promise(r => setImmediate(r));

  // Invert page selects all eligible rows (both locked and unlocked)
  const invertBtn=w.document.getElementById('invertPageAchievements');
  assert.equal(invertBtn.hidden,false);
  invertBtn.click();
  assert.equal(w.document.querySelectorAll('.ach-select:checked').length,2);

  // Switch to Statistics tab and save edited stat
  w.document.getElementById('tabStatsBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(w.document.getElementById('achStatsPanel').hidden,false);
  const statInput=w.document.querySelector('.sam-stat-input');
  assert.ok(statInput);
  statInput.value='99';
  statInput.dispatchEvent(new w.Event('input'));
  w.document.getElementById('saveStatsBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(c=>c.url==='/api/stats'&&c.method==='POST'&&c.body?.changes?.[0]?.value===99));

  // Switch to Tools & Timed tab and trigger Timed schedule, Copy Timings, and Undo
  w.document.getElementById('tabToolsBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(w.document.getElementById('achToolsPanel').hidden,false);
  w.document.getElementById('startTimedBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(c=>c.url==='/api/achievement/timed'&&c.method==='POST'));

  w.document.getElementById('startPlatinumBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(c=>c.url==='/api/achievement/timed'&&c.method==='POST'&&c.body?.spacing==='platinum'&&c.body?.order==='progression'));

  w.document.getElementById('copyTimingsSourceInput').value='https://steamcommunity.com/id/example';
  w.document.getElementById('copyTimingsBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(c=>c.url==='/api/achievement/copy-timings'&&c.method==='POST'));

  w.document.getElementById('undoLastOperationBtn').click();
  await new Promise(r=>setImmediate(r));
  assert.ok(calls.some(c=>c.url==='/api/achievement/undo'&&c.method==='POST'));

  // Verify mobile responsive CSS and clean onboarding state with zero pre-loaded accounts
  const cssText=fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8');
  assert.match(cssText,/@media\s*\(max-width:\s*768px\)/);
  assert.match(cssText,/@media\s*\(max-width:\s*600px\)/);
  assert.match(cssText,/#lockModal\s*\{[^}]*display:\s*none\s*!important/);
  const cfgJson=JSON.parse(fs.readFileSync(path.join(__dirname,'../config.json'),'utf8'));
  assert.deepEqual(cfgJson.accounts,[]);
  assert.ok(w.document.getElementById('automationsPanel'));
  assert.ok(w.document.getElementById('achToastContainer'));
  assert.ok(w.document.getElementById('marketIdentitySecretInput'));
});

test("Guest Demo / Showcase Mode, View Selector, Sound & Streamer Mode, Net Estimator, Badge Crafter, Cluster & Showcase Card work end-to-end", async t => {
  const demoRows = [
    { apiname: "TF_MYTHIC", name: "First Do No Harm", description: "Score highest without killing", unlocked: false, percent: 3.1, tier: "Mythic" },
    { apiname: "TF_COMMON", name: "Sentry Gunner", description: "10 sentry kills", unlocked: true, percent: 64.2, tier: "Common" }
  ];
  const demoStats = [
    { statId: 101, name: "TF_STATS_KILLS", displayName: "Total Eliminations", type: "INT", value: 1420, min: 0, max: 1000000, writable: true },
    { statId: 103, name: "TF_STATS_ACCURACY_RATIO", displayName: "Weapon Accuracy Ratio", type: "FLOAT", value: 0.425, min: 0, max: 1, writable: true }
  ];
  const calls = [];
  const w = ui(t, url => {
    calls.push(url);
    if (url === "/api/status") {
      return {
        accounts: [],
        demoCatalog: [
          { id: 440, name: "Team Fortress 2" },
          { id: 730, name: "Counter-Strike 2" },
          { id: 620, name: "Portal 2" },
          { id: 550, name: "Left 4 Dead 2" }
        ],
        presets: [],
        timezone: "America/Montevideo"
      };
    }
    if (url.startsWith("/api/achievements?accountId=demo")) {
      return {
        appid: 440,
        demoMode: true,
        readingMethod: "web",
        source: "Steam Public Showcase",
        message: "Modo Demostración: Conecta tu cuenta de Steam para aplicar cambios en vivo",
        checkedAt: new Date().toISOString(),
        achievements: demoRows,
        statistics: demoStats
      };
    }
    if (url.startsWith("/api/stats?accountId=demo")) {
      return { appid: 440, demoMode: true, stats: demoStats };
    }
    if (url.startsWith("/api/achievement/analytics?accountId=demo")) {
      return { appid: 440, demoMode: true, unlockedCount: 1, totalAchievements: 2, completionPercent: 50, totalStats: 2, protectedCount: 0, hiddenCount: 0 };
    }
    return response(demoRows);
  });

  w.testUI.authenticate();
  w.testUI.select("");
  w.testUI.activate(null);
  await w.testUI.load();

  // 1. Verify Guest Page Reorganization (No fake metrics, session controls hidden, library directly below 6 feature cards) & Pure i18n
  const saasLanding = w.document.getElementById("saasLandingSection");
  const libSection = w.document.getElementById("librarySection");
  assert.ok(saasLanding && libSection);
  assert.equal(saasLanding.hidden, false);
  const mainEls = saasLanding.parentNode.children; assert.equal(mainEls[mainEls.indexOf(saasLanding) + 1], libSection);
  assert.equal(w.document.getElementById("playBtn").hidden, true);
  assert.equal(w.document.getElementById("cardsBtn").hidden, true);
  assert.equal(w.document.getElementById("personaBtn").hidden, true);
  assert.equal(w.document.getElementById("sessionOverviewPanel").hidden, true);
  assert.equal(w.document.getElementById("accountsBarSection").hidden, true);
  assert.equal(w.document.getElementById("gameControlsSection").hidden, true);
  assert.equal(w.document.getElementById("headerGuestConnectBtn").hidden, false);

  // Verify pure English default (no mixed Spanish+English) and immediate pure Spanish translation via #langSelect
  assert.equal(w.document.getElementById("landingHeroTitle").textContent, "Autonomous Steam Cloud Control Room");
  assert.match(w.document.getElementById("demoBannerContainer").textContent, /Demo Mode: Connect your Steam account to apply changes live/);
  const langSelect = w.document.getElementById("langSelect");
  langSelect.value = "es";
  langSelect.dispatchEvent(new w.Event("change"));
  assert.equal(w.document.getElementById("landingHeroTitle").textContent, "Tu Centro de Control Autónomo para Steam");
  assert.match(w.document.getElementById("demoBannerContainer").textContent, /Modo Demostración: Conecta tu cuenta de Steam para aplicar cambios en vivo/);

  assert.equal(w.document.querySelectorAll(".landing-feature-card").length, 6);
  assert.equal(w.document.querySelectorAll(".floating-card").length, 3);
  assert.equal(w.document.querySelectorAll(".glow-blob").length, 0);
  assert.equal(w.document.querySelectorAll(".landing-trust-row .trust-item").length, 4);
  assert.ok(w.document.querySelector(".corner-toolbar #langSelect"));
  assert.ok(w.document.querySelector(".corner-toolbar #btnOledTheme"));
  assert.ok(w.document.querySelector(".corner-toolbar #btnSoundToggle"));
  const demoCards = w.document.querySelectorAll("#gamesGrid .demo-card");
  assert.equal(demoCards.length, 4);
  assert.match(w.document.getElementById("gamesGrid").textContent, /Team Fortress 2/);
  assert.match(w.document.getElementById("gamesGrid").textContent, /Counter-Strike 2/);
  assert.match(w.document.getElementById("gamesGrid").textContent, /Portal 2/);
  assert.match(w.document.getElementById("gamesGrid").textContent, /Left 4 Dead 2/);

  // 2. Open TF2 achievement modal in Guest Demo Mode and verify Demo banner, Rarity filter, INT/FLOAT Stats & Timed tab
  demoCards[0].querySelector(".btn-card-ach").click();
  await new Promise(r => setImmediate(r));
  assert.equal(w.document.getElementById("achModal").style.display, "flex");
  assert.match(w.document.getElementById("achReadMessage").textContent, /Modo Demostración/);
  w.testUI.filter("rarity", "mythic");
  assert.equal(w.document.querySelectorAll("#achListContainer .ach-item").length, 1);
  assert.match(w.document.querySelector("#achListContainer .ach-title").textContent, /First Do No Harm/);

  w.document.getElementById("tabStatsBtn").click();
  await new Promise(r => setImmediate(r));
  assert.match(w.document.getElementById("statsListContainer").textContent, /Total Eliminations/);
  assert.match(w.document.getElementById("statsListContainer").textContent, /FLOAT/);

  w.document.getElementById("tabToolsBtn").click();
  await new Promise(r => setImmediate(r));
  assert.match(w.document.getElementById("timedStatusText").textContent, /Modo Demostración/);
  w.testUI.close();

  // 3. Verify Library View Selector (Grid vs Compact List)
  const gridEl = w.document.getElementById("gamesGrid");
  w.document.getElementById("btnViewList").click();
  assert.equal(gridEl.classList.contains("list-view"), true);
  w.document.getElementById("btnViewGrid").click();
  assert.equal(gridEl.classList.contains("list-view"), false);

  // 4. Verify Task Center Colored Status Cards
  assert.ok(w.document.getElementById("taskCardFarming").classList.contains("status-green"));
  assert.ok(w.document.getElementById("taskCardCards").classList.contains("status-purple"));
  assert.ok(w.document.getElementById("taskCardTimed").classList.contains("status-blue"));

  // 5. Verify Sound Mute Toggle & Streamer / Privacy Mode masking
  const soundBtn = w.document.getElementById("btnSoundToggle");
  assert.match(soundBtn.textContent, /Sound: ON/);
  soundBtn.click();
  assert.match(soundBtn.textContent, /Sound: OFF/);

  const connectedAcc = {
    id: "acc1",
    name: "BrunoMain",
    profileName: "BrunoSteam",
    linkedSteamId: "76561198012345678",
    connected: true,
    webSessionReady: true,
    isFarming: true,
    runningGames: [730],
    games: [730],
    gameNames: { 730: "Counter-Strike 2" },
    cardFarming: true,
    cardsReady: true,
    cardDropGames: [{ appid: 730, name: "Counter-Strike 2", remaining: 3, hoursPlayed: 4.5 }],
    craftableBadges: [{ appid: 730, name: "Counter-Strike 2", craftable: true }],
    sleepMode: { enabled: false, start: 3, end: 8 }
  };
  w.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => url === "/api/status" ? { accounts: [connectedAcc], presets: [], timezone: "America/Montevideo" } : {}
  });
  w.testUI.select("acc1");
  await w.testUI.load();
  assert.equal(w.document.getElementById("saasLandingSection").hidden, true);
  assert.match(w.document.getElementById("userLabel").textContent, /BrunoMain/);
  assert.match(w.document.getElementById("connectionDetails").textContent, /76561198012345678/);

  const streamerBtn = w.document.getElementById("btnStreamerMode");
  streamerBtn.click();
  assert.equal(w.document.body.classList.contains("streamer-mode"), true);
  assert.doesNotMatch(w.document.getElementById("userLabel").textContent, /BrunoMain/);
  assert.doesNotMatch(w.document.getElementById("connectionDetails").textContent, /76561198012345678/);
  assert.match(w.document.getElementById("connectionDetails").textContent, /76561••••••/);

  // 6. Verify Steam Showcase Card Generator modal & canvas summary
  w.document.getElementById("btnShowcaseCard").click();
  assert.equal(w.document.getElementById("showcaseModal").style.display, "flex");
  const canvas = w.document.getElementById("showcaseCanvas");
  assert.equal(canvas.dataset.rendered, "true");
  assert.match(canvas.dataset.summary, /100% Games:/);
  w.document.getElementById("closeShowcaseBtn").click();
  assert.equal(w.document.getElementById("showcaseModal").style.display, "none");

  // 7. Verify v46: 384MB RAM config, OLED Pure Black theme, SteamDB + Steam Deck badges, Badge Crafting Calculator, and 3-column Pro Footer
  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.match(pkgJson.scripts.start, /--max-old-space-size=384/);
  assert.match(pkgJson.scripts.start, /--max-semi-space-size=16/);
  const { ResourceBudget } = require("../lib/resources");
  assert.equal(new ResourceBudget().softLimit, 420 * 1024 * 1024);

  const oledBtn = w.document.getElementById("btnOledTheme");
  assert.ok(oledBtn);
  oledBtn.click();
  assert.equal(w.document.body.classList.contains("oled-theme"), true);
  assert.match(oledBtn.textContent, /OLED: ON/);
  oledBtn.click();
  assert.equal(w.document.body.classList.contains("oled-theme"), false);

  assert.ok(w.document.querySelector(".steamdb-badge"));
  assert.ok(w.document.querySelector(".deck-badge"));
  assert.ok(w.document.querySelector(".badge-set-pill"));
  assert.ok(w.document.querySelector(".badge-calc-btn"));
  assert.ok(w.document.querySelector("footer.pro-footer"));
  assert.match(w.document.querySelector("footer.pro-footer").textContent, /v2\.4\.0/);
  assert.match(w.document.querySelector("footer.pro-footer").textContent, /github\.com\/brunnnno\/steam-farmer/);
  // 8. Verify Connected Layout Visibility, SAM In-Game inspect-start/inspect-stop, SEO Meta tags, Keyboard Shortcuts ('/' & Escape), and Offline/Online Banner
  assert.equal(w.document.getElementById("playBtn").hidden, false);
  assert.equal(w.document.getElementById("cardsBtn").hidden, false);
  assert.equal(w.document.getElementById("personaBtn").hidden, false);
  assert.equal(w.document.getElementById("sessionOverviewPanel").hidden, false);
  assert.equal(w.document.getElementById("accountsBarSection").hidden, false);
  assert.equal(w.document.getElementById("gameControlsSection").hidden, false);
  assert.equal(w.document.getElementById("headerGuestConnectBtn").hidden, true);

  const inspectCalls = [];
  w.fetch = async (url, opts) => {
    inspectCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => response(demoRows) };
  };
  await w.testUI.open(730, "Counter-Strike 2", false, "protocol");
  assert.ok(inspectCalls.some(c => c.url === "/api/game/inspect-start" && c.body?.accountId === "acc1" && c.body?.appid === 730));

  // Verify '/' shortcut focuses #achSearchInput when achievement modal is open
  w.document.body.focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement, w.document.getElementById("achSearchInput"));

  // Verify Escape closes the modal and triggers /api/game/inspect-stop
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(w.document.getElementById("achModal").style.display, "none");
  assert.ok(inspectCalls.some(c => c.url === "/api/game/inspect-stop" && c.body?.accountId === "acc1"));

  // Verify '/' shortcut focuses #searchInput when modal is closed
  w.document.body.focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement, w.document.getElementById("searchInput"));

  // Verify Offline / Online network detector banner
  const netBanner = w.document.getElementById("networkStatusBanner");
  assert.ok(netBanner);
  assert.equal(netBanner.hidden, true);
  w.dispatchEvent(new w.Event("offline"));
  assert.equal(netBanner.hidden, false);
  assert.equal(netBanner.classList.contains("offline"), true);
  w.dispatchEvent(new w.Event("online"));
  assert.equal(netBanner.classList.contains("online"), true);

  // Verify SEO, OpenGraph, Twitter Card & Network preconnect tags in <head>
  assert.ok(w.document.querySelector('meta[property="og:title"]'));
  assert.ok(w.document.querySelector('meta[property="og:image"]'));
  assert.ok(w.document.querySelector('meta[name="twitter:card"]'));
  assert.ok(w.document.querySelector('link[rel="dns-prefetch"][href="https://community.cloudflare.steamstatic.com"]'));

  // 9. Verify v50 Overhaul: SteamDB Achievement Table (#achTableBody), Column Sorting, Achievement Sets (#achSetsNav), Badge Crafter Panel & Claim Daily Points
  const setRows = [
    { apiname: "BASE_1", name: "Zulu Base", description: "Base desc", unlocked: false, percent: 55.0, tier: "Common", set_id: "base", set_name: "Base Game", unlockTimestamp: 0 },
    { apiname: "DLC_1", name: "Alpha DLC", description: "DLC desc", unlocked: true, percent: 4.0, tier: "Mythic", set_id: "dlc_1", set_name: "Expansion Pack 1", unlockTimestamp: 1700000500 }
  ];
  w.fetch = async (url, opts) => {
    if (url === "/api/points/claim-daily") {
      return { ok: true, status: 200, json: async () => ({ ok: true, message: "Daily Points Shop item claimed!" }) };
    }
    return { ok: true, status: 200, json: async () => response(setRows) };
  };
  await w.testUI.open(730, "Counter-Strike 2", true, "protocol");
  assert.ok(w.document.querySelector(".ach-table-wrap table.ach-table tbody#achTableBody"));
  assert.equal(w.document.getElementById("achSetsNav").hidden, false);
  assert.equal(w.document.querySelectorAll("#achSetsNav .ach-set-btn").length, 3);

  // Click column header to sort by Achievement Name ascending ('Alpha DLC' first, 'Zulu Base' second)
  const thName = w.document.querySelector('.ach-table thead th[data-sort="name"]');
  assert.ok(thName);
  thName.click();
  assert.equal(w.document.querySelector('.ach-table thead th[data-sort="name"]').classList.contains("sort-asc"), true);
  assert.deepEqual([...w.document.querySelectorAll("#achTableBody .ach-title")].map(e => e.textContent), ["Alpha DLC", "Zulu Base"]);

  // Filter by DLC set button
  const dlcSetBtn = w.document.querySelector('#achSetsNav .ach-set-btn[data-set="dlc_1"]');
  dlcSetBtn.click();
  assert.equal(w.document.querySelectorAll("#achTableBody tr.ach-item").length, 1);
  assert.equal(w.document.querySelector("#achTableBody .ach-title").textContent, "Alpha DLC");
  w.testUI.close();

  // Verify Badge Crafter <details> panel and Claim Daily Points button
  assert.ok(w.document.querySelector("details.badge-crafter-panel #craftableBadgesCount"));
  const claimPointsBtn = w.document.getElementById("claimDailyPointsBtn");
  assert.ok(claimPointsBtn);
  claimPointsBtn.click();
  await new Promise(r => setImmediate(r));
  assert.match(w.document.getElementById("discoveryQueueStatus").textContent, /Daily Points Shop item claimed/);

  const fullCss = fs.readFileSync(path.join(__dirname, "../public/style.css"), "utf8");
  assert.match(fullCss, /max-width:\s*1720px/);
  assert.match(fullCss, /repeat\(auto-fill,\s*minmax\(240px,\s*1fr\)\)/);
  assert.match(fullCss, /\.corner-toolbar/);
  assert.match(fullCss, /\.utility-bar/);
  assert.match(fullCss, /\.ach-table/);
  assert.match(fullCss, /\.landing-trust-row/);

  // 10. Verify Force Resume (Clear Collision) on #playBtn and Cancel All Active Schedules (#cancelAllTimedBtn)
  const uiActionCalls = [];
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    uiActionCalls.push({ url, body });
    if (url === "/api/status") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [{
            id: "acc1",
            name: "Main",
            user: "mainuser",
            connected: true,
            webSessionReady: true,
            tokenSource: "environment",
            tokenAccountMatches: true,
            isFarming: false,
            isPaused: false,
            isCollisionPaused: true,
            games: [730],
            gameNames: { 730: "Counter-Strike 2" },
            runningGames: [],
            activeTimedJobs: [{ appid: 690790, totalCount: 10, completedCount: 3, pausedByCollision: true }],
            sleepMode: { enabled: false, start: 3, end: 8 }
          }],
          presets: [],
          timezone: "UTC"
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, cancelledCount: 1, message: "OK" }) };
  };
  await w.testUI.load();
  const playBtn = w.document.getElementById("playBtn");
  assert.match(playBtn.textContent, /Forzar Reanudar|Force Resume/);
  playBtn.click();
  await new Promise(r => setImmediate(r));
  assert.ok(uiActionCalls.some(c => c.url === "/api/clear-collision" && c.body?.accountId === "acc1"));

  const cancelAllBtn = w.document.getElementById("cancelAllTimedBtn");
  assert.ok(cancelAllBtn);
  cancelAllBtn.click();
  await new Promise(r => setImmediate(r));
  assert.ok(uiActionCalls.some(c => c.url === "/api/achievement/timed/cancel-all" && c.body?.accountId === "acc1"));

  // 11. Verify v51: Native Windows/Browser Notification API on unlock, [Base] & [DLC] row badges, dual Base/Total progress bar, and Base-Game Completed Showcase rule
  const desktopNotifications = [];
  w.Notification = function FakeNotification(title, options) {
    desktopNotifications.push({ title, options });
  };
  w.Notification.permission = "granted";

  const v51SetRows = [
    { apiname: "BASE_1", name: "Base Story", description: "Finish campaign", unlocked: true, percent: 65.0, tier: "Common", set_id: "base", set_name: "Base Game", statId: 1, bitIndex: 0, batchSupport: { canRemove: true } },
    { apiname: "DLC_1", name: "DLC Boss", description: "Defeat expansion boss", unlocked: false, percent: 8.0, tier: "Epic", set_id: "dlc_1", set_name: "Expansion Pack 1", statId: 1, bitIndex: 1, compatibility: { status: "provisional", canUnlock: true } }
  ];
  w.fetch = async (url, opts) => {
    if (url === "/api/achievement/change") {
      return { ok: true, status: 200, json: async () => ({ outcome: "confirmed", message: "Confirmed." }) };
    }
    return { ok: true, status: 200, json: async () => ({ ...response(v51SetRows), readingMethod: "protocol" }) };
  };
  w.testUI.activate({ id: "acc1", name: "Main", connected: true, tokenSource: "environment", tokenAccountMatches: true, isCollisionPaused: false, games: [730] });
  await w.testUI.open(730, "Counter-Strike 2", true, "protocol");

  // Verify dual progress bar shows Base Game 1/1 (100% · Completed ★) and Total w/ DLCs 1/2 (50%)
  assert.match(w.document.getElementById("achProgressText").textContent, /Base Game: 1\/1 \(100% · Completed ★\)/);
  assert.match(w.document.getElementById("achProgressText").textContent, /Total w\/ DLCs: 1\/2 \(50%\)/);

  // Verify [Base] and [DLC: Expansion Pack 1] badges in table rows
  assert.ok(w.document.querySelector("#achTableBody .ach-set-badge.set-base"));
  assert.equal(w.document.querySelector("#achTableBody .ach-set-badge.set-base").textContent, "[Base]");
  assert.ok(w.document.querySelector("#achTableBody .ach-set-badge.set-dlc"));
  assert.equal(w.document.querySelector("#achTableBody .ach-set-badge.set-dlc").textContent, "[DLC: Expansion Pack 1]");

  // Verify Showcase Card counts game as Completed because Base Game is 100% unlocked despite locked DLC
  w.document.getElementById("btnShowcaseCard").click();
  assert.match(w.document.getElementById("showcaseCanvas").dataset.summary, /Completed \/ Completados/);
  w.document.getElementById("closeShowcaseBtn").click();

  // Click Unlock on DLC_1 -> verify 0ms optimistic UI + native Notification API fired
  const unlockBtn = [...w.document.querySelectorAll("#achTableBody .sam-quick-btn")].find(b => b.textContent === "Unlock");
  assert.ok(unlockBtn);
  unlockBtn.click();
  assert.ok(desktopNotifications.length >= 1, "Native Windows/Browser Notification API must fire at 0ms on achievement unlock");
  assert.match(desktopNotifications.at(-1).title, /Achievement Unlocked/);
  assert.match(desktopNotifications.at(-1).options.body, /DLC Boss/);

  // 12. Verify v53: Local Bridge Status Badge, Dependency Tree filter & "Requiere antes" badges, and Steam Leaderboards tab & upload
  const depRows = [
    { apiname: "CHAP_2", name: "Chapter 2", description: "Finish Chapter 2", unlocked: false, percent: 35.0, tier: "Rare", statId: 1, bitIndex: 1, compatibility: { status: "provisional", canUnlock: true } },
    { apiname: "CHAP_1", name: "Chapter 1", description: "Finish Chapter 1", unlocked: false, percent: 68.0, tier: "Common", statId: 1, bitIndex: 0, compatibility: { status: "provisional", canUnlock: true } }
  ];
  let uploadedLbPayload = null;
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    if (url === "/api/status") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          localBridgeConnected: true,
          accounts: [{
            id: "acc1",
            name: "Main",
            user: "mainuser",
            connected: true,
            webSessionReady: true,
            tokenSource: "environment",
            tokenAccountMatches: true,
            isFarming: true,
            isPaused: false,
            isCollisionPaused: false,
            games: [730],
            gameNames: { 730: "Counter-Strike 2" },
            runningGames: [730],
            sleepMode: { enabled: false, start: 3, end: 8 }
          }],
          presets: [],
          timezone: "UTC"
        })
      };
    }
    if (url.startsWith("/api/leaderboards/entries")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          appid: 730,
          leaderboardId: 101,
          topEntries: [{ rank: 1, steamId: "76561198000000001", personaName: "Main", score: uploadedLbPayload?.score || 999999 }],
          userEntry: { rank: 1, steamId: "76561198000000001", personaName: "Main", score: uploadedLbPayload?.score || 999999 }
        })
      };
    }
    if (url.startsWith("/api/leaderboards")) {
      if (opts?.method === "POST" || url === "/api/leaderboards/upload") {
        uploadedLbPayload = body;
        return { ok: true, status: 200, json: async () => ({ success: true, newRank: 1, score: body.score, message: "Uploaded score!" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          appid: 730,
          leaderboards: [{ id: 101, name: "Global High Score", entryCount: 100 }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ...response(depRows), readingMethod: "protocol" }) };
  };

  await w.testUI.load();
  const bridgeBadge = w.document.getElementById("localBridgeBadge");
  assert.ok(bridgeBadge);
  assert.equal(bridgeBadge.classList.contains("online"), true);
  assert.match(bridgeBadge.textContent, /Local Bridge: Conectado|Local Bridge: Connected/);

  await w.testUI.open(730, "Counter-Strike 2", true, "protocol");
  // Verify Chapter 2 shows "Requiere antes: Chapter 1" dependency badge
  const depBadge = w.document.querySelector("#achTableBody .ach-dep-badge.blocked");
  assert.ok(depBadge);
  assert.match(depBadge.textContent, /Requiere antes: Chapter 1/);

  // Click Dependency Tree button -> sorts Chapter 1 before Chapter 2
  const depTreeBtn = w.document.getElementById("btnDependencyTreeFilter");
  assert.ok(depTreeBtn);
  depTreeBtn.click();
  assert.equal(depTreeBtn.classList.contains("active"), true);
  assert.deepEqual([...w.document.querySelectorAll("#achTableBody .ach-title")].map(e => e.textContent), ["Chapter 1", "Chapter 2"]);

  // Switch to Leaderboards tab and upload a score
  const tabLbBtn = w.document.getElementById("tabLeaderboardsBtn");
  assert.ok(tabLbBtn);
  tabLbBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.document.getElementById("achLeaderboardsPanel").hidden, false);
  w.document.getElementById("leaderboardScoreInput").value = "1234567";
  w.document.getElementById("uploadLeaderboardScoreBtn").click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(uploadedLbPayload?.score, 1234567);
  assert.match(w.document.getElementById("leaderboardUserRankCard").textContent, /#1 Mundial/);

  // 13. Verify v55: 1:1 i18n key parity, Spanish SAM modal translations, Reset Stats on Lock toggle (#samResetStatsOnLockToggle), 32-game value banner (#landingValueBanner), and empty leaderboard message
  const appJsSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const esKeys = [...appJsSource.slice(appJsSource.indexOf("es: {"), appJsSource.indexOf("en: {")).matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map(m => m[1]);
  const enKeys = [...appJsSource.slice(appJsSource.indexOf("en: {"), appJsSource.indexOf("function t(key)")).matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map(m => m[1]);
  assert.deepEqual(esKeys.slice(1), enKeys.slice(1), "i18n.es and i18n.en must have 100% 1:1 key parity");

  assert.ok(w.document.getElementById("samResetStatsOnLockToggle")?.checked, "samResetStatsOnLockToggle must exist and be checked by default");
  assert.match(w.document.getElementById("landingValueBanner").textContent, /32 JUEGOS DE STEAM EN SIMULTÁNEO|32 Steam Games Simultaneously/i);
  assert.equal(w.document.querySelector('[data-event-4]').textContent, "Actualizar");
  assert.equal(w.document.querySelector('[data-event-5]').textContent, "Cerrar");
  assert.equal(w.document.getElementById("undoLastOperationBtn").textContent, "Deshacer último cambio");
  assert.match(w.document.getElementById("achProgressText").textContent, /logros verificados desbloqueados/);

  // 14. Verify v56 REA UI: Live Players Badge, Leaderboard Scope Selector (Global/Friends/AroundMe), Stealth Privacy Toggle, Loyalty Summary Widget, Claim 32 Free Pack, and Donor Schema Explorer
  assert.ok(w.document.querySelector(".live-players-badge .live-dot"), "Game cards & modal must display pulsing green live-players-badge");
  const reaUiCalls = [];
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    reaUiCalls.push({ url, body });
    if (url.startsWith("/api/games/730/live-players")) {
      return { ok: true, status: 200, json: async () => ({ appid: 730, playerCount: 1337420, source: "steam_cm_dp" }) };
    }
    if (url.startsWith("/api/games/730/donor-schema")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          appid: 730,
          donorId: "76561198028121353",
          achievements: [{ apiname: "DONOR_ACH_1", name: "Donor Secret Achievement", description: "Unlocked via OpenSteamTool Donor ID", unlocked: false, percent: 12.5 }],
          statistics: []
        })
      };
    }
    if (url.startsWith("/api/leaderboards/entries")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          appid: 730,
          leaderboardId: 101,
          dataRequest: 2,
          topEntries: [{ rank: 1, steamId: "76561198000000001", personaName: "FriendOne", score: 777777 }],
          userEntry: { rank: 1, steamId: "76561198000000001", personaName: "FriendOne", score: 777777 }
        })
      };
    }
    if (url === "/api/account/toggle-privacy") {
      return { ok: true, status: 200, json: async () => ({ ok: true, privateApps: true, message: "Modo Fantasma activado" }) };
    }
    if (url === "/api/account/claim-free-pack") {
      return { ok: true, status: 200, json: async () => ({ ok: true, granted: [730, 440, 570], totalRequested: 32, message: "Se reclamaron 32 licencias gratuitas" }) };
    }
    if (url.startsWith("/api/account/loyalty-summary")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, points: 24680, pointsSpent: 1000, totalCardsEarned: 94 }) };
    }
    return { ok: true, status: 200, json: async () => ({ accounts: [connectedAcc], presets: [], timezone: "UTC" }) };
  };

  // Click live-players-badge to refresh live count from CM DP
  const liveBadge = w.document.querySelector('.live-players-badge[data-appid="730"]');
  assert.ok(liveBadge);
  liveBadge.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(reaUiCalls.some(c => c.url.startsWith("/api/games/730/live-players")));
  assert.match(liveBadge.textContent, /1,337,420/);

  // Change leaderboardScopeSelect to Friends (2) and verify dataRequest=2 query parameter
  const scopeSelect = w.document.getElementById("leaderboardScopeSelect");
  assert.ok(scopeSelect);
  scopeSelect.value = "2";
  scopeSelect.dispatchEvent(new w.Event("change"));
  await new Promise(r => setTimeout(r, 20));
  assert.ok(reaUiCalls.some(c => c.url.includes("/api/leaderboards/entries") && c.url.includes("dataRequest=2")));

  // Click Donor Schema Explorer button (#btnDonorSchemaExplorer)
  const donorBtn = w.document.getElementById("btnDonorSchemaExplorer");
  assert.ok(donorBtn);
  donorBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(reaUiCalls.some(c => c.url.startsWith("/api/games/730/donor-schema")));
  assert.match(w.document.getElementById("achReadMessage").textContent, /76561198028121353/);

  // Click Stealth Privacy button (#stealthPrivacyBtn)
  const stealthBtn = w.document.getElementById("stealthPrivacyBtn");
  assert.ok(stealthBtn);
  stealthBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(reaUiCalls.some(c => c.url === "/api/account/toggle-privacy" && c.body?.privateApps === true));

  // Click Loyalty Summary widget (#loyaltySummaryBadge)
  const loyaltyBadge = w.document.getElementById("loyaltySummaryBadge");
  assert.ok(loyaltyBadge);
  loyaltyBadge.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.document.getElementById("loyaltyPointsText").textContent, "24,680 pts");
  assert.match(w.document.getElementById("loyaltyCardsText").textContent, /94 (cromos|cards)/);

  // Click Claim 32 Free Games Pack button (#claimFree32PackBtn)
  const claim32Btn = w.document.getElementById("claimFree32PackBtn");
  assert.ok(claim32Btn);
  claim32Btn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(reaUiCalls.some(c => c.url === "/api/account/claim-free-pack" && c.body?.addToGames === true));

  // 15. Verify v57 UI: Clean Achievement Row Hierarchy (.rare-gold-border, .ach-rarity-pill, <details class="technical-debug-drawer">), Platinum Pacing Selector, and OpenSteamTool Exporter
  assert.ok(w.document.querySelector(".ach-rarity-pill"), "Achievement rows must render clean .ach-rarity-pill");
  assert.ok(w.document.querySelector("details.technical-debug-drawer summary.technical-debug-summary"), "Technical metadata must be collapsed inside <details class='technical-debug-drawer'>");

  const v57Calls = [];
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    v57Calls.push({ url, body });
    if (url.startsWith("/api/games/730/opensteamtool-export")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          format: "OpenSteamTool-REA-v1",
          appid: 730,
          spacewarAppId: 480,
          donorId: "76561198028121353",
          achievements: [{ apiname: "OST_1", name: "OST Achievement", unlocked: true }],
          luaScript: "addappid(730)"
        })
      };
    }
    if (url === "/api/achievement/timed") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: true,
          spacing: "platinum",
          order: "progression",
          pacingMode: body?.pacingMode || "ultra_long_months",
          message: "Modo Platino Realista activado (Ultra-Realista): 10 logros en 5 sesiones a lo largo de ~3.2 meses"
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ accounts: [connectedAcc], presets: [], timezone: "UTC" }) };
  };

  // Switch Platinum Pacing to Ultra Realistic / Full Game (ultra_long_months) and click Start Platinum
  w.testUI.activate({ ...connectedAcc, tokenSource: "environment", tokenAccountMatches: true });
  const paceMonthsBtn = w.document.getElementById("platinumPaceMonthsBtn");
  assert.ok(paceMonthsBtn);
  paceMonthsBtn.click();
  assert.equal(paceMonthsBtn.classList.contains("active"), true);
  w.document.getElementById("startPlatinumBtn").click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v57Calls.some(c => c.url === "/api/achievement/timed" && c.body?.pacingMode === "ultra_long_months"));

  // Click Export Configuration for OpenSteamTool (#btnExportOpenSteamTool)
  const ostExportBtn = w.document.getElementById("btnExportOpenSteamTool");
  assert.ok(ostExportBtn);
  ostExportBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v57Calls.some(c => c.url.startsWith("/api/games/730/opensteamtool-export")));
  assert.match(w.document.getElementById("importJsonInput").value, /OpenSteamTool-REA-v1/);

  // 16. Verify v58 UI: #samMasterResetBtn, #collisionBypassBtn, and #pioneerFeaturesPanel (GC, Steam Deck, Tournament Ghost)
  const v58Calls = [];
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    v58Calls.push({ url, body });
    if (url === "/api/stats" && body?.resetAll) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          appid: 730,
          outcome: "confirmed",
          resetAll: true,
          stats: [],
          achievements: [{ apiname: "DONOR_ACH_1", name: "Donor Secret Achievement", description: "Reset to 0", unlocked: false, percent: 12.5 }],
          message: "Todas las estadísticas y logros del juego fueron reiniciados a 0 en los servidores de Steam."
        })
      };
    }
    if (url === "/api/toggle-collision-bypass") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          ignoreSessionCollision: true,
          message: "Colisión de sesión ignorada: SteamFarmer seguirá farmeando en línea aunque uses Steam en tu PC."
        })
      };
    }
    if (url === "/api/gc/connect") {
      return { ok: true, status: 200, json: async () => ({ success: true, message: "Conexión enviada al Game Coordinator de CS2 (730) y TF2 (440)." }) };
    }
    if (url === "/api/gc/cs2/claim-package") {
      return { ok: true, status: 200, json: async () => ({ success: true, message: "Solicitud de reclamo del Weekly Care Package enviada al Game Coordinator de CS2." }) };
    }
    if (url === "/api/steamdeck/spoof") {
      return { ok: true, status: 200, json: async () => ({ success: true, message: "Presencia de Steam Deck activada en amigos." }) };
    }
    if (url === "/api/steamdeck/claim-rewards") {
      return { ok: true, status: 200, json: async () => ({ success: true, granted: true, permanent: true, message: "¡Recompensas exclusivas de Steam Deck activadas permanentemente en tu cuenta de Steam!" }) };
    }
    if (url === "/api/tournament/watch") {
      return { ok: true, status: 200, json: async () => ({ success: true, message: "Tournament Ghost activo en broadcast 76561198011111111" }) };
    }
    if (url === "/api/tournament/stop") {
      return { ok: true, status: 200, json: async () => ({ success: true, message: "Tournament Ghost detenido." }) };
    }
    return { ok: true, status: 200, json: async () => ({ accounts: [{ ...connectedAcc, tokenSource: "environment", tokenAccountMatches: true, ignoreSessionCollision: true }], presets: [], timezone: "UTC" }) };
  };

  // Click #samMasterResetBtn
  const masterResetBtn = w.document.getElementById("samMasterResetBtn");
  assert.ok(masterResetBtn);
  masterResetBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v58Calls.some(c => c.url === "/api/stats" && c.body?.resetAll === true && c.body?.action === "reset_all"));

  // Click #collisionBypassBtn
  const colBypassBtn = w.document.getElementById("collisionBypassBtn");
  assert.ok(colBypassBtn);
  colBypassBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v58Calls.some(c => c.url === "/api/toggle-collision-bypass"));
  assert.equal(colBypassBtn.classList.contains("collision-bypass-active"), true);

  // Click Pioneer Feature buttons (GC, Steam Deck, Tournament Ghost)
  w.document.getElementById("btnConnectGC").click();
  w.document.getElementById("btnClaimCarePackage").click();
  w.document.getElementById("btnSpoofSteamDeck").click();
  w.document.getElementById("btnClaimSteamDeckRewards").click();
  w.document.getElementById("tournamentBroadcastIdInput").value = "76561198011111111";
  w.document.getElementById("btnWatchTournamentGhost").click();
  await new Promise(r => setTimeout(r, 25));

  assert.ok(v58Calls.some(c => c.url === "/api/gc/connect"));
  assert.ok(v58Calls.some(c => c.url === "/api/gc/cs2/claim-package"));
  assert.ok(v58Calls.some(c => c.url === "/api/steamdeck/spoof"));
  assert.ok(v58Calls.some(c => c.url === "/api/steamdeck/claim-rewards"));
  assert.ok(v58Calls.some(c => c.url === "/api/tournament/watch" && c.body?.broadcastSteamId === "76561198011111111"));
  assert.equal(w.document.getElementById("btnStopTournamentGhost").hidden, false);

  w.document.getElementById("btnStopTournamentGhost").click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v58Calls.some(c => c.url === "/api/tournament/stop"));

  // 17. Verify v59 Pentagon Elite Panel UI: Market Sniper, Alchemy Transmuter, Vanity URL Sniper, Level Optimizer & Long Artwork IHDR Patcher
  assert.ok(w.document.getElementById("pentagonElitePanel"));
  const v59Calls = [];
  w.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    v59Calls.push({ url, body });
    if (url === "/api/sniper/start") return { ok: true, status: 200, json: async () => ({ success: true, message: "Francotirador de Mercado activado." }) };
    if (url === "/api/sniper/stop") return { ok: true, status: 200, json: async () => ({ success: true, message: "Francotirador de Mercado detenido." }) };
    if (url === "/api/alchemy/craft-booster") return { ok: true, status: 200, json: async () => ({ success: true, message: "¡Booster Pack de alto valor forjado con éxito!" }) };
    if (url === "/api/vanity/start") return { ok: true, status: 200, json: async () => ({ success: true, message: "Radar de URLs cortas de 3 letras activado." }) };
    if (url === "/api/vanity/stop") return { ok: true, status: 200, json: async () => ({ success: true, message: "Radar de URLs cortas detenido." }) };
    if (url === "/api/level/craft") return { ok: true, status: 200, json: async () => ({ success: true, xpGained: 100, message: "¡Insignia forjada con éxito! +100 XP agregados a tu cuenta de Steam." }) };
    if (url === "/api/artwork/patch") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          originalHeight: 1,
          patchedHeight: 3840,
          patchedBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          message: "PNG parcheado con éxito con el exploit IHDR de longitud infinita para Steam."
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ accounts: [{ ...connectedAcc, tokenSource: "environment", tokenAccountMatches: true }], presets: [], timezone: "UTC" }) };
  };

  w.document.getElementById("btnStartMarketSniper").click();
  w.document.getElementById("btnRunAlchemyCycle").click();
  w.document.getElementById("btnStartVanitySniper").click();
  w.document.getElementById("btnCraftCheapestBadge").click();
  w.document.getElementById("btnSelectArtworkToPatch").click();
  await new Promise(r => setTimeout(r, 25));

  assert.ok(v59Calls.some(c => c.url === "/api/sniper/start"));
  assert.ok(v59Calls.some(c => c.url === "/api/alchemy/craft-booster"));
  assert.ok(v59Calls.some(c => c.url === "/api/vanity/start"));
  assert.ok(v59Calls.some(c => c.url === "/api/level/craft"));
  assert.ok(v59Calls.some(c => c.url === "/api/artwork/patch"));
  assert.match(w.document.getElementById("artworkPatchStatusText").textContent, /3840px/);

  w.document.getElementById("btnStopMarketSniper").click();
  w.document.getElementById("btnStopVanitySniper").click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(v59Calls.some(c => c.url === "/api/sniper/stop"));
  assert.ok(v59Calls.some(c => c.url === "/api/vanity/stop"));
});
