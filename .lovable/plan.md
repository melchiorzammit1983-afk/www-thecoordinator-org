# Live status (ETA + flight) — fix and expand

## What's broken today

The "Refresh" in the trip dialog shows `Traffic unavailable (dm_failed)` because the Distance Matrix call in `previewTripStatus` hits `maps.googleapis.com` directly with a `GOOGLE_MAPS_API_KEY` env var. In this workspace the Google Maps key lives inside the Lovable connector (same one Places uses), not as a plain env var — the direct call has no key and fails.

The result is also **preview-only** — it never writes to the trip row, so the calendar card and client view can't show it even when it works.

## Fix and expand

### 1. Route Distance Matrix through the Lovable Google Maps gateway
In `src/lib/coordinator.functions.ts` change the `previewTripStatus` traffic branch to use the same gateway pattern as `src/lib/places.functions.ts`:
- URL: `https://connector-gateway.lovable.dev/google_maps/maps/api/distancematrix/json?...` (no `key=` param).
- Headers: `Authorization: Bearer ${LOVABLE_API_KEY}`, `X-Connection-Api-Key: ${GOOGLE_MAPS_API_KEY}`.
- On non-2xx or non-OK element, log the upstream body and surface a specific reason (`zero_results`, `over_query_limit`, etc.) instead of the generic `dm_failed`.

### 2. Persist the refresh result on the trip
Add `refreshJobLiveStatus({ job_id })` server function (auth-gated, coordinator only). It:
- Loads the job row.
- Runs the same traffic + flight logic used by `previewTripStatus`.
- Writes `traffic_delay_minutes`, `traffic_severity`, `leave_by_at`, `flight_status`, `flight_status_note`, `flight_status_updated_at`, `flight_scheduled_at`, `flight_estimated_at` back to `jobs`.
- Returns the fresh values.

Wire the button:
- `TripDetailsSheet` header — add a small "Refresh live status" action that calls `refreshJobLiveStatus` and invalidates the calendar query. The existing `TrafficBadge` and flight fields already render from the persisted columns, so the calendar card updates automatically.
- The in-form "Refresh" in `JobFormDialog` stays preview-only for unsaved trips; once the job exists it swaps to `refreshJobLiveStatus`.

### 3. Show ETA + flight on the client trip view
`src/routes/c.$token.tsx` currently has no live-status panel. Add a compact block (matches the dialog preview layout) that:
- Reads `traffic_delay_minutes / severity / leave_by_at` and `flight_status / flight_status_note` from the trip payload (extend the `getClientTripByToken` selector to include those columns).
- Shows a token-scoped "Refresh" button that calls a new `refreshClientTripLiveStatus({ token })` public server function — same logic as the coordinator refresh, but authorised by the token, and rate-limited to 1 call per 60s per token.

### 4. Flight-status quality — pick one (or more)

The current flight source is a Firecrawl scrape of the Malta airport board (`fetchMaltaBoard`). It only knows flights that touch MLA and depends on scraping the site working.

Options, in order of effort/cost:

- **A. Auto-refresh saved trips** (low): a lightweight cron/edge function that calls `refreshJobLiveStatus` for jobs where pickup is within the next 6 hours, every 5–10 min. No new provider. Fixes staleness on the card without user clicks.
- **B. AeroDataBox / AviationStack via connector** (medium): a real flight API keyed by IATA code, works worldwide (not only MLA), returns structured `scheduled/estimated/actual/gate/terminal/status`. Would replace the Firecrawl scrape for lookups and drop the "not on Malta board" edge case for international flights.
- **C. Push notifications on status change** (medium, needs B or A): when `flight_status` transitions to `delayed / cancelled / diverted / landed`, send an in-app + WhatsApp/email nudge to the coordinator and the client (respecting existing notification prefs).

Recommendation: A + B together — B gives correct data, A keeps it fresh so the card is trustworthy without opening the sheet.

## Technical notes
- Env keys read inside the handler (per server-function rules), not at module scope.
- Gateway URL is `https://connector-gateway.lovable.dev/google_maps` + provider path; the connector auto-attaches the Google API key from `X-Connection-Api-Key`.
- Public `refreshClientTripLiveStatus` sits under `src/lib/coordinator-public.functions.ts` and validates the token like the other public functions there; no auth middleware.
- All new DB writes are covered by existing RLS on `jobs` (coordinator function) and by token validation (client function using `supabaseAdmin`).

## Question
Which flight-quality upgrades should I include in the same build — **A only**, **A + B**, or **A + B + C**?
