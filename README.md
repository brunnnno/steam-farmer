# SteamFarmer

Personal web dashboard for Steam sessions, game activity, card farming and reading actual achievement states. All panel options are in English. Individual achievement activation is available for the main account after direct verification and compatibility checks. Bulk changes and achievement resets remain unavailable.

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

The standard reader uses Steam Community XML/HTML and optional Steam API data, with global catalogs as fallbacks. **Verify directly** reads schema and personal states through the authenticated Steam client protocol without SAM. Direct verification currently does not supply global rarity percentages; standard verification remains available by reopening the game. Personal states are marked verified only when Steam returns them. Unknown state is displayed as **Not verified**, never treated as locked or locally unlocked. Refresh requests bypass the result cache and retain the selected reading method. Direct verification does not change achievements. After direct verification, each achievement shows provisional compatibility, restrictions, progress dependencies or insufficient data. The main account can activate one eligible locked achievement through an explicit confirmation. The server re-reads the real schema and bitmask, preserves unrelated stats, submits one write with the current CRC, validates the response and re-reads Steam. Writes are serialized with a one-minute cooldown. Ambiguous definitions, missing personal values, schema changes, dependencies and restricted permissions cannot claim success. A local journal records intent before sending and blocks retries of attempted achievements. It is limited to 128 entries, retaining unresolved results; Render Free can still lose it between deployments. No automatic write, reset, batch or retry occurs. Already-unlocked achievements never submit a write. Model Mania (AppID 3764200, API name 46) was accepted and independently re-read in the live test on 2026-10-13; other achievements remain provisional until individually validated. After reconnect, a read-only check verifies that this original achievement remains unlocked. See [protocol research](docs/achievement-research.md) for the investigated writing route and its limits. Private profiles or games without readable stats can prevent verification.

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
