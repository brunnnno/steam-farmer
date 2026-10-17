'use strict';

class MarketSniperService {
  constructor(webCookies, accountId, { fetchImpl } = {}) {
    this.cookies = Array.isArray(webCookies) ? webCookies.join('; ') : String(webCookies || '');
    this.accountId = accountId;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.active = false;
    this.pollTimer = null;
    this.targetItems = [];
    this.boughtCount = 0;
  }

  setCookies(webCookies) {
    this.cookies = Array.isArray(webCookies) ? webCookies.join('; ') : String(webCookies || '');
  }

  setTargets(targets) {
    // Array de { appId, marketHashName, maxPriceCents }
    if (Array.isArray(targets) && targets.length) {
      this.targetItems = targets.map(t => ({
        appId: Number(t.appId) || 753,
        marketHashName: String(t.marketHashName || 'Trading Card'),
        maxPriceCents: Math.max(1, Number(t.maxPriceCents) || 5)
      }));
    } else if (!this.targetItems.length) {
      this.targetItems = [
        { appId: 730, marketHashName: 'CS2 Case Key', maxPriceCents: 25 },
        { appId: 753, marketHashName: 'Foil Trading Card', maxPriceCents: 8 }
      ];
    }
  }

  startScanning(intervalMs = 2500) {
    if (this.active) return;
    if (!this.targetItems.length) this.setTargets([]);
    this.active = true;
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), intervalMs);
    this.pollTimer.unref?.();
    console.log(`[MarketSniper] Escáner de liquidaciones activo para cuenta ${this.accountId}`);
  }

  stopScanning() {
    this.active = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _poll() {
    if (!this.active || !this.targetItems.length || !this.cookies) return;
    const sessionMatch = this.cookies.match(/sessionid=([^;\s]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';

    for (const target of this.targetItems) {
      try {
        const url = `https://steamcommunity.com/market/listings/${target.appId}/${encodeURIComponent(target.marketHashName)}/render/?query=&start=0&count=5&currency=1&format=json`;
        const res = await this.fetchImpl(url, { headers: { Cookie: this.cookies, 'User-Agent': 'Mozilla/5.0' } });
        if (!res || !res.ok) continue;
        const data = await res.json();
        const listings = data?.listinginfo;
        if (!listings) continue;

        for (const [listingId, info] of Object.entries(listings)) {
          const price = Number(info.converted_price || info.price) + Number(info.converted_fee || info.fee);
          if (price > 0 && price <= target.maxPriceCents) {
            console.log(`[MarketSniper] ¡Oportunidad detectada! Listing ${listingId} a ${price} centavos (Máximo: ${target.maxPriceCents})`);
            await this._buyListing(listingId, info.converted_price || info.price, info.converted_fee || info.fee, sessionId);
          }
        }
      } catch {}
    }
  }

  async _buyListing(listingId, subtotal, fee, sessionId) {
    try {
      const res = await this.fetchImpl(`https://steamcommunity.com/market/buylisting/${listingId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: this.cookies,
          Referer: 'https://steamcommunity.com/market/'
        },
        body: new URLSearchParams({
          sessionid: sessionId,
          currency: '1',
          subtotal: String(subtotal),
          fee: String(fee),
          total: String(Number(subtotal) + Number(fee)),
          quantity: '1'
        })
      });
      const data = await res.json();
      if (data?.wallet_info?.success === 1) {
        this.boughtCount++;
        console.log(`[MarketSniper] ¡COMPRA EXITOSA! Listing ${listingId} adquirido en milisegundos.`);
        return true;
      }
    } catch (e) {
      console.warn('[MarketSniper] Fallo al comprar listing:', e.message);
    }
    return false;
  }

  getStatus() {
    return {
      active: this.active,
      targetsCount: this.targetItems.length,
      boughtCount: this.boughtCount
    };
  }
}

module.exports = { MarketSniperService };
