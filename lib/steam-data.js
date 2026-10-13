'use strict';
const cheerio = require('cheerio');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { appId } = require('./core');
const HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com', 'api.steampowered.com', 'discord.com', 'discordapp.com']);
async function remote(target, { cookie = '', method = 'GET', body, maxBytes = 8 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  let u = new URL(target);
  const origin = u.origin;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || (u.port && u.port !== '443') || u.username || u.password) throw new Error('Destino remoto no permitido.');
    const headers = { 'User-Agent': 'SteamFarmer/2.0', 'Accept-Language': 'en-US,en;q=0.9' };
    if (cookie && u.origin === origin && u.hostname === 'steamcommunity.com') headers.Cookie = cookie;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(u, { signal, redirect: 'manual', method, headers, body });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      if (method !== 'GET') throw new Error('Redirección inesperada.');
      u = new URL(response.headers.get('location'), u); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Steam/Discord respondió HTTP ${response.status}.`); }
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Respuesta remota demasiado grande.');
      chunks.push(Buffer.from(chunk));
    }
    return { body: Buffer.concat(chunks).toString('utf8'), finalUrl: u.href };
  }
  throw new Error('Demasiadas redirecciones.');
}
function tier(percent) {
  if (percent == null) return 'Sin datos';
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
    return { id: api || `xml-${index}`, apiname: api, name: String(r.name || api || 'Logro'), description: String(r.description || ''), iconOpen: String(r.iconOpen || ''), iconClosed: String(r.iconClosed || ''), unlocked, unlockTimestamp: unlocked ? stamp : 0, percent, tier: tier(percent), inQueue: false };
  });
}
function parseHtml(html, personalized = false) {
  const $ = cheerio.load(html); const rows = [];
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
  const options = { timeoutMs: 12000 };
  const tasks = {};
  const run = (name, target, extra = {}) => tasks[name] = request(target, { ...options, ...extra });
  run('percent', `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`);
  run('global', `https://steamcommunity.com/stats/${id}/achievements/?l=english`);
  run('store', `https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,achievements,categories&l=english`);
  if (steamid) {
    const base = `https://steamcommunity.com/profiles/${steamid}/stats/${id}/`;
    run('xml', `${base}?xml=1&l=english`, { cookie: state.webCookies });
    run('personal', `${base}?tab=achievements&l=english`, { cookie: state.webCookies });
  }
  if (apiKey) {
    const query = `key=${encodeURIComponent(apiKey)}&appid=${id}`;
    run('schema', `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?${query}&l=english`);
    if (steamid) run('player', `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${query}&steamid=${steamid}&l=english`);
  }
  // Every source starts together. Slow or unavailable sources cannot multiply the request timeout.
  const names = Object.keys(tasks), settled = await Promise.allSettled(Object.values(tasks));
  const results = {};
  settled.forEach((r, index) => { if (r.status === 'fulfilled') results[names[index]] = r.value; });
  const json = name => { try { return JSON.parse(results[name]?.body || ''); } catch { return {}; } };
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
  const pack = (list, source, message = '', outcome = 'available') => ({ achievements: enrich(list), source, message, outcome, verified: list.length > 0 && list.every(a => typeof a.unlocked === 'boolean'), checkedAt: new Date().toISOString() });
  const schema = json('schema').game?.availableGameStats?.achievements;
  const player = json('player').playerstats;
  const schemaRows = Array.isArray(schema) ? schema.map(a => {
    const p = player?.success ? (player.achievements || []).find(p => p.apiname === a.name) : null;
    const percent = Object.hasOwn(percentages, a.name) ? percentages[a.name] : null;
    return { id: a.name, apiname: a.name, name: a.displayName || a.name, description: a.description || '', iconOpen: a.icon || '', iconClosed: a.icongray || '', unlocked: p ? p.achieved === 1 : null, unlockTimestamp: p?.unlocktime || 0, percent, tier: tier(percent), inQueue: false };
  }) : [];
  if (schemaRows.length && player?.success && schemaRows.every(a => a.unlocked !== null)) return pack(schemaRows, 'Steam Web API');
  if (results.xml) {
    const rows = parseXml(results.xml.body, percentages);
    if (rows.length) return pack(rows, 'Steam Community XML', rows.some(a => a.unlocked === null) ? 'Steam no devolvió el estado de todos los logros.' : '');
  }
  if (results.personal) {
    const r = results.personal, $ = cheerio.load(r.body);
    const url = new URL(r.finalUrl);
    const identity = url.pathname.startsWith(`/profiles/${steamid}/stats/`);
    const privateProfile = $('.profile_private_info, .profile_private').length || /This profile is private|profile is private/i.test($.text());
    const rows = parseHtml(r.body, Boolean(identity && !privateProfile));
    if (rows.length && identity && !privateProfile) return pack(rows, 'Steam Community HTML');
  }
  // Schema and global rows are catalogs only when the personal state cannot be verified.
  const catalog = schemaRows.length ? schemaRows : globalRows;
  if (catalog.length) return pack(catalog, schemaRows.length ? 'Catálogo Steam API' : 'Catálogo global', steamid ? 'Catálogo disponible; Steam no permitió verificar tu estado personal. Revisá la privacidad de tus detalles de juego o reintentá.' : 'Catálogo disponible. Iniciá sesión en Steam para verificar tu estado personal.', 'catalog');
  const store = json('store')[id];
  const supported = store?.success && Array.isArray(store.data?.categories) && store.data.categories.some(c => Number(c.id) === 22);
  const declared = store?.data?.achievements?.total;
  if (store?.success && Array.isArray(store.data?.categories) && !supported && !(declared > 0)) return pack([], 'Steam Store', 'Este AppID no declara logros de Steam en su ficha de la tienda.', 'unsupported');
  throw Object.assign(new Error('Steam no devolvió una lista legible. No significa que el juego no tenga logros. Reintentá con Actualizar; una STEAM_API_KEY puede mejorar la consulta.'), { status: 502 });
}

function parseCards(html) {
  const $ = cheerio.load(html); const map = new Map();
  $('.badge_row').each((_, el) => {
    const row = $(el); const link = row.find('a.badge_row_overlay, a[href*="/gamecards/"]').first().attr('href') || '';
    const match = link.match(/\/gamecards\/(\d+)/); const text = row.find('.progress_info_bold').text();
    const count = text.match(/(\d+)\s+card drops? remaining/i);
    if (match && count && Number(count[1]) > 0) map.set(Number(match[1]), { appid: Number(match[1]), remaining: Number(count[1]) });
  });
  return [...map.values()];
}
module.exports = { remote, achievements, parseXml, parseHtml, parseCards };
