# Batch D — Completed

Extends Phase 1 + Batch A/B/C. No completed workflows were modified.

## Files added
- `src/lib/route-optimization.functions.ts` — `suggestRouteOptimization`,
  `listGroupRouteOptimizations`, `approveRouteOptimization`,
  `rejectRouteOptimization`.
- `src/components/coordinator/RouteOptimizationPanel.tsx` — coordinator UI
  mounted inside `GroupStopsPanel` (Suggest → Apply / Reject).
- `src/hooks/use-auto-next-job.ts` — client-side observer that watches for
  a job transitioning to `completed` and returns the next assigned job.
- `src/components/driver/AutoNextJobSheet.tsx` — bottom sheet shown to the
  driver after completing a trip; buttons for Start navigation, Open trip,
  Dismiss (snoozes 15 minutes via localStorage).
- `docs/BATCH_D_IMPLEMENTATION_PLAN.md`
- `docs/BATCH_D_COMPLETED.md`
- `docs/BATCH_D_MANUAL_TESTING.md`

## Files modified
- `src/components/coordinator/GroupStopsPanel.tsx` — mounts
  `RouteOptimizationPanel` at the top of the expanded panel.
- `src/routes/m.driver.$token.tsx` — imports the hook + sheet, wires
  `useAutoNextJob(jobs, { enabled: auto_next_job_enabled })`, mounts
  `<AutoNextJobSheet …/>`. Adds `auto_next_job_enabled` to
  `DriverManifestResponse.companySettings`.
- `src/lib/coordinator-public.functions.ts` — driver manifest selects
  and returns `auto_next_job_enabled`.

## Database changes (single migration)
- New table `public.group_route_optimizations` with hash of the original
  and suggested orderings, distance/duration metrics for both, model id,
  short reasoning string, and `status ∈ {pending, approved, rejected, superseded}`.
  Unique partial index enforces one `pending` row per group.
- `public.companies.auto_next_job_enabled boolean NOT NULL DEFAULT true`.
- Seed row in `public.ai_feature_costs` for `route_optimization` (3 points,
  blocks on empty balance).
- Index `idx_jobs_driver_pickup` on `(driver_id, pickup_at)` (partial)
  to speed up driver next-job lookups (Production Readiness).
- RLS: coordinator sees only their company's optimizations; admins see all.
  Grants: `SELECT, INSERT, UPDATE` to `authenticated`, `ALL` to `service_role`.

## API surface
| Fn | Auth | Bills | Notes |
| -- | ---- | ----- | ----- |
| `suggestRouteOptimization({group_id})` | Coordinator | 3 pts (`route_optimization`) | Scores current + AI-suggested order with Distance Matrix; stores `pending`. Supersedes previous `pending`. |
| `listGroupRouteOptimizations({group_id})` | Coordinator | 0 | Latest 5 rows. |
| `approveRouteOptimization({id})` | Coordinator | 0 | Writes new `group_stops.stop_index`, marks pending driver reorder requests `superseded`, audits `route_optimization_approved`. |
| `rejectRouteOptimization({id, note?})` | Coordinator | 0 | Audits `route_optimization_rejected`. |

## Production readiness report

### Security
- New table gated by RLS via `private.is_admin` / `private.company_of`,
  matching existing Batch C tables.
- Server function derives `company_id` from the group's parent job — not
  from client input — so a coordinator cannot request an optimization for
  another company's group even by tampering with `group_id`.
- Points billed **before** the AI call and Distance Matrix loop, so a
  failing call still records the spend (matches existing AI features).
- The AI's returned `order` array is validated as a permutation of the
  original stop ids before it is stored; hallucinations are rejected.
- Approval rewrites `stop_index` sequentially (no admin key needed) and
  supersedes any pending driver reorder to keep audit ordering coherent.

### Performance
- Suggestion cost: `N-1` Distance Matrix calls per scoring pass, done
  twice (original + suggested). Typical group size 3–8 stops → 4–14 DM
  calls total, well under the connector-gateway limits already in use.
- Added partial index `idx_jobs_driver_pickup` for the manifest's
  “next assigned job” lookup used by Auto Next Job.
- `RouteOptimizationPanel` query is not enabled until the group panel
  is expanded, so it does not fire for every calendar card.
- `AutoNextJobSheet` is a purely client-side observer over the existing
  20 s manifest refetch; no new server calls.

### Audit coverage
- Every approval/rejection is recorded via `record_trip_audit` with
  `_approval_status = 'approved' | 'rejected'` and event types
  `route_optimization_approved` / `route_optimization_rejected`.
- Batch C hash chain verifier (`verify_trip_audit_chain`) unchanged and
  continues to cover the new events.

### Permissions / RLS
- `group_route_optimizations` policies: SELECT + INSERT + UPDATE all
  scoped `is_admin OR company_id = company_of(auth.uid())`.
- Grants only to `authenticated` and `service_role`; anon has no access.
- No changes to existing RLS on `jobs`, `groups`, `group_stops`, or the
  audit tables.

### Mobile usability
- `AutoNextJobSheet` uses the standard bottom-sheet component (thumb
  reach), primary CTA is “Start navigation”, secondary is “Open trip”.
- Snooze button dismisses for 15 minutes to avoid nagging drivers on
  rapid consecutive completions.
- Route panel inside the group section is compact (11px chips) so it
  fits inside the existing calendar card sheet on phones.

### Coordinator usability
- Panel shows current vs suggested time/distance, savings badge, and a
  1-line rationale from the model.
- “Marginal improvement (<1 min)” hint prevents pointless approvals.

### Blockers / risks / debt
- **None blocking.** The Gemini reasoning is displayed as-is; if the
  model returns overly long text, we truncate in a follow-up iteration.
- **Debt:** future improvement — replace the sequential DM loop with a
  single DM matrix call and compute the TSP heuristic locally.

## Rollback
```sql
DROP INDEX IF EXISTS public.idx_jobs_driver_pickup;
DROP TABLE IF EXISTS public.group_route_optimizations;
ALTER TABLE public.companies DROP COLUMN IF EXISTS auto_next_job_enabled;
DELETE FROM public.ai_feature_costs WHERE feature_key = 'route_optimization';
```
UI revert: unmount `RouteOptimizationPanel` in `GroupStopsPanel.tsx`
and `AutoNextJobSheet` in `m.driver.$token.tsx`. Batch A/B/C workflows
remain intact.
