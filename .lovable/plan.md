# Switch flight tracking to AI-only, with bundled + metered charging

## Goal
Kill the AeroDataBox/RapidAPI path (source of the `adb_429` errors) and make every flight lookup go through Lovable AI. Charge cleanly:
- **1 bundled fee** at trip creation when a flight code is present → covers the creation lookup **and** the automatic T-30 recheck.
- **Per-refresh fee** (default `0.5 pts`) for every manual refresh after that.
- If the AI can't find the flight, no charge, and the UI advises the user to double-check the code — AI will still try to auto-fix common formatting issues first.

## Code changes

### 1. `src/lib/coordinator.functions.ts` — one provider, one code path
- Delete `fetchLiveStatusViaAeroDataBox`, the `adb:v3:*` cache map, `AERODATABOX_TTL_MS`, and every `process.env.AERODATABOX_API_KEY` read.
- `fetchLiveStatus()` always calls `fetchLiveStatusViaGemini(kind, code, pickupIso, opts)` (already handles airport-hint retries and vessels).
- `fetchLiveStatusViaGemini()` hardening:
  - Normalize every input through `parseFlightCode()` before caching (`ai:v1:${canonical}:${day}` key).
  - Extend cache TTL to 10 min so double-refreshes don't double-charge.
  - Before returning "not found", retry once with `parseFlightCode`'s auto-fix suggestion (e.g. `KM 117` → `KM117`, `RY 1234` → `FR1234`).
  - Return a structured `{ ok: false, reason: 'not_found', hint: 'Please verify the flight code' }` on final failure — no `adb_*` codes leak to UI.
- `getFlightTrackingConfig()` → provider label `"Lovable AI"`; `configured` gated on `LOVABLE_API_KEY`.

### 2. Billing — new charge policy
Introduce three feature keys in `ai_feature_costs` (seeded via migration):
| key | default pts | when it fires |
|---|---|---|
| `flight_lookup_bundle` | `1.5` | Once per trip on create/update, only when a flight code is set AND wasn't previously charged for this `job_id` |
| `flight_lookup_refresh` | `0.5` | Every manual refresh via `FlightRefreshButton` after the bundle is spent |
| `flight_lookup_vessel` | `0.5` | Vessel lookups (kept for parity) |

Existing `flight_status_extra_lookup` / `flight_vessel_tracking` rows → migrated into the two new keys (values preserved if admin already customized them), then hidden as Legacy.

Bundle-tracking column on `jobs`: `flight_lookup_bundled_at timestamptz null` (migration + grants). Charge logic:
- On `createJob` / `updateJob`, when `from_flight` or `to_flight` becomes set and `flight_lookup_bundled_at is null` → `spend_points('flight_lookup_bundle')`, stamp column, then fire the first lookup async (uses bundle, not another charge).
- T-30 cron (`src/routes/api/public/cron/flight-t30.ts`) → runs for every trip with a code and `pickup_at` between now+25min and now+35min. **No charge** — reads the pre-paid bundle.
- `refreshJobLiveStatus` → if cache hit (<10 min): free. Otherwise `spend_points('flight_lookup_refresh')`; only mark spent on `ok:true` results (failures = no charge, per your rule).
- If flight code is changed on an existing trip → re-charge the bundle (new flight = new tracking).

### 3. Admin UI — dedicated Flight lookup card
New section in `src/routes/_authenticated/admin.ai-settings.tsx` above the generic action list:
- **Flight lookup**
  - Bundled lookups per trip (read-only note: "2 lookups included: creation + T-30")
  - Bundled fee (pts) — editable, wired to `flight_lookup_bundle`
  - Manual refresh fee (pts) — editable, wired to `flight_lookup_refresh`
  - Cache TTL (min) — editable, stored in `admin_portal_settings` (new col `flight_cache_ttl_min` default 10)
  - Provider status (read-only) — "Lovable AI · configured" / not configured
  - Enabled + Allow when empty switches
- Corresponding legacy keys move under the collapsible "Legacy / unused" group.

### 4. UI copy / removal of AeroDataBox references
- `FlightTrackingIndicator.tsx` → "Live flight tracking via Lovable AI" / "not configured (missing LOVABLE_API_KEY)".
- `FlightRefreshButton.tsx` toast:
  - Success → status + note.
  - `reason: not_found` → `toast.message("Couldn't find <code>. Please verify the flight number.")`.
  - Other failure → `toast.error("Flight lookup temporarily unavailable, try again in a minute.")`.
- `feature-descriptions.ts` → rewrite `flight_lookup_bundle` / `flight_lookup_refresh` / `auto_shift_early_flight` descriptions to reference AI, not AeroDataBox.
- `docs/…` help articles + `src/content/help/articles/coordinator-ai-extraction.tsx` → replace "AeroDataBox" wording.
- `AERODATABOX_API_KEY` secret becomes unused (leave in secrets store, safe to delete manually later).

### 5. Watchtower & entitlements
- `watchtower.functions.ts` "Flight code not tracked" banner: keep, but link to the new hint.
- `user-prefs.functions.ts` "auto_flight_tracking" description → "Uses AI to look up live flight status."

## Verification (manual, on preview)
1. **Create a trip with `LO673`** → wallet ledger shows one `flight_lookup_bundle` charge, `flight_lookup_bundled_at` stamped, trip card shows live status within ~5s. Refresh twice quickly → no additional charge (cache hit). Refresh after 10 min → one `flight_lookup_refresh` charge.
2. **Create a trip with `AA9999` (fake)** → bundle charge fires, AI returns `not_found`, toast asks user to verify code, `flight_status = unknown`. Fix to `AA100`, save → new bundle charge fires (flight code changed).
3. **Trigger T-30 cron manually** (`/api/public/cron/flight-t30`) with a trip due in 30 min → status refreshes, **no** wallet charge.
4. **Vessel lookup** ("Virtu Ferries 10:00") → routed through Gemini, `flight_lookup_vessel` charge, arrival ETA populated.
5. **Delete `LOVABLE_API_KEY` env in preview** → indicator shows "not configured", refresh button returns friendly error, no charge.
6. **Admin AI Settings** → edit refresh fee to `1.0`, save; next refresh charges `1.0`. Toggle Bundle "Allow when empty" off; user with 0 wallet sees "Not enough points" on trip create with flight code (trip still saves, flight fields stay unknown).
7. Confirm no `adb_*` string appears anywhere in the running app (grep the built bundle for regression).

## Out of scope
- No DB changes to flight status columns themselves (`flight_status`, `flight_scheduled_at`, etc. keep their existing shape).
- No changes to trip creation UX, calendar filters, or how flight status shows on trip cards.
- Not rewriting AeroDataBox secret UX (the secret can stay, it just becomes unused).
