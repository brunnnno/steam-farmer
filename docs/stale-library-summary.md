# Stale Steam library summary — 2.1.5

The 2.1.4 warning treated any library aggregate/statistics disagreement as a fresh conflicting personal snapshot. Production returned raw statistics 70/101 and an aggregate 71/101 with cache timestamp 2026-10-14T05:24:42Z, preceding the 16:22 removal. This blanked all 101 personal states and disabled every change because of an old summary.

A disagreeing aggregate with a positive cache timestamp older than the direct read is retained as diagnostic evidence but cannot erase current bitmask states. Fresh or undated disagreements continue to fail closed. The visible contradictory-count warning is removed for stale aggregates.

History scopes the unresolved library corroboration to a prior confirmed removal. Only that achievement is displayed as awaiting confirmation, with all its write controls disabled until a newer matching summary corroborates it. Other rows retain their direct personal states, status/rarity filters and eligibility. The header uses the full achievement count when some rows are unknown. The immutable earlier receipt remains unchanged.

The typed planner checks a previous removal against the current summary/count and its recorded verification time before allowing another operation on that target. Individual activation routes must use the reviewed selection for any target with a previous removal, so they cannot bypass this check. New removal confirmation still requires complete raw verification and fresh matching library evidence. Nothing silently retries or marks the removal reconciled.

Tests cover old versus fresh disagreement, row-scoped pending removal, unchanged row availability and previews, single-route bypass prevention, absent/older/contradictory reactivation evidence and the existing writer regressions. No Steam writes are used in this work. The user will decide separately whether to remove CACHE AND CARRY in SAM.
