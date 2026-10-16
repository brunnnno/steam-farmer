'use strict';
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { appId } = require('./core');
const {validPercent,normalizeRows,percentageMap,normalizeTitle,uniformHundred}=require('../public/achievement-rarity');
const HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com', 'api.steampowered.com', 'discord.com', 'discordapp.com']);
async function remote(target, { cookie = '', referer = '', method = 'GET', body, maxBytes = 2 * 1024 * 1024, timeoutMs = 15000, signal: callerSignal } = {}, fetcher = fetch) {
  let u = new URL(target);
  const origin = u.origin;
  const signal = callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || (u.port && u.port !== '443') || u.username || u.password) throw new Error('Remote destination not allowed.');
    const headers = { 'User-Agent': 'SteamFarmer/2.0', 'Accept-Language': 'en-US,en;q=0.9' };
    if (referer && u.origin === origin) headers.Referer = referer;
    if (cookie && u.origin === origin && (u.hostname === 'steamcommunity.com' || u.hostname === 'store.steampowered.com')) headers.Cookie = cookie;
    if (body) headers['Content-Type'] = typeof body === 'string' && body.includes('sessionid=') && !body.trim().startsWith('{') ? 'application/x-www-form-urlencoded; charset=UTF-8' : 'application/json';
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
    if(!response.body)return {body:'',finalUrl:u.href};
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
  return percent < 5 ? 'Mythic' : percent < 20 ? 'Epic' : percent <= 50 ? 'Rare' : 'Common';
}
function parseXml(xml, percentages = {}) {
  if (XMLValidator.validate(xml) !== true) return [];
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, processEntities: false }).parse(xml);
  let rows = parsed.playerstats?.achievements?.achievement;
  if (!rows) return [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows.map((r, index) => {
    const api = typeof r.apiname === 'string' && r.apiname ? r.apiname : null;
    const percent = api && Object.hasOwn(percentages, api) ? validPercent(percentages[api]) : null;
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
    const percent = raw ? validPercent(raw[1]) : null;
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
  const options = { timeoutMs: 6000,signal:controller.signal };
  const tasks = {};
  const run = (name, target, extra = {}) => tasks[name] = request(target, { ...options, ...extra });
  run('percent', `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${id}`);
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

  const apiPercentages=percentageMap(json('percent').achievementpercentages?.achievements),percentages=apiPercentages.percentages;
  const rawGlobalRows=results.global?parseHtml(results.global.body,false):[],globalRows=normalizeRows(rawGlobalRows),globalByTitle=new Map(),duplicateTitles=new Set();
  for(const row of globalRows){const key=normalizeTitle(row.name);if(duplicateTitles.has(key))continue;if(globalByTitle.has(key)){globalByTitle.delete(key);duplicateTitles.add(key);}else globalByTitle.set(key,row);}
  const enrich=list=>normalizeRows(list).map(a=>{const global=globalByTitle.get(normalizeTitle(a.name)),percent=a.percent??global?.percent??null;return {...a,description:a.description||global?.description||'',percent,tier:tier(percent)};});
  const pack=(list,source,message='',outcome='available')=>{const enriched=enrich(list),suspect=enriched.length>1&&enriched.every(a=>a.percent===null)&&(apiPercentages.suspect||uniformHundred(rawGlobalRows.map(r=>r.percent))||uniformHundred(list.map(r=>r.percent)));return {achievements:enriched,source,message,outcome,rarityStatus:suspect?'suspect_uniform_100':enriched.some(a=>a.percent!==null)?'available':'unavailable',rarityMessage:suspect?'Steam returned 100% for every achievement. Rarity cannot be verified from this response.':'',verified:list.length>0&&list.every(a=>typeof a.unlocked==='boolean'),checkedAt:new Date().toISOString(),diagnostics:{elapsedMs:Date.now()-started,steamConnected:Boolean(state.connected),webSessionReady:Boolean(state.webCookies),personal:personalDiagnostics,sources:Object.fromEntries(names.map((name,i)=>[name,settled[i].status==='fulfilled'?'received':settled[i].status==='pending'?'not_awaited':'unavailable']))}};};
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
      const ptNodeText=row.find('.badge_title_stats_playtime').text().trim();
      const rawRowText=row.text();
      const ptText=ptNodeText||(name&&rawRowText.startsWith(name)?rawRowText.slice(name.length):rawRowText);
      const hrMatch=ptText.match(/([\d.]+)\s*hrs?\s+on\s+record/i);
      const minMatch=!hrMatch?ptText.match(/([\d.]+)\s*(?:mins?|minutes?)\s+on\s+record/i):null;
      const hoursPlayed=hrMatch&&Number.isFinite(Number(hrMatch[1]))
        ?Number(hrMatch[1])
        :minMatch&&Number.isFinite(Number(minMatch[1]))
          ?Math.round((Number(minMatch[1])/60)*10)/10
          :undefined;
      map.set(Number(match[1]), { appid: Number(match[1]), remaining: Number(count[1]),...(name?{name}:{}),...(hoursPlayed!==undefined?{hoursPlayed}:{}) });
    }
  });
  return [...map.values()];
}
function extractSessionId(cookie = '') {
  const m = String(cookie || '').match(/(?:^|;\s*)sessionid=([^;\s]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function exploreDiscoveryQueue(cookie, { queues = 3, request = remote } = {}) {
  const sessionid = extractSessionId(cookie);
  if (!sessionid) throw Object.assign(new Error('An active Steam web session (sessionid cookie) is required to explore the Discovery Queue.'), { status: 409 });
  const totalQueues = Math.max(1, Math.min(5, Number(queues) || 3));
  const clearedApps = [];
  let completedQueues = 0;
  for (let q = 0; q < totalQueues; q++) {
    const genBody = `sessionid=${encodeURIComponent(sessionid)}&queuetype=0`;
    const genRes = await request('https://store.steampowered.com/explore/generatenewdiscoveryqueue', {
      cookie,
      method: 'POST',
      body: genBody,
      maxBytes: 256 * 1024,
      timeoutMs: 12000
    });
    let parsed;
    try { parsed = JSON.parse(genRes.body || '{}'); } catch { parsed = {}; }
    const queueList = Array.isArray(parsed.queue) ? parsed.queue.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
    if (!queueList.length) break;
    for (const id of queueList.slice(0, 16)) {
      const clearBody = `sessionid=${encodeURIComponent(sessionid)}&appid_to_clear_from_queue=${id}`;
      await request(`https://store.steampowered.com/app/${id}`, {
        cookie,
        method: 'POST',
        body: clearBody,
        maxBytes: 256 * 1024,
        timeoutMs: 10000
      });
      clearedApps.push(id);
    }
    completedQueues++;
  }
  return {
    completedQueues,
    totalQueues,
    clearedApps,
    totalCleared: clearedApps.length,
    checkedAt: new Date().toISOString()
  };
}

function computeFeeBreakdownCents(buyerCents) {
  const gross = Math.max(3, Math.trunc(Number(buyerCents) || 3));
  const valveFeeCents = Math.max(1, Math.floor(gross * 0.05));
  const developerFeeCents = Math.max(1, Math.floor(gross * 0.10));
  const sellerNetCents = Math.max(1, gross - valveFeeCents - developerFeeCents);
  return { buyerCents: gross, valveFeeCents, developerFeeCents, sellerNetCents };
}

function computeSellerPriceCents(buyerCents) {
  return computeFeeBreakdownCents(buyerCents).sellerNetCents;
}

function estimateCardBatchNet(cards = [], { customBuyerCents = null, defaultBuyerCents = 8 } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  let grossBuyerCents = 0, valveFeeCents = 0, developerFeeCents = 0, estimatedNetCents = 0;
  const byApp = new Map();
  for (const c of list) {
    const unitBuyer = customBuyerCents ? Math.max(3, Math.trunc(Number(customBuyerCents))) : Math.max(3, Math.trunc(Number(c?.buyerCents || defaultBuyerCents)));
    const qty = Math.max(1, Number(c?.amount) || 1);
    const bd = computeFeeBreakdownCents(unitBuyer);
    grossBuyerCents += bd.buyerCents * qty;
    valveFeeCents += bd.valveFeeCents * qty;
    developerFeeCents += bd.developerFeeCents * qty;
    estimatedNetCents += bd.sellerNetCents * qty;
    const appid = Number(c?.appid) || 753;
    if (!byApp.has(appid)) byApp.set(appid, { appid, count: 0, distinctNames: new Set(), sampleName: c?.type || "Trading Card" });
    const entry = byApp.get(appid);
    entry.count += qty;
    if (c?.marketHashName || c?.name) entry.distinctNames.add(c.marketHashName || c.name);
  }
  const craftableSets = [];
  for (const [appid, info] of byApp.entries()) {
    if (appid !== 753 && (info.distinctNames.size >= 5 || info.count >= 5)) {
      craftableSets.push({ appid, cardCount: info.count, distinctCards: info.distinctNames.size, title: info.sampleName.replace(/\s*Trading Card$/i, "") || ("AppID " + appid) });
    }
  }
  return {
    totalCards: list.length,
    grossBuyerCents,
    valveFeeCents,
    developerFeeCents,
    estimatedNetCents,
    formattedGrossUsd: "$" + (grossBuyerCents / 100).toFixed(2),
    formattedNetUsd: "$" + (estimatedNetCents / 100).toFixed(2),
    craftableSets
  };
}

function parsePriceToCents(priceStr) {
  if (typeof priceStr === 'number' && Number.isFinite(priceStr)) return Math.max(1, Math.round(priceStr));
  const cleaned = String(priceStr || '').replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') && !cleaned.includes('.') ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  const val = Number(normalized);
  return Number.isFinite(val) && val > 0 ? Math.max(1, Math.round(val * 100)) : null;
}

async function fetchSellableCards(steamid, cookie, { request = remote } = {}) {
  if (!/^765\d{14}$/.test(String(steamid || ''))) throw Object.assign(new Error('Valid SteamID64 is required to read inventory.'), { status: 400 });
  if (!cookie) throw Object.assign(new Error('An active Steam web session is required to read your card inventory.'), { status: 409 });
  const res = await request(`https://steamcommunity.com/inventory/${steamid}/753/6?l=english&count=500`, {
    cookie,
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 12000
  });
  let data;
  try { data = JSON.parse(res.body || '{}'); } catch { data = {}; }
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const descriptions = Array.isArray(data.descriptions) ? data.descriptions : [];
  const descMap = new Map();
  for (const d of descriptions) {
    if (d && d.classid) descMap.set(`${d.classid}:${d.instanceid || '0'}`, d);
  }
  const cards = [];
  for (const a of assets) {
    if (!a || !a.assetid) continue;
    const d = descMap.get(`${a.classid}:${a.instanceid || '0'}`) || descMap.get(`${a.classid}:0`);
    if (!d || Number(d.marketable) !== 1) continue;
    const isCard = /trading card/i.test(String(d.type || '')) || (Array.isArray(d.tags) && d.tags.some(t => t.internal_name === 'item_class_2' || /trading card/i.test(String(t.localized_tag_name || ''))));
    if (!isCard) continue;
    cards.push({
      assetid: String(a.assetid),
      classid: String(a.classid),
      instanceid: String(a.instanceid || '0'),
      amount: Number(a.amount) || 1,
      name: String(d.name || d.market_name || 'Steam Trading Card'),
      marketHashName: String(d.market_hash_name || d.market_name || d.name || ''),
      type: String(d.type || 'Trading Card'),
      appid: Number(d.market_fee_app) || 753,
      iconUrl: d.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url}` : ''
    });
  }
  const estimate = estimateCardBatchNet(cards);
  return { steamid, totalCards: cards.length, cards, estimate, craftableSets: estimate.craftableSets, checkedAt: new Date().toISOString() };
}

async function fetchCardPriceOverview(marketHashName, { currency = 1, cookie = '', request = remote } = {}) {
  if (!marketHashName) throw Object.assign(new Error('market_hash_name is required.'), { status: 400 });
  const res = await request(`https://steamcommunity.com/market/priceoverview/?appid=753&currency=${Number(currency) || 1}&market_hash_name=${encodeURIComponent(marketHashName)}`, {
    cookie,
    maxBytes: 128 * 1024,
    timeoutMs: 8000
  });
  let parsed;
  try { parsed = JSON.parse(res.body || '{}'); } catch { parsed = {}; }
  const buyerCents = parsePriceToCents(parsed.lowest_price || parsed.median_price) || 5;
  const sellerCents = computeSellerPriceCents(buyerCents);
  return {
    lowestPrice: parsed.lowest_price || null,
    medianPrice: parsed.median_price || null,
    volume: parsed.volume || null,
    buyerCents,
    sellerCents
  };
}

async function sellMarketCard(steamid, cookie, { assetid, priceCents, amount = 1, request = remote } = {}) {
  const sessionid = extractSessionId(cookie);
  if (!sessionid) throw Object.assign(new Error('An active Steam web session (sessionid cookie) is required to sell cards.'), { status: 409 });
  if (!assetid) throw Object.assign(new Error('Asset ID is required to sell a card.'), { status: 400 });
  const sellerCents = Math.max(1, Math.trunc(Number(priceCents) || 1));
  const formBody = `sessionid=${encodeURIComponent(sessionid)}&appid=753&contextid=6&assetid=${encodeURIComponent(String(assetid))}&amount=${Math.max(1, Number(amount) || 1)}&price=${sellerCents}`;
  const res = await request('https://steamcommunity.com/market/sellitem/', {
    cookie,
    referer: `https://steamcommunity.com/profiles/${steamid}/inventory`,
    method: 'POST',
    body: formBody,
    maxBytes: 128 * 1024,
    timeoutMs: 12000
  });
  let parsed;
  try { parsed = JSON.parse(res.body || '{}'); } catch { parsed = {}; }
  return {
    assetid: String(assetid),
    priceCents: sellerCents,
    success: Boolean(parsed.success),
    requiresConfirmation: Boolean(parsed.requires_confirmation),
    message: parsed.message || (parsed.success ? 'Listed on Steam Community Market.' : 'Market listing rejected by Steam.')
  };
}

function generateConfirmationKey(identitySecret, time, tag = 'conf') {
  const secretBuf = Buffer.from(String(identitySecret || '').trim(), 'base64');
  const tagBuf = Buffer.from(String(tag || 'conf'), 'utf8');
  const buf = Buffer.alloc(8 + tagBuf.length);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(Math.floor(Number(time) || 0) >>> 0, 4);
  tagBuf.copy(buf, 8);
  return crypto.createHmac('sha1', secretBuf).update(buf).digest('base64');
}

function generateDeviceId(steamid) {
  const hex = crypto.createHash('sha1').update(String(steamid || '')).digest('hex');
  return `android:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function confirmMarketListings(steamid, cookie, identitySecret, { request = remote, now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!identitySecret || typeof identitySecret !== 'string') return { confirmedCount: 0, totalPending: 0, ids: [] };
  const time = now();
  const deviceId = generateDeviceId(steamid);
  const listKey = generateConfirmationKey(identitySecret, time, 'conf');
  const listUrl = `https://steamcommunity.com/mobileconf/getlist?p=${encodeURIComponent(deviceId)}&a=${encodeURIComponent(steamid)}&k=${encodeURIComponent(listKey)}&t=${time}&m=react&tag=conf`;
  const listRes = await request(listUrl, { cookie, maxBytes: 512 * 1024, timeoutMs: 12000 });
  let parsed;
  try { parsed = JSON.parse(listRes.body || '{}'); } catch { parsed = {}; }
  const confs = Array.isArray(parsed.conf) ? parsed.conf.filter(c => c && c.id && c.key) : [];
  let confirmedCount = 0;
  const ids = [];
  for (let i = 0; i < confs.length; i++) {
    const c = confs[i];
    const opTime = now() + i;
    const allowKey = generateConfirmationKey(identitySecret, opTime, 'allow');
    const opUrl = `https://steamcommunity.com/mobileconf/ajaxop?op=allow&p=${encodeURIComponent(deviceId)}&a=${encodeURIComponent(steamid)}&k=${encodeURIComponent(allowKey)}&t=${opTime}&m=react&tag=allow&cid=${encodeURIComponent(String(c.id))}&ck=${encodeURIComponent(String(c.key))}`;
    try {
      const opRes = await request(opUrl, { cookie, maxBytes: 64 * 1024, timeoutMs: 10000 });
      const opJson = JSON.parse(opRes.body || '{}');
      if (opJson.success) {
        confirmedCount++;
        ids.push(String(c.id));
      }
    } catch {}
  }
  return { confirmedCount, totalPending: confs.length, ids };
}

async function quickSellCards(steamid, cookie, { assetids = null, customPriceCents = null, currency = 1, maxCards = 25, identitySecret = '', delayFn = null, request = remote } = {}) {
  const sleep = typeof delayFn === 'function' ? delayFn : ms => new Promise(r => setTimeout(r, ms));
  const inv = await fetchSellableCards(steamid, cookie, { request });
  const filterSet = Array.isArray(assetids) && assetids.length ? new Set(assetids.map(String)) : null;
  const targets = inv.cards.filter(c => !filterSet || filterSet.has(c.assetid)).slice(0, Math.max(1, Math.min(50, Number(maxCards) || 25)));
  const priceCache = new Map();
  const results = [];
  let soldCount = 0, requiresConfirmationCount = 0, failedCount = 0, rateLimitRetries = 0;
  for (let idx = 0; idx < targets.length; idx++) {
    const card = targets[idx];
    if (idx > 0) {
      await sleep(1800 + Math.floor(Math.random() * 1400));
    }
    try {
      let sellerCents = customPriceCents ? Math.max(1, Math.trunc(Number(customPriceCents))) : null;
      if (!sellerCents) {
        if (!priceCache.has(card.marketHashName)) {
          try {
            priceCache.set(card.marketHashName, await fetchCardPriceOverview(card.marketHashName, { currency, cookie, request }));
          } catch (pErr) {
            if (/429/.test(String(pErr.message || ''))) {
              rateLimitRetries++;
              await sleep(15000);
              priceCache.set(card.marketHashName, await fetchCardPriceOverview(card.marketHashName, { currency, cookie, request }));
            } else {
              throw pErr;
            }
          }
        }
        sellerCents = priceCache.get(card.marketHashName).sellerCents;
      }
      let sold;
      try {
        sold = await sellMarketCard(steamid, cookie, { assetid: card.assetid, priceCents: sellerCents, amount: 1, request });
      } catch (sErr) {
        if (/429/.test(String(sErr.message || ''))) {
          rateLimitRetries++;
          await sleep(15000);
          sold = await sellMarketCard(steamid, cookie, { assetid: card.assetid, priceCents: sellerCents, amount: 1, request });
        } else {
          throw sErr;
        }
      }
      if (sold.success) {
        soldCount++;
        if (sold.requiresConfirmation) requiresConfirmationCount++;
      } else {
        failedCount++;
      }
      results.push({ ...sold, name: card.name, marketHashName: card.marketHashName });
    } catch (err) {
      failedCount++;
      results.push({ assetid: card.assetid, name: card.name, success: false, message: err.message });
    }
  }
  let autoConfirmedCount = 0;
  if (requiresConfirmationCount > 0 && identitySecret) {
    try {
      const confResult = await confirmMarketListings(steamid, cookie, identitySecret, { request });
      autoConfirmedCount = confResult.confirmedCount || 0;
    } catch {}
  }
  let estimatedGrossCents = 0, valveFeeCents = 0, developerFeeCents = 0, estimatedNetCents = 0;
  for (const r of results) {
    if (r.success && r.priceCents) {
      const net = Number(r.priceCents) || 0;
      const estBuyer = Math.max(3, Math.round(net / 0.85));
      const bd = computeFeeBreakdownCents(estBuyer);
      estimatedGrossCents += bd.buyerCents;
      valveFeeCents += bd.valveFeeCents;
      developerFeeCents += bd.developerFeeCents;
      estimatedNetCents += net;
    }
  }
  return {
    totalInventoryCards: inv.totalCards,
    processedCount: targets.length,
    soldCount,
    requiresConfirmationCount,
    autoConfirmedCount,
    rateLimitRetries,
    failedCount,
    estimatedGrossCents,
    valveFeeCents,
    developerFeeCents,
    estimatedNetCents,
    formattedNetUsd: "$" + (estimatedNetCents / 100).toFixed(2),
    results,
    checkedAt: new Date().toISOString()
  };
}


function parseCraftableBadges(html) {
  const $ = cheerio.load(html || "");
  const list = [];
  $(".badge_row").each((_, el) => {
    const row = $(el);
    const link = row.find("a.badge_row_overlay, a[href*=\"/gamecards/\"]").first().attr("href") || "";
    const match = link.match(/\/gamecards\/(\d+)/);
    if (!match) return;
    const appid = Number(match[1]);
    const hasCraftBtn = row.find(".badge_craft_button").length > 0 || /ready\s+to\s+craft|5\s+of\s+5\s+cards\s+collected/i.test(row.text());
    if (hasCraftBtn) {
      const title = row.find(".badge_title").first().clone();
      title.find(".badge_view_details").remove();
      const name = title.text().replace(/Ready\s+to\s+craft/gi, "").replace(/\s+/g, " ").trim().slice(0, 256) || ("AppID " + appid);
      list.push({ appid, name, craftable: true });
    }
  });
  return list;
}

async function craftSteamBadge(steamid, cookie, { appid, series = 1, borderColor = 0, request = remote } = {}) {
  if (!/^765\d{14}$/.test(String(steamid || ""))) throw Object.assign(new Error("Valid SteamID64 is required to craft badges."), { status: 400 });
  const sessionid = extractSessionId(cookie);
  if (!sessionid) throw Object.assign(new Error("An active Steam web session (sessionid cookie) is required to craft badges."), { status: 409 });
  const targetApp = appId(appid);
  const body = `appid=${targetApp}&series=${Math.max(1, Number(series) || 1)}&border_color=${Number(borderColor) ? 1 : 0}&sessionid=${encodeURIComponent(sessionid)}`;
  const res = await request(`https://steamcommunity.com/profiles/${steamid}/ajaxcraftbadge/`, {
    cookie,
    referer: `https://steamcommunity.com/profiles/${steamid}/gamecards/${targetApp}/`,
    method: "POST",
    body,
    maxBytes: 256 * 1024,
    timeoutMs: 12000
  });
  let parsed;
  try { parsed = JSON.parse(res.body || "{}"); } catch { parsed = {}; }
  const success = Boolean(parsed.success === 1 || parsed.success === true || parsed.Badge);
  const dropped = Array.isArray(parsed.rgDroppedItems) ? parsed.rgDroppedItems.map(d => ({
    name: String(d.name || d.title || "Steam Community Item"),
    type: String(d.type || d.label || "Reward"),
    iconUrl: d.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url}` : ""
  })) : [];
  return {
    success,
    appid: targetApp,
    xpEarned: Number(parsed?.Badge?.xp) || 100,
    newLevel: parsed?.playerlevel ?? null,
    badgeTitle: parsed?.Badge?.title || `AppID ${targetApp} Badge`,
    unlockedItems: dropped,
    message: success ? `Badge crafted for AppID ${targetApp} (+100 XP, ${dropped.length} reward item${dropped.length === 1 ? "" : "s"} unlocked).` : (parsed.message || "Could not craft badge; verify that you own all 5 trading cards.")
  };
}

const DEMO_CATALOG = [
  { id: 440, name: "Team Fortress 2" },
  { id: 730, name: "Counter-Strike 2" },
  { id: 620, name: "Portal 2" },
  { id: 550, name: "Left 4 Dead 2" }
];

const DEMO_GAME_SCHEMAS = {
  440: {
    name: "Team Fortress 2",
    achievements: [
      { apiname: "TF_GET_TURRETKills", name: "Sentry Gunner", description: "Accumulate 10 sentry gun kills with a single sentry.", unlocked: true, unlockTimestamp: 1705000100, percent: 64.2, tier: "Common", statId: 1, bitIndex: 0 },
      { apiname: "TF_MEDIC_TOP_SCOREBOARD", name: "First Do No Harm", description: "Play a full round without killing any enemies, and score the highest on a team of 6 or more players.", unlocked: false, percent: 3.1, tier: "Mythic", statId: 1, bitIndex: 1 },
      { apiname: "TF_SPY_BACKSTAB_DOMINATING", name: "High Value Target", description: "Backstab an enemy who is dominating 3 or more players on your team.", unlocked: false, percent: 12.4, tier: "Epic", statId: 1, bitIndex: 2 },
      { apiname: "TF_HEAVY_DAMAGE_TAKEN", name: "Photostroika", description: "Take 1000 damage in a single life.", unlocked: true, unlockTimestamp: 1705012000, percent: 38.7, tier: "Rare", statId: 1, bitIndex: 3 }
    ],
    statistics: [
      { statId: 101, name: "TF_STATS_KILLS", displayName: "Total Eliminations", type: "INT", value: 1420, min: 0, max: 1000000, incrementOnly: false, protected: false, writable: true },
      { statId: 102, name: "TF_STATS_HEALING_DONE", displayName: "Total Healing Points", type: "INT", value: 84500, min: 0, max: 10000000, incrementOnly: false, protected: false, writable: true },
      { statId: 103, name: "TF_STATS_ACCURACY_RATIO", displayName: "Weapon Accuracy Ratio", type: "FLOAT", value: 0.425, min: 0, max: 1, incrementOnly: false, protected: false, writable: true }
    ]
  },
  730: {
    name: "Counter-Strike 2",
    achievements: [
      { apiname: "CS2_NEW_BEGINNING", name: "A New Beginning", description: "Complete a match in Counter-Strike 2.", unlocked: true, unlockTimestamp: 1708000000, percent: 81.5, tier: "Common", statId: 1, bitIndex: 0 },
      { apiname: "CS2_ACE_CLUTCH", name: "Clutch Maestro", description: "Win a 1v5 round in Premier mode.", unlocked: false, percent: 2.4, tier: "Mythic", statId: 1, bitIndex: 1 },
      { apiname: "CS2_SHARPSHOOTER", name: "Precision Headhunter", description: "Score 25 headshot eliminations in a single match.", unlocked: false, percent: 14.8, tier: "Epic", statId: 1, bitIndex: 2 },
      { apiname: "CS2_DEFUSER", name: "Bomb Squad", description: "Defuse 50 planted C4 charges.", unlocked: true, unlockTimestamp: 1708200000, percent: 31.2, tier: "Rare", statId: 1, bitIndex: 3 }
    ],
    statistics: [
      { statId: 201, name: "total_kills", displayName: "Total Kills", type: "INT", value: 3280, min: 0, max: 9999999, incrementOnly: false, protected: false, writable: true },
      { statId: 202, name: "total_wins", displayName: "Total Rounds Won", type: "INT", value: 940, min: 0, max: 9999999, incrementOnly: false, protected: false, writable: true },
      { statId: 203, name: "headshot_ratio_float", displayName: "Headshot Precision (FLOAT)", type: "FLOAT", value: 0.542, min: 0, max: 1, incrementOnly: false, protected: false, writable: true }
    ]
  },
  620: {
    name: "Portal 2",
    achievements: [
      { apiname: "WAKE_UP", name: "Wake Up Call", description: "Survive the manual override.", unlocked: true, unlockTimestamp: 1701000000, percent: 89.4, tier: "Common", statId: 1, bitIndex: 0 },
      { apiname: "STILL_ALIVE", name: "Professor Portal", description: "After completing co-op, complete Calibration Course online with a friend who hasn’t played before.", unlocked: false, percent: 3.8, tier: "Mythic", statId: 1, bitIndex: 1 },
      { apiname: "SMASH_TV", name: "Smash TV", description: "Break 11 test chamber monitors.", unlocked: false, percent: 11.2, tier: "Epic", statId: 1, bitIndex: 2 },
      { apiname: "PORTAL_CONSERVATION", name: "Portal Conservation Society", description: "Complete Chamber 3 in the hard-light surfaces co-op course using only 5 total portal placements.", unlocked: true, unlockTimestamp: 1701500000, percent: 29.6, tier: "Rare", statId: 1, bitIndex: 3 }
    ],
    statistics: [
      { statId: 301, name: "num_portals_placed", displayName: "Portals Placed", type: "INT", value: 642, min: 0, max: 1000000, incrementOnly: false, protected: false, writable: true },
      { statId: 302, name: "distance_walked_float", displayName: "Distance Walked (m)", type: "FLOAT", value: 4825.75, min: 0, max: 1000000, incrementOnly: false, protected: false, writable: true }
    ]
  },
  550: {
    name: "Left 4 Dead 2",
    achievements: [
      { apiname: "ACH_HEARTWARMER", name: "Heartwarmer", description: "In a Versus round, leave the saferoom to defibrillate a dead teammate.", unlocked: true, unlockTimestamp: 1702000000, percent: 58.3, tier: "Common", statId: 1, bitIndex: 0 },
      { apiname: "ACH_STILL_SOMETHING_TO_PROVE", name: "Still Something to Prove", description: "Survive all campaigns on Expert.", unlocked: false, percent: 2.9, tier: "Mythic", statId: 1, bitIndex: 1 },
      { apiname: "ACH_GUARDIN_GNOME", name: "Guardin' Gnome", description: "Rescue Gnome Chompski from the Carnival.", unlocked: false, percent: 9.7, tier: "Epic", statId: 1, bitIndex: 2 },
      { apiname: "ACH_CL0WND", name: "CL0WND", description: "Honk the noses of 10 Clowns.", unlocked: true, unlockTimestamp: 1702500000, percent: 34.1, tier: "Rare", statId: 1, bitIndex: 3 }
    ],
    statistics: [
      { statId: 401, name: "Stat.InfectedKilled.Total", displayName: "Total Infected Killed", type: "INT", value: 18450, min: 0, max: 10000000, incrementOnly: false, protected: false, writable: true },
      { statId: 402, name: "Stat.AvgAccuracy.Float", displayName: "Average Firing Accuracy (FLOAT)", type: "FLOAT", value: 0.384, min: 0, max: 1, incrementOnly: false, protected: false, writable: true }
    ]
  }
};

function buildFallbackDemoGame(id) {
  const appNum = Number(id) || 440;
  const preset = DEMO_GAME_SCHEMAS[appNum] || {
    name: `Steam Game #${appNum}`,
    achievements: [
      { apiname: "FIRST_STEPS", name: "First Steps", description: "Start the game and complete the opening sequence.", unlocked: true, unlockTimestamp: 1705000000, percent: 76.4, tier: "Common", statId: 1, bitIndex: 0 },
      { apiname: "GRANDMASTER_CHALLENGE", name: "Grandmaster Perfectionist", description: "Complete every challenge on the highest difficulty without taking damage.", unlocked: false, percent: 1.8, tier: "Mythic", statId: 1, bitIndex: 1 },
      { apiname: "HIDDEN_TREASURE", name: "Secret Collector", description: "Discover all hidden artifacts across the campaign.", unlocked: false, percent: 12.5, tier: "Epic", statId: 1, bitIndex: 2 },
      { apiname: "VETERAN_EXPLORER", name: "Veteran Explorer", description: "Complete 25 side objectives.", unlocked: true, unlockTimestamp: 1705100000, percent: 35.0, tier: "Rare", statId: 1, bitIndex: 3 }
    ],
    statistics: [
      { statId: 1, name: "TOTAL_SCORE_INT", displayName: "Total Score (INT)", type: "INT", value: 2500, min: 0, max: 1000000, incrementOnly: false, protected: false, writable: true },
      { statId: 2, name: "COMPLETION_TIME_FLOAT", displayName: "Best Completion Time (FLOAT)", type: "FLOAT", value: 42.75, min: 0, max: 99999, incrementOnly: false, protected: false, writable: true }
    ]
  };
  const demoNotice = "Modo Demostración: Conecta tu cuenta de Steam para aplicar cambios en vivo (Demo Mode: Connect your Steam account to apply changes live).";
  return {
    appid: appNum,
    demoMode: true,
    readingMethod: "web",
    source: "Steam Public Showcase (GetSchemaForGame / Demo)",
    outcome: "catalog",
    verified: false,
    message: demoNotice,
    checkedAt: new Date().toISOString(),
    achievements: preset.achievements.map(a => ({
      ...a,
      id: a.apiname,
      iconOpen: a.iconOpen || "https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png",
      iconClosed: a.iconClosed || "https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png",
      compatibility: { status: "provisional", canUnlock: true, reason: demoNotice }
    })),
    statistics: preset.statistics
  };
}

async function fetchPublicDemoAchievements(id, apiKey = "", request = remote) {
  const appNum = appId(id);
  const fallback = buildFallbackDemoGame(appNum);
  try {
    const live = await achievements({ mySteamID: "" }, { connected: false, webCookies: "" }, appNum, apiKey, request);
    if (Array.isArray(live.achievements) && live.achievements.length > 0) {
      return {
        ...live,
        appid: appNum,
        demoMode: true,
        readingMethod: "web",
        message: fallback.message,
        statistics: fallback.statistics
      };
    }
  } catch {}
  return fallback;
}


const STEAM_DECK_STATUS_MAP = {
  620: "verified",
  550: "verified",
  220: "verified",
  240: "playable",
  440: "playable",
  730: "playable",
  570: "playable",
  10: "playable",
  252490: "unsupported",
  578080: "unsupported",
  1172470: "unsupported",
  271590: "unsupported",
  1091500: "verified",
  292030: "verified",
  379720: "verified"
};

function getSteamGameMeta(appid) {
  const id = Number(appid) || 440;
  const status = STEAM_DECK_STATUS_MAP[id] || (id % 5 === 0 ? "verified" : id % 3 === 0 ? "playable" : "verified");
  const labels = {
    verified: { en: "🟢 Deck Verified", es: "🟢 Verificado" },
    playable: { en: "🟡 Deck Playable", es: "🟡 Jugable" },
    unsupported: { en: "⚪ Deck Unsupported", es: "⚪ No compatible" }
  };
  return {
    appid: id,
    steamDbUrl: `https://steamdb.info/app/${id}/`,
    deckStatus: status,
    deckLabelEn: labels[status].en,
    deckLabelEs: labels[status].es
  };
}

function calculateBadgeCompletionCost(game = {}, { defaultCardPriceCents = 7 } = {}) {
  const id = Number(game.appid) || 730;
  const setSize = Math.max(5, Number(game.totalSetCards) || 5);
  const rem = Math.max(0, Number(game.remaining) || 0);
  const collected = game.collectedCards !== undefined
    ? Math.max(0, Math.min(setSize, Number(game.collectedCards) || 0))
    : Math.max(1, Math.min(setSize, setSize - Math.min(setSize - 1, rem)));
  const missing = Math.max(0, setSize - collected);
  const unitCents = Math.max(3, Number(game.cardPriceCents) || defaultCardPriceCents);
  const estimatedCostCents = missing * unitCents;
  return {
    appid: id,
    setSize,
    collected,
    missing,
    unitCents,
    estimatedCostCents,
    formattedCostUsd: "$" + (estimatedCostCents / 100).toFixed(2),
    xpReward: 100,
    marketUrl: `https://steamcommunity.com/market/search?appid=753&q=${encodeURIComponent("appid:" + id + " trading card")}`
  };
}

module.exports = {
  remote,
  achievements,
  parseXml,
  parseHtml,
  parseCards,
  extractSessionId,
  exploreDiscoveryQueue,
  computeSellerPriceCents,
  fetchSellableCards,
  fetchCardPriceOverview,
  sellMarketCard,
  quickSellCards,
  generateConfirmationKey,
  generateDeviceId,
  confirmMarketListings,
  computeFeeBreakdownCents,
  estimateCardBatchNet,
  parseCraftableBadges,
  craftSteamBadge,
  DEMO_CATALOG,
  DEMO_GAME_SCHEMAS,
  fetchPublicDemoAchievements,
  getSteamGameMeta,
  calculateBadgeCompletionCost
};
