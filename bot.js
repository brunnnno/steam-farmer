const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');

// Configuration Loader
let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
cfg.webPin = String(cfg.webPin || '1234');
cfg.discordWebhook = cfg.discordWebhook || '';
cfg.accounts = cfg.accounts || [];

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
  competitive: { name: '🎯 Competitive', games: [730, 440, 570, 252490, 1172470, 578080], names: { 730: 'Counter-Strike 2', 440: 'Team Fortress 2', 570: 'Dota 2', 252490: 'Rust', 1172470: 'Apex Legends', 578080: 'PUBG' } },
  valve: { name: '🏆 Valve Classics', games: [10, 240, 220, 550, 620], names: { 10: 'Counter-Strike 1.6', 240: 'Counter-Strike: Source', 220: 'Half-Life 2', 550: 'Left 4 Dead 2', 620: 'Portal 2' } },
  aaa: { name: '🔥 AAA Hits', games: [271590, 1938090, 1091500, 292030, 379720], names: { 271590: 'Grand Theft Auto V', 1938090: 'Call of Duty®', 1091500: 'Cyberpunk 2077', 292030: 'The Witcher 3', 379720: 'DOOM' } }
};

function fetchWithRedirects(targetUrl, customHeaders, maxRedirects, cb) {
  if (typeof customHeaders === 'function') { cb = customHeaders; customHeaders = {}; maxRedirects = 5; }
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
        if (!next.startsWith('http')) next = parsed.protocol + '//' + parsed.hostname + next;
        if (targetUrl.includes('xml=1') && !next.includes('xml=1')) next += (next.includes('?') ? '&' : '?') + 'xml=1';
        return fetchWithRedirects(next, customHeaders, maxRedirects - 1, cb);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => cb(null, data, res.statusCode));
    }).on('error', (err) => cb(err, null));
  } catch (e) { cb(e, null); }
}

function sendDiscordWebhook(title, description, color, thumbUrl, cb) {
  if (!cfg.discordWebhook || !cfg.discordWebhook.includes('/api/webhooks/')) {
    if (cb) cb({ success: false, error: 'Invalid Webhook URL.' });
    return;
  }
  try {
    let targetUrl = cfg.discordWebhook.replace('https://discord.com', 'https://webhook.lewisakura.moe').replace('https://discordapp.com', 'https://webhook.lewisakura.moe');
    const embed = { title: title, description: description, color: color || 3718648, footer: { text: 'Steam Booster Enterprise • Achievement Engine' }, timestamp: new Date().toISOString() };
    if (thumbUrl) embed.thumbnail = { url: thumbUrl };
    const payload = JSON.stringify({ username: 'Steam Booster Enterprise', avatar_url: 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png', embeds: [embed] });

    const parsed = new URL(targetUrl);
    const req = https.request(parsed, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'SteamBoosterBot/3.0' } }, (res) => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { if (cb) cb({ success: true }); }
        else { if (cb) cb({ success: false, error: 'Discord error ' + res.statusCode + ': ' + resBody }); }
      });
    });
    req.on('error', (err) => { if (cb) cb({ success: false, error: err.message }); });
    req.write(payload);
    req.end();
  } catch (err) { if (cb) cb({ success: false, error: err.message }); }
}

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
    // Custom Status bugfix: Push string text to the top of games played
    if (acc.customStatus && acc.customStatus.trim() !== '') {
      list.unshift(acc.customStatus.trim());
    }
    client.gamesPlayed(list);
    if (!state.isFarming) state.sessionStartTime = Date.now();
    state.isFarming = true;
    console.log(`[+] [${acc.name}] Boosting ${acc.games.length} apps.`);
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

      if (!acc.unlockedAchievements[item.appid].includes(item.apiname)) acc.unlockedAchievements[item.appid].push(item.apiname);
      if (!acc.unlockedAchievements[item.appid].includes(item.name)) acc.unlockedAchievements[item.appid].push(item.name);

      sendDiscordWebhook(
        `🏆 Achievement Unlocked! • ${item.gameName} (${acc.name})`,
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
  if (content.startsWith('<![CDATA[') && content.endsWith(']]>')) content = content.substring(9, content.length - 3).trim();
  return content;
}

function parseAchievementsFromXml(xmlData, percentMap, titlePercentMap, appid, unlockedLocally) {
  const achievements = [];
  const achRegex = /<achievement\b[^>]*\bclosed="(\d+)"[^>]*>([\s\S]*?)<\/achievement>/gi;
  let match;

  while ((match = achRegex.exec(xmlData)) !== null) {
    const closedOriginal = match[1] === '1';
    const body = match[2];
    const apiname = getTag(body, 'apiname');
    const name = getTag(body, 'name') || apiname;
    const unlockTimestamp = parseInt(getTag(body, 'unlockTimestamp') || '0', 10);

    const normName = name.toLowerCase().trim();
    const pct = parseFloat(titlePercentMap[normName] || percentMap[apiname.toLowerCase()] || 25.0);

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
      apiname: apiname, name: name, description: getTag(body, 'description') || 'Steam Achievement',
      iconClosed: getTag(body, 'iconClosed'), iconOpen: getTag(body, 'iconOpen'),
      percent: pct, tier: tier, color: colorHex, unlocked: isUnlocked, unlockDate: unlockDateFormatted, unlockTimestamp: unlockTimestamp, inQueue: false
    });
  }
  return achievements;
}

function parseAchievementsFromHtml(html, unlockedSet, titlePercentMap, percentMap) {
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

      const normName = name.toLowerCase().trim();
      let pct = pctM ? parseFloat(pctM[1]) : parseFloat(titlePercentMap[normName] || percentMap[apiname.toLowerCase()] || 25.0);

      let tier = '⚪ Common';
      let colorHex = 0x94a3b8;
      if (pct < 5.0) { tier = '🟡 Mythic'; colorHex = 0xf59e0b; }
      else if (pct < 15.0) { tier = '🟣 Epic'; colorHex = 0xa855f7; }
      else if (pct < 40.0) { tier = '🔵 Rare'; colorHex = 0x38bdf8; }

      const rawDate = dateM ? dateM[1].replace(/<[^>]+>/g, '').replace(/Unlocked\s*/i, '').replace(/Desbloqueado el\s*/i, '').trim() : null;
      const isUnlocked = prevChunk.includes('unlocked') || Boolean(rawDate) || unlockedSet.has(name) || unlockedSet.has(apiname);

      list.push({
        apiname: apiname, name: name, description: desc || 'Steam Achievement',
        iconClosed: icon, iconOpen: icon, percent: pct, tier: tier, color: colorHex, unlocked: isUnlocked, unlockDate: rawDate, unlockTimestamp: 0, inQueue: false
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

  const urlGlobalApi = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appid}`;
  const urlGlobalHtml = `https://steamcommunity.com/stats/${appid}/achievements/?l=english`;

  fetchWithRedirects(urlGlobalApi, {}, 3, (errG, globalData) => {
    let percentMap = {};
    try {
      const parsedG = JSON.parse(globalData);
      if (parsedG.achievementpercentages && parsedG.achievementpercentages.achievements) {
        parsedG.achievementpercentages.achievements.forEach(a => { percentMap[a.name.toLowerCase()] = parseFloat(a.percent).toFixed(1); });
      }
    } catch (e) {}

    fetchWithRedirects(urlGlobalHtml, {}, 5, (errGHtml, gHtmlData) => {
      let titlePercentMap = {};
      if (!errGHtml && gHtmlData) {
        const rows = gHtmlData.split(/class=["'][^"']*achieveRow/i);
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const h3M = r.match(/<h3>([\s\S]*?)<\/h3>/i);
          const pctM = r.match(/class=["'][^"']*achievePercent[^"']*["'][^>]*>\s*([0-9.]+)\s*%/i);
          if (h3M && pctM) {
            const cleanTitle = h3M[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
            titlePercentMap[cleanTitle] = parseFloat(pctM[1]).toFixed(1);
          }
        }
      }

      const targetXmlUrl = userSteamId ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?xml=1` : `https://steamcommunity.com/stats/${appid}/achievements/?xml=1`;

      fetchWithRedirects(targetXmlUrl, xmlHeaders, 5, (errXml, xmlData) => {
        let isProfilePrivate = false;
        if (xmlData && (xmlData.includes('profile is private') || xmlData.includes('Specified profile could not be found') || xmlData.includes('<error>'))) isProfilePrivate = true;

        if (!errXml && xmlData && xmlData.includes('<achievement') && !isProfilePrivate) {
          const listXml = parseAchievementsFromXml(xmlData, percentMap, titlePercentMap, appid, unlockedLocally);
          if (listXml.length > 0) {
            achMemoryCache[cacheKey] = { achievements: listXml, isPersonalized: true, isPrivate: false };
            return cb(achMemoryCache[cacheKey]);
          }
        }

        const unlockedSet = new Set(unlockedLocally);
        const targetUserHtml = userSteamId ? `https://steamcommunity.com/profiles/${userSteamId}/stats/${appid}/?tab=achievements&l=english` : `https://steamcommunity.com/stats/${appid}/achievements/?l=english`;

        fetchWithRedirects(targetUserHtml, xmlHeaders, 5, (errUHtml, uHtmlData) => {
          if (uHtmlData && (uHtmlData.includes('profile_private') || uHtmlData.includes('This profile is private') || uHtmlData.includes('Este perfil es privado'))) isProfilePrivate = true;

          if (!errUHtml && uHtmlData && uHtmlData.includes('achieveRow')) {
            const listU = parseAchievementsFromHtml(uHtmlData, unlockedSet, titlePercentMap, percentMap);
            if (listU.length > 0) {
              achMemoryCache[cacheKey] = { achievements: listU, isPersonalized: !isProfilePrivate, isPrivate: isProfilePrivate };
              return cb(achMemoryCache[cacheKey]);
            }
          }

          if (gHtmlData && gHtmlData.includes('achieveRow')) {
            const listG = parseAchievementsFromHtml(gHtmlData, unlockedSet, titlePercentMap, percentMap);
            if (listG.length > 0) return cb({ achievements: listG, isPersonalized: false, isPrivate: isProfilePrivate });
          }
          cb({ achievements: [], isPersonalized: false, isPrivate: isProfilePrivate });
        });
      });
    });
  });
}

const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html')) {
    try {
      const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(htmlContent);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error loading index.html. Please ensure the file exists in the same directory as bot.js');
    }
  }

  if (parsedUrl.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ name: 'Steam Booster Enterprise Multi-Account', short_name: 'SteamBooster', start_url: '/', display: 'standalone', background_color: '#070a13', theme_color: '#070a13', icons: [{ src: 'https://community.cloudflare.steamstatic.com/public/shared/images/responsive/share_steam_logo.png', sizes: '512x512', type: 'image/png' }] }));
  }

  if (parsedUrl.pathname === '/api/search' && req.method === 'GET') {
    const query = parsedUrl.query.term;
    if (!query) return res.end('[]');
    https.get('https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(query) + '&l=english&cc=US', (sRes) => {
      let data = ''; sRes.on('data', chunk => data += chunk);
      sRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).slice(0, 6).map(it => ({ id: it.id, name: it.name, img: it.tiny_image }));
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(results));
        } catch { res.end('[]'); }
      });
    }).on('error', () => res.end('[]'));
    return;
  }

  if (parsedUrl.pathname === '/api/achievements' && req.method === 'GET') {
    const appid = parseInt(parsedUrl.query.appid, 10);
    const acc = getActiveAccount();
    if (!appid || !acc) return res.end(JSON.stringify({ achievements: [], isPrivate: false }));
    if (parsedUrl.query.refresh === '1') delete achMemoryCache[`${acc.id}_${appid}`];
    getAchievementsForAccount(acc, appid, (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); });
    return;
  }

  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const acc = getActiveAccount();
    const state = acc ? (accountStates[acc.id] || {}) : {};
    const nextItem = (acc && acc.achievementQueue && acc.achievementQueue.length > 0) ? acc.achievementQueue[0] : null;

    const accountsSummary = cfg.accounts.map(a => {
      const st = accountStates[a.id] || {};
      return { id: a.id, name: a.name, user: a.user, gameCount: a.games.length, isFarming: st.isFarming || false, isPaused: st.isPaused || false, isCollisionPaused: st.isCollisionPaused || false };
    });

    return res.end(JSON.stringify({
      activeAccountId: cfg.activeAccountId, accounts: accountsSummary,
      activeAccount: acc ? {
        id: acc.id, name: acc.name, user: acc.user, games: acc.games, gameNames: acc.gameNames || {},
        isFarming: state.isFarming || false, isPaused: state.isPaused || false, isCollisionPaused: state.isCollisionPaused || false, isSleepPaused: state.isSleepPaused || false,
        cardFarming: acc.cardFarming || false, cardDropCount: (state.cardDropGames || []).length, queueCount: (acc.achievementQueue || []).length,
        nextAchievementIn: nextItem ? Math.max(0, Math.round((nextItem.scheduledTime - Date.now()) / 60000)) : null,
        sleepMode: acc.sleepMode || { enabled: false, start: 3, end: 8 }, customStatus: acc.customStatus || '', personaState: acc.personaState !== undefined ? acc.personaState : SteamUser.EPersonaState.Online,
        sessionStartTime: state.isFarming ? state.sessionStartTime : null
      } : null,
      discordWebhook: cfg.discordWebhook || '', presets: Object.keys(PRESETS).map(k => ({ key: k, name: PRESETS[k].name, count: PRESETS[k].games.length }))
    }));
  }

  if (req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (cfg.webPin && String(data.pin) !== String(cfg.webPin)) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Incorrect PIN' })); }
        if (parsedUrl.pathname === '/api/verify-pin') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true })); }
        if (parsedUrl.pathname === '/api/account/switch') { const target = cfg.accounts.find(a => a.id === data.accountId); if (target) { cfg.activeAccountId = target.id; saveConfig(); } res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true, activeAccountId: cfg.activeAccountId })); }
        
        if (parsedUrl.pathname === '/api/account/add') {
          const newId = 'acc_' + Date.now();
          const newAcc = { id: newId, name: (data.name || 'Account ' + (cfg.accounts.length + 1)).trim(), user: (data.user || '').trim(), pass: data.pass || '', refreshToken: (data.refreshToken || '').trim(), games: [730], gameNames: { 730: 'Counter-Strike 2' }, customStatus: '', personaState: SteamUser.EPersonaState.Online, cardFarming: false, sleepMode: { enabled: false, start: 3, end: 8 }, achievementQueue: [], unlockedAchievements: {} };
          cfg.accounts.push(newAcc); cfg.activeAccountId = newId; saveConfig(); initializeAccount(newAcc);
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true, accountId: newId }));
        }

        if (parsedUrl.pathname === '/api/account/remove') {
          if (cfg.accounts.length <= 1) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'You must maintain at least one account.' })); }
          const removeId = data.accountId;
          if (clients[removeId]) { try { clients[removeId].logOff(); } catch (e) {} delete clients[removeId]; delete accountStates[removeId]; }
          cfg.accounts = cfg.accounts.filter(a => a.id !== removeId);
          if (cfg.activeAccountId === removeId) cfg.activeAccountId = cfg.accounts[0].id;
          saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true, activeAccountId: cfg.activeAccountId }));
        }

        const acc = getActiveAccount(); const state = acc ? (accountStates[acc.id] || {}) : {};

        if (parsedUrl.pathname === '/api/add') {
          const appid = parseInt(data.appid, 10);
          if (appid && !acc.games.includes(appid)) {
            if (acc.games.length >= 32) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Limit of 32 games reached for this account.' })); }
            acc.games.push(appid); state.isPaused = false; state.isCollisionPaused = false; if (state.collisionTimer) clearTimeout(state.collisionTimer);
            if (data.name) { acc.gameNames[appid] = data.name; saveConfig(); updateFarming(acc); } 
            else { fetchSteamGameName(appid, (name) => { if (name) acc.gameNames[appid] = name; saveConfig(); updateFarming(acc); }); }
          }
        }

        if (parsedUrl.pathname === '/api/remove') { const appid = parseInt(data.appid, 10); acc.games = acc.games.filter(id => id !== appid); delete acc.gameNames[appid]; delete achMemoryCache[`${acc.id}_${appid}`]; saveConfig(); updateFarming(acc); }
        if (parsedUrl.pathname === '/api/clear-all') { acc.games = []; acc.gameNames = {}; saveConfig(); updateFarming(acc); }
        if (parsedUrl.pathname === '/api/apply-preset') {
          const preset = PRESETS[data.presetKey];
          if (preset) { preset.games.forEach(gid => { if (!acc.games.includes(gid) && acc.games.length < 32) { acc.games.push(gid); acc.gameNames[gid] = preset.names[gid] || ('Game #' + gid); } }); state.isPaused = false; state.isCollisionPaused = false; if (state.collisionTimer) clearTimeout(state.collisionTimer); saveConfig(); updateFarming(acc); }
        }

        if (parsedUrl.pathname === '/api/toggle') { state.isPaused = !state.isPaused; if (!state.isPaused) { state.isCollisionPaused = false; state.isSleepPaused = false; if (state.collisionTimer) { clearTimeout(state.collisionTimer); state.collisionTimer = null; } } updateFarming(acc); }
        if (parsedUrl.pathname === '/api/persona') { acc.personaState = (acc.personaState === SteamUser.EPersonaState.Invisible) ? SteamUser.EPersonaState.Online : SteamUser.EPersonaState.Invisible; if (clients[acc.id]) clients[acc.id].setPersona(acc.personaState); saveConfig(); }
        if (parsedUrl.pathname === '/api/custom-status') { acc.customStatus = (data.status || '').trim(); saveConfig(); updateFarming(acc); }
        if (parsedUrl.pathname === '/api/set-webhook') { cfg.discordWebhook = (data.webhook || '').trim(); saveConfig(); sendDiscordWebhook('🔔 Webhook Connected', 'Discord channel linked successfully!', 3718648, null, (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); }); return; }

        if (parsedUrl.pathname === '/api/unlock-batch') {
          const { appid, gameName, items } = data;
          acc.unlockedAchievements = acc.unlockedAchievements || {}; acc.unlockedAchievements[appid] = acc.unlockedAchievements[appid] || [];
          items.forEach(it => { if (!acc.unlockedAchievements[appid].includes(it.apiname)) acc.unlockedAchievements[appid].push(it.apiname); if (!acc.unlockedAchievements[appid].includes(it.name)) acc.unlockedAchievements[appid].push(it.name); });
          delete achMemoryCache[`${acc.id}_${appid}`]; saveConfig();
          sendDiscordWebhook(`🏆 Achievements Recorded • ${gameName} (${acc.name})`, `Marked **${items.length} achievements** in the cloud dashboard.`, 3718648);
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/lock-batch') {
          const { appid, apinames } = data;
          if (acc.unlockedAchievements && acc.unlockedAchievements[appid]) acc.unlockedAchievements[appid] = acc.unlockedAchievements[appid].filter(id => !apinames.includes(id));
          acc.achievementQueue = (acc.achievementQueue || []).filter(q => !(q.appid == appid && apinames.includes(q.apiname)));
          delete achMemoryCache[`${acc.id}_${appid}`]; saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true }));
        }

        if (parsedUrl.pathname === '/api/queue-achievements') {
          const { appid, gameName, items } = data; let baseDelay = 5; acc.achievementQueue = acc.achievementQueue || [];
          items.forEach(it => {
            const alreadyQueued = acc.achievementQueue.some(q => q.appid == appid && (q.apiname === it.apiname || q.name === it.name));
            if (!alreadyQueued) {
              const delayMin = baseDelay; acc.achievementQueue.push({ appid: appid, gameName: gameName, apiname: it.apiname, name: it.name, desc: it.description, icon: it.iconOpen || it.iconClosed, percent: it.percent, tier: it.tier, color: it.color, scheduledTime: Date.now() + (delayMin * 60 * 1000) });
              baseDelay += Math.floor(Math.random() * (85 - 45 + 1)) + 45;
            }
          });
          saveConfig(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true, count: items.length }));
        }

        if (parsedUrl.pathname === '/api/clear-queue') { acc.achievementQueue = []; saveConfig(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true })); }
        if (parsedUrl.pathname === '/api/toggle-cards') { acc.cardFarming = !acc.cardFarming; saveConfig(); if (acc.cardFarming) scanCards(acc, () => updateFarming(acc)); else updateFarming(acc); }
        if (parsedUrl.pathname === '/api/claim-free') {
          const freePackages = [730, 440, 570, 230410, 1172470];
          if (clients[acc.id]) { clients[acc.id].requestFreeLicense(freePackages, (err, grantedApps) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, granted: grantedApps ? grantedApps.length : 0 })); }); return; }
        }
        if (parsedUrl.pathname === '/api/set-sleep') { acc.sleepMode = { enabled: Boolean(data.enabled), start: parseInt(data.start || 3, 10), end: parseInt(data.end || 8, 10) }; saveConfig(); }

        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, games: acc.games }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  
  // Return 404 for anything else
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log('[Web] Enterprise Multi-Account Server running on port ' + PORT));
