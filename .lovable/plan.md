# Bulletproof business names + ETA on every trip card

Right now cards fall back to **"Location pin"** whenever the raw address is a plus-code / lat-lng, and ETA only shows if it happens to be cached on the row. The fix is to (a) make the display name always resolve, and (b) make ETA always show, everywhere the trip appears — coordinator calendar, coordinator dashboard, driver card, client portal, tracking page.

## What changes

### 1. Auto-resolve business/hotel names (so "Location pin" stops appearing)

- On **create / update** in `coordinator.functions.ts` (`createJob`, `updateJob`, `createJobsBulk`, portal accept in `coordinator-public.functions.ts`):
  - If a side has coords / place_id / a plus-code text but no `*_display_name`, run the existing `resolveJobPlaceNames` inline (single point charge for the two lookups, gated by the admin `address_name_resolve` feature flag — same as today).
- Add a **lightweight backfill server fn** `backfillJobPlaceNames({ job_ids: string[] })` that the calendar + dashboard queries call once per batch on jobs missing a display name. Concurrency-capped, deduped by `pickup_place_id` / `dropoff_place_id` within the batch to avoid double-charging when many trips share the same hotel.
- Tighten `displayLocation` fallback: when we have `pickup_lat/lng` but no name yet, show **"Locating…"** briefly instead of "Location pin", so the UI never freezes on a code.
- Respect the existing admin toggle — if `address_name_resolve` is disabled, keep today's behaviour (show raw address / "Location pin").

### 2. ETA on every card, always

- Add `ensureJobEta({ job_id })` server fn that:
  - Returns cached `route_duration_sec` if `route_computed_at` is fresh (< 30 min for future trips, < 5 min for trips within the next hour).
  - Otherwise calls `estimateRouteEta` with `cache_on_job: true` (same feature-flag gate).
- Auto-compute on **create/update** whenever both `from_location` and `to_location` exist and ETA is null/stale.
- Coordinator calendar dispatch list (the "Trips" section the user selected): move the `≈ 32 min` chip next to the arrow between `from → to` so it reads **"Hotel Juliani → MLA · ≈ 32 min"**. Add matching chip on:
  - `coordinator.index.tsx` "New trips" + "Unassigned" mini cards
  - `TripDetailsSheet` header (already partially — make sure it always renders when >0)
  - `m.driver.$token.tsx` driver card (near the address block)
  - `m/client/$token.tsx` client booking rows
  - `t.$token.tsx` public tracking page (already prints minutes — keep as-is, just ensure value is populated)
- Batch backfill: `backfillJobEtas({ job_ids })` for visible rows missing/stale ETA, single call per screen load; respects `route_eta` entitlement.

### 3. Data flow guarantees ("bulletproof")

- Wrap the two backfill fns behind a **debounced hook** `useEnrichVisibleJobs(jobIds)` so a screen only enriches once per minute, not on every re-render, and never charges twice for the same job during that window.
- Skip enrichment entirely when the admin feature toggle is off (falls back to raw address + no ETA chip — same as today).
- Store enrichment results back on the `jobs` row so subsequent renders and the client/driver views read the cached value without a second charge.
- All server fns already sit behind `requireSupabaseAuth` + `_tryCharge` — no new points paths introduced.

## Files touched

- `src/lib/trip-display.ts` — "Locating…" fallback when coords exist.
- `src/lib/places.functions.ts` — add `backfillJobPlaceNames`, `backfillJobEtas`, `ensureJobEta`.
- `src/lib/coordinator.functions.ts` — auto-resolve name + ETA in `createJob` / `updateJob` / `createJobsBulk`.
- `src/lib/coordinator-public.functions.ts` — same auto-enrich on portal booking accept.
- `src/hooks/use-enrich-jobs.ts` — new debounced enrichment hook.
- `src/routes/_authenticated/coordinator.calendar.tsx` — call hook, ETA chip inline with `from → to` on dispatch list + trip cards.
- `src/routes/_authenticated/coordinator.index.tsx` — same enrichment + ETA chip on dashboard cards.
- `src/routes/m.driver.$token.tsx` — ETA chip on driver card.
- `src/routes/m/client/$token.tsx` — ETA chip on client booking row.
- `src/components/coordinator/TripDetailsSheet.tsx` — enforce ETA badge always renders when value exists.

## Not changed

- No new DB columns (all fields already exist: `pickup_display_name`, `dropoff_display_name`, `route_duration_sec`, `route_distance_m`, `route_computed_at`).
- No changes to admin toggles or point pricing.
- No workflow changes to booking/dispatch/driver-accept.
