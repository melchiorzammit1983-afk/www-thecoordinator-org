## Why status is blank today

- The Flight section in `TripDetailsSheet.tsx` only prints the flight code and the scheduled/estimated timestamps. `job.flight_status` and `job.flight_status_note` are read for the red "DELAYED / CANCELLED" badge but are **not rendered when the flight is on time or unknown**.
- The poller (`checkFlightStatus`) calls AviationStack and returns a no-op when `AVIATIONSTACK_API_KEY` isn't set, so `flight_status` stays `null` on every job and nothing ever shows.

## What we'll build

Use **Malta International Airport's public arrivals/departures pages** as the live source (no paid API), and always render the current status in the details panel.

### 1. Connect Firecrawl (required)
Firecrawl is the scraper. If it isn't linked yet we link it via the connectors flow; the `FIRECRAWL_API_KEY` becomes available to server functions automatically.

### 2. New server function: `getMaltaFlightStatus`
`src/lib/coordinator.functions.ts` (protected with `requireSupabaseAuth`):

- Input: `{ job_id }`. Reads the job (with chain access check), picks the relevant code — `from_flight` → arrivals page, `to_flight` → departures page.
- Uses Firecrawl SDK `scrape(url, { formats: [{ type: "json", schema, prompt }], onlyMainContent: true })` against:
  - `https://maltairport.com/flights/arrivals/`
  - `https://maltairport.com/flights/departures/`
- Schema asks for an array `{ flight, airline, origin_or_destination, scheduled, estimated, status, gate, terminal }`. Prompt narrows to the row where `flight` equals the requested code (case-insensitive, ignoring spaces).
- Normalises the status string into our existing enum-ish values (`scheduled | active | landed | delayed | cancelled | diverted | time_mismatch`) and reuses the existing 45-min pickup mismatch check.
- Persists back to `jobs`: `flight_status`, `flight_status_note` (human string like `On time — 14:20`, `Delayed → 15:05`, `Landed 13:58`, `Gate B4`), `flight_status_updated_at`, `flight_scheduled_at`, `flight_estimated_at`. In-memory 60 s cache per flight code to avoid burning Firecrawl credits when several jobs share a flight.

### 3. Wire the poller to Malta
`checkFlightStatus` gets a Malta branch: for each job with a flight code, call the same helper the new function uses (batched, dedup by code). AviationStack path stays as a fallback when the key exists, so we don't break existing behaviour. Poll interval and 48 h horizon on the calendar stay as-is.

### 4. Render status in the details sheet
`src/components/coordinator/TripDetailsSheet.tsx`, inside the Flight section (the div the user selected):

- For each flight row, show:
  - `✈ KM 643` (code)
  - **Status pill** derived from `flight_status`: green (`landed`, `active`, `scheduled` when on time), amber (`delayed`, `time_mismatch`), red (`cancelled`, `diverted`), grey (`unknown`).
  - Second line: `flight_status_note` if present, otherwise `Scheduled HH:MM` from `flight_scheduled_at`, and `Estimated HH:MM` in bold when it differs.
  - Small "Updated Xm ago · Malta Airport" caption with a link to the source page.
- Add a "Refresh" icon-button that calls the new `getMaltaFlightStatus` and re-fetches the job. This gives coordinators an on-demand check without waiting for the 3-minute poller.
- Remove the "only show when there's a problem" gate so the panel always shows current status when a flight code is set.

### 5. Card rim behaviour (unchanged)
`TripCard` already turns red for `delayed / cancelled / time_mismatch`; nothing changes there.

## Files touched

- `src/lib/coordinator.functions.ts` — add `getMaltaFlightStatus`, extend `checkFlightStatus` with Malta branch, small in-memory cache.
- `src/components/coordinator/TripDetailsSheet.tsx` — status pill + note + refresh button in the Flight section.
- `src/routes/_authenticated/coordinator.calendar.tsx` — no code change; the existing 3-min `checkFlightStatus` poll will now populate Malta statuses too.

## Not in scope

- Non-Malta flights: this data source only covers MLA arrivals/departures. Flights that aren't listed there return `unknown` with a "Not found on Malta Airport" note; AviationStack (if ever configured) still handles those.
- Historical status charting.
