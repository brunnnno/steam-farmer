# SteamFarmer · SamRewritten Web Edition

Web control room for Steam session farming, automatic trading-card drops, and complete [SamRewritten](https://github.com/PaulCombal/SamRewritten) achievement and statistics management directly from the browser (desktop & mobile) without opening the Steam desktop client.

## Key Features

- **Clean Multi-User Web Onboarding (No PIN required)**: Open the dashboard and click **+ Add Account** to sign in with any Steam account and Steam Guard code. Sessions are encrypted locally in the server vault and can be signed out or removed at any time.
- **1-Click Achievement Unlock & Lock (SamRewritten Protocol)**:
  - **Unlock / Lock Individual Achievements**: Instant 1-click toggle per achievement row via `CMsgClientStoreUserStats2`.
  - **Bulk Operations**: **Unlock all**, **Lock all**, **Select page**, **Invert**, and **Commit (N)** across up to 8,192 achievements per game, plus **Unlock all in listed games** / **Lock all in listed games** across your game list.
  - **4-Tier Adaptive Removal Engine**: Clears achievement bits and resets linked progress counters reliably (including `ResetAllStats` fallback with automatic restoration of remaining unlocked achievements).
- **Real-Time Statistics Editor (`INT` & `FLOAT`)**:
  - Inspect and modify personal integer (`INT`) and IEEE-754 decimal (`FLOAT`) game statistics directly, validate schema bounds and `incrementonly` flags, or **Reset all stats** while preserving unlocked achievements.
- **Timed Modifications & Copy User Timings**:
  - Schedule automatic achievement unlocks or removals over seconds, minutes, or hours with **Even** or **Random** spacing and **In-order** or **Random** execution.
  - Copy another Steam player's unlock order and relative timestamps from a SteamID64, Steam profile URL, or XML/JSON dump.
- **JSON Import/Export, Analytics & 1-Click Undo**:
  - Export and import full game snapshots (`achievements` + `stats`) as JSON.
  - Inspect completion metrics, detect irregular unlock timestamp bursts, and revert the last operation in 1 click (**Undo last change**).
  - **Silent Mode**: Modify achievements and statistics without leaving the game displayed as *In-Game* on your Steam profile.
- **Hour & Card Farming**:
  - Idle up to 32 games simultaneously, automatically scan Steam badges for pending trading-card drops, set custom status messages, and configure automatic sleep schedules.

## Quick Start (Local or Render)

### Requirements
- Node.js 22+

### Local Setup
```sh
npm ci
npm start
```
Open `http://127.0.0.1:8000` in your browser and click **+ Add Account** to connect your Steam account.

### Render Deployment
- **Build Command**: `npm ci --omit=dev`
- **Start Command**: `npm start`
- **Health Check Path**: `/healthz`

Optional environment variables (only if you want to enable external PostgreSQL persistence or pre-configured single-owner autologin):
- `PUBLIC_ORIGIN`: Your public HTTPS URL (automatically detected on Render via `RENDER_EXTERNAL_URL`).
- `ENABLE_ENV_AUTOLOGIN=1`: Set to `1` only if you want `STEAM_REFRESH_TOKEN` and `APP_DATABASE_URL` environment variables to auto-load a default account on startup. By default, the panel starts clean so any user can sign in through the web UI.

## Testing & Verification
```sh
npm run check
npm test
npm run test:memory
```
