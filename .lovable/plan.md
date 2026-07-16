## Goal

"Preview route" on a pending trip must show the **full pickup → dropoff route** (hotel → airport) with ETA, distance, and traffic delay — not the driver's current location → pickup. The driver→pickup ETA only appears **after** the driver accepts. Coordinators get the same pickup→dropoff view on trip cards.

## Current behavior (why it's wrong)

`src/routes/m.driver.$token.tsx` (lines 1260–1300) calls `computeDriverRoute` with `origin = driver GPS` and `destination = pickup address`, so the preview panel + `PreviewRoute` map always render the "drive to pickup" leg. The pickup → dropoff leg is never shown pre-acceptance.

## Changes

### 1. Routing server fn — support address→address
`src/lib/routing.functions.ts`
- Extend the input validator: `origin` accepts EITHER `{ latitude, longitude }` OR `{ address: string }`.
- Build the Routes API body with `origin.address` when given, `origin.location.latLng` otherwise. Everything else (traffic-aware, alternatives, field mask, response normalization) stays the same.

### 2. Driver app — pre-acceptance shows trip route
`src/routes/m.driver.$token.tsx`
- Replace the driver→pickup preview query with a **trip route** query: `origin = job.from_location`, `destination = job.to_location` (address-based, no GPS required).
- `previewEnabled` becomes `isPending && !!job.from_location && !!job.to_location` — drop the `driverPos` requirement and remove the "Enable location to preview the route to pickup" hint.
- Header label changes from "To pickup" to "Trip route" and shows `Pickup → Dropoff` names above the ETA line.
- Add a **traffic delay** chip using `duration_sec - static_duration_sec` (same math as coordinator TrafficBadge) so the driver sees "+8 min traffic" when relevant.
- The `PreviewRoute` fullscreen map (`previewOpen`) already renders the polyline from `previewLive`; it will now render the pickup→dropoff polyline unchanged.
- **After acceptance:** add a small secondary "ETA to pickup" chip in the accepted-state panel that uses driver GPS → pickup via the same server fn (this is the old query, just gated on `accepted && driverPos && status < arrived_pickup`). Auto-refresh every 60s like today.

### 3. Coordinator — pickup→dropoff preview on trip cards
`src/routes/_authenticated/coordinator.calendar.tsx` and `coordinator.index.tsx`
- The dashboard/calendar already show pickup→dropoff duration + traffic via `useEnrichVisibleJobs` / `TrafficBadge` and `RouteThumb`. Confirm the "Preview route" affordance on the expanded trip panel (calendar) opens `TripEventsMap` with the pickup→dropoff polyline from the cached job enrichment (`route_polyline`), not the driver breadcrumb.
- If `route_polyline` isn't populated on a card, fall back to calling `computeDriverRoute` with `{ origin: { address: from_location }, destination_address: to_location }` and cache the result in the existing enrichment hook.
- Once the driver has accepted AND a live driver location exists, additionally render the driver→pickup leg on the same map in a secondary color so the coordinator sees both legs.

### 4. Types
Update the inline `LiveRouteInfo` / query result types in `m.driver.$token.tsx` to match the widened validator (no behavior change beyond compilation).

## Out of scope
- No schema changes.
- No changes to acceptance/wait/status workflows.
- No new components — reuses `PreviewRoute`, `TripEventsMap`, `TrafficBadge`, `RouteThumb`.
