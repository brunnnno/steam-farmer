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
