'use strict';
const $ = id => document.getElementById(id);
let csrf = '', activeAccountId = sessionStorage.getItem('sf_account') || '', accounts = [], active = null;
let currentAchList = [], currentAchAppId = null, achAccountId = null, currentAchGameName = '', selectedApinames = new Set();
let filterStatus = 'all', filterRarity = 'all', currentSort = 'default', searchQuery = '';
let loginAttempt = null, loginTimer = null, loginTarget = null, loginSerial = 0, noticeTimer, statusBusy = false, searchSerial = 0, achSerial = 0;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 10000); }
async function api(endpoint, body) {
  const headers = {}; const options = { headers, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; options.method = 'POST'; options.body = JSON.stringify(body); }
  const response = await fetch(endpoint, options); const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && endpoint !== '/api/panel/login' && endpoint !== '/api/panel/password') showLock();
    throw new Error(data.error || 'La operación falló.');
  }
  return data;
}
function showLock() { loginSerial++; csrf = ''; stopLoginPoll(); $('lockModal').style.display = 'flex'; $('addAccModal').style.display = 'none'; closeAchModal(); $('pinInput').value = ''; }
async function checkAuth() { localStorage.removeItem('farmer_pin'); try { csrf = (await api('/api/panel/session')).csrf; $('lockModal').style.display = 'none'; await loadStatus(); } catch { showLock(); } }
async function unlock() { try { csrf = (await api('/api/panel/login', { password: $('pinInput').value })).csrf; $('pinInput').value = ''; $('lockModal').style.display = 'none'; await loadStatus(); } catch (e) { notice(e.message); } }
async function lock() { try { await api('/api/panel/logout', {}); showLock(); } catch (e) { notice(e.message); } }
async function changePanelPassword() {
  const currentPassword = prompt('Contraseña actual del panel:'); if (currentPassword === null) return;
  const password = prompt('Nueva contraseña del panel (mínimo 12 caracteres):'); if (password === null) return;
  try { await api('/api/panel/password', { currentPassword, password }); showLock(); notice('Contraseña actualizada. Volvé a entrar.'); } catch (e) { notice(e.message); }
}
async function reqAction(endpoint, body = {}) { if (!activeAccountId) throw Error('Agregá o seleccioná una cuenta.'); return api(endpoint, { ...body, accountId: activeAccountId }); }
async function action(endpoint, body = {}, message) { try { const r = await reqAction(endpoint, body); if (message) notice(message); await loadStatus(); return r; } catch(e) { notice(e.message); return null; } }
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(label, callback, className = 'btn-action-sm') { const b = element('button', label, className); b.addEventListener('click', callback); return b; }
function image(src, className) {
  const img = element('img', undefined, className); img.alt = ''; try { const u = new URL(src); if (u.protocol === 'https:') img.src = u.href; } catch {}
  img.addEventListener('error', () => img.hidden = true); return img;
}
async function loadStatus() {
  if (!csrf || statusBusy) return; statusBusy = true;
  try {
    const data = await api('/api/status'); accounts = data.accounts;
    if (!accounts.some(a => a.id === activeAccountId)) activeAccountId = accounts[0]?.id || '';
    sessionStorage.setItem('sf_account', activeAccountId); active = accounts.find(a => a.id === activeAccountId) || null;
    renderAccountsTabs(accounts, activeAccountId); renderPresets(data.presets);
    $('webhookInput').placeholder = data.webhookConfigured ? 'Webhook configurado. Pegá otro para reemplazarlo.' : 'https://discord.com/api/webhooks/...';
    if (document.activeElement !== $('timezoneInput')) $('timezoneInput').value = data.timezone;
    $('achQueueVal').textContent = 'Lectura real de Steam';
    if (!active) { $('userLabel').textContent = 'Agregá tu cuenta Steam para empezar'; $('statusText').textContent = 'Sin cuenta'; $('badgeStatus').className = 'badge-status paused'; $('gamesGrid').replaceChildren(); $('timerVal').textContent = '00h 00m 00s'; $('hoursVal').textContent = '0.0 hrs estimadas'; $('gamesCountVal').textContent = '0 / 32'; $('capacityPercent').textContent = '0%'; $('capacityFill').style.width = '0%'; return; }
    $('userLabel').textContent = `${active.name} (${active.user})`;
    $('statusText').textContent = !active.connected ? (active.error || 'Desconectado') : active.isCollisionPaused ? 'Jugando en otra sesión' : active.isSleepPaused ? 'Horario de descanso' : active.isPaused ? 'Pausado' : active.cardFarming && !active.cardsReady ? 'Consultando cromos' : active.isFarming ? 'Actividad enviada a Steam' : 'Sin juegos activos';
    $('badgeStatus').className = 'badge-status' + (!active.isFarming ? ' paused' : '');
    $('playBtn').textContent = active.isPaused ? 'Reanudar' : 'Pausar';
    $('personaBtn').textContent = active.personaState === 7 ? 'Invisible' : 'Online';
    $('cardsBtn').textContent = active.cardFarming ? `Cromos: ${active.cardDropGames.length} juegos` : 'Cromos: OFF';
    $('cardsBtn').title = active.cardError || '';
    $('gamesCountVal').textContent = active.games.length + ' / 32';
    const pct = Math.round(active.games.length / 32 * 100); $('capacityPercent').textContent = pct + '%'; $('capacityFill').style.width = pct + '%';
    if (document.activeElement !== $('customStatusInput')) $('customStatusInput').value = active.customStatus || '';
    if (document.activeElement !== $('sleepEnabled')) $('sleepEnabled').checked = active.sleepMode.enabled;
    for (const [id,key] of [['sleepStart','start'], ['sleepEnd','end']]) if (document.activeElement !== $(id)) $(id).value = active.sleepMode[key];
    renderGames(active.games);
  } catch (e) { notice(e.message); } finally { statusBusy = false; }
}
function renderAccountsTabs(list, selected) {
  $('accountsTabsContainer').replaceChildren(...list.map(a => button(`${a.name} (${a.games.length})`, () => switchAccount(a.id), 'acc-pill' + (a.id === selected ? ' active' : ''))));
}
function switchAccount(id) { if (id === activeAccountId) return; activeAccountId = id; sessionStorage.setItem('sf_account', id); active = accounts.find(a=>a.id===id); closeAchModal(); loadStatus(); }
function renderPresets(list) { $('presetsContainer').replaceChildren(element('span','Presets:')); for (const p of list) $('presetsContainer').append(button(p.name, () => applyPreset(p.key), 'chip')); }
function renderGames(games) {
  const grid = $('gamesGrid'); grid.replaceChildren();
  if (!games.length) { grid.append(element('p','Agregá juegos por nombre o AppID.')); return; }
  for (const id of games) {
    const title = active.gameNames[id] || `AppID ${id}`; const card = element('div',undefined,'card');
    card.append(image(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,'card-banner'));
    const content = element('div',undefined,'card-content'); content.append(element('div',title,'card-title'),element('div',`#${id}`,'card-appid'));
    const actions = element('div',undefined,'card-actions'); actions.append(button('Logros',()=>openAchModal(id,title),'btn-card-ach'),button('Quitar',()=>removeGame(id),'btn-card-remove'));
    content.append(actions); card.append(content); grid.append(card);
  }
}
function stopLoginPoll() { clearTimeout(loginTimer); loginTimer = null; }
function openAddAccModal() { loginTarget = active && !active.user ? active.id : null; $('newAccUser').value = ''; $('newAccName').value = ''; $('newAccPassword').value = ''; $('steamGuardCode').value = ''; $('steamLoginMessage').textContent = ''; $('guardControls').hidden = true; $('connectSteamBtn').disabled = false; $('addAccModal').style.display = 'flex'; }
async function closeAddAccModal() { loginSerial++; stopLoginPoll(); if (loginAttempt) { const id = loginAttempt; loginAttempt = null; try { await api('/api/steam/cancel', { attemptId:id }); } catch {} } $('newAccPassword').value = ''; $('steamGuardCode').value = ''; $('addAccModal').style.display = 'none'; }
function reloginAccount() { if (!active) return notice('Seleccioná una cuenta.'); if (active.tokenSource === 'environment') return notice('Esta cuenta se conecta con STEAM_REFRESH_TOKEN de Render. Cambiá esa variable si necesitás una sesión nueva.'); openAddAccModal(); loginTarget = active.id; $('newAccUser').value = active.user; $('newAccName').value = active.name; }
async function submitAddAccount() {
  const serial = ++loginSerial;
  $('connectSteamBtn').disabled = true; $('steamLoginMessage').textContent = 'Conectando con Steam…';
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
  if (data.phase === 'authenticated') { activeAccountId = data.accountId; loginAttempt = null; stopLoginPoll(); $('addAccModal').style.display = 'none'; notice('Sesión guardada automáticamente. Ya no necesitás copiar tokens.'); loadStatus(); return; }
  if (['failed','expired','cancelled'].includes(data.phase)) { $('steamLoginMessage').textContent = data.error || 'Intento cancelado.'; $('connectSteamBtn').disabled = false; stopLoginPoll(); return; }
  $('steamLoginMessage').textContent = data.phase === 'guard' ? ('Steam Guard: ' + data.guards.map(g => /DeviceConfirmation/.test(g.label) ? 'aprobá el acceso en la app Steam del teléfono' : /EmailCode/.test(g.label) ? 'ingresá el código enviado por correo' : /DeviceCode/.test(g.label) ? 'ingresá el código de tu autenticador' : 'completá la confirmación de Steam').join(' o ')) : 'Esperando confirmación de Steam…';
  stopLoginPoll(); loginTimer = setTimeout(pollLogin, 1500);
}
async function pollLogin() { const id = loginAttempt; if (!id || !csrf) return; try { handleLogin(await api('/api/steam/login-status?attemptId=' + encodeURIComponent(id))); } catch(e) { if (id !== loginAttempt) return; $('steamLoginMessage').textContent = e.message; $('connectSteamBtn').disabled = false; stopLoginPoll(); } }
async function submitGuard() { const id = loginAttempt; if (!id) return; try { const code = $('steamGuardCode').value.trim(); $('steamGuardCode').value=''; handleLogin(await api('/api/steam/guard',{attemptId:id,code})); } catch(e) { notice(e.message); } }
async function deleteCurrentAccount() { if (!active || !confirm('¿Eliminar este perfil y su sesión guardada?')) return; if (await action('/api/account/remove')) { activeAccountId=''; closeAchModal(); await loadStatus(); } }
async function logoutSteam() { if (active && confirm('¿Cerrar la sesión Steam y olvidar el acceso guardado?')) await action('/api/steam/logout',{},'Sesión Steam eliminada.'); }
async function editChatAdmins() { if (!active) return; const value = prompt('SteamID64 autorizados, separados por comas. Vacío desactiva comandos.', (active.chatAdmins||[]).join(',')); if(value !== null) await action('/api/chat-admins',{steamids:value.split(',').map(v=>v.trim()).filter(Boolean)},'Permisos de chat actualizados.'); }
async function openAchModal(id,title,forceRefresh=false) {
  if (currentAchAppId !== id || achAccountId !== activeAccountId) {
    filterStatus='all'; filterRarity='all'; currentSort='default'; searchQuery='';
    $('achSortSelect').value='default'; $('achSearchInput').value='';
  }
  document.body.classList.add('achievement-open');
  $('achListContainer').scrollTop=0; document.querySelector('.ach-modal-card').scrollTop=0;
  currentAchAppId=id; currentAchGameName=title; achAccountId=activeAccountId; selectedApinames.clear(); currentAchList=[];
  $('achModal').style.display='flex'; $('achGameTitle').textContent=title; $('achProgressText').textContent='Consultando Steam…'; $('achProgressFill').style.width='0%'; $('achListContainer').replaceChildren(); $('achPrivacyWarning').style.display='none';
  const serial = ++achSerial, account = achAccountId;
  try {
    const data=await api(`/api/achievements?accountId=${encodeURIComponent(account)}&appid=${id}${forceRefresh?'&refresh=1':''}`);
    if (serial !== achSerial || account !== activeAccountId) return;
    currentAchList=(Array.isArray(data.achievements)?data.achievements:[]).map(a=>({ ...a, name:String(a.name||a.apiname||'Logro'), description:String(a.description||''), unlocked:typeof a.unlocked==='boolean'?a.unlocked:null, percent:a.percent!=null && a.percent!=='' && Number.isFinite(Number(a.percent))?Number(a.percent):null }));
    $('achReadMessage').textContent=data.message || '';
    $('achPrivacyWarning').style.display=data.message ? 'block':'none';
    $('achGameTitle').textContent=title;
    $('estimatedTimeText').textContent=`${data.source || 'Steam'} · ${new Date(data.checkedAt).toLocaleTimeString()}`;
    renderAchModal();
  } catch(e) { if(serial===achSerial) { $('achProgressText').textContent='No verificado'; $('achListContainer').replaceChildren(element('p',e.message)); } }
}
function closeAchModal() { document.body.classList.remove('achievement-open'); achSerial++; $('achModal').style.display='none'; }
function forceRefreshAchievements() { if(currentAchAppId) return openAchModal(currentAchAppId,currentAchGameName,true); }
function setFilter(type,val) { if(type==='status') filterStatus=val; else filterRarity=filterRarity===val?'all':val; renderAchModal(); }
function setSort(val) { currentSort=val; renderAchModal(); }
function onSearchInput(val) { searchQuery=val.trim().toLowerCase(); renderAchModal(); }
function renderAchModal() {
  const confirmed=currentAchList.filter(a=>a.unlocked===true).length, unknown=currentAchList.filter(a=>a.unlocked===null).length;
  $('achProgressText').textContent=`${confirmed}/${currentAchList.length} desbloqueados${unknown ? ` · ${unknown} sin verificar` : ''}`;
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
    const info=element('div',undefined,'ach-info'); info.append(element('div',a.name,'ach-title'),element('div',a.description,'ach-desc'),element('small',a.percent===null?'Rareza desconocida':`${a.tier} · ${a.percent.toFixed(1)}%`));
    if(a.unlockTimestamp) info.append(element('small',' · '+new Date(a.unlockTimestamp*1000).toLocaleString())); else if(a.unlockDate) info.append(element('small',a.unlockDate));
    row.append(info,element('span',a.unlocked===true?'✓ Confirmado':a.unlocked===false?'Bloqueado':'Sin verificar')); cont.append(row);
  }
  if(!list.length) { const message=element('p',currentAchList.length?'No hay coincidencias con estos filtros.':'No hay una lista disponible. Revisá el mensaje de Steam de arriba.'); cont.append(message); if(currentAchList.length) cont.append(button('Mostrar todos',()=>{filterStatus='all';filterRarity='all';searchQuery='';$('achSearchInput').value='';renderAchModal();})); }
  $('selectAllCheckbox').disabled=true; $('selectedCountText').textContent='Estado leído de Steam';
}
function toggleSelectAll() {} // Read-only achievements have no write selection.
async function addGame(id,name) { const account=activeAccountId; const result=await action('/api/add',{appid:Number(id),name:name||''}); if(result && account===activeAccountId) $('searchInput').value=''; }
function removeGame(id){return action('/api/remove',{appid:id});}
function clearAll(){if(confirm('¿Quitar todos los juegos de la lista manual?'))return action('/api/clear-all');}
function applyPreset(key){return action('/api/apply-preset',{presetKey:key});}
function togglePause(){return action('/api/toggle');}
function togglePersona(){return action('/api/persona');}
function toggleCards(){return action('/api/toggle-cards');}
async function claimFreeGames(){const r=await action('/api/claim-free');if(r)notice(`Steam confirmó ${r.granted.apps.length} apps y ${r.granted.packages.length} paquetes.`);}
function saveSleep(){return action('/api/set-sleep',{enabled:$('sleepEnabled').checked,start:Number($('sleepStart').value),end:Number($('sleepEnd').value),timezone:$('timezoneInput').value},'Horario actualizado. Inicio y fin iguales desactivan el descanso.');}
function saveCustomStatus(){return action('/api/custom-status',{status:$('customStatusInput').value},'Estado actualizado.');}
async function saveWebhook(){try{await api('/api/set-webhook',{webhook:$('webhookInput').value.trim()});$('webhookInput').value='';notice('Webhook actualizado.');await loadStatus();}catch(e){notice(e.message);}}
let debounce;
$('searchInput').addEventListener('input',()=>{
  clearTimeout(debounce); const serial=++searchSerial,term=$('searchInput').value.trim(); $('searchResults').replaceChildren(); $('searchResults').style.display='none';
  if(!term||/^\d+$/.test(term))return;
  debounce=setTimeout(async()=>{try{const list=await api('/api/search?term='+encodeURIComponent(term));if(serial!==searchSerial)return;for(const item of list){const b=button(item.name,()=>{addGame(item.id,item.name);$('searchResults').style.display='none';},'search-item');b.prepend(image(item.img));$('searchResults').append(b);}$('searchResults').style.display=list.length?'block':'none';}catch(e){notice(e.message);}},350);
});
$('searchInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&/^\d+$/.test($('searchInput').value.trim()))addGame(Number($('searchInput').value));});
$('pinInput').addEventListener('keydown',event=>{if(event.key==='Enter')unlock();});
document.addEventListener('click',event=>{if(!$('searchResults').contains(event.target)&&event.target!==$('searchInput'))$('searchResults').style.display='none';});
setInterval(()=>{const start=active?.sessionStartTime, count=active?.runningGames?.length||0;const seconds=start&&active.isFarming?Math.max(0,Math.floor((Date.now()-start)/1000)):0;$('timerVal').textContent=`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;$('hoursVal').textContent=(seconds/3600*count).toFixed(1)+' hrs estimadas';},1000);
document.addEventListener('keydown',event=>{if(event.key==='Escape' && $('achModal').style.display==='flex')closeAchModal();});
$('achModal').addEventListener('click',event=>{if(event.target===$('achModal'))closeAchModal();});
setInterval(loadStatus,5000);
document.querySelector('[data-event-0]').addEventListener('click', function(event) { unlock(); });
document.querySelector('[data-event-1]').addEventListener('click', function(event) { submitGuard(); });
document.querySelector('[data-event-2]').addEventListener('click', function(event) { submitAddAccount(); });
document.querySelector('[data-event-3]').addEventListener('click', function(event) { closeAddAccModal(); });
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
document.querySelector('[data-event-14]').addEventListener('change', function(event) { toggleSelectAll(this.checked); });
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
