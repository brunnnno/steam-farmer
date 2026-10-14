# Removal verification and conflicting native Steam state — 2.1.4

The user provided a Steam library detail screenshot showing CACHE AND CARRY still unlocked and 71/101 while fresh ClientGetUserStats reads show its bit cleared and 70/101. The separate Steam Community loading errors also occur on four independent profiles, but those errors cannot explain away the contradictory native detail view. The existing immutable receipt is retained; it proves the earlier acknowledgement and bit-level verification, not reconciliation with the native library.

Direct snapshots now also request Player.GetAchievementsProgress#1 through the already-authenticated Steam client, scoped to the same account and one AppID. The summary is bounded to 8192 achievements and has a 1.5-second timeout with disconnect/error/job cleanup. It contains an aggregate count and a cache timestamp, not individual achievement identifiers. Missing or invalid responses remain unavailable.

If this summary disagrees with the bitmask count or catalog size, every personal row is shown as unknown, preserving bit evidence separately. Automatic reading retains the conflict instead of hiding it behind a catalog fallback. Existing planner guards then block all achievement writes and the UI reports both counts.

Removal confirmation additionally requires the full original bit/counter/schema verification plus a matching aggregate summary whose cache timestamp is at least the initial reviewed read time. Missing, old or conflicting summaries leave the attempted operation unknown with its reservation retained. They do not trigger another write. Matching aggregate data is additional evidence, not an independently verified per-achievement native UI result. Unlock-only behavior keeps its existing verification requirements.

Read-only and synthetic regression tests cover mismatched counts, old/missing summaries, timeout cleanup, malformed responses, the real-format parser, automatic-mode conflict preservation and blocked previews. No real achievement changes were sent while implementing this safeguard. No explicit_reset flag or gameplay counter behavior was changed.
