'use strict';
const cheerio = require('cheerio');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { appId } = require('./core');
const HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com', 'api.steampowered.com', 'discord.com', 'discordapp.com']);
async function remote(target, { cookie = '', method = 'GET', body, maxBytes = 2 * 1024 * 1024, timeoutMs = 15000, signal: callerSignal } = {}, fetcher = fetch) {
  let u = new URL(target);
  const origin = u.origin;
  const signal = callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || (u.port && u.port !== '443') || u.username || u.password) throw new Error('Remote destination not allowed.');
    const headers = { 'User-Agent': 'SteamFarmer/2.0', 'Accept-Language': 'en-US,en;q=0.9' };
    if (cookie && u.origin === origin && u.hostname === 'steamcommunity.com') headers.Cookie = cookie;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetcher(u, { signal, redirect: 'manual', method, headers, body });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      if (method !== 'GET') throw new Error('Unexpected redirect.');
      const next = new URL(response.headers.get('location'), u);
      // Steam canonicalizes numeric AppIDs/profile URLs but often drops the requested view.
      // Carry only safe stats-display parameters, never authentication keys or arbitrary query data.
      if (u.hostname === 'steamcommunity.com' && next.origin === u.origin && u.pathname.includes('/stats/') && next.pathname.includes('/stats/')) {
        for (const key of ['tab', 'xml', 'l']) if (u.searchParams.has(key) && !next.searchParams.has(key)) next.searchParams.set(key, u.searchParams.get(key));
      }
      u = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Steam/Discord returned HTTP ${response.status}.`); }
    const declared=Number(response.headers.get('content-length'));
    if(Number.isFinite(declared)&&declared>maxBytes){await response.body?.cancel();throw new Error('Remote response too large.');}
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Remote response too large.');
      chunks.push(Buffer.from(chunk));
    }
    return { body: Buffer.concat(chunks,size).toString('utf8'), finalUrl: u.href };
  }
  throw new Error('Too many redirects.');
}
function tier(percent) {
  if (percent == null) return 'Unknown';
  return percent < 5 ? 'Mythic' : percent < 15 ? 'Epic' : percent < 40 ? 'Rare' : 'Common';
}
function parseXml(xml, percentages = {}) {
  if (XMLValidator.validate(xml) !== true) return [];
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: false }).parse(xml);
  let rows = parsed.playerstats?.achievements?.achievement;
  if (!rows) return [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows.map((r, index) => {
    const api = typeof r.apiname === 'string' && r.apiname ? r.apiname : null;
    const percent = api && Object.hasOwn(percentages, api) ? percentages[api] : null;
    const unlocked = r['@_closed'] === '1' ? true : r['@_closed'] === '0' ? false : null;
    const stamp = Number(r.unlockTimestamp) || 0;
    return { id: api || `xml-${index}`, apiname: api, name: String(r.name || api || 'Achievement'), description: String(r.description || ''), iconOpen: String(r.iconOpen || ''), iconClosed: String(r.iconClosed || ''), unlocked, unlockTimestamp: unlocked ? stamp : 0, percent, tier: tier(percent), inQueue: false };
  });
}
function parseHtml(html, personalized = false, document) {
  const $ = document||cheerio.load(html); const rows = [];
  $('.achieveRow').each((i, el) => {
    const row = $(el); const name = row.find('h3').text().trim();
    if (!name) return;
    const raw = row.find('.achievePercent').text().match(/([\d.]+)\s*%/);
    const percent = raw ? Number(raw[1]) : null;
    const date = row.find('.achieveUnlockTime').text().trim();
    // Titles are never converted into invented Steam API identifiers.
    rows.push({ id: `html-${i}`, apiname: null, name, description: row.find('h5').text().trim(), iconOpen: row.find('img').attr('src') || '', iconClosed: row.find('img').attr('src') || '', unlocked: personalized ? Boolean(date || row.hasClass('unlocked') || row.find('.achieveImgHolder.unlocked, .achieveImgHolderUnlocked').length) : null, unlockDate: date || null, percent, tier: tier(percent), inQueue: false });
  });
  return rows;
}
async function achievements(account, state, id, apiKey = '', request = remote) {
  id = appId(id);
  const steamid = state.steamId64 || account.mySteamID;
  const controller=new AbortController(),started=Date.now();
  const options = { timeoutMs: 12000,signal:controller.signal };
  const tasks = {};
  const run = (name, target, extra = {}) => tasks[name] = request(target, { ...options, ...extra });
  run('percent', `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`);
  run('global', `https://steamcommunity.com/stats/${id}/achievements/?l=english`, { cookie: state.webCookies });
  run('store', `https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,achievements,categories&l=english`);
  if (steamid) {
    const base = `https://steamcommunity.com/profiles/${steamid}/stats/${id}/`;
    run('xml', `${base}?xml=1&l=english`, { cookie: state.webCookies });
    run('personal', `${base}?tab=achievements&l=english`, { cookie: state.webCookies });
    if (state.webCookies) run('own', `https://steamcommunity.com/my/stats/${id}/?tab=achievements&l=english`, { cookie: state.webCookies });
  }
  if (apiKey) {
    const query = `key=${encodeURIComponent(apiKey)}&appid=${id}`;
    run('schema', `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?${query}&l=english`);
    if (steamid) run('player', `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${query}&steamid=${steamid}&l=english`);
  }
  // Return the first usable verified personal result, cancelling optional slow sources.
  // Catalog/unsupported results still require every source to finish, never a failed race.
  const names = Object.keys(tasks), settled = names.map(()=>({status:'pending'}));
  function assemble(){
  const results = {};
  settled.forEach((r, index) => { if (r.status === 'fulfilled') results[names[index]] = r.value; });
  const json = name => { try { return JSON.parse(results[name]?.body || ''); } catch { return {}; } };
  const personalDocument = cheerio.load(results.personal?.body || '');
  let personalPath = ''; try { personalPath = new URL(results.personal.finalUrl).pathname; } catch {}
  const personalDiagnostics = {
    route: personalPath.startsWith('/id/') ? 'vanity-profile' : personalPath.startsWith('/profiles/') ? 'numeric-profile' : personalPath.startsWith('/stats/') ? 'global-stats' : personalPath.includes('login') ? 'login' : 'other',
    rows: personalDocument('.achieveRow').length,
    statsRoute: personalPath.split('/stats/')[1] || '',
    privateProfile: Boolean(personalDocument('.profile_private_info, .profile_private').length || /profile is private/i.test(personalDocument.text())),
    authenticatedHeader: Boolean(personalDocument('#account_pulldown').length),
    noStatsReported: /has not played|hasn.t played|no user stats|no stats|does not have stats/i.test(personalDocument.text()),
    errorPage: personalDocument('.error_ctn, .error_msg').text().trim().slice(0,180),
    failedSources: names.filter((name,i)=>settled[i].status==='rejected').map((name)=>({source:name,httpStatus:Number(settled[names.indexOf(name)].reason?.message?.match(/HTTP (\d+)/)?.[1]) || null}))
  };

  const percentages = {};
  for (const a of json('percent').achievementpercentages?.achievements || []) {
    const p = Number(a.percent); if (Number.isFinite(p)) percentages[a.name] = p;
  }
  const normalized = name => String(name).trim().replace(/\s+/g, ' ').toLowerCase();
  const globalRows = results.global ? parseHtml(results.global.body, false) : [];
  const globalByTitle = new Map(globalRows.map(a => [normalized(a.name), a]));
  const enrich = list => list.map(a => {
    const global = globalByTitle.get(normalized(a.name));
    const percent = a.percent ?? global?.percent ?? null;
    return { ...a, description: a.description || global?.description || '', percent, tier: tier(percent) };
  });
  const pack = (list, source, message = '', outcome = 'available') => ({ achievements: enrich(list), source, message, outcome, verified: list.length > 0 && list.every(a => typeof a.unlocked === 'boolean'), checkedAt: new Date().toISOString(), diagnostics: { elapsedMs:Date.now()-started,steamConnected: Boolean(state.connected), webSessionReady: Boolean(state.webCookies), personal: personalDiagnostics, sources: Object.fromEntries(names.map((name,i)=>[name,settled[i].status==='fulfilled'?'received':settled[i].status==='pending'?'not_awaited':'unavailable'])) } });
  const schema = json('schema').game?.availableGameStats?.achievements;
  const player = json('player').playerstats;
  const playerByName = new Map((player?.achievements || []).map(a => [a.apiname, a]));
  const schemaRows = Array.isArray(schema) ? schema.map(a => {
    const p = player?.success ? playerByName.get(a.name) : null;
    const percent = Object.hasOwn(percentages, a.name) ? percentages[a.name] : null;
    return { id: a.name, apiname: a.name, name: a.displayName || a.name, description: a.description || '', iconOpen: a.icon || '', iconClosed: a.icongray || '', unlocked: p ? p.achieved === 1 : null, unlockTimestamp: p?.unlocktime || 0, percent, tier: tier(percent), inQueue: false };
  }) : [];
  if (schemaRows.length && player?.success && schemaRows.every(a => a.unlocked !== null)) return pack(schemaRows, 'Steam Web API');
  if (results.xml) {
    let identity=false;try{const url=new URL(results.xml.finalUrl);identity=url.hostname==='steamcommunity.com'&&(url.pathname.startsWith(`/profiles/${steamid}/stats/`)||/^\/id\/[^/]+\/stats\//.test(url.pathname));}catch{}
    const embedded=results.xml.body.match(/<steamID64>\s*(\d+)\s*<\/steamID64>/)?.[1];
    const rows = identity&&(!embedded||embedded===steamid)?parseXml(results.xml.body, percentages):[];
    if (rows.length) return pack(rows, 'Steam Community XML', rows.some(a => a.unlocked === null) ? 'Steam did not return the state of every achievement.' : '');
  }
  for (const source of ['personal', 'own']) {
    if (!results[source]) continue;
    const r = results[source], $ = source==='personal'?personalDocument:cheerio.load(r.body);
    const url = new URL(r.finalUrl);
    // The request starts at the authenticated account SteamID. Steam may canonicalize it to /id/<vanity>/stats/<game>.
    const identity = url.hostname === 'steamcommunity.com' && (url.pathname.startsWith(`/profiles/${steamid}/stats/`) || /^\/id\/[^/]+\/stats\//.test(url.pathname) || (source === 'own' && url.pathname.startsWith('/my/stats/')));
    const privateProfile = $('.profile_private_info, .profile_private').length || /This profile is private|profile is private/i.test($.text());
    const rows = parseHtml(r.body, Boolean(identity && !privateProfile),$);
    if (rows.length && identity && !privateProfile) return pack(rows, 'Steam Community HTML');
  }
  // Schema and global rows are catalogs only when the personal state cannot be verified.
  const catalog = schemaRows.length ? schemaRows : globalRows;
  if (catalog.length) return pack(catalog, schemaRows.length ? 'Steam API catalog' : 'Global catalog', steamid ? 'Catalog available; your personal achievement state could not be verified. Check Game details privacy or refresh the Steam web session.' : 'Catalog available. Sign in to Steam to verify your personal achievement state.', 'catalog');
  const store = json('store')[id];
  const supported = store?.success && Array.isArray(store.data?.categories) && store.data.categories.some(c => Number(c.id) === 22);
  const declared = store?.data?.achievements?.total;
  if (store?.success && Array.isArray(store.data?.categories) && !supported && !(declared > 0)) return pack([], 'Steam Store', 'This AppID does not declare Steam achievements on its store page.', 'unsupported');
  throw Object.assign(new Error('Steam did not return a readable achievement list. This does not mean the game has no achievements. Try Refresh; a STEAM_API_KEY can improve retrieval.'), { status: 502 });
  }
  return new Promise((resolve,reject)=>{
    let remaining=names.length,finished=false;
    function complete(i,record){
      settled[i]=record;remaining--;
      if(finished)return;
      const personal=['xml','personal','own','schema','player'].includes(names[i]);
      if(remaining&&!personal)return;
      try{const result=assemble();if(result.verified||remaining===0){finished=true;controller.abort();resolve(result);}}
      catch(err){if(remaining===0){finished=true;controller.abort();reject(err);}}
    }
    names.forEach((name,i)=>Promise.resolve(tasks[name]).then(value=>complete(i,{status:'fulfilled',value}),reason=>complete(i,{status:'rejected',reason})));
  });
}

function parseCards(html) {
  const $ = cheerio.load(html); const map = new Map();
  $('.badge_row').each((_, el) => {
    const row = $(el); const link = row.find('a.badge_row_overlay, a[href*="/gamecards/"]').first().attr('href') || '';
    const match = link.match(/\/gamecards\/(\d+)/); const text = row.find('.progress_info_bold').text();
    const count = text.match(/(\d+)\s+card drops? remaining/i);
    if (match && count && Number(count[1]) > 0) {
      const title=row.find('.badge_title').first().clone();title.find('.badge_view_details').remove();
      const name=title.text().replace(/\s+/g,' ').trim().slice(0,256);
      map.set(Number(match[1]), { appid: Number(match[1]), remaining: Number(count[1]),...(name?{name}:{}) });
    }
  });
  return [...map.values()];
}
module.exports = { remote, achievements, parseXml, parseHtml, parseCards };
