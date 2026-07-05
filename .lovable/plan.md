## Problem

Tapping **Navigate Mode** today:

1. Replaces the trip card with a slim bottom HUD only — **no actual map/navigation is drawn**, so the driver sees nothing to navigate by.
2. Unmounts `DriverLiveShare` (it lives inside the card), which **stops the geolocation watcher, clears the wake lock, and halts pings to the coordinator**.
3. Computes ETA client-side only — the coordinator never sees it. `driver_locations` gets pings (when tracking runs) but no ETA/next-instruction is stored on the trip.

## Goal

Navigate Mode becomes an **in-app, full-screen turn-by-turn view** (Google-Maps-like, same window), while live location and ETA continue streaming to the coordinator without interruption.

## Changes

### 1. Keep tracking alive across Navigate Mode
- Lift `<DriverLiveShare>` out of the conditional branch in `m.driver.$token.tsx` so it mounts on the driver page regardless of `navigateMode`. Render it visually only when the card is expanded; keep the component mounted (hidden) in Navigate Mode so `watchPosition`, wake lock, and flush loop keep running.
- Result: entering Navigate Mode no longer tears down tracking.

### 2. Full-screen embedded navigation view
Replace the current bottom-only `NavigateHud` with a new `NavigateFullscreen` component:

- Full-viewport Google Map (`google.maps.Map`, reusing `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` and the existing `initMap` loader pattern from `DriverDashboardMap.tsx`).
- Draws the active route polyline from `useLiveRoute().polyline` (decoded via `google.maps.geometry.encoding.decodePath`).
- Driver marker (car icon) that follows `watchPosition` updates, auto-recenters and rotates to heading (follow-mode on by default, with a "recenter" FAB when the user pans away).
- Destination marker at the current smart target (pickup if not yet picked-up, else dropoff).
- Bottom HUD (existing content) overlaid: maneuver arrow, next-turn distance, ETA, and the current step instruction.
- Top-left "Exit" button (returns to card) — clearly distinct from the current minimize icon.
- Optional "Open in Google Maps" fallback link kept in the exit menu.
- Uses Fullscreen API on entry (already partially done) and locks portrait via CSS only.

### 3. Push ETA + next instruction to coordinator
- Extend `pushDriverLocation` server fn (in `coordinator-public.functions.ts`) to accept optional `eta_sec`, `distance_m`, `next_instruction`, `destination_label` on each ping, and store them on the newest `driver_locations` row (add nullable columns via migration: `eta_sec int`, `distance_m int`, `next_instruction text`, `destination_label text`).
- On the driver client, whenever `useLiveRoute` returns fresh data, attach the latest ETA/distance/instruction to the next queued point so the coordinator's live view (`TripDetailsSheet`, coordinator calendar map) can display "ETA 12 min · Turn left onto X" alongside the moving pin.
- Coordinator UI (`TripDetailsSheet` live section): show ETA badge + last instruction under the driver pin. No new pages.

### 4. Card no longer "minimises silently"
- The Navigate Mode entry is now an explicit fullscreen route view; exiting returns to the same expanded card scroll position. No collapse animation on the underlying manifest.

## Technical notes

- New migration: `alter table public.driver_locations add column eta_sec int, add column distance_m int, add column next_instruction text, add column destination_label text;` (nullable, no GRANT changes needed — existing policies cover it).
- No new secrets; Google Maps browser + gateway keys already present.
- Files touched:
  - `src/routes/m.driver.$token.tsx` — lift `DriverLiveShare`, swap HUD for `NavigateFullscreen`, pass live ETA into the tracker.
  - `src/components/driver/NavigateFullscreen.tsx` — new component (map + polyline + follow-me + HUD overlay).
  - `src/components/driver/DriverLiveShare.tsx` — accept `liveEta` prop, include in each ping payload.
  - `src/lib/coordinator-public.functions.ts` — extend `pushDriverLocation` input + insert.
  - `src/components/coordinator/TripDetailsSheet.tsx` — render ETA + next-turn under driver marker.
  - New Supabase migration for the 4 columns.
- Zero business-logic changes to job status, dispatch, or acceptance flows.

## Out of scope

- Native voice guidance (browser TTS already exists via `onSpeak`).
- Lane guidance / speed-limit overlays (Google restricts these).
- Offline navigation.
