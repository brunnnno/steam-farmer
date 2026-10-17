'use strict';

const EMsg = require('steam-user/enums/EMsg');
const Schema = require('steam-user/protobufs/generated/_load.js');

class TournamentGhostService {
  constructor(client, accountId) {
    this.client = client;
    this.accountId = accountId;
    this.activeBroadcastId = null;
    this.heartbeatTimer = null;
    this.watchCount = 0;
  }

  /**
   * Empieza a 'mirar' un broadcast oficial sin descargar video
   */
  startWatching(broadcastSteamId) {
    if (!this.client || typeof this.client._send !== 'function') return false;
    this.activeBroadcastId = String(broadcastSteamId || '76561198000000000').trim();
    this._sendWatchHeartbeat();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // Valve requiere renovación de heartbeat cada 4-5 minutos
    this.heartbeatTimer = setInterval(() => {
      this._sendWatchHeartbeat();
    }, 240000);
    this.heartbeatTimer.unref?.();

    return true;
  }

  _sendWatchHeartbeat() {
    if (!this.activeBroadcastId || !this.client || typeof this.client._send !== 'function') return;
    try {
      const targetJob = 'Broadcast.WatchBroadcast#1';
      const body = {
        steamid: this.activeBroadcastId
      };
      let encoded = Buffer.alloc(0);
      if (Schema.CBroadcast_WatchBroadcast_Request) {
        const res = Schema.CBroadcast_WatchBroadcast_Request.encode(body);
        encoded = Buffer.from(res && typeof res.finish === 'function' ? res.finish() : res);
      }
      this.client._send({ msg: EMsg.ServiceMethodCallFromClient, proto: { target_job_name: targetJob } }, encoded);
      this.watchCount++;
      console.log(`[TournamentGhost] Heartbeat de visualización enviado para broadcast ${this.activeBroadcastId} (Total: ${this.watchCount})`);
    } catch (e) {
      console.warn('[TournamentGhost] Error enviando heartbeat:', e.message);
    }
  }

  stopWatching() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.activeBroadcastId = null;
  }

  getStatus() {
    return {
      active: Boolean(this.activeBroadcastId),
      broadcastId: this.activeBroadcastId,
      heartbeatsSent: this.watchCount
    };
  }
}

module.exports = { TournamentGhostService };
