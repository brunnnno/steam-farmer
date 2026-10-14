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
