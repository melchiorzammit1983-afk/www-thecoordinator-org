## End-to-end test: driver OTG trip lifecycle

Drive the driver app via Playwright against `http://localhost:8080` using the seeded driver token from the network logs (`dd95bff350b8cbb3a57238b33aac431314fede37d5cf3b98`, driver **BaygorCab**, company `57858737-…`). Test runs headless at a 375-wide viewport.

### Preconditions

1. Confirm no in-flight OTG job for this driver (guard in `startOnTheGoTrip` refuses a second concurrent start). If one exists, call `otgDeleteJob` to clear it before the test.
2. Grant geolocation permission on the browser context and set a fixed Malta coordinate (`35.9042, 14.5189`) so the OTG start doesn't hang on GPS.

### Steps + assertions

1. **Open manifest** → `/m/driver/<token>` → screenshot; assert filter chip visible.
2. **Start OTG trip** → header menu → *Create trip (On The Go)* → destination "Malta International Airport" via autocomplete → tap **Start trip**.
   - Assert dialog closes, toast "Trip started", a new job card appears in the "En route" lane.
   - DB check: latest `jobs` row for driver has `status='en_route'`, `created_by_driver=true`, `needs_review=true`, `driver_started_at` set.
3. **Arrived at pickup** → tap the sticky primary action on the new card.
   - Assert `jobs.status='arrived'`, `arrival_at` set, `trip_map_events` row `event='arrived_pickup'`.
   - Assert passenger dialog auto-opens (Phase 6/7 behavior).
4. **Add + board a passenger** (John Doe, +35679000000) → mark boarded → save.
   - Assert `pax` row inserted with `status='boarded'`; `trip_map_events` row `event='pax_boarded'` with lat/lng + name in metadata.
5. **Start route** → tap *Passengers on board / Start route*.
   - Assert `jobs.status='in_progress'`, `trip_map_events` row `event='passenger_on_board'`.
6. **Complete trip** → tap *Complete trip*.
   - Assert `jobs.status='completed'`, `completed_at` set, `trip_map_events` row `event='trip_completed'`.
7. **Post-completion edit** → coordinator side: `deleteJob` on this job returns `pending`/rejection (approval required); `otgDeleteJob` from driver still works.
8. **Cleanup** → delete the test job (`otgDeleteJob`) so the run is idempotent.

### Deliverables

- Playwright script at `/tmp/browser/otg-e2e/test.py` with screenshots after each step under `/tmp/browser/otg-e2e/screenshots/`.
- A short pass/fail report per step, plus the final DB `trip_map_events` sequence for the created job so we can see the full timeline.
- If any step fails, capture the failing screenshot + console errors and stop — no code changes; report back for the fix.

Switch me to build mode to run it.
