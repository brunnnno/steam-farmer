'use strict';
const cheerio = require('cheerio');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { appId } = require('./core');
const HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com', 'api.steampowered.com', 'discord.com', 'discordapp.com']);
async function remote(target, { cookie = '', method = 'GET', body, maxBytes = 8 * 1024 * 1024 } = {}) {
  let u = new URL(target);
  const origin = u.origin;
  const signal = AbortSignal.timeout(15000);
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
    const unlocked = r['@_closed'] === '1';
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
    rows.push({ id: `html-${i}`, apiname: null, name, description: row.find('h5').text().trim(), iconOpen: row.find('img').attr('src') || '', iconClosed: row.find('img').attr('src') || '', unlocked: personalized ? Boolean(date || row.hasClass('unlocked') || row.find('.achieveImgHolder.unlocked').length) : null, unlockDate: date || null, percent, tier: tier(percent), inQueue: false });
  });
  return rows;
}
async function achievements(account, state, id, apiKey = '') {
  id = appId(id);
  const percentages = {};
  try {
    const r = JSON.parse((await remote(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`)).body);
    for (const a of r.achievementpercentages?.achievements || []) percentages[a.name] = Number(a.percent);
  } catch { /* Missing rarity remains unknown. */ }
  const steamid = state.steamId64 || account.mySteamID;
  if (!steamid) return { achievements: [], verified: false, message: 'Iniciá sesión en Steam para leer tus logros.', checkedAt: new Date().toISOString() };
  if (apiKey) {
    try {
      const query = `key=${encodeURIComponent(apiKey)}&appid=${id}`;
      const [schemaResult, playerResult] = await Promise.all([
        remote(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?${query}&l=english`),
        remote(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${query}&steamid=${steamid}&l=english`)
      ]);
      const schema = JSON.parse(schemaResult.body).game?.availableGameStats?.achievements;
      const player = JSON.parse(playerResult.body).playerstats;
      if (schema && player?.success) {
        const map = new Map((player.achievements || []).map(a => [a.apiname, a]));
        const list = schema.map(a => {
          const p = map.get(a.name); const percent = Object.hasOwn(percentages, a.name) ? percentages[a.name] : null;
          return { id: a.name, apiname: a.name, name: a.displayName || a.name, description: a.description || '', iconOpen: a.icon, iconClosed: a.icongray, unlocked: p ? p.achieved === 1 : null, unlockTimestamp: p?.unlocktime || 0, percent, tier: tier(percent), inQueue: false };
        });
        return { achievements: list, verified: list.every(a => a.unlocked !== null), source: 'Steam Web API', checkedAt: new Date().toISOString() };
      }
    } catch { /* Try authenticated Community view. */ }
  }
  const base = `https://steamcommunity.com/profiles/${steamid}/stats/${id}/`;
  try {
    const xml = (await remote(`${base}?xml=1&l=english`, { cookie: state.webCookies })).body;
    const list = parseXml(xml, percentages);
    if (list.length) return { achievements: list, verified: true, source: 'Steam Community XML', checkedAt: new Date().toISOString() };
  } catch { /* Try HTML. */ }
  try {
    const r = await remote(`${base}?tab=achievements&l=english`, { cookie: state.webCookies });
    const $ = cheerio.load(r.body);
    const personal = r.finalUrl.includes(`/profiles/${steamid}/`) && !$('.profile_private_info, .profile_private').length && !/This profile is private|profile is private/i.test($.text());
    const list = parseHtml(r.body, personal);
    if (list.length && personal) return { achievements: list, verified: true, source: 'Steam Community HTML', checkedAt: new Date().toISOString(), message: 'Steam Community no expone los identificadores API en esta vista.' };
  } catch { /* Catalog fallback: never claim locked. */ }
  try {
    const global = await remote(`https://steamcommunity.com/stats/${id}/achievements/?l=english`);
    const list = parseHtml(global.body, false);
    return { achievements: list, verified: false, source: 'Catálogo global', checkedAt: new Date().toISOString(), message: 'No se pudo verificar tu estado personal. Puede ser privacidad, falta de estadísticas o un error de Steam.' };
  } catch {
    throw Object.assign(new Error('No se pudieron consultar los logros. Reintentá cuando Steam esté disponible.'), { status: 502 });
  }
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
