const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');

let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
cfg.games = cfg.games || [];
cfg.gameNames = cfg.gameNames || {};
cfg.customStatus = cfg.customStatus || '';
cfg.discordWebhook = cfg.discordWebhook || '';
cfg.webPin = String(cfg.webPin || '1234');
cfg.personaState = cfg.personaState !== undefined ? cfg.personaState : SteamUser.EPersonaState.Invisible;
cfg.cardFarming = cfg.cardFarming || false;
cfg.sleepMode = cfg.sleepMode || { enabled: false, start: 3, end: 8 };
cfg.achievementQueue = cfg.achievementQueue || [];
cfg.unlockedAchievements = cfg.unlockedAchievements || {};
cfg.mySteamID = cfg.mySteamID || '';

const client = new SteamUser();

let isFarming = false;
let isPaused = false;
let isCollisionPaused = false;
let isSleepPaused = false;
let collisionTimer = null;
let sessionStartTime = Date.now();
let webCookies = '';
let cardDropGames = [];
let mySteamID = cfg.mySteamID || '';

// Memoria caché para evitar bloqueos de Steam Community
const achCache = {};

const PRESETS = {
  competitivos: {
    name: '🎯 Competitivos',
    games: [730, 440, 570, 252490, 1172470, 578080],
    names: { 730: 'Counter-Strike 2', 440: 'Team Fortress 2', 570: 'Dota 2', 252490: 'Rust', 1172470: 'Apex Legends', 578080: 'PUBG' }
  },
  valve: {
    name: '🏆 Clásicos Valve',
    games: [10, 240, 220, 550, 620],
    names: { 10: 'Counter-Strike 1.6', 240: 'Counter-Strike: Source', 220: 'Half-Life 2', 550: 'Left 4 Dead 2', 620: 'Portal 2' }
  },
  aaa: {
    name: '🔥 Populares AAA',
    games: [271590, 1938090, 1091500, 292030, 379720],
    names: { 271590: 'Grand Theft Auto V', 1938090: 'Call of Duty®', 1091500: 'Cyberpunk 2077', 292030: 'The Witcher 3', 379720: 'DOOM' }
  }
};

function fetchWithRedirects(targetUrl, customHeaders, maxRedirects, cb) {
  if (typeof customHeaders === 'function') {
    cb = customHeaders;
    customHeaders = {};
    maxRedirects = 5;
  }
  if (maxRedirects === undefined) maxRedirects = 5;
  if (maxRedirects <= 0) return cb(new Error('Demasiadas redirecciones'), null);

  try {
    const parsed = new URL(targetUrl);
    const clientLib = parsed.protocol === 'http:' ? http : https;
    const ageCookies = 'birthtime=631152001; mature_content=1; wants_mature_content=1; lastagecheckage=1-January-1990;';
    const combinedCookies = customHeaders['Cookie'] ? `${customHeaders['Cookie']}; ${ageCookies}` : ageCookies;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        ...customHeaders,
        'Cookie': combinedCookies
      }
    };

    clientLib.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let next = res.headers.location;
        if (!next.startsWith('http')) {
          next = parsed.protocol + '//' + parsed.hostname + next;
        }
        if (targetUrl.includes('xml=1') && !next.includes('xml=1')) {
          next += (next.includes('?') ? '&' : '?') + 'xml=1';
        }
        return fetchWithRedirects(next, customHeaders, maxRedirects - 1, cb);
      }

      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => cb(null, data, res.statusCode));
    }).on('error', (err) => cb(err, null));
  } catch (e) {
    cb(e, null);
  }
}

function sendDiscordWebhook(title, description, color, thumbUrl, cb) {
  if (!cfg.discordWebhook || !cfg.discordWebhook.includes('/api/webhooks/')) {
    if (cb) cb({ success: false, error: 'URL de Webhook inválida.' });
    return;
  }
  try {
    let targetUrl = cfg.discordWebhook
      .replace('https://discord.com', 'https://webhook.lewisakura.moe')
      .replace('https://discordapp.com', 'https://webhook.lewisakura.moe');

    const embed = {
      title: title,
      description: description,
      color: color || 3718648,
      footer: { text: 'Steam Hour Booster Pro • Achievement Engine' },
      timestamp: new Date().toISOString()
    };
    if (thumbUrl) embed.thumbnail = { url: thumbUrl };

    const payload = JSON.stringify({
      username: 'Steam Booster Enterprise',
      avatar_url: 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png',
      embeds: [embed]
    });

    const parsed = new URL(targetUrl);
    const req = https.request(parsed, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'SteamBoosterBot/1.0'
      }
    }, (res) => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (cb) cb({ success: true });
        } else {
          if (cb) cb({ success: false, error: 'Discord error ' + res.statusCode + ': ' + resBody });
        }
      });
    });
    req.on('error', (err) => { if (cb) cb({ success: false, error: err.message }); });
    req.write(payload);
    req.end();
  } catch (err) {
    if (cb) cb({ success: false, error: err.message });
  }
}

const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] Conectado a Steam');
  if (client.steamID) {
    mySteamID = client.steamID.getSteamID64();
    cfg.mySteamID = mySteamID;
    guardarConfig();
  }
  client.setPersona(cfg.personaState);
  try { client.webLogOn(); } catch (e) {}
  resolverNombresFaltantes();
  actualizarFarmeo();
  sendDiscordWebhook('🟢 Bot Conectado', 'Farmeando ' + cfg.games.length + ' juegos con motor de logros activo.', 1095985);
});

client.on('webSession', (sessionID, cookies) => {
  webCookies = cookies.join('; ');
  if (cfg.cardFarming) escanearCromos();
});

client.on('error', (e) => console.error('Error Steam:', e.message));

client.on('playingElsewhere', () => {
  console.log('[⚠️ Anti-Colisión] Detectada sesión de juego en PC. Pausando bot...');
  isCollisionPaused = true;
  actualizarFarmeo();
  sendDiscordWebhook('🎮 Partida Detectada en PC', 'Has iniciado un juego en tu PC. Bot pausado automáticamente.', 16101915);

  if (collisionTimer) clearTimeout(collisionTimer);
  collisionTimer = setTimeout(() => {
    console.log('[Anti-Colisión] Reanudando farmeo...');
    isCollisionPaused = false;
    actualizarFarmeo();
    sendDiscordWebhook('🔄 Farmeo Reanudado', 'Sesión en PC finalizada. Bot activo nuevamente en la nube.', 1095985);
  }, 10 * 60 * 1000);
});

client.on('friendMessage', (steamID, message) => {
  const msg = message.trim().toLowerCase();
  const args = msg.split(' ');
  const cmd = args[0];

  function reply(text) { try { client.chatMessage(steamID, text); } catch (e) {} }

  if (cmd === '!status' || cmd === '!estado') {
    const estado = isPaused ? 'Pausado' : (isCollisionPaused ? 'Pausado por juego en PC' : 'Activo');
    reply(`📊 Estado: ${estado} | Juegos: ${cfg.games.length}/32 | Logros en cola: ${cfg.achievementQueue.length}`);
  } else if (cmd === '!pausa' || cmd === '!pause') {
    isPaused = true;
    actualizarFarmeo();
    reply('⏸️ Farmeo pausado.');
  } else if (cmd === '!reanudar' || cmd === '!resume' || cmd === '!play') {
    isPaused = false;
    actualizarFarmeo();
    reply('▶️ Farmeo reanudado.');
  } else if (cmd === '!help' || cmd === '!ayuda') {
    reply('🤖 Comandos: !status, !pausa, !reanudar, !invisible, !online');
  }
});

setInterval(() => {
  if (!cfg.achievementQueue || cfg.achievementQueue.length === 0) return;
  const now = Date.now();
  const nextItem = cfg.achievementQueue[0];

  if (now >= nextItem.scheduledTime) {
    const item = cfg.achievementQueue.shift();
    cfg.unlockedAchievements[item.appid] = cfg.unlockedAchievements[item.appid] || [];
    if (!cfg.unlockedAchievements[item.appid].includes(item.apiname)) {
      cfg.unlockedAchievements[item.appid].push(item.apiname);
    }

    sendDiscordWebhook(
      `🏆 ¡Logro Registrado! • ${item.gameName}`,
      `**${item.name}**\n*${item.desc || 'Sin descripción'}*\n\n🌟 **Rareza:** ${item.tier} (${item.percent}% global)`,
      item.color,
      item.icon
    );

    if (cfg.achievementQueue.length > 0) {
      const nextDelayMinutes = Math.floor(Math.random() * (85 - 45 + 1)) + 45;
      cfg.achievementQueue[0].scheduledTime = Date.now() + (nextDelayMinutes * 60 * 1000);
    }

    guardarConfig();
  }
}, 30 * 1000);

function escanearCromos(cb) {
  if (!webCookies) { if (cb) cb([]); return; }
  const opts = {
    hostname: 'steamcommunity.com',
    path: '/my/badges/',
    method: 'GET',
    headers: { 'Cookie': webCookies, 'User-Agent': 'Mozilla/5.0' }
  };
  https.get(opts, (res) => {
    let html = '';
    res.on('data', c => html += c);
    res.on('end', () => {
      const regex = /href="https:\/\/steamcommunity\.com\/my\/gamecards\/(\d+)\/"[\s\S]*?progress_info_bold">(\d+)\s+cromo/gi;
      const found = [];
      let match;
      while ((match = regex.exec(html)) !== null) {
        found.push({ appid: parseInt(match[1], 10), remaining: parseInt(match[2], 10) });
      }
      cardDropGames = found;
      if (cfg.cardFarming && found.length > 0) {
        cfg.games = found.slice(0, 32).map(x => x.appid);
        guardarConfig();
        actualizarFarmeo();
      }
      if (cb) cb(found);
    });
  }).on('error', () => { if (cb) cb([]); });
}

setInterval(() => {
  if (!cfg.sleepMode || !cfg.sleepMode.enabled) return;
  const hour = new Date().getHours();
  const inSleep = (cfg.sleepMode.start < cfg.sleepMode.end)
    ? (hour >= cfg.sleepMode.start && hour < cfg.sleepMode.end)
    : (hour >= cfg.sleepMode.start || hour < cfg.sleepMode.end);

  if (inSleep && !isSleepPaused) {
    isSleepPaused = true;
    client.gamesPlayed([]);
  } else if (!inSleep && isSleepPaused) {
    isSleepPaused = false;
    actualizarFarmeo();
  }
}, 60 * 1000);

function resolverNombresFaltantes() {
  cfg.games.forEach(id => {
    if (!cfg.gameNames[id]) {
      obtenerNombreSteam(id, (nombre) => {
        if (nombre) {
          cfg.gameNames[id] = nombre;
          guardarConfig();
        }
      });
    }
  });
}

function obtenerNombreSteam(appid, cb) {
  https.get('https://store.steampowered.com/api/appdetails?appids=' + appid + '&filters=basic&l=spanish', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json[appid] && json[appid].success) cb(json[appid].data.name);
        else cb(null);
      } catch { cb(null); }
    });
  }).on('error', () => cb(null));
}

function actualizarFarmeo() {
  if (!isPaused && !isCollisionPaused && !isSleepPaused && cfg.games.length > 0) {
    const list = [...cfg.games];
    if (cfg.customStatus && cfg.customStatus.trim() !== '') {
      list.push(cfg.customStatus.trim());
    }
    client.gamesPlayed(list);
    if (!isFarming) sessionStartTime = Date.now();
    isFarming = true;
  } else {
    client.gamesPlayed([]);
    isFarming = false;
  }
}

function guardarConfig() {
  try {
    fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  } catch (e) {}
}

function getTag(body, tag) {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(body);
  if (!match) return '';
  let content = match[1].trim();
  if (content.startsWith('<![CDATA[') && content.endsWith(']]>')) {
    content = content.substring(9, content.length - 3).trim();
  }
  return content;
}

function parseAchievementsFromXml(xmlData, percentMap, appid, unlockedLocally) {
  const achievements = [];
  const achRegex = /<achievement\b[^>]*\bclosed="(\d+)"[^>]*>([\s\S]*?)<\/achievement>/gi;
  let match;

  while ((match = achRegex.exec(xmlData)) !== null) {
    const closedOriginal = match[1] === '1';
    const body = match[2];
    const apiname = getTag(body, 'apiname');
    const pct = parseFloat(percentMap[apiname] || 50.0);
    const unlockTimestamp = parseInt(getTag(body, 'unlockTimestamp') || '0', 10);

    let tier = '⚪ Común';
    let colorHex = 0x94a3b8;
    if (pct < 5.0) { tier = '🟡 Mítico'; colorHex = 0xf59e0b; }
    else if (pct < 15.0) { tier = '🟣 Épico'; colorHex = 0xa855f7; }
    else if (pct < 40.0) { tier = '🔵 Raro'; colorHex = 0x38bdf8; }

    const isUnlocked = closedOriginal || unlockedLocally.includes(apiname);
    const inQueue = (cfg.achievementQueue || []).some(q => q.appid == appid && q.apiname === apiname);

    let unlockDateFormatted = null;
    if (unlockTimestamp > 0) {
      const d = new Date(unlockTimestamp * 1000);
      unlockDateFormatted = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    achievements.push({
      apiname: apiname,
      name: getTag(body, 'name') || apiname,
      description: getTag(body, 'description') || 'Logro de Steam',
      iconClosed: getTag(body, 'iconClosed'),
      iconOpen: getTag(body, 'iconOpen'),
      percent: pct,
      tier: tier,
      color: colorHex,
      unlocked: isUnlocked,
      unlockDate: unlockDateFormatted,
      unlockTimestamp: unlockTimestamp,
      inQueue: inQueue
    });
  }
  return achievements;
}

function parseAchievementsFromHtml(html, percentMap, unlockedLocally) {
  const list = [];
  const parts = html.split('<div class="achieveRow">');
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const imgM = /<img\b[^>]*src=["']([^"']+)["']/i.exec(block);
    const h3M = /<h3>([\s\S]*?)<\/h3>/i.exec(block);
    const h5M = /<h5>([\s\S]*?)<\/h5>/i.exec(block);
    const pctM = /<div\b[^>]*class=["'][^"']*achievePercent[^"']*["'][^>]*>\s*([0-9.]+)\s*%/i.exec(block);
    const dateM = /<div\b[^>]*class=["'][^"']*achieveUnlockTime[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block);

    if (h3M) {
      const name = h3M[1].replace(/<[^>]+>/g, '').trim();
      const desc = h5M ? h5M[1].replace(/<[^>]+>/g, '').trim() : '';
      const icon = imgM ? imgM[1] : '';
      const pct = pctM ? parseFloat(pctM[1]) : 50.0;
      const apiname = 'ACH_' + name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

      let tier = '⚪ Común';
      let colorHex = 0x94a3b8;
      if (pct < 5.0) { tier = '🟡 Mítico'; colorHex = 0xf59e0b; }
      else if (pct < 15.0) { tier = '🟣 Épico'; colorHex = 0xa855f7; }
      else if (pct < 40.0) { tier = '🔵 Raro'; colorHex = 0x38bdf8; }

      const rawDate = dateM ? dateM[1].replace(/<[^>]+>/g, '').replace(/Desbloqueado el\s*/i, '').trim() : null;
      const isUnlocked = Boolean(rawDate) || unlockedLocally.includes(apiname);

      list.push({
        apiname: apiname,
        name: name,
        description: desc || 'Logro de Steam',
        iconClosed: icon,
        iconOpen: icon,
        percent: pct,
        tier: tier,
        color: colorHex,
        unlocked: isUnlocked,
        unlockDate: rawDate,
        unlockTimestamp: 0,
        inQueue: false
      });
    }
  }
  return list;
}

// Extractor con memoria caché local
function obtenerLogrosJuego(appid, cb) {
  // 1. Si ya se cargaron antes, devolverlos directamente de la memoria caché
  if (achCache[appid] && achCache[appid].achievements && achCache[appid].achievements.length > 0) {
    const unlockedLocally = cfg.unlockedAchievements[appid] || [];
    const cachedList = achCache[appid].achievements.map(a => ({
      ...a,
      unlocked: a.unlocked || unlockedLocally.includes(a.apiname),
      inQueue: (cfg.achievementQueue || []).some(q => q.appid == appid && q.apiname === a.apiname)
    }));
    return cb({ achievements: cachedList, isPrivate: achCache[appid].isPrivate });
  }

  const urlGlobal = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appid}`;
  fetchWithRedirects(urlGlobal, {}, 3, (errG, globalData) => {
    let percentMap = {};
    try {
      const parsedG = JSON.parse(globalData);
      if (parsedG.achievementpercentages && parsedG.achievementpercentages.achievements) {
        parsedG.achievementpercentages.achievements.forEach(a => {
          percentMap[a.name] = parseFloat(a.percent).toFixed(1);
        });
      }
    } catch (e) {}

    const unlockedLocally = cfg.unlockedAchievements[appid] || [];
    const userSteamId = mySteamID || (client.steamID ? client.steamID.getSteamID64() : '');
    const xmlHeaders = webCookies ? { 'Cookie': webCookies } : {};

    const targetXmlUrl = userSteamId
      ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?xml=1`
      : `https://steamcommunity.com/my/stats/${appid}/?xml=1`;

    fetchWithRedirects(targetXmlUrl, xmlHeaders, 5, (errXml, xmlData) => {
      let isProfilePrivate = false;
      if (xmlData && (xmlData.includes('profile is private') || xmlData.includes('Specified profile could not be found') || xmlData.includes('<error>'))) {
        isProfilePrivate = true;
      }

      if (!errXml && xmlData && xmlData.includes('<achievement') && !isProfilePrivate) {
        const list = parseAchievementsFromXml(xmlData, percentMap, appid, unlockedLocally);
        if (list.length > 0) {
          achCache[appid] = { achievements: list, isPrivate: false };
          return cb(achCache[appid]);
        }
      }

      const targetUserHtml = userSteamId
        ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?tab=achievements&l=spanish`
        : `https://steamcommunity.com/my/stats/${appid}/?tab=achievements&l=spanish`;

      fetchWithRedirects(targetUserHtml, xmlHeaders, 5, (errUHtml, uHtmlData) => {
        if (uHtmlData && (uHtmlData.includes('profile_private') || uHtmlData.includes('Este perfil es privado') || uHtmlData.includes('This profile is private'))) {
          isProfilePrivate = true;
        }

        if (!errUHtml && uHtmlData && uHtmlData.includes('achieveRow') && !isProfilePrivate) {
          const listU = parseAchievementsFromHtml(uHtmlData, percentMap, unlockedLocally);
          if (listU.length > 0) {
            achCache[appid] = { achievements: listU, isPrivate: false };
            return cb(achCache[appid]);
          }
        }

        const urlGlobalHtml = `https://steamcommunity.com/stats/${appid}/achievements/?l=spanish`;
        fetchWithRedirects(urlGlobalHtml, {}, 5, (errHtml, htmlData) => {
          if (!errHtml && htmlData && htmlData.includes('achieveRow')) {
            const listG = parseAchievementsFromHtml(htmlData, percentMap, unlockedLocally);
            if (listG.length > 0) {
              achCache[appid] = { achievements: listG, isPrivate: isProfilePrivate };
              return cb(achCache[appid]);
            }
          }
          cb({ achievements: [], isPrivate: isProfilePrivate });
        });
      });
    });
  });
}

const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      name: 'Steam Booster Enterprise',
      short_name: 'SteamBooster',
      start_url: '/',
      display: 'standalone',
      background_color: '#070a13',
      theme_color: '#070a13',
      icons: [{ src: 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png', sizes: '512x512', type: 'image/png' }]
    }));
  }

  if (parsedUrl.pathname === '/api/search' && req.method === 'GET') {
    const query = parsedUrl.query.term;
    if (!query) return res.end('[]');

    https.get('https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(query) + '&l=spanish&cc=US', (sRes) => {
      let data = '';
      sRes.on('data', chunk => data += chunk);
      sRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).slice(0, 6).map(it => ({ id: it.id, name: it.name, img: it.tiny_image }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        } catch { res.end('[]'); }
      });
    }).on('error', () => res.end('[]'));
    return;
  }

  if (parsedUrl.pathname === '/api/achievements' && req.method === 'GET') {
    const appid = parseInt(parsedUrl.query.appid, 10);
    if (!appid) return res.end(JSON.stringify({ achievements: [], isPrivate: false }));

    obtenerLogrosJuego(appid, (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const nextItem = (cfg.achievementQueue && cfg.achievementQueue.length > 0) ? cfg.achievementQueue[0] : null;
    return res.end(JSON.stringify({
      user: cfg.user,
      games: cfg.games,
      gameNames: cfg.gameNames,
      isFarming: isFarming,
      isPaused: isPaused,
      isCollisionPaused: isCollisionPaused,
      isSleepPaused: isSleepPaused,
      cardFarming: cfg.cardFarming,
      cardDropCount: cardDropGames.length,
      queueCount: cfg.achievementQueue.length,
      nextAchievementIn: nextItem ? Math.max(0, Math.round((nextItem.scheduledTime - Date.now()) / 60000)) : null,
      sleepMode: cfg.sleepMode,
      customStatus: cfg.customStatus || '',
      discordWebhook: cfg.discordWebhook || '',
      personaState: cfg.personaState,
      sessionStartTime: isFarming ? sessionStartTime : null,
      presets: Object.keys(PRESETS).map(k => ({ key: k, name: PRESETS[k].name, count: PRESETS[k].games.length }))
    }));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');

        if (cfg.webPin && String(data.pin) !== String(cfg.webPin)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'PIN incorrecto' }));
        }

        if (parsedUrl.pathname === '/api/verify-pin') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/add') {
          const appid = parseInt(data.appid, 10);
          if (appid && !cfg.games.includes(appid)) {
            if (cfg.games.length >= 32) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Límite de 32 juegos alcanzado' }));
            }
            cfg.games.push(appid);
            if (data.name) {
              cfg.gameNames[appid] = data.name;
              guardarConfig();
              actualizarFarmeo();
            } else {
              obtenerNombreSteam(appid, (nombre) => {
                if (nombre) cfg.gameNames[appid] = nombre;
                guardarConfig();
                actualizarFarmeo();
              });
            }
          }
        }

        if (parsedUrl.pathname === '/api/remove') {
          const appid = parseInt(data.appid, 10);
          cfg.games = cfg.games.filter(id => id !== appid);
          delete cfg.gameNames[appid];
          guardarConfig();
          actualizarFarmeo();
        }

        if (parsedUrl.pathname === '/api/clear-all') {
          cfg.games = [];
          cfg.gameNames = {};
          guardarConfig();
          actualizarFarmeo();
        }

        if (parsedUrl.pathname === '/api/apply-preset') {
          const preset = PRESETS[data.presetKey];
          if (preset) {
            preset.games.forEach(gid => {
              if (!cfg.games.includes(gid) && cfg.games.length < 32) {
                cfg.games.push(gid);
                cfg.gameNames[gid] = preset.names[gid] || ('Juego #' + gid);
              }
            });
            guardarConfig();
            actualizarFarmeo();
          }
        }

        if (parsedUrl.pathname === '/api/toggle') {
          isPaused = !isPaused;
          actualizarFarmeo();
        }

        if (parsedUrl.pathname === '/api/persona') {
          cfg.personaState = (cfg.personaState === SteamUser.EPersonaState.Invisible) 
            ? SteamUser.EPersonaState.Online 
            : SteamUser.EPersonaState.Invisible;
          client.setPersona(cfg.personaState);
          guardarConfig();
        }

        if (parsedUrl.pathname === '/api/custom-status') {
          cfg.customStatus = (data.status || '').trim();
          guardarConfig();
          actualizarFarmeo();
        }

        if (parsedUrl.pathname === '/api/set-webhook') {
          cfg.discordWebhook = (data.webhook || '').trim();
          guardarConfig();
          sendDiscordWebhook('🔔 Webhook Vinculado', '¡Canal de Discord conectado con éxito!', 3718648, null, (result) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          });
          return;
        }

        if (parsedUrl.pathname === '/api/unlock-batch') {
          const { appid, gameName, items } = data;
          cfg.unlockedAchievements[appid] = cfg.unlockedAchievements[appid] || [];
          
          items.forEach(it => {
            if (!cfg.unlockedAchievements[appid].includes(it.apiname)) {
              cfg.unlockedAchievements[appid].push(it.apiname);
            }
          });
          guardarConfig();

          if (items.length === 1) {
            const it = items[0];
            sendDiscordWebhook(
              `🏆 ¡Logro Registrado! • ${gameName}`,
              `**${it.name}**\n*${it.desc || 'Sin descripción'}*\n\n🌟 **Rareza:** ${it.tier} (${it.percent}% global)`,
              it.color || 3718648,
              it.icon
            );
          } else {
            sendDiscordWebhook(
              `🏆 Registro de Logros • ${gameName}`,
              `Se han marcado **${items.length} logros** en el panel.`,
              3718648
            );
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/lock-batch') {
          const { appid, apinames } = data;
          if (cfg.unlockedAchievements[appid]) {
            cfg.unlockedAchievements[appid] = cfg.unlockedAchievements[appid].filter(id => !apinames.includes(id));
          }
          cfg.achievementQueue = cfg.achievementQueue.filter(q => !(q.appid == appid && apinames.includes(q.apiname)));
          guardarConfig();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/queue-achievements') {
          const { appid, gameName, items } = data;
          let baseDelay = 5;
          items.forEach(it => {
            const alreadyQueued = cfg.achievementQueue.some(q => q.appid == appid && q.apiname === it.apiname);
            if (!alreadyQueued) {
              const delayMin = baseDelay;
              cfg.achievementQueue.push({
                appid: appid,
                gameName: gameName,
                apiname: it.apiname,
                name: it.name,
                desc: it.description,
                icon: it.iconOpen || it.iconClosed,
                percent: it.percent,
                tier: it.tier,
                color: it.color,
                scheduledTime: Date.now() + (delayMin * 60 * 1000)
              });
              baseDelay += Math.floor(Math.random() * (85 - 45 + 1)) + 45;
            }
          });
          guardarConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, count: items.length }));
        }

        if (parsedUrl.pathname === '/api/clear-queue') {
          cfg.achievementQueue = [];
          guardarConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/toggle-cards') {
          cfg.cardFarming = !cfg.cardFarming;
          guardarConfig();
          if (cfg.cardFarming) escanearCromos(() => actualizarFarmeo());
          else actualizarFarmeo();
        }

        if (parsedUrl.pathname === '/api/claim-free') {
          const freePackages = [730, 440, 570, 230410, 1172470];
          client.requestFreeLicense(freePackages, (err, grantedApps) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, granted: grantedApps ? grantedApps.length : 0 }));
          });
          return;
        }

        if (parsedUrl.pathname === '/api/set-sleep') {
          cfg.sleepMode = {
            enabled: Boolean(data.enabled),
            start: parseInt(data.start || 3, 10),
            end: parseInt(data.end || 8, 10)
          };
          guardarConfig();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, games: cfg.games, isPaused }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Steam Hour Booster Pro</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#070a13">
  <link rel="apple-touch-icon" href="https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070a13;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #f43f5e;
      --purple: #a855f7;
      --gold: #f59e0b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    body {
      background: radial-gradient(circle at 50% 0%, #172033 0%, var(--bg) 75%);
      color: var(--text);
      min-height: 100vh;
      padding: 30px 16px;
      display: flex;
      justify-content: center;
    }
    .container { width: 100%; max-width: 1020px; }

    .modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(7, 10, 19, 0.95);
      backdrop-filter: blur(20px);
      display: none; align-items: center; justify-content: center; z-index: 1000;
    }
    .lock-card {
      background: #111827; border: 1px solid var(--card-border);
      padding: 36px 30px; border-radius: 20px; text-align: center; max-width: 350px; width: 90%;
      box-shadow: 0 20px 45px rgba(0,0,0,0.8);
    }
    .lock-card input {
      width: 100%; padding: 13px; border-radius: 12px; background: #0b0f19;
      border: 1px solid var(--card-border); color: #fff; font-size: 1.3rem;
      text-align: center; letter-spacing: 5px; outline: none; margin: 16px 0;
    }

    .ach-modal-card {
      background: #0d1322; border: 1px solid rgba(56, 189, 248, 0.25);
      width: 96%; max-width: 940px; max-height: 92vh; border-radius: 22px;
      display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 65px rgba(0,0,0,0.95);
    }
    .ach-header {
      padding: 18px 24px; background: #131b2e; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
    }
    .ach-header-left h2 { font-size: 1.35rem; font-weight: 800; color: #fff; }
    .ach-progress-bar-wrap { width: 220px; height: 8px; background: rgba(0,0,0,0.4); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); margin-top: 6px; }
    .ach-progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), var(--success)); transition: width 0.3s ease; }
    
    .privacy-banner {
      background: rgba(245, 158, 11, 0.12); border-bottom: 1px solid rgba(245, 158, 11, 0.3);
      padding: 12px 24px; display: none; color: #fde68a; font-size: 0.85rem; line-height: 1.4;
    }
    .privacy-banner strong { color: #fff; }

    .ach-toolbar {
      padding: 12px 24px; background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
    }
    .ach-filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .filter-btn {
      background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border);
      color: var(--text-muted); padding: 5px 12px; border-radius: 8px; font-size: 0.75rem;
      font-weight: 700; cursor: pointer; transition: 0.15s;
    }
    .filter-btn.active, .filter-btn:hover { background: rgba(56, 189, 248, 0.15); border-color: var(--primary); color: #fff; }

    .ach-batch-actions {
      padding: 10px 24px; background: rgba(15, 23, 42, 0.75); border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 0.85rem;
    }
    .ach-batch-btns { display: flex; gap: 8px; flex-wrap: wrap; }

    .ach-list { padding: 16px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .ach-item {
      background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border);
      border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 14px;
      transition: all 0.2s; user-select: none;
    }
    .ach-item.unlocked-item { background: rgba(16, 185, 129, 0.04); border-color: rgba(16, 185, 129, 0.25); }
    .ach-item.selected { background: rgba(56, 189, 248, 0.09); border-color: rgba(56, 189, 248, 0.45); }
    .ach-item.gold { border-left: 4px solid var(--gold); }
    .ach-item.purple { border-left: 4px solid var(--purple); }
    .ach-item.blue { border-left: 4px solid var(--primary); }
    .ach-item.gray { border-left: 4px solid #64748b; }

    .ach-checkbox { width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary); }
    .ach-item img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: #000; flex-shrink: 0; }
    .ach-item.locked-item img { filter: grayscale(100%) brightness(0.65); }
    .ach-info { flex: 1; overflow: hidden; }
    .ach-title { font-weight: 700; font-size: 0.95rem; color: #fff; display: flex; align-items: center; gap: 8px; }
    .ach-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 3px; }
    .ach-badge { font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; }

    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
    .brand h1 { font-size: 1.6rem; font-weight: 800; background: linear-gradient(135deg, #fff 40%, var(--primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand p { font-size: 0.85rem; color: var(--text-muted); }
    .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

    .badge-status { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25); }
    .badge-status.paused { background: rgba(244, 63, 94, 0.12); color: var(--danger); border-color: rgba(244, 63, 94, 0.25); }
    .badge-status.collision { background: rgba(245, 158, 11, 0.15); color: var(--warning); border-color: rgba(245, 158, 11, 0.3); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

    .btn-action-sm { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border); color: #cbd5e1; padding: 7px 13px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-action-sm:hover { border-color: var(--primary); color: #fff; }

    .dashboard-panel { background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(14px); border-radius: 16px; padding: 18px 22px; margin-bottom: 22px; display: flex; flex-direction: column; gap: 16px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
    .stat-item { background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.04); padding: 12px 16px; border-radius: 12px; }
    .stat-item label { display: block; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .stat-item value { font-size: 1.15rem; font-weight: 800; color: #fff; }

    .capacity-header { display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 7px; }
    .progress-bar-bg { width: 100%; height: 8px; background: rgba(0, 0, 0, 0.4); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05); }
    .progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), #818cf8); transition: width 0.4s ease; }

    .controls { background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(14px); border-radius: 16px; padding: 20px; margin-bottom: 26px; display: flex; flex-direction: column; gap: 16px; }
    .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .search-box-wrapper { position: relative; flex: 1; min-width: 220px; }
    input[type="text"], input[type="password"], input[type="number"], select { width: 100%; background: rgba(7, 10, 19, 0.6); border: 1px solid var(--card-border); border-radius: 10px; color: #fff; padding: 12px 16px; font-size: 0.95rem; outline: none; }
    input:focus, select:focus { border-color: var(--primary); }

    button { padding: 12px 20px; border-radius: 10px; font-weight: 700; font-size: 0.9rem; border: none; cursor: pointer; transition: all 0.2s; }
    .btn-main { background: var(--primary); color: #04111d; }
    .btn-main:hover { background: var(--primary-hover); }
    .btn-pause { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .btn-clear { background: rgba(244, 63, 94, 0.1); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.2); }
    .btn-clear:hover { background: var(--danger); color: #fff; }
    .btn-purple { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.3); }
    .btn-purple:hover { background: var(--purple); color: #fff; }
    .btn-gold { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .btn-gold:hover { background: var(--gold); color: #000; }

    .tools-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .tool-box { background: rgba(0, 0, 0, 0.2); padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.04); display: flex; gap: 10px; align-items: center; }
    .tool-box input { padding: 8px 12px; font-size: 0.85rem; }

    .presets-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .chip { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--card-border); color: #cbd5e1; padding: 6px 14px; border-radius: 8px; font-size: 0.8rem; cursor: pointer; font-weight: 600; }
    .chip:hover { border-color: var(--primary); color: var(--primary); background: rgba(56, 189, 248, 0.08); }

    .search-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: #0f1626; border: 1px solid var(--card-border); border-radius: 12px; box-shadow: 0 16px 35px rgba(0,0,0,0.6); max-height: 280px; overflow-y: auto; z-index: 100; display: none; }
    .search-item { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .search-item:hover { background: rgba(56, 189, 248, 0.1); }
    .search-item img { width: 52px; height: 24px; object-fit: cover; border-radius: 4px; }
    .search-info { flex: 1; font-size: 0.85rem; font-weight: 600; }
    .search-info span { display: block; font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; backdrop-filter: blur(10px); transition: all 0.25s ease; }
    .card:hover { transform: translateY(-4px); border-color: rgba(56, 189, 248, 0.3); }
    .card-banner { width: 100%; aspect-ratio: 460/215; object-fit: cover; background: #0c1220; }
    .card-content { padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .card-title { font-size: 0.9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
    .card-appid { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
    .card-btn-row { display: flex; gap: 6px; }
    .btn-card { padding: 6px 11px; font-size: 0.75rem; border-radius: 7px; font-weight: 700; }
    .btn-remove { background: rgba(244, 63, 94, 0.12); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.25); }
    .btn-remove:hover { background: var(--danger); color: #fff; }
    .btn-ach { background: rgba(56, 189, 248, 0.12); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.25); }
    .btn-ach:hover { background: var(--primary); color: #04111d; }
  </style>
</head>
<body>
  <div id="lockModal" class="modal-overlay">
    <div class="lock-card">
      <h2>🔒 Panel Enterprise</h2>
      <p>Introduce tu PIN para acceder al bot</p>
      <input type="password" id="pinInput" placeholder="••••" maxlength="8">
      <button class="btn-main" style="width:100%;" onclick="unlock()">Desbloquear</button>
    </div>
  </div>

  <div id="achModal" class="modal-overlay">
    <div class="ach-modal-card">
      <div class="ach-header">
        <div class="ach-header-left">
          <h2 id="achGameTitle">Logros de Steam</h2>
          <div style="display:flex; align-items:center; gap:12px; margin-top:4px;">
            <span id="achProgressText" style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">Cargando...</span>
            <div class="ach-progress-bar-wrap">
              <div class="ach-progress-bar-fill" id="achProgressFill"></div>
            </div>
          </div>
        </div>
        <button class="btn-action-sm" onclick="closeAchModal()">✕ Cerrar</button>
      </div>

      <div class="privacy-banner" id="achPrivacyWarning">
        ⚠️ <strong>Aviso de Privacidad:</strong> Tus <em>«Detalles de los juegos»</em> están configurados en <strong>Privado</strong> o <em>Solo amigos</em> en Steam. El bot muestra el catálogo general, pero Steam no permite leer qué logros tienes conseguidos hasta que cambies esa opción a <strong>Público</strong> en tu perfil de Steam.
      </div>

      <div class="ach-toolbar">
        <div class="ach-filters">
          <button class="filter-btn active" onclick="setFilter('status', 'all')">Todos</button>
          <button class="filter-btn" onclick="setFilter('status', 'unlocked')">✓ Conseguidos</button>
          <button class="filter-btn" onclick="setFilter('status', 'locked')">🔒 Bloqueados</button>
          <button class="filter-btn" onclick="setFilter('status', 'queue')">⏳ En Cola</button>
          <span style="color:rgba(255,255,255,0.2);">|</span>
          <button class="filter-btn" onclick="setFilter('rarity', 'mythic')">🟡 Míticos (&lt;5%)</button>
          <button class="filter-btn" onclick="setFilter('rarity', 'epic')">🟣 Épicos (5-15%)</button>
          <button class="filter-btn" onclick="setFilter('rarity', 'rare')">🔵 Raros (15-40%)</button>
        </div>
        
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="achSortSelect" onchange="setSort(this.value)" style="padding:6px 10px; font-size:0.8rem; border-radius:8px; background:#131b2e; border:1px solid var(--card-border); color:#fff;">
            <option value="default">Orden: Predeterminado</option>
            <option value="locked_first">Bloqueados primero</option>
            <option value="unlocked_first">Conseguidos primero</option>
            <option value="rarity_rare">Más raros primero</option>
            <option value="rarity_common">Más comunes primero</option>
            <option value="alpha">Alfabético (A-Z)</option>
          </select>
          <input type="text" id="achSearchInput" placeholder="Buscar logro..." style="max-width:180px; padding:6px 12px; font-size:0.8rem;" oninput="applyFilters()">
        </div>
      </div>

      <div class="ach-batch-actions">
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)" style="width:16px; height:16px; accent-color:var(--primary);">
          <span id="selectedCountText" style="font-weight:700;">0 seleccionados</span>
          <span id="estimatedTimeText" style="color:var(--gold); font-size:0.8rem; margin-left:8px;"></span>
        </div>
        <div class="ach-batch-btns">
          <button class="btn-main" style="padding:6px 12px; font-size:0.75rem;" onclick="unlockSelected()">⚡ Desbloquear</button>
          <button class="btn-gold" style="padding:6px 12px; font-size:0.75rem;" onclick="queueSelectedOrganic()">⏳ Encolar Orgánico</button>
          <button class="btn-clear" style="padding:6px 12px; font-size:0.75rem;" onclick="lockSelected()">🔒 Bloquear</button>
        </div>
      </div>

      <div class="ach-list" id="achListContainer"></div>
    </div>
  </div>

  <div class="container">
    <header>
      <div class="brand">
        <h1>Steam Hour Booster Pro</h1>
        <p id="userLabel">Conectando cuenta...</p>
      </div>
      <div class="header-actions">
        <button class="btn-purple" id="cardsBtn" onclick="toggleCards()">🃏 Modo Cromos: Off</button>
        <button class="btn-action-sm" onclick="claimFreeGames()">🎁 Reclamar Free</button>
        <button class="btn-action-sm" id="personaBtn" onclick="togglePersona()">Modo: Invisible</button>
        <button class="btn-action-sm" onclick="lock()">🔒 Bloquear</button>
        <div class="badge-status" id="badgeStatus"><span class="dot"></span> <span id="statusText">Activo</span></div>
      </div>
    </header>

    <div class="dashboard-panel">
      <div class="stats-row">
        <div class="stat-item">
          <label>⏱️ Tiempo en Sesión</label>
          <value id="timerVal">00h 00m 00s</value>
        </div>
        <div class="stat-item">
          <label>⚡ Horas Totales Sumadas</label>
          <value id="hoursVal">+0.0 hrs</value>
        </div>
        <div class="stat-item">
          <label>🎯 Juegos en Paralelo</label>
          <value id="gamesCountVal">0 / 32</value>
        </div>
        <div class="stat-item">
          <label>🏆 Cola de Logros</label>
          <value id="achQueueVal">0 en espera</value>
        </div>
      </div>
      <div>
        <div class="capacity-header">
          <span>Capacidad de Farmeo (Máximo 32 juegos)</span>
          <span id="capacityPercent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="capacityFill"></div>
        </div>
      </div>
    </div>

    <div class="controls">
      <div class="input-row">
        <div class="search-box-wrapper">
          <input type="text" id="searchInput" placeholder="Escribe el nombre del juego o AppID..." autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
        <button class="btn-main" onclick="addFromInput()">+ Agregar</button>
        <button class="btn-pause" id="pauseBtn" onclick="togglePause()">Pausar</button>
        <button class="btn-clear" onclick="clearAll()">Vaciar Todo</button>
      </div>

      <div class="presets-row" id="presetsContainer">
        <span style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Cargar Preset:</span>
      </div>

      <div class="tools-grid">
        <div class="tool-box">
          <span style="font-size:0.8rem; font-weight:700; color:var(--text-muted); white-space:nowrap;">Texto en Perfil:</span>
          <input type="text" id="customStatusInput" placeholder="Ej: AFK 24/7">
          <button class="btn-main" style="padding:8px 14px; font-size:0.8rem;" onclick="saveCustomStatus()">Guardar</button>
        </div>
        <div class="tool-box">
          <span style="font-size:0.8rem; font-weight:700; color:var(--text-muted); white-space:nowrap;">Discord Webhook:</span>
          <input type="text" id="webhookInput" placeholder="https://discord.com/api/webhooks/...">
          <button class="btn-main" style="padding:8px 14px; font-size:0.8rem;" onclick="saveWebhook()">Probar</button>
        </div>
      </div>

      <div class="tools-grid">
        <div class="tool-box" style="justify-content:space-between;">
          <span style="font-size:0.8rem; font-weight:700; color:var(--text-muted);">💤 Horario Sueño:</span>
          <label style="font-size:0.8rem; display:flex; align-items:center; gap:6px;">
            <input type="checkbox" id="sleepEnabled"> Activo
          </label>
          <input type="number" id="sleepStart" placeholder="Desde (03)" style="width:70px;" min="0" max="23">
          <input type="number" id="sleepEnd" placeholder="Hasta (08)" style="width:70px;" min="0" max="23">
          <button class="btn-main" style="padding:8px 14px; font-size:0.8rem;" onclick="saveSleep()">Fijar</button>
        </div>
        <div class="tool-box" style="color:var(--text-muted); font-size:0.8rem;">
          <span>💬 <strong>Chat Steam Activo:</strong> Escribe <code>!status</code> desde otra cuenta para control por mensaje.</span>
        </div>
      </div>
    </div>

    <div class="grid" id="gamesGrid"></div>
  </div>

  <script>
    var savedPin = localStorage.getItem('farmer_pin');
    var sessionStart = null;
    var activeGamesCount = 0;
    var namesCache = {};
    var currentAchList = [];
    var currentAchAppId = null;
    var currentAchGameName = '';
    var selectedApinames = new Set();
    var filterStatus = 'all';
    var filterRarity = 'all';
    var currentSort = 'default';

    function checkAuth() {
      if (!savedPin) {
        document.getElementById('lockModal').style.display = 'flex';
        document.getElementById('pinInput').focus();
      } else {
        document.getElementById('lockModal').style.display = 'none';
        loadStatus();
      }
    }

    async function unlock() {
      var pin = document.getElementById('pinInput').value.trim();
      if (!pin) return;
      var res = await fetch('/api/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin }) });
      if (res.ok) {
        savedPin = pin;
        localStorage.setItem('farmer_pin', pin);
        document.getElementById('lockModal').style.display = 'none';
        loadStatus();
      } else { alert('PIN incorrecto.'); }
    }

    function lock() {
      localStorage.removeItem('farmer_pin');
      savedPin = null;
      document.getElementById('pinInput').value = '';
      document.getElementById('lockModal').style.display = 'flex';
    }

    setInterval(function() {
      if (!sessionStart || activeGamesCount === 0) return;
      var s = Math.floor((Date.now() - sessionStart) / 1000);
      var h = String(Math.floor(s / 3600)).padStart(2, '0');
      var m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      var sec = String(s % 60).padStart(2, '0');
      document.getElementById('timerVal').innerText = h + 'h ' + m + 'm ' + sec + 's';
      document.getElementById('hoursVal').innerText = '+' + ((s / 3600) * activeGamesCount).toFixed(1) + ' hrs';
    }, 1000);

    async function loadStatus() {
      try {
        var res = await fetch('/api/status');
        var data = await res.json();

        document.getElementById('userLabel').innerText = 'Cuenta: ' + data.user;
        activeGamesCount = (data.isPaused || data.isCollisionPaused || data.isSleepPaused) ? 0 : data.games.length;
        sessionStart = data.sessionStartTime;
        namesCache = data.gameNames || {};

        document.getElementById('gamesCountVal').innerText = data.games.length + ' / 32';
        document.getElementById('achQueueVal').innerText = data.queueCount + (data.nextAchievementIn !== null ? ' (~' + data.nextAchievementIn + 'm)' : ' en cola');
        var percent = Math.round((data.games.length / 32) * 100);
        document.getElementById('capacityPercent').innerText = percent + '%';
        document.getElementById('capacityFill').style.width = percent + '%';

        var badge = document.getElementById('badgeStatus');
        var statusText = document.getElementById('statusText');
        var pauseBtn = document.getElementById('pauseBtn');
        var personaBtn = document.getElementById('personaBtn');
        var cardsBtn = document.getElementById('cardsBtn');

        if (data.isCollisionPaused) {
          badge.className = 'badge-status collision';
          statusText.innerText = 'PC en Juego (Auto-Pausa)';
          pauseBtn.innerText = 'Pausado';
        } else if (data.isSleepPaused) {
          badge.className = 'badge-status sleep';
          statusText.innerText = 'Modo Sueño (Noche)';
          pauseBtn.innerText = 'Pausado';
        } else if (data.isPaused) {
          badge.className = 'badge-status paused';
          statusText.innerText = 'En Pausa';
          pauseBtn.innerText = 'Reanudar';
        } else {
          badge.className = 'badge-status';
          statusText.innerText = 'Farmeando';
          pauseBtn.innerText = 'Pausar';
        }

        personaBtn.innerText = (data.personaState === 7) ? '👻 Modo: Invisible' : '🟢 Modo: En Línea';
        cardsBtn.innerText = data.cardFarming ? '🃏 Modo Cromos: ACTIVO' : '🃏 Modo Cromos: Off';

        if (data.customStatus && !document.getElementById('customStatusInput').value) document.getElementById('customStatusInput').value = data.customStatus;
        if (data.discordWebhook && !document.getElementById('webhookInput').value) document.getElementById('webhookInput').value = data.discordWebhook;
        if (data.sleepMode) {
          document.getElementById('sleepEnabled').checked = data.sleepMode.enabled;
          document.getElementById('sleepStart').value = data.sleepMode.start;
          document.getElementById('sleepEnd').value = data.sleepMode.end;
        }

        renderPresets(data.presets);
        renderGames(data.games);
      } catch (e) { console.error(e); }
    }

    function renderPresets(presets) {
      var container = document.getElementById('presetsContainer');
      container.innerHTML = '<span style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Cargar Preset:</span>';
      (presets || []).forEach(function(p) {
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerText = p.name + ' (' + p.count + ')';
        chip.onclick = function() { applyPreset(p.key); };
        container.appendChild(chip);
      });
    }

    function renderGames(games) {
      var grid = document.getElementById('gamesGrid');
      grid.innerHTML = '';
      if (!games.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:var(--text-muted);">No tienes juegos agregados.</div>';
        return;
      }

      games.forEach(function(id) {
        var title = namesCache[id] || ('Juego #' + id);
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = 
          '<img class="card-banner" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + id + '/header.jpg" onerror="this.src=\\'https://placehold.co/460x215/0c1220/white?text=AppID+' + id + '\\'">' +
          '<div class="card-content">' +
            '<div>' +
              '<div class="card-title" title="' + title.replace(/"/g, '&quot;') + '">' + title + '</div>' +
              '<div class="card-appid">AppID: ' + id + '</div>' +
            '</div>' +
            '<div class="card-btn-row">' +
              '<button class="btn-card btn-ach" onclick="openAchModal(' + id + ', \\'' + title.replace(/'/g, "\\\\'") + '\\')">🏆 Logros</button>' +
              '<button class="btn-card btn-remove" onclick="removeGame(' + id + ')">Quitar</button>' +
            '</div>' +
          '</div>';
        grid.appendChild(card);
      });
    }

    async function openAchModal(appid, title) {
      currentAchAppId = appid;
      currentAchGameName = title;
      selectedApinames.clear();
      filterStatus = 'all';
      filterRarity = 'all';
      currentSort = 'default';
      document.getElementById('achSortSelect').value = 'default';
      document.getElementById('achGameTitle').innerText = title;
      document.getElementById('achProgressText').innerText = 'Consultando base de datos de Steam...';
      document.getElementById('achProgressFill').style.width = '0%';
      document.getElementById('achPrivacyWarning').style.display = 'none';
      document.getElementById('achListContainer').innerHTML = '<p style="text-align:center; padding:40px; color:var(--text-muted);">Cargando catálogo de trofeos y verificando privacidad...</p>';
      document.getElementById('achModal').style.display = 'flex';
      updateBatchToolbar();

      try {
        var res = await fetch('/api/achievements?appid=' + appid);
        var data = await res.json();
        
        currentAchList = Array.isArray(data) ? data : (data.achievements || []);
        var isPrivate = data.isPrivate || false;

        document.getElementById('achPrivacyWarning').style.display = isPrivate ? 'block' : 'none';
        renderAchModal();
      } catch (e) {
        document.getElementById('achProgressText').innerText = 'Error al cargar';
        document.getElementById('achListContainer').innerHTML = '<p style="text-align:center; color:var(--danger);">Error al consultar logros en Steam.</p>';
      }
    }

    function closeAchModal() { document.getElementById('achModal').style.display = 'none'; }

    function setFilter(type, val) {
      if (type === 'status') filterStatus = val;
      if (type === 'rarity') filterRarity = val;
      
      document.querySelectorAll('.filter-btn').forEach(b => {
        var txt = b.innerText.toLowerCase();
        if (val === 'all' && txt === 'todos') b.classList.add('active');
        else if (val !== 'all' && txt.includes(val)) b.classList.add('active');
        else if (type === 'status' && (txt === 'todos' || txt.includes('conseguidos') || txt.includes('bloqueados') || txt.includes('cola'))) b.classList.remove('active');
        else if (type === 'rarity' && (txt.includes('míticos') || txt.includes('épicos') || txt.includes('raros'))) b.classList.remove('active');
      });
      applyFilters();
    }

    function setSort(val) {
      currentSort = val;
      renderAchModal();
    }

    function getSortedList() {
      var arr = [...currentAchList];
      if (currentSort === 'locked_first') {
        arr.sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? 1 : -1));
      } else if (currentSort === 'unlocked_first') {
        arr.sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1));
      } else if (currentSort === 'rarity_rare') {
        arr.sort((a, b) => a.percent - b.percent);
      } else if (currentSort === 'rarity_common') {
        arr.sort((a, b) => b.percent - a.percent);
      } else if (currentSort === 'alpha') {
        arr.sort((a, b) => a.name.localeCompare(b.name));
      }
      return arr;
    }

    function applyFilters() {
      var query = document.getElementById('achSearchInput').value.toLowerCase();
      var items = document.querySelectorAll('.ach-item');
      
      items.forEach(function(it) {
        var apiname = it.getAttribute('data-apiname');
        var a = currentAchList.find(x => x.apiname === apiname);
        if (!a) return;

        var matchesQuery = a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query);
        
        var matchesStatus = true;
        if (filterStatus === 'locked') matchesStatus = !a.unlocked;
        else if (filterStatus === 'unlocked') matchesStatus = a.unlocked;
        else if (filterStatus === 'queue') matchesStatus = a.inQueue;

        var matchesRarity = true;
        if (filterRarity === 'mythic') matchesRarity = a.percent < 5.0;
        else if (filterRarity === 'epic') matchesRarity = a.percent >= 5.0 && a.percent < 15.0;
        else if (filterRarity === 'rare') matchesRarity = a.percent >= 15.0 && a.percent < 40.0;

        it.style.display = (matchesQuery && matchesStatus && matchesRarity) ? 'flex' : 'none';
      });
    }

    function renderAchModal() {
      var cont = document.getElementById('achListContainer');
      cont.innerHTML = '';
      if (!currentAchList || !currentAchList.length) {
        document.getElementById('achProgressText').innerText = '0 logros disponibles';
        document.getElementById('achProgressFill').style.width = '0%';
        cont.innerHTML = '<p style="text-align:center; padding:30px; color:var(--text-muted);">Este juego no posee logros públicos en Steam.</p>';
        return;
      }

      var unlocked = currentAchList.filter(x => x.unlocked).length;
      var pctTotal = Math.round((unlocked / currentAchList.length) * 100);
      document.getElementById('achProgressText').innerText = unlocked + ' de ' + currentAchList.length + ' conseguidos (' + pctTotal + '%)';
      document.getElementById('achProgressFill').style.width = pctTotal + '%';

      var listToRender = getSortedList();

      listToRender.forEach(function(a) {
        var rarityClass = 'gray';
        if (a.percent < 5.0) rarityClass = 'gold';
        else if (a.percent < 15.0) rarityClass = 'purple';
        else if (a.percent < 40.0) rarityClass = 'blue';

        var statusClass = a.unlocked ? 'unlocked-item' : 'locked-item';

        var div = document.createElement('div');
        div.className = 'ach-item ' + rarityClass + ' ' + statusClass + (selectedApinames.has(a.apiname) ? ' selected' : '');
        div.setAttribute('data-apiname', a.apiname);
        
        var dateLabel = a.unlockDate ? '<small style="color:var(--success); font-size:0.75rem; display:block; margin-top:2px;">Conseguido: ' + a.unlockDate + '</small>' : '';

        div.innerHTML = 
          '<input type="checkbox" class="ach-checkbox" ' + (selectedApinames.has(a.apiname) ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleSelectSingle(\\'' + a.apiname.replace(/'/g, "\\\\'") + '\\', this.checked)">' +
          '<img src="' + (a.unlocked ? a.iconOpen : a.iconClosed) + '" onerror="this.src=\\'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png\\'">' +
          '<div class="ach-info">' +
            '<div class="ach-title">' + a.name + ' <span class="ach-badge" style="color:var(--text-muted);">(' + a.tier + ' • ' + a.percent + '%)</span></div>' +
            '<div class="ach-desc">' + a.description + '</div>' +
            dateLabel +
          '</div>' +
          '<div>' +
            (a.unlocked 
              ? '<span style="color:var(--success); font-weight:700; font-size:0.8rem;">✓ Conseguido</span>' 
              : (a.inQueue 
                  ? '<span style="color:var(--warning); font-weight:700; font-size:0.8rem;">⏳ En Cola</span>' 
                  : '<span style="color:var(--text-muted); font-size:0.8rem;">🔒 Bloqueado</span>')) +
          '</div>';

        div.onclick = function() {
          var isChecked = !selectedApinames.has(a.apiname);
          toggleSelectSingle(a.apiname, isChecked);
          div.querySelector('.ach-checkbox').checked = isChecked;
        };

        cont.appendChild(div);
      });

      applyFilters();
      updateBatchToolbar();
    }

    function toggleSelectSingle(apiname, isSelected) {
      if (isSelected) selectedApinames.add(apiname);
      else selectedApinames.delete(apiname);
      
      var row = document.querySelector('.ach-item[data-apiname="' + apiname + '"]');
      if (row) {
        if (isSelected) row.classList.add('selected');
        else row.classList.remove('selected');
      }
      updateBatchToolbar();
    }

    function toggleSelectAll(isChecked) {
      selectedApinames.clear();
      var visibleRows = document.querySelectorAll('.ach-item');
      visibleRows.forEach(row => {
        if (row.style.display !== 'none') {
          var apiname = row.getAttribute('data-apiname');
          if (isChecked) {
            selectedApinames.add(apiname);
            row.classList.add('selected');
            row.querySelector('.ach-checkbox').checked = true;
          } else {
            row.classList.remove('selected');
            row.querySelector('.ach-checkbox').checked = false;
          }
        }
      });
      updateBatchToolbar();
    }

    function updateBatchToolbar() {
      var count = selectedApinames.size;
      document.getElementById('selectedCountText').innerText = count + ' seleccionados';
      document.getElementById('selectAllCheckbox').checked = count > 0 && count === currentAchList.length;

      var estText = document.getElementById('estimatedTimeText');
      if (count > 0) {
        var minHours = ((count * 45) / 60).toFixed(1);
        var maxHours = ((count * 85) / 60).toFixed(1);
        estText.innerText = '⏱️ Cadencia Orgánica: ~' + minHours + 'h a ' + maxHours + 'h';
      } else {
        estText.innerText = '';
      }
    }

    async function unlockSelected() {
      if (!selectedApinames.size) return alert('Selecciona al menos un logro marcando las casillas.');
      var items = currentAchList.filter(x => selectedApinames.has(x.apiname));
      await reqAction('/api/unlock-batch', {
        appid: currentAchAppId,
        gameName: currentAchGameName,
        items: items
      });
      items.forEach(it => { it.unlocked = true; it.inQueue = false; });
      selectedApinames.clear();
      renderAchModal();
      loadStatus();
    }

    async function lockSelected() {
      if (!selectedApinames.size) return alert('Selecciona al menos un logro primero.');
      if (!confirm('¿Deseas volver a bloquear los ' + selectedApinames.size + ' logros seleccionados?')) return;
      var apinames = Array.from(selectedApinames);
      await reqAction('/api/lock-batch', {
        appid: currentAchAppId,
        apinames: apinames
      });
      currentAchList.forEach(it => {
        if (selectedApinames.has(it.apiname)) { it.unlocked = false; it.inQueue = false; it.unlockDate = null; }
      });
      selectedApinames.clear();
      renderAchModal();
      loadStatus();
    }

    async function queueSelectedOrganic() {
      if (!selectedApinames.size) return alert('Selecciona los logros que deseas encolar.');
      var items = currentAchList.filter(x => selectedApinames.has(x.apiname) && !x.unlocked && !x.inQueue);
      if (!items.length) return alert('Los logros seleccionados ya están conseguidos o en cola.');
      
      await reqAction('/api/queue-achievements', {
        appid: currentAchAppId,
        gameName: currentAchGameName,
        items: items
      });
      alert('⚡ ' + items.length + ' logros programados. Se registrarán progresivamente cada 45-85 minutos.');
      items.forEach(it => it.inQueue = true);
      selectedApinames.clear();
      renderAchModal();
      loadStatus();
    }

    var debounceTimer = null;
    var searchInput = document.getElementById('searchInput');
    var searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', function(e) {
      clearTimeout(debounceTimer);
      var val = e.target.value.trim();
      if (!val || !isNaN(val)) { searchResults.style.display = 'none'; return; }
      debounceTimer = setTimeout(async function() {
        try {
          var res = await fetch('/api/search?term=' + encodeURIComponent(val));
          var list = await res.json();
          searchResults.innerHTML = '';
          if (list && list.length) {
            list.forEach(function(it) {
              var div = document.createElement('div');
              div.className = 'search-item';
              div.innerHTML = '<img src="' + it.img + '" onerror="this.style.display=\\'none\\'"><div class="search-info">' + it.name + '<span>AppID: ' + it.id + '</span></div>';
              div.onclick = function() { addGame(it.id, it.name); searchResults.style.display = 'none'; searchInput.value = ''; };
              searchResults.appendChild(div);
            });
            searchResults.style.display = 'block';
          } else { searchResults.style.display = 'none'; }
        } catch (e) { searchResults.style.display = 'none'; }
      }, 250);
    });

    document.addEventListener('click', function(e) {
      if (!searchResults.contains(e.target) && e.target !== searchInput) searchResults.style.display = 'none';
    });

    function addFromInput() { var v = searchInput.value.trim(); if (v && !isNaN(v)) addGame(Number(v)); }

    async function reqAction(endpoint, body) {
      body = body || {};
      body.pin = savedPin;
      var res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json();
      if (res.status === 401) { alert('PIN incorrecto o sesión caducada.'); lock(); return null; }
      return data;
    }

    async function addGame(appid, name) {
      var data = await reqAction('/api/add', { appid: Number(appid), name: name || '' });
      if (data && data.error) alert(data.error);
      else { searchInput.value = ''; loadStatus(); }
    }

    async function removeGame(appid) { await reqAction('/api/remove', { appid: Number(appid) }); loadStatus(); }
    async function clearAll() { if (confirm('¿Vaciar toda la lista?')) { await reqAction('/api/clear-all'); loadStatus(); } }
    async function applyPreset(presetKey) { await reqAction('/api/apply-preset', { presetKey: presetKey }); loadStatus(); }
    async function togglePause() { await reqAction('/api/toggle'); loadStatus(); }
    async function togglePersona() { await reqAction('/api/persona'); loadStatus(); }
    async function toggleCards() { await reqAction('/api/toggle-cards'); loadStatus(); }
    async function claimFreeGames() { var res = await reqAction('/api/claim-free'); if (res) alert('Licencias gratuitas solicitadas.'); }

    async function saveSleep() {
      await reqAction('/api/set-sleep', {
        enabled: document.getElementById('sleepEnabled').checked,
        start: document.getElementById('sleepStart').value,
        end: document.getElementById('sleepEnd').value
      });
      alert('Horario de descanso guardado.');
      loadStatus();
    }

    async function saveCustomStatus() {
      await reqAction('/api/custom-status', { status: document.getElementById('customStatusInput').value });
      alert('Texto en Steam guardado.');
      loadStatus();
    }

    async function saveWebhook() {
      var webhook = document.getElementById('webhookInput').value.trim();
      var res = await reqAction('/api/set-webhook', { webhook: webhook });
      if (res && res.success) alert('✅ Webhook vinculado exitosamente.');
      else alert('❌ Error al enviar mensaje: ' + (res ? res.error : 'Desconocido'));
      loadStatus();
    }

    checkAuth();
    setInterval(loadStatus, 3000);
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log('[Web] Servidor Enterprise listo en puerto ' + PORT));
