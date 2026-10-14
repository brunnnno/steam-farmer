# SteamFarmer

Personal web dashboard for Steam sessions, game activity, card farming and reading actual achievement states. All panel options are in English. The main account supports reviewed selection of up to 32 eligible achievements, including removal of currently unlocked achievements with unrestricted client permissions. Every write requires an exact impact review and explicit confirmation. Global resets and automatic retries remain unavailable.

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

### Automatic card-farming panel

Pause/Resume is now in the header next to Cards, above the overview and expandable card list. The disclosure uses a small inline SVG chevron with a smooth rotation; reduced-motion preferences disable its animation.

The achievement source line also displays the browser-measured request duration so direct and standard reads can be compared on the user's actual connection. It is not a fabricated Steam performance estimate; the last verification timestamp is shown separately.

Achievement buttons for connected accounts request `method=auto`: a single direct Steam protocol read is attempted first with a 2.5-second response timeout. A complete verified result skips community scraping entirely and receives the same journal/compatibility checks as explicit direct verification. An unavailable or incomplete protocol result falls back to standard web reading; its actual reading method is returned to the browser. Standard reading is always selectable in the modal for rarity/community sources. This reduces unnecessary requests but does not guarantee a fixed Steam response time. Explicit direct reads and achievement write verification are unchanged.

The card panel is a native keyboard/touch-accessible disclosure, closed by default. Its summary remains visible while the details expand with one tap; polling preserves its open state for the selected account and changing accounts resets it closed.

Standard achievement reading starts independent sources concurrently but returns as soon as a personal XML/HTML or complete Web API result verifies every returned achievement. Remaining requests are aborted using the actual fetch signal. Optional rarity information that has not arrived is explicitly unknown. Catalog-only/unsupported responses still wait for all personal sources, so a fast public catalog cannot hide a slower valid personal response. A controlled test verifies that a usable personal response returns without waiting for a stalled optional source; this does not promise a fixed latency from Steam. Direct verification and write verification remain unchanged.

When Cards is enabled, a compact panel separately lists Steam badge games with pending drops, real game titles when returned, each pending-drop count, and Active/Waiting/Paused status based on the games actually sent by the server. It shows the aggregate pending count and last successful badge scan, with scan errors marked as potentially outdated. Manual games stay unchanged. Counts are remaining card drops, not remaining minutes; Steam does not provide an ETA through this reader. The panel reuses unchanged DOM on the existing status polling and adds no extra Steam requests or images. Rendering is bounded to 80 rows and a compact scroll area.

The standard reader uses Steam Community XML/HTML and optional Steam API data, with global catalogs as fallbacks. **Verify directly** reads schema and personal states through the authenticated Steam client protocol without SAM. Unknown states stay **Not verified**. Direct verification is read-only and checks compatibility, permissions and dependencies. The main account may select eligible achievements and review the exact full effect before confirmation. Writes are serialized with a one-minute cooldown, durably reserved and independently re-read. Model Mania (AppID 3764200, API name 46) was confirmed in a live individual test on 2026-10-13; multi-target changes and removal remain provisional. See [selection and removal](docs/achievement-selection-and-removal.md) and [protocol research](docs/achievement-research.md). Private profiles or unreadable statistics can prevent verification.

Results are shared between simultaneous requests for the same account/game/session. Cache retention is limited to 64 entries, 4 MiB of serialized payloads and 60 seconds; this is not a limit on total process RAM. Static assets use conditional HTTP caching. Dashboard polling runs every 10 seconds while visible and resumes immediately when returning to the tab.

## Free-plan resource budget and bug audit (2026-10-13)

Observed Render memory before this audit: about 204 MB on the current instance, with a historical sampled peak of 280 MB across the reviewed deployments. These are container measurements, not JavaScript heap sizes. Render reports a 536,870,900-byte memory limit. No absolute promise against every OOM is possible.

- Startup now skips experimental library scans and achievement diagnostic probes by default. Set `STEAM_STARTUP_DIAGNOSTICS=1` only for deliberate diagnostics; candidate scans are capped at 12 games/60 seconds. Direct verification, single-target activation and card farming remain available.
- One expensive operation at a time; identical achievement reads still share their result. Up to four small lookups run concurrently. New work receives HTTP 429 with Retry-After when busy or process RSS reaches the 360 MiB admission threshold. This is a soft admission check, not a total-memory hard limit.
- Achievement cache: 2 MiB serialized payloads/24 entries/60 seconds. Requirements cache: 128 KiB/32 entries. In-memory object overhead is additional. Steam HTML responses default to 2 MiB and streams are capped; oversized declared responses are cancelled before buffering.
- Node startup uses a 192 MiB old-generation and 8 MiB semi-space budget. Heap limits do not cover all native buffers, sockets or container memory. Up to 3 simultaneous Steam connections, 8 new saved profiles, 16 dashboard sessions, 4 login attempts and 64 inbound sockets; existing saved profiles are never deleted by these limits.

The existing Render service starts with `node bot.js`, not `npm start`. Its `NODE_OPTIONS` is therefore configured with `--max-old-space-size=192 --max-semi-space-size=8` as well, and `STEAM_STARTUP_DIAGNOSTICS=0`. The startup Resource budget log reports the actual heap limit. Local regression suite: 120 tests pass; production dependency audit: zero reported vulnerabilities. After patched dependencies, the synthetic load test sampled a 256.2 MiB process-RSS peak (not a production measurement).
- PostgreSQL configuration writes retain at most one in-flight encrypted snapshot and one latest pending snapshot. Rapid saves coalesce; responses still wait for durable confirmation, with no local fallback on database failure.
- Progress parsing indexes definitions and counter references, avoids redundant full parsing, and rejects oversized/deep definitions. Achievement write verification remains strict and unrelated statistics must still be unchanged.
- Corrected reconnect pause loss, stale-session achievement responses, stale card scans, late login authority checks, removed-game name writes, XML account mismatches, and UTF-8 request chunks. The browser renders 200 achievement rows per page and frees the modal content on close.
- Patched transitive `adm-zip` and app-ticket `protobufjs` dependencies through scoped overrides, without downgrading steam-user. Dedicated ZIP/protobuf round-trip tests cover their runtime API compatibility. `npm audit --omit=dev` must remain clean.

Local-only synthetic load check (no Steam credentials, database or writes):

```sh
node --max-old-space-size=192 --max-semi-space-size=8 scripts/memory-smoke.js
```

This launches a disposable local panel and sends 64 concurrent/batched requests for 1,400 synthetic HTML achievements. Busy requests are intentionally rejected instead of queued. It measures sampled process RSS and validates headroom below 400 MiB. It is not proof of worst-case production traffic or a substitute for Render metrics. Resource usage is visible in Advanced settings and logged once per minute without credentials.

### Development commands

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

Direct `statvalue` expressions support exclusive client-writable INT counters and reviewed FLOAT counters; shared INT support is described below. The FLOAT mode sends one exact IEEE-754 counter value without achievement bits, requires PostgreSQL intent before transport, and checks the fresh full statistic set and linked unlock. It has synthetic validation but no live FLOAT certification. Complex expressions, shared FLOAT, AVGRATE, aggregated/protected/trusted-server stats, ambiguous values and invalid or exceeded constraints remain rejected. See [decimal progress](docs/float-progress.md). Activation never decreases counters. Reviewed removal can reverse an exact recorded change only when constraints allow it and no new game progress would be overwritten; no multi-step update or automatic retry occurs. Completing a Steam counter does not establish that the corresponding game-save or publisher requirements were fulfilled. Other targets remain provisional until individually verified. Startup checks are read-only and send no writes.

Live test at 2026-10-13T14:38:26Z: after the user's explicit authorization, Call of Duty (AppID 1938090) `crocodile` was activated together with the exclusive INT statistic `stat_1` (stat ID 5), from 0 to 1. Steam returned result 1, with no stale flag or rejected statistics. An independent fresh read confirmed the selected achievement and counter, with no unrelated statistic or achievement changes. The temporary one-target activation hook was removed after collecting the result; the existing read-only startup probes observe the persisted state.

Steam's [stats and achievements documentation](https://partner.steamgames.com/doc/features/achievements?l=english) describes progress-linked automatic unlocks, statistic permissions and bounds.

## Write history and shared-counter review

The panel exposes authenticated, account-scoped write history (the most recent 100 recorded attempts) and displays whether storage is local or PostgreSQL. Configure the private Render environment variable `ACHIEVEMENT_DATABASE_URL` with a PostgreSQL connection string to enable persistence. Prefer the internal URL for a database in the same Render region; external providers should use their prescribed TLS-enabled connection URL. Never commit connection strings. Render Free's local files remain ephemeral, and its free PostgreSQL database expires after 30 days: local mode is explicitly labelled and is not a durable history solution.

On first connection, the app creates `steamfarmer_achievement_writes` and imports existing local receipts without overwriting any database record. Credentials and arbitrary transport payloads are excluded. PostgreSQL reserves each intent in a transaction before any Steam write, using an account-level advisory lock, a unique account/game/achievement key and a persistent one-minute cooldown across instances. Intent survives crashes and blocks automatic retries. Results are attached to that intent after Steam verification. A failed result save leaves the durable intent pending and is reported separately from the observed Steam outcome. A configured but unavailable database blocks activation without falling back to temporary local storage; actual Steam readings remain available. PostgreSQL retains up to 10,000 receipts per account without silently deleting unresolved attempts. The original production journal was connected and restart-tested on 2026-10-13. New operation tables were tested on an isolated Neon branch; production migration 003 was applied with user confirmation on 2026-10-14 UTC.

For compatible shared INT counters, **Review shared counter** shows the exact proposed counter change and all related achievement effects: would unlock, progress only, already unlocked, restricted or unknown. Complex expressions, missing personal states, ambiguous definitions and inconsistent already-reached thresholds remain uncertain. This preview does not send a write. The legacy shared INT route permits one new unlock. The reviewed selection route supports multiple selected unlocks when every crossed threshold is selected and all related effects are known and unrestricted. Persistent group reservations are required; a fresh read must verify all related progress and achievement states with no unrelated changes. Unconfirmed operations retain their reservations and never retry automatically. See docs/shared-counter-activation.md. Read-only startup probes inspect Steam-confirmed owned Left 4 Dead 2 / Counter-Strike: Source examples. No new achievements are automatically activated.

## Read-only candidate scan

On 2026-10-13 the account's explicitly approved hidden achievement test, Half-Life 2 `HL2_HIT_CANCOP_WITHCAN` (Defiant), received Steam result 1 and a fresh read confirmed only that achievement changed, with no rejected stats, unrelated statistic changes or other achievement changes. The temporary activation hook was removed after collecting the result; only a read-only persistence check remains. Live dry-run guards also rejected Crocodile (Call of Duty, linked stat 0/1) for its progress dependency and PMC (Tarkov, 2/300) for server-controlled permissions, with all returned stats unchanged. These are specific observed cases, not universal compatibility guarantees.

The main Steam session retrieves its owned library and sequentially inspects up to 120 games, with a three-minute search limit, for locked hidden achievements with provisional eligibility, progress-dependent achievements, and server-controlled achievements. Reports state the library size, inspected count and any scope limit. It never writes statistics or activates achievements. Ownership is taken from Steam. Results are available in authenticated status and server logs. Direct reading exposes explicit hidden metadata and simple linked INT counters; supported decimal progress is reviewed explicitly; unknown values stay unknown. Two read-only guard probes inspect Crocodile (Call of Duty) and PMC (Tarkov), exercise the actual activation preparation checks, and re-read all returned stats to establish whether they remained unchanged. These probes never invoke a store transport.

## Current continuation: reviewed selection and audit

`migrations/003-achievement-operations.sql` was validated on an isolated branch and applied to production with user confirmation on 2026-10-14 UTC, enabling multi-selection/removal. Existing activation history is preserved. [Selection and removal](docs/achievement-selection-and-removal.md) documents scope, API and pending migration; [web audit](docs/web-audit-2026-10-13.md) records the fixes and resource measurements. The latest local suite has 256 passing tests. Synthetic peaks were 149.2 MiB for 8,192 achievements and 234.2 MiB under concurrent HTTP load, both below 500 MB. No live achievement was changed during this continuation.

## 2.1.2: rarity and regression audit

Direct achievement lists now load global percentages automatically without delaying personal verification. Invalid or complete uniform 100% responses remain unverified; a unique Community-title fallback and read-only Retry rarity are available. Mythic/Epic filters use validated percentages and preserve personal states. See [rarity and regression audit](docs/rarity-and-regression-audit-2026-10-14.md) for reproduced live-source results, broad checks and memory evidence. 271 regression tests pass, and dependencies/resource budgets remain unchanged.

## Automatic achievement updates (2.2.0)

Open a game to keep its achievements and linked progress synchronized with Steam every ten seconds while the list is visible. Updates pause during selections/reviews, offline periods and hidden tabs. Unchanged reads keep the existing list and position; observed unlock/removal/progress changes appear in a small collapsed activity section. This is read-only and never grants or removes achievements automatically. Steam availability and source caching can delay updates. See [the synchronization design and test workflow](docs/live-achievements.md).

Run `npm run check`, `npm test`, `npm run test:memory` and `npm audit --omit=dev`. GitHub Quality checks repeats the same checks without Steam credentials.
