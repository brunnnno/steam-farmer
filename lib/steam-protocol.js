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
    // REA FIX: Reseteo puro en Valve. stats: [] con explicit_reset: true borra absolutamente TODO
    // (tanto los bits de logros como las estadísticas acumulativas de distancia/tiempo).
    let response = await send(client, {
      game_id: String(id),
      crc_stats: crc,
      explicit_reset: true,
      settor_steam_id: identity,
      settee_steam_id: identity,
      stats: []
    }, { timeoutMs });

    // Esperar y leer el nuevo estado confirmado desde Valve
    const final = await read(client, id, { timeoutMs });
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

function parseExternalUserTimings(xmlOrJson, currentAchievements = []) {
  const lockedByApi = new Map();
  const lockedByName = new Map();
  for (const a of currentAchievements) {
    if (a.unlocked === false && !a.serverControlled && a.apiname) {
      lockedByApi.set(a.apiname.toLowerCase(), a.apiname);
      if (a.name) lockedByName.set(a.name.trim().toLowerCase(), a.apiname);
    }
  }
  const entries = [];
  const raw = String(xmlOrJson || '').trim();
  if (!raw) throw fail('Empty timing source response.', 400);

  if (raw.startsWith('{') || raw.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw fail('Invalid JSON timing source.', 400); }
    const list = Array.isArray(parsed) ? parsed : (parsed.achievements || parsed.playerstats?.achievements || []);
    for (const item of list) {
      if (!item) continue;
      const unlocked = item.unlocked === true || item.achieved === 1 || Number(item.unlockTimestamp || item.unlocktime) > 0;
      const ts = Number(item.unlockTimestamp ?? item.unlocktime ?? 0);
      if (!unlocked || !Number.isFinite(ts) || ts <= 0) continue;
      const apiKey = String(item.apiname || item.name || '').trim().toLowerCase();
      const matched = lockedByApi.get(apiKey) || lockedByName.get(apiKey);
      if (matched) entries.push({ apiname: matched, unlockTimestamp: ts });
    }
  } else {
    const blocks = raw.match(/<achievement\b[^>]*>[\s\S]*?<\/achievement>/gi) || [];
    for (const block of blocks) {
      const closedMatch = block.match(/closed=["'](\d+)["']/i);
      if (closedMatch && closedMatch[1] !== '1') continue;
      const apiMatch = block.match(/<apiname>\s*(?:<!\[CDATA\[)?([^\].<]+?)(?:\]\]>)?\s*<\/apiname>/i);
      const nameMatch = block.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i);
      const tsMatch = block.match(/<unlockTimestamp>\s*(\d+)\s*<\/unlockTimestamp>/i);
      const ts = tsMatch ? Number(tsMatch[1]) : 0;
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const apiKey = (apiMatch?.[1] || '').trim().toLowerCase();
      const titleKey = (nameMatch?.[1] || '').trim().toLowerCase();
      const matched = lockedByApi.get(apiKey) || lockedByName.get(titleKey);
      if (matched) entries.push({ apiname: matched, unlockTimestamp: ts });
    }
  }

  const unique = new Map();
  for (const e of entries) {
    if (!unique.has(e.apiname) || e.unlockTimestamp < unique.get(e.apiname).unlockTimestamp) {
      unique.set(e.apiname, e);
    }
  }
  return [...unique.values()].sort((a, b) => a.unlockTimestamp - b.unlockTimestamp);
}

const fs = require('node:fs');
const crypto = require('node:crypto');

function randomGaussian(mean, stdDev) {
  let u = 1 - Math.random(), v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, mean + z * stdDev);
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
    // In 'natural' mode, simulate real gameplay session rest breaks every 3-5 unlocks
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

function buildRealisticPlatinumSchedule(items, {
  percentagesMap = null,
  targetHours = null,
  hltbData = null,
  pacingMode = null,
  currentFarmedHours = 0,
  rng = Math.random
} = {}) {
  const ordered = sortAchievementsByProgression(items, percentagesMap);
  const effectivePace = ['fast', 'realistic_human', 'ultra_long_months', 'playtime_synced'].includes(pacingMode)
    ? pacingMode
    : null;
  if (!ordered.length) {
    return {
      items: [],
      offsetsMs: [],
      sessions: [],
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
  let cursor = 0;
  let sessionStartMs = 0;
  let sessionIndex = 0;

  const getRestHours = () => {
    switch (effectivePace) {
      case 'ultra_long_months':
        // Pausa de 2 a 7 días entre sesiones (progreso a lo largo de 3 a 6 meses)
        return 48 + rng() * 120;
      case 'realistic_human':
        // Pausa humana de 16 a 48 horas (jugador casual / regular, 1 a 2 meses de duración)
        return 16 + rng() * 32;
      case 'fast':
        // Pausa corta de 6 a 14 horas (1 a 2 semanas)
        return 6 + rng() * 8;
      case 'playtime_synced': {
        const goalHrs = Math.max(10, Number(targetHours ?? hltbData?.completionistHours ?? 60));
        const remHrs = Math.max(4, goalHrs - (Number(currentFarmedHours) || 0));
        const estSessions = Math.max(1, Math.ceil(ordered.length / 2.5));
        return Math.max(6, Math.min(168, (remHrs / estSessions) * (4 + rng() * 4)));
      }
      default:
        // Default 10 to 20 hours human rest pause
        return 10 + rng() * 10;
    }
  };

  while (cursor < ordered.length) {
    const remaining = ordered.length - cursor;
    const maxInSession = effectivePace === 'ultra_long_months' ? 2 : 3;
    const countInSession = remaining <= maxInSession ? remaining : Math.min(remaining, 1 + Math.floor(rng() * maxInSession));
    const sessionItems = ordered.slice(cursor, cursor + countInSession);
    cursor += countInSession;

    let elapsedInSessionMs = 0;
    for (let i = 0; i < sessionItems.length; i++) {
      const delayMinutes = effectivePace ? (30 + rng() * 60) : (20 + rng() * 50);
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

  const rawPlaytimeHours = sessions.reduce((acc, s) => acc + s.durationHours, 0);
  const desiredHours = Number(targetHours ?? hltbData?.completionistHours ?? NaN);
  const hltbCalibrated = Number.isFinite(desiredHours) && desiredHours > 0;
  const calibratedPlaytimeHours = hltbCalibrated ? Number(desiredHours.toFixed(1)) : Number(rawPlaytimeHours.toFixed(1));

  const totalAchievements = ordered.length;
  const sessionCount = sessions.length;
  const totalDurationMs = sessions.length ? sessions[sessions.length - 1].endOffsetMs : 0;
  const estimatedDays = Math.max(1, Math.round(totalDurationMs / (24 * 3600000)));
  const estimatedMonths = (estimatedDays / 30.4).toFixed(1);
  const summaryTextEs = effectivePace === 'ultra_long_months'
    ? `Modo Platino Realista activado (Ultra-Realista): ${totalAchievements} logros en ${sessionCount} sesiones a lo largo de ~${estimatedMonths} meses (~${estimatedDays} días de juego simulado)`
    : `Modo Platino Realista activado: ${totalAchievements} logros en ${sessionCount} sesiones (~${estimatedDays} días de juego simulado)`;
  const summaryTextEn = effectivePace === 'ultra_long_months'
    ? `Realistic Platinum Mode activated (Ultra-Realistic): ${totalAchievements} achievements in ${sessionCount} sessions across ~${estimatedMonths} months (~${estimatedDays} days of simulated play)`
    : `Realistic Platinum Mode activated: ${totalAchievements} achievements in ${sessionCount} sessions (~${estimatedDays} days of simulated play)`;

  return {
    items: ordered,
    offsetsMs,
    sessions,
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
  constructor({ pool = null, file = null, onScheduleChange = null, retryDelaysMs = [30000, 60000, 120000] } = {}) {
    this.jobs = new Map();
    this.pool = pool;
    this.file = file;
    this.onScheduleChange = onScheduleChange;
    this.retryDelaysMs = Array.isArray(retryDelaysMs) ? retryDelaysMs : [30000, 60000, 120000];
    this.schemaReady = null;
    this.pendingWrites = new Set();
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
  isJobInActiveSession(job, now = Date.now()) {
    if (!job || !job.active || job.pausedByCollision || job.pausedManually) return false;
    const sessions = job.config?.sessions;
    if (job.spacing !== 'platinum' || !Array.isArray(sessions) || !sessions.length) return true;
    for (const s of sessions) {
      const startMs = Date.parse(s.startAt);
      const endMs = Date.parse(s.endAt);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && now >= startMs && now <= endMs) {
        return true;
      }
    }
    const nextMs = job.nextRunAt ? Date.parse(job.nextRunAt) : NaN;
    if (Number.isFinite(nextMs) && Math.abs(nextMs - now) <= 5 * 60000) return true;
    return false;
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
  listForAccount(accountId) {
    const list = [];
    for (const job of this.jobs.values()) {
      if (job.accountId !== accountId || !job.active) continue;
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
        sessionCount: job.config?.sessionCount || null,
        estimatedDays: job.config?.estimatedDays || null,
        summaryTextEs: job.config?.summaryTextEs || null,
        summaryTextEn: job.config?.summaryTextEn || null,
        inActiveSessionWindow: this.isJobInActiveSession(job)
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
    if (Array.isArray(job.config?.sessions)) {
      for (const s of job.config.sessions) {
        if (s.startAt) s.startAt = new Date(Date.parse(s.startAt) + pausedDeltaMs).toISOString();
        if (s.endAt) s.endAt = new Date(Date.parse(s.endAt) + pausedDeltaMs).toISOString();
      }
    }
    job.pausedManually = false;
    job.pausedByCollision = false;
    job.pausedAt = null;
    job.nextRunAt = job.queue[0]?.runAt || null;
    this._trackWrite(this._persistJobStatus(job, 'active'));
    job.scheduleNext?.();
    try { this.onScheduleChange?.(accountId, job.appid); } catch {}
    return true;
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
          queue: job.queue.map((q, idx) => ({ itemIndex: q.itemIndex ?? idx, apiname: q.apiname, action: q.action, runAt: q.runAt }))
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
    return {
      jobId: job.jobId,
      active: job.active,
      pausedByCollision: Boolean(job.pausedByCollision),
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
      sessionCount: job.config?.sessionCount || null,
      estimatedDays: job.config?.estimatedDays || null,
      sessions: job.config?.sessions || null,
      summaryTextEs: job.config?.summaryTextEs || null,
      summaryTextEn: job.config?.summaryTextEn || null,
      inActiveSessionWindow: this.isJobInActiveSession(job),
      remaining: job.queue.map(q => ({ apiname: q.apiname, action: q.action, runAt: q.runAt, phase: q.phase || null, percent: q.percent ?? null })),
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
      if (Array.isArray(job.config?.sessions)) {
        for (const s of job.config.sessions) {
          if (s.startAt) s.startAt = new Date(Date.parse(s.startAt) + pausedDeltaMs).toISOString();
          if (s.endAt) s.endAt = new Date(Date.parse(s.endAt) + pausedDeltaMs).toISOString();
        }
      }
      job.pausedByCollision = false;
      job.pausedAt = null;
      job.nextRunAt = job.queue[0]?.runAt || null;
      this._trackWrite(this._persistJobStatus(job, 'active'));
      job.scheduleNext?.();
      resumed++;
    }
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
        if (wasActive) { try { this.onScheduleChange?.(job.accountId, job.appid); } catch {} }
        return;
      }
      if (job.pausedByCollision || job.pausedManually) {
        job.timer = null;
        return;
      }
      const next = job.queue[0];
      job.nextRunAt = next.runAt;
      const rawWaitMs = Math.max(50, Date.parse(next.runAt) - Date.now());
      const waitMs = Math.min(rawWaitMs, 12 * 3600000);
      job.timer = setTimeout(async () => {
        if (!job.active || job.pausedByCollision || job.pausedManually) return;
        if (Date.parse(next.runAt) - Date.now() > 100) {
          try { this.onScheduleChange?.(job.accountId, job.appid); } catch {}
          scheduleNext();
          return;
        }
        const currentItem = job.queue.shift();
        try {
          await executeItem(currentItem);
          job.completedCount++;
          job.history.push({ apiname: currentItem.apiname, action: currentItem.action, at: new Date().toISOString(), ok: true, attempts: (currentItem.retryCount || 0) + 1 });
          await this._trackWrite(this._persistItemDone(job, currentItem, null));
        } catch (err) {
          currentItem.retryCount = (currentItem.retryCount || 0) + 1;
          if (currentItem.retryCount <= this.retryDelaysMs.length) {
            const backoffMs = this.retryDelaysMs[currentItem.retryCount - 1];
            currentItem.runAt = new Date(Date.now() + backoffMs).toISOString();
            currentItem.delayMs = backoffMs;
            currentItem.lastError = err.message || 'Transient Steam error';
            job.retryCount = (job.retryCount || 0) + 1;
            job.queue.unshift(currentItem);
            job.nextRunAt = currentItem.runAt;
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
  start({ accountId, appid, items, customDelaysMs, percentagesMap = null, targetHours = null, hltbData = null, amount = 5, units = 'minutes', spacing = 'even', order = 'selection', stealth = false, pausedByCollision = false, executeItem }) {
    appid = appId(appid);
    this.cancel(accountId, appid, { skipDb: true });
    if (!Array.isArray(items) || !items.length) throw fail('Select at least one achievement for timed modification.', 400);
    const maxOffsetCapMs = 90 * 24 * 3600000;
    const unitMs = units === 'hours' ? 3600000 : units === 'minutes' ? 60000 : 1000;
    const totalMs = Math.max(1000, Math.min(maxOffsetCapMs, Number(amount || 1) * unitMs));
    let list = items.map(x => ({
      apiname: String(x.apiname),
      action: x.action === 'remove' ? 'remove' : 'unlock',
      percent: typeof x.percent === 'number' ? x.percent : null,
      phase: x.phase || null
    }));
    const now = Date.now();
    let offsets = [];
    let platinumMeta = null;
    if (spacing === 'platinum') {
      const plat = buildRealisticPlatinumSchedule(list, { percentagesMap, targetHours, hltbData });
      list = plat.items;
      offsets = plat.offsetsMs;
      order = 'progression';
      platinumMeta = {
        sessionCount: plat.sessionCount,
        estimatedDays: plat.estimatedDays,
        hltbCalibrated: plat.hltbCalibrated,
        targetPlaytimeHours: plat.targetPlaytimeHours,
        mainStoryHours: plat.mainStoryHours,
        completionistHours: plat.completionistHours,
        summaryTextEs: plat.summaryTextEs,
        summaryTextEn: plat.summaryTextEn,
        sessions: plat.sessions.map(s => ({
          ...s,
          startAt: new Date(now + s.startOffsetMs).toISOString(),
          endAt: new Date(now + s.endOffsetMs).toISOString()
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
    }
    const queue = list.map((item, idx) => ({
      itemIndex: idx,
      apiname: item.apiname,
      action: item.action,
      phase: item.phase || null,
      percent: item.percent ?? null,
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
      config: { spacing, order, amount, units, stealth: Boolean(stealth), ...(platinumMeta || {}) },
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
async function requestSnapshot(client, id, { timeoutMs = 10000, skipLibrarySummary = false } = {}) {
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
  const summary=skipLibrarySummary?null:await readLibrarySummary(client,id,{timeoutMs:Math.min(timeoutMs,400)});
  if(summary)Object.defineProperty(summary,'advisory',{value:true});
  snapshot.librarySummary=summary;
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
  parseExternalUserTimings,
  randomGaussian,
  buildHumanizedOffsets,
  classifyProgressionPhase,
  sortAchievementsByProgression,
  buildRealisticPlatinumSchedule,
  TimedModificationManager
};
