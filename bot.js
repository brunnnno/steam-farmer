const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');

let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
cfg.games = cfg.games || [];
cfg.gameNames = cfg.gameNames || {};
cfg.customStatus = cfg.customStatus || '';
cfg.personaState = cfg.personaState !== undefined ? cfg.personaState : SteamUser.EPersonaState.Invisible;

const client = new SteamUser();

let isFarming = false;
let isPaused = false;
let sessionStartTime = Date.now();

// Conexión
const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] Conectado exitosamente a Steam.');
  client.setPersona(cfg.personaState);
  resolverNombresFaltantes();
  actualizarFarmeo();
});

client.on('error', (e) => console.error('Error Steam:', e.message));

// Resuelve nombres de juegos que sólo tenían AppID
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
  https.get(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic&l=spanish`, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json[appid] && json[appid].success) {
          cb(json[appid].data.name);
        } else cb(null);
      } catch { cb(null); }
    });
  }).on('error', () => cb(null));
}

function actualizarFarmeo() {
  if (!isPaused && cfg.games.length > 0) {
    const list = [...cfg.games];
    if (cfg.customStatus && cfg.customStatus.trim() !== '') {
      list.push(cfg.customStatus.trim());
    }
    client.gamesPlayed(list);
    if (!isFarming) sessionStartTime = Date.now();
    isFarming = true;
    console.log(`[+] Farmeando ${cfg.games.length} juegos.`);
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

// Servidor Web
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
      icons: [{
        src: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg',
        sizes: '512x512',
        type: 'image/svg+xml'
      }]
    }));
  }

  // Buscador de juegos
  if (parsedUrl.pathname === '/api/search' && req.method === 'GET') {
    const query = parsedUrl.query.term;
    if (!query) return res.end('[]');

    https.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=spanish&cc=US`, (sRes) => {
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

  // Estado general
  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      user: cfg.user,
      games: cfg.games,
      gameNames: cfg.gameNames,
      isFarming: isFarming,
      isPaused: isPaused,
      customStatus: cfg.customStatus || '',
      personaState: cfg.personaState,
      sessionStartTime: isFarming ? sessionStartTime : null
    }));
  }

  // Acciones (SIN PIN)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');

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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, games: cfg.games, personaState: cfg.personaState, isPaused }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Interfaz HTML Ultra Moderna
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Steam Hour Booster Pro</title>
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
      --danger: #f43f5e;
      --danger-hover: #e11d48;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    body {
      background: radial-gradient(circle at 50% 0%, #151d30 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      padding: 30px 16px;
      display: flex;
      justify-content: center;
    }
    .container { width: 100%; max-width: 980px; }

    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand h1 {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #fff 40%, var(--primary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand p { font-size: 0.85rem; color: var(--text-muted); margin-top: 3px; }
    .header-actions { display: flex; gap: 10px; align-items: center; }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 14px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.12);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .badge-status.paused {
      background: rgba(244, 63, 94, 0.12);
      color: var(--danger);
      border-color: rgba(244, 63, 94, 0.25);
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .btn-persona {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: #cbd5e1;
      padding: 7px 15px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      backdrop-filter: blur(8px);
      transition: all 0.2s;
    }
    .btn-persona:hover { border-color: var(--primary); color: #fff; background: rgba(56, 189, 248, 0.1); }

    /* Capacity & Stats Bar */
    .dashboard-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(14px);
      border-radius: 16px;
      padding: 18px 22px;
      margin-bottom: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    .stat-item {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.04);
      padding: 12px 16px;
      border-radius: 12px;
    }
    .stat-item label { display: block; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .stat-item value { font-size: 1.15rem; font-weight: 800; color: #fff; }

    /* Progress bar */
    .capacity-container { display: flex; flex-direction: column; gap: 7px; }
    .capacity-header { display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
    .progress-bar-bg { width: 100%; height: 8px; background: rgba(0, 0, 0, 0.4); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.05); }
    .progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), #818cf8); border-radius: 999px; transition: width 0.4s ease; }

    /* Controls */
    .controls {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(14px);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 26px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .search-box-wrapper { position: relative; flex: 1; }
    .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
    input[type="text"] {
      flex: 1;
      min-width: 200px;
      background: rgba(7, 10, 19, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      color: #fff;
      padding: 12px 16px;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus { border-color: var(--primary); }
    
    button {
      padding: 12px 20px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.9rem;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn-main { background: var(--primary); color: #04111d; }
    .btn-main:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-pause { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .btn-pause:hover { background: rgba(255, 255, 255, 0.15); }
    .btn-clear { background: rgba(244, 63, 94, 0.1); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.2); }
    .btn-clear:hover { background: var(--danger); color: #fff; }

    /* Custom Status Row */
    .custom-status-row { display: flex; gap: 10px; align-items: center; background: rgba(0, 0, 0, 0.2); padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.04); }
    .custom-status-row input { padding: 8px 12px; font-size: 0.85rem; }

    /* Quick Chips */
    .chips-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .chip-label { font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); }
    .chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      color: #cbd5e1;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    .chip:hover { border-color: var(--primary); color: var(--primary); background: rgba(56, 189, 248, 0.08); }

    /* Dropdown de búsqueda */
    .search-results {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: #0f1626;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      box-shadow: 0 16px 35px rgba(0,0,0,0.6);
      max-height: 280px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }
    .search-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      transition: background 0.15s;
    }
    .search-item:hover { background: rgba(56, 189, 248, 0.1); }
    .search-item img { width: 52px; height: 24px; object-fit: cover; border-radius: 4px; }
    .search-info { flex: 1; font-size: 0.85rem; font-weight: 600; color: #fff; }
    .search-info span { display: block; font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }

    /* Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(10px);
      transition: all 0.25s ease;
    }
    .card:hover { transform: translateY(-4px); border-color: rgba(56, 189, 248, 0.3); box-shadow: 0 12px 25px rgba(0,0,0,0.4); }
    .card-banner { width: 100%; aspect-ratio: 460/215; object-fit: cover; background: #0c1220; display: block; }
    .card-content { padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .card-details { overflow: hidden; flex: 1; }
    .card-title { font-size: 0.9rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-appid { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; margin-top: 2px; }
    .btn-remove {
      background: rgba(244, 63, 94, 0.12);
      color: var(--danger);
      border: 1px solid rgba(244, 63, 94, 0.25);
      padding: 7px 13px;
      font-size: 0.8rem;
      border-radius: 8px;
    }
    .btn-remove:hover { background: var(--danger); color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>Steam Hour Booster Pro</h1>
        <p id="userLabel">Conectando cuenta...</p>
      </div>
      <div class="header-actions">
        <button class="btn-persona" id="personaBtn" onclick="togglePersona()">Modo: Invisible</button>
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
      </div>
      <div class="capacity-container">
        <div class="capacity-header">
          <span>Capacidad de Farmeo en Steam</span>
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

      <div class="custom-status-row">
        <span style="font-size:0.8rem; font-weight:700; color:var(--text-muted); white-space:nowrap;">Texto en perfil:</span>
        <input type="text" id="customStatusInput" placeholder="Ej: AFK 24/7 (opcional)">
        <button class="btn-main" style="padding:8px 14px; font-size:0.8rem;" onclick="saveCustomStatus()">Guardar</button>
      </div>

      <div class="chips-row">
        <span class="chip-label">Añadir rápidos:</span>
        <span class="chip" onclick="addGame(730, 'Counter-Strike 2')">CS2</span>
        <span class="chip" onclick="addGame(440, 'Team Fortress 2')">TF2</span>
        <span class="chip" onclick="addGame(570, 'Dota 2')">Dota 2</span>
        <span class="chip" onclick="addGame(271590, 'Grand Theft Auto V')">GTA V</span>
        <span class="chip" onclick="addGame(1938090, 'Call of Duty')">Call of Duty</span>
        <span class="chip" onclick="addGame(252490, 'Rust')">Rust</span>
      </div>
    </div>

    <div class="grid" id="gamesGrid"></div>
  </div>

  <script>
    let sessionStart = null;
    let activeGamesCount = 0;
    let namesCache = {};

    setInterval(() => {
      if (!sessionStart || activeGamesCount === 0) return;
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      document.getElementById('timerVal').innerText = \`\${h}h \${m}m \${sec}s\`;
      document.getElementById('hoursVal').innerText = '+' + ((s / 3600) * activeGamesCount).toFixed(1) + ' hrs';
    }, 1000);

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        document.getElementById('userLabel').innerText = 'Cuenta: ' + data.user;
        activeGamesCount = data.isPaused ? 0 : data.games.length;
        sessionStart = data.sessionStartTime;
        namesCache = data.gameNames || {};

        document.getElementById('gamesCountVal').innerText = data.games.length + ' / 32';
        const percent = Math.round((data.games.length / 32) * 100);
        document.getElementById('capacityPercent').innerText = percent + '%';
        document.getElementById('capacityFill').style.width = percent + '%';

        const badge = document.getElementById('badgeStatus');
        const statusText = document.getElementById('statusText');
        const pauseBtn = document.getElementById('pauseBtn');
        const personaBtn = document.getElementById('personaBtn');

        if (data.isPaused) {
          badge.className = 'badge-status paused';
          statusText.innerText = 'Pausado';
          pauseBtn.innerText = 'Reanudar';
        } else {
          badge.className = 'badge-status';
          statusText.innerText = 'Farmeando';
          pauseBtn.innerText = 'Pausar';
        }

        personaBtn.innerText = (data.personaState === 7) ? '👻 Modo: Invisible' : '🟢 Modo: En Línea';
        if (data.customStatus && !document.getElementById('customStatusInput').value) {
          document.getElementById('customStatusInput').value = data.customStatus;
        }

        renderGames(data.games);
      } catch (e) { console.error(e); }
    }

    function renderGames(games) {
      const grid = document.getElementById('gamesGrid');
      grid.innerHTML = '';
      if (!games.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:var(--text-muted);">No tienes juegos agregados. Agrega uno arriba para comenzar.</div>';
        return;
      }

      games.forEach(id => {
        const title = namesCache[id] || ('Juego #' + id);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <img class="card-banner" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/\${id}/header.jpg" onerror="this.src='https://placehold.co/460x215/0c1220/white?text=AppID+\${id}'">
          <div class="card-content">
            <div class="card-details">
              <div class="card-title" title="\${title}">\${title}</div>
              <div class="card-appid">AppID: \${id}</div>
            </div>
            <button class="btn-remove" onclick="removeGame(\${id})">Quitar</button>
          </div>
        \`;
        grid.appendChild(card);
      });
    }

    // Buscador interactivo
    let debounceTimer = null;
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const val = e.target.value.trim();
      if (!val || !isNaN(val)) {
        searchResults.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch('/api/search?term=' + encodeURIComponent(val));
          const list = await res.json();
          searchResults.innerHTML = '';
          if (list.length) {
            list.forEach(it => {
              const div = document.createElement('div');
              div.className = 'search-item';
              div.innerHTML = \`
                <img src="\${it.img}" onerror="this.style.display='none'">
                <div class="search-info">\${it.name}<span>AppID: \${it.id}</span></div>
              \`;
              div.onclick = () => {
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
        } catch { searchResults.style.display = 'none'; }
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.style.display = 'none';
      }
    });

    function addFromInput() {
      const v = searchInput.value.trim();
      if (!v) return;
      if (!isNaN(v)) addGame(Number(v));
    }

    async function addGame(appid, name = '') {
      await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: Number(appid), name })
      });
      searchInput.value = '';
      loadStatus();
    }

    async function removeGame(appid) {
      await fetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: Number(appid) })
      });
      loadStatus();
    }

    async function clearAll() {
      if (!confirm('¿Seguro que quieres quitar todos los juegos de la lista?')) return;
      await fetch('/api/clear-all', { method: 'POST' });
      loadStatus();
    }

    async function togglePause() {
      await fetch('/api/toggle', { method: 'POST' });
      loadStatus();
    }

    async function togglePersona() {
      await fetch('/api/persona', { method: 'POST' });
      loadStatus();
    }

    async function saveCustomStatus() {
      const status = document.getElementById('customStatusInput').value;
      await fetch('/api/custom-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      alert('Texto de estado guardado en Steam.');
      loadStatus();
    }

    loadStatus();
    setInterval(loadStatus, 15000);
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log(`[Web] Servidor listo en puerto ${PORT}`));
