# Batch D — Implementation Plan

AI Route Optimization + Auto Next Job + Production Readiness + Final QA.
Phase 1 / Batch A / B / C workflows are only extended — never modified.

## 1. Architecture impact

**Route Optimization (Part 1)** rides on top of the existing
`group_stops` table introduced in Batch C. All AI + Distance-Matrix
calls happen server-side inside a new `createServerFn` module. Nothing
in the driver runtime or the coordinator-facing group panel reorders
stops automatically; a suggestion is stored as a **pending row** in a
new `group_route_optimizations` table and the coordinator explicitly
approves or rejects it. Approval reuses the existing `reorderStops`
write path so audit trail (`record_trip_audit`) is preserved without
changes.

**Auto Next Job (Part 2)** is a purely client-side observer inside the
driver PWA. It watches the manifest for a job transitioning into
`completed` and pops a bottom sheet showing the next assigned job with
"Start navigation" and "Open trip" buttons. No new server contract is
required; the manifest query already returns every assigned job. A
company-level toggle (`auto_next_job_enabled`) and a per-driver
"snooze until" localStorage flag let it be disabled without a code
change.

**Production Readiness (Part 3)** is documentation + a small
migration that fills the two remaining index gaps found during the
review (`jobs(driver_id, pickup_at)` for auto-next lookups and
`group_route_optimizations(group_id, status)` for pending-list
queries). No behavior change.

**Final QA (Part 4)** ships `docs/BATCH_D_MANUAL_TESTING.md` covering
every feature area Phase 1 → Batch D.

## 2. Files affected

**New**
- `src/lib/route-optimization.functions.ts` — `suggestRouteOptimization`,
  `listGroupRouteOptimizations`, `approveRouteOptimization`,
  `rejectRouteOptimization`.
- `src/components/coordinator/RouteOptimizationPanel.tsx` — inline UI
  inside `GroupStopsPanel`.
- `src/components/driver/AutoNextJobSheet.tsx` — bottom sheet triggered
  after a completion.
- `src/hooks/use-auto-next-job.ts` — client-side observer.
- `docs/BATCH_D_IMPLEMENTATION_PLAN.md`
- `docs/BATCH_D_COMPLETED.md`
- `docs/BATCH_D_MANUAL_TESTING.md`

**Modified**
- `src/components/coordinator/GroupStopsPanel.tsx` — mounts
  `RouteOptimizationPanel`.
- `src/routes/m.driver.$token.tsx` — mounts `AutoNextJobSheet` inside
  `DriverManifest` and wires `use-auto-next-job`.

**Untouched (batches A/B/C)**
- `record_trip_audit` and every trigger under it.
- Waiting sessions, boarding approvals, safety mode, emergency
  overrides, GPS validation.
- `reorderStops` — reused as the write path for approved suggestions.

## 3. Database changes (single migration)

Table `group_route_optimizations`:
- `id uuid PK`
- `group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL`
- `company_id uuid NOT NULL` — copied from the parent job for RLS scoping
- `job_id uuid NOT NULL`
- `original_order uuid[] NOT NULL` — `group_stops.id` sequence at request time
- `suggested_order uuid[] NOT NULL`
- `approved_order uuid[]` — set on approve
- `status text NOT NULL DEFAULT 'pending'` — `pending|approved|rejected|superseded`
- `model text` — AI model id used
- `reasoning text` — short human-readable rationale from the model
- `distance_meters_original int`, `distance_meters_suggested int`
- `duration_seconds_original int`, `duration_seconds_suggested int`
- `requested_by_user_id uuid REFERENCES auth.users(id)`
- `decided_by_user_id uuid REFERENCES auth.users(id)`
- `decided_at timestamptz`
- `created_at timestamptz DEFAULT now()`
- `updated_at timestamptz DEFAULT now()` + `set_updated_at` trigger

Constraints/Indexes:
- `UNIQUE (group_id, status) WHERE status = 'pending'` — one pending
  suggestion per group at a time.
- `CREATE INDEX ON group_route_optimizations(company_id, created_at DESC)`
- `CREATE INDEX ON group_route_optimizations(group_id, created_at DESC)`

RLS:
- `SELECT`: `private.is_admin(auth.uid())` OR
  `company_id = private.company_of(auth.uid())`.
- `INSERT`/`UPDATE`: same company scope; server-fn resolves company from
  the group's job.

Grants:
- `GRANT SELECT, INSERT, UPDATE ON public.group_route_optimizations TO authenticated;`
- `GRANT ALL ON public.group_route_optimizations TO service_role;`

Column additions:
- `companies.auto_next_job_enabled boolean NOT NULL DEFAULT true`.

Point billing seed:
- `INSERT INTO ai_feature_costs(feature_key, points_cost, enabled, block_on_empty) VALUES ('route_optimization', 3, true, true) ON CONFLICT DO NOTHING;`

Indexes for Production Readiness:
- `CREATE INDEX IF NOT EXISTS idx_jobs_driver_pickup ON public.jobs(driver_id, pickup_at) WHERE driver_id IS NOT NULL;`

## 4. API changes

- `suggestRouteOptimization({ group_id })` — coordinator server fn.
  1. Load `group_stops` ordered by `stop_index` (must have ≥ 3 stops).
  2. Compute `distance_meters_original` and `duration_seconds_original`
     via Distance Matrix in sequence.
  3. Ask `google/gemini-3.5-flash` for an improved order given the
     stops (address, pax_count, pickup_window_start/end where present).
     Structured output: `{ order: string[], reasoning: string }`.
  4. Recompute distance/duration for the suggested order.
  5. Bill `route_optimization` via `spend_points` (3 points).
  6. If the model returned the same order, still store the suggestion
     with `reasoning = "Current order is already optimal"`.
  7. `INSERT` row `status = 'pending'`; on unique-index conflict mark
     the older pending row `superseded` first.
- `listGroupRouteOptimizations({ group_id })` — latest 5 rows.
- `approveRouteOptimization({ id })` — validates coordinator's company,
  writes new `stop_index` via `reorderStops`-equivalent update, records
  audit `route_optimization_approved` (via `record_trip_audit`), sets
  `status='approved'`, `approved_order`, `decided_by_user_id`,
  `decided_at`.
- `rejectRouteOptimization({ id, note? })` — sets `status='rejected'`,
  records audit `route_optimization_rejected`.

Auto Next Job — no new server contract.

## 5. Risks

- **Distance Matrix cost**: pairwise sequential DM calls. Bounded by
  the number of stops (typically 3–8), so worst case 7 requests per
  suggestion. Same connector-gateway path already used by
  `computeTripLiveStatus`.
- **AI hallucination on stop IDs**: the model may return ids not in
  the group. Mitigation: validate the returned order server-side and
  reject the suggestion (returning an error to the coordinator) if
  ids don't match the set.
- **Points burn**: billed once per successful *suggestion*, blocked on
  empty balance via `spend_points(block_on_empty=true)`.
- **Auto Next Job intrusion**: driver may find the popup annoying.
  Company toggle + per-driver "snooze 30 min" localStorage flag.
  Bottom sheet is dismissible.
- **Chain of reorderings**: an approved AI suggestion overwrites
  stop_index, invalidating any pending driver reorder request. We
  auto-mark those driver requests as `superseded` in the same
  transaction.

## 6. Rollback strategy

1. UI-only revert: unmount `RouteOptimizationPanel` and
   `AutoNextJobSheet` — no data impact, pending rows stay dormant.
2. Full rollback migration:
   ```sql
   DROP INDEX IF EXISTS public.idx_jobs_driver_pickup;
   DROP TABLE IF EXISTS public.group_route_optimizations;
   ALTER TABLE public.companies DROP COLUMN IF EXISTS auto_next_job_enabled;
   DELETE FROM public.ai_feature_costs WHERE feature_key = 'route_optimization';
   ```
3. Batch A/B/C workflows are untouched; no rollback impact on GPS,
   waiting, boarding, safety, override, audit trail, or grouped-trip
   Batch C features.
