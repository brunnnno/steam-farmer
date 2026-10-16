'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Detects if the official Steam desktop client is installed locally on the host machine.
 * Returns { detected: boolean, path: string|null }
 */
function detectLocalSteamClient() {
  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(process.env.LOCALAPPDATA || '', 'Steam'),
    '/usr/games/steam',
    path.join(process.env.HOME || '', '.steam', 'steam')
  ];
  for (const p of commonPaths) {
    if (p && fs.existsSync(p)) {
      return { detected: true, path: p };
    }
  }
  return { detected: false, path: null };
}

/**
 * Ensures the target game is registered in Steam client's active session (`gamesPlayed`)
 * before dispatching a store-stats protobuf, replicating SAM's in-game unlock condition.
 *
 * @param {object} client - Steam client instance with gamesPlayed method
 * @param {number} appid - Target game AppID
 * @param {object} options - { stealth: boolean, currentPlayed: Array<number> }
 * @returns {Array<number>} The updated gamesPlayed list
 */
function ensureInGameBeforeStore(client, appid, { stealth = false, currentPlayed = [] } = {}) {
  if (stealth) return currentPlayed;
  const targetId = Number(appid);
  const existing = Array.isArray(currentPlayed) ? currentPlayed.filter(x => typeof x === 'number') : [];
  const nextList = [targetId, ...existing.filter(x => x !== targetId)].slice(0, 32);
  if (typeof client?.gamesPlayed === 'function') {
    client.gamesPlayed(nextList);
  }
  return nextList;
}

module.exports = {
  detectLocalSteamClient,
  ensureInGameBeforeStore
};
