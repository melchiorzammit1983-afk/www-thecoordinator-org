# Flight tracking robustness (LO673 case)

## What's actually broken

Confirmed against the live row:

- Job `fa148a84`, pickup 2026-07-18 09:00 Malta.
- `from_flight = "LO673"` (valid — IATA `LO` = LOT Polish Airlines flight 673).
- `flight_status = "unknown"`, note `"Status unavailable"`, `flight_scheduled_at = null`, `flight_estimated_at = null`, `flight_status_confidence = null`.
- `to_flight = "ASSO VENTICINCUE"` — a vessel name entered in a flight field.

So two things are going wrong at once:

1. The Gemini grounding call in `fetchLiveStatusViaGemini` is returning "no grounding / no result" for `LO673`, and the job is quietly parked in `flight_status=unknown`. Nothing on the card tells the coordinator that the flight was never actually tracked.
2. There is no basic sanity check on the code itself, so nonsense like `ASSO VENTICINCUE` in `to_flight` also silently sits.

The user wants the AI to (a) recognise the mistake, (b) prompt them to fix it, and (c) show the flight time on the card.

## Fix plan

### 1. Add a small flight/vessel code validator (new `src/lib/flight-code.ts`)

Pure client+server utility, no network:

- `parseFlightCode(input) → { ok, airline?, number?, iataAirline?, hint? }`.
  - Regex: `^\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*0*([0-9]{1,4})[A-Z]?\s*$` (IATA carrier + 1–4 digits, optional space, optional operational suffix).
  - Small built-in IATA→name map for the ~120 carriers we already see in bookings (LO=LOT Polish, LH=Lufthansa, KM=Air Malta, FR=Ryanair, U2=easyJet, W6=Wizz Air, etc.). Rest returns `airline=undefined` but still `ok=true`.
- `looksLikeVessel(input) → boolean` — space-containing all-alpha strings, or IMO/MMSI patterns; used to catch data like `ASSO VENTICINCUE` sitting in a flight field.
- `suggestCorrections(input)` — trivial fixes only (uppercase, strip spaces, remove leading zeros, `O`↔`0` in the numeric part) so the fix dialog can offer one-tap alternatives.

### 2. Server: make `fetchLiveStatusViaGemini` self-healing

Edit `src/lib/coordinator.functions.ts` (`fetchLiveStatusViaGemini` and `applyLiveStatusToJob`):

- Before calling Gemini, run `parseFlightCode`. If it fails, short-circuit with `{ ok:false, reason:"invalid_code" }` — no points spent.
- If `parseFlightCode.ok` and we know the airline name, expand the grounded prompt from `flight "LO673"` to `flight "LO673" (LOT Polish Airlines flight 673)`. This is the single biggest reliability win for two-letter codes that Gemini otherwise doesn't disambiguate.
- If the first grounded call returns no grounding chunks, retry once with an explicit airport hint derived from the trip (`from_location` / `to_location` — Malta MLA is almost always one endpoint here) instead of only bumping confidence to "low".
- Persist `flight_scheduled_at` and `flight_estimated_at` **whenever Gemini returns anything parseable**, even at `low` confidence, so the card can always show a time.
- Extend the persisted `flight_status_note` for the failure path so it names the reason ("Couldn't find LO673 for 2026-07-18 — check code") instead of generic `"Status unavailable"`.

Add a companion server fn `retryFlightTracking({ job_id })` that re-runs `applyLiveStatusToJob` on demand from the fix dialog (uses existing points/refund path, no schema change).

### 3. Card UI: always show the flight time, and flag when tracking failed

Edit the trip card in `src/routes/_authenticated/coordinator.calendar.tsx` (the `flightMsg` block around lines 2260–2360) and mirror in `src/components/coordinator/TripDetailsSheet.tsx`:

- New chip whenever a code is present:
  - Green `Flight 09:15 · LO673` when `flight_status ∈ {on_time, boarding, departed, landed}` and a scheduled/estimated time exists.
  - Amber `DELAYED → 09:45 (was 09:15) · LO673` for `delayed`/`early`/`time_mismatch` (existing text kept, just always paired with the code).
  - Red-outline "Not tracked · check code" chip when `flight_status="unknown"` OR (`confidence="low"` AND no `flight_scheduled_at`). Clicking opens the new fix dialog.
- Chip is clickable everywhere → opens the fix dialog.

### 4. New "Fix flight code" dialog (`src/components/coordinator/FlightCodeFixDialog.tsx`)

Small focused dialog opened from the untracked chip and from the AI Watchtower alert modal:

- Shows current `from_flight`/`to_flight`, why we couldn't track ("No grounded result", "Invalid format", "Vessel name in flight field", etc.).
- Renders `suggestCorrections()` output as one-tap buttons.
- Free-text field to enter a corrected code; runs `parseFlightCode` inline and shows the resolved airline name in real time.
- "Retry tracking" button → calls the new `retryFlightTracking` server fn, updates the card, closes on success.
- "This is a vessel, not a flight" quick action → moves the value into the correct field and flips `tracking_kind` to `vessel`.
- All writes go through the existing `updateJob` path; no new grants/policies.

### 5. Watchtower: add a `flight_untracked` finding

Edit `src/lib/watchtower.functions.ts` `detectFindings` (`wantFlight` block, lines 159–170):

- New finding kind for jobs where a flight code is present, pickup is within the next 6 hours, and `flight_status ∈ {unknown, null}` or `flight_scheduled_at IS NULL` after at least one refresh attempt (`flight_status_updated_at` non-null).
- Severity 4 (Serious) so it surfaces in the existing `CriticalAlertModal` (built last turn) with "Review job" navigating to the trip card, where the fix dialog is one click away.
- Dedupe key: `flight-untracked:${job.id}:${flight_status_updated_at}`.

### 6. Assistant awareness (light touch)

Edit `src/lib/coordinator-assist.functions.ts` system prompt so when the assistant is drafting or editing a trip:

- It calls `parseFlightCode` on the extracted `from_flight`/`to_flight`.
- If the code fails validation OR looks like a vessel, it emits a `data_fix` response kind (existing card) with the suggested correction, instead of committing the trip with a bad code.
- No new response kind, no new UI plumbing — reuses the diff card the coordinator already knows.

## Technical notes (for reference)

- `flight_status_confidence` column already exists; no migration needed.
- No new tables, no new grants — everything reuses existing `jobs` writes, `watchtower_alerts`, and the existing points feature `flight_vessel_tracking`.
- The 5-minute `liveStatusCache` in `coordinator.functions.ts` must be keyed by the *retry variant* too (append `":retry"` when the airport-hint retry runs) so a real retry can't be short-circuited by a stale "no result".
- All UI changes are additive; nothing in the existing dispatch/driver flows is touched.

## Out of scope

- Real flight-provider integration (FlightAware/OAG). This plan keeps Gemini grounding as the source but makes it recover instead of silently failing.
- Bulk backfill of historical `flight_status=unknown` rows — the Watchtower alert + one-click retry will drain them naturally.
