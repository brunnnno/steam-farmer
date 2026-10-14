# Automatic achievement synchronization — 2.2.0

An open achievement list checks its current game every ten seconds after the previous reading completes. Playing normally, unlocking an achievement elsewhere, changing progress or removing an achievement elsewhere can therefore update the displayed rows without pressing Refresh. This reads Steam state; it does not write, unlock or remove anything. Steam source availability and its own caches can delay observation, so this is periodic synchronization rather than a guarantee of instantaneous delivery.

Only the selected account and open game are read. Hidden tabs, offline browsers, closed/locked panels, selections and open change reviews pause reads. Returning to a visible tab or reconnecting requests an immediate reading. Requests are serialized and cancelled when their context closes or changes, with generation checks that discard late results. Failures use 20/40/60-second backoff and temporarily disable write controls until a current reading returns. Neither synchronization nor retry calls any write endpoint.

The server shares recent live reads for five seconds and coalesces in-flight reads. Explicit Refresh bypasses this window. Account/game/Steam identity scoped SHA256 revisions cover personal state, eligibility, progress and relevant history, while ignoring read time and rarity. A matching revision returns a small unchanged response; the browser updates the read time without rebuilding the rows. Changed reads retain filters, search, pagination, scroll and previously fetched rarity. Cache and Steam connection limits are unchanged.

The collapsed **Changes observed** section records up to twenty observations while the list remains open and renders the latest eight. Deltas are available when the client's previous revision still matches the server's previous cached view. Another tab, eviction or a very large uncached view can prevent a complete delta history; the full current list still updates. Only unique, stable API identifiers with known before/after states produce unlock/removal events. Schema changes, unknown states and ambiguous aliases do not invent events. Event times are observation times, not Steam unlock dates or write receipts.

The previous L4D2 removal remains independently pending until library corroboration is available. Cached library totals do not replace fresher direct rows or silently reconcile the historical operation. Source failures and unverified states remain explicit.

Regression fixes in this release also preserve unsaved settings during status polling, prevent late rarity from returning the user to page one, ignore an obsolete session's late 401 after reauthentication, and recheck session authority through the final experiment reservation/persistence boundary. Every achievement write API requires explicit confirmation. Shared operation completion binds exact result/acknowledgement evidence to its immutable original reviewed intent.

## Verification

Run `npm run check`, `npm test`, `npm run test:memory` and `npm audit --omit=dev`. Tests use local fixtures and synthetic Steam transports. The maximum live synchronization smoke reads 8,192 achievements twelve times under the production heap settings and fails at a 400 MiB sampled RSS threshold, retaining headroom below the requested 500 MB budget. Sampled tests and live metrics are evidence, not an absolute maximum-RAM guarantee.

The GitHub Quality checks workflow repeats these checks without Steam credentials or production database access.

## Growth path

The new read-only synchronization and delta primitives provide a base for progress targets, per-game compatibility evidence and optional user-visible change exports. Future persistent personal-history or push-notification features need explicit retention/delivery choices. Publisher statistics, AVGRATE semantics and automatic achievement writes remain outside the new synchronization feature; they must not be inferred from a polling update.
