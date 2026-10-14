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
