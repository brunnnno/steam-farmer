# Decimal progress inspection

FLOAT (schema type 2 or FLOAT) is decoded from the returned uint32 IEEE-754 bit pattern. INT decoding and INT writers remain unchanged. Nonfinite values, duplicate/missing personal values, unknown permissions, ambiguous IDs, malformed constraints and complex expressions cannot produce a decimal preview.

Direct reads display decoded progress. A locked achievement with one exclusive client-writable decimal counter can offer **Review decimal progress**. The authenticated, main-account-only GET /api/achievement/float-progress-preview reads a fresh snapshot, verifies the Steam session did not change, and returns canActivate:false with current value, goal, minimum, maximum, maximum change and the proposed representable value. It has the same heavy-resource admission limit and a ten-per-minute rate limit as other previews. No journal reservation or write is made.

If rounding the goal to float32 gives a value below the goal, preview selects the next representable positive float, then checks all bounds and maximum-change constraints. Completed counters are not decreased. These rules are provisional protocol interpretation, not proof that Steam accepts a write. The existing writer rejects FLOAT even when allowProgress is requested. There is no float activation mode or confirmation control.

Shared FLOAT, aggregated counters and AVGRATE are excluded. AVGRATE is a rate over a time window and must not be treated as a simple decimal counter. FLOAT permission checks follow the existing strict client-writable rules.

References reviewed: Steamworks Stats and Achievements (https://partner.steamgames.com/doc/features/achievements?l=english), SAM UserStatType.cs and FloatStatInfo.cs at commit de8b71048a0cee3c3e97cd8535e0f55ca86513e4. No upstream implementation was copied. SAM uses native APIs with a running local Steam client; these previews inspect remote protocol data.

Next validation: identify an owned-game FLOAT example through an existing direct read, inspect its schema and counter, then implement a typed writer with exact raw-value verification and persistent evidence. A live activation requires explicit approval of the selected achievement and counter change. No live FLOAT unlock has been verified yet.
