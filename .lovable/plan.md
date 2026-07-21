
## Goal

Make the coordinator trip map a complete, readable timeline of everything that happened on a trip — including a distinct pin for each passenger the moment they board (with their name, GPS location, and time). Works for grouped multi-stop trips too (e.g. pick up 1 pax in Sliema, then another in Tarxien).

## 1. New event: `pax_boarded`

Currently `markPaxOnboard` (in `src/lib/coordinator-public.functions.ts`) only flips the pax row's `status`/`boarded_at` — it does NOT drop a map pin. `pax_no_show` and `pax_cancelled` already do.

Changes:
- Add `pax_boarded` to the `TripMapEventType` union in `src/lib/trip-map.server.ts`.
- Inside `markPaxOnboard` handler, after the pax update, call `insertTripMapEvent` with:
  - `eventType: "pax_boarded"`
  - `driverId` from the driver link — server-side GPS fallback (`driver_locations` for this job) already handled by the helper
  - `meta: { pax_id, pax_name, method: "qr" | "manual", stop_index? }`
- Add EVENT_META entry: `{ label: "Passenger boarded", color: "#16a34a", icon: "🧍" }`.
- Same treatment for the `boarding_approved` path (already logs to map, but include `pax_id`/`pax_name` in meta) so the info-window shows which passenger it was.

Note: the existing `insertTripMapEvent` dedup key is `(job_id, event_type)` in a 5-second window. For per-pax pins we need each passenger's boarding to survive, so extend the dedup to include `meta->>pax_id` — same 5s window, but scoped per pax. This keeps double-tap protection without swallowing legitimate 2nd/3rd passenger boardings.

## 2. Coordinator can edit a pin

Add a lightweight edit affordance in the info-window on `TripEventsMap`:
- "Edit" link visible only to coordinators (already authenticated context here).
- Opens a small dialog to correct the pax name and/or nudge the pin location (drag marker OR use current pickup coords).
- New server fn `updateTripMapEvent({ event_id, notes?, meta_patch?, lat?, lng? })` in `src/lib/trip-map.functions.ts`, guarded by `requireSupabaseAuth` + membership check on the job's company. Writes back to `trip_map_events` and appends an audit note in `meta.edited_by`.

## 3. Filter chips + clustering

`TripEventsMap.tsx`:
- Replace the flat legend at the bottom with **toggleable category chips**, grouped into 5 buckets:
  - **Movement** — en_route, arrived_pickup, in_progress, completed, actual_dropoff, back_to_waiting
  - **Boarding** — pax_boarded, boarding_requested, boarding_approved, boarding_rejected, pax_no_show, pax_cancelled
  - **Waiting** — wait_started, wait_ended
  - **Driver actions** — navigate_opened, passenger_called, pickup_snap, dropoff_snap, status_corrected, arrived_pickup_override
  - **Safety** — emergency_override, safety_concern, breakdown
- Chip shows count + color dot; tap to hide/show that category. State kept in local `useState` (per-open session).
- Add `@googlemaps/markerclusterer` (already a Google-recommended lib, small footprint) OR implement a simple in-house cluster: group any markers whose pixel distance < 28px at the current zoom, render a single numbered "N" bubble that expands on click. Simple in-house version keeps deps clean — go with that.

## 4. Emoji + sequence number pins

Replace the plain colored `SymbolPath.CIRCLE` marker with a lightweight custom overlay:
- Sort events by `occurred_at` and assign sequence numbers 1..N (per trip).
- Each pin = a 26px round HTML label (Google `OverlayView` or an SVG data URL) with:
  - Background = event color
  - Big emoji from EVENT_META
  - Small superscript number in the corner (chronological order)
- Info-window unchanged (already rich).

## 5. Group / multi-stop trips

When the driver approves a group and boards multiple passengers from different pickup points, `pax_boarded` pins land at the driver's actual GPS at each stop. The map will visibly walk Sliema → Tarxien → drop-off. No extra logic needed once step 1 is done — the GPS fallback in `insertTripMapEvent` already grabs the last `driver_locations` fix per job.

For the info-window on a `pax_boarded` pin, show:
- Pax name
- Stop label (derived server-side by finding the nearest `group_stops.pickup_lat/lng` when the trip has a group_id)
- Timestamp + method (QR or manual)

## 6. Suggestions to make it even better (not building unless you say yes)

1. **"Play trip" scrubber** — a small time slider under the map that walks through the pins in order, redrawing the driver icon at that moment. Great for post-trip reviews.
2. **Auto-open pin on hover in the audit timeline** — clicking a row in `TripAuditTimeline` centers/opens that pin on the map.
3. **Pax roster overlay** — a stacked list of pax with their boarding pin numbers so coordinators can see "3/4 boarded" at a glance.
4. **Heat trail** — color the breadcrumb polyline by speed (slow = red) so wait/traffic zones jump out.
5. **Export to KML/GeoJSON** — one-click download of the full trip trace + pins for insurance / dispute cases.

## Technical section

### Files touched
- `src/lib/trip-map.server.ts` — add `pax_boarded` to union; refine dedup key to include `meta->>pax_id`.
- `src/lib/coordinator-public.functions.ts` — insert `pax_boarded` pin inside `markPaxOnboard`; enrich boarding approve/reject meta with `pax_id`+`pax_name`.
- `src/lib/trip-map.functions.ts` — new `updateTripMapEvent` server fn (auth-gated).
- `src/components/coordinator/TripEventsMap.tsx` — rewrite legend as filter chips, add clustering, replace pin rendering with emoji+number overlays, add edit dialog trigger.

### No migration required
`trip_map_events` already supports arbitrary `event_type` text and JSON `meta`. No schema change needed for pax pins. Coordinator edit uses existing columns.
