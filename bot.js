const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');

// Configuration Loader & Multi-Account Migration
let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
cfg.webPin = String(cfg.webPin || '1234');
cfg.discordWebhook = cfg.discordWebhook || '';
cfg.accounts = cfg.accounts || [];

// Backward-compatibility migration for legacy single-account configs
if (cfg.accounts.length === 0 && (cfg.user || cfg.refreshToken)) {
  cfg.accounts.push({
    id: 'main',
    name: (cfg.user ? cfg.user.split('@')[0] : 'Main Account'),
    user: cfg.user || '',
    pass: cfg.pass || '',
    refreshToken: cfg.refreshToken || '',
    games: cfg.games || [730],
    gameNames: cfg.gameNames || {},
    customStatus: cfg.customStatus || '',
    personaState: cfg.personaState !== undefined ? cfg.personaState : SteamUser.EPersonaState.Online,
    cardFarming: cfg.cardFarming || false,
    sleepMode: cfg.sleepMode || { enabled: false, start: 3, end: 8 },
    achievementQueue: cfg.achievementQueue || [],
    unlockedAchievements: cfg.unlockedAchievements || {},
    mySteamID: cfg.mySteamID || ''
  });
  cfg.activeAccountId = 'main';
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
}

cfg.activeAccountId = cfg.activeAccountId || (cfg.accounts[0] ? cfg.accounts[0].id : 'main');

// Multi-Account Runtime Manager
const clients = {};
const accountStates = {};
const achMemoryCache = {};

function saveConfig() {
  try {
    fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('Error saving config.json:', err.message);
  }
}

const PRESETS = {
  competitive: {
    name: '🎯 Competitive',
    games: [730, 440, 570, 252490, 1172470, 578080],
    names: { 730: 'Counter-Strike 2', 440: 'Team Fortress 2', 570: 'Dota 2', 252490: 'Rust', 1172470: 'Apex Legends', 578080: 'PUBG' }
  },
  valve: {
    name: '🏆 Valve Classics',
    games: [10, 240, 220, 550, 620],
    names: { 10: 'Counter-Strike 1.6', 240: 'Counter-Strike: Source', 220: 'Half-Life 2', 550: 'Left 4 Dead 2', 620: 'Portal 2' }
  },
  aaa: {
    name: '🔥 AAA Hits',
    games: [271590, 1938090, 1091500, 292030, 379720],
    names: { 271590: 'Grand Theft Auto V', 1938090: 'Call of Duty®', 1091500: 'Cyberpunk 2077', 292030: 'The Witcher 3', 379720: 'DOOM' }
  }
};

// HTTP Client with Age-Gate bypass, custom headers & redirect preservation
function fetchWithRedirects(targetUrl, customHeaders, maxRedirects, cb) {
  if (typeof customHeaders === 'function') {
    cb = customHeaders;
    customHeaders = {};
    maxRedirects = 5;
  }
  if (maxRedirects === undefined) maxRedirects = 5;
  if (maxRedirects <= 0) return cb(new Error('Too many redirects'), null);

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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

// Discord Webhook sender with proxy bypass
function sendDiscordWebhook(title, description, color, thumbUrl, cb) {
  if (!cfg.discordWebhook || !cfg.discordWebhook.includes('/api/webhooks/')) {
    if (cb) cb({ success: false, error: 'Invalid Webhook URL.' });
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
      footer: { text: 'Steam Hour Booster Pro • Enterprise Multi-Account' },
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
        'User-Agent': 'SteamBoosterBot/2.0'
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

// Initialize single account runtime
function initializeAccount(acc) {
  if (clients[acc.id]) return;

  const client = new SteamUser();
  clients[acc.id] = client;

  accountStates[acc.id] = {
    isFarming: false,
    isPaused: false,
    isCollisionPaused: false,
    isSleepPaused: false,
    collisionTimer: null,
    sessionStartTime: Date.now(),
    webCookies: '',
    cardDropGames: [],
    steamId64: acc.mySteamID || ''
  };

  const state = accountStates[acc.id];
  const loginDetails = acc.refreshToken ? { refreshToken: acc.refreshToken } : { accountName: acc.user, password: acc.pass };

  client.logOn(loginDetails);

  client.on('loggedOn', () => {
    console.log(`[+] Connected to Steam for account: ${acc.name} (${acc.user})`);
    if (client.steamID) {
      state.steamId64 = client.steamID.toString();
      acc.mySteamID = state.steamId64;
      saveConfig();
    }
    client.setPersona(acc.personaState !== undefined ? acc.personaState : SteamUser.EPersonaState.Online);
    try { client.webLogOn(); } catch (e) {}
    resolveMissingNames(acc);
    updateFarming(acc);
    sendDiscordWebhook(`🟢 ${acc.name} Connected`, `Boosting ${acc.games.length} games on cloud session.`, 1095985);
  });

  client.on('webSession', (sessionID, cookies) => {
    state.webCookies = cookies.join('; ');
    console.log(`[+] Web session authenticated for ${acc.name}.`);
    if (acc.cardFarming) scanCards(acc);
  });

  client.on('error', (e) => console.error(`[Steam Error - ${acc.name}]:`, e.message));

  // Anti-Collision Handler
  client.on('playingElsewhere', () => {
    console.log(`[⚠️ Anti-Collision] Local game detected for ${acc.name}. Pausing cloud session...`);
    state.isCollisionPaused = true;
    updateFarming(acc);
    sendDiscordWebhook(`🎮 Game Running Locally (${acc.name})`, 'Cloud bot paused automatically to prevent interference with your PC gameplay.', 16101915);

    if (state.collisionTimer) clearTimeout(state.collisionTimer);
    state.collisionTimer = setTimeout(() => {
      console.log(`[Anti-Collision] Resuming cloud booster for ${acc.name}...`);
      state.isCollisionPaused = false;
      updateFarming(acc);
      sendDiscordWebhook(`🔄 Cloud Boosting Resumed (${acc.name})`, 'Local PC session finished. Cloud booster resumed.', 1095985);
    }, 10 * 60 * 1000);
  });

  // Steam Chat remote control
  client.on('friendMessage', (steamID, message) => {
    const msg = message.trim().toLowerCase();
    const args = msg.split(' ');
    const cmd = args[0];

    function reply(text) { try { client.chatMessage(steamID, text); } catch (e) {} }

    if (cmd === '!status') {
      const st = state.isPaused ? 'Paused' : (state.isCollisionPaused ? 'Paused (PC Playing)' : 'Active');
      reply(`📊 [${acc.name}] Status: ${st} | Games: ${acc.games.length}/32 | Queued: ${(acc.achievementQueue || []).length}`);
    } else if (cmd === '!pause') {
      state.isPaused = true;
      updateFarming(acc);
      reply(`⏸️ [${acc.name}] Cloud boosting paused.`);
    } else if (cmd === '!resume' || cmd === '!play') {
      state.isPaused = false;
      state.isCollisionPaused = false;
      if (state.collisionTimer) clearTimeout(state.collisionTimer);
      updateFarming(acc);
      reply(`▶️ [${acc.name}] Cloud boosting resumed.`);
    } else if (cmd === '!invisible') {
      acc.personaState = SteamUser.EPersonaState.Invisible;
      client.setPersona(acc.personaState);
      saveConfig();
      reply(`👻 [${acc.name}] Persona set to Invisible.`);
    } else if (cmd === '!online') {
      acc.personaState = SteamUser.EPersonaState.Online;
      client.setPersona(acc.personaState);
      saveConfig();
      reply(`🟢 [${acc.name}] Persona set to Online.`);
    } else if (cmd === '!help') {
      reply('🤖 Commands: !status, !pause, !resume, !invisible, !online');
    }
  });
}

// Launch all accounts in parallel
cfg.accounts.forEach(acc => initializeAccount(acc));

function getActiveAccount() {
  return cfg.accounts.find(a => a.id === cfg.activeAccountId) || cfg.accounts[0];
}

function resolveMissingNames(acc) {
  acc.games.forEach(id => {
    if (!acc.gameNames[id]) {
      fetchSteamGameName(id, (name) => {
        if (name) {
          acc.gameNames[id] = name;
          saveConfig();
        }
      });
    }
  });
}

function fetchSteamGameName(appid, cb) {
  https.get('https://store.steampowered.com/api/appdetails?appids=' + appid + '&filters=basic&l=english', (res) => {
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

function updateFarming(acc) {
  const client = clients[acc.id];
  const state = accountStates[acc.id];
  if (!client || !state) return;

  if (!state.isPaused && !state.isCollisionPaused && !state.isSleepPaused && acc.games.length > 0) {
    const list = acc.games.map(Number).filter(n => !isNaN(n) && n > 0);
    if (acc.customStatus && acc.customStatus.trim() !== '') {
      list.push(acc.customStatus.trim());
    }
    client.gamesPlayed(list);
    if (!state.isFarming) state.sessionStartTime = Date.now();
    state.isFarming = true;
    console.log(`[+] [${acc.name}] Boosting ${list.length} apps.`);
  } else {
    client.gamesPlayed([]);
    state.isFarming = false;
    console.log(`[-] [${acc.name}] Boosting paused.`);
  }
}

function scanCards(acc, cb) {
  const state = accountStates[acc.id];
  if (!state || !state.webCookies) { if (cb) cb([]); return; }

  const opts = {
    hostname: 'steamcommunity.com',
    path: '/my/badges/',
    method: 'GET',
    headers: { 'Cookie': state.webCookies, 'User-Agent': 'Mozilla/5.0' }
  };
  https.get(opts, (res) => {
    let html = '';
    res.on('data', c => html += c);
    res.on('end', () => {
      const regex = /href="https:\/\/steamcommunity\.com\/my\/gamecards\/(\d+)\/"[\s\S]*?progress_info_bold">(\d+)\s+card/gi;
      const found = [];
      let match;
      while ((match = regex.exec(html)) !== null) {
        found.push({ appid: parseInt(match[1], 10), remaining: parseInt(match[2], 10) });
      }
      state.cardDropGames = found;
      if (acc.cardFarming && found.length > 0) {
        acc.games = found.slice(0, 32).map(x => x.appid);
        saveConfig();
        updateFarming(acc);
      }
      if (cb) cb(found);
    });
  }).on('error', () => { if (cb) cb([]); });
}

setInterval(() => {
  const hour = new Date().getHours();
  cfg.accounts.forEach(acc => {
    const state = accountStates[acc.id];
    if (!state || !acc.sleepMode || !acc.sleepMode.enabled) return;

    const inSleep = (acc.sleepMode.start < acc.sleepMode.end)
      ? (hour >= acc.sleepMode.start && hour < acc.sleepMode.end)
      : (hour >= acc.sleepMode.start || hour < acc.sleepMode.end);

    if (inSleep && !state.isSleepPaused) {
      state.isSleepPaused = true;
      updateFarming(acc);
    } else if (!inSleep && state.isSleepPaused) {
      state.isSleepPaused = false;
      updateFarming(acc);
    }
  });
}, 60 * 1000);

setInterval(() => {
  const now = Date.now();
  cfg.accounts.forEach(acc => {
    if (!acc.achievementQueue || acc.achievementQueue.length === 0) return;
    const nextItem = acc.achievementQueue[0];

    if (now >= nextItem.scheduledTime) {
      const item = acc.achievementQueue.shift();
      acc.unlockedAchievements = acc.unlockedAchievements || {};
      acc.unlockedAchievements[item.appid] = acc.unlockedAchievements[item.appid] || [];

      if (!acc.unlockedAchievements[item.appid].includes(item.apiname)) {
        acc.unlockedAchievements[item.appid].push(item.apiname);
      }
      if (!acc.unlockedAchievements[item.appid].includes(item.name)) {
        acc.unlockedAchievements[item.appid].push(item.name);
      }

      sendDiscordWebhook(
        `🏆 Achievement Simulation Unlocked! • ${item.gameName} (${acc.name})`,
        `**${item.name}**\n*${item.desc || 'No description'}*\n\n🌟 **Rarity:** ${item.tier} (${item.percent}% global)\n⏱️ **Simulation:** Human-like pacing interval.`,
        item.color,
        item.icon
      );

      if (acc.achievementQueue.length > 0) {
        const nextDelayMinutes = Math.floor(Math.random() * (85 - 45 + 1)) + 45;
        acc.achievementQueue[0].scheduledTime = Date.now() + (nextDelayMinutes * 60 * 1000);
      }

      delete achMemoryCache[`${acc.id}_${item.appid}`];
      saveConfig();
    }
  });
}, 30 * 1000);

function getTag(body, tag) {
  const regex = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i');
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
    const name = getTag(body, 'name') || apiname;
    const pct = parseFloat(percentMap[apiname] || percentMap[name] || 50.0);
    const unlockTimestamp = parseInt(getTag(body, 'unlockTimestamp') || '0', 10);

    let tier = '⚪ Common';
    let colorHex = 0x94a3b8;
    if (pct < 5.0) { tier = '🟡 Mythic'; colorHex = 0xf59e0b; }
    else if (pct < 15.0) { tier = '🟣 Epic'; colorHex = 0xa855f7; }
    else if (pct < 40.0) { tier = '🔵 Rare'; colorHex = 0x38bdf8; }

    const isUnlocked = closedOriginal || unlockedLocally.includes(apiname) || unlockedLocally.includes(name);

    let unlockDateFormatted = null;
    if (unlockTimestamp > 0) {
      const d = new Date(unlockTimestamp * 1000);
      unlockDateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    achievements.push({
      apiname: apiname,
      name: name,
      description: getTag(body, 'description') || 'Steam Achievement',
      iconClosed: getTag(body, 'iconClosed'),
      iconOpen: getTag(body, 'iconOpen'),
      percent: pct,
      tier: tier,
      color: colorHex,
      unlocked: isUnlocked,
      unlockDate: unlockDateFormatted,
      unlockTimestamp: unlockTimestamp,
      inQueue: false
    });
  }
  return achievements;
}

// Extractor HTML seguro sin expresiones regulares complejas
function parseAchievementsFromHtml(html, unlockedSet, percentMap) {
  const list = [];
  const parts = html.split(/class=["'][^"']*achieveRow/i);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const prevChunk = parts[i - 1].slice(-80);

    const imgM = block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const h3M = block.match(/<h3>([\s\S]*?)<\/h3>/i);
    const h5M = block.match(/<h5>([\s\S]*?)<\/h5>/i);
    const pctM = block.match(/class=["'][^"']*achievePercent[^"']*["'][^>]*>\s*([0-9.]+)\s*%/i);
    const dateM = block.match(/class=["'][^"']*achieveUnlockTime[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    if (h3M) {
      const name = h3M[1].replace(/<[^>]+>/g, '').trim();
      const desc = h5M ? h5M[1].replace(/<[^>]+>/g, '').trim() : '';
      const icon = imgM ? imgM[1] : '';
      const apiname = 'ACH_' + name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

      let pct = pctM ? parseFloat(pctM[1]) : (parseFloat(percentMap[apiname] || percentMap[name]) || 50.0);

      let tier = '⚪ Common';
      let colorHex = 0x94a3b8;
      if (pct < 5.0) { tier = '🟡 Mythic'; colorHex = 0xf59e0b; }
      else if (pct < 15.0) { tier = '🟣 Epic'; colorHex = 0xa855f7; }
      else if (pct < 40.0) { tier = '🔵 Rare'; colorHex = 0x38bdf8; }

      const rawDate = dateM ? dateM[1].replace(/<[^>]+>/g, '').replace(/Unlocked\s*/i, '').replace(/Desbloqueado el\s*/i, '').trim() : null;
      const isUnlocked = prevChunk.includes('unlocked') || Boolean(rawDate) || unlockedSet.has(name) || unlockedSet.has(apiname);

      list.push({
        apiname: apiname,
        name: name,
        description: desc || 'Steam Achievement',
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

function getAchievementsForAccount(acc, appid, cb) {
  const cacheKey = `${acc.id}_${appid}`;
  const unlockedLocally = (acc.unlockedAchievements && acc.unlockedAchievements[appid]) || [];
  const state = accountStates[acc.id] || {};
  const userSteamId = state.steamId64 || acc.mySteamID || '';
  const xmlHeaders = state.webCookies ? { 'Cookie': state.webCookies } : {};

  if (achMemoryCache[cacheKey] && achMemoryCache[cacheKey].isPersonalized && achMemoryCache[cacheKey].achievements.length > 0) {
    const cachedList = achMemoryCache[cacheKey].achievements.map(a => ({
      ...a,
      unlocked: a.unlocked || unlockedLocally.includes(a.apiname) || unlockedLocally.includes(a.name),
      inQueue: (acc.achievementQueue || []).some(q => q.appid == appid && (q.apiname === a.apiname || q.name === a.name))
    }));
    return cb({ achievements: cachedList, isPrivate: achMemoryCache[cacheKey].isPrivate });
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

    const targetXmlUrl = userSteamId
      ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?xml=1`
      : `https://steamcommunity.com/stats/${appid}/achievements/?xml=1`;

    fetchWithRedirects(targetXmlUrl, xmlHeaders, 5, (errXml, xmlData) => {
      let isProfilePrivate = false;
      if (xmlData && (xmlData.includes('profile is private') || xmlData.includes('Specified profile could not be found') || xmlData.includes('<error>'))) {
        isProfilePrivate = true;
      }

      if (!errXml && xmlData && xmlData.includes('<achievement') && !isProfilePrivate) {
        const listXml = parseAchievementsFromXml(xmlData, percentMap, appid, unlockedLocally);
        if (listXml.length > 0) {
          achMemoryCache[cacheKey] = { achievements: listXml, isPersonalized: true, isPrivate: false };
          return cb(achMemoryCache[cacheKey]);
        }
      }

      const unlockedSet = new Set(unlockedLocally);
      const targetUserHtml = userSteamId
        ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?tab=achievements&l=english`
        : `https://steamcommunity.com/stats/${appid}/achievements/?l=english`;

      fetchWithRedirects(targetUserHtml, xmlHeaders, 5, (errUHtml, uHtmlData) => {
        if (uHtmlData && (uHtmlData.includes('profile_private') || uHtmlData.includes('This profile is private') || uHtmlData.includes('Este perfil es privado'))) {
          isProfilePrivate = true;
        }

        if (!errUHtml && uHtmlData && uHtmlData.includes('achieveRow')) {
          const listU = parseAchievementsFromHtml(uHtmlData, unlockedSet, percentMap);
          if (listU.length > 0) {
            achMemoryCache[cacheKey] = { achievements: listU, isPersonalized: !isProfilePrivate, isPrivate: isProfilePrivate };
            return cb(achMemoryCache[cacheKey]);
          }
        }

        const urlGlobalHtml = `https://steamcommunity.com/stats/${appid}/achievements/?l=english`;
        fetchWithRedirects(urlGlobalHtml, {}, 5, (errHtml, htmlData) => {
          if (!errHtml && htmlData && htmlData.includes('achieveRow')) {
            const listG = parseAchievementsFromHtml(htmlData, unlockedSet, percentMap);
            if (listG.length > 0) {
              return cb({ achievements: listG, isPersonalized: false, isPrivate: isProfilePrivate });
            }
          }
          cb({ achievements: [], isPersonalized: false, isPrivate: isProfilePrivate });
        });
      });
    });
  });
}

// HTTP Server
const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      name: 'Steam Booster Enterprise Multi-Account',
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

    https.get('https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(query) + '&l=english&cc=US', (sRes) => {
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
    const acc = getActiveAccount();
    if (!appid || !acc) return res.end(JSON.stringify({ achievements: [], isPrivate: false }));

    if (parsedUrl.query.refresh === '1') {
      delete achMemoryCache[`${acc.id}_${appid}`];
    }

    getAchievementsForAccount(acc, appid, (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const acc = getActiveAccount();
    const state = acc ? (accountStates[acc.id] || {}) : {};
    const nextItem = (acc && acc.achievementQueue && acc.achievementQueue.length > 0) ? acc.achievementQueue[0] : null;

    const accountsSummary = cfg.accounts.map(a => {
      const st = accountStates[a.id] || {};
      return {
        id: a.id,
        name: a.name,
        user: a.user,
        gameCount: a.games.length,
        isFarming: st.isFarming || false,
        isPaused: st.isPaused || false,
        isCollisionPaused: st.isCollisionPaused || false
      };
    });

    return res.end(JSON.stringify({
      activeAccountId: cfg.activeAccountId,
      accounts: accountsSummary,
      activeAccount: acc ? {
        id: acc.id,
        name: acc.name,
        user: acc.user,
        games: acc.games,
        gameNames: acc.gameNames || {},
        isFarming: state.isFarming || false,
        isPaused: state.isPaused || false,
        isCollisionPaused: state.isCollisionPaused || false,
        isSleepPaused: state.isSleepPaused || false,
        cardFarming: acc.cardFarming || false,
        cardDropCount: (state.cardDropGames || []).length,
        queueCount: (acc.achievementQueue || []).length,
        nextAchievementIn: nextItem ? Math.max(0, Math.round((nextItem.scheduledTime - Date.now()) / 60000)) : null,
        sleepMode: acc.sleepMode || { enabled: false, start: 3, end: 8 },
        customStatus: acc.customStatus || '',
        personaState: acc.personaState !== undefined ? acc.personaState : SteamUser.EPersonaState.Online,
        sessionStartTime: state.isFarming ? state.sessionStartTime : null
      } : null,
      discordWebhook: cfg.discordWebhook || '',
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
          return res.end(JSON.stringify({ error: 'Incorrect PIN' }));
        }

        if (parsedUrl.pathname === '/api/verify-pin') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/account/switch') {
          const target = cfg.accounts.find(a => a.id === data.accountId);
          if (target) {
            cfg.activeAccountId = target.id;
            saveConfig();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, activeAccountId: cfg.activeAccountId }));
        }

        if (parsedUrl.pathname === '/api/account/add') {
          const newId = 'acc_' + Date.now();
          const newAcc = {
            id: newId,
            name: (data.name || 'Account ' + (cfg.accounts.length + 1)).trim(),
            user: (data.user || '').trim(),
            pass: data.pass || '',
            refreshToken: (data.refreshToken || '').trim(),
            games: [730],
            gameNames: { 730: 'Counter-Strike 2' },
            customStatus: '',
            personaState: SteamUser.EPersonaState.Online,
            cardFarming: false,
            sleepMode: { enabled: false, start: 3, end: 8 },
            achievementQueue: [],
            unlockedAchievements: {}
          };

          cfg.accounts.push(newAcc);
          cfg.activeAccountId = newId;
          saveConfig();
          initializeAccount(newAcc);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, accountId: newId }));
        }

        if (parsedUrl.pathname === '/api/account/remove') {
          if (cfg.accounts.length <= 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'You must maintain at least one account.' }));
          }

          const removeId = data.accountId;
          if (clients[removeId]) {
            try { clients[removeId].logOff(); } catch (e) {}
            delete clients[removeId];
            delete accountStates[removeId];
          }

          cfg.accounts = cfg.accounts.filter(a => a.id !== removeId);
          if (cfg.activeAccountId === removeId) {
            cfg.activeAccountId = cfg.accounts[0].id;
          }
          saveConfig();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, activeAccountId: cfg.activeAccountId }));
        }

        const acc = getActiveAccount();
        const state = acc ? (accountStates[acc.id] || {}) : {};

        if (parsedUrl.pathname === '/api/add') {
          const appid = parseInt(data.appid, 10);
          if (appid && !acc.games.includes(appid)) {
            if (acc.games.length >= 32) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Limit of 32 games reached for this account.' }));
            }
            acc.games.push(appid);
            state.isPaused = false;
            state.isCollisionPaused = false;
            if (state.collisionTimer) clearTimeout(state.collisionTimer);

            if (data.name) {
              acc.gameNames[appid] = data.name;
              saveConfig();
              updateFarming(acc);
            } else {
              fetchSteamGameName(appid, (name) => {
                if (name) acc.gameNames[appid] = name;
                saveConfig();
                updateFarming(acc);
              });
            }
          }
        }

        if (parsedUrl.pathname === '/api/remove') {
          const appid = parseInt(data.appid, 10);
          acc.games = acc.games.filter(id => id !== appid);
          delete acc.gameNames[appid];
          delete achMemoryCache[`${acc.id}_${appid}`];
          saveConfig();
          updateFarming(acc);
        }

        if (parsedUrl.pathname === '/api/clear-all') {
          acc.games = [];
          acc.gameNames = {};
          saveConfig();
          updateFarming(acc);
        }

        if (parsedUrl.pathname === '/api/apply-preset') {
          const preset = PRESETS[data.presetKey];
          if (preset) {
            preset.games.forEach(gid => {
              if (!acc.games.includes(gid) && acc.games.length < 32) {
                acc.games.push(gid);
                acc.gameNames[gid] = preset.names[gid] || ('Game #' + gid);
              }
            });
            state.isPaused = false;
            state.isCollisionPaused = false;
            if (state.collisionTimer) clearTimeout(state.collisionTimer);
            saveConfig();
            updateFarming(acc);
          }
        }

        if (parsedUrl.pathname === '/api/toggle') {
          state.isPaused = !state.isPaused;
          if (!state.isPaused) {
            state.isCollisionPaused = false;
            state.isSleepPaused = false;
            if (state.collisionTimer) {
              clearTimeout(state.collisionTimer);
              state.collisionTimer = null;
            }
          }
          updateFarming(acc);
        }

        if (parsedUrl.pathname === '/api/persona') {
          acc.personaState = (acc.personaState === SteamUser.EPersonaState.Invisible) 
            ? SteamUser.EPersonaState.Online 
            : SteamUser.EPersonaState.Invisible;
          if (clients[acc.id]) clients[acc.id].setPersona(acc.personaState);
          saveConfig();
        }

        if (parsedUrl.pathname === '/api/custom-status') {
          acc.customStatus = (data.status || '').trim();
          saveConfig();
          updateFarming(acc);
        }

        if (parsedUrl.pathname === '/api/set-webhook') {
          cfg.discordWebhook = (data.webhook || '').trim();
          saveConfig();
          sendDiscordWebhook('🔔 Webhook Connected', 'Discord channel linked successfully with Steam Booster Enterprise!', 3718648, null, (result) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          });
          return;
        }

        if (parsedUrl.pathname === '/api/unlock-batch') {
          const { appid, gameName, items } = data;
          acc.unlockedAchievements = acc.unlockedAchievements || {};
          acc.unlockedAchievements[appid] = acc.unlockedAchievements[appid] || [];

          items.forEach(it => {
            if (!acc.unlockedAchievements[appid].includes(it.apiname)) {
              acc.unlockedAchievements[appid].push(it.apiname);
            }
            if (!acc.unlockedAchievements[appid].includes(it.name)) {
              acc.unlockedAchievements[appid].push(it.name);
            }
          });
          delete achMemoryCache[`${acc.id}_${appid}`];
          saveConfig();

          sendDiscordWebhook(
            `🏆 Achievements Recorded • ${gameName} (${acc.name})`,
            `Marked **${items.length} achievements** in the cloud dashboard.`,
            3718648
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/lock-batch') {
          const { appid, apinames } = data;
          if (acc.unlockedAchievements && acc.unlockedAchievements[appid]) {
            acc.unlockedAchievements[appid] = acc.unlockedAchievements[appid].filter(id => !apinames.includes(id));
          }
          acc.achievementQueue = (acc.achievementQueue || []).filter(q => !(q.appid == appid && apinames.includes(q.apiname)));
          delete achMemoryCache[`${acc.id}_${appid}`];
          saveConfig();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/queue-achievements') {
          const { appid, gameName, items } = data;
          let baseDelay = 5;
          acc.achievementQueue = acc.achievementQueue || [];

          items.forEach(it => {
            const alreadyQueued = acc.achievementQueue.some(q => q.appid == appid && (q.apiname === it.apiname || q.name === it.name));
            if (!alreadyQueued) {
              const delayMin = baseDelay;
              acc.achievementQueue.push({
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
          saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, count: items.length }));
        }

        if (parsedUrl.pathname === '/api/clear-queue') {
          acc.achievementQueue = [];
          saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/toggle-cards') {
          acc.cardFarming = !acc.cardFarming;
          saveConfig();
          if (acc.cardFarming) scanCards(acc, () => updateFarming(acc));
          else updateFarming(acc);
        }

        if (parsedUrl.pathname === '/api/claim-free') {
          const freePackages = [730, 440, 570, 230410, 1172470];
          if (clients[acc.id]) {
            clients[acc.id].requestFreeLicense(freePackages, (err, grantedApps) => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, granted: grantedApps ? grantedApps.length : 0 }));
            });
            return;
          }
        }

        if (parsedUrl.pathname === '/api/set-sleep') {
          acc.sleepMode = {
            enabled: Boolean(data.enabled),
            start: parseInt(data.start || 3, 10),
            end: parseInt(data.end || 8, 10)
          };
          saveConfig();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, games: acc.games }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Frontend HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Steam Hour Booster Pro • Enterprise</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#070a13">
  <link rel="apple-touch-icon" href="https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070a13;
      --card-bg: rgba(18, 24, 38, 0.7);
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
      background: radial-gradient(circle at 50% 0%, #152033 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      padding: 40px 24px;
      display: flex;
      justify-content: center;
    }
    .container { width: 100%; max-width: 1100px; display: flex; flex-direction: column; gap: 32px; }

    .modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(7, 10, 19, 0.94);
      backdrop-filter: blur(20px);
      display: none; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-box {
      background: #111827; border: 1px solid var(--card-border);
      padding: 36px 32px; border-radius: 24px; max-width: 440px; width: 90%;
      box-shadow: 0 25px 50px rgba(0,0,0,0.8); display: flex; flex-direction: column; gap: 18px;
    }
    .modal-box h2 { font-size: 1.4rem; font-weight: 800; color: #fff; }
    .modal-box p { font-size: 0.85rem; color: var(--text-muted); }
    .modal-box input {
      width: 100%; padding: 13px 16px; border-radius: 12px; background: #0b0f19;
      border: 1px solid var(--card-border); color: #fff; font-size: 1rem; outline: none;
    }

    .accounts-bar {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;
      padding: 12px 18px; background: rgba(18, 24, 38, 0.5); border: 1px solid var(--card-border);
      border-radius: 18px; backdrop-filter: blur(12px);
    }
    .accounts-list { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .acc-pill {
      background: rgba(255, 255, 255, 0.04); border: 1px solid var(--card-border);
      padding: 8px 18px; border-radius: 999px; font-size: 0.85rem; font-weight: 700;
      color: var(--text-muted); cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px;
    }
    .acc-pill:hover { border-color: var(--primary); color: #fff; }
    .acc-pill.active {
      background: rgba(56, 189, 248, 0.12); border-color: var(--primary); color: #fff;
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.25);
    }
    .acc-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
    .acc-pill.active .dot { background: var(--success); }

    header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
    .brand h1 { font-size: 1.85rem; font-weight: 800; background: linear-gradient(135deg, #fff 40%, var(--primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand p { font-size: 0.9rem; color: var(--text-muted); margin-top: 4px; }
    .header-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

    .badge-status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-size: 0.85rem; font-weight: 700; background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25); }
    .badge-status.paused { background: rgba(244, 63, 94, 0.12); color: var(--danger); border-color: rgba(244, 63, 94, 0.25); }
    .badge-status.collision { background: rgba(245, 158, 11, 0.15); color: var(--warning); border-color: rgba(245, 158, 11, 0.3); }
    .badge-status.sleep { background: rgba(168, 85, 247, 0.15); color: var(--purple); border-color: rgba(168, 85, 247, 0.3); }

    .btn-action-sm { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border); color: #cbd5e1; padding: 8px 16px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-action-sm:hover { border-color: var(--primary); color: #fff; }

    .dashboard-panel {
      background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(16px);
      border-radius: 22px; padding: 28px 32px; display: flex; flex-direction: column; gap: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 18px; }
    .stat-item { background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.05); padding: 18px 20px; border-radius: 16px; }
    .stat-item label { display: block; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .stat-item value { font-size: 1.35rem; font-weight: 800; color: #fff; }

    .capacity-header { display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 9px; }
    .progress-bar-bg { width: 100%; height: 10px; background: rgba(0, 0, 0, 0.5); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.06); }
    .progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), #818cf8); transition: width 0.4s ease; }

    .controls {
      background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(16px);
      border-radius: 22px; padding: 28px 32px; display: flex; flex-direction: column; gap: 22px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .input-row { display: flex; gap: 14px; flex-wrap: wrap; }
    .search-box-wrapper { position: relative; flex: 1; min-width: 260px; }
    input[type="text"], input[type="password"], input[type="number"], select {
      width: 100%; background: rgba(7, 10, 19, 0.7); border: 1px solid var(--card-border);
      border-radius: 12px; color: #fff; padding: 14px 18px; font-size: 0.95rem; outline: none; transition: 0.2s;
    }
    input:focus, select:focus { border-color: var(--primary); }

    button { padding: 14px 24px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; border: none; cursor: pointer; transition: all 0.2s; }
    .btn-main { background: var(--primary); color: #04111d; }
    .btn-main:hover { background: var(--primary-hover); }
    .btn-clear { background: rgba(244, 63, 94, 0.12); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.25); }
    .btn-clear:hover { background: var(--danger); color: #fff; }
    .btn-purple { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.3); }
    .btn-purple:hover { background: var(--purple); color: #fff; }
    .btn-gold { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .btn-gold:hover { background: var(--gold); color: #000; }

    .presets-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .chip { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--card-border); color: #cbd5e1; padding: 8px 16px; border-radius: 10px; font-size: 0.85rem; cursor: pointer; font-weight: 600; }
    .chip:hover { border-color: var(--primary); color: var(--primary); background: rgba(56, 189, 248, 0.08); }

    .tools-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .tool-box { background: rgba(0, 0, 0, 0.25); padding: 14px 20px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; gap: 12px; align-items: center; }
    .tool-box input { padding: 10px 14px; font-size: 0.85rem; }

    .search-results {
      position: absolute; top: calc(100% + 8px); left: 0; right: 0; background: #0f1626;
      border: 1px solid var(--card-border); border-radius: 14px; box-shadow: 0 20px 40px rgba(0,0,0,0.7);
      max-height: 280px; overflow-y: auto; z-index: 100; display: none;
    }
    .search-item { display: flex; align-items: center; gap: 14px; padding: 12px 18px; cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .search-item:hover { background: rgba(56, 189, 248, 0.1); }
    .search-item img { width: 56px; height: 26px; object-fit: cover; border-radius: 4px; }
    .search-info { flex: 1; font-size: 0.9rem; font-weight: 600; }
    .search-info span { display: block; font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
    .card {
      background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 18px;
      overflow: hidden; display: flex; flex-direction: column; backdrop-filter: blur(14px);
      transition: all 0.25s ease; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    .card:hover { transform: translateY(-5px); border-color: rgba(56, 189, 248, 0.35); }
    .card-banner { width: 100%; aspect-ratio: 460/215; object-fit: cover; background: #0c1220; }
    .card-content { padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; gap: 14px; }
    .card-title { font-size: 0.95rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .card-appid { font-size: 0.8rem; color: var(--text-muted); margin-top: 3px; }
    .card-btn-row { display: flex; gap: 8px; }
    .btn-card { padding: 8px 14px; font-size: 0.8rem; border-radius: 9px; font-weight: 700; }
    .btn-remove { background: rgba(244, 63, 94, 0.12); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.25); }
    .btn-remove:hover { background: var(--danger); color: #fff; }
    .btn-ach { background: rgba(56, 189, 248, 0.12); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.25); }
    .btn-ach:hover { background: var(--primary); color: #04111d; }

    .ach-modal-card {
      background: #0d1322; border: 1px solid rgba(56, 189, 248, 0.25);
      width: 96%; max-width: 960px; max-height: 92vh; border-radius: 24px;
      display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 70px rgba(0,0,0,0.95);
    }
    .ach-header {
      padding: 22px 30px; background: #131b2e; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;
    }
    .ach-header-left h2 { font-size: 1.45rem; font-weight: 800; color: #fff; }
    .privacy-banner {
      background: rgba(245, 158, 11, 0.12); border-bottom: 1px solid rgba(245, 158, 11, 0.3);
      padding: 14px 30px; display: none; color: #fde68a; font-size: 0.85rem; line-height: 1.4;
    }
    .ach-toolbar {
      padding: 16px 30px; background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;
    }
    .ach-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .filter-btn {
      background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border);
      color: var(--text-muted); padding: 6px 14px; border-radius: 8px; font-size: 0.8rem;
      font-weight: 700; cursor: pointer; transition: 0.15s;
    }
    .filter-btn.active, .filter-btn:hover { background: rgba(56, 189, 248, 0.15); border-color: var(--primary); color: #fff; }

    .ach-batch-actions {
      padding: 12px 30px; background: rgba(15, 23, 42, 0.75); border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 0.9rem;
    }
    .ach-list { padding: 20px 30px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .ach-item {
      background: rgba(255, 255, 255, 0.03); border: 1px solid var(--card-border);
      border-radius: 14px; padding: 14px 18px; display: flex; align-items: center; gap: 16px;
      transition: all 0.2s; user-select: none;
    }
    .ach-item.unlocked-item { background: rgba(16, 185, 129, 0.04); border-color: rgba(16, 185, 129, 0.25); }
    .ach-item.selected { background: rgba(56, 189, 248, 0.09); border-color: rgba(56, 189, 248, 0.45); }
    .ach-item.gold { border-left: 4px solid var(--gold); }
    .ach-item.purple { border-left: 4px solid var(--purple); }
    .ach-item.blue { border-left: 4px solid var(--primary); }
    .ach-item.gray { border-left: 4px solid #64748b; }
    .ach-checkbox { width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary); }
    .ach-item img { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; background: #000; flex-shrink: 0; }
    .ach-item.locked-item img { filter: grayscale(100%) brightness(0.65); }
    .ach-info { flex: 1; overflow: hidden; }
    .ach-title { font-weight: 700; font-size: 0.95rem; color: #fff; display: flex; align-items: center; gap: 8px; }
    .ach-desc { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
    .ach-badge { font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
  </style>
</head>
<body>
  <div id="lockModal" class="modal-overlay">
    <div class="modal-box" style="text-align:center;">
      <h2>🔒 Enterprise Panel</h2>
      <p>Enter your PIN code to access the multi-account manager</p>
      <input type="password" id="pinInput" placeholder="••••" maxlength="8" style="text-align:center; letter-spacing:5px; font-size:1.3rem;">
      <button class="btn-main" style="width:100%;" onclick="unlock()">Unlock Dashboard</button>
    </div>
  </div>

  <div id="addAccModal" class="modal-overlay">
    <div class="modal-box">
      <h2>+ Add Steam Account</h2>
      <p>Configure a secondary account to boost hours and achievements simultaneously.</p>
      <input type="text" id="newAccName" placeholder="Account Label (e.g. Smurf 1, Farm 2)">
      <input type="text" id="newAccUser" placeholder="Steam Username / Email">
      <input type="password" id="newAccToken" placeholder="Steam Refresh Token (or Password)">
      <div style="display:flex; gap:10px; margin-top:10px;">
        <button class="btn-main" style="flex:1;" onclick="submitAddAccount()">Connect Account</button>
        <button class="btn-clear" style="padding:14px;" onclick="closeAddAccModal()">Cancel</button>
      </div>
    </div>
  </div>

  <div id="achModal" class="modal-overlay">
    <div class="ach-modal-card">
      <div class="ach-header">
        <div class="ach-header-left">
          <h2 id="achGameTitle">Steam Achievements</h2>
          <div style="display:flex; align-items:center; gap:14px; margin-top:6px;">
            <span id="achProgressText" style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">Syncing achievements...</span>
            <div style="width:220px; height:8px; background:rgba(0,0,0,0.5); border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,0.08);">
              <div id="achProgressFill" style="height:100%; width:0%; background:linear-gradient(90deg, var(--primary), var(--success)); transition:width 0.3s ease;"></div>
            </div>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="btn-action-sm" onclick="forceRefreshAchievements()">🔄 Refresh</button>
          <button class="btn-action-sm" onclick="closeAchModal()">✕ Close</button>
        </div>
      </div>

      <div class="privacy-banner" id="achPrivacyWarning">
        ⚠️ <strong>Privacy Alert:</strong> Your <em>"Game details"</em> are currently set to <strong>Private</strong> on Steam. The dashboard shows the catalog, but Steam restricts reading which achievements you own until you switch Game Details to <strong>Public</strong> in your Steam Privacy Settings.
      </div>

      <div class="ach-toolbar">
        <div class="ach-filters">
          <button class="filter-btn active" data-filter="status" data-val="all" onclick="setFilter('status', 'all')">All</button>
          <button class="filter-btn" data-filter="status" data-val="unlocked" onclick="setFilter('status', 'unlocked')">✓ Unlocked</button>
          <button class="filter-btn" data-filter="status" data-val="locked" onclick="setFilter('status', 'locked')">🔒 Locked</button>
          <button class="filter-btn" data-filter="status" data-val="queue" onclick="setFilter('status', 'queue')">⏳ Queued</button>
          <span style="color:rgba(255,255,255,0.2);">|</span>
          <button class="filter-btn" data-filter="rarity" data-val="mythic" onclick="setFilter('rarity', 'mythic')">🟡 Mythic (&lt;5%)</button>
          <button class="filter-btn" data-filter="rarity" data-val="epic" onclick="setFilter('rarity', 'epic')">🟣 Epic (5-15%)</button>
          <button class="filter-btn" data-filter="rarity" data-val="rare" onclick="setFilter('rarity', 'rare')">🔵 Rare (15-40%)</button>
        </div>
        
        <div style="display:flex; gap:10px; align-items:center;">
          <select id="achSortSelect" onchange="setSort(this.value)" style="padding:8px 12px; font-size:0.85rem; border-radius:10px; background:#131b2e; border:1px solid var(--card-border); color:#fff;">
            <option value="default">Sort: Default</option>
            <option value="unlocked_first">Unlocked first</option>
            <option value="locked_first">Locked first</option>
            <option value="rarity_rare">Rarest first</option>
            <option value="rarity_common">Most common first</option>
            <option value="alpha">Alphabetical (A-Z)</option>
          </select>
          <input type="text" id="achSearchInput" placeholder="Search achievement..." style="max-width:200px; padding:8px 14px; font-size:0.85rem;" oninput="onSearchInput(this.value)">
        </div>
      </div>

      <div class="ach-batch-actions">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)" style="width:18px; height:18px; accent-color:var(--primary);">
          <span id="selectedCountText" style="font-weight:700;">0 selected</span>
          <span id="estimatedTimeText" style="color:var(--gold); font-size:0.85rem; margin-left:8px;"></span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-main" style="padding:8px 16px; font-size:0.8rem;" onclick="unlockSelected()">⚡ Unlock</button>
          <button class="btn-gold" style="padding:8px 16px; font-size:0.8rem;" onclick="queueSelectedOrganic()">⏳ Queue Organic</button>
          <button class="btn-clear" style="padding:8px 16px; font-size:0.8rem;" onclick="lockSelected()">🔒 Lock</button>
        </div>
      </div>

      <div class="ach-list" id="achListContainer"></div>
    </div>
  </div>

  <div class="container">
    <div class="accounts-bar">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="font-size:0.8rem; font-weight:800; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.5px;">Active Profile:</span>
        <div class="accounts-list" id="accountsTabsContainer"></div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="acc-pill" onclick="openAddAccModal()">+ Add Account</button>
        <button class="acc-pill" style="color:var(--danger);" onclick="deleteCurrentAccount()">Delete Profile</button>
      </div>
    </div>

    <header>
      <div class="brand">
        <h1>Steam Hour Booster Pro</h1>
        <p id="userLabel">Connecting account...</p>
      </div>
      <div class="header-actions">
        <button class="btn-purple" id="cardsBtn" onclick="toggleCards()">🃏 Cards: OFF</button>
        <button class="btn-action-sm" onclick="claimFreeGames()">🎁 Claim Free</button>
        <button class="btn-action-sm" id="personaBtn" onclick="togglePersona()">Mode: Online</button>
        <button class="btn-action-sm" onclick="lock()">🔒 Lock</button>
        <div class="badge-status" id="badgeStatus"><span class="dot"></span> <span id="statusText">Active</span></div>
      </div>
    </header>

    <div class="dashboard-panel">
      <div class="stats-row">
        <div class="stat-item">
          <label>⏱️ Session Time</label>
          <value id="timerVal">00h 00m 00s</value>
        </div>
        <div class="stat-item">
          <label>⚡ Total Hours Boosted</label>
          <value id="hoursVal">+0.0 hrs</value>
        </div>
        <div class="stat-item">
          <label>🎯 Parallel Games</label>
          <value id="gamesCountVal">0 / 32</value>
        </div>
        <div class="stat-item">
          <label>🏆 Queued Achievements</label>
          <value id="achQueueVal">0 queued</value>
        </div>
      </div>
      <div>
        <div class="capacity-header">
          <span>Profile Boosting Capacity (Maximum 32 games)</span>
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
          <input type="text" id="searchInput" placeholder="Search game title or enter AppID..." autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
        <button class="btn-main" id="playBtn" onclick="togglePause()">Resume / Play Now</button>
        <button class="btn-clear" onclick="clearAll()">Clear All Games</button>
      </div>

      <div class="presets-row" id="presetsContainer">
        <span style="font-size:0.8rem; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Quick Presets:</span>
      </div>

      <div class="tools-grid">
        <div class="tool-box">
          <span style="font-size:0.85rem; font-weight:700; color:var(--text-muted); white-space:nowrap;">Custom Status:</span>
          <input type="text" id="customStatusInput" placeholder="e.g. AFK 24/7">
          <button class="btn-main" style="padding:10px 18px; font-size:0.85rem;" onclick="saveCustomStatus()">Save</button>
        </div>
        <div class="tool-box">
          <span style="font-size:0.85rem; font-weight:700; color:var(--text-muted); white-space:nowrap;">Discord Webhook:</span>
          <input type="text" id="webhookInput" placeholder="https://discord.com/api/webhooks/...">
          <button class="btn-main" style="padding:10px 18px; font-size:0.85rem;" onclick="saveWebhook()">Test</button>
        </div>
      </div>

      <div class="tools-grid">
        <div class="tool-box" style="justify-content:space-between;">
          <span style="font-size:0.85rem; font-weight:700; color:var(--text-muted);">💤 Sleep Schedule:</span>
          <label style="font-size:0.85rem; display:flex; align-items:center; gap:6px;">
            <input type="checkbox" id="sleepEnabled"> Active
          </label>
          <input type="number" id="sleepStart" placeholder="From (03)" style="width:85px;" min="0" max="23">
          <input type="number" id="sleepEnd" placeholder="To (08)" style="width:85px;" min="0" max="23">
          <button class="btn-main" style="padding:10px 18px; font-size:0.85rem;" onclick="saveSleep()">Set</button>
        </div>
        <div class="tool-box" style="color:var(--text-muted); font-size:0.85rem;">
          <span>💬 <strong>Steam Chat Active:</strong> Send <code>!status</code> to this bot from another account to control it via chat.</span>
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
    var searchQuery = '';

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
      } else { alert('Incorrect PIN.'); }
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

        renderAccountsTabs(data.accounts, data.activeAccountId);

        if (!data.activeAccount) return;
        var acc = data.activeAccount;

        document.getElementById('userLabel').innerText = acc.name + ' (' + acc.user + ')';
        activeGamesCount = (acc.isPaused || acc.isCollisionPaused || acc.isSleepPaused) ? 0 : acc.games.length;
        sessionStart = acc.sessionStartTime;
        namesCache = acc.gameNames || {};

        document.getElementById('gamesCountVal').innerText = acc.games.length + ' / 32';
        document.getElementById('achQueueVal').innerText = acc.queueCount + (acc.nextAchievementIn !== null ? ' (~' + acc.nextAchievementIn + 'm remaining)' : ' queued');
        var percent = Math.round((acc.games.length / 32) * 100);
        document.getElementById('capacityPercent').innerText = percent + '%';
        document.getElementById('capacityFill').style.width = percent + '%';

        var badge = document.getElementById('badgeStatus');
        var statusText = document.getElementById('statusText');
        var playBtn = document.getElementById('playBtn');
        var personaBtn = document.getElementById('personaBtn');
        var cardsBtn = document.getElementById('cardsBtn');

        if (acc.isCollisionPaused) {
          badge.className = 'badge-status collision';
          statusText.innerText = 'Game Running on PC';
          playBtn.innerText = 'Resume / Play Now';
        } else if (acc.isSleepPaused) {
          badge.className = 'badge-status sleep';
          statusText.innerText = 'Sleep Mode (Night)';
          playBtn.innerText = 'Resume / Play Now';
        } else if (acc.isPaused) {
          badge.className = 'badge-status paused';
          statusText.innerText = 'Paused';
          playBtn.innerText = 'Resume / Play Now';
        } else {
          badge.className = 'badge-status';
          statusText.innerText = 'Boosting Active';
          playBtn.innerText = 'Pause Boosting';
        }

        personaBtn.innerText = (acc.personaState === 7) ? '👻 Mode: Invisible' : '🟢 Mode: Online';
        cardsBtn.innerText = acc.cardFarming ? '🃏 Cards: ACTIVE' : '🃏 Cards: OFF';

        if (acc.customStatus && !document.getElementById('customStatusInput').value) document.getElementById('customStatusInput').value = acc.customStatus;
        if (data.discordWebhook && !document.getElementById('webhookInput').value) document.getElementById('webhookInput').value = data.discordWebhook;
        if (acc.sleepMode) {
          document.getElementById('sleepEnabled').checked = acc.sleepMode.enabled;
          document.getElementById('sleepStart').value = acc.sleepMode.start;
          document.getElementById('sleepEnd').value = acc.sleepMode.end;
        }

        renderPresets(data.presets);
        renderGames(acc.games);
      } catch (e) { console.error(e); }
    }

    function renderAccountsTabs(accounts, activeId) {
      var cont = document.getElementById('accountsTabsContainer');
      cont.innerHTML = '';
      (accounts || []).forEach(a => {
        var pill = document.createElement('div');
        pill.className = 'acc-pill ' + (a.id === activeId ? 'active' : '');
        pill.innerHTML = '<span class="dot"></span> ' + a.name + ' (' + a.gameCount + ')';
        pill.onclick = () => switchAccount(a.id);
        cont.appendChild(pill);
      });
    }

    async function switchAccount(accountId) {
      await reqAction('/api/account/switch', { accountId });
      loadStatus();
    }

    function openAddAccModal() { document.getElementById('addAccModal').style.display = 'flex'; }
    function closeAddAccModal() { document.getElementById('addAccModal').style.display = 'none'; }

    async function submitAddAccount() {
      var name = document.getElementById('newAccName').value.trim();
      var user = document.getElementById('newAccUser').value.trim();
      var token = document.getElementById('newAccToken').value.trim();
      if (!user) return alert('Username or email is required.');

      var res = await reqAction('/api/account/add', { name, user, refreshToken: token });
      if (res && res.success) {
        closeAddAccModal();
        loadStatus();
      }
    }

    async function deleteCurrentAccount() {
      if (!confirm('Are you sure you want to remove this account profile from the booster?')) return;
      var res = await reqAction('/api/account/remove', {});
      if (res && res.error) alert(res.error);
      else loadStatus();
    }

    function renderPresets(presets) {
      var container = document.getElementById('presetsContainer');
      container.innerHTML = '<span style="font-size:0.8rem; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Quick Presets:</span>';
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
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:var(--text-muted);">No games added yet. Add a game above or load a quick preset.</div>';
        return;
      }

      games.forEach(function(id) {
        var title = namesCache[id] || ('Game #' + id);
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
              '<button class="btn-card btn-ach" onclick="openAchModal(' + id + ', \\'' + title.replace(/'/g, "\\\\'") + '\\')">🏆 Achievements</button>' +
              '<button class="btn-card btn-remove" onclick="removeGame(' + id + ')">Remove</button>' +
            '</div>' +
          '</div>';
        grid.appendChild(card);
      });
    }

    async function openAchModal(appid, title, forceRefresh) {
      currentAchAppId = appid;
      currentAchGameName = title;
      selectedApinames.clear();
      filterStatus = 'all';
      filterRarity = 'all';
      currentSort = 'default';
      searchQuery = '';
      
      document.getElementById('achSortSelect').value = 'default';
      document.getElementById('achSearchInput').value = '';
      document.getElementById('achGameTitle').innerText = title;
      document.getElementById('achProgressText').innerText = 'Syncing achievements directly with Steam...';
      document.getElementById('achProgressFill').style.width = '0%';
      document.getElementById('achPrivacyWarning').style.display = 'none';
      document.getElementById('achListContainer').innerHTML = '<p style="text-align:center; padding:40px; color:var(--text-muted);">Loading full trophies catalog...</p>';
      document.getElementById('achModal').style.display = 'flex';
      
      updateFilterButtonsUI();
      updateBatchToolbar();

      try {
        var fetchUrl = '/api/achievements?appid=' + appid + (forceRefresh ? '&refresh=1' : '');
        var res = await fetch(fetchUrl);
        var data = await res.json();
        
        currentAchList = Array.isArray(data) ? data : (data.achievements || []);
        var isPrivate = data.isPrivate || false;

        document.getElementById('achPrivacyWarning').style.display = isPrivate ? 'block' : 'none';
        renderAchModal();
      } catch (e) {
        document.getElementById('achProgressText').innerText = 'Error loading';
        document.getElementById('achListContainer').innerHTML = '<p style="text-align:center; color:var(--danger);">Failed to query achievements from Steam.</p>';
      }
    }

    function forceRefreshAchievements() {
      if (currentAchAppId) {
        openAchModal(currentAchAppId, currentAchGameName, true);
      }
    }

    function closeAchModal() { document.getElementById('achModal').style.display = 'none'; }

    function updateFilterButtonsUI() {
      document.querySelectorAll('.filter-btn').forEach(btn => {
        var type = btn.getAttribute('data-filter');
        var val = btn.getAttribute('data-val');
        if (type === 'status') {
          if (val === filterStatus) btn.classList.add('active');
          else btn.classList.remove('active');
        } else if (type === 'rarity') {
          if (val === filterRarity) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    }

    function setFilter(type, val) {
      if (type === 'status') {
        filterStatus = val;
      } else if (type === 'rarity') {
        filterRarity = (filterRarity === val) ? 'all' : val;
      }
      updateFilterButtonsUI();
      renderAchModal();
    }

    function setSort(val) {
      currentSort = val;
      renderAchModal();
    }

    function onSearchInput(val) {
      searchQuery = val.trim().toLowerCase();
      renderAchModal();
    }

    function renderAchModal() {
      var cont = document.getElementById('achListContainer');
      cont.innerHTML = '';

      if (!currentAchList || !currentAchList.length) {
        document.getElementById('achProgressText').innerText = '0 achievements found';
        document.getElementById('achProgressFill').style.width = '0%';
        cont.innerHTML = '<p style="text-align:center; padding:30px; color:var(--text-muted);">This game has no public achievements on Steam.</p>';
        return;
      }

      var totalUnlocked = currentAchList.filter(x => x.unlocked).length;
      var pctTotal = Math.round((totalUnlocked / currentAchList.length) * 100);
      document.getElementById('achProgressText').innerText = totalUnlocked + ' of ' + currentAchList.length + ' unlocked (' + pctTotal + '%)';
      document.getElementById('achProgressFill').style.width = pctTotal + '%';

      var filteredList = currentAchList.filter(function(a) {
        var matchesSearch = !searchQuery || a.name.toLowerCase().includes(searchQuery) || (a.description && a.description.toLowerCase().includes(searchQuery));
        
        var matchesStatus = true;
        if (filterStatus === 'locked') matchesStatus = !a.unlocked;
        else if (filterStatus === 'unlocked') matchesStatus = a.unlocked;
        else if (filterStatus === 'queue') matchesStatus = a.inQueue;

        var matchesRarity = true;
        var p = parseFloat(a.percent) || 0;
        if (filterRarity === 'mythic') matchesRarity = p < 5.0;
        else if (filterRarity === 'epic') matchesRarity = p >= 5.0 && p < 15.0;
        else if (filterRarity === 'rare') matchesRarity = p >= 15.0 && p < 40.0;

        return matchesSearch && matchesStatus && matchesRarity;
      });

      if (currentSort === 'locked_first') {
        filteredList.sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? 1 : -1));
      } else if (currentSort === 'unlocked_first') {
        filteredList.sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1));
      } else if (currentSort === 'rarity_rare') {
        filteredList.sort((a, b) => (parseFloat(a.percent) || 0) - (parseFloat(b.percent) || 0));
      } else if (currentSort === 'rarity_common') {
        filteredList.sort((a, b) => (parseFloat(b.percent) || 0) - (parseFloat(a.percent) || 0));
      } else if (currentSort === 'alpha') {
        filteredList.sort((a, b) => a.name.localeCompare(b.name));
      }

      if (!filteredList.length) {
        cont.innerHTML = '<p style="text-align:center; padding:30px; color:var(--text-muted);">No achievements match the selected filters.</p>';
        updateBatchToolbar();
        return;
      }

      filteredList.forEach(function(a) {
        var pctNum = parseFloat(a.percent) || 0;
        var rarityClass = 'gray';
        if (pctNum < 5.0) rarityClass = 'gold';
        else if (pctNum < 15.0) rarityClass = 'purple';
        else if (pctNum < 40.0) rarityClass = 'blue';

        var statusClass = a.unlocked ? 'unlocked-item' : 'locked-item';
        var div = document.createElement('div');
        div.className = 'ach-item ' + rarityClass + ' ' + statusClass + (selectedApinames.has(a.apiname) ? ' selected' : '');
        div.setAttribute('data-apiname', a.apiname);
        
        var dateLabel = a.unlockDate ? '<small style="color:var(--success); font-size:0.75rem; display:block; margin-top:2px;">Unlocked: ' + a.unlockDate + '</small>' : '';

        div.innerHTML = 
          '<input type="checkbox" class="ach-checkbox" ' + (selectedApinames.has(a.apiname) ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleSelectSingle(\\'' + a.apiname.replace(/'/g, "\\\\'") + '\\', this.checked)">' +
          '<img src="' + (a.unlocked ? (a.iconOpen || a.iconClosed) : a.iconClosed) + '" onerror="this.src=\\'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png\\'">' +
          '<div class="ach-info">' +
            '<div class="ach-title">' + a.name + ' <span class="ach-badge" style="color:var(--text-muted);">(' + a.tier + ' • ' + a.percent + '%)</span></div>' +
            '<div class="ach-desc">' + a.description + '</div>' +
            dateLabel +
          '</div>' +
          '<div>' +
            (a.unlocked 
              ? '<span style="color:var(--success); font-weight:700; font-size:0.8rem;">✓ Unlocked</span>' 
              : (a.inQueue 
                  ? '<span style="color:var(--warning); font-weight:700; font-size:0.8rem;">⏳ Queued</span>' 
                  : '<span style="color:var(--text-muted); font-size:0.8rem;">🔒 Locked</span>')) +
          '</div>';

        div.onclick = function() {
          var isChecked = !selectedApinames.has(a.apiname);
          toggleSelectSingle(a.apiname, isChecked);
          div.querySelector('.ach-checkbox').checked = isChecked;
        };

        cont.appendChild(div);
      });

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
        var apiname = row.getAttribute('data-apiname');
        if (isChecked) {
          selectedApinames.add(apiname);
          row.classList.add('selected');
          var cb = row.querySelector('.ach-checkbox');
          if (cb) cb.checked = true;
        } else {
          row.classList.remove('selected');
          var cb = row.querySelector('.ach-checkbox');
          if (cb) cb.checked = false;
        }
      });
      updateBatchToolbar();
    }

    function updateBatchToolbar() {
      var count = selectedApinames.size;
      document.getElementById('selectedCountText').innerText = count + ' selected';
      document.getElementById('selectAllCheckbox').checked = count > 0 && count === currentAchList.length;

      var estText = document.getElementById('estimatedTimeText');
      if (count > 0) {
        var minHours = ((count * 45) / 60).toFixed(1);
        var maxHours = ((count * 85) / 60).toFixed(1);
        estText.innerText = '⏱️ Organic Cadence: ~' + minHours + 'h to ' + maxHours + 'h';
      } else {
        estText.innerText = '';
      }
    }

    async function unlockSelected() {
      if (!selectedApinames.size) return alert('Select at least one achievement first by checking the boxes.');
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
      if (!selectedApinames.size) return alert('Select at least one achievement first.');
      if (!confirm('Are you sure you want to re-lock the ' + selectedApinames.size + ' selected achievements on the dashboard?')) return;
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
      if (!selectedApinames.size) return alert('Select the achievements you want to queue.');
      var items = currentAchList.filter(x => selectedApinames.has(x.apiname) && !x.unlocked && !x.inQueue);
      if (!items.length) return alert('All selected achievements are already unlocked or queued.');
      
      await reqAction('/api/queue-achievements', {
        appid: currentAchAppId,
        gameName: currentAchGameName,
        items: items
      });
      alert('⚡ ' + items.length + ' achievements scheduled. They will be unlocked organically every 45-85 minutes.');
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
      if (res.status === 401) { alert('Incorrect PIN or session expired.'); lock(); return null; }
      return data;
    }

    async function addGame(appid, name) {
      var data = await reqAction('/api/add', { appid: Number(appid), name: name || '' });
      if (data && data.error) alert(data.error);
      else { searchInput.value = ''; loadStatus(); }
    }

    async function removeGame(appid) { await reqAction('/api/remove', { appid: Number(appid) }); loadStatus(); }
    async function clearAll() { if (confirm('Are you sure you want to clear the entire list for this profile?')) { await reqAction('/api/clear-all'); loadStatus(); } }
    async function applyPreset(presetKey) { await reqAction('/api/apply-preset', { presetKey: presetKey }); loadStatus(); }
    async function togglePause() { await reqAction('/api/toggle'); loadStatus(); }
    async function togglePersona() { await reqAction('/api/persona'); loadStatus(); }
    async function toggleCards() { await reqAction('/api/toggle-cards'); loadStatus(); }
    async function claimFreeGames() { var res = await reqAction('/api/claim-free'); if (res) alert('Free licenses requested from Steam.'); }

    async function saveSleep() {
      await reqAction('/api/set-sleep', {
        enabled: document.getElementById('sleepEnabled').checked,
        start: document.getElementById('sleepStart').value,
        end: document.getElementById('sleepEnd').value
      });
      alert('Sleep schedule saved.');
      loadStatus();
    }

    async function saveCustomStatus() {
      await reqAction('/api/custom-status', { status: document.getElementById('customStatusInput').value });
      alert('Custom status updated on Steam.');
      loadStatus();
    }

    async function saveWebhook() {
      var webhook = document.getElementById('webhookInput').value.trim();
      var res = await reqAction('/api/set-webhook', { webhook: webhook });
      if (res && res.success) alert('✅ Webhook linked successfully! Check your Discord channel.');
      else alert('❌ Error sending message: ' + (res ? res.error : 'Unknown'));
      loadStatus();
    }

    checkAuth();
    setInterval(loadStatus, 3000);
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log('[Web] Enterprise Multi-Account Server running on port ' + PORT));
