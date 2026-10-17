'use strict';

class VanityUrlSniper {
  constructor(webCookies, steamId64, { fetchImpl } = {}) {
    this.cookies = Array.isArray(webCookies) ? webCookies.join('; ') : String(webCookies || '');
    this.steamId64 = steamId64;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.active = false;
    this.timer = null;
    this.watchlist = ['pro', 'neo', 'won', 'god', 'rip', 'axe', 'fps', 'dev', 'bot', 'gem'];
    this.claimedTag = null;
  }

  setContext(webCookies, steamId64) {
    if (webCookies !== undefined) {
      this.cookies = Array.isArray(webCookies) ? webCookies.join('; ') : String(webCookies || '');
    }
    if (steamId64) this.steamId64 = steamId64;
  }

  setWatchlist(list) {
    if (Array.isArray(list) && list.length) {
      const cleaned = list.map(s => String(s).trim().toLowerCase()).filter(s => s.length >= 3 && s.length <= 16);
      if (cleaned.length) this.watchlist = cleaned;
    }
  }

  start(intervalMs = 3000) {
    if (this.active) return;
    this.active = true;
    this._checkLoop();
    this.timer = setInterval(() => this._checkLoop(), intervalMs);
    this.timer.unref?.();
    console.log(`[VanitySniper] Radar de URLs cortas activo para cuenta ${this.steamId64}`);
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _checkLoop() {
    if (!this.active || this.claimedTag) return;

    for (const tag of this.watchlist) {
      try {
        const res = await this.fetchImpl(`https://steamcommunity.com/id/${tag}/?xml=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const text = await res.text();
        if (text.includes('The specified profile could not be found') || res.status === 404) {
          console.log(`[VanitySniper] ¡URL LIBRE ENCONTRADA: ${tag}! Intentando reclamo instantáneo...`);
          const success = await this._claimTag(tag);
          if (success) {
            this.claimedTag = tag;
            this.stop();
            break;
          }
        }
      } catch {}
    }
  }

  async _claimTag(tag) {
    const sessionMatch = this.cookies.match(/sessionid=([^;\s]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';
    if (!sessionId || !this.steamId64) return false;

    try {
      const res = await this.fetchImpl(`https://steamcommunity.com/profiles/${this.steamId64}/edit/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: this.cookies,
          Referer: `https://steamcommunity.com/profiles/${this.steamId64}/edit/`
        },
        body: new URLSearchParams({
          sessionid: sessionId,
          type: 'profileSave',
          customURL: tag
        })
      });
      const data = await res.json();
      if (data?.success === 1) {
        console.log(`[VanitySniper] ¡ÉXITO HISTÓRICO! URL corta reclamada: steamcommunity.com/id/${tag}`);
        return true;
      }
    } catch (e) {
      console.warn('[VanitySniper] Error reclamando URL:', e.message);
    }
    return false;
  }

  getStatus() {
    return {
      active: this.active,
      watchlist: this.watchlist,
      claimedTag: this.claimedTag
    };
  }
}

module.exports = { VanityUrlSniper };
