'use strict';

/**
 * REA CS2 ZERO-INVENTORY SKIN SHOWCASE SPOOFER (Overwatch 2003 Edition)
 * =====================================================================
 * Diseñado específicamente para cuentas que NO poseen skins de CS2:
 *
 * 1. BLOQUEO QUIRÚRGICO DE INVENTARIO PRIVADO (`lockInventoryPrivacyOnly`):
 *    Envía `POST /profiles/{steamId64}/ajaxsetprivacy` manteniendo el perfil
 *    100% Público (`PrivacyProfile = 3`), pero poniendo únicamente el Inventario
 *    en Privado (`PrivacyInventory = 1`). Así nadie puede auditar que tu inventario
 *    de CS2 está vacío.
 *
 * 2. GENERADOR PIXEL-PERFECT DE "EXPOSITOR DE OBJETOS" DE STEAM (`generateFakeCs2ShowcaseSvg`):
 *    Construye una réplica exacta al píxel (`636x190 px`, estética nativa de
 *    Steam Community `#171a21` / `rgba(0,0,0,0.35)`) de una Vitrina de Objetos
 *    con las 7 skins más caras de CS2 (Karambit Blue Gem #387, AWP Dragon Lore
 *    Souvenir, Butterfly Emerald, AK-47 #661 4x Titan Holo, M4A4 Howl 4x iBP Holo,
 *    Sport Gloves Pandora's Box, M9 Bayonet Doppler Ruby), incluyendo bordes de
 *    rareza oficiales, indicador `StatTrak™` e íconos oficiales del CDN de Valve.
 *
 * 3. INYECTOR DE ENLACES 3D REALES AL GAME COORDINATOR DE CS2 (`buildZeroInventoryInspectBbcode`):
 *    Genera los botones BBCode `[url=steam://rungame/730/.../+csgo_econ_action_preview...]`
 *    con títulos invisibles Braille (`\u2800`). Cuando un visitante hace clic en
 *    "Inspeccionar en el juego..." desde tu perfil, se le abre su propio CS2 y el
 *    Game Coordinator de Valve le renderiza el modelo 3D real de la Dragon Lore /
 *    Karambit Blue Gem en pantalla completa sin revelar el dueño real.
 */

const fs = require('fs');
const path = require('path');

const ZERO_OWNERSHIP_CS2_LOADOUT = [
  {
    slot: 0,
    name: '★ Karambit | Case Hardened',
    wear: 'Factory New',
    float: '0.0480829',
    pattern: 'Pattern #387 (Blue Gem)',
    statTrak: false,
    souvenir: false,
    rarityBorder: '#8650ac', // Extraordinary Knife
    nameColor: '#8650ac',
    stickers: ['Titan (Holo) | Katowice 2014'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf2PLacDBA5ciJlY20k_jkI7fUhFRB4MRij7r--YXygED6_UZrZ2H3I4fAdlI9ZVrU-1K9xO_p1J65tZ_Mn3Rk7nUl4CvD30vgN4c_0vI/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198084852298A9946351222D14440407685094987611'
  },
  {
    slot: 1,
    name: 'Souvenir AWP | Dragon Lore',
    wear: 'Factory New',
    float: '0.0009142',
    pattern: '4x Katowice 2014 (Holo)',
    statTrak: false,
    souvenir: true,
    rarityBorder: '#ffd700', // Souvenir Gold
    nameColor: '#ffd700',
    stickers: ['Titan (Holo)', 'iBUYPOWER (Holo)', 'Reason (Holo)', 'Vox Eminor (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FAR17PLfYQJD_9W7m5a0mvLwOq7cqWdQ-sJ0xOzAot-jiQa3-hBqY26ncIeVdlI6aA7T-FfsxLvr05C56p3MnWwj5HeAvkVdtA/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198023512965A28761239912D9244972541062093545'
  },
  {
    slot: 2,
    name: 'StatTrak™ AK-47 | Case Hardened',
    wear: 'Factory New',
    float: '0.0114021',
    pattern: 'Pattern #661 (Scar) + 4x Titan Holo',
    statTrak: true,
    souvenir: false,
    rarityBorder: '#d32ce6', // Classified Pink
    nameColor: '#cf6a32',
    stickers: ['Titan (Holo)', 'Titan (Holo)', 'Titan (Holo)', 'Titan (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot7HxfDhjxszJemkV086jloKOhcj4OrzZgiVU6dN4teXI8oThxlCx-ks5ZGH6I4XEdlA4M1nTqVm8wO3s0Z-7vM7LzHBl6ygi7WGdwUJqz1_b9g/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198165821922A35481920114D7812390412894012567'
  },
  {
    slot: 3,
    name: 'StatTrak™ M4A4 | Howl',
    wear: 'Factory New',
    float: '0.0003198',
    pattern: '4x iBUYPOWER (Holo) Katowice 2014',
    statTrak: true,
    souvenir: false,
    rarityBorder: '#e4ae39', // Contraband Gold/Orange
    nameColor: '#e4ae39',
    stickers: ['iBP (Holo)', 'iBP (Holo)', 'iBP (Holo)', 'iBP (Holo)'],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpou-6kejhjxszFJTwW09izh4-HluPxDKjBl2hU18l4jeHVu9Tw2Q218xA6MWz3Jo6ddQE8ZVrU_1K9wO_p1pO7v53LzWwj5HeA02_94Q/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198019283746A19283746512D1627384950192837465'
  },
  {
    slot: 4,
    name: '★ Butterfly Knife | Gamma Doppler',
    wear: 'Factory New',
    float: '0.0001204',
    pattern: 'Phase: Emerald',
    statTrak: true,
    souvenir: false,
    rarityBorder: '#8650ac',
    nameColor: '#8650ac',
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf0ebcZThQ6tCvq4GGqPD1PrbQqW9e-NV9j_v-5YT0m1HllB81NDG3Oo6cdlU_N1zV_1m9xO_p1J65tZ_Mn3Rk7nUl4CvD30vgW-4K9A/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198084852298A9946351222D14440407685094987611'
  },
  {
    slot: 5,
    name: '★ Sport Gloves | Pandora\'s Box',
    wear: 'Factory New',
    float: '0.0601102',
    pattern: 'Flawless Knuckles',
    statTrak: false,
    souvenir: false,
    rarityBorder: '#8650ac',
    nameColor: '#8650ac',
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJfwObaZzRU7dCJlo-cnvLLMrfummpD78A_3rmZoo7zig218xA4Zzr3I46ddwM8N1zR-Vm9wO3q1pO7tM7LzWwj5HeA82_85g/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198023512965A28761239912D9244972541062093545'
  },
  {
    slot: 6,
    name: '★ M9 Bayonet | Doppler',
    wear: 'Factory New',
    float: '0.0000419',
    pattern: 'Phase: Ruby (#1 Rank)',
    statTrak: true,
    souvenir: false,
    rarityBorder: '#8650ac',
    nameColor: '#8650ac',
    stickers: [],
    cdnIcon: 'https://community.fastly.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbSsLQJf3qr3czxb49KzgL-KmsjwPKvBmm5D19V5i_rEobP5gVO8v11qa2j3J4OVdlQ4ZVrU-1C9wO3s0Z-7vM7LzHBl6ygi7WGdwUJqz1_b9g/360fx360f',
    inspectLink: 'steam://rungame/730/76561120225523302/+csgo_econ_action_preview%20S76561198165821922A35481920114D7812390412894012567'
  }
];

/**
 * 1. BLOQUEO QUIRÚRGICO DE INVENTARIO PRIVADO (`PrivacyInventory = 1`)
 * Mantiene el perfil público (`PrivacyProfile = 3`) pero oculta el inventario
 * para que ningún visitante pueda comprobar que no posees los ítems en CS2.
 */
async function lockInventoryPrivacyOnly({ steamId64, sessionId, cookieString }) {
  if (!steamId64 || !sessionId || !cookieString) {
    return {
      ok: false,
      error: 'Se requieren steamId64, sessionId y cookieString para autenticar con Steam Community.',
      privacyApplied: 'NO_OP'
    };
  }

  const privacyJson = JSON.stringify({
    PrivacyProfile: 3,        // 3 = Público
    PrivacyInventory: 1,      // 1 = Privado (Nadie puede ver que tenés 0 skins)
    PrivacyInventoryGifts: 1, // 1 = Privado
    PrivacyOwnedGames: 3,     // 3 = Público
    PrivacyPlaytime: 3,       // 3 = Público
    PrivacyFriendsList: 2     // 2 = Solo amigos
  });

  const body = new URLSearchParams();
  body.set('sessionid', sessionId);
  body.set('Privacy', privacyJson);
  body.set('eCommentPermission', '1');

  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId64}/ajaxsetprivacy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com',
        'Referer': `https://steamcommunity.com/profiles/${steamId64}/edit/settings`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    const success = res.ok && (data.success === 1 || data.success === true);
    return {
      ok: success,
      privacyApplied: success ? 'Profile: PUBLIC | Inventory: PRIVATE' : 'FAILED',
      response: data
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      privacyApplied: 'ERROR'
    };
  }
}

/**
 * 2. GENERADOR PIXEL-PERFECT DE VITRINA FALSA DE OBJETOS DE STEAM (SVG 636x190 px)
 * Reproduce exactamente el CSS nativo de Steam Community (`.profile_customization`,
 * `.item_showcase`, `.showcase_slot`) con el ícono destacado grande + 6 slots +
 * tarjeta de inspección inferior, con íconos del CDN oficial de Valve.
 */
function generateFakeCs2ShowcaseSvg({
  showcaseTitle = 'Expositor de objetos',
  items = ZERO_OWNERSHIP_CS2_LOADOUT
} = {}) {
  const featured = items[0] || ZERO_OWNERSHIP_CS2_LOADOUT[0];
  const slots = items.slice(0, 7);

  const slotBoxes = slots.map((item, idx) => {
    const x = 14 + idx * 88;
    const y = 46;
    const badgeColor = item.souvenir ? '#ffd700' : (item.statTrak ? '#cf6a32' : item.rarityBorder);
    const tagText = item.souvenir ? 'SOUVENIR' : (item.statTrak ? 'StatTrak™' : 'FN 0.00x');
    return `
      <g transform="translate(${x}, ${y})">
        <rect width="80" height="80" rx="2" fill="#10151d" stroke="${item.rarityBorder}" stroke-width="2"/>
        <rect width="80" height="80" fill="url(#slotGlow)" opacity="0.45"/>
        <image href="${escapeXml(item.cdnIcon)}" x="8" y="6" width="64" height="42" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>
        <text x="40" y="44" fill="#ffffff" font-family="Arial, sans-serif" font-size="7.5" font-weight="bold" text-anchor="middle">${escapeXml(item.name.replace('StatTrak™ ', '').replace('Souvenir ', '').replace('★ ', '').slice(0, 24))}</text>
        <text x="40" y="55" fill="#9fb4c7" font-family="Arial, sans-serif" font-size="7" text-anchor="middle">${escapeXml(item.pattern.slice(0, 24))}</text>
        <rect x="4" y="62" width="72" height="14" rx="2" fill="rgba(0,0,0,0.85)" stroke="${badgeColor}" stroke-width="0.8"/>
        <text x="40" y="72" fill="${badgeColor}" font-family="Consolas, monospace" font-size="8" font-weight="bold" text-anchor="middle">${escapeXml(tagText)}</text>
      </g>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="636" height="190" viewBox="0 0 636 190">
  <defs>
    <linearGradient id="bgHeader" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#17202d" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#0d121a" stop-opacity="0.95"/>
    </linearGradient>
    <radialGradient id="slotGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3a5a8c" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#10151d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="636" height="190" rx="4" fill="#0b0f16"/>
  <rect x="0" y="0" width="636" height="34" fill="url(#bgHeader)"/>
  <text x="14" y="22" fill="#66c0f4" font-family="Arial, sans-serif" font-size="14" font-weight="normal">${escapeXml(showcaseTitle)}</text>
  ${slotBoxes}
  <rect x="14" y="136" width="608" height="44" rx="3" fill="#121822" stroke="#263345" stroke-width="1"/>
  <image href="${escapeXml(featured.cdnIcon)}" x="20" y="139" width="50" height="38" preserveAspectRatio="xMidYMid meet"/>
  <text x="76" y="153" fill="${featured.nameColor}" font-family="Arial, sans-serif" font-size="12" font-weight="bold">${escapeXml(featured.name)} (${escapeXml(featured.wear)})</text>
  <text x="76" y="169" fill="#8f98a0" font-family="Consolas, monospace" font-size="10">Counter-Strike 2 • ${escapeXml(featured.pattern)} • Float: ${escapeXml(featured.float)} • 4x Katowice 2014 (Holo)</text>
</svg>`;
}

/**
 * 3. GENERADOR BBCODE CON BOTONES REALES DE INSPECCIÓN 3D EN CS2 (SIN POSEER LAS SKINS)
 * Como tu inventario está en Privado, pones este bloque en tu Cuadro de Información
 * o Vitrina de Intercambio con título invisible `\u2800`. Cualquiera que toque
 * "[Inspeccionar en el juego...]" abre la skin real en 3D dentro de su propio CS2.
 */
function buildZeroInventoryInspectBbcode({
  items = ZERO_OWNERSHIP_CS2_LOADOUT
} = {}) {
  const rows = [
    '[table equalcells=1]',
    '[tr][th]Objeto Equipado (CS2)[/th][th]Float / Patrón[/th][th]Vista Previa 3D Oficial[/th][/tr]'
  ];

  for (const item of items) {
    rows.push(
      `[tr][td][b]${item.name}[/b] (${item.wear})[/td][td][code]${item.float} • ${item.pattern}[/code][/td][td][url=${item.inspectLink}][b]🔍 Inspeccionar en el juego...[/b][/url][/td][/tr]`
    );
  }

  rows.push('[/table]');
  return {
    brailleBlankTitle: '\u2800\u2800\u2800',
    bbcode: rows.join('\n')
  };
}

/**
 * Exporta directamente la vitrina SVG y prepara archivo para Desktop
 */
function exportFakeCs2ShowcaseToDesktop(targetDir) {
  const desktop = targetDir || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop') : path.join(process.env.HOME || '.', 'Desktop'));
  const svg = generateFakeCs2ShowcaseSvg();
  const filePath = path.join(desktop, 'fake_cs2_showcase_636px.svg');
  try {
    fs.writeFileSync(filePath, svg, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Empaquetador Binario de 64 bits de CGameID (Mod)
 */
function forgeModGameId(baseAppId, modCrc = 0x80002003) {
  const appId = BigInt(Number(baseAppId) & 0xFFFFFF);
  const typeMod = 1n << 24n; // k_EGameIDTypeGameMod = 1
  const modId = BigInt(((Number(modCrc) >>> 0) | 0x80000000) >>> 0) << 32n;
  return (modId | typeMod | appId).toString();
}

/**
 * Inyecta Rich Presence glitcheado en los servidores de Valve (EMsg.ClientRichPresenceUpload)
 * Provoca que en la lista de amigos y en el perfil aparezca el botón verde interactivo:
 * [ ▶ Unirse a la partida ] con un grupo de 2003 jugadores.
 */
function injectGlitchedRichPresence(client, {
  appId = 70, // Half-Life 2003 (o 10 CS 1.6 o 546560 Alyx)
  status = 'Ciudad 17 // Terminal Overwatch 2003',
  groupSize = '2003',
  connectString = '+connect 127.0.0.1:2003'
} = {}) {
  if (!client || typeof client.uploadRichPresence !== 'function') {
    return { ok: false, demo: true, message: `[Simulación] Rich Presence de ${groupSize} jugadores preparado para AppID ${appId}. Conéctate en SteamFarmer para transmitirlo en vivo a tus amigos.` };
  }

  const rp = {
    status: String(status),
    steam_display: '#Status_PlayingMatch',
    steam_player_group: 'citadel_overwatch_2003',
    steam_player_group_size: String(groupSize),
    connect: String(connectString)
  };

  try {
    client.uploadRichPresence(Number(appId), rp);
    return {
      ok: true,
      appId,
      richPresence: rp,
      message: `Rich Presence aplicado en AppID ${appId} (Lobby de ${groupSize} jugadores + botón Unirse)`
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Aplica modo fantasma (PersonaState = 7 Invisible) + Flag de hardware SteamVR (4096)
 */
function setGhostModeAndFlags(client, { personaState = 7, flags = 4096 } = {}) {
  if (!client || typeof client._send !== 'function') {
    return { ok: false, demo: true, message: `[Simulación] Modo Fantasma preparado (Invisible + Flag VR 4096). Conéctate en SteamFarmer para transmitirlo en vivo.` };
  }

  const EMsg = require('steam-user/enums/EMsg');
  try {
    client._send(EMsg.ClientChangeStatus, {
      persona_state: Number(personaState), // 7 = Invisible
      persona_state_flags: Number(flags)   // 4096 = Casco SteamVR
    });
    return {
      ok: true,
      personaState,
      flags,
      message: `Modo Fantasma activado (Estado: Invisible, Flag: SteamVR Casco 4096)`
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * =====================================================================
 * EXPLOIT 1: GHOST WORKSHOP ITEM FOR APPID 767 / STEAM CLIENT
 * =====================================================================
 * AppID 767 = Steam Community / Steam Client backend en Valve.
 * Al publicar un ítem en `/sharedfiles/edititem/767/3/`, Valve crea
 * un objeto de Workshop oficial asignado al propio software de Steam.
 * Luego se equipa en la Vitrina de la Workshop (showcase_type: 9).
 */
function generateGhostWorkshopScript({
  appId = 767,
  title = 'Overwatch 2003 Kernel // Valve Steam Client',
  description = 'C17 // Valve System Core Terminal Protocol (2003 Edition)',
  visibility = 0
} = {}) {
  return `(function() {
  const appId = ${Number(appId)};
  const title = ${JSON.stringify(title)};
  const description = ${JSON.stringify(description)};
  const visibility = ${Number(visibility)};

  console.log('🚀 Publicando Ghost Workshop Item para AppID ' + appId + '...');
  const formData = new FormData();
  formData.append('sessionid', g_sessionID);
  formData.append('title', title);
  formData.append('description', description);
  formData.append('visibility', String(visibility));
  formData.append('consumer_app_id', String(appId));
  formData.append('appid', String(appId));
  formData.append('file_type', '0');

  fetch('https://steamcommunity.com/sharedfiles/edititem/${Number(appId)}/3/', {
    method: 'POST',
    body: formData,
    credentials: 'same-origin'
  }).then(function(res) {
    if (res.url && res.url.includes('id=')) {
      const pubId = new URL(res.url).searchParams.get('id');
      console.log('✅ [Ghost Workshop] Ítem creado exitosamente! ID:', pubId);
      return $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
        sessionid: g_sessionID,
        showcase_type: 9,
        slot: 0,
        rgCustomFields: JSON.stringify({ "0": { "publishedfileid": pubId } })
      }).done(function() {
        alert('🎉 ¡Ítem de la Workshop creado para Steam Client (AppID ' + appId + ') y equipado en tu Vitrina de la Workshop!\nPublishedFileId: ' + pubId);
      });
    } else {
      console.log('ℹ️ Solicitud enviada a Steam Community Workshop (Status ' + res.status + ').');
      alert('Solicitud enviada a Steam Community Workshop. Verifica tus archivos en: https://steamcommunity.com/my/myworkshopfiles/');
    }
  }).catch(function(err) {
    console.error('❌ Error al publicar ítem ghost:', err);
    alert('Error al publicar: ' + err.message);
  });
})();`;
}

function generateWorkshopShowcaseScript(publishedFileId) {
  return `(function() {
  const pubId = ${JSON.stringify(String(publishedFileId))};
  $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
    sessionid: g_sessionID,
    showcase_type: 9,
    slot: 0,
    rgCustomFields: JSON.stringify({ "0": { "publishedfileid": pubId } })
  }).done(function(data) {
    console.log('✅ [Workshop Showcase] Vitrina configurada con PublishedFileId ' + pubId, data);
    alert('¡Vitrina de la Workshop actualizada con tu mod de Steam Client!');
  }).fail(function(err) {
    console.error('❌ Error:', err);
  });
})();`;
}

async function setWorkshopShowcase({ publishedFileId, cookieString, sessionId, steamId64 } = {}) {
  if (!cookieString || !sessionId) return { ok: false, error: 'No cookies provided' };
  try {
    const body = new URLSearchParams();
    body.set('sessionid', sessionId);
    body.set('showcase_type', '9');
    body.set('slot', '0');
    body.set('rgCustomFields', JSON.stringify({ "0": { "publishedfileid": String(publishedFileId) } }));

    const url = steamId64
      ? `https://steamcommunity.com/profiles/${steamId64}/ajaxsetshowcaseconfig`
      : 'https://steamcommunity.com/my/ajaxsetshowcaseconfig';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com'
      },
      body: body.toString()
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && (data.success === 1 || data.success === true), response: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function publishGhostWorkshopItem({
  appId = 767,
  title = 'Overwatch 2003 Kernel // Valve Steam Client',
  description = 'C17 // Valve System Core Terminal Protocol (2003 Edition)',
  visibility = 0,
  cookieString,
  sessionId,
  steamId64
} = {}) {
  if (!cookieString || !sessionId) {
    return {
      ok: false,
      demo: true,
      appId,
      title,
      message: `[Simulación] Se requiere sesión activa de Steam para publicar en AppID ${appId}. Usa el botón 'Copiar Script F12' para ejecutarlo directamente en tu navegador.`
    };
  }

  const formData = new URLSearchParams();
  formData.set('sessionid', sessionId);
  formData.set('title', title);
  formData.set('description', description);
  formData.set('visibility', String(visibility));
  formData.set('consumer_app_id', String(appId));
  formData.set('appid', String(appId));
  formData.set('file_type', '0');

  try {
    const res = await fetch(`https://steamcommunity.com/sharedfiles/edititem/${appId}/3/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com',
        'Referer': `https://steamcommunity.com/sharedfiles/edititem/${appId}/3/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: formData.toString(),
      redirect: 'manual'
    });

    const location = res.headers.get('location') || '';
    let pubId = null;
    const matchId = location.match(/[?&]id=(\d+)/);
    if (matchId) pubId = matchId[1];

    let showcaseResult = null;
    if (pubId) {
      showcaseResult = await setWorkshopShowcase({ publishedFileId: pubId, cookieString, sessionId, steamId64 });
    }

    return {
      ok: res.status < 400 || Boolean(location),
      status: res.status,
      publishedFileId: pubId,
      workshopUrl: pubId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${pubId}` : null,
      showcaseEquipped: showcaseResult?.ok || false,
      message: pubId
        ? `Ítem Ghost publicado exitosamente en Steam Workshop (AppID ${appId}, ID: ${pubId}) y equipado en Vitrina.`
        : `Solicitud enviada a Steam Workshop (Status: ${res.status}). Verifica tus archivos de Workshop.`
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

/**
 * =====================================================================
 * EXPLOIT 2: THE 0.0 HOURS OFFICIAL STORE REVIEW BYPASS
 * =====================================================================
 * Endpoint: POST https://store.steampowered.com/friends/recommendgame/
 * Parámetro quirúrgico: `playtime_at_review: 0`
 * Permite que una cuenta publique una reseña oficial en la tienda de Steam
 * con el sello dorado "0.0 horas registradas", y luego la equipa en la
 * Vitrina de Reseñas del Perfil (showcase_type: 10).
 */
function generateZeroHourReviewScript({
  appId = 70,
  reviewText = 'C17 // OVERWATCH 2003 TELEMETRY VERIFIED.\nObra maestra absoluta de Valve Corporation.',
  ratedUp = true,
  language = 'spanish'
} = {}) {
  return `(function() {
  const appId = ${Number(appId)};
  const reviewText = ${JSON.stringify(reviewText)};
  const ratedUp = ${Boolean(ratedUp)};
  const lang = ${JSON.stringify(language)};

  console.log('🚀 Enviando Reseña de 0.0 Horas a Steam Store para AppID ' + appId + '...');
  $J.post('https://store.steampowered.com/friends/recommendgame/', {
    sessionid: g_sessionID,
    appid: appId,
    comment: reviewText,
    rated_up: ratedUp,
    is_public: true,
    language: lang,
    received_compensation: 0,
    playtime_at_review: 0
  }).done(function(data) {
    console.log('✅ Reseña publicada:', data);
    if (data.success === 1 || data.success === true) {
      // Equipar automáticamente la Vitrina de Reseñas (showcase_type: 10)
      $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
        sessionid: g_sessionID,
        showcase_type: 10,
        slot: 0,
        appid: appId
      }).done(function() {
        alert('🎉 ¡Reseña oficial con 0.0 horas publicada y equipada en tu Vitrina de Reseñas de Steam!\nAppID: ' + appId);
      });
    } else {
      alert('Reseña procesada: ' + JSON.stringify(data));
    }
  }).fail(function(err) {
    console.error('❌ Error al publicar reseña:', err);
    alert('Error al publicar: ' + (err.responseText || err.statusText));
  });
})();`;
}

async function setReviewShowcase({ appId, cookieString, sessionId, steamId64 } = {}) {
  if (!cookieString || !sessionId) return { ok: false, error: 'No cookies provided' };
  try {
    const body = new URLSearchParams();
    body.set('sessionid', sessionId);
    body.set('showcase_type', '10');
    body.set('slot', '0');
    body.set('appid', String(appId));

    const url = steamId64
      ? `https://steamcommunity.com/profiles/${steamId64}/ajaxsetshowcaseconfig`
      : 'https://steamcommunity.com/my/ajaxsetshowcaseconfig';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com'
      },
      body: body.toString()
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && (data.success === 1 || data.success === true), response: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function submitZeroHourReview({
  appId = 70,
  reviewText = 'C17 // OVERWATCH 2003 TELEMETRY VERIFIED.\nObra maestra de Valve.',
  ratedUp = true,
  language = 'spanish',
  cookieString,
  sessionId,
  steamId64
} = {}) {
  if (!cookieString || !sessionId) {
    return {
      ok: false,
      demo: true,
      appId,
      message: `[Simulación] Reseña de 0.0 horas preparada para AppID ${appId}. Usa 'Copiar Script F12' en la tienda de Steam para publicarla al instante.`
    };
  }

  const body = new URLSearchParams();
  body.set('sessionid', sessionId);
  body.set('appid', String(appId));
  body.set('comment', reviewText);
  body.set('rated_up', ratedUp ? 'true' : 'false');
  body.set('is_public', 'true');
  body.set('language', language);
  body.set('received_compensation', '0');
  body.set('playtime_at_review', '0');

  try {
    const res = await fetch('https://store.steampowered.com/friends/recommendgame/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://store.steampowered.com',
        'Referer': `https://store.steampowered.com/app/${appId}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    const success = res.ok && (data.success === 1 || data.success === true);

    let showcaseResult = null;
    if (success) {
      showcaseResult = await setReviewShowcase({ appId, cookieString, sessionId, steamId64 });
    }

    return {
      ok: success,
      appId,
      playtimeAtReview: 0,
      storeUrl: `https://store.steampowered.com/app/${appId}`,
      showcaseEquipped: showcaseResult?.ok || false,
      response: data,
      message: success
        ? `¡Reseña oficial con 0.0 horas registrada con éxito en Steam Store (AppID ${appId})!`
        : `Respuesta de Steam Store: ${JSON.stringify(data)}`
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

/**
 * =====================================================================
 * EXPLOIT 4: THE 2003 ORPHANED / RELIC VALVE CLAN AS FAVORITE GROUP
 * =====================================================================
 * Endpoint: POST https://steamcommunity.com/my/ajaxsetshowcaseconfig
 * `showcase_type`: 8 (Grupo Favorito)
 * `clanid`: ID64 del clan histórico de Valve (Clan ID 4, 5, etc.)
 */
const HISTORICAL_RELIC_GROUPS = [
  { clanId: '103582791429521412', name: 'Valve', fullName: 'Valve Corporation (Official Valve Group)', id32: 4, url: 'Valve', badge: 'VALVE CORP' },
  { clanId: '103582791429521413', name: 'Steam', fullName: 'Steam (Official Steam Platform by Valve)', id32: 5, url: 'SteamByValve', badge: 'STEAM CORP' },
  { clanId: '103582791429521414', name: 'Prozac', fullName: 'Prozac (Historic 2007 Day-1 Clan)', id32: 6, url: 'prozac', badge: 'DAY-1 RELIC' },
  { clanId: '103582791429521418', name: 'Seattle', fullName: 'Seattle (Valve HQ City Group)', id32: 10, url: 'Seattle', badge: 'SEATTLE HQ' },
  { clanId: '103582791429521420', name: 'IGN PC', fullName: 'IGN PC (Media Pioneer 2007)', id32: 12, url: 'ignpc', badge: 'MEDIA 2007' },
  { clanId: '103582791430489958', name: '2003', fullName: 'Steam 2003 Pioneers (Open Veteran Clan)', id32: 968550, url: '2003', badge: 'VETERAN 2003' }
];

function generateFavoriteGroupScript(clanId = '103582791429521412') {
  return `(function() {
  const targetClanId = ${JSON.stringify(String(clanId))};
  console.log('🚀 Fijando Grupo Reliquia ' + targetClanId + ' como Grupo Favorito...');
  $J.post('https://steamcommunity.com/my/ajaxsetshowcaseconfig', {
    sessionid: g_sessionID,
    showcase_type: 8,
    slot: 0,
    clanid: targetClanId
  }).done(function(data) {
    console.log('✅ [Relic Group] Grupo Reliquia fijado en tu perfil:', data);
    alert('🎉 ¡Grupo Reliquia (Clan ID ' + targetClanId + ') configurado con éxito como Grupo Favorito en tu perfil! Recarga tu perfil para verificar.');
  }).fail(function(err) {
    console.error('❌ Error al fijar grupo reliquia:', err);
    alert('Error al fijar grupo: ' + (err.responseText || err.statusText));
  });
})();`;
}

async function setFavoriteRelicGroup({
  clanId = '103582791429521412',
  cookieString,
  sessionId,
  steamId64
} = {}) {
  const matched = HISTORICAL_RELIC_GROUPS.find(g => g.clanId === String(clanId)) || { clanId, name: `Clan ${clanId}` };

  if (!cookieString || !sessionId) {
    return {
      ok: false,
      demo: true,
      clanId,
      group: matched,
      message: `[Simulación] Grupo reliquia ${matched.name} (${clanId}) preparado. Usa el botón 'Copiar Script F12' para aplicarlo directamente en Steam.`
    };
  }

  const body = new URLSearchParams();
  body.set('sessionid', sessionId);
  body.set('showcase_type', '8');
  body.set('slot', '0');
  body.set('clanid', String(clanId));

  const url = steamId64
    ? `https://steamcommunity.com/profiles/${steamId64}/ajaxsetshowcaseconfig`
    : 'https://steamcommunity.com/my/ajaxsetshowcaseconfig';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieString,
        'Origin': 'https://steamcommunity.com',
        'Referer': `https://steamcommunity.com/profiles/${steamId64 || 'my'}/edit/showcases`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    const success = res.ok && (data.success === 1 || data.success === true);

    return {
      ok: success,
      clanId,
      group: matched,
      response: data,
      message: success
        ? `¡Grupo Reliquia ${matched.name} (${clanId}) fijado como Grupo Favorito en tu perfil con éxito!`
        : `Respuesta de Steam: ${JSON.stringify(data)}`
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

module.exports = {
  ZERO_OWNERSHIP_CS2_LOADOUT,
  lockInventoryPrivacyOnly,
  generateFakeCs2ShowcaseSvg,
  buildZeroInventoryInspectBbcode,
  exportFakeCs2ShowcaseToDesktop,
  forgeModGameId,
  injectGlitchedRichPresence,
  setGhostModeAndFlags,
  // Exploit 1
  generateGhostWorkshopScript,
  generateWorkshopShowcaseScript,
  publishGhostWorkshopItem,
  setWorkshopShowcase,
  // Exploit 2
  generateZeroHourReviewScript,
  submitZeroHourReview,
  setReviewShowcase,
  // Exploit 4
  HISTORICAL_RELIC_GROUPS,
  generateFavoriteGroupScript,
  setFavoriteRelicGroup,
  escapeXml
};


