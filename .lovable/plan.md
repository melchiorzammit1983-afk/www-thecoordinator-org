## Problem

Flight KM641 landed 08:15 Malta time but the app shows a different time. Root cause is timezone handling in `fetchLiveStatusViaGemini` (`src/lib/coordinator.functions.ts`):

- Gemini often returns a naive time like `"2026-07-18T08:15:00"` (no timezone suffix).
- JS `new Date("...")` on our Cloudflare Worker parses that as UTC.
- Malta is UTC+2 in summer, so `formatMaltaTime` then displays `10:15` instead of `08:15`.
- The `time_mismatch` note (line 2181) also uses `.toISOString().slice(11, 16)`, which is UTC hours — wrong for a Malta-facing note.

Display code in `TripDetailsSheet.tsx` and `coordinator.calendar.tsx` already uses `formatMaltaTime`, so the fix is at the ingest and note-formatting layer.

## Changes (scoped to `src/lib/coordinator.functions.ts`)

1. **Tell Gemini to be explicit.** Update the extractor prompt so `scheduled` / `estimated` MUST be full ISO8601 with an explicit offset or `Z`, and default to Europe/Malta local when only a wall-clock time is known (e.g. `2026-07-18T08:15:00+02:00`).

2. **Add `normalizeMaltaIso(raw)` helper.** If Gemini returns a string with no `Z` and no `±HH:MM` offset, treat the wall-clock as Europe/Malta local and convert to a real UTC ISO using the existing `maltaWallTimeToUtcIso` from `src/lib/time.ts`. Return `null` for unparseable input. Apply it to `result.scheduled` and `result.estimated` before caching and before persisting in `applyLiveStatusToJob` / `_computeTripLiveStatus`.

3. **Fix the mismatch note.** Replace the two `new Date(...).toISOString().slice(11, 16)` calls (lines 2181 and 2330) with `formatMaltaTime(...)` so the note reads Malta local time on both sides.

4. **Invalidate old cache entries.** Bump the `cacheKey` prefix (e.g. `v2:`) so users don't keep seeing the previously-mis-parsed values from the 5-minute in-memory cache.

No changes to display components, RLS, points, or unrelated logic.

## Verification

After edits, ask the user to hit Refresh on KM641 and confirm the Scheduled / Estimated chips and the mismatch note all show `08:15` Malta.
