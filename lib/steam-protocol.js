'use strict';
const Schema = require('steam-user/protobufs/generated/_load.js');
const EMsg = require('steam-user/enums/EMsg');
const binaryKV = require('binarykvparser');
const { appId } = require('./core');
function problem(message, status = 502) { return Object.assign(new Error(message), { status }); }
const english = value => typeof value === 'string' ? value : typeof value?.english === 'string' ? value.english : '';
function parseSnapshot(snapshot, id) {
  id = appId(id);
  if (Number(snapshot.eresult) !== 1) throw problem(`Steam rejected direct verification (result ${Number(snapshot.eresult) || 2}).`);
  if (String(snapshot.game_id) !== String(id)) throw problem('Steam returned statistics for a different game.');
  if (!snapshot.schema?.length || snapshot.schema.length > 4 * 1024 * 1024) throw problem('Steam did not return a usable achievement schema.');
  const root = binaryKV.parse(Buffer.from(snapshot.schema));
  // Accept only the requested AppID; a schema for another game is never substituted.
  const definition = root[String(id)] || (root.stats ? root : null);
  if (!definition?.stats) throw problem('Steam did not return an achievement schema for this game.');
  const values = new Map((snapshot.stats || []).map(s => [Number(s.stat_id), Number(s.stat_value) >>> 0]));
  const blocks = new Map((snapshot.achievement_blocks || []).map(b => [Number(b.achievement_id), b.unlock_time || []]));
  const rows = [];
  for (const [blockKey, stat] of Object.entries(definition.stats)) {
    if (!/^\d+$/.test(blockKey) || !stat || !['4', 'ACHIEVEMENTS'].includes(String(stat.type).toUpperCase())) continue;
    const blockId = Number(blockKey); if (!Number.isSafeInteger(blockId) || blockId > 0xffffffff) continue;
    for (const [bitKey, bit] of Object.entries(stat.bits || {})) {
      const bitIndex = Number(bitKey);
      if (!/^\d+$/.test(bitKey) || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 31 || !bit?.name || typeof bit.name !== 'string') continue;
      const times = blocks.get(blockId), hasTime = times && bitIndex < times.length;
      const timestamp = hasTime ? Number(times[bitIndex]) : 0;
      const unlocked = hasTime && Number.isFinite(timestamp) ? timestamp > 0 : values.has(blockId) ? Boolean(values.get(blockId) & (1 << bitIndex)) : null;
      const icon = value => typeof value === 'string' && value ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${id}/${encodeURIComponent(value)}` : '';
      const display = bit.display || {};
      rows.push({ id:bit.name, apiname:bit.name, name:english(display.name) || bit.name, description:english(display.desc), iconOpen:icon(display.icon), iconClosed:icon(display.icon_gray || display.icon), unlocked, unlockTimestamp:unlocked && Number.isFinite(timestamp) ? Math.max(0,timestamp) : 0, percent:null, tier:'Unknown', serverControlled:Boolean(Number(bit.permission || 0) & 2) });
    }
  }
  if (!rows.length) throw problem('Steam returned no readable achievement definitions. Try the standard verification method.');
  return { achievements:rows, source:'Steam client protocol', outcome:'available', verified:rows.every(r=>typeof r.unlocked==='boolean'), message:'Read directly from your authenticated Steam session.', checkedAt:new Date().toISOString(), diagnostics:{ method:'ClientGetUserStats', serverControlled:rows.filter(r=>r.serverControlled).length } };
}
async function readProtocol(client, id, { timeoutMs = 10000 } = {}) {
  id = appId(id);
  const steamid = client?.steamID?.toString();
  if (!/^765\d{14}$/.test(steamid || '') || typeof client?._send !== 'function') throw problem('Connect to Steam before using direct verification.', 409);
  const snapshot = await new Promise((resolve, reject) => {
    let finished = false, job;
    const cleanup = () => { clearTimeout(timer); if (job) client._jobs?.delete?.(job); client.removeListener('disconnected', disconnected); client.removeListener('error', disconnected); };
    const complete = (err, value) => { if (finished) return; finished = true; cleanup(); err ? reject(err) : resolve(value); };
    const disconnected = () => complete(problem('Steam disconnected during direct verification.', 409));
    const timer = setTimeout(() => complete(problem('Steam did not answer direct verification in time. Try standard Refresh.', 504)), timeoutMs);
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
          complete(null, Schema.CMsgClientGetUserStatsResponse.decode(buffer));
        } catch (err) { complete(problem(err.status ? err.message : 'Steam returned unreadable direct-verification data.')); }
      });
      job = String(client._currentJobID); if (finished) client._jobs?.delete?.(job);
    } catch { complete(problem('Direct verification is unavailable with this Steam connection.')); }
  });
  if (client.steamID?.toString() !== steamid) throw problem('The Steam account changed during verification.', 409);
  return parseSnapshot(snapshot, id);
}
module.exports = { readProtocol, parseSnapshot };
