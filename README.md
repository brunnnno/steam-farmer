# SteamFarmer

Personal web dashboard for Steam sessions, game activity, card farming and reading actual achievement states. All panel options are in English. General achievement writing is unavailable. A single explicitly requested Model Mania experiment is available for the main account after direct verification.

## Render deployment

Use Node.js 22 or later and configure these service settings:

- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Health check: `/healthz`

Set secrets in Render **Environment**, never in repository files:

- `STEAM_REFRESH_TOKEN`: a valid Steam client refresh token for the main account.
- `PANEL_PASSWORD`: dashboard password, 12–256 characters.
- `STEAM_API_KEY` (optional): additional achievement reading sources.
- `STEAM_ACCOUNT_ID` (optional): account identifier; defaults to `main`.
- `PUBLIC_ORIGIN` (optional): HTTPS origin for a custom domain. Render's URL is detected automatically.

The dashboard connects the main account automatically. Other accounts can sign in through the web panel with Steam Guard; no token needs to be pasted into code. Environment-managed credentials are changed in Render Environment.

Use `/healthz` for UptimeRobot. It checks web-server availability, not Steam connectivity. The panel displays Steam and web-session status separately.

Render Free has an ephemeral filesystem. Environment variables survive deployments; locally saved sessions and panel settings can be lost on restarts, redeploys or suspension. Put the desired default games and schedule in `config.json` without secrets. UptimeRobot does not make local storage persistent. Steam can expire or revoke a token.

## Achievements

The standard reader uses Steam Community XML/HTML and optional Steam API data, with global catalogs as fallbacks. **Verify directly** reads schema and personal states through the authenticated Steam client protocol without SAM. Direct verification currently does not supply global rarity percentages; standard verification remains available by reopening the game. Personal states are marked verified only when Steam returns them. Unknown state is displayed as **Not verified**, never treated as locked or locally unlocked. Refresh requests bypass the result cache and retain the selected reading method. Direct verification does not change achievements. For Resident Evil Requiem (AppID 3764200), a separate experimental button can request only Model Mania (View all models) on the environment-managed main account. It identifies the real API name from a fresh schema, refuses unknown permissions or progress dependencies, submits at most one write, and re-reads Steam. It records evidence before sending and never retries automatically. This is experimental and has not been validated on a live account; no startup, GET request, UptimeRobot ping or deployment activates an achievement. An already unlocked achievement never submits a write. All other writes and bulk actions remain unavailable. See [protocol research](docs/achievement-research.md) for the investigated writing route and its limits. Private profiles or games without readable stats can prevent verification.

Results are shared between simultaneous requests for the same account/game/session. Cache retention is limited to 64 entries, 4 MiB of serialized payloads and 60 seconds; this is not a limit on total process RAM. Static assets use conditional HTTP caching. Dashboard polling runs every 10 seconds while visible and resumes immediately when returning to the tab.

## Development

```sh
npm ci
npm run check
npm test
PANEL_PASSWORD='local-panel-password' npm start
```

Local access defaults to `http://127.0.0.1:8000`. Keep credentials in environment variables. Runtime files in `data/` and dependencies in `node_modules/` are excluded from Git.

- `bot.js`: HTTP server, authentication and Steam session control.
- `lib/`: Steam reading, validation, encrypted session storage and bounded caching.
- `public/`: English dashboard, responsive stylesheet and UI script.
- `config.json`: default settings, with no credentials.
- `test/`: server, Steam reader, cache and UI regression checks.
- `package-lock.json`: reproducible dependency installation.

Render documentation: [Free services](https://render.com/docs/free), [Environment variables](https://render.com/docs/environment-variables), [Web services](https://render.com/docs/web-services).
