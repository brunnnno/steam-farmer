# Shared-counter implementation checkpoint — 2026-10-13

## Status

Implementation and isolated database migration testing are complete; production migration and deployment remain pending user confirmation. No live Steam write was sent.

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

The temporary branch passed schema, foreign-key, duplicate-reservation, two-member transaction and independent readback checks with synthetic records for account 76561198000009999. Those records are only in the temporary branch and are not Steam account activity. The migration completion workflow requires explicit user confirmation; do not apply it or delete its branch without that confirmation.

## Verification

Unit tests exercise shared planning, stale previews, protected effects, accidental extra unlocks/statistics, failed reservation, missing verification, all-effect verification, durable reservation across instances, rollback and contention. UI tests cover complete confirmation wording, cancellation and exact submission. API tests enforce authentication, reviewed revision and missing-persistence rejection.
