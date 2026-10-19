'use strict';

/**
 * REA OVERWATCH 2003 ENGINE — MOTORES 1, 3 Y 4 (100% BACKEND / WIRE-PROTOBUF)
 * ============================================================================
 * Diseñado a medida para la cuenta fundacional de Bruno (Creada el 7 de Octubre de 2003):
 *
 * - MOTOR 1: Codificador/Decodificador Binario Protobuf Wire-Format en Puro JS.
 * - MOTOR 3A: Mutador Server-Side de Vitrinas Ocultas con Autodetección de `purchaseid`
 *   para múltiples vitrinas del mismo tipo (ej. 1er y 2do "Juego Favorito" de la Tienda
 *   de Puntos) y catálogo expandido de 16 Reliquias / Hardware / Subsistemas de Valve.
 * - MOTOR 3B: Publicador y Generador de Reseña con Tabla `[table]` (07 Oct 2003),
 *   Widgets Oficiales de Skins CS2 (`#730_2_`) y Exploit #3 (`:/linkfilter/`) usando
 *   transporte IPv4 nativo (`node:https`) inmune al error `fetch failed` de Render.
 * - MOTOR 4: Inyector Binario de Capturas (`CMsgClientUCMAddScreenshot`, `EMsg 5514`)
 *   con Etiqueta a Gabe Newell (`76561197960287930`) + Parcheador Binario `0x21` / `IHDR`.
 */

const https = require('node:https');

let EMsg = { ClientUCMAddScreenshot: 5514, ClientChangeStatus: 716, ServiceMethodCallFromClient: 151 };
try {
  EMsg = require('steam-user/enums/EMsg');
} catch {}

const BRAILLE_BLANK = '\u2800';
const GABE_NEWELL_STEAMID64 = '76561197960287930';

const BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP = 1065484800; // 7 de Octubre de 2003 00:00:00 UTC
const STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP = 1298505600; // 24 de Febrero de 2011 00:00:00 UTC

// Catálogo expandido con las 16 reliquias, hardware y subsistemas más exclusivos de Valve
const HIDDEN_VALVE_RELIC_APPS = [
  { appId: 92, name: 'Codename: Gordon (Reliquia Flash 2D de Half-Life retirada en 2008)' },
  { appId: 1675200, name: 'Steam Deck (Hardware Oficial Valve — Bloqueado en buscador normal)' },
  { appId: 1059530, name: 'Valve Index VR Kit (Hardware VR de $1,000 USD — Bloqueado en buscador)' },
  { appId: 353380, name: 'Steam Controller (Hardware Retirado 2015 — Bloqueado en buscador)' },
  { appId: 353370, name: 'Steam Link (Hardware Retirado 2015 — Bloqueado en buscador)' },
  { appId: 766, name: 'Steam Workshop (Subsistema Interno de Valve)' },
  { appId: 760, name: 'Steam Screenshots (Subsistema Interno UCM de Capturas)' },
  { appId: 767, name: 'Steam Artwork (Subsistema Interno de Obras de Arte)' },
  { appId: 7, name: 'Steam Client (Ejecutable Núcleo Original 2003)' },
  { appId: 8, name: 'WinUI (Interfaz Original de Steam de Octubre 2003 — 1 Dígito)' },
  { appId: 753, name: 'Steam (Ecosistema Oficial Valve)' },
  { appId: 480, name: 'Spacewar (App Secreta de Ingeniería Steamworks SDK)' },
  { appId: 211, name: 'Source SDK (Kit de Ingeniería Source Engine 2004)' },
  { appId: 340, name: 'Half-Life 2: Lost Coast (Tech Demo HDR 2005)' },
  { appId: 250820, name: 'SteamVR (Subsistema de Realidad Virtual Valve)' },
  { appId: 761, name: 'Steam Cloud / Video (Subsistema Interno de Nube)' }
];

const ZERO_OWNERSHIP_CS2_WIDGET_LOADOUT = [
  {
    ownerSteamId64: '76561198084852298',
    appId: 730,
    contextId: 2,
    assetId: '9946351222',
    name: '★ Karambit | Case Hardened (Factory New)',
    float: '0.0480829',
    pattern: 'Pattern #387 (Blue Gem Tier-1)',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198084852298A9946351222D14440407685094987611'
  },
  {
    ownerSteamId64: '76561198023512965',
    appId: 730,
    contextId: 2,
    assetId: '28761239912',
    name: 'Souvenir AWP | Dragon Lore (Factory New)',
    float: '0.0009142',
    pattern: '4x Katowice 2014 (Holo)',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198023512965A28761239912D9244972541062093545'
  },
  {
    ownerSteamId64: '76561198165821922',
    appId: 730,
    contextId: 2,
    assetId: '35481920114',
    name: 'StatTrak™ AK-47 | Case Hardened (Factory New)',
    float: '0.0114021',
    pattern: 'Pattern #661 (Scar) + 4x Titan (Holo) Katowice 2014',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198165821922A35481920114D7812390412894012567'
  }
];

/**
 * Cliente HTTP/HTTPS nativo forzado a IPv4 (`family: 4`) para evitar el bug
 * `TypeError: fetch failed` de `undici` en contenedores de Render al conectar con Steam.
 */
function httpsRequestIPv4(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyBuf = options.body
      ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8'))
      : null;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, text/html, */*; q=0.01',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      ...(options.headers || {})
    };
    if (bodyBuf && !headers['Content-Length']) {
      headers['Content-Length'] = String(bodyBuf.length);
    }

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
        family: 4,
        timeout: options.timeoutMs || 12000
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const textBody = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 200;
          resolve({
            ok: status >= 200 && status < 400,
            status,
            headers: res.headers,
            text: async () => textBody,
            json: async () => {
              try {
                return JSON.parse(textBody);
              } catch {
                return { rawText: textBody.slice(0, 300) };
              }
            }
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Timeout conectando con Steam (IPv4)'));
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function safeSteamFetch(urlStr, options = {}, fetchImpl = fetch) {
  if (fetchImpl && fetchImpl !== fetch) {
    return fetchImpl(urlStr, options);
  }
  try {
    return await httpsRequestIPv4(urlStr, options);
  } catch {
    return fetch(urlStr, options);
  }
}

/**
 * ============================================================================
 * MOTOR 1: CODIFICADOR / DECODIFICADOR PROTOBUF WIRE-FORMAT PURO (ZERO-DEPS)
 * ============================================================================
 */
function writeVarint(value) {
  const bytes = [];
  let v = BigInt.asUintN(64, BigInt(value));
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function readVarint(buf, offset = 0) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const byte = BigInt(buf[pos]);
    result |= (byte & 0x7fn) << shift;
    pos += 1;
    if ((byte & 0x80n) === 0n) {
      return { value: result, nextOffset: pos };
    }
    shift += 7n;
    if (shift > 70n) throw new Error('Varint demasiado largo o corrupto.');
  }
  throw new Error('Buffer truncado leyendo varint.');
}

function encodeFieldVarint(fieldNumber, value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  const tag = writeVarint((BigInt(fieldNumber) << 3n) | 0n);
  return Buffer.concat([tag, writeVarint(value)]);
}

function encodeFieldFixed64(fieldNumber, value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  const tag = writeVarint((BigInt(fieldNumber) << 3n) | 1n);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return Buffer.concat([tag, buf]);
}

function encodeFieldBytes(fieldNumber, bufOrStr) {
  if (bufOrStr === undefined || bufOrStr === null) return Buffer.alloc(0);
  const data = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'utf8');
  const tag = writeVarint((BigInt(fieldNumber) << 3n) | 2n);
  return Buffer.concat([tag, writeVarint(data.length), data]);
}

function encodeFieldFixed32(fieldNumber, value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  const tag = writeVarint((BigInt(fieldNumber) << 3n) | 5n);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Number(value) >>> 0, 0);
  return Buffer.concat([tag, buf]);
}

function decodeWireFields(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return {};
  const fields = {};
  let offset = 0;
  while (offset < buf.length) {
    const tagInfo = readVarint(buf, offset);
    offset = tagInfo.nextOffset;
    const fieldNumber = Number(tagInfo.value >> 3n);
    const wireType = Number(tagInfo.value & 0x07n);
    let val;
    if (wireType === 0) {
      const v = readVarint(buf, offset);
      offset = v.nextOffset;
      val = v.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v.value) : v.value.toString();
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      val = buf.readBigUInt64LE(offset).toString();
      offset += 8;
    } else if (wireType === 2) {
      const lenInfo = readVarint(buf, offset);
      offset = lenInfo.nextOffset;
      const len = Number(lenInfo.value);
      if (offset + len > buf.length) break;
      val = buf.subarray(offset, offset + len);
      offset += len;
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      val = buf.readUInt32LE(offset);
      offset += 4;
    } else {
      break;
    }
    if (!fields[fieldNumber]) fields[fieldNumber] = [];
    fields[fieldNumber].push(val);
  }
  return fields;
}

function encodeSteamDeckRegistrationWire(serialNumber = 'FXAA00000001', controllerCode = 'DECK') {
  return Buffer.concat([
    encodeFieldBytes(1, String(serialNumber)),
    encodeFieldBytes(2, String(controllerCode))
  ]);
}

function encodeWatchBroadcastWire(broadcastSteamId64) {
  return encodeFieldFixed64(1, BigInt(String(broadcastSteamId64 || '76561198000000000')));
}

function encodeToggleAppPrivacyWire(appIds = [], isPrivate = true) {
  const chunks = [];
  for (const id of appIds) {
    chunks.push(encodeFieldVarint(1, Number(id) >>> 0));
  }
  chunks.push(encodeFieldVarint(2, isPrivate ? 1 : 0));
  return Buffer.concat(chunks);
}

function encodeChangeStatusWire({ personaState = 1, playerName, personaStateFlags = 1, gamingDeviceType = 2 } = {}) {
  const chunks = [encodeFieldVarint(1, Number(personaState))];
  if (playerName !== undefined && playerName !== null) {
    chunks.push(encodeFieldBytes(2, String(playerName)));
  }
  if (personaStateFlags !== undefined && personaStateFlags !== null) {
    chunks.push(encodeFieldVarint(12, Number(personaStateFlags)));
  }
  if (gamingDeviceType !== undefined && gamingDeviceType !== null) {
    chunks.push(encodeFieldVarint(16, Number(gamingDeviceType)));
  }
  return Buffer.concat(chunks);
}

/**
 * ============================================================================
 * MOTOR 3: MUTADOR SERVER-SIDE DE VITRINAS OCULTAS (CON AUTODETECCIÓN DE
 *          `purchaseid` PARA EL 2DO JUEGO FAVORITO DE TIENDA DE PUNTOS),
 *          RESEÑA CON WIDGETS CS2 (`#730_2_`) Y EXPLOIT #3 GUARDADO
 * ============================================================================
 */
function extractSessionIdFromCookies(cookieString = '') {
  const match = String(cookieString || '').match(/(?:^|;\s*)sessionid=([^;]+)/i);
  return match ? decodeURIComponent(match[1].trim()) : '';
}

function buildCleanExternalLink(targetUrl, labelText) {
  const cleanUrl = String(targetUrl || '').trim();
  const safeLabel = String(labelText || cleanUrl).trim();
  return `[url=https://steamcommunity.com:/linkfilter/?url=${cleanUrl}]${safeLabel}[/url]`;
}

function buildExecutableSteamUriLinks(mySteamId64 = '76561197960265728') {
  return {
    installCodenameGordon: `[url=steam://install/92][b]⚡ Instalar Reliquia Oculta: Codename: Gordon (2004)[/b][/url]`,
    addMeFriendOneClick: `[url=steam://friends/AddFriend/${mySteamId64}][b]➕ Agregar a Amigos (1-Clic Protocolo Nativo)[/b][/url]`,
    openDevConsole: `[url=steam://open/console][b]🖥️ Abrir Consola Interna de Steam[/b][/url]`,
    connect2003Server: `[url=steam://connect/127.0.0.1:2003][b]🟢 Unirse al Nodo Fundacional (127.0.0.1:2003)[/b][/url]`
  };
}

/**
 * Escanea `GET https://steamcommunity.com/profiles/${steamId64}/edit/showcases` y el perfil público
 * para descubrir todos los `purchaseid` de las vitrinas adicionales compradas en la Tienda de Puntos
 * (por ejemplo, el 2do cuadro de "Juego Favorito" donde Bruno tiene Grand Theft Auto).
 */
async function discoverShowcasePurchaseIds({
  steamId64,
  cookieString,
  customizationType = 6,
  fetchImpl = fetch
} = {}) {
  const foundForType = new Set(['0']);
  const allNonZeroPurchaseIds = new Set();
  const targetSteamId = String(steamId64 || '').trim();
  if (!targetSteamId) return { forType: ['0'], nonZeroForType: [], allNonZero: [] };

  const urlsToScan = [
    `https://steamcommunity.com/profiles/${targetSteamId}/edit/showcases`,
    `https://steamcommunity.com/profiles/${targetSteamId}/`
  ];

  for (const url of urlsToScan) {
    try {
      const res = await safeSteamFetch(
        url,
        {
          method: 'GET',
          headers: {
            Cookie: cookieString || '',
            Referer: `https://steamcommunity.com/profiles/${targetSteamId}/`
          }
        },
        fetchImpl
      );
      if (!res || !res.ok || typeof res.text !== 'function') continue;
      const html = await res.text();
      if (!html) continue;

      const cType = Number(customizationType) || 6;

      // Patrón 1: rgShowcaseConfig[6_123456] o showcase_6_123456 o [6][123456]
      const reBracket = new RegExp(`(?:rgShowcaseConfig|showcase|customization)[^a-zA-Z0-9]{0,6}${cType}[_\\]\\['"]+(\\d+)`, 'gi');
      let m;
      while ((m = reBracket.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      // Patrón 2: SetShowcaseConfig( 6, '123456' ... ) o OnShowcaseChange( ..., 6, '123456' )
      const reFunc = new RegExp(`(?:SetShowcaseConfig|OnShowcase|SelectShowcase)[\\s\\S]{0,60}?\\b${cType}\\b\\s*,\\s*['"]?(\\d+)['"]?`, 'gi');
      while ((m = reFunc.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      // Patrón 3: Bloques con data-customization_type="6" y data-purchaseid="123456" (en cualquier orden cercano)
      const reData1 = new RegExp(`customization_type\\W+${cType}[\\s\\S]{0,350}?purchaseid\\W+(\\d+)`, 'gi');
      while ((m = reData1.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }
      const reData2 = new RegExp(`purchaseid\\W+(\\d+)[\\s\\S]{0,350}?customization_type\\W+${cType}`, 'gi');
      while ((m = reData2.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      // Patrón 4: Todos los purchaseid numéricos grandes (> 0) presentes en la página de vitrinas
      const reAnyPurchase = /purchaseid['"\s:=]+['"]?(\d{2,22})['"]?/gi;
      while ((m = reAnyPurchase.exec(html)) !== null) {
        if (m[1] && m[1] !== '0') allNonZeroPurchaseIds.add(m[1]);
      }
    } catch {}
  }

  const nonZeroForType = [...foundForType].filter(id => id !== '0');
  // Si no se detectó por regex específico del tipo pero hay purchaseid adicionales en el perfil, incluirlos como candidatos del 2do cuadro
  if (nonZeroForType.length === 0 && allNonZeroPurchaseIds.size > 0) {
    for (const pid of allNonZeroPurchaseIds) {
      foundForType.add(pid);
      nonZeroForType.push(pid);
    }
  }

  return {
    forType: [...foundForType],
    nonZeroForType,
    allNonZero: [...allNonZeroPurchaseIds]
  };
}

/**
 * Envía el POST plano directamente desde el servidor de SteamFarmer a
 * `https://steamcommunity.com/profiles/${steamId64}/ajaxsetshowcaseconfig`
 * soportando `targetInstance`:
 * - `'first'`: Vitrina Principal (`purchaseid = 0`)
 * - `'second'`: 2da Vitrina comprada en la Tienda de Puntos (autodetecta el `purchaseid` real)
 * - `'both'`: Inyecta tanto en la 1ra (`0`) como en la 2da vitrina (`purchaseid` detectado)
 */
async function setProfileShowcaseSlotServerSide({
  steamId64,
  cookieString,
  customizationType = 6, // 6 = Favorite Game, 2 = Game Collector, 17 = Achievement Showcase
  purchaseId = 0,
  targetInstance = 'first', // 'first' | 'second' | 'both'
  slotIndex = 0,
  appId = 753,
  itemAssetId = '',
  title = '',
  notes = '',
  fetchImpl = fetch
} = {}) {
  const sessionId = extractSessionIdFromCookies(cookieString);
  if (!sessionId) {
    throw new Error('La sesión web de Steam aún se está sincronizando (falta cookie sessionid). Esperá 5 segundos o tocá "Refresh Steam session" arriba a la derecha.');
  }
  const targetSteamId = String(steamId64 || '').trim();
  const endpoint = targetSteamId
    ? `https://steamcommunity.com/profiles/${targetSteamId}/ajaxsetshowcaseconfig`
    : 'https://steamcommunity.com/my/ajaxsetshowcaseconfig';

  let purchaseIdsToSend = [String(purchaseId || 0)];

  if ((targetInstance === 'second' || targetInstance === 'both') && (!purchaseId || String(purchaseId) === '0')) {
    const discovered = await discoverShowcasePurchaseIds({
      steamId64: targetSteamId,
      cookieString,
      customizationType,
      fetchImpl
    });
    if (targetInstance === 'second') {
      if (discovered.nonZeroForType.length > 0) {
        purchaseIdsToSend = discovered.nonZeroForType;
      } else if (discovered.allNonZero.length > 0) {
        purchaseIdsToSend = discovered.allNonZero;
      } else {
        purchaseIdsToSend = ['0'];
      }
    } else if (targetInstance === 'both') {
      purchaseIdsToSend = ['0', ...discovered.nonZeroForType];
    }
  }

  let anySuccess = false;
  let lastData = {};
  let lastStatus = 200;
  const appliedPurchaseIds = [];

  for (const pid of purchaseIdsToSend) {
    const body = new URLSearchParams();
    body.set('customization_type', String(Number(customizationType) || 6));
    body.set('purchaseid', String(pid));
    body.set('slot', String(Number(slotIndex) || 0));
    body.set('sessionid', sessionId);
    if (appId !== undefined && appId !== null && String(appId) !== '') {
      body.set('appid', String(Number(appId)));
    }
    if (itemAssetId) body.set('item_assetid', String(itemAssetId));
    if (title) body.set('title', String(title));
    if (notes) body.set('notes', String(notes));

    const res = await safeSteamFetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookieString,
          'Origin': 'https://steamcommunity.com',
          'Referer': targetSteamId
            ? `https://steamcommunity.com/profiles/${targetSteamId}/edit/showcases`
            : 'https://steamcommunity.com/my/edit/showcases',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
      },
      fetchImpl
    );

    lastStatus = res.status;
    const data = await res.json().catch(() => ({}));
    lastData = data;
    if (res.ok && (data.success === 1 || data.success === true)) {
      anySuccess = true;
      appliedPurchaseIds.push(pid);
    }
  }

  const typeNames = {
    2: 'Expositor Coleccionista de Juegos (Tipo 2)',
    6: 'Expositor de Juego Favorito (Tipo 6)',
    17: 'Expositor de Logros (Tipo 17)'
  };
  const typeLabel = typeNames[Number(customizationType)] || `Vitrina Tipo ${customizationType}`;
  const instanceDesc = targetInstance === 'second'
    ? `2do Cuadro de ${typeLabel} (purchaseid: ${appliedPurchaseIds.join(', ') || purchaseIdsToSend.join(', ')})`
    : targetInstance === 'both'
      ? `Ambos Cuadros (#1 y #2) de ${typeLabel} (purchaseid: ${appliedPurchaseIds.join(', ') || purchaseIdsToSend.join(', ')})`
      : `Cuadro #1 de ${typeLabel} (Slot #${slotIndex})`;

  return {
    success: anySuccess,
    customizationType: Number(customizationType) || 6,
    slotIndex: Number(slotIndex) || 0,
    appId: Number(appId),
    targetInstance,
    purchaseIdsTried: purchaseIdsToSend,
    appliedPurchaseIds,
    response: lastData,
    message: anySuccess
      ? `✅ ¡Inyectado desde el servidor! AppID ${appId} grabado en tu ${instanceDesc}. Recargá tu perfil de Steam para verlo actualizado.`
      : `⚠️ Steam respondió HTTP ${lastStatus}. Si querés usar "${typeLabel}", primero entrá en Steam a "Editar perfil → Expositores", poné "${typeLabel}" en uno de tus espacios, tocá Guardar abajo del todo y volvé a presionar este botón.`
  };
}

/**
 * Inyecta una lista completa de reliquias ocultas (`92`, `1675200`, `766`, `7`)
 * en el Expositor Coleccionista de Juegos (`customization_type = 2`) desde el servidor.
 */
async function fillCollectorShowcaseWithRelics({
  steamId64,
  cookieString,
  purchaseId = 0,
  relicAppIds = [92, 1675200, 766, 7],
  fetchImpl = fetch
} = {}) {
  const results = [];
  for (let idx = 0; idx < relicAppIds.length; idx++) {
    const appId = Number(relicAppIds[idx]);
    const step = await setProfileShowcaseSlotServerSide({
      steamId64,
      cookieString,
      customizationType: 2,
      purchaseId,
      targetInstance: 'first',
      slotIndex: idx,
      appId,
      fetchImpl
    });
    results.push(step);
  }
  const injectedCount = results.filter(r => r.success).length;
  return {
    success: injectedCount > 0,
    injectedCount,
    totalRequested: relicAppIds.length,
    relicAppIds,
    results,
    message: injectedCount > 0
      ? `✅ ¡Expositor Coleccionista actualizado desde el servidor! Se inyectaron ${injectedCount}/${relicAppIds.length} AppIDs exclusivos (${relicAppIds.join(', ')}) en los slots #0 a #${relicAppIds.length - 1}.`
      : '⚠️ Para usar este botón, primero entrá en Steam a "Editar perfil → Expositores", cambiá uno de tus expositores a "Coleccionista de juegos", guardá los cambios abajo del todo y volvé a tocar este botón.'
  };
}

/**
 * Pone únicamente el inventario en Privado (`PrivacyInventory = 1`) manteniendo
 * el perfil en Público (`PrivacyProfile = 3`) para que nadie pueda ver que tenés 0 skins de CS2.
 */
async function lockInventoryPrivacyOnly({
  steamId64,
  cookieString,
  fetchImpl = fetch
} = {}) {
  const sessionId = extractSessionIdFromCookies(cookieString);
  if (!sessionId) {
    throw new Error('Sesión web de Steam no disponible (falta cookie sessionid).');
  }
  const targetSteamId = String(steamId64 || '').trim();
  const privacyJson = JSON.stringify({
    PrivacyProfile: 3,        // 3 = Público
    PrivacyInventory: 1,      // 1 = Privado (Nadie puede auditar tu inventario de CS2)
    PrivacyInventoryGifts: 1, // 1 = Privado
    PrivacyOwnedGames: 3,     // 3 = Público
    PrivacyPlaytime: 3,       // 3 = Público
    PrivacyFriendsList: 2     // 2 = Solo amigos
  });

  const body = new URLSearchParams();
  body.set('sessionid', sessionId);
  body.set('Privacy', privacyJson);
  body.set('eCommentPermission', '1');

  const res = await safeSteamFetch(
    `https://steamcommunity.com/profiles/${targetSteamId}/ajaxsetprivacy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com',
        'Referer': `https://steamcommunity.com/profiles/${targetSteamId}/edit/settings`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    },
    fetchImpl
  );

  const data = await res.json().catch(() => ({}));
  const ok = Boolean(res.ok && (data.success === 1 || data.success === true));
  return {
    success: ok,
    privacyApplied: 'Profile: PUBLIC (3) | Inventory: PRIVATE (1)',
    response: data,
    message: ok
      ? '✅ Privacidad quirúrgica aplicada: Perfil 100% Público + Inventario de CS2 en Privado.'
      : '⚠️ No se pudo confirmar el cambio de privacidad del inventario.'
  };
}

/**
 * Construye el bloque BBCode para la Reseña donde SÍ se renderizan
 * las tablas `[table]`, bloques `[code]`, los Widgets Oficiales de Skins de CS2 (`#730_2_`)
 * y el Exploit #3 (`steamcommunity.com:/linkfilter/` + `steam://install/92`).
 */
function buildApp753RelicReviewBbcode({
  steamId64 = '76561197960265728',
  accountCreatedDate = '07 Oct 2003',
  customExternalUrl = 'https://github.com/brunnnno/steam-farmer',
  customExternalLabel = '⚡ Repositorio Oficial Verificado (Sin Cartel de Dominio)',
  items = ZERO_OWNERSHIP_CS2_WIDGET_LOADOUT
} = {}) {
  const cleanLink = buildCleanExternalLink(customExternalUrl, customExternalLabel);
  const uris = buildExecutableSteamUriLinks(steamId64);

  const lines = [
    `[h1]⚡ NODO DE AUDITORÍA VALVE // CUENTA FUNDACIONAL (${accountCreatedDate})[/h1]`,
    `[table equalcells=1]`,
    `[tr][th]Parámetro de Cuenta[/th][th]Estado Verificado[/th][th]Protocolo Activo[/th][/tr]`,
    `[tr][td][b]Fecha de Creación[/b][/td][td][code]${accountCreatedDate} (23 Años)[/code][/td][td]Insignia Fundacional 2003[/td][/tr]`,
    `[tr][td][b]Enlace Limpio (Exploit #3)[/b][/td][td]${cleanLink}[/td][td]Bypass RFC 3986 (:)[/td][/tr]`,
    `[tr][td][b]Reliquia Ejecutable[/b][/td][td]${uris.installCodenameGordon}[/td][td]URI Nativo steam://[/td][/tr]`,
    `[/table]`,
    ``,
    `[h2]🎯 ARSENAL CS2 REGISTRADO EN EXPOSITOR (WIDGETS OFICIALES + INSPECCIÓN 3D)[/h2]`
  ];

  for (const item of items) {
    lines.push(`https://steamcommunity.com/profiles/${item.ownerSteamId64}/inventory/#${item.appId}_${item.contextId}_${item.assetId}`);
    lines.push(`[b]${item.name}[/b] — [code]Float: ${item.float} | ${item.pattern}[/code] • [url=${item.inspectLink}][b]🔍 Inspeccionar Modelo 3D en CS2[/b][/url]`);
    lines.push('');
  }

  return {
    brailleBlankTitle: BRAILLE_BLANK.repeat(3),
    cleanExternalLink: cleanLink,
    executableUris: uris,
    bbcode: lines.join('\n')
  };
}

/**
 * Orquestador Server-Side que publica la reseña usando transporte IPv4 (`safeSteamFetch`)
 * para no tirar jamás `fetch failed` en Render, y SIEMPRE devuelve `bbcodeUsed` para que
 * el cuadro de texto de la interfaz se llene al instante.
 */
async function publishApp753RelicReviewServerSide({
  steamId64,
  cookieString,
  appId = 730,
  comment,
  ratedUp = true,
  isPublic = true,
  language = 'spanish',
  lockInventoryFirst = true,
  customExternalUrl = 'https://github.com/brunnnno/steam-farmer',
  customExternalLabel = '⚡ Proyecto Oficial de Ingeniería Inversa',
  fetchImpl = fetch
} = {}) {
  const generated = buildApp753RelicReviewBbcode({
    steamId64: steamId64 || '76561197960265728',
    accountCreatedDate: '07 Oct 2003',
    customExternalUrl,
    customExternalLabel
  });
  const finalComment = String(comment || generated.bbcode).trim();
  const targetAppId = Number(appId) || 730;

  const sessionId = extractSessionIdFromCookies(cookieString);
  if (!sessionId) {
    return {
      success: false,
      appId: targetAppId,
      bbcodeUsed: finalComment,
      message: '⚠️ El código BBCode ya quedó generado abajo para copiar, pero la sesión web de Steam aún se está sincronizando. Esperá 5 segundos o copiá el código del recuadro negro.'
    };
  }

  let privacyResult = null;
  if (lockInventoryFirst && steamId64) {
    try {
      privacyResult = await lockInventoryPrivacyOnly({ steamId64, cookieString, fetchImpl });
    } catch {
      privacyResult = { success: false };
    }
  }

  const body = new URLSearchParams();
  body.set('appid', String(targetAppId));
  body.set('steamworksappid', String(targetAppId));
  body.set('comment', finalComment);
  body.set('rated_up', ratedUp ? 'true' : 'false');
  body.set('is_public', isPublic ? 'true' : 'false');
  body.set('language', String(language || 'spanish'));
  body.set('received_compensation', '0');
  body.set('disable_comments', '0');
  body.set('sessionid', sessionId);

  try {
    const res = await safeSteamFetch(
      'https://store.steampowered.com/friends/recommendgame',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookieString,
          'Origin': 'https://store.steampowered.com',
          'Referer': `https://store.steampowered.com/app/${targetAppId}/`,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
      },
      fetchImpl
    );

    const data = await res.json().catch(() => ({}));
    const ok = Boolean(res.ok && (data.success === 1 || data.success === true));

    // Si la reseña se creó con éxito, intentar inyectarla automáticamente en el Expositor de Reseña (Tipo 10)
    if (ok && steamId64) {
      try {
        await setProfileShowcaseSlotServerSide({
          steamId64,
          cookieString,
          customizationType: 10,
          slotIndex: 0,
          appId: targetAppId,
          fetchImpl
        });
      } catch {}
    }

    return {
      success: ok,
      appId: targetAppId,
      privacyResult,
      bbcodeUsed: finalComment,
      response: data,
      message: ok
        ? `✅ ¡Reseña sobre AppID ${targetAppId} publicada con éxito con tabla [table] (07 Oct 2003), Exploit #3 y Widgets Oficiales de CS2 (#730_2_)! Entrá en Steam a "Editar perfil → Expositores → Expositor de reseña" y elegí esta reseña para mostrar las skins en tu perfil.`
        : `ℹ️ Tu inventario de CS2 ya quedó oculto en Privado y el código BBCode completo ya apareció en el cuadro negro de abajo. Como tu navegador tiene la sesión de la Tienda (store.steampowered.com), simplemente copiá el texto del cuadro negro de abajo, abrí store.steampowered.com/app/${targetAppId}/ en tu navegador, pegalo en "Escribir una reseña" y publicala en 1 clic.`
    };
  } catch (err) {
    return {
      success: false,
      appId: targetAppId,
      privacyResult,
      bbcodeUsed: finalComment,
      message: `ℹ️ Tu inventario ya está en Privado y el código BBCode completo ya se generó en el cuadro negro de abajo. Copialo, entrá a store.steampowered.com/app/${targetAppId}/ desde tu navegador, pegalo donde dice "Escribir una reseña" y luego elegila en tu "Expositor de reseña".`
    };
  }
}

/**
 * ============================================================================
 * MOTOR 4: INYECTOR BINARIO DE CAPTURAS (`EMsg 5514`) + ETIQUETA A GABE NEWELL
 *          CON COHERENCIA HISTÓRICA (`24 Feb 2011` o `07 Oct 2003`)
 * ============================================================================
 */
function resolveHistoricalScreenshotTimestamp(datePreset = 'screenshots_day1_2011', customTimestamp = null) {
  if (customTimestamp !== null && customTimestamp !== undefined && String(customTimestamp).trim() !== '') {
    const numeric = Number(customTimestamp);
    if (Number.isFinite(numeric) && numeric > 0) return { timestamp: numeric >>> 0, label: `Timestamp personalizado (${numeric >>> 0})` };
    const parsedMs = Date.parse(String(customTimestamp));
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      const ts = Math.floor(parsedMs / 1000) >>> 0;
      return { timestamp: ts, label: `Fecha personalizada (${new Date(ts * 1000).toISOString().slice(0, 10)})` };
    }
  }
  if (datePreset === 'account_oct7_2003') {
    return {
      timestamp: BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP,
      label: '07 de Octubre de 2003 (Creación exacta de tu cuenta de Steam)'
    };
  }
  if (datePreset === 'current') {
    const nowSec = Math.floor(Date.now() / 1000) >>> 0;
    return {
      timestamp: nowSec,
      label: `Fecha actual (${new Date(nowSec * 1000).toISOString().slice(0, 10)})`
    };
  }
  return {
    timestamp: STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
    label: '24 de Febrero de 2011 (Día 1 del lanzamiento de Capturas en Steam)'
  };
}

function encodeUcmAddScreenshotWire({
  appId = 753,
  filename = 'screenshots/relic_oct7_2003_node.jpg',
  thumbname = 'screenshots/thumbs/relic_oct7_2003_node.jpg',
  rtime32Created = STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
  width = 1920,
  height = 1080,
  permissions = 2,
  caption = '⚡ [CUENTA FUNDACIONAL: 07 OCT 2003] // REGISTRO UCM VERIFICADO',
  shortcutName = '',
  taggedSteamIds = [GABE_NEWELL_STEAMID64]
} = {}) {
  const chunks = [
    encodeFieldVarint(1, Number(appId) >>> 0),
    encodeFieldBytes(2, String(filename)),
    encodeFieldBytes(3, String(thumbname)),
    encodeFieldFixed32(4, Number(rtime32Created) >>> 0),
    encodeFieldVarint(5, Number(width) >>> 0),
    encodeFieldVarint(6, Number(height) >>> 0),
    encodeFieldVarint(7, Number(permissions) >>> 0),
    encodeFieldBytes(8, String(caption))
  ];
  if (shortcutName) {
    chunks.push(encodeFieldBytes(9, String(shortcutName)));
  }
  for (const sid of (Array.isArray(taggedSteamIds) ? taggedSteamIds : [taggedSteamIds])) {
    if (sid && /^\d+$/.test(String(sid).trim())) {
      chunks.push(encodeFieldFixed64(11, BigInt(String(sid).trim())));
    }
  }
  return Buffer.concat(chunks);
}

function injectUcmScreenshotServerSide(client, options = {}) {
  if (!client || typeof client._send !== 'function') {
    throw new Error('Tu cuenta de Steam no está conectada en este momento. Verificá que el estado arriba diga "Connected" antes de enviar el paquete binario EMsg 5514.');
  }

  const appId = Number(options.appId) || 753;
  const { timestamp, label } = resolveHistoricalScreenshotTimestamp(
    options.datePreset || 'screenshots_day1_2011',
    options.customTimestamp
  );
  const taggedSteamIds = Array.isArray(options.taggedSteamIds) && options.taggedSteamIds.length
    ? options.taggedSteamIds.map(String)
    : [GABE_NEWELL_STEAMID64];
  const caption = String(
    options.caption || '⚡ [CUENTA FUNDACIONAL: 07 OCT 2003] // ARCHIVO OFICIAL UCM'
  ).trim();
  const filename = String(options.filename || 'screenshots/relic_oct7_2003_node.jpg').trim();
  const thumbname = String(options.thumbname || 'screenshots/thumbs/relic_oct7_2003_node.jpg').trim();

  const wireBuffer = encodeUcmAddScreenshotWire({
    appId,
    filename,
    thumbname,
    rtime32Created: timestamp,
    width: Number(options.width) || 1920,
    height: Number(options.height) || 1080,
    permissions: 2,
    caption,
    taggedSteamIds
  });

  const emsgCode = EMsg.ClientUCMAddScreenshot || 5514;
  client._send({ msg: emsgCode, proto: {} }, wireBuffer);

  return {
    success: true,
    emsg: emsgCode,
    appId,
    rtime32Created: timestamp,
    dateLabel: label,
    taggedSteamIds,
    caption,
    wireBytesLength: wireBuffer.length,
    wireHexPreview: wireBuffer.subarray(0, 32).toString('hex'),
    message: `✅ Paquete binario CMsgClientUCMAddScreenshot (EMsg ${emsgCode}, ${wireBuffer.length} bytes en Wire-Protobuf) despachado al CM de Valve con fecha "${label}" y etiqueta a Gabe Newell (${taggedSteamIds.join(', ')}).`
  };
}

module.exports = {
  BRAILLE_BLANK,
  GABE_NEWELL_STEAMID64,
  BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP,
  STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
  HIDDEN_VALVE_RELIC_APPS,
  ZERO_OWNERSHIP_CS2_WIDGET_LOADOUT,
  httpsRequestIPv4,
  safeSteamFetch,
  // Motor 1: Wire-Level Protobuf
  writeVarint,
  readVarint,
  encodeFieldVarint,
  encodeFieldFixed64,
  encodeFieldBytes,
  encodeFieldFixed32,
  decodeWireFields,
  encodeSteamDeckRegistrationWire,
  encodeWatchBroadcastWire,
  encodeToggleAppPrivacyWire,
  encodeChangeStatusWire,
  // Motor 3: Vitrinas Server-Side (Multi-Showcase purchaseid) + Reseña + Widgets CS2 + Exploit #3
  extractSessionIdFromCookies,
  buildCleanExternalLink,
  buildExecutableSteamUriLinks,
  discoverShowcasePurchaseIds,
  setProfileShowcaseSlotServerSide,
  fillCollectorShowcaseWithRelics,
  lockInventoryPrivacyOnly,
  buildApp753RelicReviewBbcode,
  publishApp753RelicReviewServerSide,
  // Motor 4: Capturas UCM EMsg 5514 + Etiqueta Gabe Newell
  resolveHistoricalScreenshotTimestamp,
  encodeUcmAddScreenshotWire,
  injectUcmScreenshotServerSide
};
