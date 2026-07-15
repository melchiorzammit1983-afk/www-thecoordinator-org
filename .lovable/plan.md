# Batch C — Implementation Plan (revised)

Audit Trail + Anti-Tampering + Grouped Trip improvements. Phase 1 / Batch A / Batch B workflows are only *observed* by the new audit layer — never modified.

The plan doc `docs/BATCH_C_IMPLEMENTATION_PLAN.md` is written during build mode; full content lives here.

---

## 1. Architecture Review

`admin_activity_log` + `log_activity()` trigger stay untouched (Batch A/B rely on them). Batch C adds a **purpose-built operational log**, `trip_audit_log`:

- append-only (RLS blocks direct INSERT; UPDATE/DELETE revoked from `authenticated`),
- hash-chained per trip,
- written exclusively via `record_trip_audit` (`SECURITY DEFINER`) so clients cannot forge hashes or backdate `server_time`,
- coordinator-readable scoped to their company (via `company_id` column — no join needed).

Grouped trips today: `groups` = label + driver link on one job. Batch C adds a **stops** concept — an ordered list of destinations under a group — without breaking legacy single-job grouping used by driver links or pax assignment.

---

## 2. Files Affected

**New**
- `src/lib/audit.functions.ts` — `listTripAudit`, `listSuspiciousActivity`, `requestStopReorder`, `approveStopReorder`.
- `src/lib/groups.functions.ts` — `listGroupStops`, `reorderStops`, `splitGroup`, `mergeGroups`.
- `src/components/coordinator/TripAuditTimeline.tsx` — renders audit rows with hash-verified badge and approval-status chip.
- `src/components/coordinator/SuspiciousActivityCard.tsx` — dashboard warning tile.
- `src/components/coordinator/GroupStopsPanel.tsx` — expand/reorder/split/merge UI.
- `docs/BATCH_C_IMPLEMENTATION_PLAN.md`, `docs/BATCH_C_COMPLETED.md`, `docs/BATCH_C_MANUAL_TESTING.md`.

**Modified (write-through only — call the new RPC, no workflow change)**
- `src/lib/coordinator-public.functions.ts` — after every existing status/waiting/boarding/override write, call `record_trip_audit` with the appropriate `approval_status`.
- `src/lib/coordinator.functions.ts` — same for coordinator-side waiting adjustments and safety-flag clears.
- `src/routes/_authenticated/coordinator.index.tsx` — mount `SuspiciousActivityCard`.
- `src/components/coordinator/TripDetailsSheet.tsx` — add "Audit" tab; render `GroupStopsPanel` when `group_id IS NOT NULL`.
- `src/routes/m.driver.$token.tsx` — "Request stop reorder" button inside grouped-run view.

**Untouched (explicit)**
- Every file implementing GPS validation, waiting timers, boarding, safety mode, or emergency override logic. We only *read* their outcomes and log them.

---

## 3. Database Changes (single migration)

```text
trip_audit_log
  id uuid pk
  company_id uuid not null          -- ★ new: scopes reporting without joining jobs
  job_id uuid                       -- fk jobs, indexed
  group_id uuid null                -- fk groups
  stop_id uuid null                 -- fk group_stops
  driver_id uuid null
  actor_user_id uuid null
  actor_label text                  -- 'driver' | 'coordinator' | 'system' | 'passenger'
  event_type text                   -- enum below
  approval_status text not null default 'not_required'
                                    -- ★ new: 'approved'|'rejected'|'pending'|'overridden'|'not_required'
  previous_state jsonb
  new_state jsonb
  notes text
  gps_lat numeric, gps_lng numeric, gps_accuracy_m numeric
  street_address text
  speed_kmh numeric
  device_time timestamptz null
  server_time timestamptz not null default now()   -- authoritative
  prev_hash text null
  row_hash  text not null            -- sha256(prev_hash || canonical(payload including company_id + approval_status))
  created_at timestamptz not null default now()

  CHECK (approval_status IN ('approved','rejected','pending','overridden','not_required'))

  INDEX (company_id, created_at DESC)
  INDEX (job_id, created_at)
  INDEX (driver_id, created_at DESC)
  INDEX (event_type, created_at DESC)
  INDEX (approval_status) WHERE approval_status IN ('pending','rejected')

group_stops
  id uuid pk
  group_id uuid fk groups on delete cascade
  stop_index int not null                           -- 0-based, unique (group_id, stop_index)
  address text, display_name text, place_id text
  lat numeric, lng numeric
  pax_count int default 0
  arrived_at, boarded_at, no_show_at, completed_at timestamptz null
  wait_started_at, wait_ended_at timestamptz null
  charges_cents int default 0
  created_at, updated_at timestamptz

group_stop_reorder_requests
  id, group_id, requested_by (driver_id), proposed_order uuid[],
  status text ('pending'|'approved'|'rejected'), decided_by uuid null,
  created_at, decided_at
```

Event-type set: `arrival_verified`, `arrival_manual`, `wait_started`, `wait_ended`, `wait_charge_changed`, `boarding_started`, `boarding_completed`, `boarding_approved`, `pax_no_show`, `pax_cancelled`, `override_arrived`, `override_on_board`, `override_en_route`, `override_drop_off`, `override_complete`, `safety_concern`, `breakdown`, `status_change`, `stop_reordered`, `stop_split`, `stop_merged`, `stop_reorder_requested`, `stop_reorder_decided`.

**Approval-status semantics per event class** (defaults inside the RPC when caller omits it):
- Emergency overrides → `overridden`.
- Boarding approvals → `approved` / `rejected` from the workflow decision.
- Stop-reorder requests → `pending` on create; the decision row writes `approved` / `rejected`.
- Waiting-charge changes → `approved` (coordinator) or `overridden` (driver-initiated).
- Everything else (arrivals, status changes, GPS pings) → `not_required`.

**RPC — the only write path**
```sql
create function public.record_trip_audit(
  _job_id uuid, _event_type text, _previous jsonb, _new jsonb,
  _notes text, _lat numeric, _lng numeric, _accuracy numeric,
  _address text, _speed numeric, _device_time timestamptz,
  _group_id uuid, _stop_id uuid,
  _approval_status text default null   -- ★ null → RPC defaults per event_type
) returns uuid
security definer set search_path = public
```
- Resolves `actor_user_id` from `auth.uid()`, `driver_id` + `company_id` from the job row.
- Locks the last row for `job_id` (`SELECT ... FOR UPDATE`) to serialize the chain.
- Canonicalizes the payload (incl. `company_id`, `approval_status`) and computes `row_hash = sha256(prev_hash || canonical)` via `pgcrypto`.
- Inserts. `server_time = now()`; client timestamps live only in `device_time`.

**Grants / RLS**
```text
GRANT SELECT, INSERT ON trip_audit_log TO authenticated;  -- direct INSERT blocked by RLS; writes go through the definer RPC
GRANT ALL             ON trip_audit_log TO service_role;
REVOKE UPDATE, DELETE ON trip_audit_log FROM authenticated, anon;
ALTER TABLE trip_audit_log ENABLE ROW LEVEL SECURITY;
-- SELECT: coordinator reads rows WHERE company_id = company_of(auth.uid()); admins read all
-- INSERT: WITH CHECK (false)
```
Same GRANT/RLS shape for `group_stops` (company-scoped via parent group's job) and `group_stop_reorder_requests` (driver INSERT own group; coordinator UPDATE own; SELECT both).

Suspicious activity: `SECURITY DEFINER` view `v_suspicious_activity` scans `trip_audit_log` directly by `company_id` (no jobs join) over 24h / 7d windows:
- overrides ≥ 3 in 24h,
- no-shows ≥ 5 in 7d,
- waiting-charge edits ≥ 3 in 24h,
- GPS validation failures ≥ 2 in 24h,
- same override reason ≥ 4 in 7d,
- `approval_status = 'rejected'` ≥ 2 in 24h.

**Triggers (write-through, not workflow changes)**: `AFTER UPDATE ON jobs` (status), `job_wait_sessions`, `job_boarding_approvals`, `job_emergency_overrides`, `pax` — each calls `record_trip_audit`. Audit failures are logged (`RAISE WARNING`) and never roll back the source write.

Chain verification helper: `verify_trip_audit_chain(_job_id uuid) returns table(row_id uuid, ok boolean)` — recomputes hashes; UI shows shield ✅/⚠️.

---

## 4. API / Server-Function Changes

- `listTripAudit({ job_id })` → rows + `chain_ok`; each row includes `approval_status`.
- `listSuspiciousActivity({ company_id? })` → view rows for dashboard (defaults to caller's company via `company_id` index).
- `listGroupStops({ group_id })`, `reorderStops({ group_id, ordered_stop_ids })`, `splitGroup({ group_id, stop_ids })`, `mergeGroups({ target_group_id, source_group_ids })` — all `requireSupabaseAuth`, company-scoped.
- `requestStopReorder({ group_id, proposed_order })` — driver token endpoint; audit row is `approval_status = 'pending'`.
- `approveStopReorder({ request_id, approve })` — coordinator; audit row `approved`/`rejected`.

Existing status/override/waiting server functions gain one line: `await recordTripAudit(..., approval_status)`. Signatures unchanged.

---

## 5. Driver App Changes

- Grouped-run view (`m.driver.$token.tsx` when `group_id` present) gets an expandable stop list — current stop highlighted, others collapsible. Existing per-trip status buttons unchanged; they operate on the current stop.
- **"Request reorder"** button opens a drag list, submits `requestStopReorder`. Driver sees "Waiting for coordinator" until decided.
- No changes to Safety Mode, arrival, waiting, boarding, or override buttons.

---

## 6. Coordinator App Changes

- **Trip details sheet** gains an *Audit* tab: chronological timeline, event icons, previous→new diff, GPS pin (opens map), device-vs-server time delta chip, chain-integrity badge, and an **approval-status pill** (green/red/amber/grey/blue).
- Grouped trips render as **"Airport Run · 5 Stops"** with expand chevron → `GroupStopsPanel`: per-stop arrival/wait/boarding/charges plus reorder / split / merge / approve-driver-reorder actions.
- **Dashboard tile** `SuspiciousActivityCard` — top 5 warnings; each links to the trip.
- Trip cards get a ⚠️ badge when the driver has a live suspicious signal.
- Dashboard exposes a "Pending approvals" filter using the `approval_status` partial index.

---

## 7. Risks

- **Trigger recursion / write-amplification.** Triggers on `jobs`, `pax`, wait/boarding/override tables all write to `trip_audit_log`. Audit table itself has no triggers.
- **Chain contention.** `FOR UPDATE` on the last row per `job_id` serializes inserts for the same trip. Acceptable — one driver per trip.
- **Hash sensitivity to jsonb ordering.** `canonical_jsonb(jsonb)` helper (sorted keys, null-stripped) used by both `record_trip_audit` and `verify_trip_audit_chain`. `company_id` and `approval_status` are part of the canonical payload from day one.
- **Legacy grouped jobs (no `group_stops` rows)** must keep working. `listGroupStops` synthesizes a single-stop row when empty; UI falls back to classic card.
- **Points cost.** Audit writes are pure Postgres — no AI / points burn. Reverse geocoding reuses the address already captured by the source workflow.

---

## 8. Rollback

Independent pieces:

1. **UI only** — revert component/route edits; `record_trip_audit` calls become dead code, don't error.
2. **Full rollback migration**:
   ```sql
   DROP VIEW     IF EXISTS public.v_suspicious_activity;
   DROP FUNCTION IF EXISTS public.verify_trip_audit_chain(uuid);
   DROP FUNCTION IF EXISTS public.record_trip_audit(...);
   DROP TRIGGER  IF EXISTS trg_audit_jobs_status ON public.jobs;
   -- ...pax / wait / boarding / override triggers
   DROP TABLE IF EXISTS public.group_stop_reorder_requests;
   DROP TABLE IF EXISTS public.group_stops;
   DROP TABLE IF EXISTS public.trip_audit_log;
   ```
3. `admin_activity_log` untouched → Batch A/B forensics intact through rollback.

Zero rollback impact on GPS, waiting, boarding, safety, or override workflows.

---

## Deliverables

- `docs/BATCH_C_IMPLEMENTATION_PLAN.md` (this content)
- Migration from §3
- Server functions & components from §2
- `docs/BATCH_C_COMPLETED.md` and `docs/BATCH_C_MANUAL_TESTING.md` after implementation

Ready to implement on approval.
