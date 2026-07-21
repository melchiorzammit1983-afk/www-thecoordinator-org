## Phase 2 — Driver "On The Go" trip creation

Adds a second entry point in the driver app that creates a real, live-tracked trip in one tap, then walks the driver through stops as they happen. Existing driver flows and coordinator flows stay unchanged.

### 1. Database (single migration)

Add two columns to `public.jobs`:
- `created_by_driver` boolean not null default false
- `needs_review` boolean not null default false

No new table — the existing `groups` + `group_stops` pair (already used by grouped trips) is the "linked stops" model. When the driver taps "Add another stop", we create a `groups` row for the job (if none) and append `group_stops` rows. Simple single-pickup on-the-go trips stay flat (no group created), so nothing changes for normal trips.

RLS: extend the existing driver update policies on `jobs`/`group_stops` so an assigned driver can insert their own on-the-go job and append stops. No new grant surface.

### 2. Server functions (new file `src/lib/driver-otg.functions.ts`)

All authenticated via `requireSupabaseAuth`, resolve the caller to a driver via the existing driver-token lookup used in `m.driver.$token.tsx`.

- `listCompanyCoordinators({ driver_token })` — returns coordinators (companies) the driver is linked to, for the picker.
- `startOnTheGoTrip({ driver_token, company_id })` — inserts a job:
  - `company_id` = chosen coordinator's company
  - `driver_id` = caller
  - `status = 'in_progress'`, `created_by_driver = true`, `needs_review = true`
  - `pickup_at = now()`, empty client fields
  - Charges `trip_created` immediately via existing `spend_points` (same key normal creation uses). If wallet is empty and `block_on_empty=true`, return `{ ok:false, reason:"insufficient_points" }` and don't create.
  - Emits a `trip_map_events` "en_route" pin so the coordinator map picks it up instantly (existing realtime).
- `otgArrivedAtStop({ job_id })` — records `arrived_pickup` event (reuses existing arrival telemetry columns; no auto-GPS trigger, matches current manual model).
- `otgAddPassenger({ job_id, stop_index?, name, phone?, note? })` — inserts a `pax` row (Phase 1 fields), and if this is stop ≥ 2 also promotes/creates a `group` + writes/updates the corresponding `group_stops` row (address = current GPS reverse-geocoded label; falls back to lat/lng string).
- `otgBoardStop({ job_id, stop_index? })` — marks `boarded_at` on the stop (or `pax_boarded` event on stop 1) — reuses existing `markPaxOnboard` per-pax event drop from the earlier map-pins work.
- `otgAddAnotherStop({ job_id })` — clones the stop cycle: creates group if not present, appends next `group_stops` row with `stop_index+1`, returns the new stop id.
- `otgFinishPickups({ job_id, dropoff })` — writes dropoff (address + geocode via existing places pipeline), from here the trip continues via the existing driver "in_progress → completed" flow untouched.

No new feature_key is invented; `trip_created` is reused per spec.

### 3. Driver UI (mobile-first, matches current driver app style)

New screens inside `src/routes/m.driver.$token.tsx` (or a small `src/components/driver/OnTheGo/*` set imported by it), gated behind a new "Create Trip" FAB in the driver home:

```text
[ Create Trip ▾ ]
   ├─ Normal          → opens existing full form (unchanged)
   └─ On The Go       → opens OTG wizard
```

OTG wizard steps (each = full-screen mobile sheet, one primary sticky CTA):
1. **Coordinator picker** — list of coordinator companies with tap targets ≥ 48px, single tap starts the trip. Shows the `trip_created` cost inline and disables + explains if wallet empty.
2. **Live "Driving to stop N"** — big current-status pill + a single "Arrived" button. No forms during driving.
3. **Arrived → passenger form** — Name (required), Phone (optional), Note (optional). Same components used in Phase 1 `PaxEditor`. Second sticky CTA: "Boarding".
4. **Boarding confirm** — two side-by-side buttons: **Add Another Stop** (loops back to step 2, incrementing stop_index and creating the group on first add) and **Finish Pickups** (step 5).
5. **Enter destination** — reuse `AddressAutocomplete`, on confirm the trip snaps into the standard driver in-progress screen (existing drive/drop/complete flow).

All steps show a slim breadcrumb chip so the driver knows where they are (Stop 1 → Stop 2 → Destination).

### 4. Coordinator UI

- **Live dashboard & map**: driver-created trips already appear because they're real jobs — no extra wiring needed. Add a small purple **"Needs Review"** badge on the trip card when `needs_review = true`, and a **chain icon** with stop count when the job has an associated `group` (reuse existing group indicator). Both are read-only from the badge component; new prop in `TripCard`.
- **Open while in progress**: uses the existing trip detail sheet — works today because it's a normal job. No changes needed.
- **Review action**: after the trip completes, the review badge stays until the coordinator opens the existing edit dialog and taps a new **"Mark reviewed"** button (clears `needs_review`). Coordinator can freely edit any field (including finally filling the client/company name) in the same dialog they already use — no separate form.

### 5. Verification checklist (self-run before reporting done)

- Typecheck passes.
- Migration runs; `jobs.created_by_driver` and `jobs.needs_review` present.
- `startOnTheGoTrip` charges `trip_created` exactly once (verify via `points_ledger`).
- On the coordinator dashboard, an OTG trip appears within the existing realtime refresh cadence and shows the "Needs Review" badge.
- Simple single-stop OTG trip (never taps "Add another stop") never creates a `groups` row — stays a flat job.
- Multi-stop OTG trip creates one `groups` row and N `group_stops` rows with correct `stop_index`, `arrived_at`, `boarded_at`.
- Existing normal driver "Create Trip" flow is unchanged and still works.
- Wallet-empty case blocks creation with a clear message; no ghost job is written.

### Technical notes

- Reuses `trip_created` cost key (confirmed present in `ai_feature_costs`).
- Reuses `groups` + `group_stops` schema (confirmed present) — no parallel stops table.
- Reuses per-pax `pax_boarded` map-event drop from the recent map-pins work — the driver gets per-passenger pins on the coordinator map automatically.
- Coordinator card badges are cosmetic-only in `src/components/coordinator/TripCard.tsx`; no logic changes to trip visibility, filtering, or scheduling.
- No changes to Phase 1 code paths.

Deferred (Phase 7, per spec): teaching the AI assistant to create OTG trips via chat.
