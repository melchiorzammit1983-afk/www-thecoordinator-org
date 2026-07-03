# Client location → chat link + live map in driver card

Today the client's "Send my pin" and "Share live" buttons only write rows into `client_locations`; the driver never actually sees them. Wire both flows into the driver app:

- **Send my pin** posts a chat message in the driver↔client thread with a Google Maps deep-link. Tapping the link opens Google Maps navigation to that spot.
- **Share live** streams updates; the driver's job card shows an embedded Google Map with a marker moving with the client, as long as fresh live points are arriving.

## Server changes

`src/lib/coordinator-public.functions.ts`
- `pushClientLocation` (called by the client portal for both modes) — when `mode === "pin"`, also insert into `trip_messages`:
  - `sender_kind: "client"`, `sender_label: pax_name ?? "Passenger"`
  - `thread_kind: "driver_client"` when an identity exists, else `"group"` (so unnamed passengers still surface it)
  - `body`: `📍 <PaxName> shared their location — https://www.google.com/maps/search/?api=1&query=LAT,LNG` (URL-safe, six-decimal lat/lng)
- New `getClientLiveLocationDriver` server fn (driver token):
  - input: `{ token, job_id }`
  - resolves via existing `loadDriverJob`, then returns the latest row from `client_locations` for that job (and its siblings when part of a group) where `mode = 'live'` and `captured_at >= now() - interval '3 minutes'`
  - shape: `{ latitude, longitude, accuracy_m, captured_at, pax_name } | null`

No schema/migration needed — `trip_messages` already accepts `driver_client`, `client_locations` already exists.

## Driver UI

`src/routes/m.driver.$token.tsx` (inside `JobCard`)
- Add a `useQuery` for `getClientLiveLocationDriver` with `refetchInterval: 8000`, enabled only for jobs whose status is one of `accepted | en_route | arrived | in_progress` (matches other live-share gating).
- When the query returns a row and `Date.now() - captured_at < 90s`, render a new compact component `ClientLiveMiniMap` inside the card, above the action grid:
  - Small header row: green pulsing dot + `"Live location — <PaxName> · <ageLabel>"`
  - ~180px tall rounded map card with a single marker at the client's coords
  - Button: "Open in Google Maps" → `https://www.google.com/maps/search/?api=1&query=LAT,LNG` (target `_blank`)
- Hide the mini-map when the row is missing or stale (`>= 90s`).

`src/components/trip/ClientLiveMiniMap.tsx` (new)
- Reuses the Maps JS loader pattern currently in `DriverLiveMap.tsx`. Extract it into `src/lib/googleMaps.ts` and import from both places so we don't inject two script tags.
- Renders a `google.maps.Map` (no `mapId`, no `AdvancedMarkerElement`) with a single `google.maps.Marker` for the client. On subsequent updates it repositions the marker and recenters the map smoothly (`panTo`) instead of rebuilding.
- Handles `missing_browser_key` and `gmaps_load_failed` by falling back to a plain "Open in Google Maps" button.

## Chat rendering

The existing driver `TripChatDialog` renders `body` as plain text with `whitespace-pre-wrap`. Tapping "https://..." currently does nothing. Small enhancement so the pin message is actually tappable:
- In `src/components/trip/TripChatDialog.tsx`, replace the raw body `<div>` with a helper that splits on URLs (`/(https?:\/\/[^\s]+)/g`) and renders each match as `<a target="_blank" rel="noreferrer" className="underline">`. Non-URL text stays as-is.
- Same treatment on the client's chat panel in `t.$token.tsx` so the client also sees clickable links.

## Out of scope

- No changes to the coordinator's live-driver map, SOS flow, or `client_locations` retention.
- No push notifications when the pin lands — the driver relies on the chat unread badge that already exists.
