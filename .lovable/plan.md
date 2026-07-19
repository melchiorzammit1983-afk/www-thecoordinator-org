## The bug

Trip #72 (`from_flight = KM2403`, pickup 08:00 Malta) stores `flight_scheduled_at = 08:05 UTC` (10:05 Malta) instead of the real arrival 12:15 Malta.

It is **not** a timezone bug. `formatMaltaTime()` renders the stored UTC correctly. The wrong *side* of the flight is being persisted.

In `fetchLiveStatusViaAeroDataBox` (src/lib/coordinator.functions.ts, ~L2250) the anchor is chosen by "whichever of `arrival.scheduledTime.utc` / `departure.scheduledTime.utc` is closest to `pickup_at`". For KM2403 vs an 08:00 pickup, departure (~10:15 Malta) is closer than arrival (12:15 Malta), so departure wins — and the coordinator sees 10:05.

The correct rule is semantic: `from_flight` = passenger arriving → anchor to **arrival**; `to_flight` = passenger departing → anchor to **departure**.

## Fix

### 1. Thread flight side through the lookup
- Add an optional `side: "arr" | "dep"` param to `fetchLiveStatus` and `fetchLiveStatusViaAeroDataBox` (default undefined, so the vessel/Gemini path is untouched).
- In `applyLiveStatusToJob`, derive `side` from the job:
  - `from_flight` set → `side = "arr"`
  - else `to_flight` set → `side = "dep"`
  - if both are set, **`from_flight` wins** (arrival).
- Pass `side` into `fetchLiveStatus(kind, code, pickup_at, side)`.

### 2. Rewrite the anchor selector
Inside `fetchLiveStatusViaAeroDataBox`:
- If `side === "arr"` and `arrSched` exists → anchor = `arr`.
- If `side === "dep"` and `depSched` exists → anchor = `dep`.
- Otherwise (side missing, or that side has no time) fall back to **existing pickup-distance tiebreaker**.
- `scheduled`/`estimated`/`note` continue to derive from the chosen anchor — the `MLA … → IST …` template stays intact.

### 3. Fix the "time_mismatch" check
In `applyLiveStatusToJob` (~L2522), the 15-min mismatch alert compares `result.scheduled` (now correctly anchored) against `pickup_at`. No code change needed beyond the anchor fix — but confirm the alert copy still reads sensibly (`"Scheduled 12:15 PM vs pickup 08:00 AM"` for #72 is expected and useful, so it stays).

### 4. Refresh cache
Bump the AeroDataBox cache key from `adb:v1:` to `adb:v2:` so old cached (wrong-side) values are ignored immediately after deploy. TTL is only 5 min so this is belt-and-braces.

### No backfill
Per your call — you'll click **Refresh flight** on #72 after deploy. The next T-30 cron sweep and any manual/auto refresh will store the correct side going forward.

## Files touched

- `src/lib/coordinator.functions.ts` — only. All changes are inside `fetchLiveStatus`, `fetchLiveStatusViaAeroDataBox`, and `applyLiveStatusToJob`. No schema, no UI, no other tracker paths (Gemini vessel path is untouched because `side` is optional).

## Verification

1. Read the updated file to confirm the anchor branch and the two call sites.
2. After deploy, press **Refresh flight** on trip #72 and confirm:
   - `flight_scheduled_at` becomes `10:15 UTC` (12:15 Malta)
   - Card shows `MLA 12:15` (or similar arrival label) and status flips off `time_mismatch` if within 15 min of pickup — otherwise the mismatch note now reads against the arrival, which is what you want.
