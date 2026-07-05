## Navigate Mode for Driver Dashboard

Add a driver-controlled "Navigate Mode" that hides all non-essential UI, letting the map fill the screen and collapsing the job card to a bottom HUD banner with only the three driving-critical data points.

### Scope

Frontend/presentation only in `src/routes/m.driver.$token.tsx` and `src/components/driver/DriverDashboardMap.tsx`. No changes to routing logic, job state, wake lock, or server functions.

### Behavior

- New client state `navigateMode: boolean`, only enabled while `inMotion` is true (i.e. status `en_route` or `in_progress`). If the trip leaves motion, auto-exit Navigate Mode.
- Trigger: the existing large "Navigate" button in `NextInstructionCard` toggles Navigate Mode instead of (or in addition to) opening Google Maps externally. We'll relabel it to "Navigate Mode" while active and add a secondary tiny "Open in Google Maps" link for the external handoff so we don't lose that capability.
- Transition uses Tailwind transitions (`transition-all duration-300 ease-out`) on height/opacity/translate — no new animation libraries.

### Layout changes

1. **Fullscreen map**: `DriverDashboardMap` already uses `position: fixed; inset: 0`. In Navigate Mode we hide the header, trip list, and all floating cards except the HUD banner, so the map visually fills 100vh.
2. **HUD banner** (new component `NavigateHud`): fixed to bottom, `max-height: 20vh`, glassmorphism styling matching existing cards (`bg-white/80 backdrop-blur-xl`). Contents, left → right:
   - Giant maneuver arrow icon (reuses the `iconFor(maneuver)` mapping already in `NextInstructionCard`) at ~56–64px.
   - Big text block: distance to next turn on top (`text-3xl font-bold`), ETA + remaining distance underneath (`text-base text-muted-foreground`).
   - Massive "Expand" button (min-h-16, `w-20`) with a chevron-up icon that exits Navigate Mode and restores the full floating card.
3. **Traffic alert banner** (existing amber "Traffic ahead" strip) stays visible above the HUD banner in Navigate Mode since it is safety-critical.
4. **Header + menu**: already locked while `inMotion`; in Navigate Mode we hide the header entirely (not just disable the menu).

### Files touched

- `src/routes/m.driver.$token.tsx`
  - Add `navigateMode` state + auto-reset effect when `inMotion` flips false.
  - Pass `navigateMode` and `onExitNavigate` down; hide header, active-job header card, and pax/details sections when true.
  - Update `NextInstructionCard`: when `navigateMode` is false render as today; when true render the new compact `NavigateHud`. The primary "Navigate" button toggles the mode.
- `src/components/driver/DriverDashboardMap.tsx`
  - Accept optional `hudMode?: boolean` prop; when true, hide the small badge/overlay chips the map renders (if any) so the map is unobstructed. No changes to routing/polyline logic.

### Non-goals

- No changes to routing calculations, wake lock, chat, or job status flow.
- No new external dependencies.
- External "Open in Google Maps" handoff is preserved as a secondary link, not removed.
