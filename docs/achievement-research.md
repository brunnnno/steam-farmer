# Achievement verification and writing without SAM

Research date: 2026-10-13. This document distinguishes observed implementations from behavior tested in this deployment.

## Findings

| Route | What it supports | Limit |
| --- | --- | --- |
| Steam Community XML/HTML | Read actual personal achievement states | Privacy, missing stats, redirects and intermittent availability |
| Official Steam Web API | Read achievements with appropriate credentials; publisher methods can write stats | A personal API key does not grant publisher write permissions |
| Authenticated Steam client protocol | Read stats/schema; existing open-source projects also submit client-writable achievement changes | Undocumented client interfaces, game-specific restrictions and server validation |
| Steamworks SDK wrappers | Read/write through the SDK | Typically depend on a local Steam client; not the chosen Render approach |

A website can control an authenticated protocol client running on its server. The browser itself does not need to run SAM or the desktop Steam client. This is a feasible architecture, not proof that every achievement can be modified.

## Source review

- [Valve: ISteamUserStats Web API](https://partner.steamgames.com/doc/webapi/ISteamUserStats): the official write method requires publisher authentication. This restriction applies to that API, not every Steam protocol path.
- [ASF Achievement Manager](https://github.com/CatPoweredPlugins/ASFAchievementManager): its handler reads `ClientGetUserStats` and submits `ClientStoreUserStats2`. It parses binary KeyValues, maps stat blocks/bits, preserves existing masks, includes the current stats CRC, and skips restricted achievements. It is a working project independent of SAM; its README explicitly documents set/reset commands and server-controlled exclusions.
- [SteamEdge protocol engine](https://github.com/Miabeyefendi/SteamEdge/blob/main/src/core/steamEngine.js): a Node implementation using `steam-user` and its generated protobufs. Its code manually encodes messages because `steam-user` does not register these stats messages. Its write result handling alone is insufficient for our intended verification standard: a fresh read must also confirm the requested state.
- [GameNative](https://github.com/utkarshdalal/GameNative/blob/master/app/src/main/java/app/gamenative/service/SteamService.kt) and [Silksong achievement integration](https://github.com/OmegaUwUr/SilksongAndroid-Achievements): additional JavaSteam-based implementations. The latter refreshes state before submission and checks result, stale-state and failed-validation fields. The upstream JavaSteam handler inspected provides reading; write support in integrations must not be assumed present in every release.

Existing implementations mean that SAM-free protocol achievement management is not a new invention. A dependable web interface can still be a useful direction for this project.

## Implemented here

`lib/steam-protocol.js` adds a read-only adapter for the installed `steam-user` 5.3.0 transport. The panel's **Verify directly** button reads the authenticated account's schema and states using `ClientGetUserStats`. It checks the returned game ID and response type, bounds payload size, times out, clears pending jobs, uses English schema labels, and keeps absent personal values unknown. It never sends a write/reset message. The standard web reader remains available through the normal game view.

The test suite covers block/bit mapping, bit 31, missing values, timestamps that must not override bitmasks, wrong-game responses, rejected results, timeout, disconnect and cache isolation. These tests validate the adapter against protocol-format fixtures; deployment logs provide the separate live read check. Live validation exposed timestamps populated for locked achievements: the adapter now determines state only from personal stat bitmasks and omits implausible dates. Writing has not been tested or enabled on this account.

## Concrete next step for writing

Implement a separate explicit user action for a chosen client-writable achievement. Fetch a fresh account/game snapshot; validate schema identifiers and permissions; merge only the selected changes with the current mask; send the current CRC; reject failed validation or stale state; then re-read from Steam and independently confirm the requested state. Do not update the UI from a local mask or an HTTP success alone. Handle progress-dependent stats and competing writes before adding batches.

Reading a protected achievement does not grant permission to change it. No compatibility guarantee is made for every game or for future Steam protocol changes.

## Selected single-achievement experiment

The user selected Resident Evil Requiem, Model Mania (View all models), AppID 3764200. `lib/achievement-experiment.js` prepares a single-bit mutation using a fresh schema, preserves unrelated stats, uses the current CRC and same authenticated account, validates the response and immediately re-reads Steam. Unknown permissions, progress dependencies, missing state, identity changes, competing sessions and repeated writes are rejected. A separate authenticated CSRF-protected POST and explicit UI confirmation initiate the experiment. No startup code writes anything. General unlock/reset/batch endpoints remain disabled. Evidence is stored before sending; local evidence retention remains subject to Render Free filesystem limits. No live inspection or write has yet been performed.
