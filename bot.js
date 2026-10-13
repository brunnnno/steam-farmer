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

const client = new SteamUser();

let isFarming = false;
let isPaused = false;
let isCollisionPaused = false;
let isSleepPaused = false;
let collisionTimer = null;
let sessionStartTime = Date.now();
let webCookies = '';
let cardDropGames = [];

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

function sendDiscordWebhook(title, description, color) {
  if (!cfg.discordWebhook || !cfg.discordWebhook.startsWith('https://discord.com/api/webhooks/')) return;
  try {
    const payload = JSON.stringify({
      embeds: [{
        title: title,
        description: description,
        color: color || 3718648,
        footer: { text: 'Steam Hour Booster Pro' },
        timestamp: new Date().toISOString()
      }]
    });
    const parsed = new URL(cfg.discordWebhook);
    const req = https.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (err) {}
}

const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] Conectado a Steam');
  client.setPersona(cfg.personaState);
  resolverNombresFaltantes();
  actualizarFarmeo();
  sendDiscordWebhook('🟢 Bot Iniciado', 'Farmeando ' + cfg.games.length + ' juegos en la nube.', 1095985);
});

client.on('webSession', (sessionID, cookies) => {
  webCookies = cookies.join('; ');
  console.log('[+] Sesión web de Steam establecida (Lista para cromos).');
  if (cfg.cardFarming) escanearCromos();
});

client.on('error', (e) => console.error('Error Steam:', e.message));

// Anti-Colisión: Se pausa cuando inicias un juego en tu PC
client.on('playingElsewhere', () => {
  console.log('[⚠️ Anti-Colisión] Partida detectada en PC real. Pausando bot...');
  isCollisionPaused = true;
  client.gamesPlayed([]);
  sendDiscordWebhook('🎮 Partida Detectada en PC', 'Bot pausado para no interrumpir tu juego. Se reanudará al finalizar.', 16101915);

  if (collisionTimer) clearTimeout(collisionTimer);
  collisionTimer = setTimeout(() => {
    console.log('[Anti-Colisión] Reanudando farmeo en la nube...');
    isCollisionPaused = false;
    actualizarFarmeo();
    sendDiscordWebhook('🔄 Farmeo Reanudado', 'El bot volvió a farmear en la nube automáticamente.', 1095985);
  }, 10 * 60 * 1000);
});

// Control Remoto por Chat de Steam
client.on('friendMessage', (steamID, message) => {
  const msg = message.trim().toLowerCase();
  const args = msg.split(' ');
  const cmd = args[0];

  function reply(text) {
    try { client.chatMessage(steamID, text); } catch (e) {}
  }

  if (cmd === '!status' || cmd === '!estado') {
    const estado = isPaused ? 'Pausado' : (isCollisionPaused ? 'Pausado por juego en PC' : 'Activo');
    reply(`📊 Estado: ${estado} | Juegos: ${cfg.games.length}/32 | Farmeando: ${cfg.games.join(', ')}`);
  } else if (cmd === '!pausa' || cmd === '!pause') {
    isPaused = true;
    actualizarFarmeo();
    reply('⏸️ Farmeo pausado.');
  } else if (cmd === '!reanudar' || cmd === '!resume' || cmd === '!play') {
    isPaused = false;
    actualizarFarmeo();
    reply('▶️ Farmeo reanudado.');
  } else if (cmd === '!invisible') {
    cfg.personaState = SteamUser.EPersonaState.Invisible;
    client.setPersona(cfg.personaState);
    guardarConfig();
    reply('👻 Modo cambiado a: Invisible.');
  } else if (cmd === '!online') {
    cfg.personaState = SteamUser.EPersonaState.Online;
    client.setPersona(cfg.personaState);
    guardarConfig();
    reply('🟢 Modo cambiado a: En Línea.');
  } else if (cmd === '!add' && args[1]) {
    const id = parseInt(args[1], 10);
    if (id && !cfg.games.includes(id) && cfg.games.length < 32) {
      cfg.games.push(id);
      guardarConfig();
      actualizarFarmeo();
      reply(`✅ Juego ${id} agregado a la lista.`);
    }
  } else if (cmd === '!remove' && args[1]) {
    const id = parseInt(args[1], 10);
    cfg.games = cfg.games.filter(x => x !== id);
    guardarConfig();
    actualizarFarmeo();
    reply(`🗑️ Juego ${id} quitado de la lista.`);
  } else if (cmd === '!help' || cmd === '!ayuda') {
    reply('🤖 Comandos: !status, !pausa, !reanudar, !add <id>, !remove <id>, !invisible, !online');
  }
});

// Escaneo y Auto-Farmeo de Cromos
function escanearCromos(cb) {
  if (!webCookies) {
    if (cb) cb([]);
    return;
  }
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

// Cronograma Inteligente (Modo Sueño)
setInterval(() => {
  if (!cfg.sleepMode || !cfg.sleepMode.enabled) return;
  const hour = new Date().getHours();
  const inSleep = (cfg.sleepMode.start < cfg.sleepMode.end)
    ? (hour >= cfg.sleepMode.start && hour < cfg.sleepMode.end)
    : (hour >= cfg.sleepMode.start || hour < cfg.sleepMode.end);

  if (inSleep && !isSleepPaused) {
    console.log('[💤 Cronograma] Modo sueño activado. Bot en pausa nocturna.');
    isSleepPaused = true;
    client.gamesPlayed([]);
  } else if (!inSleep && isSleepPaused) {
    console.log('[🌅 Cronograma] Modo sueño finalizado. Reanudando farmeo.');
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
    console.log('[+] Farmeando ' + cfg.games.length + ' juegos.');
  } else {
    client.gamesPlayed([]);
    isFarming = false;
    console.log('[-] Farmeo pausado.');
  }
}

function guardarConfig() {
  try {
    fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('Error guardando config:', e.message);
  }
}

const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      name: 'Steam Booster Pro',
      short_name: 'SteamBooster',
      start_url: '/',
      display: 'standalone',
      background_color: '#070a13',
      theme_color: '#070a13',
      icons: [{ src: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg', sizes: '512x512', type: 'image/svg+xml' }]
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

  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
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
          if (cfg.discordWebhook) {
            sendDiscordWebhook('🔔 Webhook Conectado', 'Notificaciones activadas.', 3718648);
          }
        }

        // Mega-Función: Toggle Modo Farmeo de Cromos
        if (parsedUrl.pathname === '/api/toggle-cards') {
          cfg.cardFarming = !cfg.cardFarming;
          guardarConfig();
          if (cfg.cardFarming) {
            escanearCromos(() => actualizarFarmeo());
          } else {
            actualizarFarmeo();
          }
        }

        // Mega-Función: Reclamar Licencias Gratuitas
        if (parsedUrl.pathname === '/api/claim-free') {
          const freePackages = [730, 440, 570, 230410, 1172470]; // Paquetes free habituales
          client.requestFreeLicense(freePackages, (err, grantedApps) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, granted: grantedApps ? grantedApps.length : 0 }));
          });
          return;
        }

        // Mega-Función: Configurar Modo Sueño
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

  // Frontend Ultra Completo
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Steam Hour Booster Enterprise</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#070a13">
  <link rel="apple-touch-icon" href="https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg">
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
    .container { width: 100%; max-width: 990px; }

    #lockModal {
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
    .lock-card h2 { font-size: 1.45rem; font-weight: 800; margin-bottom: 8px; color: #fff; }
    .lock-card p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 22px; }
    .lock-card input {
      width: 100%; padding: 13px; border-radius: 12px; background: #0b0f19;
      border: 1px solid var(--card-border); color: #fff; font-size: 1.3rem;
      text-align: center; letter-spacing: 5px; outline: none; margin-bottom: 18px;
    }

    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
    .brand h1 { font-size: 1.6rem; font-weight: 800; background: linear-gradient(135deg, #fff 40%, var(--primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand p { font-size: 0.85rem; color: var(--text-muted); }
    .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

    .badge-status { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25); }
    .badge-status.paused { background: rgba(244, 63, 94, 0.12); color: var(--danger); border-color: rgba(244, 63, 94, 0.25); }
    .badge-status.collision { background: rgba(245, 158, 11, 0.15); color: var(--warning); border-color: rgba(245, 158, 11, 0.3); }
    .badge-status.sleep { background: rgba(168, 85, 247, 0.15); color: var(--purple); border-color: rgba(168, 85, 247, 0.3); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

    .btn-action-sm { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border); color: #cbd5e1; padding: 7px 13px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-action-sm:hover { border-color: var(--primary); color: #fff; }

    .dashboard-panel { background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(14px); border-radius: 16px; padding: 18px 22px; margin-bottom: 22px; display: flex; flex-direction: column; gap: 16px; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
    .stat-item { background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.04); padding: 12px 16px; border-radius: 12px; }
    .stat-item label { display: block; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .stat-item value { font-size: 1.15rem; font-weight: 800; color: #fff; }

    .capacity-header { display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 7px; }
    .progress-bar-bg { width: 100%; height: 8px; background: rgba(0, 0, 0, 0.4); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05); }
    .progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), #818cf8); transition: width 0.4s ease; }

    .controls { background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(14px); border-radius: 16px; padding: 20px; margin-bottom: 26px; display: flex; flex-direction: column; gap: 16px; }
    .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .search-box-wrapper { position: relative; flex: 1; min-width: 220px; }
    input[type="text"], input[type="password"], input[type="number"] { width: 100%; background: rgba(7, 10, 19, 0.6); border: 1px solid var(--card-border); border-radius: 10px; color: #fff; padding: 12px 16px; font-size: 0.95rem; outline: none; }
    input:focus { border-color: var(--primary); }

    button { padding: 12px 20px; border-radius: 10px; font-weight: 700; font-size: 0.9rem; border: none; cursor: pointer; transition: all 0.2s; }
    .btn-main { background: var(--primary); color: #04111d; }
    .btn-main:hover { background: var(--primary-hover); }
    .btn-pause { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .btn-pause:hover { background: rgba(255, 255, 255, 0.15); }
    .btn-clear { background: rgba(244, 63, 94, 0.1); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.2); }
    .btn-clear:hover { background: var(--danger); color: #fff; }
    .btn-purple { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.3); }
    .btn-purple:hover { background: var(--purple); color: #fff; }

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
    .card-title { font-size: 0.9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .card-appid { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
    .btn-remove { background: rgba(244, 63, 94, 0.12); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.25); padding: 7px 13px; font-size: 0.8rem; border-radius: 8px; }
    .btn-remove:hover { background: var(--danger); color: #fff; }
  </style>
</head>
<body>
  <div id="lockModal">
    <div class="lock-card">
      <h2>🔒 Panel Enterprise</h2>
      <p>Introduce tu PIN para acceder</p>
      <input type="password" id="pinInput" placeholder="••••" maxlength="8">
      <button class="btn-main" style="width:100%;" onclick="unlock()">Desbloquear</button>
    </div>
  </div>

  <div class="container">
    <header>
      <div class="brand">
        <h1>Steam Hour Booster Enterprise</h1>
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
          <label>🃏 Juegos con Cromos</label>
          <value id="cardsCountVal">0 detectados</value>
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
          <input type="text" id="webhookInput" placeholder="https://discord.com/api/...">
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
          <span>💬 <strong>Chat Steam Activo:</strong> Escribe <code>!help</code> a este bot en Steam para controlarlo por mensaje.</span>
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
      
      var res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin })
      });

      if (res.ok) {
        savedPin = pin;
        localStorage.setItem('farmer_pin', pin);
        document.getElementById('lockModal').style.display = 'none';
        loadStatus();
      } else {
        alert('PIN incorrecto. Revisa el valor configurado en config.json.');
      }
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
        document.getElementById('cardsCountVal').innerText = data.cardDropCount + ' detectados';
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

        if (data.customStatus && !document.getElementById('customStatusInput').value) {
          document.getElementById('customStatusInput').value = data.customStatus;
        }
        if (data.discordWebhook && !document.getElementById('webhookInput').value) {
          document.getElementById('webhookInput').value = data.discordWebhook;
        }
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
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:var(--text-muted);">No tienes juegos agregados. Agrega uno arriba o activa el Modo Cromos.</div>';
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
            '<button class="btn-remove" onclick="removeGame(' + id + ')">Quitar</button>' +
          '</div>';
        grid.appendChild(card);
      });
    }

    var debounceTimer = null;
    var searchInput = document.getElementById('searchInput');
    var searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', function(e) {
      clearTimeout(debounceTimer);
      var val = e.target.value.trim();
      if (!val || !isNaN(val)) {
        searchResults.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async function() {
        try {
          var res = await fetch('/api/search?term=' + encodeURIComponent(val));
          var list = await res.json();
          searchResults.innerHTML = '';
          if (list && list.length) {
            list.forEach(function(it) {
              var div = document.createElement('div');
              div.className = 'search-item';
              div.innerHTML = 
                '<img src="' + it.img + '" onerror="this.style.display=\\'none\\'">' +
                '<div class="search-info">' + it.name + '<span>AppID: ' + it.id + '</span></div>';
              div.onclick = function() {
                addGame(it.id, it.name);
                searchResults.style.display = 'none';
                searchInput.value = '';
              };
              searchResults.appendChild(div);
            });
            searchResults.style.display = 'block';
          } else {
            searchResults.style.display = 'none';
          }
        } catch (e) { searchResults.style.display = 'none'; }
      }, 250);
    });

    document.addEventListener('click', function(e) {
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.style.display = 'none';
      }
    });

    function addFromInput() {
      var v = searchInput.value.trim();
      if (!v) return;
      if (!isNaN(v)) addGame(Number(v));
    }

    async function reqAction(endpoint, body) {
      body = body || {};
      body.pin = savedPin;
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (res.status === 401) {
        alert('PIN incorrecto o sesión caducada.');
        lock();
        return null;
      }
      return data;
    }

    async function addGame(appid, name) {
      var data = await reqAction('/api/add', { appid: Number(appid), name: name || '' });
      if (data && data.error) alert(data.error);
      else {
        searchInput.value = '';
        loadStatus();
      }
    }

    async function removeGame(appid) {
      await reqAction('/api/remove', { appid: Number(appid) });
      loadStatus();
    }

    async function clearAll() {
      if (!confirm('¿Seguro que deseas vaciar toda la lista?')) return;
      await reqAction('/api/clear-all');
      loadStatus();
    }

    async function applyPreset(presetKey) {
      await reqAction('/api/apply-preset', { presetKey: presetKey });
      loadStatus();
    }

    async function togglePause() {
      await reqAction('/api/toggle');
      loadStatus();
    }

    async function togglePersona() {
      await reqAction('/api/persona');
      loadStatus();
    }

    async function toggleCards() {
      await reqAction('/api/toggle-cards');
      loadStatus();
    }

    async function claimFreeGames() {
      var res = await reqAction('/api/claim-free');
      if (res) alert('Solicitud enviada a Steam para reclamar licencias gratuitas.');
    }

    async function saveSleep() {
      var enabled = document.getElementById('sleepEnabled').checked;
      var start = document.getElementById('sleepStart').value;
      var end = document.getElementById('sleepEnd').value;
      await reqAction('/api/set-sleep', { enabled: enabled, start: start, end: end });
      alert('Horario de sueño guardado.');
      loadStatus();
    }

    async function saveCustomStatus() {
      var status = document.getElementById('customStatusInput').value;
      await reqAction('/api/custom-status', { status: status });
      alert('Texto actualizado en Steam.');
      loadStatus();
    }

    async function saveWebhook() {
      var webhook = document.getElementById('webhookInput').value;
      await reqAction('/api/set-webhook', { webhook: webhook });
      alert('Webhook guardado y mensaje de prueba enviado.');
      loadStatus();
    }

    checkAuth();
    setInterval(loadStatus, 15000);
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log('[Web] Servidor Enterprise listo en puerto ' + PORT));
