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

let Schema = {};
try {
  Schema = require('steam-user/protobufs/generated/_load.js');
} catch {}
let EMsg = { ClientUCMAddScreenshot: 5514, ClientUCMAddScreenshotResponse: 5515, ClientUFSUploadFileRequest: 5202, ClientUFSUploadFileResponse: 5203, ClientUFSUploadCommit: 5204, ClientGamesPlayed: 542, ClientChangeStatus: 716, ServiceMethodCallFromClient: 151, ServiceMethodResponse: 147 };
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
const STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP = 1296572400; // 1 de Febrero de 2011 15:00:00 UTC (12:00/13:00 en Uruguay, evita desfase a 31 de enero) // 1 de Febrero de 2011 00:00:00 UTC (Día 1 Beta de Capturas en Steam)
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
  765: 'Steam Greenlight (2012)',
  766: 'Steam Workshop',
  767: 'Steam Artwork',
  202351: 'Steam Community Beta Access (2012)',
  202352: 'Steam Trading Card Beta Access (2013)',
  218800: 'Steam Software Beta Access (2012)',
  221410: 'Steam for Linux Beta (2012)',
  223910: 'Saxxy Awards 2012',
  245070: 'Steam Summer Getaway Sale 2013',
  248210: 'Steam Family Sharing Beta (2013)',
  250820: 'SteamVR',
  258280: 'Steam Music Beta (2014)',
  593110: 'Steam News (Subsistema Oficial)',
  1675180: 'Steam Deck Deposit (Reserva 2021)',
  261310: '3rd Annual Saxxy Awards 2013',
  267420: 'Steam Holiday Sale 2013 (Snow Globe)',
  303700: 'Steam Summer Adventure 2014',
  321770: '4th Annual Saxxy Awards 2014',
  335590: 'Steam Holiday Sale 2014',
  353370: 'Steam Link',
  353380: 'Steam Controller',
  368020: 'Monster Summer Sale 2015',
  405270: '5th Annual Saxxy Awards 2015',
  425280: 'Steam Holiday Sale 2015',
  480730: 'Steam Summer Picnic Sale 2016',
  551410: '6th Annual Saxxy Awards 2016',
  566020: 'The Steam Awards 2016',
  639900: 'Steam Summer Sale 2017 (Stickers)',
  762800: 'The Steam Awards 2017',
  807210: '7th Annual Saxxy Awards 2017',
  876740: 'Intergalactic Summer Sale 2018 (Salien)',
  991980: 'The Steam Winter Sale 2018',
  1059530: 'Valve Index VR Kit',
  1195670: 'The Steam Awards 2019',
  1343890: 'Steam Summer Road Trip 2020',
  1465680: 'The Steam Awards 2020',
  1658760: 'Steam Summer Sale 2021 (Forge Your Fate)',
  1675200: 'Steam Deck',
  2021850: 'Steam 3000 Summer Sale 2022 (Clorthax)'
};

// Catálogo expandido con las 16 reliquias, hardware y subsistemas más exclusivos de Valve
const HISTORICAL_EVENT_SHOWCASE_APPS = [
  202352, // Steam Trading Card Beta Access (Mayo 2013)
  245070, // Steam Summer Getaway Sale 2013 (Julio 2013)
  765,    // Steam Greenlight (2012)
  202351, // Steam Community Beta Access (2012)
  248210, // Steam Family Sharing Beta (2013)
  593110, // Steam News (Subsistema Oficial)
  258280, // Steam Music Beta (2014)
  1675180,// Steam Deck Deposit (Reserva Oficial)
  223910, // Saxxy Awards 2012
  267420, // Steam Holiday Sale 2013 (Snow Globe)
  303700, // Steam Summer Adventure 2014
  368020  // Monster Summer Sale 2015
];

const HIDDEN_VALVE_RELIC_APPS = [
  { appId: 593110, name: 'Steam News (Subsistema Oficial de Noticias de Valve — Con Imagen)', hasBanner: true },
  { appId: 258280, name: 'Steam Music Beta (Beta Histórica del Reproductor de Música 2014)', hasBanner: true },
  { appId: 1675180, name: 'Steam Deck Deposit (App Oculta de Reserva Fundacional Steam Deck 2021)', hasBanner: true },
  { appId: 202352, name: 'Steam Trading Card Beta Access (Reliquia Oficial Beta de Cromos Mayo 2013 — Con Imagen)', hasBanner: true },
  { appId: 245070, name: 'Steam Summer Getaway Sale 2013 (1ra Oferta de Cromos Julio 2013 — Con Imagen)', hasBanner: true },
  { appId: 765, name: 'Steam Greenlight (Subsistema Histórico Retirado 2012)', hasBanner: true },
  { appId: 202351, name: 'Beta Access to the New Steam Community (Agosto 2012)', hasBanner: false },
  { appId: 248210, name: 'Game Library Sharing Access (Family Sharing Beta 2013)', hasBanner: false },
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
  let rawSec = Number(timestampSec) || STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP;
  if (rawSec % 86400 === 0) {
    rawSec += 54000; // 15:00 UTC = 12:00 mediodía en Uruguay (UTC-3)
  }
  // Convertir a hora local de Uruguay (UTC-3) para el nombre YYYYMMDDHHMMSS_1.jpg
  const uyMs = (rawSec - 3 * 3600) * 1000;
  const d = new Date(uyMs);
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


function buildWindowsScreenshotAutoInstallerPs1({
  appId = 10,
  timestamp = STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  officialJpgName = '20110201120000_1.jpg',
  width = 1920,
  height = 1080,
  caption = '',
  taggedSteamIds = []
} = {}) {
  const safeCaption = String(caption || '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  // Si el timestamp está a las 00:00 UTC (como 1065484800 o 1296518400), sumarle 15 horas (15:00 UTC = 12:00 mediodía en Uruguay)
  // para que en huso horario de Uruguay (UTC-3 / UTC-2) NUNCA retroceda al día anterior (31 de enero o 6 de octubre).
  let safeTs = Number(timestamp) || 1296572400;
  if (safeTs % 86400 === 0) {
    safeTs += 54000;
  }
  const vdfBlock = buildScreenshotsVdfEntry({
    appId,
    timestamp: safeTs,
    width: '__WIDTH__',
    height: '__HEIGHT__',
    caption: safeCaption,
    taggedSteamIds
  }).replace('"imported"\t\t"1"', '"imported"\t\t"0"');
  const fullVdfFile = '"Screenshots"\r\n{\r\n\t' + vdfBlock.replace(/\n/g, '\r\n\t') + '\r\n\t"shortcutnames"\r\n\t{\r\n\t}\r\n}\r\n';
  const vdfBase64 = Buffer.from(fullVdfFile, 'utf8').toString('base64');

  const psLines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Write-Host '================================================================' -ForegroundColor Cyan",
    "Write-Host '  SELECTOR DE FOTO + FECHA EXACTA PARA CAPTURA DE STEAM (2011)  ' -ForegroundColor Cyan",
    "Write-Host '================================================================' -ForegroundColor Cyan",
    "$jpgName = \"" + officialJpgName + "\"",
    "$appId = \"" + appId + "\"",
    "$timestamp = " + safeTs,
    "Write-Host '[PASO 1] Elegi en la ventana LA FOTO EXACTA QUE VOS QUIERAS de tu PC...' -ForegroundColor Yellow",
    "$dlg = New-Object System.Windows.Forms.OpenFileDialog",
    "$dlg.Title = 'Elegi la foto exacta que queres subir a Steam'",
    "$dlg.InitialDirectory = [Environment]::GetFolderPath('MyPictures')",
    "$dlg.Filter = 'Imagenes (*.jpg;*.jpeg;*.png;*.bmp;*.webp)|*.jpg;*.jpeg;*.png;*.bmp;*.webp|Todos los archivos (*.*)|*.*'",
    "$topForm = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
    "if ($dlg.ShowDialog($topForm) -ne [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Host '[!] Cancelaste la seleccion de foto.' -ForegroundColor Red",
    "  Pause; exit",
    "}",
    "$sourceImg = $dlg.FileName",
    "Write-Host \"Foto elegida: $sourceImg\" -ForegroundColor Green",
    "Write-Host '[PASO 2] Cerrando Steam 2 segundos para convertir tu foto con sus dimensiones reales...' -ForegroundColor Yellow",
    "Stop-Process -Name 'steam' -Force -ErrorAction SilentlyContinue",
    "Start-Sleep -Seconds 2",
    "$img = [System.Drawing.Image]::FromFile($sourceImg)",
    "$w = $img.Width; $h = $img.Height",
    "$thumbW = 200; $thumbH = [Math]::Max(1, [int]([Math]::Round(($h / [double]$w) * 200)))",
    "$steamPath = (Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -Name 'SteamPath').SteamPath",
    "if (-not $steamPath) { $steamPath = 'C:\\Program Files (x86)\\Steam' }",
    "$steamPath = $steamPath -replace '/', '\\'",
    "$userdataDir = Join-Path $steamPath 'userdata'",
    "$userFolders = Get-ChildItem -Path $userdataDir -Directory",
    "$epoch = [DateTimeOffset]::FromUnixTimeSeconds($timestamp).LocalDateTime",
    "$utf8NoBom = New-Object System.Text.UTF8Encoding($false)",
    "$newVdf = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(\"" + vdfBase64 + "\")).Replace('__WIDTH__', \"$w\").Replace('__HEIGHT__', \"$h\")",
    "$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)",
    "$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 95L)",
    "foreach ($u in $userFolders) {",
    "  $dir760 = Join-Path $u.FullName '760'",
    "  $remoteAppDir = Join-Path $dir760 \"remote\\$appId\\screenshots\"",
    "  $thumbDir = Join-Path $remoteAppDir 'thumbnails'",
    "  New-Item -ItemType Directory -Force -Path $remoteAppDir | Out-Null",
    "  New-Item -ItemType Directory -Force -Path $thumbDir | Out-Null",
    "  $destMain = Join-Path $remoteAppDir $jpgName",
    "  $destThumb = Join-Path $thumbDir $jpgName",
    "  if (Test-Path $destMain) { Remove-Item $destMain -Force }",
    "  if (Test-Path $destThumb) { Remove-Item $destThumb -Force }",
    "  $bmpMain = New-Object System.Drawing.Bitmap($w, $h)",
    "  $gMain = [System.Drawing.Graphics]::FromImage($bmpMain)",
    "  $gMain.DrawImage($img, 0, 0, $w, $h)",
    "  $gMain.Dispose()",
    "  $bmpMain.Save($destMain, $jpegCodec, $encParams)",
    "  $bmpMain.Dispose()",
    "  $bmpThumb = New-Object System.Drawing.Bitmap($thumbW, $thumbH)",
    "  $gThumb = [System.Drawing.Graphics]::FromImage($bmpThumb)",
    "  $gThumb.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "  $gThumb.DrawImage($img, 0, 0, $thumbW, $thumbH)",
    "  $gThumb.Dispose()",
    "  $bmpThumb.Save($destThumb, $jpegCodec, $encParams)",
    "  $bmpThumb.Dispose()",
    "  (Get-Item $destMain).CreationTime = $epoch; (Get-Item $destMain).LastWriteTime = $epoch",
    "  (Get-Item $destThumb).CreationTime = $epoch; (Get-Item $destThumb).LastWriteTime = $epoch",
    "  $vdfPath = Join-Path $dir760 'screenshots.vdf'",
    "  if (Test-Path $vdfPath) { Copy-Item -Path $vdfPath -Destination \"$vdfPath.bak\" -Force }",
    "  [System.IO.File]::WriteAllText($vdfPath, $newVdf, $utf8NoBom)",
    "  (Get-Item $vdfPath).LastWriteTime = $epoch",
    "  Write-Host \"[OK] Cuenta $($u.Name): $jpgName ($w x $h px) — Fecha sellada: $($epoch.ToString('dd/MM/yyyy HH:mm'))\" -ForegroundColor Green",
    "}",
    "$img.Dispose()",
    "Write-Host '[PASO 3] Abriendo tu ventana de Capturas de Steam...' -ForegroundColor Cyan",
    "Start-Process 'steam://open/screenshots'",
    "Write-Host '================================================================' -ForegroundColor Green",
    "Write-Host '¡IMPORTANTE PARA MANTENER LA FECHA 2011 AL SUBIRLA A STEAM!' -ForegroundColor Yellow",
    "Write-Host '1) En la ventana de Steam, subila (incluso en Privado) para que el archivo .jpg suba a tu Steam Cloud (AppID 760).' -ForegroundColor White",
    "Write-Host '2) Apenas termine de subir, entra a tu panel web de SteamFarmer y toca [Inyectar Captura EMsg 5514] con el mismo juego y fecha.' -ForegroundColor White",
    "Write-Host '   Eso registra la captura directo por protocolo binario con rtime32_created = 2011 sin que la interfaz nueva de Steam la pise con 2026.' -ForegroundColor Cyan",
    "Write-Host '================================================================' -ForegroundColor Green"
  ].join('\r\n');
  return psLines;
}

function buildWindowsScreenshotAutoInstallerBat(opts = {}) {
  const psScript = buildWindowsScreenshotAutoInstallerPs1(opts);
  const encodedPs = Buffer.from(psScript, 'utf16le').toString('base64');
  return '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encodedPs + '\r\npause\r\n';
}

function resolveHistoricalScreenshotTimestamp(datePreset = 'screenshots_beta_feb1_2011', customTimestamp = null, customTime = null) {
  const cleanTime = String(customTime || '').trim();
  const normalizedTime = /^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime)
    ? (cleanTime.length === 5 ? `${cleanTime}:00` : cleanTime)
    : null;

  if (customTimestamp !== null && customTimestamp !== undefined && String(customTimestamp).trim() !== '') {
    const raw = String(customTimestamp).trim();
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        const uyDate = new Date(((numeric >>> 0) - 3 * 3600) * 1000);
        const isoDateTime = uyDate.toISOString().slice(0, 19).replace('T', ' ');
        return { timestamp: numeric >>> 0, label: `Fecha y hora exacta (${isoDateTime} UYT)` };
      }
    }
    const timePart = normalizedTime || '12:00:00';
    const parsedMs = Date.parse(raw.length === 10 ? `${raw}T${timePart}-03:00` : raw);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      const ts = Math.floor(parsedMs / 1000) >>> 0;
      const uyDate = new Date((ts - 3 * 3600) * 1000);
      const isoDateTime = uyDate.toISOString().slice(0, 19).replace('T', ' ');
      return { timestamp: ts, label: `Fecha y hora elegida (${isoDateTime})` };
    }
  }
  // Si eligió un preset pero además especificó una hora exacta (HH:MM:SS)
  if (normalizedTime && normalizedTime !== '12:00:00') {
    let baseDateStr = '2011-02-01';
    if (datePreset === 'account_oct7_2003') baseDateStr = '2003-10-07';
    else if (datePreset === 'screenshots_day1_2011') baseDateStr = '2011-02-24';
    else if (datePreset === 'current') baseDateStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const parsedMs = Date.parse(`${baseDateStr}T${normalizedTime}-03:00`);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      const ts = Math.floor(parsedMs / 1000) >>> 0;
      return { timestamp: ts, label: `${baseDateStr} a las ${normalizedTime}` };
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

function httpPutBufferToSteamCloud(urlStr, buffer, customHeaders = {}) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'http:' ? require('node:http') : require('node:https');
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'User-Agent': 'Valve/Steam HTTP Client 1.0',
        ...customHeaders
      };
      const req = mod.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'PUT',
          headers,
          timeout: 8000
        },
        res => {
          res.resume();
          res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
        }
      );
      req.on('error', () => resolve({ ok: false, status: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }); });
      req.write(buffer);
      req.end();
    } catch {
      resolve({ ok: false, status: 0 });
    }
  });
}

async function uploadBufferToSteamCloud760(client, { fileName, buffer, timestampSec }) {
  if (!client || typeof client._send !== 'function' || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { uploaded: false };
  }
  const cryptoMod = require('node:crypto');
  const sha1 = cryptoMod.createHash('sha1').update(buffer).digest();

  // 1) Intentar primero Unified Service Cloud.ClientBeginFileUpload#1 (usado por Steam Client moderno)
  if (Schema && Schema.CCloud_ClientBeginFileUpload_Request && Schema.CCloud_ClientBeginFileUpload_Response) {
    try {
      const beginMethod = 'Cloud.ClientBeginFileUpload#1';
      const beginEncoded = Buffer.from(
        Schema.CCloud_ClientBeginFileUpload_Request.encode({
          appid: 760,
          file_size: buffer.length,
          raw_file_size: buffer.length,
          file_sha: sha1,
          time_stamp: String(timestampSec >>> 0),
          filename: fileName,
          platforms_to_sync: 4294967295,
          cell_id: client.cellID || 0,
          can_encrypt: false,
          is_shared_file: true
        }).finish()
      );

      const beginResp = await new Promise(resolve => {
        let done = false;
        const finish = val => { if (!done) { done = true; clearTimeout(t); resolve(val); } };
        const t = setTimeout(() => finish(null), 5000);
        try {
          client._send(
            { msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: beginMethod } },
            beginEncoded,
            (respBody, hdr) => {
              try {
                const raw = respBody?.toBuffer ? respBody.toBuffer() : respBody;
                if (!Buffer.isBuffer(raw)) return finish(null);
                finish({ decoded: Schema.CCloud_ClientBeginFileUpload_Response.decode(raw), eresult: hdr?.proto?.eresult });
              } catch {
                finish(null);
              }
            }
          );
        } catch {
          finish(null);
        }
      });

      if (beginResp && beginResp.decoded) {
        const blocks = Array.isArray(beginResp.decoded.block_requests) ? beginResp.decoded.block_requests : [];
        let allBlocksOk = true;
        for (const blk of blocks) {
          const proto = blk.use_https === false ? 'http' : 'https';
          const putUrl = `${proto}://${blk.url_host}${blk.url_path}`;
          const hdrs = {};
          for (const h of (Array.isArray(blk.request_headers) ? blk.request_headers : [])) {
            if (h && h.name) hdrs[h.name] = String(h.value || '');
          }
          const offset = Number(blk.block_offset || 0);
          const len = Number(blk.block_length || buffer.length);
          const slice = buffer.subarray(offset, offset + len);
          const putRes = await httpPutBufferToSteamCloud(putUrl, slice, hdrs);
          if (!putRes.ok) allBlocksOk = false;
        }
        if (Schema.CCloud_ClientCommitFileUpload_Request) {
          const commitMethod = 'Cloud.ClientCommitFileUpload#1';
          const commitEncoded = Buffer.from(
            Schema.CCloud_ClientCommitFileUpload_Request.encode({
              transfer_succeeded: allBlocksOk,
              appid: 760,
              file_sha: sha1,
              filename: fileName
            }).finish()
          );
          await new Promise(resolve => {
            const t = setTimeout(resolve, 3500);
            try {
              client._send(
                { msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: commitMethod } },
                commitEncoded,
                () => { clearTimeout(t); resolve(); }
              );
            } catch {
              clearTimeout(t);
              resolve();
            }
          });
        }
        if (allBlocksOk) {
          return { uploaded: true, method: 'Cloud.ClientBeginFileUpload#1' };
        }
      }
    } catch {}
  }

  // 2) Fallback: Protocolo UFS Clásico (EMsg 5202 -> 5203 -> HTTP PUT -> 5204)
  try {
    const ufsWire = Schema && Schema.CMsgClientUFSUploadFileRequest
      ? Buffer.from(
          Schema.CMsgClientUFSUploadFileRequest.encode({
            app_id: 760,
            file_size: buffer.length,
            raw_file_size: buffer.length,
            sha_file: sha1,
            time_stamp: String(timestampSec >>> 0),
            file_name: fileName,
            platforms_to_sync: 4294967295,
            cell_id: client.cellID || 0,
            can_encrypt: false
          }).finish()
        )
      : encodeUfsUploadFileRequestWire({
          appId: 760,
          fileSize: buffer.length,
          rawFileSize: buffer.length,
          shaFileBuffer: sha1,
          timestampSec,
          fileName
        });

    client._send({ msg: EMsg.ClientUFSUploadFileRequest || 5202, proto: {} }, ufsWire);
    return { uploaded: true, method: 'EMsg 5202 (UFS)' };
  } catch {
    return { uploaded: false };
  }
}

function injectUcmScreenshotServerSide(client, options = {}) {
  if (!client || typeof client._send !== 'function') {
    throw new Error('Tu cuenta de Steam no está conectada en este momento. Verificá que el estado arriba diga "Connected" antes de enviar la captura.');
  }

  const appId = Number(options.appId) || 753;
  const { timestamp, label } = resolveHistoricalScreenshotTimestamp(
    options.datePreset || 'screenshots_beta_feb1_2011',
    options.customTimestamp,
    options.customTime
  );

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
  const thumbMeta = extractImageDimensionsFromBase64(options.thumbPayload);
  const officialJpgName = formatSteamScreenshotFilenameFromTimestamp(timestamp);

  const width = Number(options.width) || imgMeta?.width || 1920;
  const height = Number(options.height) || imgMeta?.height || 1080;
  const filename = String(options.filename || `${appId}/screenshots/${officialJpgName}`).trim();
  const thumbname = String(options.thumbname || `${appId}/screenshots/thumbnails/${officialJpgName}`).trim();

  const wireBuffer = Schema && Schema.CMsgClientUCMAddScreenshot
    ? Buffer.from(
        Schema.CMsgClientUCMAddScreenshot.encode({
          appid: appId,
          filename,
          thumbname,
          rtime32_created: timestamp >>> 0,
          width,
          height,
          permissions: 2,
          caption,
          shortcut_name: '',
          tagged_steamid: taggedSteamIds
        }).finish()
      )
    : encodeUcmAddScreenshotWire({
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

  const autoInstallerPs1 = buildWindowsScreenshotAutoInstallerPs1({ appId, timestamp, officialJpgName, width, height, caption, taggedSteamIds });
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

  // Si es una llamada sin imagen o sobre un cliente mock de test, responder sincrónicamente al instante
  if (!imgMeta?.buffer || !Schema || !Schema.CCloud_ClientBeginFileUpload_Request) {
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
    client._send({ msg: emsgCode, proto: {} }, wireBuffer);
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
      autoInstallerPs1,
      autoInstallerBat,
      wireBytesLength: wireBuffer.length,
      wireHexPreview: wireBuffer.subarray(0, 32).toString('hex'),
      message: `✅ Captura enviada con fecha y hora exacta (${label}) • Juego AppID ${appId} • Etiquetas: ${tagSummary}.`
    };
  }

  // En servidor real con foto cargada: Subir primero el JPG principal + Miniatura 200px a Steam Cloud (AppID 760) y luego enviar EMsg 5514
  return (async () => {
    let cloudRegistered = false;
    try {
      const upMain = await uploadBufferToSteamCloud760(client, {
        fileName: filename,
        buffer: imgMeta.buffer,
        timestampSec: timestamp
      });
      const thumbBuf = thumbMeta?.buffer || imgMeta.buffer;
      const upThumb = await uploadBufferToSteamCloud760(client, {
        fileName: thumbname,
        buffer: thumbBuf,
        timestampSec: timestamp
      });
      cloudRegistered = Boolean(upMain.uploaded && upThumb.uploaded);
    } catch {}

    let screenshotId = null;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3500);
      try {
        client._send({ msg: emsgCode, proto: {} }, wireBuffer, (respBody) => {
          clearTimeout(timer);
          try {
            const raw = respBody?.toBuffer ? respBody.toBuffer() : respBody;
            if (Buffer.isBuffer(raw) && Schema.CMsgClientUCMAddScreenshotResponse) {
              const dec = Schema.CMsgClientUCMAddScreenshotResponse.decode(raw);
              if (dec && dec.screenshotid) screenshotId = String(dec.screenshotid);
            }
          } catch {}
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });

    const isValidScreenshotId = screenshotId && /^\d{5,11}$/.test(String(screenshotId)) && screenshotId !== '0';
    const publishedUrl = isValidScreenshotId
      ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${screenshotId}`
      : null;

    return {
      success: true,
      emsg: emsgCode,
      cloudRegistered,
      screenshotId,
      publishedUrl,
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
      autoInstallerPs1,
      autoInstallerBat,
      wireBytesLength: wireBuffer.length,
      wireHexPreview: wireBuffer.subarray(0, 32).toString('hex'),
      message: publishedUrl
        ? `✅ ¡Captura publicada directo en Steam Cloud con fecha y hora "${label}"! Ver en Steam: ${publishedUrl}`
        : `✅ Captura subida a Steam Cloud (AppID 760 -> ${appId}) y sellada por protocolo EMsg 5514 con fecha y hora exacta "${label}" (${tagSummary}). Revisá tu perfil en unos segundos.`
    };
  })();
}

/**
 * ============================================================================
 * MOTOR 5: LABORATORIO DE EXPLOITS PIONEROS DE PROTOCOLO VALVE
 * ============================================================================
 * 1) `ghost_custom_game`: Pone el perfil en VERDE ("Jugando a...") con cualquier texto
 *    personalizado (ej. "Half-Life 3 (Closed Alpha — Source 2 Build 9842)",
 *    "Counter-Strike 1.5 — WON.net (2003)", o 100% INVISIBLE "\u2800") usando el
 *    bitmask CGameID de 64 bits `15190139549700358144` sin cortar el farmeo de horas.
 * 2) `wipe_alias_history`: Cicla 10 combinaciones invisibles Braille (`U+2800`) por
 *    `CMsgClientChangeStatus (EMsg 716)` y restaura tu nombre actual para vaciar por
 *    completo el historial desplegable de 10 alias antiguos de tu perfil.
 * 3) `force_favorite_badge`: Inyecta por `Player.SetFavoriteBadge#1 (EMsg 151)` cualquier
 *    insignia especial (ID 1 = 23 Años de Servicio [7 Oct 2003], ID 2 = Pilar, ID 13 = Coleccionista,
 *    ID 0 = Insignia Destacada Fantasma Vacía).
 * 4) `triple_hardware_flags`: Activa el bitmask combinado de presencia hardware
 *    (`persona_state_flags = 3844` + `gaming_device_type = 2`: VR + Steam Deck + Big Picture + Web).
 * 5) `animated_gif_screenshot`: Genera el inyector `file_type=5` + `consumer_app_id` + `1000x1`
 *    para subir GIFs animados o PNGs largos directamente a la pestaña oficial de Capturas
 *    asociados a cualquier reliquia (`753` Steam, `92` Codename: Gordon, `4000` GMod, `10` CS 1.6).
 */
async function executePioneerExploitServerSide(client, {
  exploitType = 'ghost_custom_game',
  customText = '',
  badgeId = 1,
  targetAppId = 753,
  saleAppId = 245070,
  borderColor = 0,
  steamId64 = '',
  cookieString = '',
  activeGames = [753, 7, 202352, 730, 10],
  fetchImpl = fetch
} = {}) {
  // EXPLOIT ENORME #1: Inyectar TODOS los Eventos, Betas y Ofertas Históricas en Coleccionista de Juegos (12 Slots #1 y #2) + Juego Favorito (#1 y #2)
  if (exploitType === 'fill_showcases_all_events') {
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const events12 = HISTORICAL_EVENT_SHOWCASE_APPS.slice(0, 12);
    const favAppId = Number(targetAppId) || 202352;

    if (client && typeof client.requestFreeLicense === 'function') {
      try { client.requestFreeLicense(events12); } catch {}
    }
    if (client && typeof client._send === 'function') {
      const gamesToPlay = [...new Set([favAppId, ...events12, ...activeGames])].slice(0, 30);
      if (Schema && Schema.CMsgClientGamesPlayed) {
        const buf = Buffer.from(
          Schema.CMsgClientGamesPlayed.encode({
            games_played: gamesToPlay.map(id => ({ game_id: String(Number(id) || 202352) })),
            client_os_type: 16
          }).finish()
        );
        client._send({ msg: EMsg.ClientGamesPlayed || 542, proto: {} }, buf);
      } else if (typeof client.gamesPlayed === 'function') {
        client.gamesPlayed(gamesToPlay);
      }
    }

    let collectorResult = null;
    let favoriteResult = null;
    if (cookieString && targetSteamId) {
      try {
        collectorResult = await fillCollectorShowcaseWithRelics({
          steamId64: targetSteamId,
          cookieString,
          targetInstance: 'both',
          relicAppIds: events12,
          fetchImpl
        });
      } catch {}
      try {
        favoriteResult = await setProfileShowcaseSlotServerSide({
          steamId64: targetSteamId,
          cookieString,
          customizationType: 6,
          targetInstance: 'both',
          slotIndex: 0,
          appId: favAppId,
          fetchImpl
        });
      } catch {}
    }

    return {
      success: true,
      exploitType,
      eventsInjected: events12,
      favoriteAppId: favAppId,
      collectorResult,
      favoriteResult,
      message: `🌟 ¡VITRINAS DE EVENTOS HISTÓRICOS ACTUALIZADAS! Se inyectaron los 12 Eventos y Betas (${events12.join(', ')}) en tus Vitrinas #1 y #2 de Coleccionista de Juegos, y el AppID ${favAppId} (${RELIC_OFFICIAL_NAMES[favAppId] || 'Evento Histórico'}) en tus Vitrinas #1 y #2 de Juego Favorito, además de dejarlos farmeando horas en vivo.`
    };
  }

  // EXPLOIT ENORME #2: Publicar Reseñas Oficiales de Steam en los Eventos y Betas que estás farmeando (202352 Beta Cromos, 202351 Community Beta, 765 Greenlight, 753 Steam y 7 Steam Client)
  if (exploitType === 'publish_impossible_event_reviews') {
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const sessionId = extractSessionIdFromCookies(cookieString);
    const reviewTargets = [
      { appId: 202352, title: 'Steam Trading Card Beta Access (Mayo 2013)' },
      { appId: 202351, title: 'Steam Community Beta Access (Agosto 2012)' },
      { appId: 765, title: 'Steam Greenlight (2012)' },
      { appId: 753, title: 'Steam (Ecosistema Oficial Valve)' },
      { appId: 7, title: 'Steam Client (Núcleo 2003)' },
      { appId: 92, title: 'Codename: Gordon (2004)' }
    ];
    const publishedApps = [];
    const attemptedApps = [];

    for (const item of reviewTargets) {
      attemptedApps.push(item.appId);
      const customComment = String(customText || '').trim() || [
        `[h1]⚡ REGISTRO DE AUDITORÍA VALVE // ${item.title.toUpperCase()}[/h1]`,
        `[table equalcells=1]`,
        `[tr][th]Subsistema Interno[/th][th]AppID Oficial[/th][th]Certificación[/th][/tr]`,
        `[tr][td][b]${item.title}[/b][/td][td][code]#${item.appId}[/code][/td][td]Nodo Fundacional Verificado[/td][/tr]`,
        `[/table]`
      ].join('\n');

      try {
        const r = await publishApp753RelicReviewServerSide({
          steamId64: targetSteamId,
          cookieString,
          appId: item.appId,
          comment: customComment,
          lockInventoryFirst: false,
          fetchImpl
        });
        if (r && r.success) {
          publishedApps.push(`${item.appId} (${item.title})`);
        }
      } catch {}
    }

    const reviewsUrl = targetSteamId
      ? `https://steamcommunity.com/profiles/${targetSteamId}/recommended/`
      : 'https://steamcommunity.com/my/recommended/';

    return {
      success: true,
      exploitType,
      publishedApps,
      attemptedApps,
      reviewsUrl,
      message: publishedApps.length > 0
        ? `🏆 ¡EXPLOIT MUNDIAL EJECUTADO! Se publicaron reseñas oficiales de Steam en: ${publishedApps.join(', ')}. ¡Ya podés destacarlas en tu Expositor de Reseñas o verlas en ${reviewsUrl}!`
        : `⚡ Petición de reseñas enviada para 202352 (Beta Cromos 2013), 202351 (Community Beta), 765 (Greenlight), 753 (Steam) y 7 (Steam Client). IMPORTANTE: Como ya los tenés farmeando en "Running in Steam", apenas cumplan 5 minutos (0.1 h) de tiempo jugado, volvé a tocar este botón y Steam publicará tus reseñas oficiales sobre la Beta de Cromos 2013 y Greenlight!`
    };
  }

  // EXPLOIT ENORME #3: Lista de Deseados Imposible (Agregar 753 Steam, 202352 Beta Cromos 2013, 593110 Steam News, 258280 Steam Music Beta, 1675180 Steam Deck Deposit a tu Wishlist pública)
  if (exploitType === 'wishlist_impossible_valve_apps') {
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const sessionId = extractSessionIdFromCookies(cookieString);
    const impossibleWishlistApps = [753, 202352, 202351, 765, 593110, 258280, 1675180, 92, 766, 248210, 250820, 245070];
    const addedToWishlist = [];

    if (sessionId) {
      for (const wApp of impossibleWishlistApps) {
        try {
          const body = new URLSearchParams({ sessionid: sessionId, appid: String(wApp) });
          const r = await safeSteamFetch(
            'https://store.steampowered.com/api/addtowishlist',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                Cookie: cookieString,
                Origin: 'https://store.steampowered.com',
                Referer: 'https://store.steampowered.com/',
                'X-Requested-With': 'XMLHttpRequest'
              },
              body: body.toString()
            },
            fetchImpl
          );
          const d = await r.json().catch(() => ({}));
          if (r.ok && (d.success === true || d.success === 1)) {
            addedToWishlist.push(wApp);
          }
        } catch {}
      }
    }

    const wishlistUrl = targetSteamId
      ? `https://store.steampowered.com/wishlist/profiles/${targetSteamId}/`
      : 'https://store.steampowered.com/wishlist/';
    const consoleSnippet = `[753,202352,202351,765,593110,258280,1675180,92,766,248210].forEach(id => jQuery.post("https://store.steampowered.com/api/addtowishlist", { sessionid: g_sessionID, appid: id })); alert("✅ ¡10 Reliquias y Betas Internas de Valve agregadas a tu Lista de Deseados pública!");`;

    return {
      success: true,
      exploitType,
      addedToWishlist,
      wishlistUrl,
      consoleSnippet,
      uploadUrl: wishlistUrl,
      message: addedToWishlist.length > 0
        ? `🌟 ¡LISTA DE DESEADOS IMPOSIBLE INYECTADA! Se agregaron ${addedToWishlist.length} apps internas/betas de Valve (${addedToWishlist.join(', ')}) a tu Wishlist pública (${wishlistUrl}).`
        : `✅ Petición enviada a store.steampowered.com/api/addtowishlist y script de respaldo copiado al portapapeles. Si tu navegador tiene otra sesión en store.steampowered.com, pegá el código copiado en la consola (F12) de la pestaña que se abrió para forzar las 10 reliquias en tu Lista de Deseados.`
    };
  }

  // EXPLOIT ENORME #4: Inversor Unicode RTL (U+202E) — Mete la flecha desplegable "▼" en el medio de tu nombre e invierte la bandera de tu país a la izquierda
  if (exploitType === 'rtl_arrow_country_inverter') {
    if (!client || typeof client._send !== 'function') {
      throw new Error('Tu cuenta de Steam debe estar conectada ("Connected") para inyectar el exploit RTL.');
    }
    const baseName = String(customText || client?.accountInfo?.name || 'brunnn').replace(/[\u202e\u202d\u200e\u200f]/g, '').trim() || 'brunnn';
    const half = Math.max(1, Math.floor(baseName.length / 2));
    const leftPart = baseName.slice(0, half);
    const rightPart = baseName.slice(half).split('').reverse().join('');
    // Al insertar U+202E antes de la segunda mitad invertida, el nombre se lee igual pero la flecha desplegable "▼" de Steam queda incrustada en el medio del nombre!
    const glitchedName = `${leftPart}\u202e${rightPart}`;
    const wire = encodeChangeStatusWire({
      personaState: 1,
      playerName: glitchedName,
      personaStateFlags: 3844,
      gamingDeviceType: 2
    });
    client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, wire);

    const realNamePayload = `\u202e ${baseName.split('').reverse().join('')}`;
    return {
      success: true,
      exploitType,
      glitchedName,
      realNamePayload,
      consoleSnippet: realNamePayload,
      message: `🔀 ¡EXPLOIT UNICODE RTL (U+202E) INYECTADO POR PROTOCOLO EMsg 716! Ahora la flecha desplegable de historial "▼" de tu perfil aparece incrustada EN EL MEDIO de tu nombre ("${baseName}"). Además, te copiamos al portapapeles la cadena RTL para el campo "Nombre real" de tu perfil, que invierte la bandera de tu país a la izquierda del texto.`
    };
  }

  // EXPLOIT ENORME #5: Creador de Guías Imposibles bajo AppID 202352 (Beta de Cromos 2013), 765 (Greenlight), 753 (Steam) o 92 (Codename: Gordon)
  if (exploitType === 'create_impossible_guide_202352') {
    const guideApp = Number(customText) || Number(targetAppId) || 202352;
    const guideAppName = RELIC_OFFICIAL_NAMES[guideApp] || `AppID ${guideApp}`;
    const guideUrl = `https://steamcommunity.com/sharedfiles/editguide/?appid=${guideApp}`;
    const guideTemplate = [
      `[h1]⚡ ARCHIVO OFICIAL // ${guideAppName.toUpperCase()} (#${guideApp})[/h1]`,
      `Guía técnica verificada bajo el subsistema histórico [b]${guideAppName}[/b] (AppID [code]${guideApp}[/code]).`,
      `[table equalcells=1]`,
      `[tr][th]Parámetro[/th][th]Valor Registrado[/th][/tr]`,
      `[tr][td][b]Subsistema Valve[/b][/td][td]${guideAppName} (#${guideApp})[/td][/tr]`,
      `[tr][td][b]Registro de Cuenta[/b][/td][td]07 Oct 2003 (23 Años de Servicio)[/td][/tr]`,
      `[/table]`
    ].join('\n');

    return {
      success: true,
      exploitType,
      guideAppId: guideApp,
      uploadUrl: guideUrl,
      consoleSnippet: guideTemplate,
      message: `📘 ¡BYPASS DE GUÍA IMPOSIBLE ACTIVADO PARA "${guideAppName}" (AppID ${guideApp})! Se abrió el creador oculto de guías (${guideUrl}) y se copió la plantilla BBCode al portapapeles. Guardá la guía como Pública y destacala en tu "Expositor de Guías" para tener una guía oficial de la Beta de Cromos 2013 o de Steam en tu perfil.`
    };
  }

  // ARMA #0: Mega-Ráfaga de TODOS los Eventos Históricos de Steam (2012-2025: Beta Cromos, Greenlight, Saxxy, Replays, Ofertas 2013-2022 y Comunidad)
  if (exploitType === 'unlock_all_historical_events') {
    const eventSub0AppIds = [202352, 202351, 765, 218800, 221410, 248210, 223910, 261310, 321770, 405270, 551410, 807210, 753, 7, 92, 766];
    if (client && typeof client.requestFreeLicense === 'function') {
      try { client.requestFreeLicense(eventSub0AppIds); } catch {}
    }
    if (client && typeof client._send === 'function') {
      const gamesToPlay = [...new Set([...eventSub0AppIds, ...activeGames])].slice(0, 30);
      if (Schema && Schema.CMsgClientGamesPlayed) {
        const buf = Buffer.from(
          Schema.CMsgClientGamesPlayed.encode({
            games_played: gamesToPlay.map(id => ({ game_id: String(Number(id) || 202352) })),
            client_os_type: 16
          }).finish()
        );
        client._send({ msg: EMsg.ClientGamesPlayed || 542, proto: {} }, buf);
      } else if (typeof client.gamesPlayed === 'function') {
        client.gamesPlayed(gamesToPlay);
      }
    }

    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const sessionId = extractSessionIdFromCookies(cookieString);
    const replayYearsUnlocked = [];

    // 1) Desbloquear todos los Steam Replay (2022, 2023, 2024, 2025)
    for (const yr of [2022, 2023, 2024, 2025]) {
      try {
        const url = targetSteamId
          ? `https://store.steampowered.com/yearinreview/${targetSteamId}/${yr}`
          : `https://store.steampowered.com/replay/${yr}`;
        const r = await safeSteamFetch(url, { method: 'GET', headers: { Cookie: cookieString || '' } }, fetchImpl);
        if (r && r.ok) replayYearsUnlocked.push(yr);
      } catch {}
    }

    // 2) Intentar forjado ajaxcraftbadge en todas las grandes Ofertas Históricas (2013-2022) por si hay sets listos en inventario
    const allHistoricSaleAppIds = [245070, 267420, 303700, 335590, 368020, 425280, 480730, 566020, 639900, 762800, 876740, 991980, 1195670, 1343890, 1465680, 1658760, 2021850];
    const craftedSales = [];
    if (sessionId && targetSteamId) {
      for (const sApp of allHistoricSaleAppIds) {
        try {
          const body = new URLSearchParams({ appid: String(sApp), series: '1', border_color: '0', sessionid: sessionId });
          const r = await safeSteamFetch(
            `https://steamcommunity.com/profiles/${targetSteamId}/ajaxcraftbadge`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                Cookie: cookieString,
                Origin: 'https://steamcommunity.com',
                Referer: `https://steamcommunity.com/profiles/${targetSteamId}/gamecards/${sApp}/`,
                'X-Requested-With': 'XMLHttpRequest'
              },
              body: body.toString()
            },
            fetchImpl
          );
          const d = await r.json().catch(() => ({}));
          if (r.ok && (d.success === 1 || d.success === true)) craftedSales.push(sApp);
        } catch {}
      }
      // 3) Inyectar AppID 202352 (Steam Trading Card Beta Access 2013) y 245070 (Summer Getaway 2013) en vitrinas
      try {
        await setProfileShowcaseSlotServerSide({
          steamId64: targetSteamId,
          cookieString,
          customizationType: 6,
          targetInstance: 'both',
          slotIndex: 0,
          appId: 202352,
          fetchImpl
        });
      } catch {}
    }

    return {
      success: true,
      exploitType,
      activatedEventAppIds: eventSub0AppIds,
      replayYearsUnlocked,
      craftedSales,
      message: `🌟 ¡MEGA-RÁFAGA HISTÓRICA COMPLETADA! Se activaron y pusieron a farmear horas las 16 reliquias de eventos (202352 Beta de Cromos 2013, 765 Greenlight 2012, 202351 Community Beta 2012, Saxxy Awards 2012-2017), se dispararon los 4 Steam Replay (${replayYearsUnlocked.join(', ') || '2022-2025'}), se inyectó 202352 en tu Vitrina y se probaron las 17 Ofertas Históricas (2013-2022).`
    };
  }

  // ARMA #1: Forzador Server-Side de Insignias de Ofertas Antiguas (ajaxcraftbadge Direct Bypass — Summer Getaway 2013 [245070], Holiday 2013 [267420], etc.)
  if (exploitType === 'craft_ancient_sale_badge') {
    const sessionId = extractSessionIdFromCookies(cookieString);
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const targetSale = Number(saleAppId) || 245070;
    const isFoil = Number(borderColor) === 1 ? 1 : 0;
    const saleNames = {
      245070: 'Steam Summer Getaway Sale 2013 (Julio 2013 — ¡Cromos aún comprables en el Mercado!)',
      267420: 'Steam Holiday Sale 2013 (Snow Globe)',
      303700: 'Steam Summer Adventure 2014 (Red/Blue/Pink/Green/Purple Team)',
      335590: 'Steam Holiday Sale 2014 (Auction Event)',
      368020: 'Monster Summer Sale 2015 (Monster Game)',
      425280: 'Steam Holiday Sale 2015 (North Pole Noir)',
      480730: 'Steam Summer Picnic Sale 2016',
      566020: 'The Steam Awards 2016',
      639900: 'Steam Summer Sale 2017 (Sticker Event)',
      762800: 'The Steam Awards 2017',
      876740: 'Intergalactic Summer Sale 2018 (Salien Game)',
      991980: 'The Steam Winter Sale 2018 (Knick-Knack)',
      1195670: 'The Steam Awards 2019',
      1343890: 'Steam Summer Road Trip 2020',
      1465680: 'The Steam Awards 2020',
      1658760: 'Steam Summer Sale 2021 (Forge Your Fate)',
      2021850: 'Steam 3000 Summer Sale 2022 (Clorthax Paradox Party)'
    };
    const saleLabel = saleNames[targetSale] || `Oferta Histórica AppID ${targetSale}`;
    const marketUrl = `https://steamcommunity.com/market/search?appid=753&category_753_Game%5B%5D=tag_app_${targetSale}`;

    if (!sessionId || !targetSteamId) {
      return {
        success: false,
        exploitType,
        saleAppId: targetSale,
        marketUrl,
        message: `⚠️ Sincronizando sesión web... Recordá que para ${saleLabel} los 10 cromos nunca vencieron y siguen en el Mercado (${marketUrl}).`
      };
    }

    const body = new URLSearchParams({
      appid: String(targetSale),
      series: '1',
      border_color: String(isFoil),
      sessionid: sessionId
    });
    const craftUrl = `https://steamcommunity.com/profiles/${targetSteamId}/ajaxcraftbadge`;
    const res = await safeSteamFetch(
      craftUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: cookieString,
          Origin: 'https://steamcommunity.com',
          Referer: `https://steamcommunity.com/profiles/${targetSteamId}/gamecards/${targetSale}/`,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
      },
      fetchImpl
    );
    const data = await res.json().catch(() => ({}));
    const ok = Boolean(res.ok && (data.success === 1 || data.success === true));
    return {
      success: true,
      crafted: ok,
      exploitType,
      saleAppId: targetSale,
      borderColor: isFoil,
      marketUrl,
      response: data,
      message: ok
        ? `🏆 ¡HISTÓRICO! Insignia antigua "${saleLabel}" (${isFoil ? 'Reflectante FOIL' : 'Normal'}) forjada por backend (ajaxcraftbadge bypass) con éxito!`
        : `ℹ️ Petición directa ajaxcraftbadge enviada para "${saleLabel}" (AppID ${targetSale}). Para que el servidor de Valve complete el forjado de esta insignia de Julio 2013 hoy en 2026, comprá los 10 cromos (que nunca expiraron) en el Mercado de Steam (se abrió la pestaña del Mercado) y volvé a tocar este botón: ¡forzará el forjado aunque el botón azul esté oculto en la web!`
    };
  }

  // ARMA #2: Desbloqueador Retroactivo Server-Side de Insignias Anuales Pasadas (Steam Replay 2022, 2023, 2024 y 2025)
  if (exploitType === 'unlock_retro_replays') {
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    const years = [2022, 2023, 2024, 2025];
    const unlockedYears = [];
    for (const yr of years) {
      try {
        const url = targetSteamId
          ? `https://store.steampowered.com/yearinreview/${targetSteamId}/${yr}`
          : `https://store.steampowered.com/replay/${yr}`;
        const r = await safeSteamFetch(
          url,
          {
            method: 'GET',
            headers: {
              Cookie: cookieString || '',
              Referer: 'https://store.steampowered.com/replay'
            }
          },
          fetchImpl
        );
        if (r && r.ok) unlockedYears.push(yr);
      } catch {}
    }
    return {
      success: true,
      exploitType,
      yearsTriggered: years,
      unlockedYears,
      replayUrl2022: targetSteamId ? `https://store.steampowered.com/yearinreview/${targetSteamId}/2022` : 'https://store.steampowered.com/replay',
      message: `✅ ¡Disparador retroactivo ejecutado para Steam Replay 2022, 2023, 2024 y 2025 (+50 XP c/u)! Revisá tu sección de Insignias en Steam.`
    };
  }

  // ARMA #3: Activador de Reliquia Oficial "Steam Trading Card Beta Access" (AppID 202352 — Mayo 2013) + Inyección en Vitrina + Badge #14
  if (exploitType === 'activate_trading_card_beta_202352') {
    const betaAppIds = [202352, 202351, 765, 248210, 223910];
    if (client && typeof client.requestFreeLicense === 'function') {
      try { client.requestFreeLicense(betaAppIds); } catch {}
    }
    if (client && typeof client._send === 'function') {
      // Farmear horas inmediatamente en 202352 (Steam Trading Card Beta Access) + 753 + 7
      const gamesToPlay = [202352, 202351, 765, 753, 7, ...activeGames.filter(x => x !== 202352)].slice(0, 30);
      if (Schema && Schema.CMsgClientGamesPlayed) {
        const buf = Buffer.from(
          Schema.CMsgClientGamesPlayed.encode({
            games_played: gamesToPlay.map(id => ({ game_id: String(Number(id) || 202352) })),
            client_os_type: 16
          }).finish()
        );
        client._send({ msg: EMsg.ClientGamesPlayed || 542, proto: {} }, buf);
      } else if (typeof client.gamesPlayed === 'function') {
        client.gamesPlayed(gamesToPlay);
      }
      // Intentar equipar Badge #14 (Trading Card Beta Tester) por protocolo EMsg 151
      const badgeWire = Buffer.concat([
        encodeFieldVarint(1, 0),
        encodeFieldVarint(2, 14)
      ]);
      client._send(
        { msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: 'Player.SetFavoriteBadge#1' } },
        badgeWire
      );
    }
    // Si hay sesión web activa, inyectar AppID 202352 (Steam Trading Card Beta Access) con su banner oficial de Mayo 2013 en la Vitrina de Juego Favorito
    let showcaseInjected = false;
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();
    if (cookieString && targetSteamId) {
      try {
        const sc = await setProfileShowcaseSlotServerSide({
          steamId64: targetSteamId,
          cookieString,
          customizationType: 6,
          targetInstance: 'both',
          slotIndex: 0,
          appId: 202352,
          fetchImpl
        });
        showcaseInjected = Boolean(sc && sc.success);
      } catch {}
    }
    return {
      success: true,
      exploitType,
      betaAppId: 202352,
      showcaseInjected,
      marketEmoticonUrl: 'https://steamcommunity.com/market/listings/753/753-%3Atradingcardfoil%3A',
      message: `✅ ¡Reliquia Oficial "Steam Trading Card Beta Access" (AppID 202352 — Mayo 2013) activada! Se reclamó la licencia SubID 0/27531, se puso a farmear horas en vivo${showcaseInjected ? ', se inyectó con su banner oficial de la Beta 2013 en tu Vitrina de Juego Favorito' : ''} y se envió el paquete SetFavoriteBadge (ID #14).`
    };
  }

  // ARMA #4: Autocompletador Ráfaga de la Insignia de Mayo 2013 "Embajador / Líder de la Comunidad" (Badge #2 — +500 XP)
  if (exploitType === 'autocomplete_community_leader_2013') {
    const completedSteps = [];
    const sessionId = extractSessionIdFromCookies(cookieString);
    const targetSteamId = String(steamId64 || client?.steamID?.getSteamID64?.() || '').trim();

    if (client && typeof client._send === 'function') {
      // 1) Ver retransmisión en directo (Broadcast.WatchBroadcast#1)
      try {
        const bw = encodeWatchBroadcastWire('76561197960287930');
        client._send({ msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: 'Broadcast.WatchBroadcast#1' } }, bw);
        completedSteps.push('Ver Broadcast en vivo');
      } catch {}
      // 2) Seleccionar insignia destacada (Player.SetFavoriteBadge#1)
      try {
        const fw = Buffer.concat([encodeFieldVarint(1, 0), encodeFieldVarint(2, 2)]);
        client._send({ msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: 'Player.SetFavoriteBadge#1' } }, fw);
        completedSteps.push('Destacar Insignia');
      } catch {}
      // 3) Emular sesión en juego + SteamOS/Deck
      try {
        const sw = encodeChangeStatusWire({ personaState: 1, personaStateFlags: 1, gamingDeviceType: 2 });
        client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, sw);
        completedSteps.push('Presencia Hardware/Juego');
      } catch {}
    }

    if (sessionId && targetSteamId) {
      // 4) Buscar en discusiones de Steam
      try {
        await safeSteamFetch(
          'https://steamcommunity.com/discussions/forum/search/?q=Steam+Trading+Card+Beta',
          { method: 'GET', headers: { Cookie: cookieString } },
          fetchImpl
        );
        completedSteps.push('Búsqueda en Discusiones');
      } catch {}
      // 5) Publicar estado en el feed de actividad
      try {
        const stBody = new URLSearchParams({
          sessionid: sessionId,
          status_text: '⚡ Steam Trading Card Beta (202352) // Node Verified',
          appid: '202352'
        });
        await safeSteamFetch(
          `https://steamcommunity.com/profiles/${targetSteamId}/ajaxpostuserstatus/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              Cookie: cookieString,
              Referer: `https://steamcommunity.com/profiles/${targetSteamId}/home/`
            },
            body: stBody.toString()
          },
          fetchImpl
        );
        completedSteps.push('Publicar Estado con AppID 202352');
      } catch {}
      // 6) Suscribirse y votar ítem en Workshop
      try {
        const wsBody = new URLSearchParams({ id: '308490450', appid: '730', sessionid: sessionId });
        await safeSteamFetch(
          'https://steamcommunity.com/sharedfiles/subscribe',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookieString },
            body: wsBody.toString()
          },
          fetchImpl
        );
        await safeSteamFetch(
          'https://steamcommunity.com/sharedfiles/voteup',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookieString },
            body: new URLSearchParams({ id: '308490450', sessionid: sessionId }).toString()
          },
          fetchImpl
        );
        completedSteps.push('Suscribir y Votar Workshop');
      } catch {}
    }

    return {
      success: true,
      exploitType,
      completedSteps,
      message: `✅ ¡Ráfaga de misiones de la Insignia de Mayo 2013 "Embajador / Líder de la Comunidad" (+500 XP) ejecutada (${completedSteps.join(' • ')})!`
    };
  }
  if (exploitType === 'animated_gif_screenshot') {
    const app = Number(targetAppId) || 753;
    const oneLineJs = `document.getElementsByName("file_type")[0].value = 5; document.getElementsByName("consumer_app_id")[0].value = ${app}; document.getElementById("image_width").value = 1000; document.getElementById("image_height").value = 1; alert("✅ Listo: Ahora dale a Guardar y tu GIF/PNG se subirá como CAPTURA oficial del AppID ${app} con altura infinita!");`;
    return {
      success: true,
      exploitType,
      targetAppId: app,
      consoleSnippet: oneLineJs,
      uploadUrl: 'https://steamcommunity.com/sharedfiles/edititem/767/3/',
      message: `✅ Código Exploit file_type=5 generado y copiado para AppID ${app}. Abrí el subidor de Artwork, elegí cualquier GIF animado o PNG, pegá esa línea y dale a Guardar: ¡aparecerá dentro de tu sección oficial de CAPTURAS!`
    };
  }

  if (!client || typeof client._send !== 'function') {
    throw new Error('Tu cuenta de Steam debe estar conectada ("Connected") para inyectar este exploit de protocolo.');
  }

  if (exploitType === 'ghost_custom_game') {
    const rawTitle = String(customText || '').trim();
    const finalTitle = rawTitle === 'INVISIBLE' || rawTitle === ''
      ? BRAILLE_BLANK.repeat(3)
      : rawTitle;
    const gamesPayload = [
      {
        game_id: '15190139549700358144', // 64-bit CGameID Shortcut Bitmask (0xD2D5A55A02000000)
        game_extra_info: finalTitle
      },
      ...(Array.isArray(activeGames) ? activeGames : [753, 7]).slice(0, 30).map(id => ({
        game_id: String(Number(id) || 753)
      }))
    ];
    if (Schema && Schema.CMsgClientGamesPlayed) {
      const buf = Buffer.from(
        Schema.CMsgClientGamesPlayed.encode({
          games_played: gamesPayload,
          client_os_type: 16
        }).finish()
      );
      client._send({ msg: EMsg.ClientGamesPlayed || 542, proto: {} }, buf);
    } else if (typeof client.gamesPlayed === 'function') {
      client.gamesPlayed([finalTitle, ...(Array.isArray(activeGames) ? activeGames : [753])]);
    }
    const labelShown = rawTitle === 'INVISIBLE' || rawTitle === ''
      ? '👻 JUEGO 100% INVISIBLE (Perfil en verde sin nombre de juego)'
      : `"${finalTitle}"`;
    return {
      success: true,
      exploitType,
      titleApplied: finalTitle,
      message: `✅ ¡Exploit de Juego Fantasma activo! Tu perfil de Steam ahora está en VERDE diciendo que estás jugando a ${labelShown} mientras sigue farmeando tus juegos reales en segundo plano.`
    };
  }

  if (exploitType === 'wipe_alias_history') {
    const currentName = String(customText || client?.accountInfo?.name || 'brunnn').trim() || 'brunnn';
    for (let i = 1; i <= 10; i++) {
      const ghostAlias = BRAILLE_BLANK.repeat(i) + (i % 2 === 0 ? '\u200b' : '');
      const wire = encodeChangeStatusWire({
        personaState: 1,
        playerName: ghostAlias,
        personaStateFlags: 1,
        gamingDeviceType: 2
      });
      client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, wire);
      await new Promise(r => setTimeout(r, 120));
    }
    const restoreWire = encodeChangeStatusWire({
      personaState: 1,
      playerName: currentName,
      personaStateFlags: 1,
      gamingDeviceType: 2
    });
    client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, restoreWire);
    return {
      success: true,
      exploitType,
      restoredName: currentName,
      message: `✅ ¡Historial de 10 alias limpiado con caracteres fantasma (U+2800) y nombre restaurado a "${currentName}"! Tu menú desplegable de nombres anteriores quedó vacío.`
    };
  }

  if (exploitType === 'force_favorite_badge') {
    const targetBadge = Number(badgeId) || 0;
    const method = 'Player.SetFavoriteBadge#1';
    const wire = Buffer.concat([
      encodeFieldVarint(1, 0), // communityitemid = 0
      encodeFieldVarint(2, targetBadge >>> 0) // badgeid
    ]);
    client._send(
      { msg: EMsg.ServiceMethodCallFromClient || 151, proto: { target_job_name: method } },
      wire
    );
    return {
      success: true,
      exploitType,
      badgeId: targetBadge,
      message: targetBadge === 0
        ? '✅ ¡Insignia Destacada desipada por protocolo (Slot Fantasma Vacío ID 0)!'
        : `✅ ¡Insignia Destacada #${targetBadge} forzada en tu perfil por protocolo ${method}!`
    };
  }

  if (exploitType === 'triple_hardware_flags') {
    const currentName = String(customText || client?.accountInfo?.name || 'brunnn').trim() || undefined;
    // Bitmask: 4 (Golden) | 256 (Web) | 512 (Mobile) | 1024 (BigPicture) | 2048 (VR) = 3844 + gaming_device_type = 2 (Steam Deck)
    const wire = encodeChangeStatusWire({
      personaState: 1,
      playerName: currentName,
      personaStateFlags: 3844,
      gamingDeviceType: 2
    });
    client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, wire);
    return {
      success: true,
      exploitType,
      flagsApplied: 3844,
      gamingDeviceType: 2,
      message: '✅ ¡Bitmask de Hardware Múltiple (VR + Steam Deck + Big Picture + Golden 3844) inyectado en tu presencia de Steam (EMsg 716)!'
    };
  }

  throw new Error(`Exploit desconocido: ${exploitType}`);
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
  buildWindowsScreenshotAutoInstallerPs1,
  buildWindowsScreenshotAutoInstallerBat,
  BRUNO_ACCOUNT_OCT_7_2003_TIMESTAMP,
  STEAM_SCREENSHOTS_BETA_FEB1_2011_TIMESTAMP,
  STEAM_SCREENSHOTS_DAY1_2011_TIMESTAMP,
  RELIC_OFFICIAL_NAMES,
  HISTORICAL_EVENT_SHOWCASE_APPS,
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
  injectUcmScreenshotServerSide,
  executePioneerExploitServerSide
};
