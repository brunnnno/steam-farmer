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

Render Free has an ephemeral filesystem. For durable memory, apply `migrations/001-persistent-memory.sql` on a direct PostgreSQL connection after testing on an isolated branch. Configure `APP_DATABASE_URL` (pooled), `ACHIEVEMENT_DATABASE_URL` (pooled, same database), and `APP_STATE_KEY` (a private base64-encoded 32-byte random key) in Render. Never commit or rotate that key casually: it is needed to decrypt saved settings and additional Steam sessions. UptimeRobot does not make local storage persistent. Steam can still expire or revoke a token.

With these variables configured, startup restores encrypted configuration and saved additional-account tokens **before** connecting Steam. Game lists, schedules, manual pause, panel password hashes and other preferences survive redeployment. The environment-managed main token stays in Render. Configuration writes use optimistic database versions; a stale instance cannot overwrite a newer instance. Database or key failures block startup/mutations instead of silently replacing stored data with defaults. Successful settings responses wait for database confirmation. Browser dashboard sessions and live connections are intentionally recreated, not persisted.

Neon was connected on 2026-10-13. The first production startup saved the encrypted configuration and connected the PostgreSQL journal. The database branch test preserved a synthetic pending intent across separate connections and rejected its duplicate; no Steam write was sent. Unit tests additionally restore configuration and tokens into a completely fresh directory, verify manual pause and the saved panel password, reject a wrong encryption key, and prevent stale-server overwrites. Old local receipts already lost before migration are not invented or backfilled as confirmed writes.

Production restart verification: startup at 16:06:32 UTC created the encrypted state. A new Render instance at 16:09:04 UTC reported `restored: true`, advanced the stored version from 17 to 18, and recovered the identical checkpoint `750082dc-2471-4cbb-9f41-1d7b4054866b`. The PostgreSQL journal remained available and the main Steam account reconnected with matching identity. All 108 regression tests passed. No achievement was activated during the memory migration or restart tests.

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

## Activation diagnostics

The panel explains per-achievement restrictions, unsupported permissions, progress dependencies, missing personal state, missing statistics versions and ambiguous identifiers. Steam rejection messages distinguish stale statistics, validation failures and unknown results without inferring a publisher/launcher cause from a generic error. A separate Game integration & activation limits section shows established Steam Store account/DRM/launcher requirements; these are context and never automatically block an otherwise eligible Steam achievement. The panel cannot inspect external account linking or modify publisher progress. Missing metadata stays unknown. Store lookups are parallel, bounded, deduplicated and cached (32 entries, 128 KiB, one hour).

## Progress completion

After direct verification, supported progress achievements offer **Preview progress completion**. The preview names the achievement and exact linked counter change; explicit confirmation sends one update containing the achievement bit and, if needed, its counter. The server binds the preview to the current schema, CRC and returned statistics and rejects stale previews before sending. Confirmation requires a clean Steam response and a fresh read matching both reviewed changes, with no unrelated changes. Normal bit-only activation still rejects progress dependencies.

Initial support is limited to direct `statvalue` expressions over one exclusive, client-writable INT counter. Shared counters, complex expressions, FLOAT/AVGRATE, aggregated stats, protected/trusted-server stats, unknown or ambiguous personal values, invalid constraints and updates exceeding min/max/maxchange are rejected. Counters never decrease, and no multi-step update or automatic retry occurs. Completing a Steam counter does not establish that the corresponding game-save or publisher requirements were fulfilled. Other targets remain provisional until individually verified. Startup checks are read-only and send no writes.

Live test at 2026-10-13T14:38:26Z: after the user's explicit authorization, Call of Duty (AppID 1938090) `crocodile` was activated together with the exclusive INT statistic `stat_1` (stat ID 5), from 0 to 1. Steam returned result 1, with no stale flag or rejected statistics. An independent fresh read confirmed the selected achievement and counter, with no unrelated statistic or achievement changes. The temporary one-target activation hook was removed after collecting the result; the existing read-only startup probes observe the persisted state.

Steam's [stats and achievements documentation](https://partner.steamgames.com/doc/features/achievements?l=english) describes progress-linked automatic unlocks, statistic permissions and bounds.

## Write history and shared-counter review

The panel exposes authenticated, account-scoped write history (the most recent 100 recorded attempts) and displays whether storage is local or PostgreSQL. Configure the private Render environment variable `ACHIEVEMENT_DATABASE_URL` with a PostgreSQL connection string to enable persistence. Prefer the internal URL for a database in the same Render region; external providers should use their prescribed TLS-enabled connection URL. Never commit connection strings. Render Free's local files remain ephemeral, and its free PostgreSQL database expires after 30 days: local mode is explicitly labelled and is not a durable history solution.

On first connection, the app creates `steamfarmer_achievement_writes` and imports existing local receipts without overwriting any database record. Credentials and arbitrary transport payloads are excluded. PostgreSQL reserves each intent in a transaction before any Steam write, using an account-level advisory lock, a unique account/game/achievement key and a persistent one-minute cooldown across instances. Intent survives crashes and blocks automatic retries. Results are attached to that intent after Steam verification. A failed result save leaves the durable intent pending and is reported separately from the observed Steam outcome. A configured but unavailable database blocks activation without falling back to temporary local storage; actual Steam readings remain available. PostgreSQL retains up to 10,000 receipts per account without silently deleting unresolved attempts. Database integration tests currently use a simulated pool; production persistence cannot be declared verified until an actual database is connected and restart-tested.

For compatible shared INT counters, **Review shared counter** shows the exact proposed counter change and all related achievement effects: would unlock, progress only, already unlocked, restricted or unknown. Complex expressions, missing personal states, ambiguous definitions and inconsistent already-reached thresholds remain uncertain. This preview does not send a write. Shared-counter activation remains disabled pending durable group reservations and group verification. Read-only startup probes inspect Steam-confirmed owned Left 4 Dead 2 / Counter-Strike: Source examples. No new achievements are automatically activated.

## Read-only candidate scan

On 2026-10-13 the account's explicitly approved hidden achievement test, Half-Life 2 `HL2_HIT_CANCOP_WITHCAN` (Defiant), received Steam result 1 and a fresh read confirmed only that achievement changed, with no rejected stats, unrelated statistic changes or other achievement changes. The temporary activation hook was removed after collecting the result; only a read-only persistence check remains. Live dry-run guards also rejected Crocodile (Call of Duty, linked stat 0/1) for its progress dependency and PMC (Tarkov, 2/300) for server-controlled permissions, with all returned stats unchanged. These are specific observed cases, not universal compatibility guarantees.

The main Steam session retrieves its owned library and sequentially inspects up to 120 games, with a three-minute search limit, for locked hidden achievements with provisional eligibility, progress-dependent achievements, and server-controlled achievements. Reports state the library size, inspected count and any scope limit. It never writes statistics or activates achievements. Ownership is taken from Steam. Results are available in authenticated status and server logs. Direct reading exposes explicit hidden metadata and simple linked INT counters; unknown or non-integer progress remains unknown. Two read-only guard probes inspect Crocodile (Call of Duty) and PMC (Tarkov), exercise the actual activation preparation checks, and re-read all returned stats to establish whether they remained unchanged. These probes never invoke a store transport.
