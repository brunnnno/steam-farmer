'use strict';

/**
 * REA OVERWATCH 2003 ENGINE — MOTORES 1, 3 Y 4 (100% BACKEND / WIRE-PROTOBUF)
 * ============================================================================
 * Diseñado a medida para la cuenta fundacional de Bruno (Creada el 7 de Octubre de 2003):
 *
 * - MOTOR 1: Codificador/Decodificador Binario Protobuf Wire-Format en Puro JS.
 * - MOTOR 3A: Mutador Server-Side de Vitrinas Ocultas con Autodetección de `purchaseid`
 *   tanto para el 1er/2do "Juego Favorito" (Tipo 6) como para el 1er/2do "Coleccionista
 *   de Juegos" (Tipo 2, permitiendo llenar 4 o los 12 slots de cualquiera de las 2
 *   colecciones o inyectar cualquier slot individual 0..11).
 * - MOTOR 3B:
 *   1) Generador Gráfico HD de "Expositor de Objetos CS2 + Arma 3D" (descarga los renders
 *      3D reales en PNG del CDN oficial de Valve y arma los 7 cuadrados de inventario +
 *      el visor 3D gigante sin textos).
 *   2) Escáner en Vivo de `assetId` Reales (`fetchLivePublicCs2Widgets`) para que los
 *      cuadrados `#730_2_{assetId}` en reseñas/guías apunten a ítems vivos actuales.
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
const GARRY_NEWMAN_STEAMID64 = '76561197960279927'; // Garry Newman (Creador de Garry's Mod — STEAM_0:1:7099)
const ROBIN_WALKER_STEAMID64 = '76561197960435530'; // Robin Walker (Creador de Team Fortress)
const CHET_FALISZEK_STEAMID64 = '76561197960279929'; // Chet Faliszek (Escritor de Half-Life / Portal / L4D)

const FAMOUS_STEAM_PROFILES_TO_TAG = [
  { id: 'none', name: '🚫 Sin etiquetar a nadie (Sin Gabe Newell)', steamIds: [] },
  { id: "garry", name: "🛠️ Garry Newman (Creador de Garry's Mod — 76561197960279927)", steamIds: [GARRY_NEWMAN_STEAMID64] },
  { id: 'gabe', name: '👑 Gabe Newell (Fundador de Valve — 76561197960287930)', steamIds: [GABE_NEWELL_STEAMID64] },
  { id: 'gabe_and_garry', name: '👑+🛠️ Gabe Newell + Garry Newman (Ambos en la captura)', steamIds: [GABE_NEWELL_STEAMID64, GARRY_NEWMAN_STEAMID64] },
  { id: 'robin', name: '🎩 Robin Walker (Creador de Team Fortress 2 — 76561197960435530)', steamIds: [ROBIN_WALKER_STEAMID64] },
  { id: 'chet', name: '🧟 Chet Faliszek (Escritor de Half-Life / Portal / L4D — 76561197960279929)', steamIds: [CHET_FALISZEK_STEAMID64] }
];

const BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP = 1065484800; // 7 de Octubre de 2003 00:00:00 UTC
const STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP = 1296518400; // 1 de Febrero de 2011 00:00:00 UTC (Día 1 Beta de Capturas en Steam)
const STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP = 1298505600; // 24 de Febrero de 2011 00:00:00 UTC (Salida Oficial v1.0)

const RELIC_OFFICIAL_NAMES = {
  7: 'Steam Client',
  8: 'WinUI',
  92: 'Codename: Gordon',
  211: 'Source SDK',
  340: 'Half-Life 2: Lost Coast',
  480: 'Spacewar',
  753: 'Steam',
  760: 'Steam Screenshots',
  761: 'Steam Cloud / Video',
  766: 'Steam Workshop',
  767: 'Steam Artwork',
  250820: 'SteamVR',
  353370: 'Steam Link',
  353380: 'Steam Controller',
  1059530: 'Valve Index VR Kit',
  1675200: 'Steam Deck'
};

// Catálogo expandido con las 16 reliquias, hardware y subsistemas más exclusivos de Valve
const HIDDEN_VALVE_RELIC_APPS = [
  { appId: 92, name: 'Codename: Gordon (Reliquia Flash 2D de Half-Life retirada en 2008 — Con Imagen)', hasBanner: true },
  { appId: 766, name: 'Steam Workshop (Subsistema Interno de Valve — Con Imagen)', hasBanner: true },
  { appId: 753, name: 'Steam (Ecosistema Oficial Valve — Con Imagen)', hasBanner: true },
  { appId: 1675200, name: 'Steam Deck (Hardware Oficial Valve — Con Imagen)', hasBanner: true },
  { appId: 1059530, name: 'Valve Index VR Kit (Hardware VR de $1,000 USD — Con Imagen)', hasBanner: true },
  { appId: 353380, name: 'Steam Controller (Hardware Retirado 2015 — Con Imagen)', hasBanner: true },
  { appId: 353370, name: 'Steam Link (Hardware Retirado 2015 — Con Imagen)', hasBanner: true },
  { appId: 250820, name: 'SteamVR (Subsistema de Realidad Virtual Valve — Con Imagen)', hasBanner: true },
  { appId: 340, name: 'Half-Life 2: Lost Coast (Tech Demo HDR 2005 — Con Imagen)', hasBanner: true },
  { appId: 211, name: 'Source SDK (Kit de Ingeniería Source Engine 2004 — Con Imagen)', hasBanner: true },
  { appId: 480, name: 'Spacewar (App Secreta de Ingeniería Steamworks SDK)', hasBanner: false },
  { appId: 760, name: 'Steam Screenshots (Subsistema Interno UCM de Capturas)', hasBanner: false },
  { appId: 767, name: 'Steam Artwork (Subsistema Interno de Obras de Arte)', hasBanner: false },
  { appId: 7, name: 'Steam Client (Ejecutable Núcleo Original 2003 — Sin Imagen CDN)', hasBanner: false },
  { appId: 8, name: 'WinUI (Interfaz Original de Steam de Octubre 2003 — Sin Imagen CDN)', hasBanner: false },
  { appId: 761, name: 'Steam Cloud / Video (Subsistema Interno de Nube)', hasBanner: false }
];

const ZERO_OWNERSHIP_CS2_WIDGET_LOADOUT = [
  {
    slot: 0,
    ownerSteamId64: '76561198084852298',
    appId: 730,
    contextId: 2,
    assetId: '40291837461',
    name: '★ Karambit | Case Hardened',
    wear: 'Factory New',
    float: '0.0480829',
    pattern: 'Pattern #387 (Blue Gem Tier-1)',
    rarityColor: '#8650ac',
    statTrak: false,
    souvenir: false,
    stickers: ['Titan (Holo) | Katowice 2014'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf2PLacDBA5ciJlY20k_jkI7fUhFRB4MRij7r--YXygED6_UZrZ2H3I4fAdlI9ZVrU-1K9xO_p1J65tZ_Mn3Rk7nUl4CvD30vgN4c_0vI/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198084852298A9946351222D14440407685094987611'
  },
  {
    slot: 1,
    ownerSteamId64: '76561198023512965',
    appId: 730,
    contextId: 2,
    assetId: '40192837462',
    name: 'Souvenir AWP | Dragon Lore',
    wear: 'Factory New',
    float: '0.0009142',
    pattern: '4x Katowice 2014 (Holo)',
    rarityColor: '#ffd700',
    statTrak: false,
    souvenir: true,
    stickers: ['Titan (Holo)', 'iBUYPOWER (Holo)', 'Reason (Holo)', 'Vox Eminor (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FAR17PLfYQJD_9W7m5a0mvLwOq7cqWdQ-sJ0xOzAot-jiQa3-hBqY26ncIeVdlI6aA7T-FfsxLvr05C56p3MnWwj5HeAvkVdtA/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198023512965A28761239912D9244972541062093545'
  },
  {
    slot: 2,
    ownerSteamId64: '76561198165821922',
    appId: 730,
    contextId: 2,
    assetId: '40381920114',
    name: 'StatTrak™ AK-47 | Case Hardened',
    wear: 'Factory New',
    float: '0.0114021',
    pattern: 'Pattern #661 (Scar) + 4x Titan Holo',
    rarityColor: '#cf6a32',
    statTrak: true,
    souvenir: false,
    stickers: ['Titan (Holo)', 'Titan (Holo)', 'Titan (Holo)', 'Titan (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot7HxfDhjxszJemkV086jloKOhcj4OrzZgiVU6dN4teXI8oThxlCx-ks5ZGH6I4XEdlA4M1nTqVm8wO3s0Z-7vM7LzHBl6ygi7WGdwUJqz1_b9g/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198165821922A35481920114D7812390412894012567'
  },
  {
    slot: 3,
    ownerSteamId64: '76561198019283746',
    appId: 730,
    contextId: 2,
    assetId: '40492837465',
    name: 'StatTrak™ M4A4 | Howl',
    wear: 'Factory New',
    float: '0.0003198',
    pattern: '4x iBUYPOWER (Holo) Katowice 2014',
    rarityColor: '#e4ae39',
    statTrak: true,
    souvenir: false,
    stickers: ['iBP (Holo)', 'iBP (Holo)', 'iBP (Holo)', 'iBP (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpou-6kejhjxszFJTwW09izh4-HluPxDKjBl2hU18l4jeHVu9Tw2Q218xA6MWz3Jo6ddQE8ZVrU_1K9wO_p1pO7v53LzWwj5HeA02_94Q/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198019283746A19283746512D1627384950192837465'
  },
  {
    slot: 4,
    ownerSteamId64: '76561198084852298',
    appId: 730,
    contextId: 2,
    assetId: '40592837466',
    name: '★ Butterfly Knife | Gamma Doppler',
    wear: 'Factory New',
    float: '0.0001204',
    pattern: 'Phase: Emerald (#1 Rank)',
    rarityColor: '#8650ac',
    statTrak: true,
    souvenir: false,
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf0ebcZThQ6tCvq4GGqPD1PrbQqW9e-NV9j_v-5YT0m1HllB81NDG3Oo6cdlU_N1zV_1m9xO_p1J65tZ_Mn3Rk7nUl4CvD30vgW-4K9A/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198084852298A9946351222D14440407685094987611'
  },
  {
    slot: 5,
    ownerSteamId64: '76561198023512965',
    appId: 730,
    contextId: 2,
    assetId: '40692837467',
    name: '★ Sport Gloves | Pandora\'s Box',
    wear: 'Factory New',
    float: '0.0601102',
    pattern: 'Flawless Knuckles',
    rarityColor: '#8650ac',
    statTrak: false,
    souvenir: false,
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJfwObaZzRU7dCJlo-cnvLLMrfummpD78A_3rmZoo7zig218xA4Zzr3I46ddwM8N1zR-Vm9wO3q1pO7tM7LzWwj5HeA82_85g/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198023512965A28761239912D9244972541062093545'
  },
  {
    slot: 6,
    ownerSteamId64: '76561198165821922',
    appId: 730,
    contextId: 2,
    assetId: '40792837468',
    name: '★ M9 Bayonet | Doppler',
    wear: 'Factory New',
    float: '0.0000419',
    pattern: 'Phase: Ruby (#1 Rank)',
    rarityColor: '#8650ac',
    statTrak: true,
    souvenir: false,
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf3qr3czxb49KzgL-KmsjwPKvBmm5D19V5i_rEobP5gVO8v11qa2j3J4OVdlQ4ZVrU-1C9wO3s0Z-7vM7LzHBl6ygi7WGdwUJqz1_b9g/512fx384f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198165821922A35481920114D7812390412894012567'
  }
];

function httpsRequestIPv4(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyBuf = options.body
      ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8'))
      : null;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, text/html, image/png, */*; q=0.01',
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
          const rawBuffer = Buffer.concat(chunks);
          const textBody = rawBuffer.toString('utf8');
          const status = res.statusCode || 200;
          resolve({
            ok: status >= 200 && status < 400,
            status,
            headers: res.headers,
            buffer: async () => rawBuffer,
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
 * MOTOR 3A: MUTADOR SERVER-SIDE DE VITRINAS OCULTAS (SOPORTE COMPLETO PARA
 *           1ER Y 2DO "JUEGO FAVORITO" Y 1ER Y 2DO "COLECCIONISTA DE JUEGOS")
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
 * (tanto el 2do "Juego Favorito" Tipo 6 como el 2do "Coleccionista de Juegos" Tipo 2).
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

      const reBracket = new RegExp(`(?:rgShowcaseConfig|showcase|customization)[^a-zA-Z0-9]{0,6}${cType}[_\\]\\['"]+(\\d+)`, 'gi');
      let m;
      while ((m = reBracket.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      const reFunc = new RegExp(`(?:SetShowcaseConfig|OnShowcase|SelectShowcase)[\\s\\S]{0,60}?\\b${cType}\\b\\s*,\\s*['"]?(\\d+)['"]?`, 'gi');
      while ((m = reFunc.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      const reData1 = new RegExp(`customization_type\\W+${cType}[\\s\\S]{0,350}?purchaseid\\W+(\\d+)`, 'gi');
      while ((m = reData1.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }
      const reData2 = new RegExp(`purchaseid\\W+(\\d+)[\\s\\S]{0,350}?customization_type\\W+${cType}`, 'gi');
      while ((m = reData2.exec(html)) !== null) {
        if (m[1]) foundForType.add(m[1]);
      }

      const reAnyPurchase = /purchaseid['"\s:=]+['"]?(\d{2,22})['"]?/gi;
      while ((m = reAnyPurchase.exec(html)) !== null) {
        if (m[1] && m[1] !== '0') allNonZeroPurchaseIds.add(m[1]);
      }
    } catch {}
  }

  const nonZeroForType = [...foundForType].filter(id => id !== '0');
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

async function setProfileShowcaseSlotServerSide({
  steamId64,
  cookieString,
  customizationType = 6,
  purchaseId = 0,
  preDiscoveredPurchaseIds = null,
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
    throw new Error('La sesión web de Steam aún se está sincronizando (falta cookie sessionid). Esperá 5 segundos o tocá "Refresh Steam session".');
  }
  const targetSteamId = String(steamId64 || '').trim();
  const endpoint = targetSteamId
    ? `https://steamcommunity.com/profiles/${targetSteamId}/ajaxsetshowcaseconfig`
    : 'https://steamcommunity.com/my/ajaxsetshowcaseconfig';

  let purchaseIdsToSend = Array.isArray(preDiscoveredPurchaseIds) && preDiscoveredPurchaseIds.length
    ? preDiscoveredPurchaseIds
    : [String(purchaseId || 0)];

  if (!preDiscoveredPurchaseIds && (targetInstance === 'second' || targetInstance === 'both') && (!purchaseId || String(purchaseId) === '0')) {
    const discovered = await discoverShowcasePurchaseIds({
      steamId64: targetSteamId,
      cookieString,
      customizationType,
      fetchImpl
    });
    const candidates = [...new Set([...discovered.nonZeroForType, ...discovered.allNonZero])];
    if (targetInstance === 'second') {
      purchaseIdsToSend = candidates.length > 0 ? candidates : ['0'];
    } else if (targetInstance === 'both') {
      purchaseIdsToSend = ['0', ...candidates];
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
    2: 'Coleccionista de Juegos (Tipo 2)',
    6: 'Juego Favorito (Tipo 6)',
    17: 'Expositor de Logros (Tipo 17)'
  };
  const typeLabel = typeNames[Number(customizationType)] || `Vitrina Tipo ${customizationType}`;
  const instanceDesc = targetInstance === 'second'
    ? `2da Vitrina de ${typeLabel} (Tienda de Puntos — Slot #${Number(slotIndex) + 1})`
    : targetInstance === 'both'
      ? `Ambas Vitrinas (#1 y #2) de ${typeLabel} (Slot #${Number(slotIndex) + 1})`
      : `1ra Vitrina de ${typeLabel} (Slot #${Number(slotIndex) + 1})`;

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
      ? `✅ ¡Inyectado desde el servidor! AppID ${appId} grabado en tu ${instanceDesc}. Recargá tu perfil de Steam para verlo.`
      : `⚠️ Steam respondió HTTP ${lastStatus}. Asegurate de tener "${typeLabel}" activo en "Editar perfil → Expositores".`
  };
}

/**
 * Inyecta una lista completa de reliquias ocultas (4 o 12 slots) en el
 * 1er Coleccionista (`first`), en el 2do Coleccionista de la Tienda de Puntos (`second`)
 * o en AMBOS Coleccionistas a la vez (`both`)!
 */
async function fillCollectorShowcaseWithRelics({
  steamId64,
  cookieString,
  purchaseId = 0,
  targetInstance = 'first', // 'first' | 'second' | 'both'
  relicAppIds = [753, 766, 92, 1675200],
  fetchImpl = fetch
} = {}) {
  const targetSteamId = String(steamId64 || '').trim();
  let preDiscoveredPurchaseIds = [String(purchaseId || 0)];

  if ((targetInstance === 'second' || targetInstance === 'both') && (!purchaseId || String(purchaseId) === '0')) {
    const discovered = await discoverShowcasePurchaseIds({
      steamId64: targetSteamId,
      cookieString,
      customizationType: 2,
      fetchImpl
    });
    const candidates = [...new Set([...discovered.nonZeroForType, ...discovered.allNonZero])];
    if (targetInstance === 'second') {
      preDiscoveredPurchaseIds = candidates.length > 0 ? candidates : ['0'];
    } else if (targetInstance === 'both') {
      preDiscoveredPurchaseIds = ['0', ...candidates];
    }
  }

  const results = [];
  for (let idx = 0; idx < relicAppIds.length; idx++) {
    const appId = Number(relicAppIds[idx]);
    const step = await setProfileShowcaseSlotServerSide({
      steamId64,
      cookieString,
      customizationType: 2,
      purchaseId,
      preDiscoveredPurchaseIds,
      targetInstance,
      slotIndex: idx,
      appId,
      fetchImpl
    });
    results.push(step);
  }
  const injectedCount = results.filter(r => r.success).length;
  const targetLabel = targetInstance === 'second'
    ? 'tu 2do Coleccionista de Juegos (Tienda de Puntos)'
    : targetInstance === 'both'
      ? 'AMBOS Coleccionistas de Juegos (#1 y #2)'
      : 'tu 1er Coleccionista de Juegos';

  return {
    success: injectedCount > 0,
    injectedCount,
    totalRequested: relicAppIds.length,
    targetInstance,
    purchaseIdsUsed: preDiscoveredPurchaseIds,
    relicAppIds,
    results,
    message: injectedCount > 0
      ? `✅ ¡${targetLabel} actualizado desde el servidor! Se inyectaron ${injectedCount}/${relicAppIds.length} AppIDs exclusivos con imagen (${relicAppIds.join(', ')}) en los slots #1 a #${relicAppIds.length}.`
      : `⚠️ No se pudo actualizar ${targetLabel}. Verificá que tengas el expositor "Coleccionista de juegos" activo en tu perfil.`
  };
}

/**
 * ============================================================================
 * MOTOR 3B: GENERADOR VISUAL HD DE "EXPOSITOR DE OBJETOS CS2 + ARMA 3D"
 *           (DESCARGA LOS RENDERS 3D REALES DEL CDN DE VALVE Y ARMA LA VITRINA
 *           GRÁFICA SIN TEXTOS: SOLO LOS 7 CUADRADOS + EL ARMA 3D GRANDE)
 * ============================================================================
 */
async function generateVisualCs2ShowcaseData({
  featuredSlotIndex = 0,
  showcaseTitle = 'Expositor de objetos',
  fetchImpl = fetch
} = {}) {
  const items = ZERO_OWNERSHIP_CS2_WIDGET_LOADOUT.slice(0, 7);
  const featured = items[Number(featuredSlotIndex) || 0] || items[0];

  // Descargar las imágenes PNG 3D reales desde el CDN de Valve en paralelo por IPv4 para incrustarlas como data URI
  const iconDataUris = await Promise.all(
    items.map(async item => {
      try {
        const res = await safeSteamFetch(item.cdnIcon, { method: 'GET', timeoutMs: 7000 }, fetchImpl);
        if (res && res.ok && typeof res.buffer === 'function') {
          const buf = await res.buffer();
          if (buf && buf.length > 100) {
            return `data:image/png;base64,${buf.toString('base64')}`;
          }
        }
      } catch {}
      return item.cdnIcon;
    })
  );

  const featuredIconUri = iconDataUris[Number(featuredSlotIndex) || 0] || iconDataUris[0];

  const slotBoxesSvg = items.map((item, idx) => {
    const x = 14 + idx * 88;
    const y = 44;
    const isSelected = idx === (Number(featuredSlotIndex) || 0);
    const borderCol = isSelected ? '#ffffff' : item.rarityColor;
    const badgeCol = item.souvenir ? '#ffd700' : (item.statTrak ? '#cf6a32' : item.rarityColor);
    const badgeLabel = item.souvenir ? 'SOUVENIR' : (item.statTrak ? 'StatTrak™' : 'FN');
    return `
      <g transform="translate(${x}, ${y})">
        <rect width="80" height="80" rx="3" fill="#101622" stroke="${borderCol}" stroke-width="${isSelected ? '2.5' : '1.8'}"/>
        <rect width="80" height="80" rx="3" fill="url(#slotRadial)" opacity="0.55"/>
        <image href="${iconDataUris[idx]}" x="4" y="6" width="72" height="56" preserveAspectRatio="xMidYMid meet"/>
        <rect x="4" y="62" width="72" height="14" rx="2" fill="rgba(8,11,16,0.85)" stroke="${badgeCol}" stroke-width="0.8"/>
        <text x="40" y="72" fill="${badgeCol}" font-family="Arial, sans-serif" font-size="8.5" font-weight="bold" text-anchor="middle">${escapeXml(badgeLabel)}</text>
      </g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="636" height="360" viewBox="0 0 636 360">
  <defs>
    <linearGradient id="showcaseBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#141b26"/>
      <stop offset="100%" stop-color="#0b0f17"/>
    </linearGradient>
    <linearGradient id="headerBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1b2838"/>
      <stop offset="100%" stop-color="#101822"/>
    </linearGradient>
    <radialGradient id="slotRadial" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2c4466" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#101622" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="stage3dGlow" cx="50%" cy="48%" r="48%">
      <stop offset="0%" stop-color="${featured.rarityColor}" stop-opacity="0.38"/>
      <stop offset="60%" stop-color="#1b2838" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0d121a" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Fondo Oficial Vitrina Steam -->
  <rect width="636" height="360" rx="5" fill="url(#showcaseBg)" stroke="#233044" stroke-width="1"/>
  <rect width="636" height="32" rx="5" fill="url(#headerBar)"/>
  <text x="14" y="21" fill="#66c0f4" font-family="Arial, sans-serif" font-size="13" font-weight="normal">${escapeXml(showcaseTitle)}</text>

  <!-- Fila Superior: Los 7 Cuadrados Oficiales de Inventario -->
  ${slotBoxesSvg}

  <!-- Escenario Inferior: Visor de Arma 3D Destacada -->
  <rect x="14" y="134" width="608" height="212" rx="4" fill="#0d131c" stroke="#26354a" stroke-width="1.2"/>
  <rect x="14" y="134" width="608" height="212" rx="4" fill="url(#stage3dGlow)"/>

  <!-- Render 3D Gigante del Arma en el Centro -->
  <image href="${featuredIconUri}" x="158" y="138" width="320" height="175" preserveAspectRatio="xMidYMid meet"/>

  <!-- Etiquetas Oficiales de Inspección 3D CS2 -->
  <text x="28" y="160" fill="${featured.rarityColor}" font-family="Arial, sans-serif" font-size="15" font-weight="bold">${escapeXml(featured.name)} (${escapeXml(featured.wear)})</text>
  <text x="28" y="178" fill="#9fb4c7" font-family="Consolas, monospace" font-size="11">${escapeXml(featured.pattern)} • Float IEEE-754: ${escapeXml(featured.float)}</text>

  <!-- Barra de Float CS2 -->
  <rect x="28" y="314" width="220" height="7" rx="3" fill="#1e293b"/>
  <rect x="28" y="314" width="38" height="7" rx="3" fill="#22c55e"/>
  <rect x="66" y="314" width="45" height="7" fill="#84cc16"/>
  <rect x="111" y="314" width="55" height="7" fill="#eab308"/>
  <rect x="166" y="314" width="82" height="7" rx="3" fill="#ef4444"/>
  <circle cx="34" cy="317.5" r="5" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>

  <!-- Botón Nativo de Steam "Inspeccionar en el juego..." -->
  <rect x="442" y="304" width="164" height="28" rx="3" fill="#2a475e" stroke="#66c0f4" stroke-width="0.8"/>
  <text x="524" y="322" fill="#ffffff" font-family="Arial, sans-serif" font-size="11.5" font-weight="bold" text-anchor="middle">🔍 Inspeccionar en el juego...</text>
</svg>`;

  return {
    success: true,
    featuredItem: featured,
    svg,
    svgBase64: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    svgDataUri: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    message: `✅ Vitrina gráfica CS2 3D generada con los 7 cuadrados de inventario y el render 3D gigante de "${featured.name}".`
  };
}

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
    PrivacyProfile: 3,
    PrivacyInventory: 1,
    PrivacyInventoryGifts: 1,
    PrivacyOwnedGames: 3,
    PrivacyPlaytime: 3,
    PrivacyFriendsList: 2
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

function buildApp753RelicReviewBbcode({
  steamId64 = '76561197960265728',
  accountCreatedDate = '07 Oct 2003',
  customExternalUrl = 'https://github.com/brunnnno/steam-farmer',
  customExternalLabel = '⚡ Proyecto Oficial de Ingeniería Inversa'
} = {}) {
  const cleanLink = buildCleanExternalLink(customExternalUrl, customExternalLabel);
  const uris = buildExecutableSteamUriLinks(steamId64);
  const cleanInspectKarambit = buildCleanExternalLink('https://steamcommunity.com/market/listings/730/%E2%98%85%20Karambit%20%7C%20Case%20Hardened%20%28Factory%20New%29', '🔍 Ver Registro Oficial #387');
  const cleanInspectDlore = buildCleanExternalLink('https://steamcommunity.com/market/listings/730/Souvenir%20AWP%20%7C%20Dragon%20Lore%20%28Factory%20New%29', '🔍 Ver Registro Oficial Souvenir');
  const cleanInspectAk = buildCleanExternalLink('https://steamcommunity.com/market/listings/730/StatTrak%E2%84%A2%20AK-47%20%7C%20Case%20Hardened%20%28Factory%20New%29', '🔍 Ver Registro Oficial #661');
  const cleanInspectHowl = buildCleanExternalLink('https://steamcommunity.com/market/listings/730/StatTrak%E2%84%A2%20M4A4%20%7C%20Howl%20%28Factory%20New%29', '🔍 Ver Registro Contrabando');
  const cleanInspectBfk = buildCleanExternalLink('https://steamcommunity.com/market/listings/730/%E2%98%85%20Butterfly%20Knife%20%7C%20Gamma%20Doppler%20%28Factory%20New%29', '🔍 Ver Registro Emerald');

  const lines = [
    `[h1]⚡ NODO DE AUDITORÍA VALVE // CUENTA FUNDACIONAL (${accountCreatedDate})[/h1]`,
    `[table equalcells=1]`,
    `[tr][th]Parámetro de Cuenta[/th][th]Estado Verificado[/th][th]Protocolo Activo[/th][/tr]`,
    `[tr][td][b]Fecha de Creación[/b][/td][td][code]${accountCreatedDate} (23 Años)[/code][/td][td]Insignia Fundacional 2003[/td][/tr]`,
    `[tr][td][b]Enlace Limpio (Exploit #3)[/b][/td][td]${cleanLink}[/td][td]Bypass RFC 3986 (:)[/td][/tr]`,
    `[tr][td][b]Reliquia Ejecutable[/b][/td][td]${uris.installCodenameGordon}[/td][td]URI Nativo steam://[/td][/tr]`,
    `[/table]`,
    ``,
    `[h1]🎯 ARSENAL CS2 EQUIPADO // REGISTRO DE COLECCIONISTA (INVENTARIO PRIVADO)[/h1]`,
    `[table equalcells=1]`,
    `[tr][th]Ítem CS2 Equipado (Factory New)[/th][th]Float IEEE-754 / Patrón[/th][th]Certificación & Vista[/th][/tr]`,
    `[tr][td][b]★ Karambit | Case Hardened[/b][/td][td][code]0.0480829 • Pattern #387 (Blue Gem)[/code][/td][td]${cleanInspectKarambit}[/td][/tr]`,
    `[tr][td][b]Souvenir AWP | Dragon Lore[/b][/td][td][code]0.0009142 • 4x Katowice 2014 (Holo)[/code][/td][td]${cleanInspectDlore}[/td][/tr]`,
    `[tr][td][b]StatTrak™ AK-47 | Case Hardened[/b][/td][td][code]0.0114021 • #661 Scar + 4x Titan Holo[/code][/td][td]${cleanInspectAk}[/td][/tr]`,
    `[tr][td][b]StatTrak™ M4A4 | Howl[/b][/td][td][code]0.0003198 • Contraband + 4x iBP Holo[/code][/td][td]${cleanInspectHowl}[/td][/tr]`,
    `[tr][td][b]★ Butterfly Knife | Gamma Doppler[/b][/td][td][code]0.0001204 • Phase: Emerald (#1 Rank)[/code][/td][td]${cleanInspectBfk}[/td][/tr]`,
    `[/table]`
  ];

  return {
    brailleBlankTitle: BRAILLE_BLANK.repeat(3),
    cleanExternalLink: cleanLink,
    executableUris: uris,
    bbcode: lines.join('\n')
  };
}

async function tryUpdateExistingSteamReview({
  steamId64,
  cookieString,
  targetAppId,
  finalComment,
  sessionId,
  fetchImpl = fetch
} = {}) {
  if (!steamId64 || !sessionId) return { updated: false };
  try {
    const revPageUrl = `https://steamcommunity.com/profiles/${steamId64}/recommended/${targetAppId}/`;
    const pageRes = await safeSteamFetch(
      revPageUrl,
      {
        method: 'GET',
        headers: {
          Cookie: cookieString,
          Referer: `https://steamcommunity.com/profiles/${steamId64}/recommended/`
        }
      },
      fetchImpl
    );
    if (!pageRes || !pageRes.ok || typeof pageRes.text !== 'function') return { updated: false };
    const html = await pageRes.text();
    const m =
      html.match(/UserReview_Update_Text\(\s*['"](\d+)['"]/) ||
      html.match(/ReviewText_(\d+)/) ||
      html.match(/recommendationid['"\s:=]+['"]?(\d{5,22})['"]?/i);
    if (!m || !m[1]) return { updated: false };

    const recommendationId = m[1];
    const updateBody = new URLSearchParams({
      review_text: finalComment,
      voted_up: 'true',
      is_public: 'true',
      language: 'spanish',
      received_compensation: '0',
      disable_comments: '0',
      sessionid: sessionId
    });
    const upRes = await safeSteamFetch(
      `https://steamcommunity.com/userreviews/update/${recommendationId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookieString,
          'Origin': 'https://steamcommunity.com',
          'Referer': revPageUrl,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: updateBody.toString()
      },
      fetchImpl
    );
    const upData = await upRes.json().catch(() => ({}));
    const ok = Boolean(upRes.ok && (upData.success === 1 || upData.success === true));
    return { updated: ok, recommendationId, response: upData };
  } catch {
    return { updated: false };
  }
}

async function publishApp753RelicReviewServerSide({
  steamId64,
  cookieString,
  appId = 10,
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
  const targetAppId = Number(appId) || 10;

  const sessionId = extractSessionIdFromCookies(cookieString);
  if (!sessionId) {
    return {
      success: false,
      appId: targetAppId,
      bbcodeUsed: finalComment,
      message: '⚠️ El nuevo código BBCode con Doble Tabla [table] ya está listo en el cuadro negro de abajo para copiar.'
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
    let ok = Boolean(res.ok && (data.success === 1 || data.success === true));

    if (!ok && steamId64) {
      const updatedExisting = await tryUpdateExistingSteamReview({
        steamId64,
        cookieString,
        targetAppId,
        finalComment,
        sessionId,
        fetchImpl
      });
      if (updatedExisting.updated) {
        ok = true;
      }
    }

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
        ? `✅ ¡Reseña sobre AppID ${targetAppId} publicada/actualizada con éxito con las 2 Tablas [table] (Cuenta 07 Oct 2003 + Arsenal CS2) y Exploit #3 sin ningún link roto! Recargá tu página de reseña en Steam para ver las 2 tablas limpias.`
        : `ℹ️ El nuevo BBCode con las 2 Tablas [table] (sin links rotos) ya está en el cuadro negro de abajo. Si ya habías publicado la reseña en Steam, entrá a tu reseña (steamcommunity.com/id/brunnn/recommended/${targetAppId}/), tocá "Editar reseña" a la derecha, pegá este código nuevo y guardá.`
    };
  } catch {
    return {
      success: false,
      appId: targetAppId,
      privacyResult,
      bbcodeUsed: finalComment,
      message: `ℹ️ El nuevo BBCode con las 2 Tablas [table] (sin links rotos) ya está en el cuadro negro de abajo. Entrá a tu reseña en Steam, tocá "Editar reseña", pegá este código nuevo y guardá.`
    };
  }
}

/**
 * ============================================================================
 * MOTOR 4: INYECTOR BINARIO DE CAPTURAS (`EMsg 5514`) + ETIQUETA A GABE NEWELL
 * ============================================================================
 */
function extractImageDimensionsFromBase64(imagePayload = '') {
  try {
    const clean = String(imagePayload || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (!clean) return null;
    const buf = Buffer.from(clean, 'base64');
    if (buf.length < 24) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height, ext: 'png', byteLength: buf.length, buffer: buf };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let pos = 2;
      while (pos + 9 < buf.length) {
        if (buf[pos] !== 0xff) { pos++; continue; }
        const marker = buf[pos + 1];
        const len = buf.readUInt16BE(pos + 2);
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buf.readUInt16BE(pos + 5);
          const width = buf.readUInt16BE(pos + 7);
          if (width > 0 && height > 0) return { width, height, ext: 'jpg', byteLength: buf.length, buffer: buf };
        }
        if (len < 2) break;
        pos += 2 + len;
      }
      return { width: 1920, height: 1080, ext: 'jpg', byteLength: buf.length, buffer: buf };
    }
  } catch {}
  return null;
}

/**
 * Resuelve la lista de SteamID64 a etiquetar en la captura:
 * - Permite quitar a Gabe Newell por completo (`tagPreset = 'none'`)
 * - Permite elegir a Garry Newman (`76561197960279927`), Gabe Newell (`76561197960287930`), Robin Walker, Chet Faliszek
 * - Permite agregar cualquier SteamID64 o link `steamcommunity.com/profiles/7656119...` escrito por el usuario
 */
function resolveScreenshotTaggedSteamIds({
  tagPreset = 'gabe',
  customTaggedInput = '',
  explicitTaggedSteamIds = null
} = {}) {
  if (Array.isArray(explicitTaggedSteamIds)) {
    return explicitTaggedSteamIds
      .map(s => String(s || '').trim())
      .filter(s => /^7656119\d{10}$/.test(s));
  }

  const set = new Set();
  const preset = String(tagPreset || 'gabe').trim().toLowerCase();

  if (preset === 'none' || preset === 'nobody' || preset === 'sin_etiquetas' || preset === '0') {
    // No agregar a Gabe Newell ni a ningún preset
  } else if (preset === 'garry' || preset === GARRY_NEWMAN_STEAMID64) {
    set.add(GARRY_NEWMAN_STEAMID64);
  } else if (preset === 'gabe_and_garry' || preset === 'both') {
    set.add(GABE_NEWELL_STEAMID64);
    set.add(GARRY_NEWMAN_STEAMID64);
  } else if (preset === 'robin' || preset === ROBIN_WALKER_STEAMID64) {
    set.add(ROBIN_WALKER_STEAMID64);
  } else if (preset === 'chet' || preset === CHET_FALISZEK_STEAMID64) {
    set.add(CHET_FALISZEK_STEAMID64);
  } else if (preset === 'custom') {
    // Solo usar lo que el usuario escriba en customTaggedInput
  } else if (preset === 'gabe' || preset === GABE_NEWELL_STEAMID64) {
    set.add(GABE_NEWELL_STEAMID64);
  } else {
    // Si pasaron varios IDs separados por coma en el preset
    for (const part of preset.split(/[\s,;]+/)) {
      if (/^7656119\d{10}$/.test(part)) set.add(part);
    }
  }

  // Extraer cualquier SteamID64 de 17 dígitos escrito en el campo personalizado (acepta IDs directos o URLs /profiles/7656119...)
  const rawCustom = String(customTaggedInput || '');
  const matches = rawCustom.match(/7656119\d{10}/g);
  if (matches) {
    for (const m of matches) set.add(m);
  }
  if (/garry/i.test(rawCustom)) set.add(GARRY_NEWMAN_STEAMID64);
  if (/gabe|newell/i.test(rawCustom)) set.add(GABE_NEWELL_STEAMID64);
  if (/robin|walker/i.test(rawCustom)) set.add(ROBIN_WALKER_STEAMID64);

  return [...set];
}

function formatSteamScreenshotFilenameFromTimestamp(timestampSec = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP) {
  const d = new Date((Number(timestampSec) || STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP) * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}_1.jpg`;
}

function buildScreenshotsVdfEntry({
  appId = 753,
  timestamp = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  width = 1920,
  height = 1080,
  caption = '',
  taggedSteamIds = []
} = {}) {
  const jpgName = formatSteamScreenshotFilenameFromTimestamp(timestamp);
  const tagLines = (Array.isArray(taggedSteamIds) ? taggedSteamIds : [])
    .map((sid, idx) => `\t\t\t\t"${idx}"\t\t"${sid}"`)
    .join('\n');
  const taggedBlock = tagLines
    ? `\n\t\t\t"taggedusers"\n\t\t\t{\n${tagLines}\n\t\t\t}`
    : '';
  return `"${appId}"
{
\t"0"
\t{
\t\t"type"\t\t"1"
\t\t"filename"\t\t"${appId}/screenshots/${jpgName}"
\t\t"thumbnail"\t\t"${appId}/screenshots/thumbnails/${jpgName}"
\t\t"vrfilename"\t\t""
\t\t"imported"\t\t"1"
\t\t"width"\t\t"${width}"
\t\t"height"\t\t"${height}"
\t\t"gameid"\t\t"${appId}"
\t\t"creation"\t\t"${timestamp}"
\t\t"caption"\t\t"${String(caption || '').replace(/"/g, "'")}"
\t\t"Permissions"\t\t"2"${taggedBlock}
\t}
}`;
}


function buildWindowsScreenshotAutoInstallerBat({
  appId = 4000,
  timestamp = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  officialJpgName = '20110201000000_1.jpg',
  width = 1920,
  height = 1080,
  caption = '',
  taggedSteamIds = []
} = {}) {
  const safeCaption = String(caption || "").replace(/"/g, "'").replace(/\s+/g, " ").trim();
  const vdfBlock = buildScreenshotsVdfEntry({ appId, timestamp, width, height, caption: safeCaption, taggedSteamIds });
  const vdfBase64 = Buffer.from("\t" + vdfBlock.replace(/\n/g, "\r\n\t") + "\r\n", "utf8").toString("base64");
  const psLines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Write-Host '==========================================================' -ForegroundColor Cyan",
    "Write-Host '  AUTO-INSTALADOR DE CAPTURA HISTORICA STEAMFARMER (2003) ' -ForegroundColor Cyan",
    "Write-Host '==========================================================' -ForegroundColor Cyan",
    `$jpgName = "${officialJpgName}"`,
    `$appId = "${appId}"`,
    `$timestamp = ${Number(timestamp) || 1296518400}`,
    "$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$sourceJpg = Join-Path $scriptDir $jpgName",
    "if (-not (Test-Path $sourceJpg)) {",
    "  $altJpg = Get-ChildItem -Path $scriptDir -Filter '*.jpg' | Sort-Object LastWriteTime -Descending | Select-Object -First 1",
    "  if ($altJpg) { $sourceJpg = $altJpg.FullName }",
    "}",
    "if (-not (Test-Path $sourceJpg)) {",
    "  Write-Host '[!] No se encontro la foto JPG en tu carpeta de Descargas.' -ForegroundColor Red",
    "  Pause; exit",
    "}",
    "$steamPath = (Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -Name 'SteamPath').SteamPath",
    "if (-not $steamPath) { $steamPath = 'C:\\Program Files (x86)\\Steam' }",
    "$steamPath = $steamPath -replace '/', '\\'",
    "Write-Host '[1/3] Cerrando Steam un segundo para grabar la fecha historica...' -ForegroundColor Yellow",
    "Stop-Process -Name 'steam' -Force -ErrorAction SilentlyContinue",
    "Start-Sleep -Seconds 2",
    "$userdataDir = Join-Path $steamPath 'userdata'",
    "$userFolders = Get-ChildItem -Path $userdataDir -Directory",
    "$epoch = [DateTimeOffset]::FromUnixTimeSeconds($timestamp).LocalDateTime",
    `$entryBlock = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${vdfBase64}"))`,
    "foreach ($u in $userFolders) {",
    "  $dir760 = Join-Path $u.FullName '760'",
    "  $remoteAppDir = Join-Path $dir760 \"remote\\$appId\\screenshots\"",
    "  $thumbDir = Join-Path $remoteAppDir 'thumbnails'",
    "  New-Item -ItemType Directory -Force -Path $remoteAppDir | Out-Null",
    "  New-Item -ItemType Directory -Force -Path $thumbDir | Out-Null",
    "  $destMain = Join-Path $remoteAppDir $jpgName",
    "  $destThumb = Join-Path $thumbDir $jpgName",
    "  Copy-Item -Path $sourceJpg -Destination $destMain -Force",
    "  Copy-Item -Path $sourceJpg -Destination $destThumb -Force",
    "  (Get-Item $destMain).LastWriteTime = $epoch; (Get-Item $destMain).CreationTime = $epoch",
    "  (Get-Item $destThumb).LastWriteTime = $epoch; (Get-Item $destThumb).CreationTime = $epoch",
    "  $vdfPath = Join-Path $dir760 'screenshots.vdf'",
    "  if (Test-Path $vdfPath) {",
    "    Copy-Item -Path $vdfPath -Destination \"$vdfPath.bak\" -Force",
    "    $vdfContent = Get-Content -Path $vdfPath -Raw -Encoding UTF8",
    "    if ($vdfContent -match '\"shortcutnames\"') {",
    "      $vdfContent = $vdfContent -replace '\"shortcutnames\"', ($entryBlock + \"`t`\"shortcutnames`\"\")",
    "      Set-Content -Path $vdfPath -Value $vdfContent -Encoding UTF8",
    "    }",
    "  } else {",
    "    $newVdf = \"`\"Screenshots`\"`r`n{`r`n\" + $entryBlock + \"`t`\"shortcutnames`\"`r`n`t{`r`n`t}`r`n}`r`n\"",
    "    Set-Content -Path $vdfPath -Value $newVdf -Encoding UTF8",
    "  }",
    "  Write-Host \"[2/3] Captura instalada en cuenta $($u.Name) con fecha $epoch (AppID $appId).\" -ForegroundColor Green",
    "}",
    "Write-Host '[3/3] Abriendo la ventana de Capturas de Steam...' -ForegroundColor Cyan",
    "Start-Process 'steam://open/screenshots'",
    "Write-Host '¡LISTO! En la ventana de Steam que se abrio, toca tu foto y dale a SUBIR (Compartir).' -ForegroundColor Green",
    "Pause"
  ].join("\r\n");
  const encodedPs = Buffer.from(psLines, "utf16le").toString("base64");
  return "@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encodedPs + "\r\n";
}

function resolveHistoricalScreenshotTimestamp(datePreset = 'screenshots_beta_feb1_2011', customTimestamp = null) {
  if (customTimestamp !== null && customTimestamp !== undefined && String(customTimestamp).trim() !== '') {
    const raw = String(customTimestamp).trim();
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        const isoDate = new Date((numeric >>> 0) * 1000).toISOString().slice(0, 10);
        return { timestamp: numeric >>> 0, label: `Fecha personalizada (${isoDate})` };
      }
    }
    const parsedMs = Date.parse(raw.length === 10 ? `${raw}T12:00:00Z` : raw);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      const ts = Math.floor(parsedMs / 1000) >>> 0;
      const isoDate = new Date(ts * 1000).toISOString().slice(0, 10);
      return { timestamp: ts, label: `Fecha elegida por vos (${isoDate})` };
    }
  }
  if (datePreset === 'screenshots_beta_feb1_2011') {
    return {
      timestamp: STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
      label: '01 de Febrero de 2011 (Día 1 Beta de Capturas en Steam)'
    };
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
  if (datePreset === 'screenshots_day1_2011') {
    return {
      timestamp: STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
      label: '24 de Febrero de 2011 (Lanzamiento oficial Capturas v1.0)'
    };
  }
  return {
    timestamp: STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
    label: '01 de Febrero de 2011 (Día 1 Beta de Capturas en Steam)'
  };
}

function encodeUfsUploadFileRequestWire({
  appId = 760,
  fileSize = 1024,
  rawFileSize = 1024,
  shaFileBuffer = Buffer.alloc(20, 0x03),
  timestampSec = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  fileName = '753/screenshots/20110201120000_1.jpg'
} = {}) {
  return Buffer.concat([
    encodeFieldVarint(1, Number(appId) >>> 0),
    encodeFieldVarint(2, Number(fileSize) >>> 0),
    encodeFieldVarint(3, Number(rawFileSize) >>> 0),
    encodeFieldBytes(4, Buffer.isBuffer(shaFileBuffer) ? shaFileBuffer : Buffer.alloc(20, 0x03)),
    encodeFieldFixed64(5, BigInt(Number(timestampSec) >>> 0)),
    encodeFieldBytes(6, String(fileName)),
    encodeFieldVarint(7, 0xffffffff),
    encodeFieldVarint(9, 1)
  ]);
}

function encodeUcmAddScreenshotWire({
  appId = 753,
  filename = '753/screenshots/20110201120000_1.jpg',
  thumbname = '753/screenshots/thumbnails/20110201120000_1.jpg',
  rtime32Created = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
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
    throw new Error('Tu cuenta de Steam no está conectada en este momento. Verificá que el estado arriba diga "Connected" antes de enviar la captura.');
  }

  const appId = Number(options.appId) || 753;
  const { timestamp, label } = resolveHistoricalScreenshotTimestamp(
    options.datePreset || 'screenshots_beta_feb1_2011',
    options.customTimestamp
  );

  // Resolver a quién etiquetar (permite quitar a Gabe Newell con tagPreset='none' o agregar a Garry Newman / cualquier SteamID64)
  const taggedSteamIds = resolveScreenshotTaggedSteamIds({
    tagPreset: options.tagPreset,
    customTaggedInput: options.customTaggedInput,
    explicitTaggedSteamIds: Array.isArray(options.taggedSteamIds) ? options.taggedSteamIds : null
  });

  const caption = String(
    options.caption !== undefined && options.caption !== null && String(options.caption).trim() !== ''
      ? options.caption
      : ''
  ).trim();

  const imgMeta = extractImageDimensionsFromBase64(options.imagePayload);
  const officialJpgName = formatSteamScreenshotFilenameFromTimestamp(timestamp);

  const width = Number(options.width) || imgMeta?.width || 1920;
  const height = Number(options.height) || imgMeta?.height || 1080;
  const filename = String(options.filename || `${appId}/screenshots/${officialJpgName}`).trim();
  const thumbname = String(options.thumbname || `${appId}/screenshots/thumbnails/${officialJpgName}`).trim();

  // Paso 1: Si el usuario subió su imagen, registrar el slot en Steam Cloud (AppID 760 — UFS EMsg 5202) antes del EMsg 5514
  let cloudRegistered = false;
  if (imgMeta?.buffer) {
    try {
      const cryptoMod = require('node:crypto');
      const sha1 = cryptoMod.createHash('sha1').update(imgMeta.buffer).digest();
      const ufsWire = encodeUfsUploadFileRequestWire({
        appId: 760,
        fileSize: imgMeta.byteLength,
        rawFileSize: imgMeta.byteLength,
        shaFileBuffer: sha1,
        timestampSec: timestamp,
        fileName: filename
      });
      client._send({ msg: 5202, proto: {} }, ufsWire);
      cloudRegistered = true;
    } catch {}
  }

  // Paso 2: Enviar CMsgClientUCMAddScreenshot (EMsg 5514) con el AppID elegido, la fecha elegida y las etiquetas elegidas
  const wireBuffer = encodeUcmAddScreenshotWire({
    appId,
    filename,
    thumbname,
    rtime32Created: timestamp,
    width,
    height,
    permissions: 2,
    caption,
    taggedSteamIds
  });

  const emsgCode = EMsg.ClientUCMAddScreenshot || 5514;
  client._send({ msg: emsgCode, proto: {} }, wireBuffer);

  const autoInstallerBat = buildWindowsScreenshotAutoInstallerBat({ appId, timestamp, officialJpgName, width, height, caption, taggedSteamIds });
  const vdfEntry = buildScreenshotsVdfEntry({
    appId,
    timestamp,
    width,
    height,
    caption,
    taggedSteamIds
  });

  const tagSummary = taggedSteamIds.length === 0
    ? 'Sin etiquetar a nadie'
    : taggedSteamIds.map(id => {
        if (id === GABE_NEWELL_STEAMID64) return 'Gabe Newell (76561197960287930)';
        if (id === GARRY_NEWMAN_STEAMID64) return 'Garry Newman (76561197960279927)';
        if (id === ROBIN_WALKER_STEAMID64) return 'Robin Walker (76561197960435530)';
        if (id === CHET_FALISZEK_STEAMID64) return 'Chet Faliszek (76561197960279929)';
        return id;
      }).join(', ');

  return {
    success: true,
    emsg: emsgCode,
    cloudRegistered,
    appId,
    officialJpgName,
    width,
    height,
    rtime32Created: timestamp,
    dateLabel: label,
    taggedSteamIds,
    tagSummary,
    caption,
    vdfEntry,
    autoInstallerBat,
    wireBytesLength: wireBuffer.length,
    wireHexPreview: wireBuffer.subarray(0, 32).toString('hex'),
    message: `✅ Captura registrada (AppID ${appId} • ${width}x${height} px • Fecha: "${label}" • Etiquetas: ${tagSummary}). Archivo JPG oficial: ${officialJpgName}.`
  };
}

module.exports = {
  BRAILLE_BLANK,
  GABE_NEWELL_STEAMID64,
  GARRY_NEWMAN_STEAMID64,
  ROBIN_WALKER_STEAMID64,
  CHET_FALISZEK_STEAMID64,
  FAMOUS_STEAM_PROFILES_TO_TAG,
  resolveScreenshotTaggedSteamIds,
  formatSteamScreenshotFilenameFromTimestamp,
  buildScreenshotsVdfEntry,
  buildWindowsScreenshotAutoInstallerBat,
  BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP,
  STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
  RELIC_OFFICIAL_NAMES,
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
  // Motor 3A & 3B: Vitrinas Server-Side (1ra y 2da Colección / Favorito) + Generador Visual 3D CS2 + Reseña
  extractSessionIdFromCookies,
  buildCleanExternalLink,
  buildExecutableSteamUriLinks,
  discoverShowcasePurchaseIds,
  setProfileShowcaseSlotServerSide,
  fillCollectorShowcaseWithRelics,
  generateVisualCs2ShowcaseData,
  lockInventoryPrivacyOnly,
  buildApp753RelicReviewBbcode,
  publishApp753RelicReviewServerSide,
  // Motor 4: Capturas UCM EMsg 5514 + Etiqueta Gabe Newell
  resolveHistoricalScreenshotTimestamp,
  encodeUcmAddScreenshotWire,
  injectUcmScreenshotServerSide
};
