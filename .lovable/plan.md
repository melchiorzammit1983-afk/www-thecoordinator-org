## Goal
Live driver tracking on the coordinator dispatch dashboard using Google Maps.

## Constraint (must read)
The driver portal is a **web app**. Browsers stop JS when the tab is minimized or the phone is locked — no web API bypasses this. So tracking is reliable only while the driver keeps the portal open in the foreground. Mitigations shipping:
- Screen Wake Lock (`navigator.wakeLock`) keeps the display on.
- Clear "keep this tab open" banner.
- Points older than 60s show as "Paused"; > 2 min as "Offline".

True background tracking (screen off / app minimized) needs a Capacitor native wrapper — same backend will support it later with no changes.

## What ships

### 1) Driver side — capture (`/m/driver/$token`)
- New **"Share live location"** toggle at the top of the manifest.
  - Persists in `localStorage`, auto-resumes on reopen.
  - Only active when the driver has a trip in `en_route` / `arrived` / `in_progress`.
- Uses `navigator.geolocation.watchPosition({ enableHighAccuracy: true })`.
- Requests `navigator.wakeLock.request('screen')` while ON, releases when OFF.
- Batches points and POSTs to a new public server fn every ~10s or on >25m movement.
- Queues in `localStorage` when offline; flushes on reconnect.
- Live status pill: Live / Paused / Offline.

### 2) Server — ingest & broadcast
- **New public server fn** `pushDriverLocation({ token, points[] })` in `src/lib/coordinator-public.functions.ts`. Validates the driver magic link, resolves the driver's currently-active job, inserts into `public.driver_locations`.
- **DB**: `driver_locations` already exists, is already in `supabase_realtime`, and already has the chain-based coordinator SELECT policy — **no migration needed**.
- The public write path is protected by the magic-link token (same pattern as the rest of the driver portal).

### 3) Coordinator side — Google Maps view
Uses the existing Google Maps connector browser key (`VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`). Maps JS loaded with `loading=async` + `callback` + `channel`. Uses `google.maps.Marker` (no `mapId` / no AdvancedMarkerElement).

- **New component** `src/components/coordinator/DriverLiveMap.tsx`
  - Loads Google Maps JS once.
  - Props: `points: { driverId, name, lat, lng, capturedAt, jobId }[]`, `focusDriverId?`.
  - One marker per driver, colored by freshness (green <30s, amber <2min, grey older). Info window: driver name, trip route, "updated Xs ago".
  - Auto-fits bounds; when `focusDriverId` set, pans + zooms to that driver.

- **Dispatch board** (`/coordinator/calendar`)
  - Collapsible **"Live map"** panel above the calendar (open on desktop, collapsed on mobile).
  - Initial fetch of latest point per driver in the current company chain, then subscribes to `driver_locations` Realtime for incremental updates.
  - Legend + live count.

- **Trip details sheet** (`TripDetailsSheet.tsx`)
  - New "Live location" section reusing `DriverLiveMap` filtered to that trip's driver, with `focusDriverId` set.
  - Last-updated timestamp; Paused/Offline pill when stale.

### 4) Freshness semantics
- < 30s → green "Live"
- 30–120s → amber "Paused — app may be minimized"
- > 2 min → grey "Offline"

## Out of scope
- Historical route replay / breadcrumb polyline.
- Geofenced auto status changes.
- Native background tracking (Capacitor).
- ETA via Routes API.

## Technical bits
- Uses existing Google Maps connector browser key — no new secrets, no billing setup.
- No new npm dependency (raw Maps JS via `<script>` tag, dynamic loader with singleton promise).
- Reuses existing `driver_locations` table + realtime + policy.