# Google-Maps-Style Turn-by-Turn in Navigate Mode

## Problem

Navigate Mode currently draws the full route polyline and shows the *first* step of the route as the "next maneuver". As the driver moves, the arrow, instruction, and distance-to-next-turn never advance — because the server only returns the first step and the client never tracks progress along the step list. It looks like a static route line, not turn-by-turn navigation.

Also: route only refetches every 30s and origin is coarsened to ~110 m, so the map does not feel "live". No camera tilt/heading follow, no travelled-portion trimming.

## What "Turn-by-Turn like Google Maps" means here

1. Full step list (not just the first) is returned by the server.
2. Client tracks driver position against the step polylines: as the driver passes each step's end point, the "current step" advances.
3. HUD shows: current step's maneuver arrow, live distance from driver → end of current step, current instruction, and a small "then …" preview of the following step.
4. Route polyline is split into a grey "already travelled" portion and a bright blue "ahead" portion.
5. Camera follows driver, tilted 45°, rotated to heading (so the road points up), zoomed close (18–19).
6. Faster refresh cadence for the driver marker (already ~1 s from `watchPosition`), and only refetch the full Routes API when the driver deviates from the corridor or every 60 s as a safety refresh.

## Technical Changes

### 1. `src/lib/routing.functions.ts`
- Extend `normalize()` to return the **full step list** (`steps: Array<{ maneuver, instruction, distance_m, polyline, end: {lat,lng} }>`) in addition to the aggregate fields.
- Add `routes.legs.steps.navigationInstruction.maneuver` and existing fields (already in mask).

### 2. `src/routes/m.driver.$token.tsx` — `useLiveRoute`
- Widen the result type to include `steps` for the active route.
- Pass `steps` through in the returned `LiveRouteInfo`.
- Keep 30 s polling, but bump origin key resolution to `toFixed(4)` (~11 m) so it refetches when driver actually moves between polls.

### 3. `src/components/driver/NavigateFullscreen.tsx` (main work)
- Accept `steps` on `live` prop.
- **Step tracker**: on every geolocation update, compute distance from driver to each step's end point. Advance `currentStepIdx` when driver is within ~25 m of the step's end (or has clearly passed it — dot product against step direction). Never regress.
- **HUD**: drive `next_maneuver`, `next_instruction`, and distance-to-next-turn from `steps[currentStepIdx]` instead of the server's cached "first step". Add a small "Then <arrow>" line showing `steps[currentStepIdx+1]`.
- **Split polyline**: render two polylines — travelled (grey, thin) from route start to driver's projected point on the path, and ahead (blue, thick) from that point to destination. Use `geometry.spherical.computeDistanceBetween` + a simple nearest-point projection per segment.
- **Camera**: when in follow mode, `map.setHeading(gpsHeading)`, `map.setTilt(45)`, `map.setZoom(18)`. Fall back to `tilt: 0` if the map type doesn't support tilt (vector maps only — degrade gracefully in a try/catch).
- **Off-route detection**: if driver is > 40 m from the nearest polyline segment for 5 s, invalidate the route query so `useLiveRoute` refetches from the new origin.

### 4. `DriverLiveShare.tsx`
- No shape change. The `liveEta` prop already carries eta / instruction / distance; those now come from the *current* step, so the coordinator's live chip advances turn-by-turn automatically.

## Out of Scope

- Native voice guidance (TTS of each maneuver) — the existing speak button covers manual playback.
- Lane guidance, speed-limit overlays, junction 3D views (require paid Google Nav SDK).
- Rendering vector 3D buildings.

## Files Changed
- `src/lib/routing.functions.ts`
- `src/routes/m.driver.$token.tsx`
- `src/components/driver/NavigateFullscreen.tsx`
