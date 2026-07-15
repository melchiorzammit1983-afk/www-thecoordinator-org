# Batch C — Implementation Plan

Audit Trail + Anti-Tampering + Grouped Trip improvements.
Phase 1 / Batch A / Batch B workflows are only **observed** by the new
audit layer — never modified.

## 1. Architecture

`admin_activity_log` + `log_activity()` trigger stay untouched (Batch A/B
rely on them). Batch C adds a purpose-built operational log,
`trip_audit_log`:

- Append-only. RLS blocks direct INSERT; UPDATE/DELETE revoked from
  `authenticated`.
- Hash-chained per trip. Every row stores `prev_hash` + `row_hash =
  sha256(prev_hash || canonical(payload))`.
- Written exclusively through `record_trip_audit` (`SECURITY DEFINER`) so
  clients cannot forge hashes or backdate `server_time`.
- Coordinator-readable scoped to their company via a first-class
  `company_id` column (no join required for reporting).

Grouped trips today: `groups` = label + driver link on one job. Batch C
adds a **stops** concept — an ordered list under a group — without
breaking legacy single-job grouping used by driver links or pax.

## 2. Files affected

**New**
- `src/lib/audit.functions.ts` — `listTripAudit`, `listSuspiciousActivity`,
  `approveStopReorder`.
- `src/lib/groups.functions.ts` — `listGroupStops`, `reorderStops`,
  `splitGroup`, `mergeGroups`, `requestStopReorder`.
- `src/components/coordinator/TripAuditTimeline.tsx`
- `src/components/coordinator/SuspiciousActivityCard.tsx`
- `src/components/coordinator/GroupStopsPanel.tsx`

**Modified (write-through only)**
- `src/lib/coordinator-public.functions.ts` — added
  `listGroupStopsForDriver` + `requestStopReorderByDriver` (driver
  token-scoped).
- `src/routes/_authenticated/coordinator.index.tsx` — mounts
  `SuspiciousActivityCard`.
- `src/components/coordinator/TripDetailsSheet.tsx` — mounts
  `GroupStopsPanel` and `TripAuditTimeline`.
- `src/routes/m.driver.$token.tsx` — adds "Reorder stops" button that
  submits a driver reorder request.

**Untouched**
- Every file implementing GPS validation, waiting timers, boarding,
  safety mode, or emergency override logic. The new triggers only *read*
  their outcomes and log them.

## 3. Database changes (single migration)

Tables:

- `trip_audit_log` (with `company_id`, `approval_status`,
  `previous_state`, `new_state`, GPS + `device_time` / `server_time` +
  `prev_hash` / `row_hash`). Indexes on `(company_id, created_at)`,
  `(job_id, created_at)`, `(driver_id, created_at)`, `(event_type,
  created_at)`, partial `(approval_status)` for `pending`/`rejected`.
- `group_stops` (`group_id`, `stop_index`, address / display_name /
  place_id / lat / lng, `pax_count`, per-stop timestamps + charges).
- `group_stop_reorder_requests` (`group_id`, `requested_by_driver_id`,
  `proposed_order[]`, `status`, `decided_by_user_id`).

Functions:

- `canonical_jsonb(jsonb)` — deterministic key-sorted, null-stripped
  serialization; identical between insert and verification.
- `record_trip_audit(...)` — resolves `company_id` + `driver_id` from the
  job, defaults `approval_status` per event class, serializes the chain
  with `SELECT ... FOR UPDATE`, computes and stores the row hash.
- `verify_trip_audit_chain(_job_id)` — recomputes every row's hash;
  returns `(row_id, ok)`. UI shows a shield ✅ / ⚠️.
- View `v_suspicious_activity` — rolling 24 h / 7 d aggregates by
  `company_id, driver_id` on `trip_audit_log` (no jobs join needed).

Write-through triggers (do not modify workflows):

- `AFTER UPDATE OF status ON jobs` → `status_change`
- `AFTER INSERT/UPDATE ON job_wait_sessions` → `wait_started`,
  `wait_ended`
- `AFTER INSERT/UPDATE ON job_boarding_approvals` →
  `boarding_started`, `boarding_approved`
- `AFTER INSERT ON job_emergency_overrides` → `override_*` /
  `safety_concern` / `breakdown`
- `AFTER UPDATE ON pax` → `pax_no_show` / `pax_cancelled`

## 4. API changes

- `listTripAudit({ job_id })` → `{ rows, chain_ok }`.
- `listSuspiciousActivity()` → view rows.
- `listGroupStops` / `reorderStops` / `splitGroup` / `mergeGroups` /
  `requestStopReorder` — coordinator (`requireSupabaseAuth`).
- `listGroupStopsForDriver` / `requestStopReorderByDriver` — driver
  magic-link token.
- `approveStopReorder` — coordinator decision, rewrites `stop_index`
  and records an audit row with `approval_status = approved | rejected`.

## 5. Driver app

The grouped-run badge now sits next to a compact **🔀 Reorder stops**
button. Opens a dialog listing the stops with up/down arrows and a
"Send request" button. Driver sees "Waiting for coordinator" while a
request is pending.

## 6. Coordinator app

- **TripDetailsSheet** shows `GroupStopsPanel` (expandable) when
  `group_id` is present, and an **Audit trail** section at the bottom
  with a chain-integrity badge, per-row event icon, approval-status
  pill, GPS pin, and device-vs-server time drift when > 60 s.
- **Coordinator dashboard** mounts `SuspiciousActivityCard` (top 5
  warnings) below the KPI grid.

## 7. Risks

- **Trigger recursion / write-amplification.** Triggers on `jobs`,
  `pax`, wait / boarding / override tables all write to
  `trip_audit_log`. Audit table has no triggers. Failures inside
  `record_trip_audit` are trapped (`RAISE WARNING`) so the source
  workflow write is never rolled back.
- **Chain contention.** `FOR UPDATE` on the last row per `job_id`
  serializes inserts per trip. Acceptable — one driver at a time.
- **Hash sensitivity to jsonb ordering.** Mitigated by
  `canonical_jsonb`.
- **Legacy grouped jobs (no `group_stops` rows).** `listGroupStops`
  returns an empty list and UI shows a friendly "No detailed stops
  recorded yet" message.
- **Points cost.** Audit writes are pure Postgres — no AI / points
  burn. Reverse geocoding reuses addresses already captured by the
  source workflow.

## 8. Rollback

1. UI-only revert: components remain unused, `record_trip_audit` calls
   become dead code and do not error.
2. Full rollback migration:
   ```sql
   DROP VIEW     IF EXISTS public.v_suspicious_activity;
   DROP FUNCTION IF EXISTS public.verify_trip_audit_chain(uuid);
   DROP FUNCTION IF EXISTS public.record_trip_audit(
     uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text,
     numeric, timestamptz, uuid, uuid, text, uuid, text
   );
   DROP TRIGGER  IF EXISTS trg_audit_jobs_status          ON public.jobs;
   DROP TRIGGER  IF EXISTS trg_audit_wait_sessions        ON public.job_wait_sessions;
   DROP TRIGGER  IF EXISTS trg_audit_boarding_approvals   ON public.job_boarding_approvals;
   DROP TRIGGER  IF EXISTS trg_audit_emergency_overrides  ON public.job_emergency_overrides;
   DROP TRIGGER  IF EXISTS trg_audit_pax                  ON public.pax;
   DROP TABLE IF EXISTS public.group_stop_reorder_requests;
   DROP TABLE IF EXISTS public.group_stops;
   DROP TABLE IF EXISTS public.trip_audit_log;
   ```
3. `admin_activity_log` untouched → Batch A/B forensics intact.

Zero rollback impact on GPS, waiting, boarding, safety, or override
workflows.
