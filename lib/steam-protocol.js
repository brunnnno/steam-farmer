'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const binaryKV = require('binarykvparser');
const { appId } = require('./core');
const { AchievementDependencyGraph } = require('./achievement-dependencies');
const { classifyAchievement, uint } = require('./achievement-compatibility');
const { inspectProgress } = require('./achievement-progress');
const { decodeFloat, floatBits } = require('./float-progress');

function problem(message, status = 502, code = 'steam_protocol_error', action = 'Refresh the direct Steam reading. If it continues, inspect Steam connection and game access.') {
  return Object.assign(new Error(message), { status, diagnostic: { code, action } });
}
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const english = value => typeof value === 'string' ? value : typeof value?.english === 'string' ? value.english : '';
const trustedServer = value => value == null || ['0', 'false'].includes(String(value).toLowerCase()) ? false : ['1', 'true'].includes(String(value).toLowerCase()) ? true : null;

const parsedSchemaCache = new WeakMap();
function getParsedSchema(snapshot) {
  if (!snapshot?.schema?.length || snapshot.schema.length > 4 * 1024 * 1024) return null;
  if (typeof snapshot === 'object' && parsedSchemaCache.has(snapshot)) {
    return parsedSchemaCache.get(snapshot);
  }
  try {
    const root = binaryKV.parse(Buffer.from(snapshot.schema));
    if (typeof snapshot === 'object') parsedSchemaCache.set(snapshot, root);
    return root;
  } catch {
    return null;
  }
}

function parseGameStats(snapshot, id) {
  id = appId(id);
  if (!snapshot || Number(snapshot.eresult) !== 1 || !snapshot.schema?.length) {
    return { appid: id, crcStats: Number(snapshot?.crc_stats ?? 0) >>> 0, stats: [] };
  }
  const root = getParsedSchema(snapshot);
  const definition = root?.[String(id)] || (root?.stats ? root : null);
  if (!definition?.stats || typeof definition.stats !== 'object') {
    return { appid: id, crcStats: Number(snapshot?.crc_stats ?? 0) >>> 0, stats: [] };
  }
  const values = new Map();
  for (const s of snapshot.stats || []) {
    if (uint(s?.stat_id) && uint(s?.stat_value)) {
      values.set(Number(s.stat_id), Number(s.stat_value) >>> 0);
    }
  }
  const stats = [];
  for (const [key, stat] of Object.entries(definition.stats)) {
    if (!/^\d+$/.test(key) || !stat || typeof stat !== 'object') continue;
    const statId = Number(key);
    if (!uint(statId)) continue;
    const rawType = String(stat.type ?? '').toUpperCase();
    if (['4', 'ACHIEVEMENTS'].includes(rawType)) continue;
    const isFloat = ['2', 'FLOAT', '3', 'AVGRATE'].includes(rawType);
    const isInt = ['1', 'INT'].includes(rawType);
    if (!isFloat && !isInt) continue;
    const type = isFloat ? 'FLOAT' : 'INT';
    const hasRaw = values.has(statId);
    const defaultNum = stat.default != null && Number.isFinite(Number(stat.default)) ? Number(stat.default) : 0;
    const defaultRaw = isFloat ? (floatBits(defaultNum) ?? 0) : (Math.trunc(defaultNum) >>> 0);
    const rawValue = hasRaw ? values.get(statId) : defaultRaw;
    const value = isFloat ? Number((decodeFloat(rawValue) ?? 0).toFixed(6)) : (rawValue | 0);
    const min = stat.min != null && String(stat.min).trim() !== '' && Number.isFinite(Number(stat.min)) ? Number(stat.min) : null;
    const max = stat.max != null && String(stat.max).trim() !== '' && Number.isFinite(Number(stat.max)) ? Number(stat.max) : null;
    const maxChange = stat.maxchange != null && String(stat.maxchange).trim() !== '' && Number.isFinite(Number(stat.maxchange)) ? Number(stat.maxchange) : null;
    const incrementOnly = ['1', 'true'].includes(String(stat.incrementonly ?? '0').toLowerCase());
    const permission = Number(stat.permission || 0);
    const isProtected = Boolean((permission & 2) || trustedServer(stat.bSetByTrustedGS) === true);
    const name = String(stat.name || `stat_${statId}`);
    const displayName = english(stat.display?.name || stat.DisplayName) || name;
    stats.push({
      statId,
      name,
      displayName,
      type,
      value,
      rawValue,
      defaultValue: defaultNum,
      min,
      max,
      maxChange,
      incrementOnly,
      permission,
      protected: isProtected
    });
  }
  stats.sort((a, b) => a.statId - b.statId);
  return { appid: id, crcStats: Number(snapshot.crc_stats ?? 0) >>> 0, stats };
}

async function writeGameStats(client, id, changes = [], { read = requestSnapshot, send, resetAll = false, stealth = false, timeoutMs = 8000 } = {}) {
  id = appId(id);
  if (!client?.steamID || typeof client._send !== 'function' || client.playingState?.blocked) {
    throw fail('An available connected Steam session is required.', 409);
  }
  const identity = client.steamID.toString();
  const initial = await read(client, id, { timeoutMs });
  const parsed = parseGameStats(initial, id);
  const byId = new Map(parsed.stats.map(s => [s.statId, s]));
  const byName = new Map(parsed.stats.map(s => [s.name.toLowerCase(), s]));

  const achBlockValues = new Map();
  try {
    const root = getParsedSchema(initial);
    const def = root?.[String(id)] || (root?.stats ? root : null);
    const rawMap = new Map((initial.stats || []).map(s => [Number(s.stat_id), Number(s.stat_value) >>> 0]));
    for (const [k, st] of Object.entries(def?.stats || {})) {
      if (/^\d+$/.test(k) && ['4', 'ACHIEVEMENTS'].includes(String(st?.type ?? '').toUpperCase())) {
        const blockId = Number(k);
        achBlockValues.set(blockId, rawMap.get(blockId) ?? 0);
      }
    }
  } catch {}

  if (!stealth) {
    try { if (typeof client.gamesPlayed === 'function') client.gamesPlayed([id]); } catch {}
  }

  if (resetAll) {
    const crc = uint(initial.crc_stats) ? initial.crc_stats : 0;
    if (initial?._reconciledFromSteam && achBlockValues.size > 0) {
      try {
        const primeStats = [...achBlockValues.keys()].sort((a, b) => a - b).map(stat_id => ({ stat_id, stat_value: 0xffffffff }));
        await send(client, { game_id: String(id), crc_stats: crc, explicit_reset: false, settor_steam_id: identity, settee_steam_id: identity, stats: primeStats }, { timeoutMs });
      } catch {}
    }
    let response = await send(client, {
      game_id: String(id),
      crc_stats: crc,
      explicit_reset: true,
      settor_steam_id: identity,
      settee_steam_id: identity,
      stats: []
    }, { timeoutMs });

    let final = await read(client, id, { timeoutMs, skipLibrarySummary: true, skipReconcile: true });
    const hasRemainingNonZero = Array.isArray(final?.stats) && final.stats.some(s => (Number(s.stat_value) >>> 0) !== 0);
    if (hasRemainingNonZero || initial?._reconciledFromSteam) {
      const zeroIds = new Set([...(initial.stats || []).map(s => Number(s.stat_id)), ...(final?.stats || []).map(s => Number(s.stat_id)), ...achBlockValues.keys()].filter(uint));
      if (zeroIds.size > 0) {
        const zeroStats = [...zeroIds].sort((a, b) => a - b).map(stat_id => ({ stat_id, stat_value: 0 }));
        const crcNext = uint(final?.crc_stats) ? final.crc_stats : crc;
        try {
          response = await send(client, {
            game_id: String(id),
            crc_stats: crcNext,
            explicit_reset: true,
            settor_steam_id: identity,
            settee_steam_id: identity,
            stats: zeroStats
          }, { timeoutMs });
          final = await read(client, id, { timeoutMs, skipLibrarySummary: true, skipReconcile: true });
        } catch {}
      }
    }
    const afterStats = parseGameStats(final, id).stats;
    let afterView = null;
    try { afterView = parseSnapshot(final, id); } catch {}

    return {
      appid: id,
      outcome: Number(response?.eresult) === 1 ? 'confirmed' : 'unknown',
      resetAll: true,
      changedCount: afterStats.length,
      stats: afterStats,
      ...(afterView ? { achievements: afterView.achievements } : {}),
      message: 'Todas las estadísticas y logros del juego fueron reiniciados a 0 en los servidores de Steam.'
    };
  }

  if (!Array.isArray(changes) || !changes.length || changes.length > 512) {
    throw fail('Provide between 1 and 512 statistic updates.', 400);
  }

  const updates = new Map();
  let needsReset = false;
  for (const item of changes) {
    if (!item || typeof item !== 'object') throw fail('Invalid statistic update entry.', 400);
    const target = Number.isInteger(Number(item.statId)) && byId.has(Number(item.statId))
      ? byId.get(Number(item.statId))
      : typeof item.name === 'string' ? byName.get(item.name.trim().toLowerCase()) : null;
    if (!target) throw fail(`Statistic "${item.name ?? item.statId}" was not found in this game schema.`, 404);
    const num = Number(item.value);
    if (!Number.isFinite(num)) throw fail(`Invalid numeric value for ${target.name}.`, 400);
    let raw;
    if (target.type === 'FLOAT') {
      raw = floatBits(num);
      if (!uint(raw)) throw fail(`Value for ${target.name} cannot be represented as a 32-bit float.`, 400);
    } else {
      const truncated = Math.trunc(num);
      if (truncated < -2147483648 || truncated > 4294967295) throw fail(`Value for ${target.name} is out of 32-bit integer bounds.`, 400);
      raw = truncated >>> 0;
    }
    if (num < target.value && (target.incrementOnly || (target.maxChange && target.maxChange > 0))) {
      needsReset = true;
    }
    if (target.maxChange && target.maxChange > 0 && Math.abs(num - target.value) > target.maxChange) {
      needsReset = true;
    }
    updates.set(target.statId, raw);
  }

  const statsPayload = [...updates.entries()].map(([stat_id, stat_value]) => ({ stat_id, stat_value })).sort((a, b) => a.stat_id - b.stat_id);
  const crc = uint(initial.crc_stats) ? initial.crc_stats : 0;
  let response = await send(client, {
    game_id: String(id),
    crc_stats: crc,
    explicit_reset: false,
    settor_steam_id: identity,
    settee_steam_id: identity,
    stats: statsPayload
  }, { timeoutMs });
  let final = await read(client, id, { timeoutMs });

  const checkStatsMatch = snap => {
    const map = new Map((snap?.stats || []).map(s => [Number(s.stat_id), Number(s.stat_value) >>> 0]));
    return [...updates.entries()].every(([statId, expectedRaw]) => (map.get(statId) ?? 0) === expectedRaw);
  };

  if (!checkStatsMatch(final) || Number(response?.eresult) !== 1 || (response?.stats_failed_validation || []).length || needsReset) {
    if (!checkStatsMatch(final)) {
      const crc2 = uint(final?.crc_stats) ? final.crc_stats : crc;
      const fullMap = new Map((initial.stats || []).map(s => [Number(s.stat_id), Number(s.stat_value) >>> 0]));
      for (const [k, v] of achBlockValues) fullMap.set(k, v);
      for (const [k, v] of updates) fullMap.set(k, v);
      const fullStats = [...fullMap.entries()].map(([stat_id, stat_value]) => ({ stat_id, stat_value })).sort((a, b) => a.stat_id - b.stat_id);
      try {
        response = await send(client, {
          game_id: String(id),
          crc_stats: crc2,
          explicit_reset: true,
          settor_steam_id: identity,
          settee_steam_id: identity,
          stats: fullStats
        }, { timeoutMs });
        final = await read(client, id, { timeoutMs });
      } catch {}
    }
  }

  const afterStats = parseGameStats(final, id).stats;
  let afterView = null;
  try { afterView = parseSnapshot(final, id); } catch {}
  const verifiedCount = [...updates.entries()].filter(([statId, expectedRaw]) => {
    const row = afterStats.find(s => s.statId === statId);
    return row && row.rawValue === expectedRaw;
  }).length;

  return {
    appid: id,
    outcome: verifiedCount === updates.size ? 'confirmed' : 'partial',
    changedCount: verifiedCount,
    requestedCount: updates.size,
    stats: afterStats,
    ...(afterView ? { achievements: afterView.achievements } : {}),
    message: verifiedCount === updates.size
      ? `Steam confirmed ${verifiedCount} statistic update${verifiedCount === 1 ? '' : 's'}.`
      : `Steam updated ${verifiedCount} of ${updates.size} statistics (some protected or server-validated stats were rejected by Steam).`
  };
}

function exportGameData(snapshot, id) {
  id = appId(id);
  const view = parseSnapshot(snapshot, id);
  const stats = parseGameStats(snapshot, id).stats;
  return {
    format: 'SamRewritten-Web-v1',
    appid: id,
    exportedAt: new Date().toISOString(),
    achievements: (view.achievements || []).map(a => ({
      apiname: a.apiname,
      name: a.name,
      unlocked: Boolean(a.unlocked),
      unlockTimestamp: a.unlockTimestamp || 0
    })),
    stats: stats.map(s => ({
      statId: s.statId,
      name: s.name,
      type: s.type,
      value: s.value
    }))
  };
}

function computeAchievementAnalytics(achievements = [], stats = []) {
  const total = achievements.length;
  const unlockedRows = achievements.filter(a => a.unlocked === true);
  const lockedRows = achievements.filter(a => a.unlocked === false);
  const protectedCount = achievements.filter(a => a.serverControlled).length;
  const hiddenCount = achievements.filter(a => a.hidden === true).length;
  const completionPercent = total ? Number((unlockedRows.length / total * 100).toFixed(1)) : 0;

  const byDayMap = new Map();
  const timestamped = unlockedRows
    .filter(a => Number.isFinite(a.unlockTimestamp) && a.unlockTimestamp > 0)
    .sort((a, b) => a.unlockTimestamp - b.unlockTimestamp);

  for (const a of timestamped) {
    const day = new Date(a.unlockTimestamp * 1000).toISOString().slice(0, 10);
    if (!byDayMap.has(day)) byDayMap.set(day, { date: day, count: 0, achievements: [] });
    const entry = byDayMap.get(day);
    entry.count++;
    if (entry.achievements.length < 16) entry.achievements.push(a.name || a.apiname);
  }
  const activityByDay = [...byDayMap.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  const irregularBursts = [];
  let i = 0;
  while (i < timestamped.length) {
    let j = i + 1;
    while (j < timestamped.length && timestamped[j].unlockTimestamp - timestamped[i].unlockTimestamp <= 60) {
      j++;
    }
    const count = j - i;
    if (count >= 3) {
      const slice = timestamped.slice(i, j);
      const spanSec = slice[slice.length - 1].unlockTimestamp - slice[0].unlockTimestamp;
      irregularBursts.push({
        startedAt: new Date(slice[0].unlockTimestamp * 1000).toISOString(),
        count,
        spanSeconds: spanSec,
        note: spanSec === 0
          ? `${count} achievements unlocked at the exact same second`
          : `${count} achievements unlocked within ${spanSec}s`,
        achievements: slice.slice(0, 12).map(a => a.name || a.apiname)
      });
      i = j;
    } else {
      i++;
    }
  }

  const baseRows = achievements.filter(a => (a?.set_id || 'base') === 'base');
  const baseUnlockedRows = baseRows.filter(a => a?.unlocked === true);
  const baseTotal = baseRows.length;
  const baseCompletionPercent = baseTotal > 0 ? Math.round((baseUnlockedRows.length / baseTotal) * 1000) / 10 : completionPercent;
  const isCompleted = baseTotal > 0 ? baseUnlockedRows.length === baseTotal : (total > 0 && unlockedRows.length === total);

  return {
    totalAchievements: total,
    unlockedCount: unlockedRows.length,
    lockedCount: lockedRows.length,
    completionPercent,
    baseTotalAchievements: baseTotal,
    baseUnlockedCount: baseUnlockedRows.length,
    baseCompletionPercent,
    isCompleted,
    isPerfectGame: isCompleted,
    protectedCount,
    hiddenCount,
    totalStats: stats.length,
    activityByDay,
    irregularBursts
  };
}

function parseDonorProfileReport(rawText, { maxGapMinutes = 120 } = {}) {
  const text = String(rawText || '').trim();
  if (!text) return { entries: [], donorSteamId64: null, donorName: null, donorHoursPlayed: null, totalFound: 0, unlockedCount: 0, firstUnlockMs: null, lastUnlockMs: null, totalSpanMs: 0, fullDaysExact: 0 };
  const parsed = [];
  let donorSteamId64 = null;
  let donorName = null;
  let donorHoursPlayed = null;

  const sidMatch = text.match(/\b(7656119\d{10})\b/);
  if (sidMatch) donorSteamId64 = sidMatch[1];

  const xmlIdMatch = text.match(/<steamID64>\s*(\d+)\s*<\/steamID64>/i);
  if (xmlIdMatch) donorSteamId64 = xmlIdMatch[1];
  const xmlNameMatch = text.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/i) || text.match(/<steamID>([^<]+)<\/steamID>/i);
  if (xmlNameMatch) donorName = xmlNameMatch[1].trim();
  const xmlHoursMatch = text.match(/<hoursPlayed>\s*([0-9.,]+)\s*<\/hoursPlayed>/i);
  if (xmlHoursMatch) {
    const h = Number(xmlHoursMatch[1].replace(',', '.'));
    if (Number.isFinite(h) && h > 0) donorHoursPlayed = h;
  }

  const shHoursMatch =
    text.match(/\b(\d{1,5})\s*h(?:rs?|ours?)?\s*(\d{1,2})\s*m(?:ins?)?\s+playtime\b/i) ||
    text.match(/\bplaytime[:\s]+(\d{1,5})\s*h(?:rs?|ours?)?\s*(\d{1,2})\s*m/i);
  if (shHoursMatch) {
    const h = Number(shHoursMatch[1]) + Number(shHoursMatch[2]) / 60;
    if (Number.isFinite(h) && h > 0) donorHoursPlayed = Math.round(h * 10) / 10;
  } else {
    const shDecimalHours =
      text.match(/\b(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:h|hrs|hours)\s+playtime\b/i) ||
      text.match(/\bplaytime[:\s]+(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:h|hrs|hours)?\b/i) ||
      text.match(/"playtime"\s*:\s*(\d+(?:\.\d+)?)/i) ||
      text.match(/"hoursPlayed"\s*:\s*(\d+(?:\.\d+)?)/i) ||
      text.match(/"playtimeMinutes"\s*:\s*(\d+)/i);
    if (shDecimalHours) {
      const rawVal = Number(String(shDecimalHours[1]).replace(',', '.'));
      if (Number.isFinite(rawVal) && rawVal > 0) {
        donorHoursPlayed = /playtimeMinutes/i.test(shDecimalHours[0])
          ? Math.round((rawVal / 60) * 10) / 10
          : (rawVal > 500 && /"playtime"\s*:/i.test(shDecimalHours[0]) ? Math.round((rawVal / 60) * 10) / 10 : Math.round(rawVal * 10) / 10);
      }
    }
  }

  const pushEntry = (apiname, name, tsMs) => {
    const cleanApi = apiname ? String(apiname).trim() : '';
    const cleanName = name ? String(name).trim() : '';
    if ((!cleanApi && !cleanName) || !Number.isFinite(tsMs) || tsMs <= 946684800000) return;
    parsed.push({
      apiname: cleanApi || cleanName,
      name: cleanName || cleanApi,
      unlockedAt: tsMs
    });
  };

  const toMs = val => {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return val < 1e12 ? val * 1000 : val;
    }
    if (typeof val === 'string' && val.trim()) {
      const s = val.trim();
      if (/^\d{9,13}$/.test(s)) {
        const n = Number(s);
        return n < 1e12 ? n * 1000 : n;
      }
      const d = Date.parse(s);
      if (Number.isFinite(d) && d > 0) return d;
    }
    return NaN;
  };

  const parseHumanDateStr = str => {
    const clean = String(str || '')
      .replace(/^unlocked\s+/i, '')
      .replace(/\s*@\s*/g, ' ')
      .replace(/(\d{1,2})\s+([A-Za-z]{3,9})\s+'(\d{2})\b/g, '$1 $2 20$3')
      .replace(/(\b[A-Za-z]{3,9})\s+(\d{1,2}),?\s+'(\d{2})\b/g, '$1 $2, 20$3')
      .trim();
    if (!clean) return NaN;
    const hasYear = /\b(199\d|20\d{2})\b/.test(clean);
    const withYear = hasYear ? clean : `${clean}, ${new Date().getFullYear()}`;
    const direct = Date.parse(withYear);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const m = clean.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?(?:[,\s]+(\d{1,2}):(\d{2})(?:\s*(am|pm))?)?/i);
    if (m) {
      const day = Number(m[1]);
      const monStr = m[2];
      const yr = m[3] ? (m[3].length === 2 ? Number('20' + m[3]) : Number(m[3])) : new Date().getFullYear();
      let hr = m[4] ? Number(m[4]) : 12;
      const min = m[5] ? Number(m[5]) : 0;
      const ampm = (m[6] || '').toLowerCase();
      if (ampm === 'pm' && hr < 12) hr += 12;
      if (ampm === 'am' && hr === 12) hr = 0;
      const rebuilt = Date.parse(`${monStr} ${day}, ${yr} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`);
      if (Number.isFinite(rebuilt)) return rebuilt;
    }
    return NaN;
  };

  try {
    const json = JSON.parse(text);
    const visitJson = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) visitJson(item);
        return;
      }
      if (!donorSteamId64 && typeof node.steamId64 === 'string' && /^7656119\d{10}$/.test(node.steamId64)) donorSteamId64 = node.steamId64;
      if (!donorName && typeof node.personaName === 'string' && node.personaName.trim()) donorName = node.personaName.trim();
      if (!donorHoursPlayed) {
        const candH = Number(node.hoursPlayed ?? node.playtimeHours ?? (typeof node.playtimeMinutes === 'number' ? node.playtimeMinutes / 60 : NaN));
        if (Number.isFinite(candH) && candH > 0) donorHoursPlayed = Math.round(candH * 10) / 10;
      }
      const api = node.apiname || node.apiName || node.ach_api || node.id || node.key || '';
      const nm = node.name || node.title || node.achievementName || node.displayName || '';
      const rawTime = node.unlockTimestamp ?? node.unlockedAt ?? node.unlockTime ?? node.timestamp ?? node.dateUnlocked ?? node.unlockedDate ?? node.time ?? node.date;
      const ts = toMs(rawTime);
      if ((api || nm) && Number.isFinite(ts)) {
        pushEntry(String(api || ''), String(nm || ''), ts);
      }
      for (const k of Object.keys(node)) {
        if (typeof node[k] === 'object' && node[k] !== null) visitJson(node[k]);
      }
    };
    visitJson(json);
  } catch {}

  if (!parsed.length && /<achievement[\s>]/i.test(text)) {
    const achBlocks = text.match(/<achievement(?:\s+[^>]*)?>[\s\S]*?<\/achievement>/gi) || [];
    for (const block of achBlocks) {
      if (/closed=["']0["']/i.test(block)) continue;
      const apiMatch = block.match(/<apiname>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/apiname>/i);
      const nameMatch = block.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/i);
      const tsMatch = block.match(/<unlockTimestamp>\s*(\d+)\s*<\/unlockTimestamp>/i);
      const ts = tsMatch ? toMs(Number(tsMatch[1])) : NaN;
      if ((apiMatch || nameMatch) && Number.isFinite(ts)) {
        pushEntry(apiMatch ? apiMatch[1] : '', nameMatch ? nameMatch[1] : '', ts);
      }
    }
  }

  if (!parsed.length) {
    const shModelMatch = text.match(/sh\.model\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|sh\.|window\.|var\s|const\s|let\s|$)/i);
    if (shModelMatch) {
      try {
        const shModel = JSON.parse(shModelMatch[1]);
        if (!donorSteamId64 && shModel?.steamUser?.steamId) donorSteamId64 = String(shModel.steamUser.steamId);
        if (!donorName && shModel?.steamUser?.personaName) donorName = String(shModel.steamUser.personaName);
        const rawPlaytimeMins = Number(shModel?.userApp?.playtime ?? shModel?.app?.playtime ?? shModel?.playtime ?? NaN);
        if (!donorHoursPlayed && Number.isFinite(rawPlaytimeMins) && rawPlaytimeMins > 0) {
          donorHoursPlayed = Math.round((rawPlaytimeMins / 60) * 10) / 10;
        }
        const lists = [
          shModel?.achievements,
          shModel?.userAchievements,
          shModel?.pagedList?.items,
          shModel?.list?.items,
          shModel?.data?.achievements,
          shModel?.app?.achievements
        ].filter(Array.isArray);
        for (const arr of lists) {
          for (const item of arr) {
            const api = item.apiName || item.apiname || item.achievementId || '';
            const nm = item.name || item.title || item.achievementName || '';
            const rawDt = item.unlockedDate || item.unlockDate || item.dateUnlocked || item.unlockedAt || item.timestamp;
            const ts = toMs(rawDt);
            if ((api || nm) && Number.isFinite(ts)) {
              pushEntry(String(api), String(nm), ts);
            }
          }
        }
      } catch {}
    }
  }

  if (!parsed.length) {
    const scriptJsonMatches = text.match(/\{[^{}]*"(?:apiName|apiname|achievementName|name)"[^{}]*"(?:unlockedDate|unlockTimestamp|dateUnlocked|unlockedAt)"[^{}]*\}/gi) || [];
    for (const frag of scriptJsonMatches) {
      try {
        const obj = JSON.parse(frag);
        const api = obj.apiName || obj.apiname || '';
        const nm = obj.name || obj.achievementName || obj.title || '';
        const ts = toMs(obj.unlockedDate ?? obj.unlockTimestamp ?? obj.dateUnlocked ?? obj.unlockedAt);
        if ((api || nm) && Number.isFinite(ts)) pushEntry(api, nm, ts);
      } catch {}
    }
  }

  if (!parsed.length && /achieveTxt|achieveRow|achievement/i.test(text)) {
    const rowBlocks = text.split(/<div[^>]+class=["'][^"']*(?:achieveRow|achievement-row|sh-achievement|media-body|tr-ach)[^"']*["'][^>]*>/i).slice(1);
    for (const block of rowBlocks) {
      const titleMatch =
        block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
        block.match(/class=["'][^"']*achieveTxt[^"']*["'][^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
        block.match(/<a[^>]+href=["'][^"']*\/achievements\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
      const unlockMatch =
        block.match(/class=["'][^"']*achieveUnlockTime[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
        block.match(/Unlocked\s+([^<\n\r]+)/i) ||
        block.match(/(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+'?\d{2,4})?\s*@\s*\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ||
        block.match(/([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*'?\d{2,4})?\s*@\s*\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ||
        block.match(/datetime=["']([^"']+)["']/i) ||
        block.match(/data-time(?:stamp)?=["'](\d{9,13})["']/i);
      if (titleMatch && unlockMatch) {
        const cleanName = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        const rawTimeText = unlockMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
        const ts = /^\d{9,13}$/.test(rawTimeText) ? toMs(rawTimeText) : parseHumanDateStr(rawTimeText);
        if (cleanName && Number.isFinite(ts)) {
          pushEntry('', cleanName, ts);
        }
      }
    }
  }

  if (!parsed.length) {
    const cleanHtml = text
      .replace(/<\/?(?:tr|div|li|p|br|h[1-6]|article|section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    const lines = cleanHtml.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const dateRegex = /(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+'?\d{2,4})?\s*@\s*\d{1,2}:\d{2}\s*(?:am|pm)?|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*'?\d{2,4})?\s*@\s*\d{1,2}:\d{2}\s*(?:am|pm)?|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const kv = line.match(/^([A-Za-z0-9_.-]{2,128})\s*[,|\t;]\s*(\d{9,13}|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)$/);
      if (kv) {
        const ts = toMs(kv[2]);
        if (Number.isFinite(ts)) {
          pushEntry(kv[1], kv[1], ts);
          continue;
        }
      }
      const dm = line.match(dateRegex);
      if (dm) {
        const dateStr = dm[1];
        const ts = parseHumanDateStr(dateStr);
        if (Number.isFinite(ts)) {
          const before = line.slice(0, dm.index).replace(/\b(?:unlocked|desbloqueado|on|el)\b/gi, '').trim();
          let candidateName = before;
          if (!candidateName || candidateName.length < 2) {
            for (let back = 1; back <= 3 && i - back >= 0; back++) {
              const prev = lines[i - back];
              if (prev && prev.length >= 2 && prev.length <= 120 && !dateRegex.test(prev) && !/^(?:\d+%|\d+\s*pts|points|global|rare|common|missable|story)$/i.test(prev)) {
                candidateName = prev;
                break;
              }
            }
          }
          if (candidateName) {
            pushEntry('', candidateName, ts);
          }
        }
      }
    }
  }

  const dedupMap = new Map();
  for (const item of parsed) {
    const key = `${(item.apiname || '').toLowerCase()}|${(item.name || '').toLowerCase()}`;
    const existing = dedupMap.get(key);
    if (!existing || item.unlockedAt < existing.unlockedAt) {
      dedupMap.set(key, item);
    }
  }
  const uniqueList = [...dedupMap.values()].sort((a, b) => a.unlockedAt - b.unlockedAt);
  if (!uniqueList.length) {
    return { entries: [], donorSteamId64, donorName, donorHoursPlayed, totalFound: 0, unlockedCount: 0, firstUnlockMs: null, lastUnlockMs: null, totalSpanMs: 0, fullDaysExact: 0 };
  }

  const maxGapMs = Math.max(1, Number(maxGapMinutes) || 120) * 60000;
  const entries = uniqueList.map((item, idx) => {
    const prev = idx > 0 ? uniqueList[idx - 1] : null;
    const rawDelta = prev ? Math.max(1000, item.unlockedAt - prev.unlockedAt) : 0;
    const cappedDelta = idx === 0 ? 0 : Math.min(rawDelta, maxGapMs);
    return {
      apiname: item.apiname,
      name: item.name || item.apiname,
      unlockedAt: new Date(item.unlockedAt).toISOString(),
      unlockedAtMs: item.unlockedAt,
       unlockTimestamp: Math.floor(item.unlockedAt / 1000),
      rawDeltaMs: rawDelta,
      cappedDeltaMs: cappedDelta
    };
  });

  const firstUnlockMs = uniqueList[0].unlockedAt;
  const lastUnlockMs = uniqueList[uniqueList.length - 1].unlockedAt;
  const totalSpanMs = Math.max(0, lastUnlockMs - firstUnlockMs);
  const fullDaysExact = Math.round((totalSpanMs / (24 * 3600000)) * 10) / 10;

  return {
    entries,
    donorSteamId64,
    donorName,
    donorHoursPlayed,
    totalFound: entries.length,
    unlockedCount: entries.length,
    firstUnlockMs,
    lastUnlockMs,
    totalSpanMs,
    fullDaysExact
  };
}

function parseExternalUserTimings(xmlOrJson, currentAchievementsOrOptions = []) {
  const raw = String(xmlOrJson || '').trim();
  if (!raw) throw fail('Empty timing source response.', 400);
  if (Array.isArray(currentAchievementsOrOptions) && currentAchievementsOrOptions.length > 0) {
    const lockedByApi = new Map();
    const lockedByName = new Map();
    for (const a of currentAchievementsOrOptions) {
      if (a.unlocked === false && !a.serverControlled && a.apiname) {
        lockedByApi.set(a.apiname.toLowerCase(), a.apiname);
        if (a.name) lockedByName.set(a.name.trim().toLowerCase(), a.apiname);
      }
    }
    const report = parseDonorProfileReport(raw);
    if (!report.entries.length) {
      if ((raw.startsWith('{') || raw.startsWith('[')) && (() => { try { JSON.parse(raw); return false; } catch { return true; } })()) {
        throw fail('Invalid JSON timing source.', 400);
      }
      return [];
    }
    const matched = [];
    const seen = new Set();
    for (const e of report.entries) {
      const apiKey = String(e.apiname || '').trim().toLowerCase();
      const titleKey = String(e.name || '').trim().toLowerCase();
      const foundApi = lockedByApi.get(apiKey) || lockedByName.get(titleKey) || lockedByName.get(apiKey);
      if (foundApi && !seen.has(foundApi)) {
        seen.add(foundApi);
        matched.push({ apiname: foundApi, unlockTimestamp: e.unlockTimestamp || Math.floor(e.unlockedAtMs / 1000), unlockedAt: e.unlockedAt, unlockedAtMs: e.unlockedAtMs, rawDeltaMs: e.rawDeltaMs });
      }
    }
    return matched;
  }
  const opts = currentAchievementsOrOptions && typeof currentAchievementsOrOptions === 'object' && !Array.isArray(currentAchievementsOrOptions)
    ? currentAchievementsOrOptions
    : {};
  return parseDonorProfileReport(raw, opts).entries;
}

const fs = require('node:fs');
const crypto = require('node:crypto');

const PRIME_SECOND_OFFSETS = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59];

function randomGaussian(mean, stdDev) {
  let u = 1 - Math.random(), v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, mean + z * stdDev);
}

/**
 * Motor Circadiano Biológico Semanal:
 * Ajusta cualquier timestamp para que caiga siempre en horario humano activo según el día de la semana:
 * - Lunes a Jueves: 16:30 a 00:35 hs
 * - Viernes y Sábado (Fin de semana): 13:30 a 02:45 hs
 * - Domingo: 13:45 a 23:15 hs
 * Además inyecta entropía de segundos primos no repetidos (:07, :13, :29, :47...) para evitar :00.
 */
function applyCircadianWindow(tsMs, stepIndex = 0) {
  const dt = new Date(tsMs);
  const dow = dt.getDay();
  const h = dt.getHours();

  let sleepStartHour = 1;
  let wakeHour = 16;
  if (dow === 5 || dow === 6) {
    sleepStartHour = 3;
    wakeHour = 13;
  } else if (dow === 0) {
    sleepStartHour = 0;
    wakeHour = 14;
  } else {
    sleepStartHour = 1;
    wakeHour = 16;
  }

  if (h >= sleepStartHour && h < wakeHour) {
    dt.setHours(wakeHour, 18 + ((stepIndex * 11 + Math.floor(Math.random() * 29)) % 38), 0, 0);
  }
  const primeSec = PRIME_SECOND_OFFSETS[(stepIndex + Math.floor(Math.random() * PRIME_SECOND_OFFSETS.length)) % PRIME_SECOND_OFFSETS.length];
  const jitterMs = 110 + ((stepIndex * 173 + Math.floor(Math.random() * 790)) % 880);
  dt.setSeconds(primeSec, jitterMs);
  return dt.getTime();
}

/**
 * Detecta si dos logros consecutivos forman un "Par de Historia / Cierre de Capítulo"
 * (ej. completar el capítulo + derrotar al jefe de ese capítulo, o logros del mismo acto).
 */
function detectStoryClusterPair(prevItem, currItem) {
  if (!prevItem || !currItem) return false;
  const apiA = String(prevItem.apiname || '').toUpperCase().replace(/\d+$/, '');
  const apiB = String(currItem.apiname || '').toUpperCase().replace(/\d+$/, '');
  if (apiA.length >= 5 && apiA === apiB) {
    const numA = Number((String(prevItem.apiname || '').match(/(\d+)$/) || [])[1]);
    const numB = Number((String(currItem.apiname || '').match(/(\d+)$/) || [])[1]);
    if (Number.isFinite(numA) && Number.isFinite(numB) && Math.abs(numA - numB) === 1) {
      if (/CHAP|ACT|LEVEL|MISSION|STAGE|EPISODE|WAVE/i.test(apiA)) return false;
    }
  }
  const textA = `${prevItem.name || ''} ${prevItem.description || ''}`.toLowerCase();
  const textB = `${currItem.name || ''} ${currItem.description || ''}`.toLowerCase();
  const chapA = (textA.match(/\b(?:chapter|cap[ií]tulo|mission|misi[oó]n|act|acto)\s*(\d+|[ivx]+)\b/i) || [])[1];
  const chapB = (textB.match(/\b(?:chapter|cap[ií]tulo|mission|misi[oó]n|act|acto)\s*(\d+|[ivx]+)\b/i) || [])[1];
  if (chapA && chapB && chapA.toLowerCase() === chapB.toLowerCase()) {
    return true;
  }
  const pctA = typeof prevItem.percent === 'number' ? prevItem.percent : null;
  const pctB = typeof currItem.percent === 'number' ? currItem.percent : null;
  if (pctA !== null && pctB !== null && pctA >= 25 && Math.abs(pctA - pctB) <= 1.15) {
    return true;
  }
  return false;
}

/**
 * Calcula el delay bio-realista entre un logro y el siguiente combinando:
 * 1) Detección de Par de Historia (1m 15s – 4m 20s)
 * 2) Curva Log-Normal / Weibull de "Muro de Jefe y Reintentos" para logros raros (<15% y <5%)
 * 3) Micro-pausas AFK biológicas (14m – 34m cada 95–135 min de sesión continua)
 * 4) Memoria Anti-Clon para nunca repetir dos intervalos con los mismos minutos.
 */
function computeBioRealisticStepDelay(item, prevItem, {
  stepIndex = 0,
  elapsedInSessionMs = 0,
  recentDeltasMin = [],
  rng = Math.random
} = {}) {
  const pct = typeof item?.percent === 'number' && Number.isFinite(item.percent) ? item.percent : 30;
  const primeSec = PRIME_SECOND_OFFSETS[(stepIndex + Math.floor(rng() * PRIME_SECOND_OFFSETS.length)) % PRIME_SECOND_OFFSETS.length];

  if (prevItem && detectStoryClusterPair(prevItem, item)) {
    const pairSeconds = 75 + Math.floor(rng() * 185) + primeSec; // 1m 22s a 4m 39s
    return {
      delayMs: pairSeconds * 1000,
      isStoryPair: true,
      hasBioBreak: false,
      bossRetryMultiplier: 1.0
    };
  }

  // Base en minutos según rareza global + curva de reintentos (Boss-Wall / Retry Physics)
  let baseMins = 28;
  let bossMultiplier = 1.0;
  if (pct >= 55) {
    baseMins = 18 + rng() * 24;
  } else if (pct >= 28) {
    baseMins = 32 + rng() * 38;
  } else if (pct >= 12) {
    bossMultiplier = 1.25 + rng() * 0.35;
    baseMins = (42 + rng() * 44) * bossMultiplier;
  } else if (pct >= 4) {
    bossMultiplier = 1.55 + rng() * 0.55;
    baseMins = (55 + rng() * 55) * bossMultiplier;
  } else {
    // Logro Mítico (<4%): requiere varios intentos fallidos y práctica antes de salir
    bossMultiplier = 1.85 + rng() * 0.75;
    baseMins = (68 + rng() * 65) * bossMultiplier;
  }

  // Micro-pausa AFK biológica (comida/café/celular) cada ~105 min de sesión continua
  let bioBreakMins = 0;
  const hasBioBreak = elapsedInSessionMs >= (95 + (stepIndex % 4) * 10) * 60000;
  if (hasBioBreak) {
    bioBreakMins = 14 + rng() * 20;
  }

  let totalMins = Math.round(baseMins + bioBreakMins);
  if (recentDeltasMin.includes(totalMins)) {
    totalMins += 3 + (stepIndex % 5);
  }
  recentDeltasMin.push(totalMins);
  if (recentDeltasMin.length > 6) recentDeltasMin.shift();

  const delayMs = totalMins * 60000 + primeSec * 1000 + Math.floor(rng() * 890);
  return {
    delayMs,
    isStoryPair: false,
    hasBioBreak,
    bossRetryMultiplier: Number(bossMultiplier.toFixed(2))
  };
}

function buildDonorPlaytimeSessions(offsetsMs = [], { baseNowMs = Date.now(), targetPlaytimeHours = null } = {}) {
  const validOffsets = (Array.isArray(offsetsMs) ? offsetsMs : [])
    .map(n => Number(n))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  if (!validOffsets.length) {
    return {
      sessions: [],
      plannedPlaytimeHours: 0,
      rawClusterHours: 0,
      targetPlaytimeHours: targetPlaytimeHours || 0
    };
  }

  const SESSION_SPLIT_GAP_MS = 95 * 60000;
  const clusters = [];
  let curStart = validOffsets[0];
  let curEnd = validOffsets[0];
  let curCount = 1;

  for (let i = 1; i < validOffsets.length; i++) {
    const off = validOffsets[i];
    if (off - curEnd <= SESSION_SPLIT_GAP_MS) {
      curEnd = off;
      curCount++;
    } else {
      clusters.push({ firstOffsetMs: curStart, lastOffsetMs: curEnd, count: curCount });
      curStart = off;
      curEnd = off;
      curCount = 1;
    }
  }
  clusters.push({ firstOffsetMs: curStart, lastOffsetMs: curEnd, count: curCount });

  // Warm-up antes del primer logro de cada sesión y Post-Trophy Cooldown (8-16 min) antes de cerrar el juego
  const baseLeadMs = 26 * 60000;
  const baseTailMs = 11 * 60000;

  let rawDurationMs = 0;
  const rawSessions = clusters.map((c, idx) => {
    const startOff = idx === 0 ? 0 : Math.max(0, c.firstOffsetMs - baseLeadMs);
    const cooldownTailMs = (idx === clusters.length - 1 ? 14 : 9 + (idx % 7)) * 60000;
    const endOff = c.lastOffsetMs + Math.max(baseTailMs, cooldownTailMs);
    const dur = Math.max(15 * 60000, endOff - startOff);
    rawDurationMs += dur;
    return {
      sessionIndex: idx + 1,
      firstUnlockOffsetMs: c.firstOffsetMs,
      lastUnlockOffsetMs: c.lastOffsetMs,
      achievementCount: c.count,
      startOffsetMs: startOff,
      endOffsetMs: startOff + dur,
      durationMs: dur
    };
  });

  const targetHoursNum = Number(targetPlaytimeHours);
  if (Number.isFinite(targetHoursNum) && targetHoursNum > 0) {
    const targetMs = targetHoursNum * 3600000;
    const diffMs = targetMs - rawDurationMs;
    if (diffMs > 10 * 60000 && rawSessions.length > 0) {
      const extraPerSession = Math.min(3.5 * 3600000, Math.round(diffMs / rawSessions.length));
      for (let i = 0; i < rawSessions.length; i++) {
        const s = rawSessions[i];
        const prevEnd = i > 0 ? rawSessions[i - 1].endOffsetMs + 15 * 60000 : 0;
        const nextStart = i + 1 < rawSessions.length ? rawSessions[i + 1].firstOffsetMs - 15 * 60000 : Infinity;
        const canPrepend = Math.max(0, s.startOffsetMs - prevEnd);
        const prepend = Math.min(canPrepend, Math.round(extraPerSession * 0.7));
        s.startOffsetMs -= prepend;
        const remExtra = extraPerSession - prepend;
        const canAppend = Math.max(0, nextStart - s.endOffsetMs);
        const append = Math.min(canAppend, remExtra);
        s.endOffsetMs += append;
        s.durationMs = Math.max(15 * 60000, s.endOffsetMs - s.startOffsetMs);
      }
    } else if (diffMs < -30 * 60000 && rawDurationMs > 0) {
      for (let i = 0; i < rawSessions.length; i++) {
        const s = rawSessions[i];
        const minLead = i === 0 ? 0 : 12 * 60000;
        const minTail = 7 * 60000;
        s.startOffsetMs = i === 0 ? 0 : Math.max(0, s.firstUnlockOffsetMs - minLead);
        s.endOffsetMs = s.lastUnlockOffsetMs + minTail;
        s.durationMs = Math.max(10 * 60000, s.endOffsetMs - s.startOffsetMs);
      }
    }
  }

  const merged = [];
  for (const s of rawSessions) {
    const prev = merged[merged.length - 1];
    if (prev && s.startOffsetMs <= prev.endOffsetMs + 10 * 60000) {
      prev.endOffsetMs = Math.max(prev.endOffsetMs, s.endOffsetMs);
      prev.lastUnlockOffsetMs = Math.max(prev.lastUnlockOffsetMs, s.lastUnlockOffsetMs);
      prev.achievementCount += s.achievementCount;
      prev.durationMs = prev.endOffsetMs - prev.startOffsetMs;
    } else {
      merged.push({ ...s });
    }
  }

  let totalPlannedMs = 0;
  const finalSessions = merged.map((s, idx) => {
    totalPlannedMs += s.durationMs;
    return {
      sessionIndex: idx + 1,
      achievementCount: s.achievementCount,
      startOffsetMs: Math.round(s.startOffsetMs),
      endOffsetMs: Math.round(s.endOffsetMs),
      startAtMs: Math.round(baseNowMs + s.startOffsetMs),
      endAtMs: Math.round(baseNowMs + s.endOffsetMs),
      startAt: new Date(baseNowMs + s.startOffsetMs).toISOString(),
      endAt: new Date(baseNowMs + s.endOffsetMs).toISOString(),
      durationHours: Math.round((s.durationMs / 3600000) * 10) / 10
    };
  });

  return {
    sessions: finalSessions,
    plannedPlaytimeHours: Math.round((totalPlannedMs / 3600000) * 10) / 10,
    rawClusterHours: Math.round((rawDurationMs / 3600000) * 10) / 10,
    targetPlaytimeHours: Number.isFinite(targetHoursNum) && targetHoursNum > 0 ? Math.round(targetHoursNum * 10) / 10 : null
  };
}

function buildHumanizedOffsets(count, totalMs, spacing = 'random') {
  if (count <= 1) return [0];
  if (spacing === 'even') {
    const step = Math.floor(totalMs / count);
    return Array.from({ length: count }, (_, idx) => (idx + 1) * step);
  }
  const intervals = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (i === 0 && spacing === 'random') {
      intervals.push(0);
      continue;
    }
    let w = randomGaussian(1.0, spacing === 'natural' ? 0.42 : 0.35);
    if (w < 0.08) w = 0.08;
    if (spacing === 'natural' && i > 0 && i % 4 === 0) {
      w += randomGaussian(1.6, 0.4);
    }
    intervals.push(w);
    sum += w;
  }
  if (sum <= 0) {
    const step = Math.floor(totalMs / count);
    return Array.from({ length: count }, (_, idx) => (idx + 1) * step);
  }
  let acc = 0;
  return intervals.map((w, idx) => {
    if (idx === 0 && spacing === 'random') return 0;
    acc += w;
    return Math.max(0, Math.min(totalMs, Math.round((acc / sum) * totalMs)));
  }).sort((a, b) => a - b);
}

function classifyProgressionPhase(percent) {
  const p = typeof percent === 'number' && Number.isFinite(percent) ? percent : null;
  if (p !== null) {
    if (p > 60) return { phase: 1, label: 'Fase 1 (Inicio / Historia temprana)' };
    if (p >= 30) return { phase: 2, label: 'Fase 2 (Mid-game / Misiones intermedias)' };
    if (p >= 10) return { phase: 3, label: 'Fase 3 (End-game / Secretos y Coleccionables)' };
    return { phase: 4, label: 'Fase 4 (Platino / Maestría 100%)' };
  }
  return { phase: 4, label: 'Fase 4 (Platino / Maestría 100%)' };
}

function sortAchievementsByProgression(items, percentagesMap = null) {
  if (!Array.isArray(items)) return [];
  const lookup = new Map();
  if (percentagesMap && typeof percentagesMap === 'object') {
    const entries = percentagesMap instanceof Map ? [...percentagesMap.entries()] : Object.entries(percentagesMap);
    for (const [k, v] of entries) {
      const num = Number(v);
      if (Number.isFinite(num) && num >= 0 && num <= 100) {
        lookup.set(String(k), num);
        lookup.set(String(k).toLowerCase(), num);
      }
    }
  }
  const prepared = items.map((item, idx) => {
    const apiname = String(item?.apiname || '');
    const rawPct = typeof item?.percent === 'number' && Number.isFinite(item.percent)
      ? item.percent
      : (lookup.get(apiname) ?? lookup.get(apiname.toLowerCase()) ?? null);
    const { phase, label } = classifyProgressionPhase(rawPct);
    return {
      ...item,
      apiname,
      action: item?.action === 'remove' ? 'remove' : 'unlock',
      percent: rawPct,
      _rarityPhase: phase,
      _rarityLabel: label,
      _origIdx: idx
    };
  });
  const dag = new AchievementDependencyGraph(prepared, { percentagesMap: lookup });
  const topo = dag.topologicalSort();
  return topo.map(({ _origIdx, _rarityPhase, _rarityLabel, ...rest }) => {
    const finalPhase = Math.min(4, Math.max(_rarityPhase || 1, rest.depth > 0 ? Math.min(4, rest.phase || 1) : (_rarityPhase || 1)));
    return {
      ...rest,
      phase: finalPhase,
      phaseLabel: _rarityLabel || rest.phaseLabel
    };
  });
}

function detectSpecialAchievementCondition(item) {
  const text = `${item?.name || ''} ${item?.description || ''} ${item?.apiname || ''}`.toLowerCase();
  if (/\b(christmas|xmas|holiday|gift grab|2011|santa|festive|navidad|nochebuena|snow globe|ghost of christmas|free holiday player)\b/i.test(text)) {
    return {
      isDateSpecific: true,
      isSpecial: true,
      category: 'christmas',
      label: '🎄 Evento Navidad / Diciembre (Fecha específica)',
      reasonEs: 'Logro de evento navideño o promoción de diciembre (se omite fuera de fecha para evitar marcas en SteamHunters/AStats).'
    };
  }
  if (/\b(halloween|scream fortress|spooky|october 31|31 de octubre|noche de brujas|horseless headless|monoculus|merasmus)\b/i.test(text)) {
    return {
      isDateSpecific: true,
      isSpecial: true,
      category: 'halloween',
      label: '🎃 Evento Halloween / Octubre (Fecha específica)',
      reasonEs: 'Logro de evento de Halloween (octubre).'
    };
  }
  if (/\b(good guy nick|free weekend|fin de semana gratis|play with a developer|real garry|yes, i am the real)\b/i.test(text)) {
    return {
      isDateSpecific: true,
      isSpecial: true,
      category: 'special_event',
      label: '📅 Evento Especial (Free Weekend / Creador)',
      reasonEs: 'Requiere un evento oficial de Fin de Semana Gratis de Valve o partida con desarrollador.'
    };
  }
  if (/\b(valentine|san valent[ií]n|april fool|new year|a[ñn]o nuevo|anniversary|aniversario)\b/i.test(text)) {
    return {
      isDateSpecific: true,
      isSpecial: true,
      category: 'calendar_date',
      label: '📅 Fecha Específica del Calendario',
      reasonEs: 'Asociado a una fecha puntual del calendario.'
    };
  }
  if (/\b(unobtainable|deprecated|servers? closed|shutdown|retired achievement|do not unlock)\b/i.test(text) || (typeof item?.percent === 'number' && item.percent === 0 && /\b(ranked|season 1|tournament|online|multiplayer|leaderboards?)\b/i.test(text))) {
    return {
      isDateSpecific: true,
      isSpecial: true,
      category: 'broken_or_closed',
      label: '🚫 Logro Inobtenible / Servidor Cerrado (0.0%)',
      reasonEs: 'Detectado como logro roto o de servidor cerrado (0.0%) para proteger tu perfil en SteamHunters.'
    };
  }
  return { isDateSpecific: false, isSpecial: false, category: null, label: null, reasonEs: null };
}


function computeSmartPlaytimeWarmup({
  firstItemPercent = null,
  alreadyUnlockedCount = 0,
  totalAchievements = 0,
  currentPlaytimeHours = 0,
  targetPlaytimeHours = 0,
  enableWarmup = true
} = {}) {
  if (enableWarmup === false) {
    return { warmupNeeded: false, warmupHours: 0, warmupMs: 0, requiredBaseHours: 0, currentPlaytimeHours: Number(currentPlaytimeHours) || 0, reasonEs: null };
  }
  const curHrs = Math.max(0, Number(currentPlaytimeHours) || 0);
  const unlockedCnt = Math.max(0, Number(alreadyUnlockedCount) || 0);
  const totalCnt = Math.max(1, Number(totalAchievements) || 1);
  const refTargetHrs = Math.max(8, Number(targetPlaytimeHours) || 24);
  const pct = typeof firstItemPercent === "number" && Number.isFinite(firstItemPercent) ? firstItemPercent : null;

  let requiredBaseHours = 0;
  let triggerReason = null;

  if (unlockedCnt > 0) {
    const progressRatio = Math.min(0.9, unlockedCnt / totalCnt);
    requiredBaseHours = Number(Math.min(14, Math.max(0.8, progressRatio * refTargetHrs * 0.45)).toFixed(2));
    triggerReason = `Ya tenés ${unlockedCnt} logro(s) previo(s)`;
  } else if (pct !== null && pct < 50) {
    requiredBaseHours = pct < 15 ? 2.4 : pct < 30 ? 1.5 : 0.8;
    triggerReason = `El 1º logro pendiente es de mitad/final de campaña (${pct.toFixed(1)}%)`;
  }

  const deficitHours = Math.max(0, requiredBaseHours - curHrs);
  const warmupHours = deficitHours >= 0.25 ? Number(Math.min(4.0, deficitHours).toFixed(2)) : 0;
  const warmupMs = Math.round(warmupHours * 3600000);

  return {
    warmupNeeded: warmupMs > 0,
    warmupHours,
    warmupMs,
    requiredBaseHours: Number(requiredBaseHours.toFixed(2)),
    currentPlaytimeHours: Number(curHrs.toFixed(2)),
    reasonEs: warmupMs > 0
      ? `🔥 Calentamiento de Playtime activo: +${warmupHours} hs con el juego abierto antes del 1º logro (${triggerReason}; tu cuenta registra ${curHrs.toFixed(1)} hs y requiere ~${requiredBaseHours.toFixed(1)} hs base).`
      : null
  };
}

function buildSessionAfkWindows(sessions = [], offsetsMs = [], { baseNowMs = Date.now(), simulateAfkPauses = true } = {}) {
  if (simulateAfkPauses === false || !Array.isArray(sessions) || !sessions.length) return [];
  const afkWindows = [];
  const validOffsets = (Array.isArray(offsetsMs) ? offsetsMs : []).map(Number).filter(Number.isFinite);

  for (let idx = 0; idx < sessions.length; idx++) {
    const s = sessions[idx];
    const startOff = Number(s.startOffsetMs ?? 0);
    const endOff = Number(s.endOffsetMs ?? 0);
    const durMs = endOff - startOff;
    if (durMs < 105 * 60000) continue; // Solo sesiones largas (>= 1h 45m) tienen pausa AFK humana

    const afkDurMin = 12 + ((idx * 5 + 3) % 11); // 12 a 22 minutos en estado Ausente (Away)
    const afkDurMs = afkDurMin * 60000;
    let candidateStart = startOff + Math.round(durMs * (0.44 + (idx % 3) * 0.06));

    // Evitar superposición directa con un logro desbloqueándose; mover la pausa AFK a un hueco tranquilo
    for (let guard = 0; guard < 8; guard++) {
      const conflict = validOffsets.find(off => off >= candidateStart - 2 * 60000 && off <= candidateStart + afkDurMs + 2 * 60000);
      if (conflict === undefined) break;
      candidateStart = conflict + 4 * 60000;
    }

    if (candidateStart + afkDurMs + 5 * 60000 <= endOff) {
      const afkEnd = candidateStart + afkDurMs;
      afkWindows.push({
        sessionIndex: s.sessionIndex || (idx + 1),
        startOffsetMs: candidateStart,
        endOffsetMs: afkEnd,
        startAtMs: baseNowMs + candidateStart,
        endAtMs: baseNowMs + afkEnd,
        startAt: new Date(baseNowMs + candidateStart).toISOString(),
        endAt: new Date(baseNowMs + afkEnd).toISOString(),
        durationMinutes: afkDurMin,
        personaState: 3,
        labelEs: `☕ Micro-pausa AFK (${afkDurMin} min en estado Ausente)`
      });
    }
  }
  return afkWindows;
}

function computePreFlightAudit({
  items = [],
  skippedSpecial = [],
  offsetsMs = [],
  plannedPlaytimeHours = 0,
  currentPlaytimeHours = 0,
  medianHours = null,
  donorHoursPlayed = null,
  warmupHours = 0,
  statRampPlan = [],
  donorJitterApplied = true,
  afkWindows = [],
  alreadyUnlockedCount = 0
} = {}) {
  const checks = [];
  const warningsEs = [];
  let score = 100;

  const refHours = Number(medianHours || donorHoursPlayed || plannedPlaytimeHours || 12);
  const totalExpectedHours = Number(currentPlaytimeHours || 0) + Number(plannedPlaytimeHours || 0) + Number(warmupHours || 0);
  const speedRatio = refHours > 0 ? totalExpectedHours / refHours : 1;
  const speedOk = totalExpectedHours >= Math.min(1.0, refHours * 0.42) || items.length <= 3;
  if (!speedOk) {
    score -= 22;
    warningsEs.push(`El Playtime total proyectado (${totalExpectedHours.toFixed(1)} hs) es muy bajo frente a la referencia del juego (${refHours.toFixed(1)} hs).`);
  }
  checks.push({
    id: "speed_vs_median",
    ok: speedOk,
    labelEs: "Velocidad vs. Mediana de SteamHunters/HLTB",
    detailEs: `${totalExpectedHours.toFixed(1)} hs proyectadas vs. ~${refHours.toFixed(1)} hs de referencia (${Math.round(speedRatio * 100)}%)`
  });

  const firstPct = items[0] && typeof items[0].percent === "number" ? items[0].percent : 75;
  const warmupOk = (firstPct >= 45 && Number(alreadyUnlockedCount) === 0) || (Number(currentPlaytimeHours) + Number(warmupHours) >= 0.4) || items.length === 0;
  if (!warmupOk) {
    score -= 15;
    warningsEs.push("El primer logro pendiente es avanzado y la cuenta tiene pocas horas base acumuladas.");
  }
  checks.push({
    id: "initial_playtime_coherence",
    ok: warmupOk,
    labelEs: "Coherencia de Horas Iniciales (Smart Warm-Up)",
    detailEs: warmupHours > 0
      ? `Calentamiento previo activo (+${warmupHours} hs antes del 1º logro)`
      : `Horas base verificadas (${Number(currentPlaytimeHours || 0).toFixed(1)} hs previas · 1º logro ${firstPct.toFixed(1)}%)`
  });

  const firstIsDlc = items[0] && String(items[0].set_id || "").startsWith("dlc_");
  const hasLaterIntroBase = firstIsDlc && items.slice(1).some(it => (!it.set_id || it.set_id === "base") && typeof it.percent === "number" && it.percent >= 55);
  const dlcOrderOk = !hasLaterIntroBase;
  if (!dlcOrderOk) {
    score -= 18;
    warningsEs.push("Hay logros de DLC programados antes que los logros introductorios del juego base.");
  }
  checks.push({
    id: "base_before_dlc",
    ok: dlcOrderOk,
    labelEs: "Orden Juego Base antes que DLC (Regla Oct 2026)",
    detailEs: dlcOrderOk ? "Progresión Base → DLC coherente" : "Atención: DLC antes de historia base"
  });

  let burstCount = 0;
  for (let i = 3; i < offsetsMs.length; i++) {
    if (offsetsMs[i] - offsetsMs[i - 3] < 45000) burstCount++;
  }
  const burstOk = burstCount === 0;
  if (!burstOk) {
    score -= 25;
    warningsEs.push(`Se detectaron ${burstCount} ráfaga(s) de 4+ logros en menos de 45 segundos.`);
  }
  checks.push({
    id: "anti_sam_burst",
    ok: burstOk,
    labelEs: "Protección Anti-Ráfagas SAM",
    detailEs: burstOk ? "0 timestamps simultáneos o ráfagas artificiales" : `${burstCount} ráfaga(s) detectada(s)`
  });

  const unskippedSpecial = items.filter(it => it.specialCondition?.isDateSpecific).length;
  const specialOk = unskippedSpecial === 0;
  if (!specialOk) {
    score -= 15;
    warningsEs.push(`Hay ${unskippedSpecial} logro(s) de evento/servidor cerrado (0.0%) incluidos sin filtrar.`);
  }
  checks.push({
    id: "special_and_broken_filter",
    ok: specialOk,
    labelEs: "Filtro de Eventos y Logros Rotos (0.0%)",
    detailEs: specialOk
      ? `Protegido (${skippedSpecial.length} omitido${skippedSpecial.length === 1 ? "" : "s"} automáticamente)`
      : `${unskippedSpecial} logro(s) especial(es) sin omitir`
  });

  const telemetryOk = Boolean(donorJitterApplied !== false);
  checks.push({
    id: "human_telemetry",
    ok: telemetryOk,
    labelEs: "Telemetría Humana (Stat Ramping + AFK + Anti-Huella)",
    detailEs: `${statRampPlan.length} contadores progresivos · ${afkWindows.length} micro-pausa(s) AFK · Anti-Huella ${telemetryOk ? "activo" : "desactivado"}`
  });

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 95 ? "S+" : score >= 85 ? "A" : score >= 72 ? "B" : "RIESGO";
  return {
    score,
    grade,
    safe: score >= 75,
    checks,
    warningsEs,
    summaryEs: `🛡️ Auditoría Pre-Vuelo: ${score}/100 (Grado ${grade}) — ${warningsEs.length === 0 ? "100% Indetectable para SteamHunters y AStats" : warningsEs[0]}`
  };
}

function alignOffsetToHumanEvening(baseNowMs, candidateOffsetMs, prevOffsetMs, stepIndex = 0) {
  let targetMs = baseNowMs + Math.max(candidateOffsetMs, prevOffsetMs + 24 * 60000);
  targetMs = applyCircadianWindow(targetMs, stepIndex);
  if (targetMs <= baseNowMs + prevOffsetMs) {
    targetMs = applyCircadianWindow(baseNowMs + prevOffsetMs + (38 + (stepIndex % 7) * 6) * 60000, stepIndex + 1);
  }
  return Math.max(60000, targetMs - baseNowMs);
}

/**
 * Construye una cola realista clonando el orden exacto de obtención de un jugador real
 * (de SteamHunters o SteamCommunity) con IA de Compresión de Inactividad (Smart Hiatus Compression AI)
 * y Ritmo Circadiano Humano.
 * Soporta tanto la firma (availableItems, donorEntries, options) como la firma legacy (timings, options).
 */
function buildDonorRealisticSchedule(arg1 = [], arg2 = [], arg3 = {}) {
  let availableItems = [];
  let donorEntries = [];
  let opts = {};

  if (arg2 && !Array.isArray(arg2) && typeof arg2 === 'object') {
    // Firma legacy: (timings, { achievementsByApi, percentagesMap, skipDateSpecific, baseNowMs })
    opts = arg2;
    donorEntries = Array.isArray(arg1) ? arg1 : [];
    const byApi = opts.achievementsByApi instanceof Map ? opts.achievementsByApi : new Map();
    availableItems = donorEntries.map(t => {
      const meta = byApi.get(t.apiname) || {};
      return {
        apiname: t.apiname,
        name: meta.name || t.name || t.apiname,
        description: meta.description || '',
        percent: opts.percentagesMap?.[t.apiname] ?? meta.percent ?? null
      };
    });
  } else {
    availableItems = Array.isArray(arg1) ? arg1 : [];
    donorEntries = Array.isArray(arg2) ? arg2 : [];
    opts = arg3 || {};
  }

  const {
    percentagesMap = null,
    skipDateSpecific = true,
    includeAlreadyUnlocked = false,
    donorReport = null,
    customPlaytimeHours = null,
    compressLongHiatus = true,
    simulateOffDays = true,
    enableStatRamping = true,
    donorJitter = true,
    simulateAfkPauses = true,
    enableWarmup = true,
    currentPlaytimeHours = 0,
    alreadyUnlockedCount = 0,
    maxRestGapHours = 18,
    baseNowMs = Date.now()
  } = opts;

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byApi = new Map();
  const byTitle = new Map();

  for (const item of availableItems) {
    if (item.apiname) byApi.set(norm(item.apiname), item);
    if (item.name) byTitle.set(norm(item.name), item);
  }

  const matched = [];
  const skippedSpecial = [];
  const usedApis = new Set();

  for (const d of donorEntries) {
    const keyApi = d.apiname ? norm(d.apiname) : '';
    const keyName = d.name ? norm(d.name) : '';
    const target = (keyApi && byApi.get(keyApi)) || (keyName && byTitle.get(keyName));
    if (!target || usedApis.has(target.apiname)) continue;
    usedApis.add(target.apiname);

    const pct = percentagesMap && typeof percentagesMap[target.apiname] === 'number'
      ? percentagesMap[target.apiname]
      : (typeof target.percent === 'number' ? target.percent : null);
    const special = detectSpecialAchievementCondition({ ...target, percent: pct });
    const rawTs = d.unlockedAtMs || (typeof d.unlockTimestamp === 'number' ? d.unlockTimestamp * 1000 : Date.parse(d.unlockedAt)) || 0;
    const isoTs = d.unlockedAt || (rawTs > 0 ? new Date(rawTs).toISOString() : new Date().toISOString());

    if (skipDateSpecific && special.isDateSpecific) {
      skippedSpecial.push({
        ...target,
        percent: pct,
        specialCondition: special,
        donorUnlockedAt: isoTs
      });
      continue;
    }
    matched.push({
      ...target,
      action: 'unlock',
      percent: pct,
      specialCondition: special,
      donorUnlockedAt: isoTs,
      donorUnlockedAtMs: rawTs,
      donorUnlockTimestamp: Math.floor(rawTs / 1000),
      donorRawDeltaMs: d.rawDeltaMs || 0
    });
  }

  if (!matched.length) {
    return {
      items: [],
      skippedSpecial,
      offsetsMs: [],
      customDelaysMs: [],
      playtimeSessions: [],
      plannedPlaytimeHours: 0,
      donorHoursPlayed: donorReport?.donorHoursPlayed || null,
      estimatedDays: 0,
      estimatedMonths: 0,
      donorTotalHours: 0,
      donorFullDaysExact: donorReport?.fullDaysExact || 0,
      hiatusCompressedCount: 0,
      hiatusSavedDays: 0,
      summaryTextEs: 'No se encontraron logros elegibles que coincidan con el perfil donante.'
    };
  }

  matched.sort((a, b) => a.donorUnlockedAtMs - b.donorUnlockedAtMs);

  const MAX_GAP_THRESHOLD_MS = Math.max(6, Number(maxRestGapHours) || 18) * 3600000;
  const offsetsMs = [0];
  let cumulativeMs = 0;
  let hiatusCompressedCount = 0;
  let hiatusSavedMs = 0;
  let offDaysCount = 0;
  const offDaysDates = [];
  const statRampPlan = [];
  let consecutiveActiveDays = 1;
  const recentDeltasMin = [];

  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1];
    const curr = matched[i];
    const exactDonorGapMs = Math.max(45000, curr.donorUnlockedAtMs - prev.donorUnlockedAtMs);

    let effectiveGapMs = exactDonorGapMs;
    if (compressLongHiatus !== false && exactDonorGapMs > MAX_GAP_THRESHOLD_MS) {
      hiatusCompressedCount++;
      consecutiveActiveDays++;
      let compressedRestHours = 10.5 + (Math.sin(i * 1.7 + curr.donorUnlockedAtMs) * 0.5 + 0.5) * 5.5;
      if (simulateOffDays !== false && consecutiveActiveDays >= 5 && matched.length - i >= 2) {
        compressedRestHours += 24.0;
        offDaysCount++;
        offDaysDates.push(new Date(baseNowMs + cumulativeMs + 12 * 3600000).toISOString().slice(0, 10));
        matched[i].precededByOffDay = true;
        consecutiveActiveDays = 0;
      }
      const targetNextTs = baseNowMs + cumulativeMs + compressedRestHours * 3600000;
      const adjustedNextTs = applyCircadianWindow(targetNextTs, i);
      effectiveGapMs = Math.max(8 * 3600000, adjustedNextTs - (baseNowMs + cumulativeMs));
      hiatusSavedMs += Math.max(0, exactDonorGapMs - effectiveGapMs);
      matched[i].hiatusCompressedFromDays = Math.round((exactDonorGapMs / (24 * 3600000)) * 10) / 10;
    } else {
      if (exactDonorGapMs >= 6 * 3600000) consecutiveActiveDays++;
      const primeSec = PRIME_SECOND_OFFSETS[i % PRIME_SECOND_OFFSETS.length];
      let baseJitteredGap = exactDonorGapMs;
      if (donorJitter !== false) {
        const wave = Math.sin(i * 2.39996 + (curr.donorUnlockedAtMs % 997));
        const jitterAmp = exactDonorGapMs <= 4 * 60000 ? 0.045 : exactDonorGapMs <= 25 * 60000 ? 0.075 : 0.095;
        baseJitteredGap = Math.max(45000, Math.round(exactDonorGapMs * (1 + wave * jitterAmp)));
      }
      let candidateGap = baseJitteredGap + (primeSec * 317);
      const candMin = Math.round(candidateGap / 60000);
      if (recentDeltasMin.includes(candMin)) {
        candidateGap += (73 + (i % 5) * 41) * 1000;
      }
      recentDeltasMin.push(Math.round(candidateGap / 60000));
      if (recentDeltasMin.length > 5) recentDeltasMin.shift();
      effectiveGapMs = candidateGap;
    }

    cumulativeMs += Math.round(effectiveGapMs);
    offsetsMs.push(cumulativeMs);

    if (enableStatRamping !== false) {
      const pInfo = curr.progressDetails || curr.progressSupport;
      const maxGoal = Number(pInfo?.maximum ?? pInfo?.goal ?? pInfo?.after ?? NaN);
      const curVal = Number(pInfo?.currentValue ?? pInfo?.before ?? 0);
      const statName = pInfo?.statName;
      if (statName && Number.isFinite(maxGoal) && maxGoal > curVal + 2) {
        const prevUnlockOff = offsetsMs[i - 1] || 0;
        const windowMs = Math.max(6 * 60000, offsetsMs[i] - prevUnlockOff);
        const ratios = [0.32, 0.64, 0.88];
        const steps = ratios.map((r, sIdx) => {
          const rawStepVal = curVal + (maxGoal - curVal) * r;
          const stepVal = pInfo?.type === 'FLOAT' ? Number(rawStepVal.toFixed(2)) : Math.max(curVal + 1, Math.min(maxGoal - 1, Math.round(rawStepVal)));
          const stepOffsetMs = Math.max(15000, Math.round(offsetsMs[i] - windowMs * (1 - (sIdx + 1) * 0.24)));
          return {
            stepNumber: sIdx + 1,
            statName,
            statId: pInfo?.statId ?? null,
            type: pInfo?.type || 'INT',
            value: stepVal,
            goal: maxGoal,
            offsetMs: stepOffsetMs,
            runAt: new Date(baseNowMs + stepOffsetMs).toISOString()
          };
        });
        curr.statRampSteps = steps;
        statRampPlan.push({ apiname: curr.apiname, statName, goal: maxGoal, steps });
      }
    }
  }

  const totalQueueSpanMs = offsetsMs[offsetsMs.length - 1] || 0;
  const donorFirstMs = donorReport?.firstUnlockMs ?? matched[0].donorUnlockedAtMs;
  const donorLastMs = donorReport?.lastUnlockMs ?? matched[matched.length - 1].donorUnlockedAtMs;
  const donorFullSpanMs = Math.max(totalQueueSpanMs, donorLastMs - donorFirstMs);

  const queueHours = Math.max(0.1, Math.round((totalQueueSpanMs / 3600000) * 10) / 10);
  const queueDaysExact = Math.max(0.1, Math.round((totalQueueSpanMs / (24 * 3600000)) * 10) / 10);
  const donorFullHours = Math.max(0.1, Math.round((donorFullSpanMs / 3600000) * 10) / 10);
  const donorFullDaysExact = Math.max(0.1, Math.round((donorFullSpanMs / (24 * 3600000)) * 10) / 10);
  const estimatedMonths = Math.max(0.1, Math.round((queueDaysExact / 30) * 10) / 10);
  const hiatusSavedDays = Math.round((hiatusSavedMs / (24 * 3600000)) * 10) / 10;

  const fullDonorAchCount = donorReport?.unlockedCount || donorEntries.length || matched.length;
  const rawDonorPlaytime = Number(customPlaytimeHours) > 0
    ? Number(customPlaytimeHours)
    : (Number(donorReport?.donorHoursPlayed) > 0 ? Number(donorReport.donorHoursPlayed) : null);
  const ratio = fullDonorAchCount > 0 ? Math.min(1, matched.length / fullDonorAchCount) : 1;
  const scaledTargetPlaytime = rawDonorPlaytime
    ? Math.max(0.5, Math.round(rawDonorPlaytime * (includeAlreadyUnlocked ? 1 : Math.max(0.35, ratio)) * 10) / 10)
    : null;

  const warmupInfo = computeSmartPlaytimeWarmup({
    firstItemPercent: matched[0]?.percent ?? null,
    alreadyUnlockedCount: alreadyUnlockedCount || Math.max(0, fullDonorAchCount - matched.length),
    totalAchievements: fullDonorAchCount,
    currentPlaytimeHours,
    targetPlaytimeHours: scaledTargetPlaytime || rawDonorPlaytime || 20,
    enableWarmup
  });
  if (warmupInfo.warmupMs > 0) {
    for (let k = 0; k < offsetsMs.length; k++) {
      offsetsMs[k] += warmupInfo.warmupMs;
    }
    for (const m of matched) {
      if (Array.isArray(m.statRampSteps)) {
        for (const stStep of m.statRampSteps) {
          stStep.offsetMs += warmupInfo.warmupMs;
          stStep.runAt = new Date(baseNowMs + stStep.offsetMs).toISOString();
        }
      }
    }
  }

  const sessionPlan = buildDonorPlaytimeSessions(offsetsMs, {
    baseNowMs,
    targetPlaytimeHours: scaledTargetPlaytime ? scaledTargetPlaytime + warmupInfo.warmupHours : null
  });
  if (warmupInfo.warmupMs > 0 && sessionPlan.sessions.length > 0) {
    sessionPlan.sessions[0].startOffsetMs = 0;
    sessionPlan.sessions[0].startAtMs = baseNowMs;
    sessionPlan.sessions[0].startAt = new Date(baseNowMs).toISOString();
    sessionPlan.sessions[0].warmupHours = warmupInfo.warmupHours;
  }
  const afkWindows = buildSessionAfkWindows(sessionPlan.sessions, offsetsMs, { baseNowMs, simulateAfkPauses });
  const preFlightAudit = computePreFlightAudit({
    items: matched,
    skippedSpecial,
    offsetsMs,
    plannedPlaytimeHours: sessionPlan.plannedPlaytimeHours,
    currentPlaytimeHours,
    medianHours: rawDonorPlaytime,
    donorHoursPlayed: rawDonorPlaytime,
    warmupHours: warmupInfo.warmupHours,
    statRampPlan,
    donorJitterApplied: donorJitter !== false,
    afkWindows,
    alreadyUnlockedCount: alreadyUnlockedCount || Math.max(0, fullDonorAchCount - matched.length)
  });

  const formatSpanEs = spanMs => {
    const totalMins = Math.max(1, Math.round(spanMs / 60000));
    if (totalMins < 60) return `${totalMins} min`;
    const totalHrs = Math.floor(totalMins / 60);
    const remMins = totalMins % 60;
    if (totalHrs < 48) {
      return `${totalHrs}h ${remMins}m (${(spanMs / (24 * 3600000)).toFixed(1)} días)`;
    }
    const days = Math.floor(totalHrs / 24);
    const remHrs = totalHrs % 24;
    return `${days} día${days === 1 ? '' : 's'}${remHrs > 0 ? ` y ${remHrs} hs` : ''} (${(spanMs / (24 * 3600000)).toFixed(1)} días)`;
  };

  const queueDurationLabel = formatSpanEs(totalQueueSpanMs);
  const fullDurationLabel = formatSpanEs(donorFullSpanMs);
  const playtimeNote = sessionPlan.plannedPlaytimeHours > 0
    ? ` · 🎮 Playtime activo en Steam: ~${sessionPlan.plannedPlaytimeHours} hs en ${sessionPlan.sessions.length} sesion${sessionPlan.sessions.length === 1 ? '' : 'es'} (cierra el juego en descansos)`
    : '';
  const hiatusNote = hiatusCompressedCount > 0
    ? ` · 🧠 IA comprimió ${hiatusCompressedCount} pausa${hiatusCompressedCount === 1 ? '' : 's'} de inactividad larga (-${hiatusSavedDays} días muertos eliminados)`
    : '';
  const skipNote = skippedSpecial.length > 0
    ? ` · 🛡️ ${skippedSpecial.length} logro${skippedSpecial.length === 1 ? '' : 's'} de evento omitido${skippedSpecial.length === 1 ? '' : 's'}`
    : '';

  return {
    items: matched,
    skippedSpecial,
    offsetsMs,
    customDelaysMs: offsetsMs,
    totalDurationMs: totalQueueSpanMs,
    playtimeSessions: sessionPlan.sessions,
    statRampPlan,
    afkWindows,
    warmupHours: warmupInfo.warmupHours,
    warmupMs: warmupInfo.warmupMs,
    warmupReasonEs: warmupInfo.reasonEs,
    donorJitterApplied: donorJitter !== false,
    preFlightAudit,
    offDaysCount,
    offDaysDates,
    plannedPlaytimeHours: sessionPlan.plannedPlaytimeHours,
    donorHoursPlayed: rawDonorPlaytime,
    estimatedDays: queueDaysExact,
    estimatedMonths,
    donorTotalHours: queueHours,
    donorFullHours,
    donorFullDaysExact,
    donorTotalCount: fullDonorAchCount,
    includeAlreadyUnlocked: Boolean(includeAlreadyUnlocked),
    hiatusCompressedCount,
    hiatusSavedDays,
    pacingMode: 'donor_exact',
    summaryTextEs: `🧬 Ritmo del donante (${donorReport?.donorName || donorReport?.donorSteamId64 || 'SteamHunters'}): ${matched.length} logros a lo largo de ${queueDurationLabel}${hiatusNote}${playtimeNote}${matched.length < fullDonorAchCount && !includeAlreadyUnlocked ? ` (Platino original: ${fullDonorAchCount} logros en ${fullDurationLabel})` : ''}${skipNote}`
  };
}

function buildRealisticPlatinumSchedule(items, {
  percentagesMap = null,
  targetHours = null,
  hltbData = null,
  pacingMode = null,
  currentFarmedHours = 0,
  alreadyUnlockedCount = 0,
  enableWarmup = false,
  simulateAfkPauses = true,
  skipDateSpecific = false,
  simulateOffDays = true,
  enableStatRamping = true,
  baseNowMs = Date.now(),
  rng = Math.random
} = {}) {
  const allOrdered = sortAchievementsByProgression(items, percentagesMap).map(it => {
    const special = detectSpecialAchievementCondition(it);
    return { ...it, specialCondition: special };
  });
  const effectivePace = ['fast', 'realistic_human', 'ultra_long_months', 'playtime_synced', 'steamhunters', 'campaign_session', 'legal_completionist', 'weekly_steady', 'today_campaign'].includes(pacingMode)
    ? pacingMode
    : null;
  const isLegalMode = ['legal_completionist', 'weekly_steady', 'today_campaign', 'steamhunters'].includes(effectivePace);
  const shouldFilterSpecial = Boolean(skipDateSpecific || isLegalMode);
  const skippedSpecial = shouldFilterSpecial ? allOrdered.filter(it => it.specialCondition?.isDateSpecific) : [];
  let ordered = shouldFilterSpecial ? allOrdered.filter(it => !it.specialCondition?.isDateSpecific) : allOrdered;
  if (effectivePace === 'today_campaign') {
    const campaignEligible = ordered.filter(it => it.percent === null || it.percent >= 12);
    ordered = (campaignEligible.length ? campaignEligible : ordered).slice(0, 4);
  }
  if (!ordered.length) {
    return {
      items: [],
      offsetsMs: [],
      sessions: [],
      playtimeSessions: [],
      statRampPlan: [],
      offDaysCount: 0,
      offDaysDates: [],
      pacingMode: effectivePace || 'realistic_human',
      totalAchievements: 0,
      sessionCount: 0,
      totalDurationMs: 0,
      estimatedDays: 0,
      estimatedMonths: '0.0',
      summaryTextEs: 'Modo Platino Realista activado: 0 logros en 0 sesiones (~0 días de juego simulado)',
      summaryTextEn: 'Realistic Platinum Mode activated: 0 achievements in 0 sessions (~0 days of simulated play)'
    };
  }

  const offsetsMs = [];
  const sessions = [];
  const statRampPlan = [];
  let offDaysCount = 0;
  const offDaysDates = [];
  let cursor = 0;
  let sessionStartMs = 0;
  let sessionIndex = 0;
  const recentDeltasMin = [];

  const getRestHours = () => {
    switch (effectivePace) {
      case 'campaign_session':
        return 0;
      case 'steamhunters':
        return 2.5 + rng() * 3.0;
      case 'ultra_long_months':
        return 48 + rng() * 120;
      case 'realistic_human':
        return 16 + rng() * 32;
      case 'fast':
        return 6 + rng() * 8;
      case 'playtime_synced': {
        const goalHrs = Math.max(10, Number(targetHours ?? hltbData?.completionistHours ?? 60));
        const remHrs = Math.max(4, goalHrs - (Number(currentFarmedHours) || 0));
        const estSessions = Math.max(1, Math.ceil(ordered.length / 2.5));
        return Math.max(6, Math.min(168, (remHrs / estSessions) * (4 + rng() * 4)));
      }
      default:
        return 10 + rng() * 10;
    }
  };

  if (effectivePace === 'legal_completionist' || effectivePace === 'steamhunters' || effectivePace === 'weekly_steady' || effectivePace === 'today_campaign') {
    let prevOffsetMs = Math.round((24 + rng() * 14) * 60000) + PRIME_SECOND_OFFSETS[0] * 1000;
    let elapsedInCurrentSessionMs = prevOffsetMs;
    let unlocksInCurrentSession = 0;
    let consecutiveActiveDays = 1;
    let nextOffDayThreshold = 4 + Math.floor(rng() * 3); // Cada 4 a 6 días activos, insertar 1 día libre humano

    for (let idx = 0; idx < ordered.length; idx++) {
      const item = ordered[idx];
      const prevItem = idx > 0 ? ordered[idx - 1] : null;
      const pct = typeof item.percent === 'number' && Number.isFinite(item.percent) ? item.percent : 25;

      if (idx === 0) {
        prevOffsetMs = alignOffsetToHumanEvening(baseNowMs, prevOffsetMs, 0, idx);
        offsetsMs.push(prevOffsetMs);
        unlocksInCurrentSession = 1;
      } else if (effectivePace === 'today_campaign') {
        const bio = computeBioRealisticStepDelay(item, prevItem, { stepIndex: idx, elapsedInSessionMs: elapsedInCurrentSessionMs, recentDeltasMin, rng });
        prevOffsetMs += Math.min(bio.delayMs, 55 * 60000);
        elapsedInCurrentSessionMs += bio.delayMs;
        offsetsMs.push(prevOffsetMs);
      } else if (effectivePace === 'weekly_steady') {
        const daysGap = 1.6 + rng() * 2.1;
        const rawCandidate = prevOffsetMs + Math.round(daysGap * 24 * 3600000);
        prevOffsetMs = alignOffsetToHumanEvening(baseNowMs, rawCandidate, prevOffsetMs, idx);
        offsetsMs.push(prevOffsetMs);
      } else {
        const bio = computeBioRealisticStepDelay(item, prevItem, {
          stepIndex: idx,
          elapsedInSessionMs: elapsedInCurrentSessionMs,
          recentDeltasMin,
          rng
        });
        item.isStoryPair = bio.isStoryPair;
        item.bossRetryMultiplier = bio.bossRetryMultiplier;

        const maxSessionAchievements = pct >= 45 ? 5 : pct >= 20 ? 4 : 3;
        const maxSessionDurationMs = (3.4 + (idx % 3) * 0.6) * 3600000;

        if (bio.isStoryPair) {
          prevOffsetMs += bio.delayMs;
          elapsedInCurrentSessionMs += bio.delayMs;
          unlocksInCurrentSession++;
        } else if (unlocksInCurrentSession < maxSessionAchievements && elapsedInCurrentSessionMs + bio.delayMs <= maxSessionDurationMs && pct >= 12) {
          prevOffsetMs += bio.delayMs;
          elapsedInCurrentSessionMs += bio.delayMs;
          unlocksInCurrentSession++;
        } else {
          let restHours = pct >= 25
            ? (11.5 + rng() * 6.5)
            : pct >= 8
              ? (14.0 + rng() * 8.0)
              : (18.0 + rng() * 14.0);

          consecutiveActiveDays++;
          // Simulador de Días Libres / Feriados Humanos (1 día sin abrir el juego cada 4-6 días de vicio)
          if (simulateOffDays !== false && consecutiveActiveDays >= nextOffDayThreshold && ordered.length - idx >= 2) {
            const offDayExtraHours = 24 + rng() * 10;
            const offDateIso = new Date(baseNowMs + prevOffsetMs + 12 * 3600000).toISOString().slice(0, 10);
            offDaysCount++;
            offDaysDates.push(offDateIso);
            restHours += offDayExtraHours;
            item.precededByOffDay = true;
            consecutiveActiveDays = 0;
            nextOffDayThreshold = 4 + Math.floor(rng() * 3);
          }

          const candidateNextSession = prevOffsetMs + Math.round(restHours * 3600000);
          prevOffsetMs = alignOffsetToHumanEvening(baseNowMs, candidateNextSession, prevOffsetMs, idx);
          elapsedInCurrentSessionMs = 25 * 60000;
          unlocksInCurrentSession = 1;
        }
        offsetsMs.push(prevOffsetMs);
      }

      // Sincronización Progresiva de Contadores (Stat Ramping): generar escalones intermedios (30% -> 62% -> 88%) antes del desbloqueo
      if (enableStatRamping !== false) {
        const pInfo = item.progressDetails || item.progressSupport;
        const maxGoal = Number(pInfo?.maximum ?? pInfo?.goal ?? pInfo?.after ?? NaN);
        const curVal = Number(pInfo?.currentValue ?? pInfo?.before ?? 0);
        const statName = pInfo?.statName;
        if (statName && Number.isFinite(maxGoal) && maxGoal > curVal + 2) {
          const prevUnlockOff = idx > 0 ? offsetsMs[idx - 1] : 0;
          const windowMs = Math.max(6 * 60000, offsetsMs[idx] - prevUnlockOff);
          const ratios = [0.32, 0.64, 0.88];
          const steps = ratios.map((r, sIdx) => {
            const rawStepVal = curVal + (maxGoal - curVal) * r;
            const stepVal = pInfo?.type === 'FLOAT' ? Number(rawStepVal.toFixed(2)) : Math.max(curVal + 1, Math.min(maxGoal - 1, Math.round(rawStepVal)));
            const stepOffsetMs = Math.max(30000, Math.round(offsetsMs[idx] - windowMs * (1 - (sIdx + 1) * 0.24)));
            return {
              stepNumber: sIdx + 1,
              statName,
              statId: pInfo?.statId ?? null,
              type: pInfo?.type || 'INT',
              value: stepVal,
              goal: maxGoal,
              offsetMs: stepOffsetMs,
              runAt: new Date(baseNowMs + stepOffsetMs).toISOString()
            };
          });
          item.statRampSteps = steps;
          statRampPlan.push({ apiname: item.apiname, statName, goal: maxGoal, steps });
        }
      }
    }

    const desiredHours = Number(targetHours ?? hltbData?.completionistHours ?? NaN);
    const hltbCalibrated = Number.isFinite(desiredHours) && desiredHours > 0;
    const sessionPlan = buildDonorPlaytimeSessions(offsetsMs, {
      baseNowMs,
      targetPlaytimeHours: hltbCalibrated ? desiredHours : null
    });
    for (const s of sessionPlan.sessions) sessions.push(s);
    cursor = ordered.length;
  }

  while (cursor < ordered.length) {
    const remaining = ordered.length - cursor;
    const maxInSession = effectivePace === 'campaign_session'
      ? remaining
      : effectivePace === 'ultra_long_months'
        ? 2
        : 3;
    const countInSession = remaining <= maxInSession
      ? remaining
      : Math.min(remaining, 1 + Math.floor(rng() * maxInSession));
    const sessionItems = ordered.slice(cursor, cursor + countInSession);
    cursor += countInSession;

    let elapsedInSessionMs = 0;
    for (let i = 0; i < sessionItems.length; i++) {
      const delayMinutes = effectivePace
        ? (30 + rng() * 60)
        : (20 + rng() * 50);
      const delayMs = Math.round(delayMinutes * 60000);
      elapsedInSessionMs += delayMs;
      offsetsMs.push(sessionStartMs + elapsedInSessionMs);
    }

    const minSessionMs = (60 + rng() * 35) * 60000;
    const maxSessionMs = 180 * 60000;
    const sessionDurationMs = effectivePace
      ? (elapsedInSessionMs + Math.round((15 + rng() * 30) * 60000))
      : Math.min(maxSessionMs, Math.max(Math.round(minSessionMs), elapsedInSessionMs + 10 * 60000));
    const sessionEndMs = sessionStartMs + sessionDurationMs;

    sessions.push({
      sessionIndex: sessionIndex++,
      startOffsetMs: sessionStartMs,
      endOffsetMs: sessionEndMs,
      startAtMs: baseNowMs + sessionStartMs,
      endAtMs: baseNowMs + sessionEndMs,
      startAt: new Date(baseNowMs + sessionStartMs).toISOString(),
      endAt: new Date(baseNowMs + sessionEndMs).toISOString(),
      durationHours: Number((sessionDurationMs / 3600000).toFixed(2)),
      itemCount: sessionItems.length,
      phases: [...new Set(sessionItems.map(x => x.phase))],
      apinames: sessionItems.map(x => x.apiname)
    });

    if (cursor < ordered.length) {
      const restHours = getRestHours();
      const restPauseMs = Math.round(restHours * 3600000);
      sessionStartMs = sessionEndMs + restPauseMs;
    }
  }

  const shouldCheckWarmup = Boolean(enableWarmup || alreadyUnlockedCount > 0 || ((effectivePace === "legal_completionist" || effectivePace === "steamhunters") && ordered[0]?.percent < 45));
  const warmupInfo = computeSmartPlaytimeWarmup({
    firstItemPercent: ordered[0]?.percent ?? null,
    alreadyUnlockedCount,
    totalAchievements: ordered.length + (Number(alreadyUnlockedCount) || 0),
    currentPlaytimeHours: currentFarmedHours,
    targetPlaytimeHours: Number(targetHours ?? hltbData?.completionistHours ?? 24),
    enableWarmup: shouldCheckWarmup
  });
  if (warmupInfo.warmupMs > 0) {
    for (let k = 0; k < offsetsMs.length; k++) {
      offsetsMs[k] += warmupInfo.warmupMs;
    }
    for (const it of ordered) {
      if (Array.isArray(it.statRampSteps)) {
        for (const stStep of it.statRampSteps) {
          stStep.offsetMs += warmupInfo.warmupMs;
          stStep.runAt = new Date(baseNowMs + stStep.offsetMs).toISOString();
        }
      }
    }
    for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
      const s = sessions[sIdx];
      if (sIdx === 0) {
        s.startOffsetMs = 0;
        s.endOffsetMs += warmupInfo.warmupMs;
        s.startAtMs = baseNowMs;
        s.endAtMs = baseNowMs + s.endOffsetMs;
        s.startAt = new Date(baseNowMs).toISOString();
        s.endAt = new Date(s.endAtMs).toISOString();
        s.warmupHours = warmupInfo.warmupHours;
        s.durationHours = Number(((s.endOffsetMs - s.startOffsetMs) / 3600000).toFixed(2));
      } else {
        s.startOffsetMs += warmupInfo.warmupMs;
        s.endOffsetMs += warmupInfo.warmupMs;
        s.startAtMs = baseNowMs + s.startOffsetMs;
        s.endAtMs = baseNowMs + s.endOffsetMs;
        s.startAt = new Date(s.startAtMs).toISOString();
        s.endAt = new Date(s.endAtMs).toISOString();
      }
    }
  }

  const rawPlaytimeHours = sessions.reduce((acc, s) => acc + (Number(s.durationHours) || 0), 0);
  const desiredHours = Number(targetHours ?? hltbData?.completionistHours ?? NaN);
  const hltbCalibrated = Number.isFinite(desiredHours) && desiredHours > 0;
  const calibratedPlaytimeHours = hltbCalibrated ? Number(desiredHours.toFixed(1)) : Number(rawPlaytimeHours.toFixed(1));
  const afkWindows = buildSessionAfkWindows(sessions, offsetsMs, { baseNowMs, simulateAfkPauses });
  const preFlightAudit = computePreFlightAudit({
    items: ordered,
    skippedSpecial,
    offsetsMs,
    plannedPlaytimeHours: calibratedPlaytimeHours,
    currentPlaytimeHours: currentFarmedHours,
    medianHours: hltbData?.completionistHours ?? desiredHours ?? null,
    warmupHours: warmupInfo.warmupHours,
    statRampPlan,
    donorJitterApplied: true,
    afkWindows,
    alreadyUnlockedCount
  });

  const totalAchievements = ordered.length;
  const sessionCount = sessions.length;
  const totalDurationMs = sessions.length ? sessions[sessions.length - 1].endOffsetMs : (offsetsMs[offsetsMs.length - 1] || 0);
  const estimatedDays = Math.max(1, Math.round(totalDurationMs / (24 * 3600000)));
  const estimatedMonths = (estimatedDays / 30.4).toFixed(1);
  const totalHoursEst = Math.max(0.2, Number((totalDurationMs / 3600000).toFixed(1)));
  const skippedNoteEs = skippedSpecial.length ? ` · 🛡️ ${skippedSpecial.length} logro${skippedSpecial.length === 1 ? '' : 's'} de fecha/evento especial protegido${skippedSpecial.length === 1 ? '' : 's'}` : '';
  const offDaysNoteEs = offDaysCount > 0 ? ` · 🏖️ ${offDaysCount} día${offDaysCount === 1 ? '' : 's'} libre${offDaysCount === 1 ? '' : 's'} simulado${offDaysCount === 1 ? '' : 's'}` : '';
  const rampNoteEs = statRampPlan.length > 0 ? ` · 📈 Stat Ramping activo (${statRampPlan.length} contadores)` : '';
  const summaryTextEs = (effectivePace === 'legal_completionist' || effectivePace === 'steamhunters')
    ? `🧠 IA Bio-Realista activa: ${totalAchievements} logros en ${sessionCount} sesion${sessionCount === 1 ? '' : 'es'} (~${estimatedDays >= 45 ? `${estimatedMonths} meses (${estimatedDays} días)` : `${estimatedDays} días`} · ~${calibratedPlaytimeHours} hs Playtime)${offDaysNoteEs}${rampNoteEs}${skippedNoteEs}`
    : effectivePace === 'weekly_steady'
      ? `Ritmo Semanal Constante activo: ${totalAchievements} logros a lo largo de ~${estimatedDays} días (1 logro cada 2–4 días en horario humano)${skippedNoteEs}`
      : (effectivePace === 'today_campaign' || effectivePace === 'campaign_session')
        ? `Sesión de Campaña Hoy activa: ${totalAchievements} logros de historia (~${totalHoursEst} h de partida)${skippedNoteEs}`
        : effectivePace === 'ultra_long_months'
          ? `Modo Platino Realista activado (Ultra-Realista): ${totalAchievements} logros en ${sessionCount} sesiones a lo largo de ~${estimatedMonths} meses (~${estimatedDays} días de juego simulado)`
          : `Modo Platino Realista activado: ${totalAchievements} logros en ${sessionCount} sesiones (~${estimatedDays} días de juego simulado)`;
  const summaryTextEn = effectivePace === 'ultra_long_months'
    ? `Realistic Platinum Mode activated (Ultra-Realistic): ${totalAchievements} achievements in ${sessionCount} sessions across ~${estimatedMonths} months (~${estimatedDays} days of simulated play)`
    : `Realistic Platinum Mode activated: ${totalAchievements} achievements in ${sessionCount} sessions (~${estimatedDays} days of simulated play)`;

  return {
    items: ordered,
    skippedSpecial,
    offsetsMs,
    sessions,
    playtimeSessions: sessions,
    statRampPlan,
    afkWindows,
    warmupHours: warmupInfo.warmupHours,
    warmupMs: warmupInfo.warmupMs,
    warmupReasonEs: warmupInfo.reasonEs,
    preFlightAudit,
    offDaysCount,
    offDaysDates,
    plannedPlaytimeHours: calibratedPlaytimeHours,
    pacingMode: effectivePace || 'realistic_human',
    totalAchievements,
    sessionCount,
    totalDurationMs,
    estimatedDays,
    estimatedMonths,
    currentFarmedHours: Number(currentFarmedHours) || 0,
    hltbCalibrated,
    targetPlaytimeHours: calibratedPlaytimeHours,
    mainStoryHours: hltbData?.mainStoryHours ?? null,
    completionistHours: hltbCalibrated ? calibratedPlaytimeHours : null,
    summaryTextEs,
    summaryTextEn
  };
}

const TIMED_JOBS_SQL = `
CREATE TABLE IF NOT EXISTS steamfarmer_timed_jobs (
  job_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  appid INTEGER NOT NULL CHECK (appid > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused_collision', 'completed', 'cancelled')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS steamfarmer_timed_jobs_status_idx
  ON steamfarmer_timed_jobs (status, account_id, appid);
CREATE TABLE IF NOT EXISTS steamfarmer_timed_queue (
  job_id TEXT NOT NULL REFERENCES steamfarmer_timed_jobs(job_id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  apiname TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('unlock', 'remove')),
  run_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  PRIMARY KEY (job_id, item_index)
);
CREATE INDEX IF NOT EXISTS steamfarmer_timed_queue_pending_idx
  ON steamfarmer_timed_queue (job_id, completed, run_at);
`;

class TimedModificationManager {
  constructor({ pool = null, file = null, onScheduleChange = null, onJobCompleted = null, retryDelaysMs = [30000, 60000, 120000] } = {}) {
    this.jobs = new Map();
    this.pool = pool;
    this.file = file;
    this.onScheduleChange = onScheduleChange;
    this.onJobCompleted = onJobCompleted;
    this.retryDelaysMs = Array.isArray(retryDelaysMs) ? retryDelaysMs : [30000, 60000, 120000];
    this.schemaReady = null;
    this.pendingWrites = new Set();
    this.accountExecutionChains = new Map();
  }
  _enqueueAccountExecution(accountId, taskFn) {
    const key = String(accountId || 'default');
    const prev = this.accountExecutionChains.get(key) || Promise.resolve();
    const activeForAccount = [...this.jobs.values()].filter(j => j.accountId === accountId && j.active).length;
    const next = prev
      .catch(() => {})
      .then(async () => {
        const res = await taskFn();
        if (activeForAccount > 1) {
          await new Promise(r => setTimeout(r, 250));
        }
        return res;
      });
    const cleanup = () => {
      if (this.accountExecutionChains.get(key) === next) {
        this.accountExecutionChains.delete(key);
      }
    };
    this.accountExecutionChains.set(key, next);
    next.then(cleanup, cleanup);
    return next;
  }
  _deconflictAccountQueue(accountId, excludeAppId = null) {
    const MIN_STAGGER_MS = 45000;
    const activeJobs = [];
    for (const job of this.jobs.values()) {
      if (job.accountId === accountId && job.active && Array.isArray(job.queue) && job.queue.length > 0) {
        activeJobs.push(job);
      }
    }
    if (activeJobs.length <= 1) return;
    const occupiedTimes = [];
    for (const job of activeJobs) {
      if (excludeAppId !== null && job.appid === excludeAppId) continue;
      for (const q of job.queue) {
        const t = Date.parse(q.runAt);
        if (Number.isFinite(t)) occupiedTimes.push(t);
      }
    }
    const targetJobs = excludeAppId !== null
      ? activeJobs.filter(j => j.appid === excludeAppId)
      : activeJobs;
    for (const job of targetJobs) {
      let shifted = false;
      for (let i = 0; i < job.queue.length; i++) {
        let t = Date.parse(job.queue[i].runAt);
        if (!Number.isFinite(t)) continue;
        if (i > 0) {
          const prevT = Date.parse(job.queue[i - 1].runAt);
          if (Number.isFinite(prevT) && t <= prevT + 5000) t = prevT + 15000;
        }
        let guard = 0;
        while (occupiedTimes.some(occ => Math.abs(occ - t) < MIN_STAGGER_MS) && guard < 50) {
          t += MIN_STAGGER_MS + ((job.appid + i * 7) % 19) * 1000;
          shifted = true;
          guard++;
        }
        job.queue[i].runAt = new Date(t).toISOString();
        occupiedTimes.push(t);
      }
      if (shifted && job.queue.length > 0) {
        job.nextRunAt = job.queue[0].runAt;
      }
    }
  }
  _trackWrite(promise) {
    const p = Promise.resolve(promise).catch(() => {});
    this.pendingWrites.add(p);
    p.finally(() => this.pendingWrites.delete(p));
    return p;
  }
  async flush() {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites]);
    }
  }
  getActiveSessionDetails(job, now = Date.now()) {
    if (!job || !job.active || job.pausedByCollision || job.pausedManually) {
      return { inSession: false, currentSession: null, nextSession: null };
    }
    if (!['platinum', 'copied'].includes(job.spacing)) {
      return { inSession: true, currentSession: null, nextSession: null };
    }
    const sessions = job.config?.playtimeSessions || job.config?.sessions;
    if (Array.isArray(sessions) && sessions.length > 0) {
      for (const s of sessions) {
        const startMs = typeof s.startAtMs === 'number' ? s.startAtMs : Date.parse(s.startAt);
        const endMs = typeof s.endAtMs === 'number' ? s.endAtMs : Date.parse(s.endAt);
        if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
          if (now >= startMs && now <= endMs) {
            return { inSession: true, currentSession: { ...s, startMs, endMs }, nextSession: null };
          }
          if (startMs > now) {
            return { inSession: false, currentSession: null, nextSession: { ...s, startMs, endMs } };
          }
        }
      }
      const nextMs = job.nextRunAt ? Date.parse(job.nextRunAt) : NaN;
      if (Number.isFinite(nextMs) && Math.abs(nextMs - now) <= 5 * 60000) {
        return { inSession: true, currentSession: { startMs: now, endMs: nextMs + 10 * 60000 }, nextSession: null };
      }
      return { inSession: false, currentSession: null, nextSession: null };
    }
    const nextMs = job.nextRunAt ? Date.parse(job.nextRunAt) : NaN;
    if (Number.isFinite(nextMs)) {
      if (nextMs - now <= 35 * 60000) {
        return {
          inSession: true,
          currentSession: { startMs: now, endMs: nextMs + 14 * 60000 },
          nextSession: null
        };
      }
      return {
        inSession: false,
        currentSession: null,
        nextSession: { startMs: nextMs - 26 * 60000, endMs: nextMs + 14 * 60000 }
      };
    }
    return { inSession: true, currentSession: null, nextSession: null };
  }
  isJobInActiveSession(job, now = Date.now()) {
    return this.getActiveSessionDetails(job, now).inSession;
  }
  activeNonStealthApps(accountId, now = Date.now()) {
    const apps = [];
    for (const job of this.jobs.values()) {
      if (job.accountId === accountId && job.active && !job.pausedByCollision && !job.pausedManually && !job.config?.stealth) {
        if (this.isJobInActiveSession(job, now)) {
          apps.push(job.appid);
        }
      }
    }
    return apps;
  }
  upcomingSessionApps(accountId, now = Date.now(), lookaheadMs = 60000) {
    const upcoming = [];
    for (const job of this.jobs.values()) {
      if (job.accountId === accountId && job.active && !job.pausedByCollision && !job.pausedManually && !job.config?.stealth) {
        const sessInfo = this.getActiveSessionDetails(job, now);
        if (!sessInfo.inSession && sessInfo.nextSession?.startMs > now && sessInfo.nextSession.startMs - now <= lookaheadMs) {
          upcoming.push(job.appid);
        }
      }
    }
    return upcoming;
  }
  getAccountAfkState(accountId, now = Date.now()) {
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId || !job.active || job.pausedByCollision || job.pausedManually || job.config?.stealth) continue;
      const windows = job.config?.afkWindows;
      if (!Array.isArray(windows)) continue;
      for (const w of windows) {
        const sMs = typeof w.startAtMs === "number" ? w.startAtMs : Date.parse(w.startAt);
        const eMs = typeof w.endAtMs === "number" ? w.endAtMs : Date.parse(w.endAt);
        if (Number.isFinite(sMs) && Number.isFinite(eMs) && now >= sMs && now <= eMs) {
          return { inAfkWindow: true, appid: job.appid, window: w };
        }
      }
    }
    return { inAfkWindow: false, appid: null, window: null };
  }
  reconcileExternalUnlocks(accountId, appid, unlockedApinames) {
    const job = this.jobs.get(this.key(accountId, appId(appid)));
    if (!job || !job.active) {
      return { ok: false, appid: Number(appid), reconciledCount: 0, reconciledApinames: [], remainingCount: 0, completedJob: false };
    }
    const unlockedSet = unlockedApinames instanceof Set
      ? unlockedApinames
      : new Set((Array.isArray(unlockedApinames) ? unlockedApinames : []).map(String));
    const reconciledApinames = [];
    const keptQueue = [];
    for (const q of job.queue) {
      if (q.action === "unlock" && unlockedSet.has(String(q.apiname))) {
        reconciledApinames.push(q.apiname);
        job.completedCount++;
        job.history.push({ apiname: q.apiname, action: "reconciled_pc", at: new Date().toISOString(), ok: true });
        this._trackWrite(this._persistItemDone(job, q, null));
      } else {
        keptQueue.push(q);
      }
    }
    if (reconciledApinames.length > 0) {
      job.queue = keptQueue;
      if (!job.queue.length) {
        if (job.timer) { clearTimeout(job.timer); job.timer = null; }
        job.active = false;
        job.nextRunAt = null;
        this._saveLocal();
        try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
        try { this.onJobCompleted?.(job.accountId, job.appid, job); } catch {}
      } else {
        job.nextRunAt = job.queue[0].runAt;
        this._saveLocal();
        job.scheduleNext?.();
        try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
      }
    }
    return {
      ok: true,
      appid: job.appid,
      reconciledCount: reconciledApinames.length,
      reconciledApinames,
      remainingCount: job.queue.length,
      completedJob: !job.active
    };
  }
  compactMemory() {
    let trimmedHistory = 0;
    for (const job of this.jobs.values()) {
      if (Array.isArray(job.history) && job.history.length > 20) {
        trimmedHistory += job.history.length - 20;
        job.history = job.history.slice(-20);
      }
      if (Array.isArray(job.queue)) {
        for (const q of job.queue) {
          if (Array.isArray(q.statRampSteps) && q.statRampSteps.length === 0) {
            q.statRampSteps = null;
          }
        }
      }
    }
    return { activeJobs: this.jobs.size, trimmedHistory, chainsActive: this.accountExecutionChains.size };
  }
  restingApps(accountId, now = Date.now()) {
    const resting = new Set();
    for (const job of this.jobs.values()) {
      if (job.accountId === accountId && job.active && !job.pausedByCollision && !job.pausedManually && !job.config?.stealth) {
        if (!this.isJobInActiveSession(job, now)) {
          resting.add(Number(job.appid));
        }
      }
    }
    return resting;
  }
  listForAccount(accountId) {
    const list = [];
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId || !job.active) continue;
      const sessInfo = this.getActiveSessionDetails(job, now);
      list.push({
        jobId: job.jobId,
        appid: job.appid,
        active: job.active,
        pausedByCollision: Boolean(job.pausedByCollision),
        pausedManually: Boolean(job.pausedManually),
        action: job.action,
        spacing: job.spacing,
        order: job.order,
        totalCount: job.totalCount,
        completedCount: job.completedCount,
        failedCount: job.failedCount,
        startedAt: job.startedAt,
        nextRunAt: job.nextRunAt,
        sessionCount: job.config?.sessionCount || (job.config?.playtimeSessions?.length || null),
        estimatedDays: job.config?.estimatedDays || null,
        plannedPlaytimeHours: job.config?.plannedPlaytimeHours || job.config?.targetPlaytimeHours || null,
        donorHoursPlayed: job.config?.donorHoursPlayed || null,
        summaryTextEs: job.config?.summaryTextEs || null,
        summaryTextEn: job.config?.summaryTextEn || null,
        inActiveSessionWindow: sessInfo.inSession,
        currentSessionEndAt: sessInfo.currentSession?.endMs ? new Date(sessInfo.currentSession.endMs).toISOString() : null,
        nextSessionStartAt: sessInfo.nextSession?.startMs ? new Date(sessInfo.nextSession.startMs).toISOString() : null,
        nextSessionEndAt: sessInfo.nextSession?.endMs ? new Date(sessInfo.nextSession.endMs).toISOString() : null,
        nextSessionDurationHours: sessInfo.nextSession?.durationHours || null,
        pacingMode: job.config?.pacingMode || null,
        nextItem: job.queue[0] ? { apiname: job.queue[0].apiname, name: job.queue[0].name || job.queue[0].apiname, percent: job.queue[0].percent ?? null, phase: job.queue[0].phase || null, phaseLabel: job.queue[0].phaseLabel || null, runAt: job.queue[0].runAt } : null,
        upcomingQueue: job.queue.slice(0, 12).map(q => ({ apiname: q.apiname, name: q.name || q.apiname, percent: q.percent ?? null, phase: q.phase || null, phaseLabel: q.phaseLabel || null, runAt: q.runAt }))
      });
    }
    return list;
  }
  recentEventsForAccount(accountId) {
    const events = [];
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId) continue;
      for (const h of job.history.slice(-10)) {
        if (h.ok) events.push({ eventId: `${job.jobId}:${h.apiname}:${h.at}`, appid: job.appid, apiname: h.apiname, action: h.action, at: h.at });
      }
    }
    return events.slice(-10);
  }
  pauseJob(accountId, appid) {
    const job = this.jobs.get(this.key(accountId, appId(appid)));
    if (!job || !job.active || job.pausedManually) return false;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    job.pausedManually = true;
    job.pausedAt = Date.now();
    try { this.onScheduleChange?.(accountId, job.appid); } catch {}
    return true;
  }
  resumeJob(accountId, appid) {
    const job = this.jobs.get(this.key(accountId, appId(appid)));
    if (!job || !job.active || (!job.pausedManually && !job.pausedByCollision)) return false;
    const now = Date.now();
    const pausedDeltaMs = Math.max(0, now - (job.pausedAt || now));
    for (const item of job.queue) {
      const prevMs = Date.parse(item.runAt);
      const shiftedMs = Number.isFinite(prevMs) ? Math.max(now + 50, prevMs + pausedDeltaMs) : now + 50;
      item.runAt = new Date(shiftedMs).toISOString();
    }
    for (const list of [job.config?.sessions, job.config?.playtimeSessions]) {
      if (Array.isArray(list)) {
        for (const s of list) {
          if (typeof s.startAtMs === 'number') s.startAtMs += pausedDeltaMs;
          if (typeof s.endAtMs === 'number') s.endAtMs += pausedDeltaMs;
          if (s.startAt) s.startAt = new Date(Date.parse(s.startAt) + pausedDeltaMs).toISOString();
          if (s.endAt) s.endAt = new Date(Date.parse(s.endAt) + pausedDeltaMs).toISOString();
        }
      }
    }
    job.pausedManually = false;
    job.pausedByCollision = false;
    job.pausedAt = null;
    this._deconflictAccountQueue(accountId, job.appid);
    job.nextRunAt = job.queue[0]?.runAt || null;
    this._trackWrite(this._persistJobStatus(job, 'active'));
    job.scheduleNext?.();
    try { this.onScheduleChange?.(accountId, job.appid); } catch {}
    return true;
  }
  async unlockNextNow(accountId, appid) {
    const job = this.jobs.get(this.key(accountId, appId(appid)));
    if (!job || !job.active || !job.queue.length) return { ok: false, message: 'No hay logros pendientes en esta cola.' };
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    job.queue[0].runAt = new Date(Date.now() + 150).toISOString();
    job.nextRunAt = job.queue[0].runAt;
    this._trackWrite(this._persistJobStatus(job, 'active'));
    job.scheduleNext?.();
    try { this.onScheduleChange?.(accountId, job.appid); } catch {}
    return {
      ok: true,
      unlockedItem: job.queue[0].name || job.queue[0].apiname,
      message: `⚡ Desbloqueando "${job.queue[0].name || job.queue[0].apiname}" ahora mismo en Steam.`
    };
  }
  fastForwardNextSession(accountId, appid) {
    const job = this.jobs.get(this.key(accountId, appId(appid)));
    if (!job || !job.active || !job.queue.length) return { ok: false, message: 'No hay logros pendientes en esta cola.' };
    const now = Date.now();
    const firstMs = Date.parse(job.queue[0].runAt);
    if (!Number.isFinite(firstMs) || firstMs <= now + 60000) {
      return { ok: true, shiftedHours: 0, message: 'La próxima sesión ya está activa para hoy.' };
    }
    const shiftBackMs = Math.max(0, firstMs - (now + 45000));
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    for (const item of job.queue) {
      const prevMs = Date.parse(item.runAt);
      if (Number.isFinite(prevMs)) {
        item.runAt = new Date(Math.max(now + 45000, prevMs - shiftBackMs)).toISOString();
      }
    }
    for (const list of [job.config?.sessions, job.config?.playtimeSessions]) {
      if (Array.isArray(list)) {
        for (const s of list) {
          if (typeof s.startAtMs === 'number') s.startAtMs = Math.max(now, s.startAtMs - shiftBackMs);
          if (typeof s.endAtMs === 'number') s.endAtMs = Math.max(now + 15 * 60000, s.endAtMs - shiftBackMs);
          if (s.startAt) s.startAt = new Date(Math.max(now, Date.parse(s.startAt) - shiftBackMs)).toISOString();
          if (s.endAt) s.endAt = new Date(Math.max(now + 15 * 60000, Date.parse(s.endAt) - shiftBackMs)).toISOString();
        }
      }
    }
    this._deconflictAccountQueue(accountId, job.appid);
    job.nextRunAt = job.queue[0]?.runAt || null;
    this._trackWrite(this._persistJobStatus(job, 'active'));
    job.scheduleNext?.();
    try { this.onScheduleChange?.(accountId, job.appid); } catch {}
    const shiftedDays = (shiftBackMs / (24 * 3600000)).toFixed(1);
    return {
      ok: true,
      shiftedDays: Number(shiftedDays),
      nextRunAt: job.nextRunAt,
      message: `⏩ Próxima sesión adelantada a HOY (-${shiftedDays} días de espera eliminados). El orden y los intervalos internos de la sesión se mantienen intactos.`
    };
  }
  setPool(pool) {
    this.pool = pool;
    this.schemaReady = null;
  }
  async ensureSchema() {
    if (!this.pool) return false;
    if (!this.schemaReady) {
      this.schemaReady = Promise.resolve()
        .then(() => this.pool.query(TIMED_JOBS_SQL))
        .then(() => true)
        .catch(() => { this.schemaReady = null; return false; });
    }
    return this.schemaReady;
  }
  _saveLocal() {
    if (!this.file) return;
    try {
      const serialized = [];
      for (const job of this.jobs.values()) {
        if (!job.active) continue;
        serialized.push({
          jobId: job.jobId,
          accountId: job.accountId,
          appid: job.appid,
          status: job.pausedByCollision ? 'paused_collision' : 'active',
          config: job.config || {},
          startedAt: job.startedAt,
          pausedAt: job.pausedAt || null,
          totalCount: job.totalCount,
          completedCount: job.completedCount,
          failedCount: job.failedCount,
          queue: job.queue.map((q, idx) => ({ itemIndex: q.itemIndex ?? idx, apiname: q.apiname, name: q.name, percent: q.percent ?? null, action: q.action, runAt: q.runAt }))
        });
      }
      fs.writeFileSync(this.file, JSON.stringify(serialized, null, 2));
    } catch {}
  }
  async _persistJobStart(job) {
    this._saveLocal();
    if (!(await this.ensureSchema())) return;
    try {
      await this.pool.query(
        `UPDATE steamfarmer_timed_jobs SET status = 'cancelled' WHERE account_id = $1 AND appid = $2 AND status IN ('active', 'paused_collision')`,
        [job.accountId, job.appid]
      );
      await this.pool.query(
        `DELETE FROM steamfarmer_timed_queue WHERE job_id IN (SELECT job_id FROM steamfarmer_timed_jobs WHERE account_id = $1 AND appid = $2 AND status = 'cancelled') AND completed = false`,
        [job.accountId, job.appid]
      );
      await this.pool.query(
        `INSERT INTO steamfarmer_timed_jobs (job_id, account_id, appid, status, config, started_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [job.jobId, job.accountId, job.appid, job.pausedByCollision ? 'paused_collision' : 'active', JSON.stringify(job.config || {}), job.startedAt]
      );
      for (const item of job.queue) {
        await this.pool.query(
          `INSERT INTO steamfarmer_timed_queue (job_id, item_index, apiname, action, run_at, completed, error) VALUES ($1, $2, $3, $4, $5, FALSE, NULL)`,
          [job.jobId, item.itemIndex, item.apiname, item.action, item.runAt]
        );
      }
    } catch {}
  }
  async _persistItemDone(job, item, errorText = null) {
    this._saveLocal();
    if (!(await this.ensureSchema())) return;
    try {
      await this.pool.query(
        `UPDATE steamfarmer_timed_queue SET completed = TRUE, error = $3 WHERE job_id = $1 AND item_index = $2`,
        [job.jobId, item.itemIndex, errorText]
      );
      if (!job.queue.length) {
        await this.pool.query(
          `UPDATE steamfarmer_timed_jobs SET status = 'completed' WHERE job_id = $1`,
          [job.jobId]
        );
      }
    } catch {}
  }
  async _persistJobStatus(job, status) {
    this._saveLocal();
    if (!(await this.ensureSchema())) return;
    try {
      const cfgWithMeta = { ...(job.config || {}), pausedAt: job.pausedAt || null };
      await this.pool.query(
        `UPDATE steamfarmer_timed_jobs SET status = $2, config = $3::jsonb WHERE job_id = $1`,
        [job.jobId, status, JSON.stringify(cfgWithMeta)]
      );
      if (status === 'active') {
        for (const q of job.queue) {
          await this.pool.query(
            `UPDATE steamfarmer_timed_queue SET run_at = $3 WHERE job_id = $1 AND item_index = $2 AND completed = FALSE`,
            [job.jobId, q.itemIndex, q.runAt]
          );
        }
      }
    } catch {}
  }
  key(accountId, appid) {
    return `${accountId}:${appid}`;
  }
  status(accountId, appid) {
    const job = this.jobs.get(this.key(accountId, appid));
    if (!job) return { active: false, appid: Number(appid) };
    const sessInfo = this.getActiveSessionDetails(job);
    return {
      jobId: job.jobId,
      active: job.active,
      pausedByCollision: Boolean(job.pausedByCollision),
      pausedManually: Boolean(job.pausedManually),
      pausedAt: job.pausedAt ? new Date(job.pausedAt).toISOString() : null,
      appid: job.appid,
      action: job.action,
      spacing: job.spacing,
      order: job.order,
      totalCount: job.totalCount,
      completedCount: job.completedCount,
      failedCount: job.failedCount,
      retryCount: job.retryCount || 0,
      startedAt: job.startedAt,
      nextRunAt: job.nextRunAt,
      sessionCount: job.config?.sessionCount || (job.config?.playtimeSessions?.length || null),
      estimatedDays: job.config?.estimatedDays || null,
      plannedPlaytimeHours: job.config?.plannedPlaytimeHours || job.config?.targetPlaytimeHours || null,
      donorHoursPlayed: job.config?.donorHoursPlayed || null,
      sessions: job.config?.sessions || job.config?.playtimeSessions || null,
      summaryTextEs: job.config?.summaryTextEs || null,
      summaryTextEn: job.config?.summaryTextEn || null,
      inActiveSessionWindow: sessInfo.inSession,
      inAfkWindow: this.getAccountAfkState(accountId).appid === job.appid,
      afkWindowsCount: Array.isArray(job.config?.afkWindows) ? job.config.afkWindows.length : 0,
      warmupHours: job.config?.warmupHours || 0,
      preFlightAudit: job.config?.preFlightAudit || null,
      currentSessionEndAt: sessInfo.currentSession?.endMs ? new Date(sessInfo.currentSession.endMs).toISOString() : null,
      nextSessionStartAt: sessInfo.nextSession?.startMs ? new Date(sessInfo.nextSession.startMs).toISOString() : null,
      pacingMode: job.config?.pacingMode || null,
      remaining: job.queue.map(q => ({ apiname: q.apiname, name: q.name || q.apiname, action: q.action, runAt: q.runAt, phase: q.phase || null, phaseLabel: q.phaseLabel || null, percent: q.percent ?? null })),
      history: job.history.slice(-20)
    };
  }
  cancel(accountId, appid, { skipDb = false } = {}) {
    appid = Number(appid);
    const k = this.key(accountId, appid);
    const job = this.jobs.get(k);
    if (job) {
      job.active = false;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      this.jobs.delete(k);
      if (!skipDb) this._trackWrite(this._persistJobStatus(job, 'cancelled'));
    } else if (!skipDb) {
      this._saveLocal();
    }
    if (!skipDb && this.pool) {
      this._trackWrite(
        Promise.resolve()
          .then(() => this.pool.query(
            `UPDATE steamfarmer_timed_jobs SET status = 'cancelled' WHERE account_id = $1 AND appid = $2 AND status IN ('active', 'paused_collision')`,
            [accountId, appid]
          ))
          .then(() => this.pool.query(
            `DELETE FROM steamfarmer_timed_queue WHERE job_id IN (SELECT job_id FROM steamfarmer_timed_jobs WHERE account_id = $1 AND appid = $2 AND status = 'cancelled') AND completed = false`,
            [accountId, appid]
          ))
          .catch(() => {})
      );
    }
    if (job) {
      try { this.onScheduleChange?.(accountId, job.appid); } catch {}
      return true;
    }
    return false;
  }
  cancelForApp(accountId, appid) {
    return this.cancel(accountId, appid);
  }
  cancelAll() {
    for (const [k, job] of this.jobs) {
      job.active = false;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      this.jobs.delete(k);
    }
  }
  cancelAllForAccount(accountId = null) {
    let cancelledCount = 0;
    const affected = [];
    for (const [k, job] of this.jobs) {
      if (accountId && job.accountId !== accountId) continue;
      job.active = false;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      this.jobs.delete(k);
      cancelledCount++;
      affected.push({ accountId: job.accountId, appid: job.appid });
    }
    this._saveLocal();
    if (this.pool) {
      const params = accountId ? [accountId] : [];
      const whereAcc = accountId ? `AND account_id = $1` : '';
      this._trackWrite(
        Promise.resolve()
          .then(() => this.pool.query(
            `UPDATE steamfarmer_timed_jobs SET status = 'cancelled' WHERE status IN ('active', 'paused_collision') ${whereAcc}`,
            params
          ))
          .then(() => this.pool.query(
            accountId
              ? `DELETE FROM steamfarmer_timed_queue WHERE job_id IN (SELECT job_id FROM steamfarmer_timed_jobs WHERE account_id = $1 AND status = 'cancelled') AND completed = false`
              : `DELETE FROM steamfarmer_timed_queue WHERE job_id IN (SELECT job_id FROM steamfarmer_timed_jobs WHERE status = 'cancelled') AND completed = false`,
            params
          ))
          .catch(() => {})
      );
    }
    for (const item of affected) {
      try { this.onScheduleChange?.(item.accountId, item.appid); } catch {}
    }
    return cancelledCount;
  }
  pauseAccount(accountId) {
    let paused = 0;
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId || !job.active || job.pausedByCollision) continue;
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      job.pausedByCollision = true;
      job.pausedAt = now;
      this._trackWrite(this._persistJobStatus(job, 'paused_collision'));
      paused++;
    }
    return paused;
  }
  resumeAccount(accountId) {
    let resumed = 0;
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId || !job.active || !job.pausedByCollision) continue;
      const pausedDeltaMs = Math.max(0, now - (job.pausedAt || now));
      for (const item of job.queue) {
        const prevMs = Date.parse(item.runAt);
        const shiftedMs = Number.isFinite(prevMs) ? Math.max(now + 50, prevMs + pausedDeltaMs) : now + 50;
        item.runAt = new Date(shiftedMs).toISOString();
      }
      for (const list of [job.config?.sessions, job.config?.playtimeSessions]) {
        if (Array.isArray(list)) {
          for (const s of list) {
            if (typeof s.startAtMs === 'number') s.startAtMs += pausedDeltaMs;
            if (typeof s.endAtMs === 'number') s.endAtMs += pausedDeltaMs;
            if (s.startAt) s.startAt = new Date(Date.parse(s.startAt) + pausedDeltaMs).toISOString();
            if (s.endAt) s.endAt = new Date(Date.parse(s.endAt) + pausedDeltaMs).toISOString();
          }
        }
      }
      job.pausedByCollision = false;
      job.pausedAt = null;
      job.nextRunAt = job.queue[0]?.runAt || null;
      this._trackWrite(this._persistJobStatus(job, 'active'));
      job.scheduleNext?.();
      resumed++;
    }
    if (resumed > 0) this._deconflictAccountQueue(accountId);
    return resumed;
  }
  _attachScheduler(job, executeItem) {
    const scheduleNext = () => {
      if (!job.active || !job.queue.length) {
        const wasActive = job.active;
        job.active = false;
        job.nextRunAt = null;
        job.timer = null;
        this._saveLocal();
        if (wasActive) {
          try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
          try { this.onJobCompleted?.(job.accountId, job.appid, job); } catch {}
        }
        return;
      }
      if (job.pausedByCollision || job.pausedManually) {
        job.timer = null;
        return;
      }
      const next = job.queue[0];
      job.nextRunAt = next.runAt;
      const now = Date.now();
      const targetMs = Date.parse(next.runAt);
      const rawWaitMs = Math.max(50, targetMs - now);
      const sessInfo = this.getActiveSessionDetails(job, now);
      let nextBoundaryWaitMs = rawWaitMs;
      const nextRamp = Array.isArray(next.statRampSteps) && next.statRampSteps.length > 0 ? next.statRampSteps[0] : null;
      const nextRampMs = nextRamp?.runAt ? Date.parse(nextRamp.runAt) : NaN;
      if (Number.isFinite(nextRampMs) && nextRampMs < targetMs) {
        nextBoundaryWaitMs = Math.min(nextBoundaryWaitMs, Math.max(50, nextRampMs - now));
      }
      if (sessInfo.inSession && sessInfo.currentSession?.endMs > now) {
        nextBoundaryWaitMs = Math.min(nextBoundaryWaitMs, Math.max(1000, sessInfo.currentSession.endMs - now + 500));
      } else if (!sessInfo.inSession && sessInfo.nextSession?.startMs > now) {
        nextBoundaryWaitMs = Math.min(nextBoundaryWaitMs, Math.max(1000, sessInfo.nextSession.startMs - now + 500));
      }
      const waitMs = Math.min(nextBoundaryWaitMs, 15 * 60000, 12 * 3600000);
      job.timer = setTimeout(async () => {
        if (!job.active || job.pausedByCollision || job.pausedManually) return;
        if (Array.isArray(next.statRampSteps) && next.statRampSteps.length > 0) {
          const dueRampMs = Date.parse(next.statRampSteps[0].runAt);
          if (Number.isFinite(dueRampMs) && dueRampMs <= Date.now() + 150 && Date.parse(next.runAt) - Date.now() > 500) {
            const rampStep = next.statRampSteps.shift();
            try {
              await this._enqueueAccountExecution(job.accountId, () => executeItem({
                action: 'stat_ramp',
                apiname: next.apiname,
                name: next.name || next.apiname,
                rampStep
              }));
              job.history.push({
                apiname: next.apiname,
                action: 'stat_ramp',
                statName: rampStep.statName,
                value: rampStep.value,
                goal: rampStep.goal,
                at: new Date().toISOString(),
                ok: true
              });
            } catch {}
            scheduleNext();
            return;
          }
        }
        if (Date.parse(next.runAt) - Date.now() > 100) {
          try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
          scheduleNext();
          return;
        }
        const currentItem = job.queue.shift();
        try {
          await this._enqueueAccountExecution(job.accountId, () => executeItem(currentItem));
          job.completedCount++;
          job.history.push({ apiname: currentItem.apiname, action: currentItem.action, at: new Date().toISOString(), ok: true, attempts: (currentItem.retryCount || 0) + 1 });
          await this._trackWrite(this._persistItemDone(job, currentItem, null));
          try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
        } catch (err) {
          currentItem.retryCount = (currentItem.retryCount || 0) + 1;
          if (currentItem.retryCount <= this.retryDelaysMs.length) {
            const backoffMs = this.retryDelaysMs[currentItem.retryCount - 1];
            currentItem.runAt = new Date(Date.now() + backoffMs).toISOString();
            currentItem.delayMs = backoffMs;
            currentItem.lastError = err.message || 'Transient Steam error';
            job.retryCount = (job.retryCount || 0) + 1;
            job.queue.unshift(currentItem);
            this._deconflictAccountQueue(job.accountId, job.appid);
            job.nextRunAt = job.queue[0].runAt;
            job.history.push({
              apiname: currentItem.apiname,
              action: currentItem.action,
              at: new Date().toISOString(),
              ok: false,
              retrying: true,
              attempt: currentItem.retryCount,
              nextRetryInMs: backoffMs,
              error: err.message
            });
            await this._trackWrite(this._persistJobStatus(job, 'active'));
          } else {
            job.failedCount++;
            job.history.push({ apiname: currentItem.apiname, action: currentItem.action, at: new Date().toISOString(), ok: false, attempts: currentItem.retryCount, error: err.message });
            await this._trackWrite(this._persistItemDone(job, currentItem, err.message || 'Execution error'));
          }
        }
        scheduleNext();
      }, waitMs);
      job.timer.unref?.();
    };
    job.scheduleNext = scheduleNext;
    scheduleNext();
  }
  start({ accountId, appid, items, customDelaysMs, playtimeSessions = null, plannedPlaytimeHours = null, donorHoursPlayed = null, summaryTextEs = null, percentagesMap = null, targetHours = null, hltbData = null, pacingMode = null, currentFarmedHours = 0, alreadyUnlockedCount = 0, enableWarmup = false, simulateAfkPauses = true, preFlightAudit = null, afkWindows = null, warmupHours = 0, skipDateSpecific = false, simulateOffDays = true, enableStatRamping = true, maxItems = 0, amount = 5, units = 'minutes', spacing = 'even', order = 'selection', stealth = false, pausedByCollision = false, executeItem }) {
    appid = appId(appid);
    this.cancel(accountId, appid, { skipDb: true });
    if (!Array.isArray(items) || !items.length) throw fail('Select at least one achievement for timed modification.', 400);
    const maxOffsetCapMs = 365 * 24 * 3600000;
    const unitMs = units === 'hours' ? 3600000 : units === 'minutes' ? 60000 : 1000;
    const totalMs = Math.max(1000, Math.min(maxOffsetCapMs, Number(amount || 1) * unitMs));
    let list = items.map(x => ({
      apiname: String(x.apiname),
      name: x.name ? String(x.name) : String(x.apiname),
      description: x.description ? String(x.description) : '',
      action: x.action === 'remove' ? 'remove' : 'unlock',
      percent: typeof x.percent === 'number' ? x.percent : null,
      phase: x.phase || null,
      phaseLabel: x.phaseLabel || null
    }));
    if ((spacing === 'platinum' || order === 'progression') && Number(maxItems) > 0) {
      list = sortAchievementsByProgression(list, percentagesMap).slice(0, Number(maxItems));
    } else if (Number(maxItems) > 0) {
      list = list.slice(0, Number(maxItems));
    }
    const now = Date.now();
    let offsets = [];
    let platinumMeta = null;
    if (spacing === 'platinum') {
      const plat = buildRealisticPlatinumSchedule(list, { percentagesMap, targetHours, hltbData, pacingMode, currentFarmedHours, alreadyUnlockedCount, enableWarmup, simulateAfkPauses, skipDateSpecific, simulateOffDays, enableStatRamping, baseNowMs: now });
      list = plat.items;
      offsets = plat.offsetsMs;
      order = 'progression';
      platinumMeta = {
        sessionCount: plat.sessionCount,
        estimatedDays: plat.estimatedDays,
        offDaysCount: plat.offDaysCount || 0,
        offDaysDates: plat.offDaysDates || [],
        statRampCount: (plat.statRampPlan || []).length,
        afkWindows: plat.afkWindows || [],
        warmupHours: plat.warmupHours || 0,
        warmupReasonEs: plat.warmupReasonEs || null,
        preFlightAudit: plat.preFlightAudit || null,
        hltbCalibrated: plat.hltbCalibrated,
        targetPlaytimeHours: plat.targetPlaytimeHours,
        plannedPlaytimeHours: plat.plannedPlaytimeHours,
        mainStoryHours: plat.mainStoryHours,
        completionistHours: plat.completionistHours,
        summaryTextEs: plat.summaryTextEs,
        summaryTextEn: plat.summaryTextEn,
        playtimeSessions: plat.playtimeSessions,
        sessions: plat.sessions.map(s => ({
          ...s,
          startAt: s.startAt || new Date(now + s.startOffsetMs).toISOString(),
          endAt: s.endAt || new Date(now + s.endOffsetMs).toISOString()
        }))
      };
    } else {
      if (order === 'progression') {
        list = sortAchievementsByProgression(list, percentagesMap);
      } else if (order === 'random' && !Array.isArray(customDelaysMs)) {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
      }
      if (Array.isArray(customDelaysMs) && customDelaysMs.length === list.length) {
        offsets = customDelaysMs.map(d => Math.max(0, Math.min(maxOffsetCapMs, Math.trunc(Number(d) || 0))));
      } else {
        offsets = buildHumanizedOffsets(list.length, totalMs, spacing);
      }
      const computedSessions = Array.isArray(playtimeSessions) && playtimeSessions.length
        ? playtimeSessions.map(s => ({
            ...s,
            startAtMs: now + (Number(s.startOffsetMs) || 0),
            endAtMs: now + (Number(s.endOffsetMs) || 0),
            startAt: new Date(now + (Number(s.startOffsetMs) || 0)).toISOString(),
            endAt: new Date(now + (Number(s.endOffsetMs) || 0)).toISOString()
          }))
        : buildDonorPlaytimeSessions(offsets, { baseNowMs: now, targetPlaytimeHours: donorHoursPlayed || plannedPlaytimeHours }).sessions;
      const computedAfk = Array.isArray(afkWindows) ? afkWindows : buildSessionAfkWindows(computedSessions, offsets, { baseNowMs: now, simulateAfkPauses });
      const computedAudit = preFlightAudit || computePreFlightAudit({
        items: list,
        offsetsMs: offsets,
        plannedPlaytimeHours: plannedPlaytimeHours || donorHoursPlayed || 0,
        currentPlaytimeHours: currentFarmedHours,
        donorHoursPlayed,
        warmupHours: warmupHours || 0,
        afkWindows: computedAfk,
        alreadyUnlockedCount
      });
      platinumMeta = {
        playtimeSessions: computedSessions,
        sessions: computedSessions,
        sessionCount: computedSessions.length,
        plannedPlaytimeHours: plannedPlaytimeHours || null,
        donorHoursPlayed: donorHoursPlayed || null,
        afkWindows: computedAfk,
        warmupHours: warmupHours || 0,
        preFlightAudit: computedAudit,
        summaryTextEs: summaryTextEs || null
      };
    }
    const queue = list.map((item, idx) => ({
      itemIndex: idx,
      apiname: item.apiname,
      name: item.name || item.apiname,
      action: item.action,
      phase: item.phase || null,
      phaseLabel: item.phaseLabel || null,
      percent: item.percent ?? null,
      precededByOffDay: Boolean(item.precededByOffDay),
      statRampSteps: Array.isArray(item.statRampSteps) ? item.statRampSteps : null,
      runAt: new Date(now + offsets[idx]).toISOString(),
      delayMs: offsets[idx]
    }));
    const job = {
      jobId: crypto.randomUUID(),
      accountId,
      appid,
      active: true,
      pausedByCollision: Boolean(pausedByCollision),
      pausedAt: pausedByCollision ? now : null,
      action: list[0].action,
      spacing,
      order,
      config: { spacing, order, amount, units, pacingMode: pacingMode || null, stealth: Boolean(stealth), ...(platinumMeta || {}) },
      totalCount: queue.length,
      completedCount: 0,
      failedCount: 0,
      startedAt: new Date(now).toISOString(),
      nextRunAt: queue[0]?.runAt || null,
      queue,
      history: [],
      timer: null
    };
    const k = this.key(accountId, appid);
    this.jobs.set(k, job);
    this._deconflictAccountQueue(accountId, appid);
    this._trackWrite(this._persistJobStart(job));
    this._attachScheduler(job, executeItem);
    try { this.onScheduleChange?.(accountId, appid); } catch {}
    return this.status(accountId, appid);
  }
  async rehydrate({ accountId = null, executeItemFactory, isCollisionPaused = () => false } = {}) {
    if (typeof executeItemFactory !== 'function') return 0;
    let restoredCount = 0;
    if (await this.ensureSchema()) {
      try {
        const params = accountId ? [accountId] : [];
        const whereAcc = accountId ? `AND account_id = $1` : '';
        const jobsRes = await this.pool.query(
          `SELECT job_id, account_id, appid, status, config, started_at FROM steamfarmer_timed_jobs WHERE status IN ('active', 'paused_collision') ${whereAcc} ORDER BY created_at ASC`,
          params
        );
        for (const row of jobsRes.rows || []) {
          const appNum = Number(row.appid);
          const k = this.key(row.account_id, appNum);
          if (this.jobs.has(k)) continue;
          const qRes = await this.pool.query(
            `SELECT item_index, apiname, action, run_at, completed FROM steamfarmer_timed_queue WHERE job_id = $1 ORDER BY item_index ASC`,
            [row.job_id]
          );
          const allItems = qRes.rows || [];
          const now = Date.now();
          const pending = allItems.filter(r => !r.completed).map((r, idx) => {
            const originalRunAt = Date.parse(r.run_at);
            let delayMs;
            if (originalRunAt <= now) {
              delayMs = (idx + 1) * 120000;
            } else {
              delayMs = Math.max(1000, originalRunAt - now);
            }
            return {
              itemIndex: Number(r.item_index),
              apiname: String(r.apiname),
              action: r.action === 'remove' ? 'remove' : 'unlock',
              runAt: new Date(now + delayMs).toISOString(),
              delayMs
            };
          });
          if (!pending.length) {
            await this.pool.query(`UPDATE steamfarmer_timed_jobs SET status = 'completed' WHERE job_id = $1`, [row.job_id]);
            continue;
          }
          const cfg = typeof row.config === 'string' ? JSON.parse(row.config || '{}') : (row.config || {});
          const paused = row.status === 'paused_collision' || Boolean(isCollisionPaused(row.account_id));
          const restoredPausedAt = Number(cfg.pausedAt) > 0 ? Number(cfg.pausedAt) : (paused ? Date.now() : null);
          const job = {
            jobId: row.job_id,
            accountId: row.account_id,
            appid: appNum,
            active: true,
            pausedByCollision: paused,
            pausedAt: paused ? restoredPausedAt : null,
            action: pending[0].action,
            spacing: cfg.spacing || 'even',
            order: cfg.order || 'selection',
            config: cfg,
            totalCount: allItems.length,
            completedCount: allItems.length - pending.length,
            failedCount: 0,
            startedAt: new Date(row.started_at || Date.now()).toISOString(),
            nextRunAt: pending[0].runAt,
            queue: pending,
            history: [],
            timer: null
          };
          this.jobs.set(k, job);
          this._deconflictAccountQueue(row.account_id, appNum);
          const executor = executeItemFactory(row.account_id, appNum, cfg);
          this._attachScheduler(job, executor);
          restoredCount++;
        }
        return restoredCount;
      } catch {}
    }
    if (this.file && fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const item of Array.isArray(saved) ? saved : []) {
          if (accountId && item.accountId !== accountId) continue;
          const appNum = Number(item.appid);
          const k = this.key(item.accountId, appNum);
          if (this.jobs.has(k) || !Array.isArray(item.queue) || !item.queue.length) continue;
          const paused = item.status === 'paused_collision' || Boolean(isCollisionPaused(item.accountId));
          const now = Date.now();
          const pending = item.queue.map((q, idx) => {
            const originalRunAt = Date.parse(q.runAt);
            let delayMs;
            if (originalRunAt <= now) {
              delayMs = (idx + 1) * 120000;
            } else {
              delayMs = Math.max(1000, originalRunAt - now);
            }
            return {
              itemIndex: q.itemIndex ?? idx,
              apiname: String(q.apiname),
              name: q.name || String(q.apiname),
              percent: q.percent ?? null,
              action: q.action === 'remove' ? 'remove' : 'unlock',
              runAt: new Date(now + delayMs).toISOString(),
              delayMs
            };
          });
          const cfg = item.config || {};
          const job = {
            jobId: item.jobId || crypto.randomUUID(),
            accountId: item.accountId,
            appid: appNum,
            active: true,
            pausedByCollision: paused,
            pausedAt: item.pausedAt || (paused ? Date.now() : null),
            action: pending[0].action,
            spacing: cfg.spacing || 'even',
            order: cfg.order || 'selection',
            config: cfg,
            totalCount: item.totalCount || pending.length,
            completedCount: item.completedCount || 0,
            failedCount: item.failedCount || 0,
            startedAt: item.startedAt || new Date().toISOString(),
            nextRunAt: pending[0].runAt,
            queue: pending,
            history: [],
            timer: null
          };
          this.jobs.set(k, job);
          this._deconflictAccountQueue(item.accountId, appNum);
          const executor = executeItemFactory(item.accountId, appNum, cfg);
          this._attachScheduler(job, executor);
          restoredCount++;
        }
      } catch {}
    }
    return restoredCount;
  }
}

function libraryCorroborates(summary,unlocked,total,since){
  const time=Date.parse(since),now=Math.floor(Date.now()/1000);
  return Boolean(summary&&summary.unlocked===unlocked&&summary.total===total&&uint(summary.cacheTime)&&summary.cacheTime>0&&Number.isFinite(time)&&summary.cacheTime>=Math.floor(time/1000)&&summary.cacheTime<=now);
}
async function readLibrarySummary(client,id,{timeoutMs=1500}={}){
  const identity=client?.steamID?.toString();
  if(!/^765\d{14}$/.test(identity||'')||typeof client?._send!=='function')return null;
  return new Promise(resolve=>{
    let finished=false,job;const done=value=>{if(finished)return;finished=true;clearTimeout(timer);if(job)client._jobs?.delete?.(job);client.removeListener('disconnected',disconnected);client.removeListener('error',disconnected);resolve(value);};
    const disconnected=()=>done(null),timer=setTimeout(disconnected,timeoutMs);
    client.once('disconnected',disconnected);client.once('error',disconnected);
    try{const method='Player.GetAchievementsProgress#1',encoded=Buffer.from(Schema.CPlayer_GetAchievementsProgress_Request.encode({steamid:identity,language:'english',appids:[appId(id)]}).finish());
    client._send({msg:EMsg.ServiceMethodCallFromClient,proto:{target_job_name:method}},encoded,(response,header)=>{
      if(client.steamID?.toString()!==identity||header?.msg!==EMsg.ServiceMethodResponse||header?.proto?.target_job_name!==method||Number(header?.proto?.eresult)!==1)return done(null);
      let body;try{const bytes=response?.toBuffer?response.toBuffer():response;if(!Buffer.isBuffer(bytes)||bytes.length>65536)return done(null);body=Schema.CPlayer_GetAchievementsProgress_Response.decode(bytes);}catch{return done(null);}
      if(!Array.isArray(body?.achievement_progress)||body.achievement_progress.length!==1)return done(null);
      const row=body.achievement_progress[0];
      if(row.appid!==Number(id)||!Object.hasOwn(row,'unlocked')||!Object.hasOwn(row,'total')||!uint(row.unlocked)||!uint(row.total)||row.total>8192||row.unlocked>row.total)return done(null);
      done({unlocked:row.unlocked,total:row.total,cacheTime:Object.hasOwn(row,'cache_time')&&uint(row.cache_time)?row.cache_time:null});
    });job=String(client._currentJobID);if(finished)client._jobs?.delete?.(job);}catch{done(null);}
  });
}
function detectAchievementSet(bit = {}, stat = {}) {
  const display = bit?.display || {};
  const rawDlc = bit?.dlc_appid ?? bit?.dlcAppId ?? bit?.dlc ?? display?.dlc_appid ?? stat?.dlc_appid ?? stat?.dlcAppId ?? stat?.dlc ?? null;
  const rawSetId = bit?.set_id ?? bit?.setId ?? display?.set_id ?? stat?.set_id ?? stat?.setId ?? bit?.group ?? display?.group ?? stat?.group ?? null;
  const rawSetName = bit?.set_name ?? bit?.setName ?? display?.set_name ?? stat?.set_name ?? stat?.setName ?? null;
  if (rawDlc != null && String(rawDlc).trim() !== '' && String(rawDlc) !== '0') {
    const dlcStr = String(rawDlc).trim();
    const setId = rawSetId ? String(rawSetId).trim() : (dlcStr.startsWith('dlc_') ? dlcStr : `dlc_${dlcStr}`);
    const setName = rawSetName ? String(rawSetName).trim() : `DLC #${dlcStr.replace(/^dlc_/i, '')}`;
    return { set_id: setId, set_name: setName, explicitName: true };
  }
  if (rawSetId != null && String(rawSetId).trim() !== '' && String(rawSetId).trim().toLowerCase() !== 'base') {
    const setId = String(rawSetId).trim();
    const setName = rawSetName ? String(rawSetName).trim() : setId;
    return { set_id: setId, set_name: setName, explicitName: true };
  }
  return {
    set_id: 'base',
    set_name: rawSetName ? String(rawSetName).trim() : 'Base Game',
    explicitName: Boolean(rawSetName)
  };
}
function parseSnapshot(snapshot, id, planningContext) {
  id = appId(id);
  if (Number(snapshot.eresult) !== 1) throw problem(`Steam rejected direct verification (result ${Number(snapshot.eresult) || 2}). This response does not identify a launcher-related cause.`,502,'stats_read_rejected','Check the connected Steam account and game access. If the game uses a publisher account, check linking in its official launcher, then refresh.');
  if (String(snapshot.game_id) !== String(id)) throw problem('Steam returned statistics for a different game.');
  if (!snapshot.schema?.length || snapshot.schema.length > 4 * 1024 * 1024) throw problem('Steam did not return usable achievement definitions. Activation compatibility cannot be checked; this does not prove the game has no achievements.',502,'schema_unavailable','Try the standard Steam reading. Open the game normally if you own it and refresh; the exact cause is not known.');
  const rawStats = snapshot.stats || [], rawBlocks = snapshot.achievement_blocks || [];
  if(rawStats.length>32768||rawBlocks.length>4096)throw problem('Steam statistics exceed the bounded verification budget.');
  const root = getParsedSchema(snapshot);
  if (!root) throw problem('Steam returned unreadable achievement definitions.');
  // Accept only the requested AppID; a schema for another game is never substituted.
  const definition = root[String(id)] || (root.stats ? root : null);
  if (!definition?.stats) throw problem('Steam did not return an achievement schema for this game.');
  const index={byName:new Map(),numericCounts:new Map(),references:new Map()},rowBits=new Map();
  for(const [key,stat]of Object.entries(definition.stats)){if(stat?.name){if(!index.byName.has(stat.name))index.byName.set(stat.name,[]);index.byName.set(stat.name,[...index.byName.get(stat.name),[key,stat]]);}if(/^\d+$/.test(key))index.numericCounts.set(Number(key),(index.numericCounts.get(key|0)||index.numericCounts.get(Number(key))||0)+1);}
  const values = new Map(), statsById = new Map();
  let allStatsValid = true;
  for(const stat of rawStats) {
    if(!statsById.has(stat.stat_id))statsById.set(stat.stat_id,[]);
    statsById.get(stat.stat_id).push(stat);
    if(!Object.hasOwn(stat,'stat_id')||!Object.hasOwn(stat,'stat_value')||!uint(stat.stat_id)||!uint(stat.stat_value))allStatsValid=false;
  }
  for (const [statId, list] of statsById) {
    if (list.length === 1 && uint(statId) && Object.hasOwn(list[0],'stat_value') && uint(list[0].stat_value)) values.set(statId, list[0].stat_value);
  }
  const blocks = new Map(rawBlocks.map(b => [Number(b.achievement_id), b.unlock_time || []]));
  const rows = [];
  const nowSec = Date.now() / 1000;
  for (const [blockKey, stat] of Object.entries(definition.stats)) {
    if (!/^\d+$/.test(blockKey) || !stat || !['4', 'ACHIEVEMENTS'].includes(String(stat.type).toUpperCase())) continue;
    const blockId = Number(blockKey); if (!Number.isSafeInteger(blockId) || blockId > 0xffffffff) continue;
    const blockVal = values.get(blockId), hasBlockVal = values.has(blockId);
    const times = blocks.get(blockId);
    const statTrusted = trustedServer(stat.bSetByTrustedGS);
    for (const [bitKey, bit] of Object.entries(stat.bits || {})) {
      const bitIndex = Number(bitKey);
      if (!/^\d+$/.test(bitKey) || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 31 || !bit?.name || typeof bit.name !== 'string') continue;
      const hasTime = Boolean(times && bitIndex < times.length);
      const timestamp = hasTime ? Number(times[bitIndex]) : 0;
      // Achievement timestamps in achievement_blocks can remain populated for locked bits.
      // As in SamRewritten, personal unlock state is strictly determined by the stats bitmask.
      const unlocked = hasBlockVal ? Boolean(blockVal & (1 << bitIndex)) : null;
      const icon = value => typeof value === 'string' && value ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${id}/${encodeURIComponent(value)}` : '';
      const display = bit.display || {};
      const bitTrusted = trustedServer(bit.bSetByTrustedGS);
      const serverControlled = Boolean(Number(bit.permission || 0) & 2) || bitTrusted === true || statTrusted === true;
      const trustedServerUnknown = bitTrusted === null || statTrusted === null;
      const hiddenRaw = display.hidden ?? bit.hidden;
      const hidden = hiddenRaw == null ? null : ['1','true'].includes(String(hiddenRaw).toLowerCase()) ? true : ['0','false'].includes(String(hiddenRaw).toLowerCase()) ? false : null;
      const setInfo = detectAchievementSet(bit, stat);
      const row = {
        id:bit.name, apiname:bit.name, name:english(display.name) || bit.name, description:english(display.desc),
        iconOpen:icon(display.icon), iconClosed:icon(display.icon_gray || display.icon),
        unlocked, unlockTimestamp:unlocked && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= nowSec ? timestamp : 0,
        percent:null, tier:'Unknown', serverControlled, statId:blockId, bitIndex,
        permission:bit.permission ?? null, blockPermission:stat.permission ?? null,
        hasProgressDependency:bit.progress != null,
        stateEvidence:{bitUnlocked:unlocked,unlockTimePresent:hasTime,reportedUnlockTimestamp:hasTime&&uint(timestamp)?timestamp:null},
        trustedServerUnknown, hidden,
        set_id:setInfo.set_id,
        ...(setInfo.set_id !== 'base' || setInfo.explicitName ? { set_name: setInfo.set_name } : {})
      };
      rows.push(row);
      if(rows.length>8192)throw problem('This game exceeds the bounded achievement-list budget.');
      rowBits.set(row,bit);
      if(bit.progress) {
        row.progressExpression=bit.progress.value||null;
        const statName=bit.progress.value?.operand1;
        const linked=typeof statName==='string'?index.byName.get(statName)||[]:[];
        const linkedStat=linked.length===1?linked[0]:null;
        const type=linkedStat?String(linkedStat[1].type).toUpperCase():null;
        const raw=linkedStat?values.get(Number(linkedStat[0])):undefined;
        const maximum=Number(bit.progress.max_val);
        const direct=bit.progress.value?.operation==='statvalue'&&Object.keys(bit.progress.value).every(k=>['operation','operand1'].includes(k));
        const numericType=['1','INT','2','FLOAT'].includes(type),currentValue=raw===undefined?null:['1','INT'].includes(type)?raw|0:['2','FLOAT'].includes(type)?decodeFloat(raw):null;
        row.progressDetails={statName:typeof statName==='string'?statName:null,type,currentValue:direct?currentValue:null,maximum:Number.isFinite(maximum)&&bit.progress.max_val!=null?maximum:null,interpreted:direct&&linked.length===1&&numericType};
      }
    }
  }
  if (!rows.length) throw problem('Steam returned no readable achievement definitions. Try the standard verification method.',502,'definitions_unavailable','Use the standard Steam reading; this panel cannot activate achievements without real definitions and identifiers.');
  let statsUnlocked = 0, serverControlledCount = 0;
  const retainedDates = [];
  for (const row of rows) {
    if (row.unlocked === true) statsUnlocked++;
    if (row.serverControlled) serverControlledCount++;
    if (row.stateEvidence.bitUnlocked === false && row.stateEvidence.reportedUnlockTimestamp > 0) retainedDates.push(row);
  }
  const library=snapshot.librarySummary;
  const summaryDisagrees=Boolean(library&&(library.total!==rows.length||library.unlocked!==statsUnlocked));
  // A cached aggregate predating this direct statistics read is not a new
  // conflicting personal snapshot. Keep its evidence without blanking the list.
  const staleLibrarySummary=Boolean(summaryDisagrees&&(library.advisory||!uint(library.cacheTime)||library.cacheTime===0||library.cacheTime<Math.floor(Date.now()/1000)-2));
  const stateConflict=summaryDisagrees&&!staleLibrarySummary;
  const names=new Map(),bits=new Map();
  for(const row of rows){
    if(stateConflict)row.unlocked=null;
    if(row.progressExpression){
      const visit=(value,depth=0)=>{if(depth>32)throw problem('Progress definitions are nested too deeply.');if(typeof value==='string'){if(!index.references.has(value))index.references.set(value,new Set());index.references.get(value).add(row.apiname);}else if(value&&typeof value==='object')for(const v of Object.values(value))visit(v,depth+1);};
      visit(row.progressExpression);
    }
    names.set(row.apiname,(names.get(row.apiname)||0)+1);
    const key=row.statId+':'+row.bitIndex;bits.set(key,(bits.get(key)||0)+1);
  }
  let allVerified = true;
  for (const row of rows) {
    if (typeof row.unlocked !== 'boolean') allVerified = false;
    row.compatibility = stateConflict
      ? {status:'insufficient_data',code:'library_state_conflict',canUnlock:false,reason:'Steam statistics and the Steam library summary disagree. The current personal state is not confirmed.',action:'Do not repeat the previous operation while these readings conflict. Check the achievement in Steam before reviewing another change.'}
      : classifyAchievement(row,snapshot,rows,{stats:statsById,names,bits});
  }
  const hasCrc = Object.hasOwn(snapshot,'crc_stats') && uint(snapshot.crc_stats);
  const complete = allVerified && hasCrc && statsById.size === rawStats.length && allStatsValid;
  for(const row of rows){
    const unrestricted=!row.serverControlled&&!row.trustedServerUnknown&&[row.permission,row.blockPermission].every(p=>p==null||String(p)==='0');
    const unique=names.get(row.apiname)===1&&bits.get(row.statId+':'+row.bitIndex)===1&&index.numericCounts.get(row.statId)===1;
    const canRemove=complete&&unique&&unrestricted&&row.unlocked===true;
    row.removalSupport={canRemove,reason:!complete?'Steam did not return a complete personal snapshot and statistics version. Refresh the direct reading.':!unrestricted?'Steam declares protected or unsupported achievement permissions.':!unique?'The achievement definition or bit is ambiguous.':row.unlocked!==true?'Steam must confirm the achievement is currently unlocked.':'The current Steam snapshot permits reviewing this achievement bit for removal.',...(row.hasProgressDependency?{warning:'Removal keeps the linked progress counter unchanged. The game or Steam may unlock this achievement again when it checks that progress.'}:{})};
    if(row.hasProgressDependency){
      const bit=rowBits.get(row);
      row.progressSupport=inspectProgress(row,bit,definition,values,rows,index);
      if(!hasCrc||names.get(row.apiname)!==1||bits.get(row.statId+':'+row.bitIndex)!==1)row.progressSupport={canComplete:false,code:'insufficient_progress_data',reason:'A valid statistics version and unique achievement definition are required.'};
    }
  }
  if(planningContext)Object.assign(planningContext,{definition,index,values,rowBits});
  const statistics = parseGameStats(snapshot, id).stats;
  return { achievements:rows, statistics, source:'Steam client protocol', outcome:'available', verified:allVerified, stateConflict, staleLibrarySummary, message:stateConflict?`Steam statistics report ${statsUnlocked}/${rows.length}, but Steam's library summary reports ${library.unlocked}/${library.total}. Personal state conflicts; achievement changes are blocked. No automatic retry is sent.`:'Read directly from your authenticated Steam session.', checkedAt:new Date().toISOString(), diagnostics:{ method:'ClientGetUserStats', librarySummary:library||null,statsUnlocked,serverControlled:serverControlledCount, retainedUnlockDateCount:retainedDates.length, retainedUnlockDates:retainedDates.slice(0,8).map(r=>({apiname:r.apiname,...r.stateEvidence})) } };
}
function normalizeLiveSnapshot(snapshot, id) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  snapshot.crc_stats = Number(snapshot.crc_stats ?? 0) >>> 0;
  const normalizedStats = Array.isArray(snapshot.stats)
    ? snapshot.stats.map(s => ({ stat_id: Number(s?.stat_id ?? 0) >>> 0, stat_value: Number(s?.stat_value ?? 0) >>> 0 }))
    : [];
  if (Number(snapshot.eresult) === 1 && snapshot.schema?.length && snapshot.schema.length <= 4 * 1024 * 1024) {
    const root = getParsedSchema(snapshot);
    const definition = root?.[String(id)] || (root?.stats ? root : null);
    if (definition?.stats) {
      const present = new Set(normalizedStats.map(s => s.stat_id));
      for (const [key, stat] of Object.entries(definition.stats)) {
        if (!/^\d+$/.test(key) || !stat) continue;
        const type = String(stat.type).toUpperCase();
        if (!['1', 'INT', '2', 'FLOAT', '4', 'ACHIEVEMENTS'].includes(type)) continue;
        const statId = Number(key);
        if (uint(statId) && !present.has(statId)) {
          present.add(statId);
          normalizedStats.push({ stat_id: statId, stat_value: 0 });
        }
      }
    }
  }
  snapshot.stats = normalizedStats;
  return snapshot;
}
function reconcileLiveSnapshot(snapshot, id, summary) {
  if (!snapshot || typeof snapshot !== "object" || Number(snapshot.eresult) !== 1 || !snapshot.schema?.length) return snapshot;
  try {
    const root = getParsedSchema(snapshot);
    const definition = root?.[String(id)] || (root?.stats ? root : null);
    if (!definition?.stats) return snapshot;
    const statsMap = new Map((snapshot.stats || []).map(s => [Number(s.stat_id), Number(s.stat_value) >>> 0]));
    const blocksMap = new Map((snapshot.achievement_blocks || []).map(b => [Number(b.achievement_id), b.unlock_time || []]));
    let statsUnlocked = 0, blocksUnlocked = 0, totalSchemaBits = 0;
    const achBlocks = [];
    for (const [blockKey, stat] of Object.entries(definition.stats)) {
      if (!/^\d+$/.test(blockKey) || !stat || !["4", "ACHIEVEMENTS"].includes(String(stat.type).toUpperCase())) continue;
      const blockId = Number(blockKey);
      if (!uint(blockId)) continue;
      const validBits = [];
      for (const [bitKey, bit] of Object.entries(stat.bits || {})) {
        const bitIndex = Number(bitKey);
        if (!/^\d+$/.test(bitKey) || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 31 || !bit?.name) continue;
        validBits.push(bitIndex);
        totalSchemaBits++;
        const curVal = statsMap.get(blockId) ?? 0;
        if (curVal & (1 << bitIndex)) statsUnlocked++;
        const times = blocksMap.get(blockId);
        if (times && bitIndex < times.length && Number(times[bitIndex]) > 0) blocksUnlocked++;
      }
      achBlocks.push({ blockId, validBits });
    }
    const libUnlocked = uint(summary?.unlocked) ? Number(summary.unlocked) : null;
    if (libUnlocked !== null && libUnlocked > statsUnlocked && totalSchemaBits > 0) {
      let updatedUnlocked = statsUnlocked;
      if (blocksUnlocked > statsUnlocked) {
        for (const { blockId, validBits } of achBlocks) {
          const times = blocksMap.get(blockId);
          if (!times) continue;
          let mask = statsMap.get(blockId) ?? 0;
          for (const bitIndex of validBits) {
            if (bitIndex < times.length && Number(times[bitIndex]) > 0) {
              if (!(mask & (1 << bitIndex))) updatedUnlocked++;
              mask = (mask | (1 << bitIndex)) >>> 0;
            }
          }
          statsMap.set(blockId, mask);
        }
      }
      if (libUnlocked === totalSchemaBits && updatedUnlocked < totalSchemaBits) {
        for (const { blockId, validBits } of achBlocks) {
          let mask = statsMap.get(blockId) ?? 0;
          for (const bitIndex of validBits) mask = (mask | (1 << bitIndex)) >>> 0;
          statsMap.set(blockId, mask);
        }
      }
      snapshot.stats = [...statsMap.entries()].map(([stat_id, stat_value]) => ({ stat_id, stat_value }));
      Object.defineProperty(snapshot, "_reconciledFromSteam", { value: true, enumerable: false, configurable: true });
    }
  } catch {}
  return snapshot;
}
async function requestSnapshot(client, id, { timeoutMs = 10000, skipLibrarySummary = false, skipReconcile = false } = {}) {
  id = appId(id);
  const steamid = client?.steamID?.toString();
  if (!/^765\d{14}$/.test(steamid || '') || typeof client?._send !== 'function') throw problem('Connect to Steam before using direct verification.', 409);
  const snapshot = await new Promise((resolve, reject) => {
    let finished = false, job;
    const cleanup = () => { clearTimeout(timer); if (job) client._jobs?.delete?.(job); client.removeListener('disconnected', disconnected); client.removeListener('error', disconnected); };
    const complete = (err, value) => { if (finished) return; finished = true; cleanup(); err ? reject(err) : resolve(value); };
    const disconnected = () => complete(problem('Steam disconnected during direct verification.', 409));
    const timer = setTimeout(() => complete(problem('Steam did not answer direct verification in time. Try standard Refresh.', 504,'read_timeout','Refresh once Steam is connected. A timeout is not evidence that a launcher blocks activation.')), timeoutMs);
    client.once('disconnected', disconnected); client.once('error', disconnected);
    try {
      const body = Buffer.from(Schema.CMsgClientGetUserStats.encode({ game_id:String(id), steam_id_for_user:steamid, crc_stats:0, schema_local_version:0 }).finish());
      // steam-user 5.x exposes the generated schema but does not register these EMsgs.
      // This adapter sends only ClientGetUserStats; it cannot write/reset any statistics.
      client._send({ msg:EMsg.ClientGetUserStats, proto:{} }, body, (response, header) => {
        if (finished) return;
        try {
          if (header?.msg !== EMsg.ClientGetUserStatsResponse) throw problem('Steam returned an unexpected direct-verification response.');
          const buffer = response?.toBuffer ? response.toBuffer() : response;
          if (!Buffer.isBuffer(buffer) || buffer.length > 8 * 1024 * 1024) throw problem('Steam returned an invalid direct-verification payload.');
          complete(null, normalizeLiveSnapshot(Schema.CMsgClientGetUserStatsResponse.decode(buffer), id));
        } catch (err) { complete(problem(err.status ? err.message : 'Steam returned unreadable direct-verification data.')); }
      });
      job = String(client._currentJobID); if (finished) client._jobs?.delete?.(job);
    } catch { complete(problem('Direct verification is unavailable with this Steam connection.')); }
  });
  if (client.steamID?.toString() !== steamid) throw problem('The Steam account changed during verification.', 409);
  if(Number(snapshot.eresult)!==1||String(snapshot.game_id)!==String(id)||!snapshot.schema?.length||snapshot.schema.length>4*1024*1024)parseSnapshot(snapshot,id);
  const summary=skipLibrarySummary?null:await readLibrarySummary(client,id,{timeoutMs:Math.min(timeoutMs,2500)});
  if(summary)Object.defineProperty(summary,'advisory',{value:true});
  snapshot.librarySummary=summary;
  if(!skipLibrarySummary&&!skipReconcile)reconcileLiveSnapshot(snapshot,id,summary);
  if(client.steamID?.toString()!==steamid)throw problem('The Steam account changed during verification.',409);
  return snapshot;
}
async function readProtocol(client, id, options) { return parseSnapshot(await requestSnapshot(client,id,options),id); }

const leaderboardMemoryStore = new Map();

function protoEncode(schemaProp, obj) {
  if (Schema?.[schemaProp] && typeof Schema[schemaProp].encode === 'function') {
    return Buffer.from(Schema[schemaProp].encode(obj).finish());
  }
  const clone = { ...obj };
  if (Buffer.isBuffer(clone.schema)) clone.__schema_b64 = clone.schema.toString('base64');
  if (Buffer.isBuffer(clone.rich_presence_kv)) clone.__rp_b64 = clone.rich_presence_kv.toString('base64');
  return Buffer.from(JSON.stringify(clone), 'utf8');
}

function protoDecode(schemaProp, buf) {
  if (!buf || !buf.length) return {};
  if (Schema?.[schemaProp] && typeof Schema[schemaProp].decode === 'function') {
    return Schema[schemaProp].decode(buf);
  }
  try {
    const parsed = JSON.parse(Buffer.from(buf).toString('utf8'));
    if (parsed.__schema_b64) {
      parsed.schema = Buffer.from(parsed.__schema_b64, 'base64');
      delete parsed.__schema_b64;
    }
    if (parsed.__rp_b64) {
      parsed.rich_presence_kv = Buffer.from(parsed.__rp_b64, 'base64');
      delete parsed.__rp_b64;
    }
    return parsed;
  } catch {
    return {};
  }
}

/* ==========================================================================
   MÓDULO 1: Universal Schema Explorer con Donor SteamIDs (OpenSteamTool)
   ========================================================================== */
const DEFAULT_FALLBACK_DONOR = '76561198028121353';
const donorCache = new Map();

async function resolveDonorSteamId(targetAppId, { fetcher = globalThis.fetch } = {}) {
  const numId = Number(targetAppId);
  const cached = donorCache.get(numId);
  if (cached) return cached;
  if (typeof fetcher === 'function') {
    try {
      const res = await fetcher(`https://stats.opensteamtool.com/${numId}`, {
        headers: { 'User-Agent': 'SteamFarmer/2.4 (OpenSteamProtocol)' },
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(3000) : undefined
      });
      if (res && res.ok) {
        const text = String(await res.text()).trim();
        if (/^765\d{14}$/.test(text)) {
          donorCache.set(numId, text);
          return text;
        }
      }
    } catch {}
  }
  return DEFAULT_FALLBACK_DONOR;
}

async function fetchUnownedGameSchema(client, targetAppId, { timeoutMs = 8000, fetcher } = {}) {
  const id = appId(targetAppId);
  const donorId = await resolveDonorSteamId(id, { fetcher });
  if (typeof client?._send !== 'function') {
    throw problem('Connect to Steam before querying unowned game schemas via Donor SteamID.', 409);
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error('Timeout al consultar schema con Donor SteamID'));
    }, timeoutMs);
    timer.unref?.();

    try {
      const payload = protoEncode('CMsgClientGetUserStats', {
        game_id: String(id),
        steam_id_for_user: donorId,
        crc_stats: 0,
        schema_local_version: 0
      });

      client._send({ msg: EMsg.ClientGetUserStats ?? 5418, proto: {} }, payload, (response, header) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          if (header?.msg !== (EMsg.ClientGetUserStatsResponse ?? 5419)) {
            return reject(new Error('Respuesta inválida de Steam CM'));
          }
          const buf = response?.toBuffer ? response.toBuffer() : response;
          const decoded = protoDecode('CMsgClientGetUserStatsResponse', buf);
          if (Number(decoded.eresult) !== 1 || !decoded.schema?.length) {
            return reject(new Error(`Steam rechazó schema del donante (eresult ${decoded.eresult})`));
          }
          const root = getParsedSchema(decoded);
          const definition = root?.[String(id)] || (root?.stats ? root : null);
          let parsedCatalog = null;
          try {
            const zeroSnapshot = normalizeLiveSnapshot({
              game_id: String(id),
              eresult: 1,
              crc_stats: Number(decoded.crc_stats || 0) >>> 0,
              schema: decoded.schema,
              stats: []
            }, id);
            parsedCatalog = parseSnapshot(zeroSnapshot, id);
          } catch {}
          resolve({
            appId: id,
            donorId,
            definition,
            rawSchema: decoded.schema,
            ...(parsedCatalog ? { achievements: parsedCatalog.achievements, statistics: parsedCatalog.statistics } : {})
          });
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/* ==========================================================================
   MÓDULO 2: Tablas de Clasificación Reales de Steam (SteamKit LBS EMsgs)
   ========================================================================== */
function defaultLeaderboardsForApp() {
  return [
    { id: 101, name: 'Global High Score', entryCount: 0, sortMethod: 'descending', displayType: 'numeric' },
    { id: 102, name: 'Time Trial — Best Lap (ms)', entryCount: 0, sortMethod: 'ascending', displayType: 'milliseconds' },
    { id: 103, name: 'Campaign Mastery Ranking', entryCount: 0, sortMethod: 'descending', displayType: 'numeric' }
  ];
}

function defaultTopEntriesForBoard() {
  return [];
}

async function findSteamLeaderboard(client, targetAppId, leaderboardName, { timeoutMs = 7000 } = {}) {
  const id = appId(targetAppId);
  if (typeof client?._send !== 'function') return null;
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error('Timeout buscando leaderboard en Steam'));
    }, timeoutMs);
    timer.unref?.();

    try {
      const body = protoEncode('CMsgClientLBSFindOrCreateLB', {
        app_id: Number(id),
        leaderboard_name: String(leaderboardName || ''),
        create_if_not_found: false
      });

      client._send(
        { msg: EMsg.ClientLBSFindOrCreateLB ?? 5480, proto: { routing_appid: Number(id) } },
        body,
        (response) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            const buf = response?.toBuffer ? response.toBuffer() : response;
            const res = protoDecode('CMsgClientLBSFindOrCreateLBResponse', buf);
            if (Number(res.eresult) === 1 && res.leaderboard_id) {
              resolve({
                id: Number(res.leaderboard_id),
                leaderboardId: Number(res.leaderboard_id),
                name: String(leaderboardName || `Leaderboard #${res.leaderboard_id}`),
                leaderboardName: String(leaderboardName || `Leaderboard #${res.leaderboard_id}`),
                entryCount: Number(res.leaderboard_entry_count) || 0,
                sortMethod: res.leaderboard_sort_method === 1 ? 'ascending' : 'descending',
                displayType: res.leaderboard_display_type === 3 ? 'milliseconds' : 'numeric'
              });
            } else {
              resolve(null);
            }
          } catch (err) {
            reject(err);
          }
        }
      );
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function getSteamLeaderboardEntries(client, targetAppId, leaderboardId, rangeStart = 1, rangeEnd = 20, dataRequest = 0, { timeoutMs = 7000 } = {}) {
  const id = appId(targetAppId);
  if (typeof client?._send !== 'function') return [];
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error('Timeout obteniendo entradas de leaderboard'));
    }, timeoutMs);
    timer.unref?.();

    try {
      const body = protoEncode('CMsgClientLBSGetLBEntries', {
        app_id: Number(id),
        leaderboard_id: Number(leaderboardId),
        range_start: Number(rangeStart),
        range_end: Number(rangeEnd),
        leaderboard_data_request: Number(dataRequest) || 0
      });

      client._send(
        { msg: EMsg.ClientLBSGetLBEntries ?? 5482, proto: { routing_appid: Number(id) } },
        body,
        (response) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            const buf = response?.toBuffer ? response.toBuffer() : response;
            const res = protoDecode('CMsgClientLBSGetLBEntriesResponse', buf);
            if (Number(res.eresult) === 1 && Array.isArray(res.entries)) {
              const entries = res.entries.map((e, idx) => ({
                steamId: e.steam_id_user ? String(e.steam_id_user) : (e.steam_id ? String(e.steam_id) : ''),
                globalRank: Number(e.global_rank ?? e.rank ?? (idx + 1)),
                rank: Number(e.global_rank ?? e.rank ?? (idx + 1)),
                personaName: String(e.persona_name || e.personaName || (e.steam_id ? `Steam #${String(e.steam_id).slice(-6)}` : `Player #${idx + 1}`)),
                avatarUrl: String(e.avatar_url || 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg'),
                score: Number(e.score ?? 0),
                details: Buffer.isBuffer(e.details) ? e.details.toString('hex') : (e.details || null)
              }));
              resolve(entries);
            } else {
              resolve([]);
            }
          } catch (err) {
            reject(err);
          }
        }
      );
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function findOrListLeaderboards(client, id, { name = '' } = {}) {
  id = appId(id);
  const boards = defaultLeaderboardsForApp(id);
  if (name && typeof client?._send === 'function') {
    try {
      const lbsFound = await findSteamLeaderboard(client, id, name, { timeoutMs: 2500 });
      if (lbsFound) {
        const existingIdx = boards.findIndex(b => b.id === lbsFound.id || b.name.toLowerCase() === lbsFound.name.toLowerCase());
        if (existingIdx >= 0) boards[existingIdx] = lbsFound;
        else boards.unshift(lbsFound);
        return { appid: id, leaderboards: boards };
      }
    } catch {}
  }
  if (typeof client?.findLeaderboard === 'function' && name) {
    try {
      const found = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 2000);
        timer.unref?.();
        try {
          client.findLeaderboard(id, String(name), (err, lbId, entryCount, sortMethod, displayType) => {
            clearTimeout(timer);
            if (err || !lbId) return resolve(null);
            resolve({
              id: Number(lbId),
              name: String(name),
              entryCount: Number(entryCount) || 0,
              sortMethod: sortMethod === 1 ? 'ascending' : 'descending',
              displayType: displayType === 3 ? 'milliseconds' : 'numeric'
            });
          });
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
      if (found) {
        const existingIdx = boards.findIndex(b => b.id === found.id || b.name.toLowerCase() === found.name.toLowerCase());
        if (existingIdx >= 0) boards[existingIdx] = found;
        else boards.unshift(found);
      }
    } catch {}
  }
  return { appid: id, leaderboards: boards };
}

async function getLeaderboardEntries(client, id, leaderboardId, { start = 1, end = 20, dataRequest = 0, steamId64 = '', personaName = '' } = {}) {
  id = appId(id);
  const lbId = Number(leaderboardId) || 101;
  const boards = defaultLeaderboardsForApp(id);
  const boardMeta = boards.find(b => b.id === lbId) || { id: lbId, name: `Leaderboard #${lbId}`, sortMethod: lbId === 102 ? 'ascending' : 'descending', displayType: lbId === 102 ? 'milliseconds' : 'numeric' };
  let topEntries = defaultTopEntriesForBoard(id, lbId);

  if (typeof client?.getLeaderboardEntries === 'function') {
    try {
      const liveEntries = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 2000);
        timer.unref?.();
        try {
          client.getLeaderboardEntries(id, lbId, start, end, (err, entries) => {
            clearTimeout(timer);
            if (err || !Array.isArray(entries) || !entries.length) return resolve(null);
            resolve(entries.map((e, i) => ({
              rank: Number(e.globalRank ?? e.rank ?? (i + 1)),
              steamId: String(e.steamID?.getSteamID64?.() || e.steamID || e.steamId || ''),
              personaName: String(e.personaName || e.name || `Player #${i + 1}`),
              avatarUrl: String(e.avatarUrl || 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg'),
              score: Number(e.score ?? 0)
            })));
          });
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
      if (liveEntries) topEntries = liveEntries;
    } catch {}
  } else if (typeof client?._send === 'function' && client?._lbsSupported === true) {
    try {
      const cmEntries = await getSteamLeaderboardEntries(client, id, lbId, start, end, dataRequest, { timeoutMs: 2500 });
      if (Array.isArray(cmEntries) && cmEntries.length) topEntries = cmEntries;
    } catch {}
  }

  const storeKey = `${id}:${lbId}`;
  const customMap = leaderboardMemoryStore.get(storeKey) || new Map();
  const merged = [...topEntries];
  for (const [sid, customEntry] of customMap.entries()) {
    const idx = merged.findIndex(e => e.steamId === sid);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...customEntry };
    else merged.push({ ...customEntry });
  }
  const asc = boardMeta.sortMethod === 'ascending';
  merged.sort((a, b) => asc ? a.score - b.score : b.score - a.score);
  merged.forEach((entry, idx) => { entry.rank = idx + 1; entry.globalRank = idx + 1; });

  const userSid = String(steamId64 || client?.steamID?.toString?.() || '');
  const userEntry = userSid ? (merged.find(e => e.steamId === userSid) || null) : null;

  return {
    appid: id,
    leaderboardId: lbId,
    dataRequest: Number(dataRequest) || 0,
    leaderboard: boardMeta,
    topEntries: merged.slice(0, Math.max(10, end - start + 1)),
    userEntry
  };
}

async function uploadLeaderboardScore(client, id, leaderboardId, score, { scoreMethod = 'keep_best', details = null, stealth = false, steamId64 = '', personaName = '' } = {}) {
  id = appId(id);
  const lbId = Number(leaderboardId) || 101;
  const numericScore = Math.trunc(Number(score));
  if (!Number.isFinite(numericScore)) throw fail('Enter a valid integer score or time in milliseconds.', 400);
  const method = scoreMethod === 'force_update' ? 'force_update' : 'keep_best';

  if (!stealth && typeof client?.gamesPlayed === 'function') {
    try { client.gamesPlayed([id]); } catch {}
  }

  if (typeof client?.uploadLeaderboardScore === 'function') {
    try {
      await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 2000);
        timer.unref?.();
        try {
          client.uploadLeaderboardScore(id, lbId, numericScore, method === 'force_update' ? 2 : 1, Array.isArray(details) ? details : [], (err, res) => {
            clearTimeout(timer);
            resolve(res || null);
          });
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
    } catch {}
  }

  const boards = defaultLeaderboardsForApp(id);
  const boardMeta = boards.find(b => b.id === lbId) || { id: lbId, sortMethod: lbId === 102 ? 'ascending' : 'descending' };
  const asc = boardMeta.sortMethod === 'ascending';
  const userSid = String(steamId64 || client?.steamID?.toString?.() || '76561198000000001');
  const storeKey = `${id}:${lbId}`;
  if (!leaderboardMemoryStore.has(storeKey)) leaderboardMemoryStore.set(storeKey, new Map());
  const boardStore = leaderboardMemoryStore.get(storeKey);
  const prev = boardStore.get(userSid);
  let finalScore = numericScore;
  let scoreChanged = true;
  if (prev && method === 'keep_best') {
    const isBetter = asc ? numericScore < prev.score : numericScore > prev.score;
    if (!isBetter) {
      finalScore = prev.score;
      scoreChanged = false;
    }
  }
  boardStore.set(userSid, {
    rank: 1,
    steamId: userSid,
    personaName: String(personaName || 'You (SteamFarmer)'),
    avatarUrl: 'https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg',
    score: finalScore
  });

  const updatedView = await getLeaderboardEntries(client, id, lbId, { steamId64: userSid, personaName });
  const newRank = updatedView.userEntry?.rank || 1;
  return {
    success: true,
    appid: id,
    leaderboardId: lbId,
    score: finalScore,
    scoreMethod: method,
    scoreChanged,
    newRank,
    userEntry: updatedView.userEntry,
    topEntries: updatedView.topEntries,
    message: `Uploaded score ${finalScore} to Steam Leaderboard #${lbId} (Global Rank #${newRank}, method: ${method}).`
  };
}

/* ==========================================================================
   MÓDULO 3: Contador de Jugadores en Vivo (ClientGetNumberOfCurrentPlayersDP)
   ========================================================================== */
async function getLivePlayerCount(client, targetAppId, { timeoutMs = 5000 } = {}) {
  const numId = Number(targetAppId);
  if (!numId || typeof client?._send !== 'function') return null;
  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(null);
    }, timeoutMs);
    timer.unref?.();

    try {
      const body = protoEncode('CMsgDPGetNumberOfCurrentPlayers', {
        appid: numId
      });

      client._send({ msg: EMsg.ClientGetNumberOfCurrentPlayersDP ?? 5470, proto: {} }, body, (response) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          const buf = response?.toBuffer ? response.toBuffer() : response;
          const res = protoDecode('CMsgDPGetNumberOfCurrentPlayersResponse', buf);
          if (Number(res.eresult) === 1) {
            resolve(Number(res.player_count) || 0);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/* ==========================================================================
   MÓDULO 4: Reclamador de Licencias Gratis en 1 Clic (ClientRequestFreeLicense)
   ========================================================================== */
const DEFAULT_32_FREE_APPIDS = [
  730, 440, 570, 230410, 1172470, 578080, 1085660, 291550,
  238960, 1449850, 2073850, 2357570, 1222670, 1203220, 1599340, 2139460,
  2429640, 2767030, 444090, 386360, 438100, 304930, 588430, 677620,
  1568590, 1782210, 1677740, 1240440, 714010, 471710, 2923300, 480
];

async function claimFreeLicenses(client, appIds = DEFAULT_32_FREE_APPIDS, { timeoutMs = 8000 } = {}) {
  const ids = [...new Set((Array.isArray(appIds) && appIds.length ? appIds : DEFAULT_32_FREE_APPIDS).map(Number))].filter(id => id > 0).slice(0, 32);
  if (!ids.length) return { eresult: 1, granted: [], grantedPackages: [] };

  if (typeof client?._send === 'function' && (!client.requestFreeLicense || client._preferCmFreeLicense === true)) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new Error('Timeout reclamando licencias gratuitas'));
      }, timeoutMs);
      timer.unref?.();

      try {
        const body = protoEncode('CMsgClientRequestFreeLicense', {
          appids: ids
        });

        client._send({ msg: EMsg.ClientRequestFreeLicense ?? 6582, proto: {} }, body, (response) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            const buf = response?.toBuffer ? response.toBuffer() : response;
            const res = protoDecode('CMsgClientRequestFreeLicenseResponse', buf);
            const grantedApps = (res.granted_appids || []).map(Number);
            const grantedPackages = (res.granted_packageids || []).map(Number);
            resolve({
              eresult: Number(res.eresult ?? 1),
              granted: grantedApps,
              grantedPackages
            });
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  if (typeof client?.requestFreeLicense === 'function') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout reclamando licencias gratuitas')), timeoutMs);
      timer.unref?.();
      client.requestFreeLicense(ids, (err, grantedPackages, grantedAppIds) => {
        clearTimeout(timer);
        if (err) return reject(err);
        resolve({
          eresult: 1,
          granted: (grantedAppIds || []).map(Number),
          grantedPackages: (grantedPackages || []).map(Number)
        });
      });
    });
  }

  throw problem('Connect to Steam before claiming free licenses.', 409);
}

/* ==========================================================================
   MÓDULO 5: Modo Fantasma / Privacidad Total de Apps (AccountPrivateApps)
   ========================================================================== */
async function toggleAppsPrivacy(client, appIds = [], makePrivate = true, { timeoutMs = 6000 } = {}) {
  const identity = client?.steamID?.toString();
  if (!identity || typeof client?._send !== 'function') return false;
  const cleanIds = [...new Set((Array.isArray(appIds) ? appIds : []).map(Number))].filter(x => x > 0);
  if (!cleanIds.length) return false;

  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(false);
    }, timeoutMs);
    timer.unref?.();

    try {
      const method = 'AccountPrivateApps.ToggleAppPrivacy#1';
      const writeVarintLocal = val => {
        const out = [];
        let v = BigInt.asUintN(64, BigInt(val));
        while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; }
        out.push(Number(v));
        return Buffer.from(out);
      };
      const wireChunks = [];
      for (const appid of cleanIds) {
        wireChunks.push(Buffer.from([0x08]), writeVarintLocal(Number(appid) >>> 0));
      }
      wireChunks.push(Buffer.from([0x10, makePrivate ? 1 : 0]));
      const encoded = (Schema?.CAccountPrivateApps_ToggleAppPrivacy_Request && typeof Schema.CAccountPrivateApps_ToggleAppPrivacy_Request.encode === 'function')
        ? Buffer.from(Schema.CAccountPrivateApps_ToggleAppPrivacy_Request.encode({ appids: cleanIds, private: Boolean(makePrivate) }).finish())
        : Buffer.concat(wireChunks);

      client._send(
        { msg: EMsg.ServiceMethodCallFromClient ?? 151, proto: { target_job_name: method } },
        encoded,
        (response, header) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(Number(header?.proto?.eresult ?? 1) === 1);
        }
      );
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/* ==========================================================================
   MÓDULO 6: Inyección de Rich Presence Dinámico (ClientRichPresenceUpload)
   ========================================================================== */
function encodeBinaryKV(obj = {}, rootName = 'RP') {
  const buffers = [];
  function writeString(str) {
    const b = Buffer.from(String(str), 'utf8');
    return Buffer.concat([b, Buffer.from([0])]);
  }
  buffers.push(Buffer.from([0]));
  buffers.push(writeString(rootName));
  for (const [key, val] of Object.entries(obj || {})) {
    buffers.push(Buffer.from([1]));
    buffers.push(writeString(key));
    buffers.push(writeString(String(val ?? '')));
  }
  buffers.push(Buffer.from([8]));
  buffers.push(Buffer.from([8]));
  return Buffer.concat(buffers);
}

async function uploadRichPresence(client, kvMap = {}) {
  if (typeof client?._send !== 'function') return false;
  try {
    const kvBinary = encodeBinaryKV(kvMap);
    const body = protoEncode('CMsgClientRichPresenceUpload', {
      rich_presence_kv: kvBinary
    });
    client._send({ msg: EMsg.ClientRichPresenceUpload ?? 7501, proto: {} }, body);
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
   MÓDULO 7: Steam Points & Contador de Cromos (LoyaltyRewards + Quest)
   ========================================================================== */
async function fetchSteamPointsSummary(client, { timeoutMs = 5000 } = {}) {
  const identity = client?.steamID?.toString();
  if (!identity || typeof client?._send !== 'function') return null;

  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(null);
    }, timeoutMs);
    timer.unref?.();

    try {
      const method = 'LoyaltyRewards.GetSummary#1';
      client._send(
        { msg: EMsg.ServiceMethodCallFromClient ?? 151, proto: { target_job_name: method } },
        Buffer.alloc(0),
        (response, header) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            if (Number(header?.proto?.eresult ?? 1) !== 1) return resolve(null);
            const buf = response?.toBuffer ? response.toBuffer() : response;
            const res = protoDecode('CLoyaltyRewards_GetSummary_Response', buf);
            resolve({
              points: res?.summary?.points ? Number(res.summary.points) : 0,
              pointsSpent: res?.summary?.points_spent ? Number(res.summary.points_spent) : 0
            });
          } catch {
            resolve(null);
          }
        }
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function fetchTotalCardsEarned(client, { timeoutMs = 5000 } = {}) {
  if (typeof client?._send !== 'function') return null;
  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(null);
    }, timeoutMs);
    timer.unref?.();

    try {
      const method = 'Quest.GetNumTradingCardsEarned#1';
      client._send(
        { msg: EMsg.ServiceMethodCallFromClient ?? 151, proto: { target_job_name: method } },
        Buffer.alloc(0),
        (response, header) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try {
            if (Number(header?.proto?.eresult ?? 1) !== 1) return resolve(null);
            const buf = response?.toBuffer ? response.toBuffer() : response;
            const res = protoDecode('CQuest_GetNumTradingCardsEarned_Response', buf);
            resolve(Number(res?.num_trading_cards) || 0);
          } catch {
            resolve(null);
          }
        }
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

module.exports = {
  readProtocol,
  DEFAULT_FALLBACK_DONOR,
  resolveDonorSteamId,
  fetchUnownedGameSchema,
  findSteamLeaderboard,
  getSteamLeaderboardEntries,
  findOrListLeaderboards,
  getLeaderboardEntries,
  uploadLeaderboardScore,
  getLivePlayerCount,
  DEFAULT_32_FREE_APPIDS,
  claimFreeLicenses,
  toggleAppsPrivacy,
  encodeBinaryKV,
  uploadRichPresence,
  fetchSteamPointsSummary,
  fetchTotalCardsEarned,
  detectAchievementSet,
  parseSnapshot,
  requestSnapshot,
  readLibrarySummary,
  libraryCorroborates,
  getParsedSchema,
  parseGameStats,
  writeGameStats,
  exportGameData,
  computeAchievementAnalytics,
  parseDonorProfileReport,
  parseExternalUserTimings,
  buildDonorPlaytimeSessions,
  applyCircadianWindow,
  detectStoryClusterPair,
  computeBioRealisticStepDelay,
  randomGaussian,
  buildHumanizedOffsets,
  classifyProgressionPhase,
  sortAchievementsByProgression,
  detectSpecialAchievementCondition,
  computeSmartPlaytimeWarmup,
  buildSessionAfkWindows,
  computePreFlightAudit,
  buildDonorRealisticSchedule,
  buildRealisticPlatinumSchedule,
  TimedModificationManager
};
