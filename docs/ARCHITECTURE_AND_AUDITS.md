<!-- SOURCE: docs/achievement-availability.md -->

# Read-only achievement availability — 2026-10-13

The dashboard combines the existing direct Steam schema, personal-state, progress-support and journal checks into one presentation classifier. It does not attempt writes in order to discover compatibility, add upstream requests, or expand the supported writer.

Categories: eligible to attempt; exclusive progress eligible for preview; protected permissions; unsupported expressions/types/bounds/shared counters; unknown or missing state; Steam rejection; previous attempt requiring review; already unlocked; recorded activation confirmed on this account. Unknown data stays unknown. A rejection alone is not proof of permanent protection. An already-unlocked achievement is not proof the panel granted it.

Eligibility is provisional. Only Steam acceptance plus an independent fresh read can confirm an actual update. Account policy and a disconnected session exclude actions from the attemptable filter. Server validation, confirmation, journal reservations and cooldowns remain authoritative and unchanged.

The compatibility filter combines with status, rarity, search and sort. The pending summary explains current eligible/protected/unsupported/unknown/review counts. Standard Community reads cannot establish write compatibility. Choose Direct verification or use Automatic reading, which attempts the protocol first. Each visible row has a category and a textual explanation; Show all clears combined filters. Opening a different game or account resets the compatibility filter; refreshing the same reading mode preserves it.

Follow-up: the dropdown is simplified to All / Can attempt / Not available / Needs verification, while detailed categories remain on the rows. Read-only synthetic tests exercise 36 scenarios through the actual binary-schema parser, presentation classifier and writer preparation, verifying agreement rather than testing a disconnected mock classification. Coverage includes ordinary/hidden bits, bit 31, trusted-server declarations on bits/blocks/counters, unknown flags, permissions, missing/duplicate state and CRC, INT/FLOAT/AVGRATE, shared/aggregated/complex expressions, ambiguity, constraints and already-complete progress. These are test scenarios, not a claim to cover every possible Steam schema or a live unlock certification.

Trusted-server flags on the achievement and its containing block now prevent both normal and progress plans; uninterpretable flags remain unknown. No protected-stat workaround is attempted. Real-account evidence is still limited to the individually authorized, previously verified targets documented elsewhere. New live tests must identify the exact game, achievement and any statistic changes beforehand.

Implementation: a small pure classifier in public/achievement-availability.js uses existing response fields, so there is no duplicated server payload or new database cache. Native selects and existing 200-row pagination preserve a lightweight UI. All tests use synthetic data and simulated transports; no live achievement was granted by this change.

---

<!-- SOURCE: docs/achievement-loading-and-next-types.md -->

# Achievement loading

The browser keeps at most eight previous lists, five minutes old or newer, with a combined serialized UTF-16 budget of 1 MiB. This is memory-only and is cleared when the panel locks and before achievement writes. Entries are scoped to account, known Steam identity, game and reading mode. Reopening displays a previous reading immediately while requesting an updated response. The cached mode blocks individual, progress and shared activation, including direct function calls. Failed verification retains the previous list with an explicit warning.

Persistent history now starts alongside the Steam read. Its UI wait budget is 2.5 seconds; failure or timeout blocks activation while allowing the real Steam list to display. The underlying bounded database query can finish afterward; its result cannot change the response or enable writes. Community source timeouts are reduced from 12 to 6 seconds. Automatic mode still tries direct verification for 2.5 seconds first. Logs and responses include total server readDurationMs.

No instant first-ever read is guaranteed: Steam, network latency and a sleeping free Render instance can delay it. Previously seen lists avoid an empty screen during those delays. No automatic library-wide prefetch is added.

# Next supported type

Reviewed upstream SAM commit de8b71048a0cee3c3e97cd8535e0f55ca86513e4. Its README requires a running local Steam client; SAM.API/Wrappers/SteamUserStats013.cs has separate integer and float getters/setters. SAM.Game/Stats/FloatStatInfo.cs parses float values and rejects modifications when permission bit 2 is set. These native calls cannot be used directly by the remote web protocol.

FLOAT decoding, bounded previews and the typed counter-only writer are now implemented with synthetic validation; see float-progress.md. Next is a fresh owned-game example and a separately authorized live attempt. AVGRATE, complex expressions and shared multi-unlock require separate support. No achievement or statistic was activated during this continuation.

---

<!-- SOURCE: docs/achievement-research.md -->

# Achievement verification and writing without SAM

Research date: 2026-10-13. This document distinguishes observed implementations from behavior tested in this deployment.

## Findings

| Route | What it supports | Limit |
| --- | --- | --- |
| Steam Community XML/HTML | Read actual personal achievement states | Privacy, missing stats, redirects and intermittent availability |
| Official Steam Web API | Read achievements with appropriate credentials; publisher methods can write stats | A personal API key does not grant publisher write permissions |
| Authenticated Steam client protocol | Read stats/schema; existing open-source projects also submit client-writable achievement changes | Undocumented client interfaces, game-specific restrictions and server validation |
| Steamworks SDK wrappers | Read/write through the SDK | Typically depend on a local Steam client; not the chosen Render approach |

A website can control an authenticated protocol client running on its server. The browser itself does not need to run SAM or the desktop Steam client. This is a feasible architecture, not proof that every achievement can be modified.

## Source review

- [Valve: ISteamUserStats Web API](https://partner.steamgames.com/doc/webapi/ISteamUserStats): the official write method requires publisher authentication. This restriction applies to that API, not every Steam protocol path.
- [ASF Achievement Manager](https://github.com/CatPoweredPlugins/ASFAchievementManager): its handler reads `ClientGetUserStats` and submits `ClientStoreUserStats2`. It parses binary KeyValues, maps stat blocks/bits, preserves existing masks, includes the current stats CRC, and skips restricted achievements. It is a working project independent of SAM; its README explicitly documents set/reset commands and server-controlled exclusions.
- [SteamEdge protocol engine](https://github.com/Miabeyefendi/SteamEdge/blob/main/src/core/steamEngine.js): a Node implementation using `steam-user` and its generated protobufs. Its code manually encodes messages because `steam-user` does not register these stats messages. Its write result handling alone is insufficient for our intended verification standard: a fresh read must also confirm the requested state.
- [GameNative](https://github.com/utkarshdalal/GameNative/blob/master/app/src/main/java/app/gamenative/service/SteamService.kt) and [Silksong achievement integration](https://github.com/OmegaUwUr/SilksongAndroid-Achievements): additional JavaSteam-based implementations. The latter refreshes state before submission and checks result, stale-state and failed-validation fields. The upstream JavaSteam handler inspected provides reading; write support in integrations must not be assumed present in every release.

Existing implementations mean that SAM-free protocol achievement management is not a new invention. A dependable web interface can still be a useful direction for this project.

## Implemented here

`lib/steam-protocol.js` adds a read-only adapter for the installed `steam-user` 5.3.0 transport. The panel's **Verify directly** button reads the authenticated account's schema and states using `ClientGetUserStats`. It checks the returned game ID and response type, bounds payload size, times out, clears pending jobs, uses English schema labels, and keeps absent personal values unknown. It never sends a write/reset message. The standard web reader remains available through the normal game view.

The test suite covers block/bit mapping, bit 31, missing values, timestamps that must not override bitmasks, wrong-game responses, rejected results, timeout, disconnect and cache isolation. These tests validate the adapter against protocol-format fixtures; deployment logs provide the separate live read check. Live validation exposed timestamps populated for locked achievements: the adapter now determines state only from personal stat bitmasks and omits implausible dates. The first live write has since been confirmed, as recorded below.

## Verification standard for writing

Use a separate explicit user action for a chosen client-writable achievement. Fetch a fresh account/game snapshot; validate schema identifiers and permissions; merge only the selected changes with the current mask; send the current CRC; reject failed validation or stale state; then re-read from Steam and independently confirm the requested state. Do not update the UI from a local mask or an HTTP success alone. Handle progress-dependent stats and competing writes before adding batches.

Reading a protected achievement does not grant permission to change it. No compatibility guarantee is made for every game or for future Steam protocol changes.

## Selected single-achievement experiment

The user selected Resident Evil Requiem, Model Mania (View all models), AppID 3764200. `lib/achievement-experiment.js` prepares a single-bit mutation using a fresh schema, preserves unrelated stats, uses the current CRC and same authenticated account, validates the response and immediately re-reads Steam. Unknown permissions, progress dependencies, missing state, identity changes, competing sessions and repeated writes are rejected. A separate authenticated CSRF-protected POST and explicit UI confirmation initiate the experiment. No startup code writes anything. General unlock/reset/batch endpoints remain disabled. Evidence is stored before sending; local evidence retention remains subject to Render Free filesystem limits. Live test at 2026-10-13 12:37:36 UTC: API name 46, stat block 2, bit 14 changed from locked to unlocked. Steam returned result 1, no stale flag and no failed validation; a fresh read found no unrelated stat or achievement changes. The account went from 35/49 to 36/49, and the user independently observed the unlock in Steam.

## Individual activation

`achievement-writer.js` generalizes the same verified transport to one explicit API name in one game. `achievement-compatibility.js` derives conservative eligibility from the current schema and personal data; provisional eligibility is not a guarantee of acceptance. An authenticated CSRF-protected POST and UI confirmation initiate each write. Fresh reads, same-account identity, current CRC, single-bit mutation, unchanged schema, clean acknowledgement and unchanged unrelated stats are required for confirmed results. Writes are serialized, paced at one minute, locally journaled and never automatically retried. Dependencies and restrictions remain unsupported. Classification and transport tests use additional game fixtures; they do not claim live validation in those games. Startup only performs a read of the original Model Mania test to check persistence after reconnect.

---

<!-- SOURCE: docs/achievement-selection-and-removal.md -->

# Reviewed achievement selection and removal

The main account can select 1–32 eligible achievements from one fresh direct reading. Selection survives filters and pagination. A locked checkbox requests activation; an unlocked checkbox requests removal when a complete current Steam snapshot establishes a unique unrestricted client bit. Naturally earned and unrecorded unlocks are eligible for the same review; an original panel activation receipt is not required. Refresh, disconnect, lock, account change and modal close invalidate selection.

**Review selected changes** shows every activation, removal, related progress effect and exact counter change. Confirmation binds the canonical selection, schema, CRC, raw values and recorded history to one revision. The API requires `confirmed:true` and that revision. No preview writes Steam; cancelling confirmation sends nothing. The server reads Steam again and reserves all affected targets durably before one store request. A fresh full read must match every reviewed raw statistic and achievement state, with a clean acknowledgement and no unexpected changes.

## Supported changes

- Multiple unrestricted bit changes combine masks without resetting the game.
- Exclusive client-writable INT/FLOAT and simple shared INT counters are reviewed. Every newly crossed locked threshold must be explicitly selected; all related effects must be known and unrestricted. At most 64 effects are reviewed.
- FLOAT activation sends only counter bits. Mixing it with explicit achievement-bit changes in the same block is rejected because remote store ordering is unverified.
- Removal clears only the selected achievement bit and preserves every INT/FLOAT gameplay counter, including newer and shared progress. The review warns that the game or Steam may unlock it again when checking preserved progress. A mixed unlock counter update that affects a selected removal requires separate reviews.
- A decrease violating increment-only, min/max or max-change constraints is rejected. Remaining unlocked achievements cannot lose supporting progress below their goal.
- Shared FLOAT, AVGRATE and complex progress expressions remain unsupported for counter updates. Removal never changes their counters. Ambiguous achievement identifiers and protected/trusted achievement bits remain unavailable.

Removal creates a new event; original activation receipts are preserved. A confirmed removal permits a later separately reviewed reactivation. Failed/unknown operations retain reservations and block further account writes. There is no automatic retry or global reset. Old individual writers share the operation lock, cooldown and unresolved-operation checks.

## Persistence and endpoints

Apply `migrations/003-achievement-operations.sql` after the existing migrations, before enabling this workflow. It adds operation/target tables, a foreign key, a partial unique reservation index and bounded history indexes. The application does not silently create this schema or fall back to local storage. Missing schema leaves previews read-only.

POST `/api/achievement/change-preview`: `{accountId,appid,selection:[{apiname,action}]}`.
POST `/api/achievement/change`: same input plus `revision` and `confirmed:true`.
Both enforce panel authentication, origin/CSRF, current main Steam identity and resource admission. Session validity is rechecked immediately before transport.

The account advisory lock serializes reservation checks across instances. The transaction rechecks the history fingerprint and reserves every affected member atomically. Confirmation is checked against the immutable original stored intent before reservations can be released. Game history projects bounded provenance fields instead of loading full verification payloads for thousands of rows.

## Validation and remaining evidence

256 automated tests passed, including bit 31, multi-target INT thresholds, counter preservation (updated in 2.1.3), exact FLOAT raw values, malformed inputs, stale reviews, failed persistence, session/context changes and no retries. Real PostgreSQL tests ran only on an isolated Neon branch using synthetic snapshots: one of two concurrent reservations succeeded, both members were retained, forged confirmation was blocked, a confirmed removal was recorded and reactivation became reviewable. All four existing receipts and their fingerprint remained unchanged; zero Steam writes were sent.

Desktop and mobile browser tests used a localhost fixture with no Steam transport. Remote multi-target writes and removal remain provisional until the user confirms a concrete live review. [Steamworks ClearAchievement](https://partner.steamgames.com/doc/api/ISteamUserStats?l=english) describes the native API; it does not certify this remote protobuf writer.

Completed Neon migration context (audit only; do not reuse):
- migration_id: ac00c935-0532-4395-8c6a-aece4a540027
- project_id: wispy-dew-70605445
- temporary_branch_id: br-old-waterfall-b8obanj5
- parent_branch_id: br-dark-poetry-b8lkap7a
- database_name: neondb
- migration_sql: exact contents of migrations/003-achievement-operations.sql

The user explicitly approved publication and migration. The Neon connector applied the exact migration SQL to the parent production branch on 2026-10-14 UTC and deleted the temporary test branch. Production legacy history count and fingerprint remained unchanged across application. New operation tables contain no synthetic records.

## Visible controls (2.1.3)

The action strip remains visible before selection. Community/automatic fallback readings show **Enable achievement changes**, which requests a fresh direct reading only. After successful verification, the strip explains the 32-selection limit and current unrestricted removal scope. **Review selected changes** stays disabled until a checkbox is selected; **Clear selection** appears only for a selection. Eligible unlocked achievements also have **Review removal**. Unavailable rows display their actual snapshot, permission or history reason. No shortcut writes Steam or bypasses full-impact confirmation. The footer shows v2.1.3. No live removal is claimed until Steam confirms a separately authorized write.

## Bulk Unlock all, Lock all and counter reset

- **Unlock all / Lock all**: `POST /api/achievement/change-preview` and `POST /api/achievement/change` accept `bulk: true`, `bulkAction: 'unlock_all' | 'lock_all'`, `resetCounters: boolean` and `allowRetoggle: boolean`, scaling up to 8,192 achievements in a single reviewed operation while retaining full bitmask/counter verification.
- **Counter reset on Lock all**: When `resetCounters: true` is selected during `lock_all` (or bulk removal), writable non-`incrementonly` INT and FLOAT counters whose referencing achievements will all be locked are reset to `Math.max(0, min)`.
- **Bounded JSONB receipts**: `cleanOperation` compacts stored effect arrays above 64 items when a bulk receipt would otherwise exceed 65,536 bytes, preserving `totalEffects` and `effectsTruncated: true`.

---

<!-- SOURCE: docs/banner-and-reading-controls.md -->

# Banner fallback and simpler reading controls — 2026-10-13

Game cards retain a consistent artwork area. If the modern Steam header fails, the image tries the legacy Akamai header and then the modern library hero. Retries are bounded to two alternatives; repeated error events do not restart the chain. All requests remain browser-side static Steam assets, without new backend/store lookups. When no image is available, a styled title/initials placeholder remains instead of a blank card.

Achievement reading alternatives move into a collapsed Reading options menu. Automatic remains the default for connected game cards; direct Steam-session verification and Community reading remain available for recovery and compatibility checks. Refresh and Close stay immediately visible. The menu closes when a reading begins. Compatibility/sort/search controls use a compact desktop grid and responsive mobile layout. Games with no pending achievements display a concise completion message instead of zero-filled diagnostic counts.

No activation or persistence logic changes. Regression tests cover the finite image fallback chain, placeholder, menu default state, direct-mode selection and existing activation/reading flows.

---

<!-- SOURCE: docs/float-discovery.md -->

# Finding a real decimal achievement

UI update: the separate discovery tool has been removed from the public panel at the user's request. The following describes the bounded diagnostic endpoint and the earlier tool; ordinary progress detection now happens within achievement reading. See progress-ui.md.

Previous candidate logs kept only four generic progress examples, which happened to be INT counters. They do not establish that the user's library has no FLOAT achievement. Sniper: Ghost Warrior's two review candidates, Sniper Expert and Sniper Master, use the shared INT stat_headshots counter. No live FLOAT candidate has been confirmed yet.

The folded **Find decimal achievements** tool searches Steam-confirmed owned games. Each user click performs at most four batches of eight games, stops when a decimal preview candidate is found, and keeps its cursor for a later click. Played games are prioritized without assuming any specific title uses FLOAT. No search runs during normal startup or achievement opening. Stop, panel locking or account changes prevent pending results from rendering under another account.

GET /api/achievement/float-search requires the authenticated connected server-managed main account, uses heavy admission and a twelve-request-per-minute limit. A 256 KiB cache retains at most three lightweight library lists for thirty minutes, scoped to account, Steam identity and web-session version. Continuations require a matching library revision. Direct reads are sequential, bounded to 1.2 seconds each, and candidates are taken only from actual FLOAT definitions. Missing or timed-out readings remain unknown and cannot prove incompatibility. A later ordinary direct reading can use its longer timeout to inspect such a game.

Results include game, achievement, statistic, current value, goal and preview eligibility/reason. Shared, protected, already-unlocked and missing-state FLOATs can be identified without being offered as writable targets. Candidate retention is capped at sixteen with preview-eligible candidates first. The tool provides game-opening controls only, never a confirmation or write request. Logs record bounded candidate summaries so a follow-up can identify the exact example without exposing the whole library.

The earlier discovery UI has been removed; the endpoint remains available for bounded development diagnostics. The typed FLOAT writer now has synthetic validation (see float-progress.md), but no live candidate or successful decimal attempt has been confirmed. This continuation could inspect the authenticated panel but its browser could not navigate to the diagnostic endpoint. No new search result is claimed, and no visible search control or automatic scan was reintroduced.

---

<!-- SOURCE: docs/float-progress.md -->

# Reviewed decimal progress writes

FLOAT (schema type 2 or FLOAT) is decoded from the uint32 IEEE-754 bit pattern. INT decoding and writers remain unchanged. Nonfinite values, missing/duplicate personal values, unknown permissions, ambiguous identifiers, malformed constraints and complex expressions cannot produce a decimal plan.

Direct reads offer one **Review progress** action. The schema selects the review automatically. The authenticated main-account-only GET /api/achievement/float-progress-preview reads a fresh snapshot and verifies the session. It returns current value, goal, limits, proposed representable value and revision. Confirmation is available only with a safe typed plan, PostgreSQL history and no previous attempt. Reviewing neither reserves history nor sends a write. Heavy-operation admission and the ten-per-minute preview limit are retained.

If float32 rounding falls below the goal, the next representable positive value is used and all bounds/maxchange constraints are checked. Counters never decrease. A locked achievement whose counter already reaches its goal stays review-only; no no-op attempt or bit-only fallback is allowed. The INT writer still rejects FLOAT when allowProgress is requested.

The internal float mode requires the exact reviewed revision and persistent history. prepareFloat rechecks permissions, all personal values, unique identifiers, schema and CRC. It sends exactly one uint32 stat_value containing the proposed IEEE-754 float32 bits. It never sends achievement bits or unrelated statistics. Steam may automatically unlock the one linked achievement; this protocol interpretation remains provisional until a separately authorized live example confirms it. The confirmation describes the exact change and possible linked unlock. There is one attempt, without fallback or retry.

Durable intent stores type:FLOAT, decoded before/after values, beforeRaw/afterRaw and the revision before transport. A fresh response must preserve the schema and all other raw values, have a valid CRC and exactly the proposed float bits, and show only the linked achievement unlocked. A clean acknowledgement alone cannot confirm success. progressVerification records the observed raw value; the journal compares confirmed results with the persisted intent. Missing verification, rejection, unexpected changes or failed history saving leave an unresolved attempt. No migration or local-history fallback is added.

Shared FLOAT, aggregated counters, protected/trusted-server statistics and AVGRATE are excluded. AVGRATE requires time-window semantics and cannot be treated as a decimal counter.

Synthetic tests exercise the real protobuf serializer, upward rounding and subnormals, permissions, limits, completed locked counters, stale revisions, failed persistence, identity changes, acknowledgement failures, invalid verification, missing/duplicate statistics, changed schemas, raw mismatches and extra unlocks. UI tests cover cancellation, changed account context and exact reviewed submission. These fixtures are not live Steam evidence.

References: [Steamworks Stats and Achievements](https://partner.steamgames.com/doc/features/achievements?l=english), steam-user's installed CMsgClientStoreUserStats2 protobuf (uint32 stat_value), and previously reviewed SAM commit de8b71048a0cee3c3e97cd8535e0f55ca86513e4. No upstream implementation was copied. Native Steamworks/SAM behavior does not certify this remote protocol writer.

Next: identify an owned-game FLOAT example with fresh schema and personal state, review its exact counter change, and obtain explicit user confirmation before one live attempt. No live FLOAT candidate or unlock has been confirmed in this continuation. The diagnostic endpoint was inaccessible through this browser session; no new library-search result is claimed.

## Selection and recorded removal

The selection route can combine independent supported counters. FLOAT activation remains counter-only and cannot mix with explicit achievement-bit changes in the same block. Removal requires a confirmed original panel activation and exactly the recorded raw counter endpoint; constraints must permit the decrease. Later game progress blocks removal. Shared FLOAT and AVGRATE remain unsupported. See [selection and removal](achievement-selection-and-removal.md); migration 003 adds operation history for this new route only.

---

<!-- SOURCE: docs/live-achievements.md -->

# Automatic achievement synchronization — 2.2.0

An open achievement list checks its current game every ten seconds after the previous reading completes. Playing normally, unlocking an achievement elsewhere, changing progress or removing an achievement elsewhere can therefore update the displayed rows without pressing Refresh. This reads Steam state; it does not write, unlock or remove anything. Steam source availability and its own caches can delay observation, so this is periodic synchronization rather than a guarantee of instantaneous delivery.

Only the selected account and open game are read. Hidden tabs, offline browsers, closed/locked panels, selections and open change reviews pause reads. Returning to a visible tab or reconnecting requests an immediate reading. Requests are serialized and cancelled when their context closes or changes, with generation checks that discard late results. Failures use 20/40/60-second backoff and temporarily disable write controls until a current reading returns. Neither synchronization nor retry calls any write endpoint.

The server shares recent live reads for five seconds and coalesces in-flight reads. Explicit Refresh bypasses this window. Account/game/Steam identity scoped SHA256 revisions cover personal state, eligibility, progress and relevant history, while ignoring read time and rarity. A matching revision returns a small unchanged response; the browser updates the read time without rebuilding the rows. Changed reads retain filters, search, pagination, scroll and previously fetched rarity. Cache and Steam connection limits are unchanged.

The collapsed **Changes observed** section records up to twenty observations while the list remains open and renders the latest eight. Deltas are available when the client's previous revision still matches the server's previous cached view. Another tab, eviction or a very large uncached view can prevent a complete delta history; the full current list still updates. Only unique, stable API identifiers with known before/after states produce unlock/removal events. Schema changes, unknown states and ambiguous aliases do not invent events. Event times are observation times, not Steam unlock dates or write receipts.

The previous L4D2 removal remains independently pending until library corroboration is available. Cached library totals do not replace fresher direct rows or silently reconcile the historical operation. Source failures and unverified states remain explicit.

Regression fixes in this release also preserve unsaved settings during status polling, prevent late rarity from returning the user to page one, ignore an obsolete session's late 401 after reauthentication, and recheck session authority through the final experiment reservation/persistence boundary. Every achievement write API requires explicit confirmation. Shared operation completion binds exact result/acknowledgement evidence to its immutable original reviewed intent.

## Verification

Run `npm run check`, `npm test`, `npm run test:memory` and `npm audit --omit=dev`. Tests use local fixtures and synthetic Steam transports. The maximum live synchronization smoke reads 8,192 achievements twelve times under the production heap settings and fails at a 400 MiB sampled RSS threshold, retaining headroom below the requested 500 MB budget. Sampled tests and live metrics are evidence, not an absolute maximum-RAM guarantee.

The GitHub Quality checks workflow repeats these checks without Steam credentials or production database access.

## Growth path

The new read-only synchronization and delta primitives provide a base for progress targets, per-game compatibility evidence and optional user-visible change exports. Future persistent personal-history or push-notification features need explicit retention/delivery choices. Publisher statistics, AVGRATE semantics and automatic achievement writes remain outside the new synchronization feature; they must not be inferred from a polling update.

---

<!-- SOURCE: docs/progress-ui.md -->

# One progress action

The decimal discovery button was a diagnostic tool. The user requested a normal achievement workflow without exposing statistic types or a separate decimal section. The panel no longer displays a library search tool or runs its search. The authenticated, bounded read-only discovery endpoint remains available for development diagnostics; it is not called during normal UI use.

Progress entries offer one **Review progress** action. The schema chooses the exclusive INT preview, shared-counter review or decimal review. The panel does not ask the user to identify the statistic type or append internal identifiers to the normal progress line. A safe decimal review with persistent history displays **Confirm reviewed progress update** within the existing compact review panel. A separate confirmation names the exact counter change and possible linked achievement unlock. Unavailable or inconsistent reviews show a reason without a write control. There is no type selector, separate decimal section or automatic scan.

The first user-triggered library search attempted 32 of 523 owned games. The available final two batch logs contained no FLOAT candidates and had unreadable games; this is not proof that the complete library has no decimal achievements. No live FLOAT unlock has been confirmed.

## Reviewed selection

Eligible entries also have one checkbox. Locked entries request activation; unlocked entries with a confirmed panel activation request removal. Review selected changes uses the same compact impact panel, including progress and decimal counters. Selection survives filters/pages and is cleared when the reading or account context changes. See [selection and removal](achievement-selection-and-removal.md).

---

<!-- SOURCE: docs/rarity-and-regression-audit-2026-10-14.md -->

# Rarity and regression audit — 2026-10-14

The user reported Common 100% for Left 4 Dead 2, missing percentages in other games and broken rarity filters.

## Reproduced causes

Read-only public requests returned 101/101 Left 4 Dead 2 achievements at exactly 100% from both the official global Web API and Steam Community HTML. The corrected reader does not treat this unusual complete distribution as established rarity. Counter-Strike: Source returned 147 valid API percentages, 112 distinct values, ranging from 2.7% to 63%; 34 Mythic and 41 Epic. These are fresh observations, not hardcoded replacement data.

Direct personal protocol reads intentionally do not contain global percentages. The browser previously loaded them only after selecting a rarity filter or percentage sort, so ordinary achievement browsing showed no percentages. This is corrected with one bounded, deduplicated asynchronous lookup after opening a direct reading. Personal verification returns first and is not delayed by global data.

## Corrections

- Shared server/browser validation accepts finite decimal percentages from 0 to 100; null/blank/boolean/object, negative and out-of-range values stay unknown. Tier derives from the validated value, never a stale supplied tier.
- A complete multi-achievement distribution of all 100% is marked suspect and displayed unverified, rather than as all Common. One genuine 100% or a mixed distribution remains valid; incomplete distributions are not falsely described as complete.
- The global reader requests Community titles when the API is missing or suspect. Only unique English title matches may enrich direct rows. If both sources remain suspect, the API returns an explicit rarityStatus/rarityMessage and empty safe percentage maps.
- Standard readers also sanitize API/HTML rarity, preserve exact personal states, and reject arbitrary duplicate-title matches.
- Direct lists load global percentages automatically. Late responses are bound to game/account/modal serial and cannot populate a different game. Existing selections and verified states survive enrichment.
- Retry rarity bypasses the metadata cache after a failed or suspect lookup. It sends only a read. There is no automatic poll or retry loop, and existing admission/rate/cache limits remain.
- Status sorting preserves stable order within each group and places unknown personal states last.
- Public dependency ordering and HTTP routes include the shared rarity script. Version/package lock/footer are 2.1.2, assets v27.

Rarity filters remain functional for valid data. They cannot truthfully assign Mythic/Epic classes to L4D2 while Steam's two public sources remain at uniform 100%. The UI explains that limitation, preserves all achievements under All, and offers a read-only retry. No historical values were invented or silently substituted.

## Audit coverage and resource evidence

271 automated tests pass, including HTTP authentication/CSRF/origin, settings/game controls, schedules, card parsing and pause/reconnect behavior, account lifecycle, request limits, persistence restore, Steam sources, personal-state validation, rarity filters/sorts, progress review, multiple selection, recorded removal, durable reservations, no automatic retries and stale context/session rejection. New tests reproduce the all-100% anomaly, valid-source fallback, genuine 100%, duplicate titles, invalid percentage coercion, automatic enrichment without a filter click, cache-bypassing retries and changed-game races.

npm run check passes. npm audit --omit=dev reports zero production vulnerabilities.
Synthetic HTTP stress: 64 requests, five admitted and 59 busy rejections, sampled peak RSS 219 MiB (~230 MB).
Maximum synthetic achievement planning/verification: 8192 achievements, 32 targets, 64 effects, eight iterations, peak RSS 153 MiB (~160 MB).
Both sent zero Steam writes. These measurements are below the requested 500 MB but do not prove every possible production workload. Resource budgets and dependencies were not increased.

Manual public-source verification uses the actual corrected reader against Steam; browser QA uses captured real global data with unverified personal states and no Steam transport. No farming/claim/achievement action is sent to a real account. Regression coverage cannot certify every publisher's remote writing behavior.

References: [Steam Web API](https://partner.steamgames.com/doc/webapi/ISteamUserStats), [L4D2 global achievements](https://steamcommunity.com/stats/550/achievements/?l=english), [Counter-Strike: Source global achievements](https://steamcommunity.com/stats/240/achievements/?l=english).

---

<!-- SOURCE: docs/rarity-filter-fix.md -->

# Rarity filter correction — 2026-10-13

Direct protocol reads intentionally return unknown global percentages. Previously only percentage sorting triggered enrichment; Mythic/Epic/Rare buttons immediately excluded all unknown values and therefore appeared broken.

Rarity selection now requests missing global Steam percentages through the existing authenticated bounded endpoint, without re-reading personal achievement state or writing achievements. Pending lookups are deduplicated, and successful lookups are reused for the current reading, including unknown entries. Refresh allows another lookup. Responses from a different game/account/reading cannot populate the current list.

Loading and unavailable-percentage messages distinguish missing data from genuinely empty filtered results. Genuine zero remains valid, unknown is never zero, and boundaries are Mythic below 5, Epic 5 to below 15, Rare 15 to below 40. Status/search/compatibility filters continue to combine with rarity.

Regression tests cover button clicks, tier boundaries, pending-request reuse, verified-state preservation, empty global data and stale game responses. This change sends no Steam achievement writes.

---

<!-- SOURCE: docs/rarity-recovery-2.1.3.md -->

# Rarity recovery and removal correction — 2.1.3

The user's screenshots establish two different problems: Steam rarity returned a uniform 100% distribution, and the panel limited removal to its own confirmed activations. Hiding anomalous percentages fixed misleading Common labels but did not restore usable L4D2 filters. Restricting removal to recorded panel grants did not meet the requested behavior.

## Official percentage evidence

Direct public API v2 and Steam Community reads both returned 101 entries at 100% for AppID 550. The actual Community page was also checked in a browser. A normal browser user agent did not correct the direct HTTP response. AppID 240 returned a varied distribution. These observations do not prove an upstream root cause.

An indexed copy of [the official English Steam Community page](https://steamcommunity.com/stats/L4D2/achievements/?l=english) supplied 101 unique titles with varied percentages. Its reported crawl was "last week"; the exact original observation date is unavailable. `data/rarity-snapshots.json` records the retrieval time, source note and explicit expiry. The historical fallback is labelled prominently and never presented as a fresh Steam observation. It expires on 2026-11-04 UTC. Live validated data always takes priority. Title matching remains unique and updates rarity metadata only, never personal state or API names.

The reader additionally retains successful live observations for seven days in a per-app LRU capped at 16 entries and 256 KiB of serialized data. Failed, missing, ambiguous and uniform 100% responses cannot replace those observations. The buffer is included in memory reporting and cleared when the application closes. It is in-memory retention, not durable storage; the checked-in historical L4D2 snapshot remains available across deployments until expiry. Existing one-hour request caching and bounded request admission remain in place. No database migration is needed.

## Removal and verification

Currently unlocked, unique, unrestricted client achievement bits can be selected regardless of their origin. A complete personal snapshot and an actual returned CRC are still required. Unresolved attempts, protected permissions and ambiguous definitions remain blocked and show their real reason.

Removal preserves all gameplay counters, including shared, increment-only and FLOAT counters. It clears only selected bits. Reviews warn that preserved game progress can unlock the achievement again. A counter update for another selected unlock that also references a selected removal requires a separate review. Exact revision, durable reservations, acknowledgement and full fresh verification remain mandatory. Counter changes or unrelated achievement changes prevent confirmation.

The reconnect handler also cancels a queued retry when Steam has already logged in, or when a subsequent rejection requires a new login. This prevents stale retry work from tearing down a recovered connection or retrying rejected credentials.

All write transports used during automated verification are synthetic. Production UI checks stop at the concrete review and do not press confirmation. Publishing these controls does not establish that Steam will accept every remote removal or decimal update.

---

<!-- SOURCE: docs/rarity-xml-matching.md -->

# Rarity for community achievement lists

The Left 4 Dead 2 screenshot showed a verified Steam Community XML list with all rarity values unknown. Public Steam API and global community payloads retrieved on 2026-10-13 each supplied 101 percentage entries. Parsing those captured payloads with the updated helper produced 101 API percentages and 101 unique English-title percentages (39 below 5%, 37 from 5% to below 15%, 20 from 15% to below 40%). The user's raw XML was not captured, so the exact identifier variation is not proven.

Rarity lookups now tolerate case variations in API names only when the folded key is unique. Community/XML reading additionally requests global Steam Community percentages keyed by unique normalized English titles. Duplicate upstream titles or duplicate personal titles cannot be used for title matching. These matches update percent/tier only; API identifiers, achievement state, dates, progress and write compatibility are never changed or inferred from titles. True zero remains valid and unknown values remain unknown.

Rows without API names now trigger rarity lookup too. The metadata mode has a separate cache/pending key from API-only responses. Direct protocol reads continue using the API-only lookup, avoiding an extra community request. Both optional sources retain 5-second/512-KiB limits, execute in parallel and tolerate one unavailable source. Empty results are not cached for an hour. No delay is added to initial achievement reading; lookup happens on demand for rarity/sorting.

Local Node outbound requests timed out during one live probe; independently downloaded public Steam responses were used for parser validation. No authenticated user achievement read or write was performed during this fix. Follow-up on 2026-10-13: the actual panel showed Epic 37, Rare 20 and Mythic 39 with real percentages. Direct protocol reading verified 71/101 personal unlocks; Rare and Mythic were also checked on that verified list. Community reading returned the global catalog with the same three filter counts, but could not verify personal XML during this session. The XML-title matching path therefore retains synthetic coverage rather than a new authenticated XML claim. No achievements or statistics were written.

Remaining activation work: validate the implemented FLOAT writer on an explicitly reviewed real example; extend shared support beyond one new unlock; evaluate multi-counter/complex expressions and AVGRATE independently. Publisher/server-controlled permissions remain unavailable to client writes. Existing recorded success in several games does not imply universal compatibility.

---

<!-- SOURCE: docs/removal-library-verification.md -->

# Removal verification and conflicting native Steam state — 2.1.4

The user provided a Steam library detail screenshot showing CACHE AND CARRY still unlocked and 71/101 while fresh ClientGetUserStats reads show its bit cleared and 70/101. The separate Steam Community loading errors also occur on four independent profiles, but those errors cannot explain away the contradictory native detail view. The existing immutable receipt is retained; it proves the earlier acknowledgement and bit-level verification, not reconciliation with the native library.

Direct snapshots now also request Player.GetAchievementsProgress#1 through the already-authenticated Steam client, scoped to the same account and one AppID. The summary is bounded to 8192 achievements and has a 1.5-second timeout with disconnect/error/job cleanup. It contains an aggregate count and a cache timestamp, not individual achievement identifiers. Missing or invalid responses remain unavailable.

If this summary disagrees with the bitmask count or catalog size, every personal row is shown as unknown, preserving bit evidence separately. Automatic reading retains the conflict instead of hiding it behind a catalog fallback. Existing planner guards then block all achievement writes and the UI reports both counts.

Removal confirmation additionally requires the full original bit/counter/schema verification plus a matching aggregate summary whose cache timestamp is at least the initial reviewed read time. Missing, old or conflicting summaries leave the attempted operation unknown with its reservation retained. They do not trigger another write. Matching aggregate data is additional evidence, not an independently verified per-achievement native UI result. Unlock-only behavior keeps its existing verification requirements.

Read-only and synthetic regression tests cover mismatched counts, old/missing summaries, timeout cleanup, malformed responses, the real-format parser, automatic-mode conflict preservation and blocked previews. No real achievement changes were sent while implementing this safeguard. No explicit_reset flag or gameplay counter behavior was changed.

---

<!-- SOURCE: docs/shared-counter-activation.md -->

# Shared-counter implementation checkpoint — 2026-10-13

## Status

Implementation and isolated database migration testing are complete. On 2026-10-13 the user explicitly approved the production migration and publication. The reservation table was applied to the main Neon branch; the temporary test branch was deleted by the migration workflow. Existing write-history row count and content fingerprint were unchanged. Publication follows this checkpoint. No live Steam write was sent.

Candidate reviewed by the user: Team Fortress 2 Team Doctor, Medic.accum.iHealthPointsHealed 0 → 25000. Team Doctor would unlock; Chief of Staff would remain locked with 25000 / 1000000 progress. Values must be freshly read again before any operation.

## Supported scope

One direct, writable INT counter shared with known, unrestricted achievements. Exactly one newly unlocked achievement per operation. Multiple unlocks, missing/ambiguous states, protected permissions, complex expressions and insufficient constraints are rejected. Each related achievement is recorded, including progress-only and already-unlocked effects. No changes to game saves or publisher accounts are claimed.

## Durable intent

The main achievement receipt stores sharedEffects and groupMembers before sending. A new steamfarmer_shared_reservations table reserves each locked affected member under the same transaction and account advisory lock. The existing one-minute cooldown, retention limit and no-retry policy apply. Individual/exclusive-progress reservations also check shared membership. There is no local fallback for shared operations.

After Steam acknowledgement, the writer reads again and checks the full statistic set, unchanged schema, every related achievement state and the shared counter. Only a clean acknowledgement and exact effects produce confirmed. finishShared compares verification against the persisted effects before atomically recording the result and releasing membership. Unconfirmed, rejected or interrupted operations retain their reservations. The main receipt retains all effects after release, so a progress-only member can later receive a separately reviewed operation without losing this history.

Preview is read-only. The confirmation button is available only when the plan is safe and the persistent reservation schema is installed, with no conflicting recorded attempts. The browser must explicitly confirm the full effect list and submit mode shared with the exact reviewed revision. No startup hook or automatic unlock is added.

## Migration handoff

Migration file: migrations/002-shared-counter-reservations.sql. It adds a table and changes no existing achievement records.

Neon prepare_database_migration context (must pass these exact values when the user approves):

- migration_id: d2fc3165-29b7-4856-bd9d-7820c7caa756
- project_id: wispy-dew-70605445
- temporary_branch_id: br-young-king-b84t3lqo
- parent_branch_id: br-dark-poetry-b8lkap7a
- database_name: neondb
- migration_sql: CREATE TABLE IF NOT EXISTS steamfarmer_shared_reservations (account_id TEXT NOT NULL, appid BIGINT NOT NULL, apiname TEXT NOT NULL, owner_apiname TEXT NOT NULL, PRIMARY KEY (account_id, appid, apiname), FOREIGN KEY (account_id, appid, owner_apiname) REFERENCES steamfarmer_achievement_writes(account_id, appid, apiname));

The temporary branch passed schema, foreign-key, duplicate-reservation, two-member transaction and independent readback checks with synthetic records for account 76561198000009999. Those records existed only in the temporary branch and were not Steam account activity. The migration context above is retained for audit, not for reuse: this migration has now been completed with user confirmation.

## Verification

Unit tests exercise shared planning, stale previews, protected effects, accidental extra unlocks/statistics, failed reservation, missing verification, all-effect verification, durable reservation across instances, rollback and contention. UI tests cover complete confirmation wording, cancellation and exact submission. API tests enforce authentication, reviewed revision and missing-persistence rejection.

## Reviewed multi-selection

Migration 003 adds a separate reviewed selection route for multiple shared INT unlocks. Every newly crossed threshold must be explicitly selected; all related effects must be known and unrestricted. It shares account locking and cooldown with legacy writes. The legacy shared endpoint retains its one-unlock restriction. See [selection and removal](achievement-selection-and-removal.md).

---

<!-- SOURCE: docs/shared-review-design-and-dates.md -->

# Shared review UI and date provenance — 2026-10-13

The shared-counter review now uses a separated current/proposed counter summary, responsive effect cards, explicit unlock versus stays-locked badges, accessible proposed-progress bars, and a dedicated confirmation footer. Technical statistic identifiers use compact code styling. No achievement writes occur while rendering or reviewing.

Unlock dates from Steam are labelled Steam-reported unlock date. Confirmed journal entries additionally expose panelOperationAt and, when available, panelVerifiedAt. Historical receipts retain their original checkedAt as the operation-recorded time; it is not invented as an exact verification time. Future confirmed writes record verifiedAt after the independent read. If a Steam timestamp predates the recorded operation by more than a day, the UI explains that these are separate sources. Steam metadata is neither overwritten nor reset.

Live read-only evidence: TF2 TF_GET_HEALPOINTS (Team Doctor) receipt confirmed, operation recorded 2026-10-13T19:25:50.878Z. Steam acknowledged result 1, without stale or rejected stats. Fresh verification observed Team Doctor unlocked and TF_MEDIC_HEAL_GRIND (Chief of Staff) locked, both at counter 25000; no unrelated statistic or achievement changes. The record is persisted in Neon. The exact origin of the user-reported February 2022 Steam date is not established from this receipt; prior raw timestamps were not recorded. The panel cannot claim that this metadata represents the time of the test.

Regression tests cover distinct date labels without changing Steam metadata and accurate proposed bars (Chief 25000/1000000 = 2.5%). This update does not send new activations.

---

<!-- SOURCE: docs/stale-library-summary.md -->

# Stale Steam library summary — 2.1.5

The 2.1.4 warning treated any library aggregate/statistics disagreement as a fresh conflicting personal snapshot. Production returned raw statistics 70/101 and an aggregate 71/101 with cache timestamp 2026-10-14T05:24:42Z, preceding the 16:22 removal. This blanked all 101 personal states and disabled every change because of an old summary.

A disagreeing aggregate with a positive cache timestamp older than the direct read is retained as diagnostic evidence but cannot erase current bitmask states. Fresh or undated disagreements continue to fail closed. The visible contradictory-count warning is removed for stale aggregates.

History scopes the unresolved library corroboration to a prior confirmed removal. Only that achievement is displayed as awaiting confirmation, with all its write controls disabled until a newer matching summary corroborates it. Other rows retain their direct personal states, status/rarity filters and eligibility. The header uses the full achievement count when some rows are unknown. The immutable earlier receipt remains unchanged.

The typed planner checks a previous removal against the current summary/count and its recorded verification time before allowing another operation on that target. Individual activation routes must use the reviewed selection for any target with a previous removal, so they cannot bypass this check. New removal confirmation still requires complete raw verification and fresh matching library evidence. Nothing silently retries or marks the removal reconciled.

Tests cover old versus fresh disagreement, row-scoped pending removal, unchanged row availability and previews, single-route bypass prevention, absent/older/contradictory reactivation evidence and the existing writer regressions. No Steam writes are used in this work. The user will decide separately whether to remove CACHE AND CARRY in SAM.

---

<!-- SOURCE: docs/ui-controls-review.md -->

# Control review — 2026-10-13

Scope: dashboard code and server handlers behind its controls. After user approval, the simplifications below were implemented on 2026-10-13. No achievement writes were performed; server activation and progress logic are unchanged.

“Percentage: highest first” replaces the equivalent “Most common first”: descending global Steam unlock percentage, genuine zero preserved, unknown values last. Direct reads fetch missing percentages separately without changing verified states. Authenticated lookups are deduplicated and cached for one hour (16 entries / 256 KiB); response limit 512 KiB and timeout five seconds.

Higher percentage means more players obtained an achievement, not necessarily lower difficulty.

| Control | Recommendation | Reason |
| --- | --- | --- |
| Steam sign out / Delete profile | Hide or explain unavailability on the main account; keep for additional accounts. | Server rejects both operations for the environment-managed main account. |
| Verify directly / Standard reading / Refresh | One reading-mode selector plus Refresh. | Automatic reading already tries direct verification first; retain standard fallback. |
| Disabled Unlock / progress actions | Show only an eligible action, retaining visible restriction reasons. | Repeated unavailable buttons clutter achievement rows. |
| Claim free games | Move to Advanced and explain its supported list. | Requests five fixed free licenses, not the whole free catalog. |
| Change password / Refresh Steam session | Settings/account menu, with contextual session recovery. | Low-frequency actions compete with farming controls. |
| Clear all games / Remove | Contextual menus; retain destructive-action confirmation. | Avoid accidental removal and visual clutter. |
| Game presets | Optional collapsed section. | Useful during setup, not every visit. |
| Discord webhook Test | Rename Save & test. | Handler saves the URL and sends a message. |

Keep Pause/Resume, Cards, Achievements, Close, search and filters readily accessible. Keep history refresh, schedule save and Steam-chat permission management in Advanced. Preserve security locking and verification functions.

Implemented: reading-mode selector (Automatic / Direct verification / Standard), contextual account and list menus, per-game removal menu, collapsed presets, panel/password and supported-license controls in Advanced, and Save & test webhook label. Main-account sign-out/deletion are hidden with an explanation, while additional profiles retain their controls. Unavailable activation buttons are omitted but restriction reasons remain visible. Eligible activation, exclusive progress previews and read-only shared-counter review remain available.

Verification: 137 automated tests pass, including normal activation submission, cancellation, progress preview/confirmation, account-scoped controls, mode switching and automatic refresh. Tests use simulated Steam transports; this UI update did not grant a new live achievement.

---

<!-- SOURCE: docs/web-audit-2026-10-13.md -->

# Web audit: selection, removal and resource budget

Completed against main 59dcbf1c7cf111075379187e8a2d7f6fcfb11991 plus the reviewed FLOAT continuation. Dependencies remain unchanged.

## Corrections and optimizations

- Late status/history responses cannot repopulate a locked panel. Account identity changes or a missing selected profile close the achievement modal and clear cached personal data.
- Disconnect invalidates selection and disables writes until a fresh reading. A progress preview cannot confirm after closing/reopening the same game.
- Server session revocation is checked again before transport, including after durable reservation. Unresolved intents block both old and new write routes.
- Selected writes preserve immutable persisted intent; a forged, partial or mismatched confirmation cannot release reservations. Historical receipts are retained.
- Heavy writes remain serialized; selection is capped at 32, effects at 64, game history at 8,192 and stored operations at 10,000 per account. History projection avoids loading full verification payloads for every achievement.
- Reuse one parsed schema/index for selection planning. Store requirements load once only when expanded. Up to 64 history effects render only when their disclosure opens.
- Chunked oversized JSON now returns structured HTTP 413 and drains the stream instead of destroying the request socket. Strict JSON MIME/UTF-8, AppID and hours validation rejects coercible arrays, booleans, hex and exponent strings.
- Successful bodyless HTTP 204 responses work with webhooks. Sleep scheduling reuses one timezone formatter.
- Free-license claims share bounded admission, reject overlap and obey a one-minute cooldown; late callbacks cannot update a replaced client/profile. Their timeout is cleared on all exit paths.
- Authenticated JSON is marked no-store. Static assets use a new cache version.
- Mobile achievement grids retain readable titles alongside 44px checkbox targets. Review hides duplicate selection controls and the general privacy banner.

## Reproducible validation

`npm run check`, `npm test`: 256 tests pass; npm audit --omit=dev reports zero production vulnerabilities. Coverage includes authentication/CSRF, persistence and startup restore, Steam sources/rarity, cached reads, farming settings, schedule validation, profile/session races, progress writers and selection/removal. Mocks exercise exact protocol planning, serialization and independent verification; they do not prove every publisher supports writes.

`node --max-old-space-size=192 --max-semi-space-size=8 scripts/changes-memory-smoke.js`: 8,192 synthetic achievements, 32 counters, 64 effects and eight planning/verification passes; sampled peak RSS 149.2 MiB, about 156 MB.

`node --max-old-space-size=192 --max-semi-space-size=8 scripts/memory-smoke.js`: 64 requests, five admitted and 59 rejected while busy; sampled peak RSS 234.2 MiB, about 246 MB. Both sent zero Steam writes. These measured synthetic workloads remain below the requested 500 MB; they are not a worst-case production guarantee. No connection, cache or concurrency budgets were increased. Admission still stops new work at 360 MiB RSS, and Node keeps the 192/8 MiB heap settings.

Real isolated Neon tests validated atomic reservation, concurrency, immutable verification, confirmed removal and reactivation. Legacy history count stayed four with fingerprint 973ff9b07c1f65d7b27d7e1e353e1f51. The production database/environment was unchanged.

Responsive browser review used the real static assets with localhost synthetic API fixtures and no Steam client. It inspected selection and full-impact review on desktop and a 390px mobile viewport. Cancellation is covered by automated UI tests. The browser connector timed out while opening the native confirmation; its cancellation could not be confirmed in that browser run. No live multi-target write or removal has been attempted; the user must confirm the exact reviewed live change first.
