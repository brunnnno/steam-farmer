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

module.exports = {
  ZERO_OWNERSHIP_CS2_LOADOUT,
  lockInventoryPrivacyOnly,
  generateFakeCs2ShowcaseSvg,
  buildZeroInventoryInspectBbcode,
  exportFakeCs2ShowcaseToDesktop,
  escapeXml
};
