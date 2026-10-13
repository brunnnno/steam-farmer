'use strict';
const $ = id => document.getElementById(id);
let csrf = '', activeAccountId = sessionStorage.getItem('sf_account') || '', accounts = [], active = null;
let currentAchList = [], currentAchAppId = null, achAccountId = null, currentAchGameName = '', currentAchMethod = 'web';
let experimentBusy = false;
let filterStatus = 'all', filterRarity = 'all', currentSort = 'default', searchQuery = '';
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
function showLock() { loginSerial++; csrf = ''; stopLoginPoll(); $('lockModal').style.display = 'flex'; $('addAccModal').style.display = 'none'; closeAchModal(); $('pinInput').value = ''; }
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
function image(src, className) {
  const img = element('img', undefined, className); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; try { const u = new URL(src); if (u.protocol === 'https:') img.src = u.href; } catch {}
  img.addEventListener('error', () => img.hidden = true); return img;
}
async function loadStatus() {
  if (!csrf || statusBusy) return; statusBusy = true;
  try {
    const data = await api('/api/status'); accounts = data.accounts;
    if (!accounts.some(a => a.id === activeAccountId)) activeAccountId = accounts[0]?.id || '';
    sessionStorage.setItem('sf_account', activeAccountId); active = accounts.find(a => a.id === activeAccountId) || null;
    renderAccountsTabs(accounts, activeAccountId); renderPresets(data.presets);
    $('webhookInput').placeholder = data.webhookConfigured ? 'Webhook configured. Paste a new one to replace it.' : 'https://discord.com/api/webhooks/...';
    if (document.activeElement !== $('timezoneInput')) $('timezoneInput').value = data.timezone;
    $('achQueueVal').textContent = 'Actual Steam state';
    const storage=data.achievementHistoryStorage;
    $('historyStorage').textContent=storage?.persistent?(storage.available?'Persistent write history connected.':'Persistent history unavailable. Achievement activation is blocked until it recovers.'):'Local history only. Records can be lost when the host restarts or redeploys; persistent storage has not been connected.';
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
let tabsSnapshot = '', presetsSnapshot = '', gamesSnapshot = '';
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
    card.append(image(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,'card-banner'));
    const content = element('div',undefined,'card-content'); content.append(element('div',title,'card-title'),element('div',`#${id}`,'card-appid'));
    const actions = element('div',undefined,'card-actions'); actions.append(button('Achievements',()=>openAchModal(id,title),'btn-card-ach'),button('Remove',()=>removeGame(id),'btn-card-remove'));
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
  if (currentAchAppId !== id || achAccountId !== activeAccountId || currentAchMethod !== method) {
    filterStatus='all'; filterRarity='all'; currentSort='default'; searchQuery='';
    $('achSortSelect').value='default'; $('achSearchInput').value='';
  }
  document.body.classList.add('achievement-open');
  $('achListContainer').scrollTop=0; document.querySelector('.ach-modal-card').scrollTop=0;
  currentAchMethod=method; currentAchAppId=id; currentAchGameName=title; achAccountId=activeAccountId; currentAchList=[];
  $('achModal').style.display='flex'; $('achGameTitle').textContent=title; $('achProgressText').textContent='Loading Steam achievements…'; $('achProgressFill').style.width='0%'; $('achListContainer').replaceChildren(); $('achPrivacyWarning').style.display='none'; $('achievementSource').textContent='';
  const serial = ++achSerial, account = achAccountId;
  $('gameRequirements').hidden=true;$('gameRequirements').open=false;loadGameRequirements(id,serial,account);
  try {
    const data=await api(`/api/achievements?accountId=${encodeURIComponent(account)}&appid=${id}${forceRefresh?'&refresh=1':''}${method==='protocol'?'&method=protocol':''}`);
    if (serial !== achSerial || account !== activeAccountId) return;
    currentAchList=(Array.isArray(data.achievements)?data.achievements:[]).map(a=>({ ...a, name:String(a.name||a.apiname||'Achievement'), description:String(a.description||''), unlocked:typeof a.unlocked==='boolean'?a.unlocked:null, percent:a.percent!=null && a.percent!=='' && Number.isFinite(Number(a.percent))?Number(a.percent):null }));
    $('achReadMessage').textContent=data.message || '';
    $('achPrivacyWarning').style.display=data.message ? 'block':'none';
    $('achGameTitle').textContent=title;
    $('achievementSource').textContent=`${data.source || 'Steam'} · ${new Date(data.checkedAt).toLocaleTimeString('en-US')}`;
    renderAchModal();
  } catch(e) { if(serial===achSerial) { $('achProgressText').textContent='Not verified'; $('achListContainer').replaceChildren(element('p',e.message),...(e.diagnostic?.action?[element('p',e.diagnostic.action)]:[])); } }
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
function closeAchModal() { document.body.classList.remove('achievement-open'); achSerial++; $('achModal').style.display='none'; }
function forceRefreshAchievements() { if(currentAchAppId) return openAchModal(currentAchAppId,currentAchGameName,true,currentAchMethod); }
function setFilter(type,val) { if(type==='status') filterStatus=val; else filterRarity=filterRarity===val?'all':val; renderAchModal(); }
function setSort(val) { currentSort=val; renderAchModal(); }
function onSearchInput(val) { searchQuery=val.trim().toLowerCase(); renderAchModal(); }
function renderAchModal() {
  const confirmed=currentAchList.filter(a=>a.unlocked===true).length, unknown=currentAchList.filter(a=>a.unlocked===null).length;
  $('achProgressText').textContent=unknown===currentAchList.length && unknown>0 ? `${unknown} achievements · Personal state not verified` : `${confirmed}/${currentAchList.length-unknown} verified achievements unlocked${unknown ? ` · ${unknown} not verified` : ''}`;
  $('achProgressFill').style.width=(currentAchList.length?confirmed/currentAchList.length*100:0)+'%';
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.val===(b.dataset.filter==='status'?filterStatus:filterRarity)));
  let list=currentAchList.filter(a=>(!searchQuery || (a.name+' '+a.description).toLowerCase().includes(searchQuery)) && (filterStatus==='all'||filterStatus==='unlocked'&&a.unlocked===true||filterStatus==='locked'&&a.unlocked===false) && (filterRarity==='all'||a.percent!==null && (filterRarity==='mythic'&&a.percent<5||filterRarity==='epic'&&a.percent>=5&&a.percent<15||filterRarity==='rare'&&a.percent>=15&&a.percent<40)));
  if(currentSort==='alpha') list.sort((a,b)=>a.name.localeCompare(b.name));
  if(currentSort==='rarity_rare'||currentSort==='rarity_common') list.sort((a,b)=>a.percent===null?1:b.percent===null?-1:(a.percent-b.percent)*(currentSort==='rarity_rare'?1:-1));
  if(currentSort==='locked_first'||currentSort==='unlocked_first') list.sort((a,b)=>Number(a.unlocked===true)-Number(b.unlocked===true));
  if(currentSort==='unlocked_first') list.reverse();
  const cont=$('achListContainer'); cont.replaceChildren();
  for(const a of list) {
    const row=element('div',undefined,'ach-item '+(a.unlocked===true?'unlocked-item':'locked-item'));
    row.append(image(a.unlocked?a.iconOpen:a.iconClosed));
    const info=element('div',undefined,'ach-info'); info.append(element('div',a.name,'ach-title'),element('div',a.description,'ach-desc'),element('small',a.percent===null?'Unknown rarity':`${a.tier} · ${a.percent.toFixed(1)}%`));
    if(a.unlockTimestamp) info.append(element('small',' · '+new Date(a.unlockTimestamp*1000).toLocaleString('en-US'))); else if(a.unlockDate) info.append(element('small',a.unlockDate));
    if(a.hidden===true)info.append(element('small',' · Hidden achievement'));
    if(a.progressDetails)info.append(element('small',` · Progress: ${a.progressDetails.currentValue??'unknown'} / ${a.progressDetails.maximum??'unknown'}${a.progressDetails.statName?' ('+a.progressDetails.statName+')':''}`));
    if(a.serverControlled) info.append(element('small',' · Server-controlled'));
    if(a.hasProgressDependency) info.append(element('small',' · Linked progress statistic'));
    if(currentAchMethod==='protocol' && a.compatibility) {
      const labels={provisional:'Provisional compatibility',restricted:'Restricted',dependency:'Progress dependent',insufficient_data:'Insufficient data',steam_rejected:'Steam rejected the write',pending_verification:'Verification pending',attempted:'Previously attempted'};
      const label=element('div',a.compatibility.validatedOnAccount?'Verified on this account':labels[a.compatibility.status]||'Insufficient data','ach-compatibility');
      label.title=a.compatibility.reason;info.append(label);
      if(a.unlocked===false && active?.tokenSource==='environment') {
        const unlock=button(experimentBusy?'Checking Steam…':'Unlock achievement',()=>unlockIndividualAchievement(a));
        unlock.disabled=experimentBusy || !a.compatibility.canUnlock;unlock.title=a.compatibility.reason;info.append(unlock);
        if(a.hasProgressDependency){const progress=button(experimentBusy?'Checking Steam…':'Preview progress completion',()=>completeAchievementProgress(a));progress.disabled=experimentBusy||!a.progressSupport?.canComplete;progress.title=a.progressSupport?.reason||'Progress completion is unavailable.';info.append(progress);if(!a.progressSupport?.canComplete)info.append(element('small',a.progressSupport?.reason||'The linked counter has not been checked.','ach-write-reason'));}
        if(a.progressSupport?.canPreviewShared)info.append(button('Review shared counter',()=>reviewSharedProgress(a)));
      }
      if(a.unlocked!==true && !a.compatibility.canUnlock)info.append(element('small',a.compatibility.reason,'ach-write-reason'),element('small',a.compatibility.action||'','ach-write-reason'));
    } else if(currentAchMethod==='web' && a.unlocked===false) info.append(element('small','Use Verify directly to check activation compatibility.','ach-write-reason'));
    row.append(info,element('span',a.unlocked===true?'✓ Verified':a.unlocked===false?'Locked':'Not verified','ach-state'+(a.unlocked===true?' verified':''))); cont.append(row);
  }
  if(!list.length) { const message=element('p',currentAchList.length?'No achievements match these filters.':'No achievement list is available. Check the Steam message above.'); cont.append(message); if(currentAchList.length) cont.append(button('Show all',()=>{filterStatus='all';filterRarity='all';searchQuery='';$('achSearchInput').value='';renderAchModal();})); }
}
async function refreshWriteHistory(){
  if(!activeAccountId)return;
  const account=activeAccountId;
  try{const result=await api('/api/achievement/history?accountId='+encodeURIComponent(account));if(account!==activeAccountId)return;const list=$('historyList');list.replaceChildren();
    for(const receipt of result.entries){const item=element('div',undefined,'ach-impact-effect');item.append(element('strong',receipt.name||receipt.apiname||'Recorded attempt'),element('span',receipt.outcome||'Unknown result'));if(receipt.checkedAt)item.append(element('small',new Date(receipt.checkedAt).toLocaleString('en-US')));if(receipt.progressChanges?.length)item.append(element('small',receipt.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join(' · ')));list.append(item);}
    if(!result.entries.length)list.append(element('p','No recorded attempts are available for this account. This does not mean no achievements were activated before history was connected.'));
  }catch(e){notice(e.message);}
}
async function reviewSharedProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canPreviewShared)return;
  const id=currentAchAppId,account=activeAccountId;
  try{const result=await api('/api/achievement/shared-progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));if(account!==activeAccountId||id!==currentAchAppId)return;
    $('sharedProgressSummary').textContent=`${result.counter.statName}: ${result.counter.before} → ${result.counter.after}. ${result.effects.length} related achievements.`;
    const list=$('sharedProgressEffects');list.replaceChildren();const labels={would_unlock:'Would unlock',already_unlocked:'Already unlocked',progress_only:'Progress would change',unknown:'Impact unknown',restricted:'Restricted'};
    for(const effect of result.effects){const item=element('div',undefined,'ach-impact-effect');item.append(element('strong',effect.name),element('span',labels[effect.effect]||'Impact unknown'),element('small',`Goal: ${effect.goal??'unknown'}${effect.hidden?' · Hidden achievement':''}`));list.append(item);}
    $('sharedProgressMessage').textContent=result.message+' No changes have been sent to Steam.';$('sharedProgressReview').hidden=false;
  }catch(e){notice(e.message);}
}
$('historyRefresh').addEventListener('click',refreshWriteHistory);
$('closeSharedReview').addEventListener('click',()=>{$('sharedProgressReview').hidden=true;});
async function completeAchievementProgress(row){
  if(experimentBusy||currentAchMethod!=='protocol'||!row.progressSupport?.canComplete||!currentAchAppId)return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName;experimentBusy=true;renderAchModal();
  try{
    const preview=await api('/api/achievement/progress-preview?accountId='+encodeURIComponent(account)+'&appid='+id+'&apiname='+encodeURIComponent(row.apiname));
    if(account!==activeAccountId||id!==currentAchAppId)return;
    const changes=preview.progressChanges.map(p=>`${p.statName}: ${p.before} → ${p.after}`).join('\n');
    if(!confirm(`Complete "${preview.name}" in "${title}"?\n\n${changes}\n\n${preview.message}\nSteam will verify the reviewed changes and reject a stale preview. Compatibility remains provisional until Steam confirms.`))return;
    const result=await api('/api/achievement/unlock',{accountId:account,appid:id,apiname:row.apiname,mode:'progress',revision:preview.revision});notice(result.message+(result.diagnostic?.action?' '+result.diagnostic.action:''));
  }catch(e){notice(e.message+(e.diagnostic?.action?' '+e.diagnostic.action:''));}
  finally{experimentBusy=false;if(account===activeAccountId&&currentAchAppId===id&&$('achModal').style.display==='flex')await openAchModal(id,title,true,'protocol');}
}
async function unlockIndividualAchievement(row) {
  if(experimentBusy || currentAchMethod!=='protocol' || !row.compatibility?.canUnlock || !currentAchAppId) return;
  const id=currentAchAppId,account=activeAccountId,title=currentAchGameName;
  if(!confirm(`Activate only "${row.name}" in "${title}" on the selected main Steam account? Steam will be re-read before and after one write. Compatibility is provisional until verified.`))return;
  experimentBusy=true;renderAchModal();
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
$('directVerifyBtn').addEventListener('click',()=>{if(currentAchAppId)openAchModal(currentAchAppId,currentAchGameName,true,'protocol');});
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
