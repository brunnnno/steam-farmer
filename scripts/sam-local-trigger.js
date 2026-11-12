'use strict';
const fs = require('node:fs');

function detectLocalSteamClient() {
  const candidates = [
    process.env.STEAM_PATH,
    'C:\\Program Files (x86)\\Steam\\steam.exe',
    '/Applications/Steam.app',
    `${process.env.HOME || ''}/.steam/steam.pid`
  ].filter(Boolean);
  const found = candidates.some(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  return { detected: Boolean(found), platform: process.platform };
}

function ensureInGameBeforeStore(client, appid, { stealth = false, currentPlayed = [] } = {}) {
  const numericApp = Number(appid);
  const base = Array.isArray(currentPlayed) ? currentPlayed.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (stealth || !Number.isInteger(numericApp) || numericApp <= 0) {
    return base.slice(0, 32);
  }
  const nextList = [numericApp, ...base.filter(id => id !== numericApp)].slice(0, 32);
  if (client && typeof client.gamesPlayed === 'function') {
    client.gamesPlayed(nextList);
  }
  return nextList;
}

module.exports = { detectLocalSteamClient, ensureInGameBeforeStore };
