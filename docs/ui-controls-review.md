# Control review — 2026-10-13

Scope: dashboard code and server handlers behind its controls. These are recommendations, not implemented removals. No achievement writes were performed.

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
