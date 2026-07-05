# Pre-Acceptance Route Preview

## Goal

Before the driver accepts a pending trip, show — right on the trip card and expandable to full screen — the route from **their current location → pickup**, with live ETA, distance, blue path polyline, and turn-by-turn steps, just like Google Maps trip preview. Accept / Reject buttons stay visible; nothing writes to the database until they tap Accept.

## What the driver sees

### 1. Inline strip on every pending `JobCard`
Under the pickup line, a compact live chip:

```
🚗  12 min · 8.4 km to pickup     [ Preview route ▸ ]
```

- ETA + distance auto-computed from driver GPS → `job.from_location`.
- Refreshes every 60 s (pending trips aren't time-critical yet).
- If GPS unavailable → shows `Enable location to preview route`.
- If routing fails → hides silently (accept flow unaffected).

### 2. "Preview route" opens a full-screen preview
Reuses `NavigateFullscreen` in a new **preview mode**:

- Blue polyline from driver → pickup, with **step list** rendered on the map.
- Top banner: first maneuver + distance, same visual as live navigation.
- Bottom HUD: ETA + total distance + "Then …" preview.
- **No** step-advance tracker, **no** wake-lock, **no** camera tilt-follow — this is a static preview, not active navigation.
- Two big buttons overlaid at the bottom: **Accept trip** / **Decline** — tapping Accept fires the existing `driverAcceptJob` mutation and closes the preview.
- Exit "X" returns to the dashboard without changes.

## Technical changes

### `src/components/driver/NavigateFullscreen.tsx`
- Add prop `mode?: "navigate" | "preview"` (default `"navigate"`).
- In `"preview"` mode:
  - Skip `watchPosition` step-advance / camera-tilt / heading-follow.
  - Fit map bounds to the full route polyline once loaded.
  - Hide the top blue "next maneuver" banner's live-distance ticker; instead show `steps[0]` maneuver + its step distance.
  - Render an optional `footerSlot` prop so the caller can inject Accept / Decline buttons above the ETA bar.
  - Hide "Recenter" FAB in preview.
  - Skip Fullscreen API request (keeps normal browser chrome — safer for a modal).

### `src/routes/m.driver.$token.tsx`
- New small hook `usePreviewRoute({ origin, pickup, enabled })` — thin wrapper over the same `computeDriverRoute` server function, keyed by `pickup` + coarse origin, `staleTime: 60_000`, `refetchInterval: 60_000`. Returns the same `LiveRouteInfo` shape (`steps`, `eta_sec`, etc.) so `NavigateFullscreen` accepts it unchanged.
- Pass `driverPos` from the existing route-level state down to `JobCard` (add `driverPos` prop).
- In `JobCard`:
  - When `!accepted && driverPos && job.from_location`, mount `usePreviewRoute` and render the inline chip.
  - Add local state `previewOpen`; a "Preview route" button on pending cards opens `NavigateFullscreen` in preview mode.
  - Pass `footerSlot` with Accept / Decline actions bound to the existing `acceptMut` / `rejectMut`.

### No server / DB changes
- No new tables, no new server functions — reuses `computeDriverRoute`.
- No new migrations.

## Out of scope

- Live tracking / step-advance in preview (only in the post-accept Navigate Mode).
- Comparing preview ETA to dispatched ETA / SLA checks.
- Preview from a coordinator's side.

## Files changed

- `src/components/driver/NavigateFullscreen.tsx` — add `mode` + `footerSlot` props, guard tracking behaviors.
- `src/routes/m.driver.$token.tsx` — add `usePreviewRoute`, pass `driverPos` to `JobCard`, render inline chip + preview trigger + full-screen preview modal with Accept/Decline footer.
