# Read-only achievement availability — 2026-10-13

The dashboard combines the existing direct Steam schema, personal-state, progress-support and journal checks into one presentation classifier. It does not attempt writes in order to discover compatibility, add upstream requests, or expand the supported writer.

Categories: eligible to attempt; exclusive progress eligible for preview; protected permissions; unsupported expressions/types/bounds/shared counters; unknown or missing state; Steam rejection; previous attempt requiring review; already unlocked; recorded activation confirmed on this account. Unknown data stays unknown. A rejection alone is not proof of permanent protection. An already-unlocked achievement is not proof the panel granted it.

Eligibility is provisional. Only Steam acceptance plus an independent fresh read can confirm an actual update. Account policy and a disconnected session exclude actions from the attemptable filter. Server validation, confirmation, journal reservations and cooldowns remain authoritative and unchanged.

The compatibility filter combines with status, rarity, search and sort. The pending summary explains current eligible/protected/unsupported/unknown/review counts. Standard Community reads cannot establish write compatibility. Choose Direct verification or use Automatic reading, which attempts the protocol first. Each visible row has a category and a textual explanation; Show all clears combined filters. Opening a different game or account resets the compatibility filter; refreshing the same reading mode preserves it.

Implementation: a small pure classifier in public/achievement-availability.js uses existing response fields, so there is no duplicated server payload or new database cache. Native selects and existing 200-row pagination preserve a lightweight UI. All tests use synthetic data and simulated transports; no live achievement was granted by this change.
