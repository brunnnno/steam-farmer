const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');

let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
cfg.games = cfg.games || [];
cfg.gameNames = cfg.gameNames || {};
cfg.personaState = cfg.personaState !== undefined ? cfg.personaState : SteamUser.EPersonaState.Invisible;

const client = new SteamUser();

let isFarming = false;
let isPaused = false;
let sessionStartTime = Date.now();

// Conexión inicial
const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] Conectado a Steam');
  client.setPersona(cfg.personaState);
  actualizarFarmeo();
});

client.on('error', (e) => console.error('Error Steam:', e.message));

function actualizarFarmeo() {
  if (!isPaused && cfg.games.length > 0) {
    client.gamesPlayed(cfg.games);
    if (!isFarming) sessionStartTime = Date.now();
    isFarming = true;
    console.log(`[+] Farmeando ${cfg.games.length} juegos.`);
  } else {
    client.gamesPlayed([]);
    isFarming = false;
    console.log('[-] Farmeo en pausa.');
  }
}

function guardarConfig() {
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
}

// Servidor Web y API
const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // PWA Manifest
  if (parsedUrl.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      name: 'Steam Booster',
      short_name: 'SteamBooster',
      start_url: '/',
      display: 'standalone',
      background_color: '#0b0f19',
      theme_color: '#0b0f19',
      icons: [{
        src: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg',
        sizes: '512x512',
        type: 'image/svg+xml'
      }]
    }));
  }

  // API: Buscador de Steam Store
  if (parsedUrl.pathname === '/api/search' && req.method === 'GET') {
    const query = parsedUrl.query.term;
    if (!query) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }

    const steamApiUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=spanish&cc=US`;
    https.get(steamApiUrl, (steamRes) => {
      let data = '';
      steamRes.on('data', chunk => data += chunk);
      steamRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).slice(0, 7).map(item => ({
            id: item.id,
            name: item.name,
            img: item.tiny_image
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      });
    }).on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    return;
  }

  // API: Estado general
  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      user: cfg.user,
      games: cfg.games,
      gameNames: cfg.gameNames,
      isFarming: isFarming,
      isPaused: isPaused,
      personaState: cfg.personaState,
      sessionStartTime: isFarming ? sessionStartTime : null
    }));
  }

  // API: Acciones con PIN
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (cfg.webPin && data.pin !== cfg.webPin) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'PIN incorrecto' }));
        }

        // Agregar juego
        if (parsedUrl.pathname === '/api/add') {
          const appid = parseInt(data.appid, 10);
          if (appid && !cfg.games.includes(appid)) {
            if (cfg.games.length >= 32) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Límite de 32 juegos alcanzado' }));
            }
            cfg.games.push(appid);
            if (data.name) cfg.gameNames[appid] = data.name;
            guardarConfig();
            actualizarFarmeo();
          }
        }

        // Quitar juego
        if (parsedUrl.pathname === '/api/remove') {
          const appid = parseInt(data.appid, 10);
          cfg.games = cfg.games.filter(id => id !== appid);
          delete cfg.gameNames[appid];
          guardarConfig();
          actualizarFarmeo();
        }

        // Pausar / Reanudar
        if (parsedUrl.pathname === '/api/toggle') {
          isPaused = !isPaused;
          actualizarFarmeo();
        }

        // Cambiar Modo Invisible / En línea
        if (parsedUrl.pathname === '/api/persona') {
          cfg.personaState = (cfg.personaState === SteamUser.EPersonaState.Invisible) 
            ? SteamUser.EPersonaState.Online 
            : SteamUser.EPersonaState.Invisible;
          client.setPersona(cfg.personaState);
          guardarConfig();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, games: cfg.games, personaState: cfg.personaState }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Interfaz de Usuario
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Steam Boost Panel</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0b0f19">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg">
  <style>
    :root {
      --bg: #0b0f19;
      --card: #131b2e;
      --border: #1e293b;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --danger: #ef4444;
      --success: #22c55e;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 20px 15px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 950px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    .title h1 { font-size: 1.5rem; font-weight: 700; color: #fff; }
    .title p { font-size: 0.85rem; color: var(--text-muted); }
    .header-badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; background: rgba(34, 197, 94, 0.15); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge.paused { background: rgba(239, 68, 68, 0.15); color: var(--danger); border-color: rgba(239, 68, 68, 0.3); }
    .btn-persona { background: #1e293b; color: #cbd5e1; border: 1px solid var(--border); padding: 6px 14px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-persona:hover { border-color: var(--accent); color: #fff; }
    .stats-bar { background: #0f172a; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted); flex-wrap: wrap; gap: 10px; }
    .stats-bar strong { color: #fff; }
    .controls { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 25px; display: flex; flex-direction: column; gap: 15px; position: relative; }
    .input-row { display: flex; gap: 10px; position: relative; }
    input[type="text"] { flex: 1; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; color: #fff; padding: 11px 14px; font-size: 0.95rem; outline: none; }
    input:focus { border-color: var(--accent); }
    button { background: var(--accent); color: #04111d; border: none; border-radius: 8px; padding: 11px 18px; font-weight: 600; cursor: pointer; transition: 0.2s; white-space: nowrap; }
    button:hover { background: var(--accent-hover); }
    button.btn-pause { background: #334155; color: #fff; }
    button.btn-pause:hover { background: #475569; }
    
    /* Search Dropdown */
    .search-results { position: absolute; top: 100%; left: 0; right: 0; background: #131b2e; border: 1px solid var(--border); border-radius: 8px; margin-top: 5px; z-index: 100; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-height: 280px; overflow-y: auto; display: none; }
    .search-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #1e293b; transition: 0.15s; }
    .search-item:hover { background: #1e293b; }
    .search-item img { width: 50px; height: 24px; object-fit: cover; border-radius: 4px; }
    .search-item-info { flex: 1; font-size: 0.85rem; color: #f8fafc; }
    .search-item-info span { display: block; font-size: 0.75rem; color: var(--text-muted); }

    /* Quick select */
    .quick-list { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .quick-label { font-size: 0.8rem; color: var(--text-muted); }
    .chip { background: #0f172a; border: 1px solid var(--border); color: #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer; transition: 0.2s; }
    .chip:hover { border-color: var(--accent); color: var(--accent); }

    /* Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; position: relative; transition: transform 0.2s; }
    .card:hover { transform: translateY(-3px); }
    .card img { width: 100%; aspect-ratio: 460/215; object-fit: cover; background: #0f172a; }
    .card-body { padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; }
    .card-info { font-size: 0.85rem; font-weight: 600; color: #f8fafc; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-info span { display: block; font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }
    .btn-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); padding: 6px 12px; font-size: 0.8rem; border-radius: 6px; }
    .btn-danger:hover { background: var(--danger); color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title">
        <h1>Steam Hour Booster</h1>
        <p id="userStatus">Cargando...</p>
      </div>
      <div class="header-badges">
        <button class="btn-persona" id="personaBtn" onclick="togglePersona()">Modo: Invisible</button>
        <span class="badge" id="badgeStatus">Activo</span>
      </div>
    </header>

    <div class="stats-bar">
      <div>⏱️ Sesión actual: <strong id="timerText">00h 00m 00s</strong></div>
      <div>⚡ Horas generadas en sesión: <strong id="hoursProduced">0.0 hrs</strong></div>
    </div>

    <div class="controls">
      <div class="input-row">
        <div style="flex:1; position:relative;">
          <input type="text" id="searchInput" placeholder="Buscar por nombre o ingresar AppID..." autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
        <button onclick="addFromInput()">+ Agregar</button>
        <button class="btn-pause" id="pauseBtn" onclick="togglePause()">Pausar</button>
      </div>
      <div class="quick-list">
        <span class="quick-label">Rápidos:</span>
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
    let currentPin = localStorage.getItem('farmer_pin') || '';
    let sessionStart = null;
    let activeGamesCount = 0;
    let gameNamesMap = {};

    function getPin() {
      if (!currentPin) {
        currentPin = prompt('Introduce tu PIN de acceso configurado en config.json:') || '';
        if (currentPin) localStorage.setItem('farmer_pin', currentPin);
      }
      return currentPin;
    }

    // Cronómetro en vivo
    setInterval(() => {
      if (!sessionStart || activeGamesCount === 0) return;
      const diffSec = Math.floor((Date.now() - sessionStart) / 1000);
      const h = String(Math.floor(diffSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
      const s = String(diffSec % 60).padStart(2, '0');
      document.getElementById('timerText').innerText = \`\${h}h \${m}m \${s}s\`;
      
      const hoursCount = ((diffSec / 3600) * activeGamesCount).toFixed(1);
      document.getElementById('hoursProduced').innerText = \`+\${hoursCount} hrs\`;
    }, 1000);

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('userStatus').innerText = 'Usuario: ' + data.user + ' (' + data.games.length + '/32 juegos)';
        activeGamesCount = data.isPaused ? 0 : data.games.length;
        sessionStart = data.sessionStartTime;
        gameNamesMap = data.gameNames || {};

        const badge = document.getElementById('badgeStatus');
        const pauseBtn = document.getElementById('pauseBtn');
        const personaBtn = document.getElementById('personaBtn');

        if (data.isPaused) {
          badge.className = 'badge paused';
          badge.innerText = 'En Pausa';
          pauseBtn.innerText = 'Reanudar';
        } else {
          badge.className = 'badge';
          badge.innerText = 'Farmeando';
          pauseBtn.innerText = 'Pausar';
        }

        personaBtn.innerText = (data.personaState === 7) ? '👻 Modo: Invisible' : '🟢 Modo: En Línea';
        renderGames(data.games);
      } catch (e) {
        console.error(e);
      }
    }

    function renderGames(games) {
      const grid = document.getElementById('gamesGrid');
      grid.innerHTML = '';
      if (!games.length) {
        grid.innerHTML = '<p style="color:#64748b;grid-column:1/-1;text-align:center;">No hay juegos seleccionados.</p>';
        return;
      }

      games.forEach(id => {
        const title = gameNamesMap[id] || ('Juego #' + id);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/\${id}/header.jpg" onerror="this.src='https://placehold.co/460x215/1e293b/white?text=AppID+\${id}'">
          <div class="card-body">
            <div class="card-info" title="\${title}">\${title}<span>AppID: \${id}</span></div>
            <button class="btn-danger" onclick="removeGame(\${id})">Quitar</button>
          </div>
        \`;
        grid.appendChild(card);
      });
    }

    // Buscador interactivo
    let searchDebounce = null;
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const val = e.target.value.trim();
      if (!val || !isNaN(val)) {
        searchResults.style.display = 'none';
        return;
      }

      searchDebounce = setTimeout(async () => {
        try {
          const res = await fetch('/api/search?term=' + encodeURIComponent(val));
          const items = await res.json();
          searchResults.innerHTML = '';
          if (items.length) {
            items.forEach(it => {
              const div = document.createElement('div');
              div.className = 'search-item';
              div.innerHTML = \`
                <img src="\${it.img}" onerror="this.style.display='none'">
                <div class="search-item-info">\${it.name}<span>AppID: \${it.id}</span></div>
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
        } catch {
          searchResults.style.display = 'none';
        }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.style.display = 'none';
      }
    });

    function addFromInput() {
      const val = searchInput.value.trim();
      if (!val) return;
      if (!isNaN(val)) addGame(Number(val));
    }

    async function addGame(appid, name = '') {
      const res = await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: Number(appid), name, pin: getPin() })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        searchInput.value = '';
        loadStatus();
      }
    }

    async function removeGame(appid) {
      const res = await fetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: Number(appid), pin: getPin() })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else loadStatus();
    }

    async function togglePause() {
      const res = await fetch('/api/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getPin() })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else loadStatus();
    }

    async function togglePersona() {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getPin() })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else loadStatus();
    }

    loadStatus();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log(`[Web] Servidor listo en puerto ${PORT}`));
