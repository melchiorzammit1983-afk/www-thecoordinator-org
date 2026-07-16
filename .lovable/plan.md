# Prefer resolved names everywhere on driver + client surfaces

`displayLocation(raw, display_name)` already handles per-side fallbacks, so partial enrichment (one side named, the other not) works — but several surfaces still print `from_location` / `to_location` directly, so the pin, header, or notification shows a plus-code / raw address when the display name is available.

## What changes

### 1. Driver map pin (destination marker)
`src/components/driver/NavigateFullscreen.tsx`
- Add optional `destinationLabel?: string | null` prop.
- Use it as the pin `title` at line ~290: `title: destinationLabel ?? destination ?? "Destination"`.
- The preview title chip (`To {title}`) already uses the passed `title`; leave as-is.

`src/routes/m.driver.$token.tsx` (2 call sites at ~1935 and the active-trip navigate mode)
- Pass `destinationLabel={displayLocation(destination, matching display_name)}` based on trip phase (pickup → `pickup_display_name`, in_progress → `dropoff_display_name`).

### 2. Driver active-trip header + audio
`src/routes/m.driver.$token.tsx`
- `speakLatest` (line ~765): speak the display name, not the raw `dest`.
- `routeDestination` stays raw (routing needs the address string), but any user-visible echo of it uses `displayLocation`.

### 3. Driver push/toast notifications
`src/routes/m.driver.$token.tsx` lines ~729-747
- Assignment and reassignment toasts, and "new message on trip to X" toast, use `displayLocation(j.from_location, j.pickup_display_name)` / dropoff equivalent instead of the raw column.

### 4. Public client tracking page
`src/routes/t.$token.tsx` lines 204/206, 309/310, 332, 352
- Route through `displayLocation` for the header and the "recent trips" list rows (`s.from_location` / `s.to_location`) — if the row has display names, prefer them; otherwise fall back to raw / "Location pin".
- `RebookPanel` initial values keep the raw address (needed for re-geocoding).

### 5. Client live mini map pin
`src/components/trip/ClientLiveMiniMap.tsx`
- Currently uses only lat/lng in the Google embed — no change needed for the pin itself (Google renders its own label). Accept an optional `label` prop and show it in the header line (`Live · {label ?? paxName ?? "Passenger"}`) so the client sees the hotel/business context even before enrichment finishes.

### 6. Guard: partial enrichment
`src/lib/trip-display.ts`
- `displayLocation` already returns `name` when present regardless of the other side. No logic change; just make sure every caller passes both `raw` and `displayName` (audit above covers the misses).

## Files touched
- `src/components/driver/NavigateFullscreen.tsx` — new `destinationLabel` prop, use for pin title.
- `src/routes/m.driver.$token.tsx` — pass label to nav map; use `displayLocation` in push/toast messages and voice.
- `src/routes/t.$token.tsx` — route header + recent-trips rows through `displayLocation`.
- `src/components/trip/ClientLiveMiniMap.tsx` — optional `label` prop in header line.

## Not changed
- Routing / navigation URLs and Google Directions calls keep the raw address (required for geocoding).
- No DB or server-fn changes; existing `backfillJobEnrichment` continues to populate `pickup_display_name` / `dropoff_display_name` asynchronously, and these UI edits just make sure every surface reads them the moment they land.
- No new points spend or feature-flag paths.
