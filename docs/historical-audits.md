# Historical Audits Archive (SteamFarmer)

This archive consolidates historical audits from development phases 2.1.2 through 2.1.3.

---

## 1. Web audit: selection, removal and resource budget (2026-10-13)

Completed against main `59dcbf1c7cf111075379187e8a2d7f6fcfb11991` plus the reviewed FLOAT continuation. Dependencies remain unchanged.

### Corrections and optimizations

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

### Reproducible validation

`npm run check`, `npm test`: 256 tests pass; npm audit --omit=dev reports zero production vulnerabilities. Coverage includes authentication/CSRF, persistence and startup restore, Steam sources/rarity, cached reads, farming settings, schedule validation, profile/session races, progress writers and selection/removal. Mocks exercise exact protocol planning, serialization and independent verification; they do not prove every publisher supports writes.

`node --max-old-space-size=192 --max-semi-space-size=8 scripts/changes-memory-smoke.js`: 8,192 synthetic achievements, 32 counters, 64 effects and eight planning/verification passes; sampled peak RSS 149.2 MiB, about 156 MB.

`node --max-old-space-size=192 --max-semi-space-size=8 scripts/memory-smoke.js`: 64 requests, five admitted and 59 rejected while busy; sampled peak RSS 234.2 MiB, about 246 MB. Both sent zero Steam writes. These measured synthetic workloads remain below the requested 500 MB; they are not a worst-case production guarantee. No connection, cache or concurrency budgets were increased. Admission still stops new work at 360 MiB RSS, and Node keeps the 192/8 MiB heap settings.

---

## 2. Rarity and regression audit (2026-10-14)

### Reproduced causes

Read-only public requests returned 101/101 Left 4 Dead 2 achievements at exactly 100% from both the official global Web API and Steam Community HTML. The corrected reader does not treat this unusual complete distribution as established rarity. Counter-Strike: Source returned 147 valid API percentages, 112 distinct values, ranging from 2.7% to 63%; 34 Mythic and 41 Epic. These are fresh observations, not hardcoded replacement data.

Direct personal protocol reads intentionally do not contain global percentages. The browser previously loaded them only after selecting a rarity filter or percentage sort, so ordinary achievement browsing showed no percentages. This is corrected with one bounded, deduplicated asynchronous lookup after opening a direct reading. Personal verification returns first and is not delayed by global data.

### Corrections

- Shared server/browser validation accepts finite decimal percentages from 0 to 100; null/blank/boolean/object, negative and out-of-range values stay unknown. Tier derives from the validated value, never a stale supplied tier.
- A complete multi-achievement distribution of all 100% is marked suspect and displayed unverified, rather than as all Common. One genuine 100% or a mixed distribution remains valid; incomplete distributions are not falsely described as complete.
- The global reader requests Community titles when the API is missing or suspect. Only unique English title matches may enrich direct rows. If both sources remain suspect, the API returns an explicit rarityStatus/rarityMessage and empty safe percentage maps.
- Standard readers also sanitize API/HTML rarity, preserve exact personal states, and reject arbitrary duplicate-title matches.
- Direct lists load global percentages automatically. Late responses are bound to game/account/modal serial and cannot populate a different game. Existing selections and verified states survive enrichment.
- Retry rarity bypasses the metadata cache after a failed or suspect lookup. It sends only a read. There is no automatic poll or retry loop, and existing admission/rate/cache limits remain.
- Status sorting preserves stable order within each group and places unknown personal states last.
- Public dependency ordering and HTTP routes include the shared rarity script. Version/package lock/footer are 2.1.2, assets v27.

---

## 3. Rarity recovery and removal correction — 2.1.3

### Official percentage evidence

Direct public API v2 and Steam Community reads both returned 101 entries at 100% for AppID 550. The actual Community page was also checked in a browser. A normal browser user agent did not correct the direct HTTP response. AppID 240 returned a varied distribution. These observations do not prove an upstream root cause.

An indexed copy of [the official English Steam Community page](https://steamcommunity.com/stats/L4D2/achievements/?l=english) supplied 101 unique titles with varied percentages. Its reported crawl was "last week"; the exact original observation date is unavailable. `data/rarity-snapshots.json` records the retrieval time, source note and explicit expiry. The historical fallback is labelled prominently and never presented as a fresh Steam observation. It expires on 2026-11-04 UTC. Live validated data always takes priority. Title matching remains unique and updates rarity metadata only, never personal state or API names.

The reader additionally retains successful live observations for seven days in a per-app LRU capped at 16 entries and 256 KiB of serialized data. Failed, missing, ambiguous and uniform 100% responses cannot replace those observations. The buffer is included in memory reporting and cleared when the application closes. It is in-memory retention, not durable storage; the checked-in historical L4D2 snapshot remains available across deployments until expiry. Existing one-hour request caching and bounded request admission remain in place. No database migration is needed.

### Removal and verification

Currently unlocked, unique, unrestricted client achievement bits can be selected regardless of their origin. A complete personal snapshot and an actual returned CRC are still required. Unresolved attempts, protected permissions and ambiguous definitions remain blocked and show their real reason.

Removal preserves all gameplay counters, including shared, increment-only and FLOAT counters. It clears only selected bits. Reviews warn that preserved game progress can unlock the achievement again. A counter update for another selected unlock that also references a selected removal requires a separate review. Exact revision, durable reservations, acknowledgement and full fresh verification remain mandatory. Counter changes or unrelated achievement changes prevent confirmation.

The reconnect handler also cancels a queued retry when Steam has already logged in, or when a subsequent rejection requires a new login. This prevents stale retry work from tearing down a recovered connection or retrying rejected credentials.

All write transports used during automated verification are synthetic. Production UI checks stop at the concrete review and do not press confirmation. Publishing these controls does not establish that Steam will accept every remote removal or decimal update.

---

## 4. Rarity filter correction (2026-10-13)

Direct protocol reads intentionally return unknown global percentages. Previously only percentage sorting triggered enrichment; Mythic/Epic/Rare buttons immediately excluded all unknown values and therefore appeared broken.

Rarity selection now requests missing global Steam percentages through the existing authenticated bounded endpoint, without re-reading personal achievement state or writing achievements. Pending lookups are deduplicated, and successful lookups are reused for the current reading, including unknown entries. Refresh allows another lookup. Responses from a different game/account/reading cannot populate the current list.

Loading and unavailable-percentage messages distinguish missing data from genuinely empty filtered results. Genuine zero remains valid, unknown is never zero, and boundaries are Mythic below 5, Epic 5 to below 15, Rare 15 to below 40. Status/search/compatibility filters continue to combine with rarity.

---

## 5. Rarity for community achievement lists (2026-10-13)

The Left 4 Dead 2 screenshot showed a verified Steam Community XML list with all rarity values unknown. Public Steam API and global community payloads retrieved on 2026-10-13 each supplied 101 percentage entries. Parsing those captured payloads with the updated helper produced 101 API percentages and 101 unique English-title percentages.

Rarity lookups now tolerate case variations in API names only when the folded key is unique. Community/XML reading additionally requests global Steam Community percentages keyed by unique normalized English titles. Duplicate upstream titles or duplicate personal titles cannot be used for title matching. These matches update percent/tier only; API identifiers, achievement state, dates, progress and write compatibility are never changed or inferred from titles. True zero remains valid and unknown values remain unknown.

