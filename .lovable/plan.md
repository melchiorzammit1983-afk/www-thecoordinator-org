# Trips section redesign — Pro-dispatcher density view (ETA-safe)

Rework the `DispatchTripList` in `src/routes/_authenticated/coordinator.calendar.tsx` (lines 3213–3339) into a dense dispatcher table with a rich expanded panel. Only the presentation of that one component changes. All data fetching, filters (active + waiting), enrichment (`useEnrichVisibleJobs`), sorting (`urgencyRank`), and callbacks stay identical, so ETA behavior can't regress.

## ETA reliability guarantees

- Every ETA reads from the same source as today: `job.route_duration_sec` via `formatEtaMinutes` (already imported). No new server call, no new query key.
- `useEnrichVisibleJobs(jobs, [["jobs"]])` stays at the top of the component, so missing/stale ETAs are still backfilled through the existing `backfillJobEnrichment` pipeline. Nothing about the trigger cadence changes.
- ETA chip renders only when `formatEtaMinutes` returns a truthy string, so a job without an ETA shows nothing rather than "0 min" or a broken pill.
- The expanded live map keeps using the existing `TripEventsMap` component, which owns its own `refreshLiveEta` polling. We do not touch that component or its refetch interval.
- No status timestamps are read off `Job` beyond fields already present (`status`, `driver_id`, `pickup_at`, `route_duration_sec`); the milestone strip is derived from `status` only, so no schema drift.

## Collapsed row layout

- 4px left status rail: emerald for `live` tones (en_route/arrived/in_progress), blue for open wait sessions, slate for assigned/pending.
- Route line: `from → to` via `displayLocation(raw, display_name)` (unchanged helper), truncation with `min-w-0`, tabular ETA chip when present.
- Meta line: driver name, pickup time (`tabular-nums`), pax count, flight — same fields as today, restyled as small muted micro-type with lucide icons instead of emoji.
- Right side: status pill using the existing `TONE_CLASS` map plus a ping dot on live jobs (already implemented).

## Expanded panel

Two columns on desktop (`lg:` breakpoint), stacked on mobile:

- **Map (2/3)** — swap the current `<iframe src="maps.google.com/…">` for `<TripEventsMap jobId={job.id} isLive={status.tone === "live"} />`. This is the same component already used in `TripDetailsSheet`, so it renders the planned route, driver breadcrumb, and event pins we already log. A thin dashed SVG overlay with the `animate-route-flow` keyframe sits above the map only while `q.isLoading` inside `TripEventsMap` — actually, the overlay lives in the parent behind the map container as a fallback shimmer only when we don't yet have a `route_duration_sec` value; once the map has data, the overlay is hidden. Nothing about the map's own ETA/refresh loop changes.
- **Side rail (1/3)** — three stacked blocks:
  1. **Live ETA card** — big number from `formatEtaMinutes(job.route_duration_sec)` plus the pickup clock time; muted "—" when unknown.
  2. **Milestone strip** — vertical timeline derived purely from `status` and `driver_id`: Booked → Assigned → En route → Arrived → On board → Done. The step matching the current status pulses; earlier steps are filled; later steps muted. No new fields, no new queries.
  3. **Actions** — `Chat`, `Call driver`, `Open full details →` wired to existing `onOpenChat`, `job.drivers?.phone`, `onOpenDetails` props exactly as today.

## Motion & tokens

- Row expand uses the existing `animate-accordion-down` utility.
- New `@keyframes route-flow` + `@utility animate-route-flow` added to `src/styles.css` for the dashed overlay.
- All colors use semantic tokens (`bg-card`, `text-muted-foreground`, `border`, `bg-primary/10`, `text-primary`, `TONE_CLASS`). No hardcoded palette additions except the existing emerald/blue/slate used elsewhere in the file.

## Files touched

- `src/routes/_authenticated/coordinator.calendar.tsx` — rewrite the body of `DispatchTripList` only (lines 3213–3339). Add three small local helpers in the same file: `MilestoneStrip`, `RouteFlowOverlay`, `DriverAvatar`. Import `TripEventsMap` from `@/components/coordinator/TripEventsMap` and `Phone, MessageSquare, ArrowRight, Users, Clock, Plane` from `lucide-react` (some already imported).
- `src/styles.css` — append `@keyframes route-flow` and `@utility animate-route-flow`.

## Out of scope

- No changes to `TripEventsMap`, `refreshLiveEta`, `backfillJobEnrichment`, `useEnrichVisibleJobs`, or any server function.
- No changes to filters, sort, `WaitingNowStrip`, or `TripDetailsSheet`.
- No DB migrations.

## Verification

1. `tsgo` clean.
2. Playwright script on `/coordinator/calendar` at 1280px: expand a live trip, screenshot, confirm ETA chip matches `route_duration_sec` and the map renders `TripEventsMap` (not an iframe).
3. Repeat at 420px viewport, confirm the panel stacks and remains usable.
4. Console has no new errors and the "Refresh ETA" flow on `TripDetailsSheet` still works (unchanged code path).
