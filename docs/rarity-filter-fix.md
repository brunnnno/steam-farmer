# Rarity filter correction — 2026-10-13

Direct protocol reads intentionally return unknown global percentages. Previously only percentage sorting triggered enrichment; Mythic/Epic/Rare buttons immediately excluded all unknown values and therefore appeared broken.

Rarity selection now requests missing global Steam percentages through the existing authenticated bounded endpoint, without re-reading personal achievement state or writing achievements. Pending lookups are deduplicated, and successful lookups are reused for the current reading, including unknown entries. Refresh allows another lookup. Responses from a different game/account/reading cannot populate the current list.

Loading and unavailable-percentage messages distinguish missing data from genuinely empty filtered results. Genuine zero remains valid, unknown is never zero, and boundaries are Mythic below 5, Epic 5 to below 15, Rare 15 to below 40. Status/search/compatibility filters continue to combine with rarity.

Regression tests cover button clicks, tier boundaries, pending-request reuse, verified-state preservation, empty global data and stale game responses. This change sends no Steam achievement writes.
