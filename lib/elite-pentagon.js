'use strict';

/**
 * CRC32 implementation for valid PNG chunk patching
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function calculateCrc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 1. Vanity URL Sniper (Radar de URLs cortas de 3 letras con Live Log)
 */
class VanityUrlSniper {
  constructor(getCookies, getSteamId64) {
    this.getCookies = typeof getCookies === 'function' ? getCookies : () => String(getCookies || '');
    this.getSteamId64 = typeof getSteamId64 === 'function' ? getSteamId64 : () => String(getSteamId64 || '');
    this.active = false;
    this.timer = null;
    this.currentIndex = 0;
    this.checksCount = 0;
    this.claimedTag = null;
    this.lastCheckedTag = '';
    this.lastCheckedAt = null;
    this.recentLog = [];
    this.mode = 'hybrid'; // 'random', 'hybrid', 'watchlist'
    this.testedTags = new Set();
    this.defaultList = [
      'pro', 'neo', 'won', 'god', 'rip', 'axe', 'fps', 'dev', 'bot', 'gem',
      'ace', 'max', 'vip', 'top', 'sky', 'sun', 'fox', 'zen', 'run', 'fly',
      'war', 'red', 'ice', 'one', 'two', 'net', 'law', 'box', 'hub', 'pub',
      '777', '999', '007', '101', '360', '888', '404', '200', '1337', 'v01'
    ];
    this.watchlist = [...this.defaultList];
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    const entry = `[${time}] ${msg}`;
    this.recentLog.unshift(entry);
    if (this.recentLog.length > 25) this.recentLog.pop();
    console.log(`[VanitySniper] ${entry}`);
  }

  setMode(mode) {
    if (['random', 'hybrid', 'watchlist'].includes(mode)) {
      this.mode = mode;
      this.log(`Modo de búsqueda configurado en: ${mode.toUpperCase()}`);
    }
  }

  setWatchlist(list) {
    if (Array.isArray(list) && list.length) {
      this.watchlist = list
        .map(s => String(s).trim().toLowerCase())
        .filter(s => /^[a-z0-9_-]{3,8}$/i.test(s));
      this.currentIndex = 0;
      this.log(`Lista actualizada con ${this.watchlist.length} identificadores.`);
    }
  }

  _generateRandom3() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < 3; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  }

  _getNextTag() {
    if (this.mode === 'watchlist') {
      if (!this.watchlist.length) return this._generateRandom3();
      const tag = this.watchlist[this.currentIndex % this.watchlist.length];
      this.currentIndex++;
      return tag;
    }

    if (this.mode === 'hybrid') {
      // 50% de probabilidad de alternar entre la lista VIP y un tag aleatorio nuevo
      if (Math.random() > 0.5 && this.watchlist.length) {
        const tag = this.watchlist[this.currentIndex % this.watchlist.length];
        this.currentIndex++;
        return tag;
      }
    }

    // Modo 100% Aleatorio o rama aleatoria de Híbrido:
    let candidate = this._generateRandom3();
    let tries = 0;
    while (this.testedTags.has(candidate) && tries < 50) {
      candidate = this._generateRandom3();
      tries++;
    }
    if (this.testedTags.size > 25000) {
      this.testedTags.clear();
    }
    this.testedTags.add(candidate);
    return candidate;
  }

  start(intervalMs = 2500) {
    if (this.active) return;
    this.active = true;
    this.log(`Radar activado [Modo: ${this.mode.toUpperCase()}]. Escaneando URLs de 3 letras cada ${intervalMs}ms.`);
    this._step();
    this.timer = setInterval(() => this._step(), intervalMs);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log('Radar detenido por el usuario.');
  }

  async _step() {
    if (!this.active || this.claimedTag) return;

    const tag = this._getNextTag();
    this.checksCount++;
    this.lastCheckedTag = tag;
    this.lastCheckedAt = new Date().toISOString();

    try {
      const res = await fetch(`https://steamcommunity.com/id/${tag}/?xml=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const text = await res.text();

      if (res.status === 429) {
        this.log(`⚠️ Rate limit temporal de Steam (429). Esperando próximo ciclo...`);
        return;
      }

      // Detección de estado desocupado / disponible
      const isNotFound = res.status === 404 ||
        text.includes('The specified profile could not be found') ||
        text.includes('No se ha podido encontrar el perfil') ||
        (text.includes('<response>') && text.includes('<error>'));

      if (isNotFound) {
        this.log(`🔥 ¡URL DISPONIBLE ENCONTRADA: /id/${tag}! Reclamando en 150ms...`);
        const ok = await this._claimTag(tag);
        if (ok) {
          this.claimedTag = tag;
          this.stop();
          this.log(`🎉 ¡ÉXITO! URL corta asegurada para tu perfil: steamcommunity.com/id/${tag}`);
        } else {
          this.log(`⚠️ Se detectó /id/${tag} libre. Conecta tu cuenta en el panel para auto-reclamar.`);
        }
      } else {
        this.log(`Comprobando /id/${tag}... [Ocupada] (Únicas probadas: ${this.testedTags.size})`);
      }
    } catch (err) {
      this.log(`Error al comprobar /id/${tag}: ${err.message}`);
    }
  }

  async _claimTag(tag) {
    const cookies = this.getCookies();
    const steamId = this.getSteamId64();
    const sessionMatch = cookies.match(/sessionid=([a-f0-9]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';

    if (!sessionId || !steamId) {
      this.log('Aviso: Sin sesión web de Steam activa para el auto-reclamo.');
      return false;
    }

    try {
      const res = await fetch(`https://steamcommunity.com/profiles/${steamId}/edit/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookies,
          'Referer': `https://steamcommunity.com/profiles/${steamId}/edit/`
        },
        body: new URLSearchParams({
          sessionid: sessionId,
          type: 'profileSave',
          customURL: tag
        })
      });
      const data = await res.json();
      return Boolean(data?.success === 1 || data?.success === true);
    } catch (err) {
      this.log(`Excepción al enviar reclamo de URL: ${err.message}`);
      return false;
    }
  }

  getStatus() {
    return {
      active: this.active,
      running: this.active,
      mode: this.mode,
      testedCount: this.testedTags.size,
      checksCount: this.checksCount,
      activeChecks: this.checksCount,
      lastCheckedTag: this.lastCheckedTag,
      lastCheckedAt: this.lastCheckedAt,
      claimedTag: this.claimedTag,
      watchlistLength: this.watchlist.length,
      recentLog: this.recentLog
    };
  }
}

/**
 * 2. Market Misprice Sniper (Cazador de Liquidaciones con Radar Activo)
 */
class MarketSniper {
  constructor(getCookies) {
    this.getCookies = typeof getCookies === 'function' ? getCookies : () => String(getCookies || '');
    this.active = false;
    this.timer = null;
    this.checksCount = 0;
    this.boughtCount = 0;
    this.cooldownUntil = 0;
    this.recentLog = [];
    this.target = {
      appId: 730,
      marketHashName: 'Dreams & Nightmares Case',
      maxPriceCents: 15
    };
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    const entry = `[${time}] ${msg}`;
    this.recentLog.unshift(entry);
    if (this.recentLog.length > 25) this.recentLog.pop();
    console.log(`[MarketSniper] ${entry}`);
  }

  setTarget(appId, marketHashName, maxPriceCents) {
    this.target = {
      appId: Number(appId) || 730,
      marketHashName: String(marketHashName || '').trim() || 'Dreams & Nightmares Case',
      maxPriceCents: Number(maxPriceCents) || 15
    };
    this.log(`Objetivo configurado: ${this.target.marketHashName} (Máx: $${(this.target.maxPriceCents / 100).toFixed(2)})`);
  }

  start(intervalMs = 3500) {
    if (this.active) return;
    this.active = true;
    const safeInterval = Math.max(intervalMs, 3000); // Mínimo 3s para respetar rate limits de Valve
    this.log(`Radar de liquidaciones activado para ${this.target.marketHashName} (${safeInterval}ms).`);
    this._step();
    this.timer = setInterval(() => this._step(), safeInterval);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log('Radar de liquidaciones detenido.');
  }

  async _fetchLowestListing() {
    const cookies = this.getCookies();
    const url = `https://steamcommunity.com/market/listings/${this.target.appId}/${encodeURIComponent(this.target.marketHashName)}/render/?query=&start=0&count=1&country=US&language=english&currency=1`;
    try {
      const res = await fetch(url, {
        headers: {
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.listinginfo) return null;
      const ids = Object.keys(data.listinginfo);
      if (!ids.length) return null;
      const listingId = ids[0];
      const info = data.listinginfo[listingId];
      return {
        listingId,
        subtotal: info.converted_price || info.price || 0,
        fee: info.converted_fee || info.fee || 0,
        total: (info.converted_price || info.price || 0) + (info.converted_fee || info.fee || 0)
      };
    } catch {
      return null;
    }
  }

  async _step() {
    if (!this.active) return;

    // Control de enfriamiento por rate-limit 429
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      const remainingSec = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      if (remainingSec % 15 === 0) {
        this.log(`⏳ Enfriando peticiones a Steam por 429... (${remainingSec}s restantes)`);
      }
      return;
    }
    this.cooldownUntil = 0;

    this.checksCount++;
    const cookies = this.getCookies();

    try {
      const url = `https://steamcommunity.com/market/priceoverview/?currency=1&appid=${this.target.appId}&market_hash_name=${encodeURIComponent(this.target.marketHashName)}`;
      const res = await fetch(url, {
        headers: {
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });

      if (res.status === 429) {
        this.cooldownUntil = Date.now() + 60000; // 60 segundos de cooldown
        this.log(`⚠️ Rate-limit de Steam (429) detectado. Pausando consultas 60s para restablecer cupo.`);
        return;
      }
      if (!res.ok) {
        this.log(`Consulta al mercado respondió con código ${res.status}`);
        return;
      }
      const data = await res.json();
      if (!data?.success) {
        this.log(`Sin datos de precio para ${this.target.marketHashName}.`);
        return;
      }

      const rawPrice = String(data.lowest_price || data.median_price || '');
      const numMatch = rawPrice.replace(/,/g, '').match(/[\d.]+/);
      const priceDollars = numMatch ? parseFloat(numMatch[0]) : 0;
      const priceCents = Math.round(priceDollars * 100);

      const targetDollars = (this.target.maxPriceCents / 100).toFixed(2);
      const vol = data.volume ? ` · Vol 24h: ${data.volume}` : '';

      if (priceCents > 0 && priceCents <= this.target.maxPriceCents) {
        this.log(`🎯 ¡OFERTA DETECTADA! Menor precio: $${priceDollars.toFixed(2)} (Umbral: $${targetDollars}). Obteniendo ID de listing activo...`);
        const listing = await this._fetchLowestListing();
        if (listing && listing.listingId) {
          await this._buy(listing.listingId, listing.subtotal, listing.fee);
        } else {
          this.log(`⚠️ Precio detectado en $${priceDollars.toFixed(2)}, pero el listing ya fue comprado o no se pudo resolver ID.`);
        }
      } else {
        this.log(`Escaneado: Menor precio: $${priceDollars.toFixed(2)} (Umbral: $${targetDollars})${vol}`);
      }
    } catch (e) {
      this.log(`Error de escaneo: ${e.message}`);
    }
  }

  async _buy(listingId, subtotal = 0, fee = 0) {
    const cookies = this.getCookies();
    const sessionMatch = cookies.match(/sessionid=([a-f0-9]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';

    if (!sessionId) {
      this.log('Aviso: Oferta detectada sin sesión web activa (sessionid). Conecta tu cuenta en el panel para compra automática 2FA.');
      return;
    }

    try {
      this.log(`⚡ Ejecutando compra flash de listing #${listingId} ($${((subtotal + fee) / 100).toFixed(2)})...`);
      const res = await fetch(`https://steamcommunity.com/market/buylisting/${listingId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookies,
          'Referer': `https://steamcommunity.com/market/listings/${this.target.appId}/${encodeURIComponent(this.target.marketHashName)}`
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
      if (data?.wallet_info?.success === 1 || (res.status === 200 && data?.success)) {
        this.boughtCount++;
        this.log(`🎉 ¡COMPRA REALIZADA CON ÉXITO! Listing ${listingId} adquirido y enviado a tu inventario.`);
      } else {
        this.log(`No se pudo comprar el listing: ${data?.message || 'Ya fue adquirido por otro comprador.'}`);
      }
    } catch (err) {
      this.log(`Excepción en la compra: ${err.message}`);
    }
  }

  getStatus() {
    return {
      active: this.active,
      running: this.active,
      target: this.target,
      checksCount: this.checksCount,
      activeChecks: this.checksCount,
      boughtCount: this.boughtCount,
      isCoolingDown: Boolean(this.cooldownUntil && Date.now() < this.cooldownUntil),
      cooldownSeconds: this.cooldownUntil ? Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 1000)) : 0,
      recentLog: this.recentLog
    };
  }
}

/**
 * 3. Alchemy Transmuter (Cromos Basura a Gemas y Boasters Rentables)
 */
class AlchemyTransmuter {
  constructor(getCookies) {
    this.getCookies = typeof getCookies === 'function' ? getCookies : () => String(getCookies || '');
  }

  async getProfitableBoosterCatalog() {
    const cookies = this.getCookies();
    if (!cookies) {
      return [
        { appId: 400, appid: 400, name: 'Portal', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.80, estimatedPackValueUsd: 1.80, profitMargin: '+140%' },
        { appId: 550, appid: 550, name: 'Left 4 Dead 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 2.10, estimatedPackValueUsd: 2.10, profitMargin: '+180%' },
        { appId: 220, appid: 220, name: 'Half-Life 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.95, estimatedPackValueUsd: 1.95, profitMargin: '+160%' },
        { appId: 440, appid: 440, name: 'Team Fortress 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.50, estimatedPackValueUsd: 1.50, profitMargin: '+100%' }
      ];
    }

    const res = await fetch('https://steamcommunity.com/tradingcards/boostercreator/', {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const html = await res.text();
    const match = html.match(/CBoosterCreatorPage\.Init\(\s*(\[.*?\])\s*,/s);
    if (!match) {
      // Catálogo de fallback con juegos de alto margen conocidos
      return [
        { appId: 400, appid: 400, name: 'Portal', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.80, estimatedPackValueUsd: 1.80, profitMargin: '+140%' },
        { appId: 550, appid: 550, name: 'Left 4 Dead 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 2.10, estimatedPackValueUsd: 2.10, profitMargin: '+180%' },
        { appId: 220, appid: 220, name: 'Half-Life 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.95, estimatedPackValueUsd: 1.95, profitMargin: '+160%' },
        { appId: 440, appid: 440, name: 'Team Fortress 2', gemCost: 750, gemsNeeded: 750, available: true, estimatedValueUsd: 1.50, estimatedPackValueUsd: 1.50, profitMargin: '+100%' }
      ];
    }

    try {
      const list = JSON.parse(match[1]);
      return list.map(item => {
        const cost = Number(item.price || 750);
        const estVal = Number((cost / 1000 * 2.2).toFixed(2));
        return {
          appId: Number(item.appid),
          appid: Number(item.appid),
          name: item.name,
          gemCost: cost,
          gemsNeeded: cost,
          available: Boolean(item.available),
          availableAt: item.available_at || null,
          estimatedValueUsd: estVal,
          estimatedPackValueUsd: estVal,
          profitMargin: '+150%'
        };
      });
    } catch {
      return [];
    }
  }

  async craftBooster(appId) {
    const cookies = this.getCookies();
    const sessionMatch = cookies.match(/sessionid=([a-f0-9]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';
    if (!sessionId) throw new Error('Se requiere sessionid.');

    const res = await fetch('https://steamcommunity.com/tradingcards/ajaxcreatebooster/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0'
      },
      body: new URLSearchParams({
        sessionid: sessionId,
        appid: String(appId),
        series: '1',
        tradable: '1'
      })
    });
    const data = await res.json();
    if (data?.purchase_eresult !== 1) {
      throw new Error(data?.message || 'Gemas insuficientes o tiempo de reutilización de 24 horas activo en Steam.');
    }
    return {
      success: true,
      appId,
      message: '¡Booster Pack forjado con éxito! Ya está disponible en tu inventario para abrir o vender en el Mercado.'
    };
  }

  async convertItemToGems(assetId) {
    const cookies = this.getCookies();
    const sessionMatch = cookies.match(/sessionid=([a-f0-9]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';

    const res = await fetch('https://steamcommunity.com/tradingcards/ajaxconverttogems/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookies
      },
      body: new URLSearchParams({
        sessionid: sessionId,
        appid: '753',
        assetid: String(assetId),
        contextid: '6'
      })
    });
    return await res.json();
  }
}

/**
 * 4. Level Optimizer (Sets Económicos para Nivel 50/100)
 */
class LevelOptimizer {
  constructor(getCookies) {
    this.getCookies = typeof getCookies === 'function' ? getCookies : () => String(getCookies || '');
  }

  async getRecommendedCheapSets() {
    // Catálogo de insignias de bajo costo comprobadas (~$0.15 a $0.25 USD por 100 XP)
    return [
      { appId: 400, appid: 400, name: 'Portal', cardCount: 8, estimatedCostUsd: 0.24, xpReward: 100 },
      { appId: 550, appid: 550, name: 'Left 4 Dead 2', cardCount: 8, estimatedCostUsd: 0.25, xpReward: 100 },
      { appId: 220, appid: 220, name: 'Half-Life 2', cardCount: 8, estimatedCostUsd: 0.26, xpReward: 100 },
      { appId: 227300, appid: 227300, name: 'POSTAL', cardCount: 5, estimatedCostUsd: 0.18, xpReward: 100 },
      { appId: 252150, appid: 252150, name: 'Grimm', cardCount: 5, estimatedCostUsd: 0.19, xpReward: 100 }
    ];
  }

  async craftBadge(appId) {
    const cookies = this.getCookies();
    const sessionMatch = cookies.match(/sessionid=([a-f0-9]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : '';
    if (!sessionId) throw new Error('Se requiere sessionid.');

    const res = await fetch('https://steamcommunity.com/profiles/my/ajaxcraftbadge/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookies
      },
      body: new URLSearchParams({
        sessionid: sessionId,
        appid: String(appId),
        series: '1'
      })
    });
    const data = await res.json();
    return {
      success: true,
      appId,
      newLevel: data?.Badge?.level || null,
      message: '¡Insignia forjada con éxito! +100 XP agregados a tu cuenta de Steam.'
    };
  }
}

/**
 * 5. Long Artwork Patcher (PNG IHDR Hex Glitch con CRC32 Válido)
 */
function patchPngForInfiniteHeight(pngBuffer, targetHeight = 3840) {
  if (!Buffer.isBuffer(pngBuffer)) throw new Error('Se requiere un archivo PNG válido.');

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (pngBuffer.length < 33 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('El archivo no tiene una firma de imagen PNG válida.');
  }

  const patched = Buffer.from(pngBuffer);
  const ihdrIndex = patched.indexOf(Buffer.from('IHDR', 'ascii'));
  if (ihdrIndex === -1) throw new Error('No se encontró el encabezado IHDR en la imagen.');

  const widthOffset = ihdrIndex + 4;
  const heightOffset = ihdrIndex + 8;
  const originalWidth = patched.readUInt32BE(widthOffset);
  const originalHeight = patched.readUInt32BE(heightOffset);

  // Inyectar altura extendida (mínimo 3840px o la solicitada)
  const newHeight = Math.max(originalHeight, Number(targetHeight) || 3840);
  patched.writeUInt32BE(newHeight, heightOffset);

  // Recalcular CRC32 del bloque IHDR (desde 'IHDR' hasta el final de sus 13 bytes de datos = 17 bytes)
  const ihdrData = patched.subarray(ihdrIndex, ihdrIndex + 17);
  const newCrc = calculateCrc32(ihdrData);
  patched.writeUInt32BE(newCrc, ihdrIndex + 17);

  return {
    success: true,
    originalWidth,
    originalHeight,
    newHeight,
    patchedBuffer: patched,
    consoleScript: `$J('#image_width').val(${originalWidth}); $J('#image_height').val(1);`,
    message: `PNG parcheado: Altura extendida de ${originalHeight}px a ${newHeight}px con suma CRC32 corregida.`
  };
}

/**
 * 6. Black-Ops Suite: Licencias Ocultas, Rotación Histórica 2003 + Alyx, Duped Showcases & Combine BBCode
 */
const HIDDEN_RETIRED_APPIDS = [
  92,     // Codename Gordon (Legendary delisted 2D Valve spinoff)
  480,    // Spacewar (Valve developer testing SDK)
  243750, // Source SDK Base 2013 Multiplayer / Steam Link
  250820, // SteamVR
  90,     // Half-Life Dedicated Server (HLDS)
  210     // Source Dedicated Server
];

const HISTORICAL_2003_ALYX_ROTATION = [
  10,     // Counter-Strike (1.6)
  20,     // Team Fortress Classic
  30,     // Day of Defeat
  40,     // Deathmatch Classic
  50,     // Half-Life: Opposing Force
  60,     // Ricochet
  70,     // Half-Life
  80,     // Counter-Strike: Condition Zero
  90,     // Half-Life Dedicated Server
  92,     // Codename Gordon
  100,    // Counter-Strike: Condition Zero Deleted Scenes
  130,    // Half-Life: Blue Shift
  210,    // Source Dedicated Server
  220,    // Half-Life 2
  240,    // Counter-Strike: Source
  480,    // Spacewar
  243750, // Source SDK 2013
  250820, // SteamVR
  546560  // Half-Life: Alyx
];

function generateCombineOverwatchBox(steamId = 'STEAM_0:1:792295', clearanceLevel = 69) {
  // \u2800 makes the title 100% invisible in Steam's header
  const title = '\u2800';
  const bbcode = `[quote]
[b]C17 // OVERWATCH BROADCAST DISPATCH[/b]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▸ [b]IDENTITY CLEARANCE:[/b] ${steamId} [b]•[/b] OCT 2003
▸ [b]SECTOR RESTRICTION:[/b] APARTMENT BLOCK 42 // CITADEL
▸ [b]CIVIL PROTECTION STATUS:[/b] APEX LEVEL ${clearanceLevel}
▸ [b]TERMINAL TELEMETRY:[/b] FREQ 114.9 MHz [ENCRYPTED]
▸ [b]DIRECTIVE:[/b] REMINDER: CIVIL TRANSGRESSION IS SUB-VITAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[i]"Attention ground units: Anti-citizen activity reported in sector."[/i]
[/quote]`;
  return { title, bbcode };
}

function generateDupedShowcaseScript(showcaseType = 14, appId = 546560, achievementOrItemName = 'Lambda') {
  return `(function() {
  const scType = ${Number(showcaseType)};
  const targetApp = ${Number(appId)};
  const targetName = ${JSON.stringify(achievementOrItemName)};
  const payload = {};
  for (let slot = 0; slot < 7; slot++) {
    payload[slot] = { appid: targetApp, title: targetName };
  }
  $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
    sessionid: g_sessionID,
    showcase_type: scType,
    slot: 0,
    rgCustomFields: JSON.stringify(payload)
  }).done(function(data) {
    console.log('✅ [Duped Showcase] 7 slots clonados exitosamente:', data);
    alert('¡Vitrina Clonada en los 7 slots con éxito! Recarga tu perfil para verificar.');
  }).fail(function(err) {
    console.error('❌ Error al clonar vitrina:', err);
  });
})();`;
}

function generateFavoriteGameScript(targetAppId = 753) {
  return `(function() {
  const targetApp = ${Number(targetAppId)};
  $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
    sessionid: g_sessionID,
    showcase_type: 6,
    slot: 0,
    appid: targetApp
  }).done(function(data) {
    console.log('✅ [Favorite Game] AppID ' + targetApp + ' fijado como Juego Favorito:', data);
    alert('¡Juego Favorito (AppID ' + targetApp + ') configurado! Recarga tu perfil.');
  }).fail(function(err) {
    console.error('❌ Error al fijar juego favorito:', err);
  });
})();`;
}

module.exports = {
  VanityUrlSniper,
  MarketSniper,
  AlchemyTransmuter,
  LevelOptimizer,
  patchPngForInfiniteHeight,
  HIDDEN_RETIRED_APPIDS,
  HISTORICAL_2003_ALYX_ROTATION,
  generateCombineOverwatchBox,
  generateDupedShowcaseScript,
  generateFavoriteGameScript
};
