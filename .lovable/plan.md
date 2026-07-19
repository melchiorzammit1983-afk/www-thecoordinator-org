**Plan**

1. **Fix the selected flight record**
   - Update the AeroDataBox selection logic so inbound flights (`from_flight`) choose the record whose **arrival side** is closest to the pickup/target day, not the record whose departure side is closest.
   - Keep outbound flights (`to_flight`) anchored to departure time.

2. **Persist Malta arrival time for inbound trips**
   - For `from_flight`, save `flight_scheduled_at` and `flight_estimated_at` from the **arrival** endpoint only.
   - The displayed time will therefore be Malta arrival time, e.g. card #72 should use the arrival time instead of the leaving time.

3. **Make the status note clearer**
   - Keep the route note like `DEP 10:05 → MLA 12:15`, but ensure the main stored/displayed flight time comes from the Malta arrival side.
   - If a flight has no arrival data, fall back safely and mark confidence lower instead of showing a misleading departure time as the main time.

4. **Refresh stale cached/wrong results**
   - Bump the flight lookup cache key version so old departure-anchored results are ignored after the fix.
   - Re-run the live-status update for trip/card #72 so its stored values are corrected immediately.

5. **Verify**
   - Check trip #72 in the database after refresh: `flight_scheduled_at` / `flight_estimated_at` should match the Malta arrival time, not the departure time.
   - Confirm the existing UI components will show the corrected stored time without changing unrelated workflows.

**Technical details**

- Main file: `src/lib/coordinator.functions.ts`
- Root issue confirmed: trip #72 currently stores `KM2403` as `from_flight`, but its saved scheduled/estimated values are `08:05/08:24 UTC` (10:05/10:24 Malta), which matches departure-side timing instead of the requested Malta arrival-side timing.
- The fix will adjust flight-record selection before anchoring, because the code already has an arrival/departure anchor but still chooses the candidate flight using arrival-first fallback instead of side-specific matching.