## Live Driver Tracking on Google Maps

Track driver GPS during active trips only, show them to the coordinator on both a compact panel in the Dispatch Calendar and a full-screen `/coordinator/map` page.

### 1. Database (single migration)

New table `public.driver_locations`:
- `driver_id` (fk drivers), `job_id` (fk jobs, nullable — set to the active job), `company_id` (fk companies — owner or executor company at capture time)
- `latitude` numeric, `longitude` numeric, `accuracy_m` numeric, `heading` numeric, `speed_mps` numeric
- `captured_at` timestamptz
- Indexes on `(job_id)`, `(driver_id, captured_at desc)`
- GRANT to authenticated + service_role
- RLS: SELECT allowed if the requesting company is anywhere in the job's dispatch chain (`company_id`, `executor_company_id`, `origin_company_id`, `dispatch_chain_company_ids`); INSERT allowed only through the server function (service-role path).
- Add table to `supabase_realtime` publication.

### 2. Backend server functions

`src/lib/coordinator-public.functions.ts` (driver-side, magic-link auth):
- `pushDriverLocation({ token, job_id, lat, lng, accuracy, heading, speed })` — validates the driver's magic link, confirms the job is active (`accepted` + status in `en_route|arrived|in_progress`), inserts a row.

`src/lib/coordinator.functions.ts` (coordinator-side, auth):
- `listActiveDriverLocations()` — returns latest location per active driver for every job the coordinator's company sits on (owner / executor / origin / chain member).
- `listJobLocationTrail({ job_id, since? })` — recent breadcrumb for one trip (for the map details panel).

### 3. Driver portal — capture GPS

In `src/routes/m.driver.$token.tsx`:
- When any job on the manifest is in `en_route | arrived | in_progress`, start a `navigator.geolocation.watchPosition` loop.
- Throttle to at most one push every ~15s and only when position changed >20m.
- Stop the watcher when no job is active or the tab is hidden > 5 min.
- Small on-screen indicator: "Location sharing on" with a manual pause toggle (safety net).
- No new points cost — this is part of an active trip.

### 4. Coordinator UI

New component `src/components/coordinator/DriverMap.tsx` — loads Google Maps JS via the browser key with `loading=async` + `callback`, uses `google.maps.Marker` (no `mapId`, no AdvancedMarkerElement), one marker per active driver colored by trip status, click marker → opens the existing `TripDetailsSheet`.

Realtime: subscribe to `postgres_changes` on `driver_locations` filtered by the coordinator's company and update markers in place (see cloud-realtime pattern — subscribe inside `useEffect`, tear channel down on unmount).

Placement:
- Collapsible **"Live map"** panel at the top of `/coordinator/calendar` (default collapsed on mobile).
- New sidebar link **"Live map"** → `/coordinator/map.tsx` — full-screen map + a side list of currently-tracked drivers with filters (driver, label, status).

### 5. Connector setup

Uses the Google Maps Platform connector (managed key works on `*.lovable.app`; the browser key `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` is loaded via `<script>`). No server-side geocoding needed for v1. If not already linked in this workspace, I'll trigger the connect flow before writing the map component.

### Out of scope for this pass

- Historical playback UI (data is stored; UI can come later).
- Geofencing / ETA calculations.
- Background tracking when the driver's browser tab is fully closed (mobile browsers don't allow this without a native app).
