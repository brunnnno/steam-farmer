# Achievement loading

The browser keeps at most eight previous lists, five minutes old or newer, with a combined serialized UTF-16 budget of 1 MiB. This is memory-only and is cleared when the panel locks and before achievement writes. Entries are scoped to account, known Steam identity, game and reading mode. Reopening displays a previous reading immediately while requesting an updated response. The cached mode blocks individual, progress and shared activation, including direct function calls. Failed verification retains the previous list with an explicit warning.

Persistent history now starts alongside the Steam read. Its UI wait budget is 2.5 seconds; failure or timeout blocks activation while allowing the real Steam list to display. The underlying bounded database query can finish afterward; its result cannot change the response or enable writes. Community source timeouts are reduced from 12 to 6 seconds. Automatic mode still tries direct verification for 2.5 seconds first. Logs and responses include total server readDurationMs.

No instant first-ever read is guaranteed: Steam, network latency and a sleeping free Render instance can delay it. Previously seen lists avoid an empty screen during those delays. No automatic library-wide prefetch is added.

# Next supported type

Reviewed upstream SAM commit de8b71048a0cee3c3e97cd8535e0f55ca86513e4. Its README requires a running local Steam client; SAM.API/Wrappers/SteamUserStats013.cs has separate integer and float getters/setters. SAM.Game/Stats/FloatStatInfo.cs parses float values and rejects modifications when permission bit 2 is set. These native calls cannot be used directly by the remote web protocol.

Next work: read-only FLOAT decoding with IEEE-754 round-trip and finite-value tests, schema bounds and permission inspection, then select an owned-game example for a reviewed preview and a separately authorized live write. AVGRATE and complex expressions need their own semantics. Shared multi-unlock remains a separate extension. No new achievement or statistic was activated in this performance change.
