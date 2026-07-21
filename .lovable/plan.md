## Goal
Streamline the driver's On-The-Go (OTG) trip flow so it mirrors a normal trip lifecycle, with automatic location pinning, reverse-geocoded addresses, and a passenger sheet that opens at the right moment.

## Current behaviour (verified)
- `startOnTheGoTrip` already creates the job at `status: en_route` with `driver_started_at` set, and inserts stop 0 at the driver's GPS.
- The start sheet (`DriverOtgSheet.tsx`) currently asks for coordinator + optional destination up front — extra friction.
- Pickup label falls back to `"Driver location (lat, lng)"` — no street name.
- The passenger sheet auto-opens at `arrived`, but the user wants it to open when the driver presses **"Passengers on board / En route"** (i.e. moving from `waiting`/`arrived` → `in_progress`).
- `otgAddStop` records `arrived_pickup` but does not reverse-geocode the address.
- Trip has no "to_location" until driver sets destination; final drop-off should auto-fill the street name on complete.

## Changes

### 1. Simplify start (`DriverOtgSheet.tsx` + `startOnTheGoTrip`)
- Reduce the start dialog to a single big **"Start trip here"** button (keep coordinator picker collapsed under "Change coordinator" for the rare cross-company case).
- On press: capture GPS, call `startOnTheGoTrip`, close sheet immediately (fix the "window stays open" residue).
- Server: reverse-geocode the driver's `{lat,lng}` via `places.functions` and store the street name as `from_location` and stop-0 address (fallback to current label if geocoding fails).

### 2. Pickup arrival (existing normal button)
- Driver presses **"Arrived at pickup"** — already logs `arrived_pickup` to the map. No change needed beyond confirming the OTG job flows through the same handler as normal trips.

### 3. Passenger sheet trigger
- Change auto-open condition in `m.driver.$token.tsx` from `status === 'arrived'` to fire when driver taps **"Passengers on board / En route"** (transition to `in_progress`).
- Sheet shows any passengers the coordinator pre-filled; driver can tap **"On board"** per row or **"Add passenger"** to type a name.
- Each add / board action already logs `pax_added` / `pax_boarded` with GPS via `otgAddPassenger`. Keep.

### 4. Add-stop flow (mid-trip)
- In `otgAddStop`, when `{lat,lng}` present but no `address`, reverse-geocode to a street name before insert.
- Map pin already logged; label will now read street instead of "Stop 2 (35.xxxx, 14.xxxx)".

### 5. Trip completion
- When driver presses **Complete**, if `to_location` is still `"TBD — set by driver"` or empty, reverse-geocode the driver's current GPS and store it as `to_location` + `dropoff_display_name`. Log `dropoff_actual` map event (already exists).
- After completion the trip stays editable by coordinator (already true because `needs_review = true`).

## Files to edit
- `src/lib/driver-otg.functions.ts` — reverse-geocode in `startOnTheGoTrip`, `otgAddStop`; new `otgCompleteFinalize` (or extend existing complete path) to set drop-off address.
- `src/components/driver/DriverOtgSheet.tsx` — collapse to one-tap start; ensure sheet closes on success.
- `src/components/driver/OtgManageDialog.tsx` — no schema change; label refresh when server returns street name.
- `src/routes/m.driver.$token.tsx` — retrigger passenger sheet on `in_progress` transition for OTG trips instead of `arrived`.
- Reuse `src/lib/places.functions.ts` (`resolveAddresses` / details lookup) server-side for reverse geocoding via the Google Maps connector.

## Out of scope
- Payment/pricing calculation changes (already handled by existing auto-price on complete).
- Coordinator-side editing UI (already shipped previous turn).
