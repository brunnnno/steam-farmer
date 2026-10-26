"use strict";

const fs = require("fs");
const path = require("path");

function detectLocalSteamClient() {
  const candidates = [
    process.env.STEAM_INSTALL_PATH,
    "C:\\Program Files (x86)\\Steam\\steam.exe",
    "C:\\Program Files\\Steam\\steam.exe",
    path.join(process.env.HOME || "", ".steam", "steam", "steam.sh"),
    "/Applications/Steam.app"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return { detected: true, path: candidate };
      }
    } catch (_) {}
  }
  return { detected: false, path: null };
}

function ensureInGameBeforeStore(client, appid, { stealth = false, currentPlayed = [] } = {}) {
  const numericAppId = Number(appid) || 0;
  const baseList = Array.isArray(currentPlayed)
    ? currentPlayed.map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== numericAppId)
    : [];
  const nextList = numericAppId > 0 ? [numericAppId, ...baseList].slice(0, 32) : baseList.slice(0, 32);
  if (!stealth && client && typeof client.gamesPlayed === "function") {
    try {
      client.gamesPlayed(nextList);
    } catch (_) {}
  }
  return nextList;
}

module.exports = {
  detectLocalSteamClient,
  ensureInGameBeforeStore
};
