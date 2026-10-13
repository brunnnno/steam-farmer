const SteamUser = require('steam-user');
const fs = require('fs');
const http = require('http');
const url = require('url');

let cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const client = new SteamUser();

let isFarming = false;
let isPaused = false;

// Conexión a Steam
const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] Conectado a Steam');
  client.setPersona(SteamUser.EPersonaState.Online);
  actualizarFarmeo();
});

client.on('error', (e) => console.error('Error Steam:', e.message));

function actualizarFarmeo() {
  if (!isPaused && cfg.games && cfg.games.length > 0) {
    client.gamesPlayed(cfg.games);
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

// Servidor Web y Panel Visual
const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // API: Comprobar estado
  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      user: cfg.user,
      games: cfg.games,
      isFarming: isFarming,
      isPaused: isPaused,
      hasPin: Boolean(cfg.webPin)
    }));
  }

  // Rutas protegidas por PIN
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');

        // Verificación de PIN
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
            guardarConfig();
            actualizarFarmeo();
          }
        }

        // Eliminar juego
        if (parsedUrl.pathname === '/api/remove') {
          const appid = parseInt(data.appid, 10);
          cfg.games = cfg.games.filter(id => id !== appid);
          guardarConfig();
          actualizarFarmeo();
        }

        // Pausar / Reanudar
        if (parsedUrl.pathname === '/api/toggle') {
          isPaused = !isPaused;
          actualizarFarmeo();
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

  // Frontend HTML / CSS / JS
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Steam Boost Panel</title>
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
    .container { width: 100%; max-width: 900px; }
    
    /* Header */
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: gap: 15px; }
    .title h1 { font-size: 1.5rem; font-weight: 700; color: #fff; }
    .title p { font-size: 0.85rem; color: var(--text-muted); }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; background: rgba(34, 197, 94, 0.15); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.3); }
    .status-badge.paused { background: rgba(239, 68, 68, 0.15); color: var(--danger); border-color: rgba(239, 68, 68, 0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

    /* Controls Bar */
    .controls { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 25px; display: flex; flex-direction: column; gap: 15px; }
    .input-row { display: flex; gap: 10px; }
    input[type="number"], input[type="password"] { flex: 1; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; color: #fff; padding: 10px 14px; font-size: 0.95rem; outline: none; }
    input:focus { border-color: var(--accent); }
    button { background: var(--accent); color: #04111d; border: none; border-radius: 8px; padding: 10px 18px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    button:hover { background: var(--accent-hover); }
    button.btn-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    button.btn-danger:hover { background: var(--danger); color: #fff; }
    button.btn-pause { background: #334155; color: #fff; }
    button.btn-pause:hover { background: #475569; }

    /* Quick select */
    .quick-list { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .quick-label { font-size: 0.8rem; color: var(--text-muted); }
    .chip { background: #0f172a; border: 1px solid var(--border); color: #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer; transition: 0.2s; }
    .chip:hover { border-color: var(--accent); color: var(--accent); }

    /* Games Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; position: relative; transition: transform 0.2s; }
    .card:hover { transform: translateY(-3px); }
    .card img { width: 100%; aspect-ratio: 460/215; object-fit: cover; background: #0f172a; }
    .card-body { padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; }
    .card-info { font-size: 0.85rem; font-weight: 600; color: #cbd5e1; }
    .card-info span { display: block; font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title">
        <h1>Steam Hour Booster</h1>
        <p id="userStatus">Cargando...</p>
      </div>
      <div>
        <span class="status-badge" id="badgeStatus"><span class="dot"></span> <span id="statusText">Activo</span></span>
      </div>
    </header>

    <div class="controls">
      <div class="input-row">
        <input type="number" id="appidInput" placeholder="Ingresa AppID (ej: 730)">
        <button onclick="addGame()">+ Agregar Juego</button>
        <button class="btn-pause" id="pauseBtn" onclick="togglePause()">Pausar</button>
      </div>
      <div class="quick-list">
        <span class="quick-label">Rápidos:</span>
        <span class="chip" onclick="quickAdd(730)">CS2</span>
        <span class="chip" onclick="quickAdd(440)">TF2</span>
        <span class="chip" onclick="quickAdd(570)">Dota 2</span>
        <span class="chip" onclick="quickAdd(271590)">GTA V</span>
        <span class="chip" onclick="quickAdd(1938090)">Call of Duty</span>
        <span class="chip" onclick="quickAdd(252490)">Rust</span>
        <span class="chip" onclick="quickAdd(1172470)">Apex</span>
      </div>
    </div>

    <div class="grid" id="gamesGrid"></div>
  </div>

  <script>
    let currentPin = localStorage.getItem('farmer_pin') || '';

    function getPin() {
      if (!currentPin) {
        currentPin = prompt('Introduce tu PIN de acceso configurado en config.json:') || '';
        if (currentPin) localStorage.setItem('farmer_pin', currentPin);
      }
      return currentPin;
    }

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('userStatus').innerText = 'Usuario: ' + data.user + ' (' + data.games.length + '/32 juegos)';
        const badge = document.getElementById('badgeStatus');
        const statusText = document.getElementById('statusText');
        const pauseBtn = document.getElementById('pauseBtn');

        if (data.isPaused) {
          badge.className = 'status-badge paused';
          statusText.innerText = 'En Pausa';
          pauseBtn.innerText = 'Reanudar';
        } else {
          badge.className = 'status-badge';
          statusText.innerText = 'Farmeando';
          pauseBtn.innerText = 'Pausar';
        }

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
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/\${id}/header.jpg" onerror="this.src='https://placehold.co/460x215/1e293b/white?text=AppID+\${id}'">
          <div class="card-body">
            <div class="card-info">AppID: \${id}</div>
            <button class="btn-danger" style="padding:6px 12px;font-size:0.8rem;" onclick="removeGame(\${id})">Quitar</button>
          </div>
        \`;
        grid.appendChild(card);
      });
    }

    async function addGame(id) {
      const input = document.getElementById('appidInput');
      const appid = id || input.value.trim();
      if (!appid) return;

      const res = await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: Number(appid), pin: getPin() })
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        if (data.error.includes('PIN')) { localStorage.removeItem('farmer_pin'); currentPin = ''; }
      } else {
        input.value = '';
        loadStatus();
      }
    }

    function quickAdd(id) { addGame(id); }

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

    loadStatus();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log(`[Web] Panel listo en puerto ${PORT}`));
