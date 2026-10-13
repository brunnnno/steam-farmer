'use strict';
const $ = id => document.getElementById(id);
let csrf = '', activeAccountId = sessionStorage.getItem('sf_account') || '', accounts = [], active = null;
let currentAchList = [], currentAchAppId = null, achAccountId = null, currentAchGameName = '', currentAchMethod = 'web';
let experimentBusy = false;
const achievementPreviews = new Map();
function previewKey(account,id,method) { return JSON.stringify([account,active?.steamId64||active?.mySteamID||'',id,method]); }
function rememberAchievements(key,data) {
  const text=JSON.stringify(data);achievementPreviews.delete(key);
  if(text.length*2>1024*1024)return;
  achievementPreviews.set(key,{text,at:Date.now()});
  let bytes=[...achievementPreviews.values()].reduce((sum,v)=>sum+v.text.length*2,0);
  while(achievementPreviews.size>8||bytes>1024*1024){const first=achievementPreviews.keys().next().value;bytes-=achievementPreviews.get(first).text.length*2;achievementPreviews.delete(first);}
}
let filterStatus = 'all', filterRarity = 'all', currentSort = 'default', searchQuery = '';
let filterCompatibility='all';
let loginAttempt = null, loginTimer = null, loginTarget = null, loginSerial = 0, noticeTimer, statusBusy = false, searchSerial = 0, achSerial = 0;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 10000); }
async function api(endpoint, body) {
  const headers = {}; const options = { headers, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; options.method = 'POST'; options.body = JSON.stringify(body); }
  const response = await fetch(endpoint, options); const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && endpoint !== '/api/panel/login' && endpoint !== '/api/panel/password') showLock();
    throw Object.assign(new Error(data.error || 'The operation failed.'),{diagnostic:data.diagnostic});
  }
  return data;
}
function showLock() { achievementPreviews.clear();loginSerial++; csrf = ''; stopLoginPoll(); $('lockModal').style.display = 'flex'; $('addAccModal').style.display = 'none'; closeAchModal(); $('pinInput').value = ''; }
async function checkAuth() { localStorage.removeItem('farmer_pin'); try { csrf = (await api('/api/panel/session')).csrf; $('lockModal').style.display = 'none'; await loadStatus(); } catch { showLock(); } }
async function unlock() { try { csrf = (await api('/api/panel/login', { password: $('pinInput').value })).csrf; $('pinInput').value = ''; $('lockModal').style.display = 'none'; await loadStatus(); } catch (e) { notice(e.message); } }
async function lock() { try { await api('/api/panel/logout', {}); showLock(); } catch (e) { notice(e.message); } }
async function changePanelPassword() {
  const currentPassword = prompt('Current dashboard password:'); if (currentPassword === null) return;
  const password = prompt('New dashboard password (at least 12 characters):'); if (password === null) return;
  try { await api('/api/panel/password', { currentPassword, password }); showLock(); notice('Password updated. Please sign in again.'); } catch (e) { notice(e.message); }
}
async function reqAction(endpoint, body = {}) { if (!activeAccountId) throw Error('Add or select an account.'); return api(endpoint, { ...body, accountId: activeAccountId }); }
async function action(endpoint, body = {}, message) { try { const r = await reqAction(endpoint, body); if (message) notice(message); await loadStatus(); return r; } catch(e) { notice(e.message); return null; } }
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(label, callback, className = 'btn-action-sm') { const b = element('button', label, className); b.addEventListener('click', callback); return b; }
function image(src, className, alternatives=[]) {
  const img = element('img', undefined, className); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; try { const u = new URL(src); if (u.protocol === 'https:') img.src = u.href; } catch {}
  let next=0;
  img.addEventListener('error',()=>{while(next<alternatives.length){try{const u=new URL(alternatives[next++]);if(u.protocol==='https:'){img.src=u.href;img.hidden=false;return;}}catch{}}img.hidden=true;});
  return img;
}
async function loadStatus() {
  if (!csrf || statusBusy) return; statusBusy = true;
  try {
    const data = await api('/api/status'); accounts = data.accounts;
    if (!accounts.some(a => a.id === activeAccountId)) activeAccountId = accounts[0]?.id || '';
    sessionStorage.setItem('sf_account', activeAccountId); active = accounts.find(a => a.id === activeAccountId) || null;
    renderAccountsTabs(accounts, activeAccountId); renderPresets(data.presets);
    $('accountMenu').hidden=!active;
    for(const event of [17,18])document.querySelector('[data-event-'+event+']').hidden=!active||active.tokenSource==='environment';
    $('managedAccountNote').hidden=active?.tokenSource!=='environment';
    $('webhookInput').placeholder = data.webhookConfigured ? 'Webhook configured. Paste a new one to replace it.' : 'https://discord.com/api/webhooks/...';
    if (document.activeElement !== $('timezoneInput')) $('timezoneInput').value = data.timezone;
    $('achQueueVal').textContent = 'Actual Steam state';
    const storage=data.achievementHistoryStorage;
    const memory=data.applicationStorage;
    $('resourceUsage').textContent=data.resources?`Process RAM: ${(data.resources.rssBytes/1048576).toFixed(1)} MiB · Heap: ${(data.resources.heapUsedBytes/1048576).toFixed(1)} MiB · ${data.resources.steamConnections}/3 Steam connections · ${data.resources.activeHeavy}/1 heavy operations`:'Server resource data unavailable.';
    $('historyStorage').textContent=storage?.persistent?(storage.available?(memory?.persistent&&memory.available?'Persistent memory connected: write history and encrypted configuration saved.':'Persistent write history connected; configuration is still local.'):'Persistent history unavailable. Achievement activation is blocked.'):'Local history only. Records can be lost when the host restarts or redeploys.';
    renderCardFarming(active);
    if (!active) { $('connectionDetails').textContent=''; $('userLabel').textContent = 'Add your Steam account to get started'; $('statusText').textContent = 'No account'; $('badgeStatus').className = 'badge-status paused'; $('gamesGrid').replaceChildren(); gamesSnapshot=''; $('timerVal').textContent = '00h 00m 00s'; $('hoursVal').textContent = '0.0 estimated hrs'; $('gamesCountVal').textContent = '0 / 32'; $('capacityPercent').textContent = '0%'; $('capacityFill').style.width = '0%'; return; }
    $('userLabel').textContent = [active.name,active.profileName || active.user].filter(Boolean).join(' · ');
    $('connectionDetails').textContent = `${active.connected?'Steam connected':'Steam disconnected'} · ${active.webSessionReady?'Web session ready':'Web session not ready'}${active.linkedSteamId?' · Steam ID: '+active.linkedSteamId:''}`;
    $('statusText').textContent = !active.connected ? (active.error || 'Disconnected') : active.isCollisionPaused ? 'Playing on another device' : active.isSleepPaused ? 'Sleep schedule active' : active.isPaused ? 'Paused' : active.cardFarming && !active.cardsReady ? 'Checking card drops' : active.isFarming ? 'Activity sent to Steam' : 'No active games';
    $('badgeStatus').className = 'badge-status' + (!active.isFarming ? ' paused' : '');
    $('playBtn').textContent = active.isPaused ? 'Resume' : 'Pause';
    $('personaBtn').textContent = active.personaState === 7 ? 'Invisible' : 'Online';
    $('cardsBtn').textContent = active.cardFarming ? `Cards: ${active.cardDropGames.length} games` : 'Cards: OFF';
    $('cardsBtn').title = active.cardError || '';
    $('gamesCountVal').textContent = active.games.length + ' / 32';
    const pct = Math.round(active.games.length / 32 * 100); $('capacityPercent').textContent = pct + '%'; $('capacityFill').style.width = pct + '%';
    if (document.activeElement !== $('customStatusInput')) $('customStatusInput').value = active.customStatus || '';
    if (document.activeElement !== $('sleepEnabled')) $('sleepEnabled').checked = active.sleepMode.enabled;
    for (const [id,key] of [['sleepStart','start'], ['sleepEnd','end']]) if (document.activeElement !== $(id)) $(id).value = active.sleepMode[key];
    renderGames(active.games);
  } catch (e) { notice(e.message); } finally { statusBusy = false; }
}
let tabsSnapshot = '', presetsSnapshot = '', gamesSnapshot = '',cardsSnapshot='',cardsAccount='';
function renderCardFarming(account){
  const panel=$('cardsPanel');panel.hidden=!account?.cardFarming;
  if(panel.hidden){panel.open=false;cardsSnapshot='';cardsAccount='';$('cardsList').replaceChildren();return;}
  if(cardsAccount!==account.id){panel.open=false;cardsAccount=account.id;}
  const games=Array.isArray(account.cardDropGames)?account.cardDropGames:[];
  const running=new Set(account.isFarming?(account.runningGames||[]):[]);
  const stopped=!account.connected?'Steam disconnected':account.isCollisionPaused?'Playing on another device':account.isSleepPaused?'Sleep schedule active':account.isPaused?'Paused':null;
  const total=games.reduce((n,g)=>n+(Number.isSafeInteger(g.remaining)&&g.remaining>0?g.remaining:0),0);
  const activeCount=games.filter(g=>running.has(g.appid)).length;
  $('cardsSummary').textContent=account.cardsReady?`${activeCount}/${games.length} active · ${total} pending drops`:'Checking Steam…';
  $('cardsStatus').textContent=account.cardError?account.cardError+' Counts may be outdated.':stopped?stopped+'. No card-farming activity is being sent.':!account.cardsReady?'Reading games with remaining card drops…':games.length?'Activity is sent to Steam for the active games; drops are not guaranteed immediately.':'Steam reports no games with pending card drops.';
  $('cardsUpdated').textContent=account.cardScanAt?`Last scan: ${new Date(account.cardScanAt).toLocaleTimeString('en-US')} · Badge counts are checked about every 10 minutes.`:'Badge counts are checked about every 10 minutes.';
  const snapshot=JSON.stringify([account.id,games,account.gameNames,[...running],stopped,account.cardsReady]);if(snapshot===cardsSnapshot)return;cardsSnapshot=snapshot;
  const list=$('cardsList');list.replaceChildren();
  for(const game of games.slice(0,80)){
    const row=element('div',undefined,'cards-game');
    const title=game.name||account.gameNames?.[game.appid]||`AppID ${game.appid}`;
    const identity=element('div',undefined,'cards-game-identity');identity.append(element('strong',title),element('small',`#${game.appid}`));
    const state=running.has(game.appid)?'Active':stopped?'Paused':account.cardsReady?'Waiting':'Checking';
    row.append(identity,element('span',state,'cards-game-state'+(running.has(game.appid)?' active':'')),element('span',`${game.remaining} pending`, 'cards-game-remaining'));list.append(row);
  }
  if(games.length>80)list.append(element('small',`Showing the first 80 of ${games.length} games to keep the panel lightweight.`));
}
function renderAccountsTabs(list, selected) {
  const snapshot = JSON.stringify([selected,list.map(a=>[a.id,a.name,a.games.length])]); if(snapshot===tabsSnapshot)return; tabsSnapshot=snapshot;
  $('accountsTabsContainer').replaceChildren(...list.map(a => button(`${a.name} (${a.games.length})`, () => switchAccount(a.id), 'acc-pill' + (a.id === selected ? ' active' : ''))));
}
function switchAccount(id) { if (id === activeAccountId) return; activeAccountId = id; sessionStorage.setItem('sf_account', id); active = accounts.find(a=>a.id===id); closeAchModal(); loadStatus(); }
function renderPresets(list) { const snapshot=JSON.stringify(list);if(snapshot===presetsSnapshot)return;presetsSnapshot=snapshot; $('presetsContainer').replaceChildren(element('span','Presets:')); for (const p of list) $('presetsContainer').append(button(p.name, () => applyPreset(p.key), 'chip')); }
function renderGames(games) {
  const snapshot=JSON.stringify([activeAccountId,games,active.gameNames]);if(snapshot===gamesSnapshot)return;gamesSnapshot=snapshot;
  const grid = $('gamesGrid'); grid.replaceChildren();
  if (!games.length) { grid.append(element('p','Add games by title or AppID.')); return; }
  for (const id of games) {
    const title = active.gameNames[id] || `AppID ${id}`; const card = element('div',undefined,'card');
    const art=element('div',undefined,'game-art'),fallback=element('div',undefined,'game-art-placeholder');fallback.setAttribute('aria-hidden','true');
    fallback.append(element('span',title.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase(),'game-art-monogram'),element('span',title,'game-art-name'));
    const banner=image(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,'card-banner',[`https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`]);
    art.append(fallback,banner);card.append(art);
    const content = element('div',undefined,'card-content'); content.append(element('div',title,'card-title'),element('div',`#${id}`,'card-appid'));
    const actions = element('div',undefined,'card-actions');const menu=element('details',undefined,'control-menu');menu.append(element('summary','Options'));const menuContent=element('div',undefined,'control-menu-content');menuContent.append(button('Remove',()=>removeGame(id),'btn-card-remove'));menu.append(menuContent);actions.append(button('Achievements',()=>openAchModal(id,title,false,active?.connected?'auto':'web'),'btn-card-ach'),menu);
    content.append(actions); card.append(content); grid.append(card);
  }
}
function stopLoginPoll() { clearTimeout(loginTimer); loginTimer = null; }
function openAddAccModal() { loginTarget = active && !active.user ? active.id : null; $('newAccUser').value = ''; $('newAccName').value = ''; $('newAccPassword').value = ''; $('steamGuardCode').value = ''; $('steamLoginMessage').textContent = ''; $('guardControls').hidden = true; $('connectSteamBtn').disabled = false; $('addAccModal').style.display = 'flex'; }
async function closeAddAccModal() { loginSerial++; stopLoginPoll(); if (loginAttempt) { const id = loginAttempt; loginAttempt = null; try { await api('/api/steam/cancel', { attemptId:id }); } catch {} } $('newAccPassword').value = ''; $('steamGuardCode').value = ''; $('addAccModal').style.display = 'none'; }
function reloginAccount() { if (!active) return notice('Select an account.'); if (active.tokenSource === 'environment') return action('/api/steam/web-session',{},'Refreshing the Steam connection with the saved token.'); openAddAccModal(); loginTarget = active.id; $('newAccUser').value = active.user; $('newAccName').value = active.name; }
async function submitAddAccount() {
  const serial = ++loginSerial;
  $('connectSteamBtn').disabled = true; $('steamLoginMessage').textContent = 'Connecting to Steam…';
  try {
    const payload = { name: $('newAccName').value.trim(), user: $('newAccUser').value.trim(), password: $('newAccPassword').value, accountId: loginTarget };
    $('newAccPassword').value = '';
    const data = await api('/api/steam/login', payload); delete payload.password;
    if (serial !== loginSerial) { try { await api('/api/steam/cancel', { attemptId: data.attemptId }); } catch {} return; }
    loginAttempt = data.attemptId; handleLogin(data);
  } catch(e) { if (serial !== loginSerial) return; $('steamLoginMessage').textContent = e.message; $('connectSteamBtn').disabled = false; }
}
function handleLogin(data) {
  if (data.attemptId !== loginAttempt) return;
  $('guardControls').hidden = !(data.phase === 'guard' && data.guards.some(g => /Code/.test(g.label)));
  if (data.phase === 'authenticated') { activeAccountId = data.accountId; loginAttempt = null; stopLoginPoll(); $('addAccModal').style.display = 'none'; notice('Session saved automatically. No token copying is required.'); loadStatus(); return; }
  if (['failed','expired','cancelled'].includes(data.phase)) { $('steamLoginMessage').textContent = data.error || 'Login attempt cancelled.'; $('connectSteamBtn').disabled = false; stopLoginPoll(); return; }
  $('steamLoginMessage').textContent = data.phase === 'guard' ? ('Steam Guard: ' + data.guards.map(g => /DeviceConfirmation/.test(g.label) ? 'approve the sign-in in the Steam mobile app' : /EmailCode/.test(g.label) ? 'enter the code sent by email' : /DeviceCode/.test(g.label) ? 'enter your authenticator code' : 'complete the Steam confirmation').join(' or ')) : 'Waiting for Steam confirmation…';
  stopLoginPoll(); loginTimer = setTimeout(pollLogin, 1500);
}
async function pollLogin() { const id = loginAttempt; if (!id || !csrf) return; try { handleLogin(await api('/api/steam/login-status?attemptId=' + encodeURIComponent(id))); } catch(e) { if (id !== loginAttempt) return; $('steamLoginMessage').textContent = e.message; $('connectSteamBtn').disabled = false; stopLoginPoll(); } }
async function submitGuard() { const id = loginAttempt; if (!id) return; try { const code = $('steamGuardCode').value.trim(); $('steamGuardCode').value=''; handleLogin(await api('/api/steam/guard',{attemptId:id,code})); } catch(e) { notice(e.message); } }
async function deleteCurrentAccount() { if (!active || !confirm('Delete this profile and its saved session?')) return; if (await action('/api/account/remove')) { activeAccountId=''; closeAchModal(); await loadStatus(); } }
async function logoutSteam() { if (active && confirm('Sign out of Steam and remove the saved session?')) await action('/api/steam/logout',{},'Steam session removed.'); }
async function editChatAdmins() { if (!active) return; const value = prompt('Allowed SteamID64s, separated by commas. Leave empty to disable chat commands.', (active.chatAdmins||[]).join(',')); if(value !== null) await action('/api/chat-admins',{steamids:value.split(',').map(v=>v.trim()).filter(Boolean)},'Chat permissions updated.'); }
async function openAchModal(id,title,forceRefresh=false,method='web') {
  $('sharedProgressReview').hidden=true;
  $('achReadingOptions').open=false;
  document.querySelector('.ach-modal-card').classList.remove('shared-review-open');
  if (currentAchAppId !== id || achAccountId !== activeAccountId || $('achReadMode').value !== method) {
    filterStatus='all'; filterRarity='all'; filterCompatibility='all';currentSort='default'; searchQuery='';
    $('achCompatibilityFilter').value='all';
    $('achSortSelect').value='default'; $('achSearchInput').value='';
  }
  document.body.classList.add('achievement-open');
  $('achListContainer').scrollTop=0; document.querySelector('.ach-modal-card').scrollTop=0;
  currentAchMethod=method; currentAchAppId=id; currentAchGameName=title; achAccountId=activeAccountId; currentAchList=[];
  $('achReadMode').value=method;
  $('achModal').style.display='flex'; $('achGameTitle').textContent=title; $('achProgressText').textContent='Loading Steam achievements…'; $('achProgressFill').style.width='0%'; $('achCompatibilitySummary').textContent='';$('achListContainer').replaceChildren(); $('achPrivacyWarning').style.display='none'; $('achievementSource').textContent='';
  const serial = ++achSerial, account = achAccountId,readStarted=performance.now();
  const cacheKey=previewKey(account,id,method),preview=achievementPreviews.get(cacheKey);
  if(preview&&Date.now()-preview.at<300000){
    currentAchMethod='cached';currentAchList=JSON.parse(preview.text).achievements||[];
    $('achReadMessage').textContent='Previous reading — checking Steam now. Activation is unavailable until verification finishes.';
    $('achPrivacyWarning').style.display='block';$('achievementSource').textContent='Previous reading · Updating…';renderAchModal();
  }else if(preview)achievementPreviews.delete(cacheKey);
  $('gameRequirements').hidden=true;$('gameRequirements').open=false;loadGameRequirements(id,serial,account);
  try {
    const data=await api(`/api/achievements?accountId=${encodeURIComponent(account)}&appid=${id}${forceRefresh?'&refresh=1':''}${method!=='web'?'&method='+encodeURIComponent(method):''}`);
    if (serial !== achSerial || account !== activeAccountId) return;
    currentAchMethod=data.readingMethod||method;
    currentAchList=(Array.isArray(data.achievements)?data.achievements:[]).map(a=>({ ...a, name:String(a.name||a.apiname||'Achievement'), description:String(a.description||''), unlocked:typeof a.unlocked==='boolean'?a.unlocked:null, percent:a.percent!=null && a.percent!=='' && Number.isFinite(Number(a.percent))?Number(a.percent):null }));
    rememberAchievements(cacheKey,{achievements:currentAchList});
    $('achReadMessage').textContent=data.message || '';
    $('achPrivacyWarning').style.display=data.message ? 'block':'none';
    $('achGameTitle').textContent=title;
    $('achievementSource').textContent=`${data.source || 'Steam'} · ${new Date(data.checkedAt).toLocaleTimeString('en-US')} · Read: ${((performance.now()-readStarted)/1000).toFixed(2)} s`;
    renderAchModal();
    if((filterRarity!=='all'||['percentage_desc','rarity_common','rarity_rare'].includes(currentSort))&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
  } catch(e) { if(serial===achSerial&&account===activeAccountId) { if(currentAchMethod==='cached'){$('achReadMessage').textContent='Previous reading only. Current verification failed: '+e.message;$('achievementSource').textContent='Previous reading · Verification failed';}else{$('achProgressText').textContent='Not verified'; $('achListContainer').replaceChildren(element('p',e.message),...(e.diagnostic?.action?[element('p',e.diagnostic.action)]:[]));} } }
}
async function loadGameRequirements(id,serial,account) {
  try {
    const data=await api('/api/game-requirements?appid='+id);
    if(serial!==achSerial||account!==activeAccountId)return;
    const container=$('gameRequirementsContent');container.replaceChildren();
    for(const fact of data.facts||[])container.append(element('p',String(fact)));
    container.append(element('p',data.explanation),element('p',data.action));
    if(!data.metadataAvailable)container.append(element('small','Live Steam Store metadata unavailable; only established facts are shown.'));
    const link=element('a','Source: Steam Store');const url=new URL(data.sourceUrl);if(url.protocol==='https:'&&url.hostname==='store.steampowered.com'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';container.append(link);}
    $('gameRequirements').hidden=false;$('gameRequirements').open=Boolean(data.externalAccountOrSoftware);
  } catch {if(serial===achSerial){$('gameRequirementsContent').replaceChildren(element('p','Game integration requirements could not be retrieved. This does not establish a launcher restriction.'));$('gameRequirements').hidden=false;}}
}
function closeAchModal() { document.body.classList.remove('achievement-open'); achSerial++; $('achModal').style.display='none';currentAchList=[];currentAchAppId=null;achAccountId=null;$('achCompatibilitySummary').textContent='';$('achListContainer').replaceChildren();$('sharedProgressEffects').replaceChildren();$('sharedProgressReview').hidden=true;$('gameRequirementsContent').replaceChildren(); }
function forceRefreshAchievements() { if(currentAchAppId) return openAchModal(currentAchAppId,currentAchGameName,true,$('achReadMode').value); }
function setFilter(type,val) {
  if(type==='status')filterStatus=val;else filterRarity=filterRarity===val?'all':val;
  renderAchModal();
  if(type==='rarity'&&filterRarity!=='all'&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
}
let percentageRequest=null,percentageFetchedSerial=-1;
function setSort(val) {
  currentSort=val;renderAchModal();
  if(['percentage_desc','rarity_common','rarity_rare'].includes(val)&&currentAchList.some(a=>a.percent===null))loadAchievementPercentages();
}
async function loadAchievementPercentages(){
  const serial=achSerial,id=currentAchAppId,account=achAccountId,key=serial+':'+account+':'+id;
  if(!id||percentageRequest===key||percentageFetchedSerial===serial)return;percentageRequest=key;renderAchModal();
  try{
    const includeTitles=currentAchMethod!=='protocol'||currentAchList.some(a=>!a.apiname);
    const result=await api(`/api/achievement/percentages?accountId=${encodeURIComponent(account)}&appid=${id}${includeTitles?'&titles=1':''}`);
    if(serial!==achSerial||account!==activeAccountId||id!==currentAchAppId)return;
    if(!result.percentages||typeof result.percentages!=='object'||Array.isArray(result.percentages))throw Error('Steam did not return usable rarity percentages.');
    percentageFetchedSerial=serial;
    const normalize=value=>String(value).trim().replace(/\s+/g,' ').toLowerCase(),apis=new Map(),titles=new Map();
    for(const [name,value]of Object.entries(result.percentages)){const key=normalize(name);apis.set(key,apis.has(key)?null:value);}
    for(const row of currentAchList){const key=normalize(row.name);titles.set(key,(titles.get(key)||0)+1);}
    currentAchList=currentAchList.map(a=>{let value=a.apiname&&Object.hasOwn(result.percentages,a.apiname)?result.percentages[a.apiname]:a.apiname?apis.get(normalize(a.apiname)):null;
      if(value==null&&titles.get(normalize(a.name))===1)value=result.titlePercentages?.[normalize(a.name)];
      const p=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:a.percent;return {...a,percent:p,tier:p===null?'Unknown':p<5?'Mythic':p<15?'Epic':p<40?'Rare':'Common'};});renderAchModal();
    if(currentAchList.every(a=>a.percent===null))notice('Steam did not return percentages for these achievements. Unknown values remain at the end.');
  }catch(e){if(serial===achSerial)notice(e.message);}finally{if(percentageRequest===key)percentageRequest=null;if(serial===achSerial&&account===activeAccountId&&id===currentAchAppId)renderAchModal();}
}
function onSearchInput(val) { searchQuery=val.trim().toLowerCase(); renderAchModal(); }
function renderAchModal(page=0) {
  const rarityMissing=currentAchList.filter(a=>a.percent===null).length,rarityLoading=percentageRequest===achSerial+':'+achAccountId+':'+currentAchAppId;
  const rarityRelevant=filterRarity!=='all'||['percentage_desc','rarity_common','rarity_rare'].includes(currentSort);
  $('achRarityMessage').hidden=!rarityRelevant||!rarityMissing;
  $('achRarityMessage').textContent=rarityLoading?'Loading community unlock percentages from Steam…':rarityMissing===currentAchList.length?'Steam rarity percentages are unavailable. Unknown rarity is not treated as 0%.':`${rarityMissing} achievements have unknown rarity and ${filterRarity!=='all'?'are excluded from rarity filters':'remain last in percentage sorting'}.`;
  const confirmed=currentAchList.filter(a=>a.unlocked===true).length, unknown=currentAchList.filter(a=>a.unlocked===null).length;
  $('achProgressText').textContent=unknown===currentAchList.length && unknown>0 ? `${unknown} achievements · Personal state not verified` : `${confirmed}/${currentAchList.length-unknown} verified achievements unlocked${unknown ? ` · ${unknown} not verified` : ''}`;
  $('achProgressFill').style.width=(currentAchList.length?confirmed/currentAchList.length*100:0)+'%';
  if(currentAchMethod==='cached')$('achProgressText').textContent='Previous reading · '+$('achProgressText').textContent;
  const availability=new Map(currentAchList.map(a=>[a,AchievementAvailability.classify(a,{method:currentAchMethod,allowActivation:active?.tokenSource==='environment'&&active?.connected!==false})]));
  const remaining=[...availability.values()].filter((v,i)=>currentAchList[i].unlocked!==true),count=status=>remaining.filter(v=>v.status===status).length;
  $('achCompatibilitySummary').textContent=currentAchList.length?(remaining.length===0?'All achievements are already unlocked.':`Pending: ${remaining.filter(v=>v.canAttempt).length} eligible to attempt · ${count('protected')} protected · ${count('unsupported')} unsupported · ${count('unknown')} unknown · ${count('rejected')+count('review')} need review. Eligibility is provisional; only a fresh Steam read can confirm a write.`):'';
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.val===(b.dataset.filter==='status'?filterStatus:filterRarity)));
  let list=currentAchList.filter(a=>(!searchQuery || (a.name+' '+a.description).toLowerCase().includes(searchQuery)) && (filterStatus==='all'||filterStatus==='unlocked'&&a.unlocked===true||filterStatus==='locked'&&a.unlocked===false) && (filterRarity==='all'||a.percent!==null && (filterRarity==='mythic'&&a.percent<5||filterRarity==='epic'&&a.percent>=5&&a.percent<15||filterRarity==='rare'&&a.percent>=15&&a.percent<40)));
  if(currentSort==='alpha') list.sort((a,b)=>a.name.localeCompare(b.name));
  list=list.filter(a=>{const v=availability.get(a);return filterCompatibility==='all'||filterCompatibility==='attemptable'&&v.canAttempt||filterCompatibility==='unavailable'&&a.unlocked===false&&!['unknown','review'].includes(v.status)&&!v.canAttempt||filterCompatibility==='unknown'&&(v.status==='unknown'||v.status==='review');});
  if(['rarity_rare','rarity_common','percentage_desc'].includes(currentSort)) list.sort((a,b)=>a.percent===null&&b.percent===null?0:a.percent===null?1:b.percent===null?-1:(a.percent-b.percent)*(currentSort==='rarity_rare'?1:-1));
  if(currentSort==='locked_first'||currentSort==='unlocked_first') list.sort((a,b)=>Number(a.unlocked===true)-Number(b.unlocked===true));
  if(currentSort==='unlocked_first') list.reverse();
  const cont=$('achListContainer'); cont.replaceChildren();
  const pages=Math.max(1,Math.ceil(list.length/200));page=Math.min(Math.max(0,page),pages-1);
  for(const a of list.slice(page*200,(page+1)*200)) {
    const row=element('div',undefined,'ach-item '+(a.unlocked===true?'unlocked-item':'locked-item'));
    row.append(image(a.unlocked?a.iconOpen:a.iconClosed));
    const info=element('div',undefined,'ach-info'); info.append(element('div',a.name,'ach-title'),element('div',a.description,'ach-desc'),element('small',a.percent===null?'Unknown rarity':`${a.tier} · ${a.percent.toFixed(1)}%`));
    if(a.unlockTimestamp) info.append(element('small','Steam-reported unlock date: '+new Date(a.unlockTimestamp*1000).toLocaleString('en-US'),'ach-date')); else if(a.unlockDate) info.append(element('small','Steam-reported unlock date: '+a.unlockDate,'ach-date'));
    const recordedAt=a.panelVerifiedAt||a.panelOperationAt;
    if(recordedAt&&Number.isFinite(Date.parse(recordedAt)))info.append(element('small',(a.panelVerifiedAt?'Verified by this panel: ':'Panel operation recorded: ')+new Date(recordedAt).toLocaleString('en-US'),'ach-date panel-date'));
    if(a.panelOperationAt&&a.unlockTimestamp&&a.unlockTimestamp*1000<Date.parse(a.panelOperationAt)-86400000)info.append(element('small','Steam\'s reported date predates this panel operation. It is separate from the recorded test time.','ach-date-note'));
    if(a.hidden===true)info.append(element('small',' · Hidden achievement'));
    if(a.progressDetails)info.append(element('small',` · Progress: ${a.progressDetails.currentValue??'unknown'} / ${a.progressDetails.maximum??'unknown'}`));
    if(a.serverControlled) info.append(element('small',' · Server-controlled'));
    if(a.hasProgressDependency) info.append(element('small',' · Linked progress statistic'));
    const available=availability.get(a),classification=element('div',available.label,'ach-availability '+available.status);classification.title=available.reason;info.append(classification);
    if(a.unlocked!==true){info.append(element('small',available.reason,'ach-write-reason'));if(available.action&&active?.tokenSource!=='environment')info.append(element('small','Activation from this panel is available only on the server-managed main account.','ach-write-reason'));if(available.provisional)info.append(element('small','Not guaranteed: Steam must accept the update and a fresh read must confirm it.','ach-write-reason'));}
    if(currentAchMethod==='protocol' && a.compatibility) {
      if(a.unlocked===false && active?.tokenSource==='environment') {
        if(available.canAttempt&&available.action==='unlock'){const unlock=button(experimentBusy?'Checking Steam…':'Unlock achievement',()=>unlockIndividualAchievement(a));unlock.disabled=experimentBusy;unlock.title=a.compatibility.reason;info.append(unlock);}
        if(a.hasProgressDependency&&(available.canAttempt&&available.action==='progress'||a.progressSupport?.canPreviewShared||a.progressSupport?.canPreviewFloat)){const progress=button(experimentBusy?'Checking Steam…':'Review progress',()=>reviewAchievementProgress(a));progress.disabled=experimentBusy;info.append(progress);}
      }
      if(a.unlocked!==true && !a.compatibility.canUnlock)info.append(element('small',a.compatibility.action||'','ach-write-reason'));
    } else if(currentAchMethod==='web' && a.unlocked===false) info.append(element('small','Choose Direct verification in the reading mode to check activation compatibility.','ach-write-reason'));
    row.append(info,element('span',a.unlocked===true?'✓ Verified':a.unlocked===false?'Locked':'Not verified','ach-state'+(a.unlocked===true?' verified':''))); cont.append(row);
  }
  if(pages>1){const nav=element('div',undefined,'ach-pagination');if(page>0)nav.append(button('Previous',()=>{renderAchModal(page-1);cont.scrollTop=0;}));nav.append(element('span',`Page ${page+1} of ${pages} · ${list.length} matching achievements`));if(page+1<pages)nav.append(button('Next',()=>{renderAchModal(page+1);cont.scrollTop=0;}));cont.append(nav);}
  if(!list.length) { const message=element('p',filterRarity!=='all'&&rarityLoading?'Loading rarity percentages from Steam…':filterRarity!=='all'&&rarityMissing===currentAchList.length&&currentAchList.length?'Steam has not supplied rarity percentages for this list. Try again later or use Show all.':currentAchList.length?'No achievements match these filters.':'No achievement list is available. Check the Steam message above.'); cont.append(message); if(currentAchList.length) cont.append(button('Show all',()=>{filterStatus='all';filterRarity='all';filterCompatibility='all';$('achCompatibilityFilter').value='all';searchQuery='';$('achSearchInput').value='';renderAchModal();})); }
}
function reviewAchievementProgress(row){
  if(row.progressSupport?.canPreviewFloat)return reviewFloatProgress(row);
  if(row.progressSupport?.canPreviewShared)return reviewSharedProgress(row);
  return completeAchievementProgress(row);
}
async function reviewFloatProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canPreviewFloat||!currentAchAppId)return;
  const serial=achSerial,account=activeAccountId,id=currentAchAppId;
  try{
    const review=await api('/api/achievement/float-progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));
    if(serial!==achSerial||account!==activeAccountId||id!==currentAchAppId)return;
    const p=review.counter,summary=$('sharedProgressSummary');summary.replaceChildren();
    document.querySelector('#sharedProgressReview .eyebrow').textContent='PROGRESS REVIEW';document.querySelector('#sharedProgressReview h3').textContent='Review progress';
    summary.append(element('span','Preview only','eyebrow'),element('h3',review.name));
    const flow=element('div',undefined,'shared-counter-flow');
    for(const [label,value]of [['Current',p.before],['Target preview',p.after]]){const box=element('div',undefined,'shared-counter-value');box.append(element('small',label),element('strong',String(value)));flow.append(box);}
    summary.append(flow,element('small',`Goal: ${p.goal}`,'shared-counter-meta'));
    const effects=$('sharedProgressEffects');effects.replaceChildren();
    const card=element('article',undefined,'shared-effect-card progress_only');
    card.append(element('strong','Progress limits'),element('p',`Allowed range: ${p.min} to ${p.max}`),element('p',p.maxChange>0?'Maximum change: '+p.maxChange:'No maximum change declared'));
    effects.append(card);$('sharedProgressActions').replaceChildren();$('sharedProgressMessage').textContent='You can review this progress, but activation is not supported yet. No changes have been sent to Steam.';
    $('sharedProgressReview').hidden=false;document.querySelector('.ach-modal-card').classList.add('shared-review-open');
  }catch(e){if(serial===achSerial&&account===activeAccountId)notice(e.message);}
}
async function refreshWriteHistory(){
  if(!activeAccountId)return;
  const account=activeAccountId;
  try{const result=await api('/api/achievement/history?accountId='+encodeURIComponent(account));if(account!==activeAccountId)return;const list=$('historyList');list.replaceChildren();
    for(const receipt of result.entries){const item=element('div',undefined,'ach-impact-effect');item.append(element('strong',receipt.name||receipt.apiname||'Recorded attempt'),element('span',receipt.outcome||'Unknown result'));if(receipt.checkedAt)item.append(element('small',new Date(receipt.checkedAt).toLocaleString('en-US')));if(receipt.progressChanges?.length)item.append(element('small',receipt.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join(' · ')));if(receipt.sharedEffects?.length)for(const effect of receipt.sharedEffects){const verified=receipt.sharedVerification?.find(v=>v.apiname===effect.apiname)?.verified===true;item.append(element('small',`${effect.name||effect.apiname}: ${effect.effect} · ${effect.before} → ${effect.after} · ${verified?'Verified effect':'Recorded intent; not confirmed'}`));}list.append(item);}
    if(!result.entries.length)list.append(element('p','No recorded attempts are available for this account. This does not mean no achievements were activated before history was connected.'));
  }catch(e){notice(e.message);}
}
async function reviewSharedProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canPreviewShared)return;
  const id=currentAchAppId,account=activeAccountId,serial=achSerial;
  try{const result=await api('/api/achievement/shared-progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));if(account!==activeAccountId||id!==currentAchAppId||serial!==achSerial)return;
    document.querySelector('#sharedProgressReview .eyebrow').textContent='REVIEW BEFORE CONFIRMING';document.querySelector('#sharedProgressReview h3').textContent='Shared progress update';
    const format=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US'):'Unknown';
    const summary=$('sharedProgressSummary');summary.replaceChildren(element('code',result.counter.statName,'shared-counter-key'));
    const flow=element('div',undefined,'shared-counter-flow'),from=element('div',undefined,'shared-counter-value'),to=element('div',undefined,'shared-counter-value proposed');
    from.append(element('small','Current counter'),element('strong',format(result.counter.before)));to.append(element('small','Proposed counter'),element('strong',format(result.counter.after)));
    flow.append(from,element('span','→','shared-counter-arrow'),to);summary.append(flow,element('small',`${result.effects.length} related achievements · ${result.effects.filter(e=>e.effect==='would_unlock').length} would unlock`,'shared-counter-meta'));
    const list=$('sharedProgressEffects');list.replaceChildren();$('sharedProgressActions').replaceChildren();
    const labels={would_unlock:'Would unlock',already_unlocked:'Already unlocked',progress_only:'Stays locked · Progress only',unknown:'Impact unknown',restricted:'Restricted'};
    for(const effect of result.effects){
      const item=element('article',undefined,'shared-effect-card '+effect.effect),header=element('div',undefined,'shared-effect-heading');
      header.append(element('strong',effect.name),element('span',labels[effect.effect]||'Impact unknown','shared-effect-badge'));item.append(header);
      if(Number.isFinite(effect.goal)&&effect.goal>0&&Number.isFinite(effect.after)){
        const ratio=Math.max(0,Math.min(100,effect.after/effect.goal*100)),track=element('div',undefined,'shared-progress-track'),fill=element('div',undefined,'shared-progress-fill');fill.style.width=ratio+'%';track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label','Proposed progress for '+effect.name);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(effect.goal));track.setAttribute('aria-valuenow',String(Math.max(0,Math.min(effect.goal,effect.after))));item.append(track);
        item.append(element('small',`After update: ${format(effect.after)} / ${format(effect.goal)} · ${ratio.toFixed(1)}%`,'shared-effect-progress'));
      }else item.append(element('small',`Goal: ${format(effect.goal)}`,'shared-effect-progress'));
      if(effect.effect==='progress_only')item.append(element('small','This achievement would stay locked. Only its shared progress changes.','shared-effect-note'));
      if(effect.hidden)item.append(element('small','Hidden achievement','shared-effect-note'));list.append(item);
    }
    $('sharedProgressMessage').textContent=result.canActivate===true?'Review the unlock and all progress changes. Nothing has been sent to Steam yet.':result.message+' No changes have been sent to Steam.';$('sharedProgressReview').hidden=false;document.querySelector('.ach-modal-card').classList.add('shared-review-open');
    const target=currentAchList.find(a=>a.apiname===row.apiname);if(target){target.sharedSupport={canComplete:result.canActivate===true};renderAchModal();}
    if(result.canActivate===true){const activate=button('Confirm reviewed shared update',()=>completeSharedProgress(result,{id,account,serial}),'btn-main shared-confirm');$('sharedProgressActions').append(activate);}
  }catch(e){notice(e.message);}
}
$('historyRefresh').addEventListener('click',refreshWriteHistory);
$('closeSharedReview').addEventListener('click',()=>{$('sharedProgressReview').hidden=true;document.querySelector('.ach-modal-card').classList.remove('shared-review-open');});
async function completeSharedProgress(preview,{id,account,serial}){
  if(experimentBusy||serial!==achSerial||id!==currentAchAppId||account!==activeAccountId||currentAchMethod!=='protocol')return;
  const effects=preview.effects.map(e=>e.name+': '+e.effect+' (goal '+e.goal+')').join('\n');
  if(!confirm('Apply this reviewed shared-counter update?\n'+preview.counter.statName+': '+preview.counter.before+' → '+preview.counter.after+'\n'+effects+'\nThis changes Steam statistics, not verified game-save progress. No automatic retry will be sent.'))return;
  achievementPreviews.clear();experimentBusy=true;const title=currentAchGameName;
  try{const result=await api('/api/achievement/unlock',{accountId:account,appid:id,apiname:preview.apiname,mode:'shared',revision:preview.revision});notice(result.message);if(account===activeAccountId&&id===currentAchAppId)await openAchModal(id,title,true,'protocol');}
  catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(account===activeAccountId&&id===currentAchAppId)renderAchModal();}
}
async function completeAchievementProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canComplete||!currentAchAppId)return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName;experimentBusy=true;renderAchModal();
  try{
    const preview=await api('/api/achievement/progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));
    if(account!==activeAccountId||id!==currentAchAppId)return;
    const changes=preview.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join('\n');
    if(!confirm(`Complete "${preview.name}" in "${title}"?\n\n${changes}\n\n${preview.message}\nSteam will verify the reviewed changes and reject a stale preview. Compatibility remains provisional until Steam confirms.`))return;
    achievementPreviews.clear();const result=await api('/api/achievement/unlock',{accountId:account,appid:id,apiname:row.apiname,mode:'progress',revision:preview.revision});notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));
  }catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(account===activeAccountId&&currentAchAppId===id&&$('achModal').style.display==='flex')await openAchModal(id,title,true,'protocol');}
}
async function unlockIndividualAchievement(row) {
  if(experimentBusy || currentAchMethod!=='protocol' || !row.compatibility?.canUnlock || !currentAchAppId) return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName;
  if(!confirm(`Activate only "${row.name}" in "${title}" on the selected main Steam account? Steam will be re-read before and after one write. Compatibility is provisional until verified.`))return;
  achievementPreviews.clear();experimentBusy=true;renderAchModal();
  try {const result=await api('/api/achievement/unlock',{accountId:account,appid:id,apiname:row.apiname});notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));}
  catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally {experimentBusy=false;if(account===activeAccountId && currentAchAppId===id && $('achModal').style.display==='flex')await openAchModal(id,title,true,'protocol');else if($('achModal').style.display==='flex')renderAchModal();}
}
async function addGame(id,name) { const account=activeAccountId; const result=await action('/api/add',{appid:Number(id),name:name||''}); if(result && account===activeAccountId) $('searchInput').value=''; }
function removeGame(id){return action('/api/remove',{appid:id});}
function clearAll(){if(confirm('Remove all games from the manual list?'))return action('/api/clear-all');}
function applyPreset(key){return action('/api/apply-preset',{presetKey:key});}
function togglePause(){return action('/api/toggle');}
function togglePersona(){return action('/api/persona');}
function toggleCards(){return action('/api/toggle-cards');}
async function claimFreeGames(){const r=await action('/api/claim-free');if(r)notice(`Steam granted ${r.granted.apps.length} apps and ${r.granted.packages.length} packages.`);}
function saveSleep(){return action('/api/set-sleep',{enabled:$('sleepEnabled').checked,start:Number($('sleepStart').value),end:Number($('sleepEnd').value),timezone:$('timezoneInput').value},'Sleep schedule updated. Equal start and end hours disable sleep mode.');}
function saveCustomStatus(){return action('/api/custom-status',{status:$('customStatusInput').value},'Custom status updated.');}
async function saveWebhook(){try{await api('/api/set-webhook',{webhook:$('webhookInput').value.trim()});$('webhookInput').value='';notice('Webhook updated.');await loadStatus();}catch(e){notice(e.message);}}
let debounce;
$('searchInput').addEventListener('input',()=>{
  clearTimeout(debounce); const serial=++searchSerial,term=$('searchInput').value.trim(); $('searchResults').replaceChildren(); $('searchResults').style.display='none';
  if(!term||/^\d+$/.test(term))return;
  debounce=setTimeout(async()=>{try{const list=await api('/api/search?term='+encodeURIComponent(term));if(serial!==searchSerial)return;for(const item of list){const b=button(item.name,()=>{addGame(item.id,item.name);$('searchResults').style.display='none';},'search-item');b.prepend(image(item.img));$('searchResults').append(b);}$('searchResults').style.display=list.length?'block':'none';}catch(e){notice(e.message);}},350);
});
$('searchInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&/^\d+$/.test($('searchInput').value.trim()))addGame(Number($('searchInput').value));});
$('pinInput').addEventListener('keydown',event=>{if(event.key==='Enter')unlock();});
document.addEventListener('click',event=>{if(!$('searchResults').contains(event.target)&&event.target!==$('searchInput'))$('searchResults').style.display='none';});
setInterval(()=>{if(document.hidden)return;const start=active?.sessionStartTime, count=active?.runningGames?.length||0;const seconds=start&&active.isFarming?Math.max(0,Math.floor((Date.now()-start)/1000)):0;$('timerVal').textContent=`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;$('hoursVal').textContent=(seconds/3600*count).toFixed(1)+' estimated hrs';},1000);
document.addEventListener('keydown',event=>{if(event.key==='Escape' && $('achModal').style.display==='flex')closeAchModal();});
$('achModal').addEventListener('click',event=>{if(event.target===$('achModal'))closeAchModal();});
setInterval(()=>{if(!document.hidden)return loadStatus();},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)return loadStatus();});
document.querySelector('[data-event-0]').addEventListener('click', function(event) { unlock(); });
document.querySelector('[data-event-1]').addEventListener('click', function(event) { submitGuard(); });
document.querySelector('[data-event-2]').addEventListener('click', function(event) { submitAddAccount(); });
document.querySelector('[data-event-3]').addEventListener('click', function(event) { closeAddAccModal(); });
$('achReadMode').addEventListener('change',()=>{if(currentAchAppId)openAchModal(currentAchAppId,currentAchGameName,true,$('achReadMode').value);});
$('achCompatibilityFilter').addEventListener('change',()=>{filterCompatibility=$('achCompatibilityFilter').value;renderAchModal();});
document.querySelector('[data-event-4]').addEventListener('click', function(event) { forceRefreshAchievements(); });
document.querySelector('[data-event-5]').addEventListener('click', function(event) { closeAchModal(); });
document.querySelector('[data-event-6]').addEventListener('click', function(event) { setFilter('status', 'all'); });
document.querySelector('[data-event-7]').addEventListener('click', function(event) { setFilter('status', 'unlocked'); });
document.querySelector('[data-event-8]').addEventListener('click', function(event) { setFilter('status', 'locked'); });
document.querySelector('[data-event-9]').addEventListener('click', function(event) { setFilter('rarity', 'mythic'); });
document.querySelector('[data-event-10]').addEventListener('click', function(event) { setFilter('rarity', 'epic'); });
document.querySelector('[data-event-11]').addEventListener('click', function(event) { setFilter('rarity', 'rare'); });
document.querySelector('[data-event-12]').addEventListener('change', function(event) { setSort(this.value); });
document.querySelector('[data-event-13]').addEventListener('input', function(event) { onSearchInput(this.value); });
document.querySelector('[data-event-15]').addEventListener('click', function(event) { openAddAccModal(); });
document.querySelector('[data-event-16]').addEventListener('click', function(event) { reloginAccount(); });
document.querySelector('[data-event-17]').addEventListener('click', function(event) { logoutSteam(); });
document.querySelector('[data-event-18]').addEventListener('click', function(event) { deleteCurrentAccount(); });
document.querySelector('[data-event-19]').addEventListener('click', function(event) { toggleCards(); });
document.querySelector('[data-event-20]').addEventListener('click', function(event) { claimFreeGames(); });
document.querySelector('[data-event-21]').addEventListener('click', function(event) { togglePersona(); });
document.querySelector('[data-event-22]').addEventListener('click', function(event) { changePanelPassword(); });
document.querySelector('[data-event-23]').addEventListener('click', function(event) { lock(); });
document.querySelector('[data-event-24]').addEventListener('click', function(event) { togglePause(); });
document.querySelector('[data-event-25]').addEventListener('click', function(event) { clearAll(); });
document.querySelector('[data-event-26]').addEventListener('click', function(event) { saveCustomStatus(); });
document.querySelector('[data-event-27]').addEventListener('click', function(event) { saveWebhook(); });
document.querySelector('[data-event-28]').addEventListener('click', function(event) { saveSleep(); });
document.querySelector('[data-event-29]').addEventListener('click', function(event) { editChatAdmins(); });
checkAuth();
