const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');
const http = require('http');

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const client = new SteamUser();

// Si ya tiene refreshToken, solo enviamos el token
const logOnDetails = cfg.refreshToken 
  ? { refreshToken: cfg.refreshToken }
  : { accountName: cfg.user, password: cfg.pass };

client.logOn(logOnDetails);

client.on('loggedOn', () => {
  console.log('[+] CONECTADO EXITOSAMENTE A STEAM');
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed(cfg.games);
  console.log(`[+] Farmeando ${cfg.games.length} juegos.`);
});

client.on('refreshToken', (token) => {
  cfg.refreshToken = token;
  delete cfg.pass;
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  console.log('[OK] Token de sesion guardado con exito.');
});

client.on('steamGuard', (domain, cb) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Introduce tu codigo de Steam Guard: ', (code) => {
    rl.close();
    cb(code.trim());
  });
});

client.on('error', (e) => console.error('Error:', e.message));

// Servidor web para mantener viva la nube (Koyeb)
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Steam Activo 24/7\n');
}).listen(PORT, () => console.log(`[Web] Servidor listo en puerto ${PORT}`));