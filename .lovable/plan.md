## Goal

On every trip card in the coordinator calendar, make it instantly obvious:
1. How long the trip takes from **A → B** (with distance + freshness).
2. What the route actually looks like — a small static route thumbnail.

Today the card only shows a tiny grey `32 min · 12.4 km` chip. There's no visual of the route until you expand the row.

## Changes (frontend only, `src/routes/_authenticated/coordinator.calendar.tsx`)

### 1. Promote the ETA to a proper "trip time" row
Replace the current small muted chip (lines 2454–2461) with a single readable line directly under the A → B route:

```
🕒 32 min   •   12.4 km   •   ETA 14:07
```

- Time uses `tabular-nums`, larger (text-xs → text-sm), foreground color.
- Distance stays muted.
- "ETA 14:07" = `pickup_at + route_duration_sec`, computed client-side, only when both values exist.
- If `traffic_delay_minutes > 0`, append a red `+7 min traffic` inline (replaces the separate TrafficBadge for the collapsed view; expanded row keeps the full TrafficBadge).
- Reserve height (min-h) so the row doesn't jump when ETA arrives async.

### 2. Add a mini route thumbnail on the collapsed card
New small component `RouteThumb` rendered to the right of the text block (hidden on mobile, shown ≥ sm):

- 96×64 rounded image using Google Static Maps via the existing connector gateway (same key path used elsewhere).
- URL built from `pickup_lat/lng` + `dropoff_lat/lng` with a red A pin, green B pin, and a straight-line path styled subtly (Google auto-fits bounds).
- Falls back to nothing (no broken image) when coords are missing.
- Uses `loading="lazy"` and a stable `key` (pickup+dropoff coords) so React doesn't refetch on unrelated re-renders — prevents flashing.
- On hover: subtle ring; on click: opens the existing expanded map panel (does not navigate).

No new server function needed — Static Maps is a GET through the same gateway prefix already used for Routes/Places.

### 3. Live driver marker on the thumbnail (when trip is active)
When `job.status` ∈ {en_route, arrived, in_progress} and we have `livePoint` (already computed in the row), add a third marker (blue dot) at the driver location so the coordinator sees at a glance where the car is on that A→B line — without expanding.

### 4. Readability polish (small, targeted)
- Group the meta line (`clientcompanyname`, driver, flight) into a single row with `•` separators when short, so cards use fewer vertical lines.
- Use `tabular-nums` on all time/eta/distance numbers to stop jitter as ETAs refresh.
- Keep the existing expanded `TripEventsMap` untouched.

## Out of scope
- No changes to server functions, DB, enrichment logic, or the expanded panel.
- No change to the ETA computation source (still `route_duration_sec` + live refresh already wired).

## Technical notes
- Static Maps endpoint: `https://connector-gateway.lovable.dev/google_maps/maps/api/staticmap?...` with `Authorization` + `X-Connection-Api-Key`. Since `<img>` can't send those headers, we add a tiny server function `getStaticRouteMapUrl({ pickup, dropoff, driver? })` that returns a short-lived signed URL — OR simpler: server function that returns the image as base64 data URL, cached per coord pair for 10 min in-memory. Recommended: base64 route (no signed URL infra needed, small payload).
- Thumbnail size kept small (≤ 8KB PNG) to keep the list light even with 50 trips.
